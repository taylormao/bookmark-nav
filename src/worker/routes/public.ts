import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { createDb, type Db } from "../db/client";
import { bookmarks, bookmarkTags, categories, settings, tags } from "../db/schema";
import type { AppEnv } from "../lib/types";
import { extractJson, loadAISettings, runChat } from "../lib/ai";

// 未登录只能看 public;登录后 public + private
function visibleBookmarks(authed: boolean) {
	return authed ? undefined : eq(bookmarks.visibility, "public");
}

type CatRow = { id: number; parentId: number | null; visibility: "public" | "private" };

// 未登录时:分类及其所有祖先均为 public 才可见(私密文件夹整棵子树隐藏)
function allowedCategoryIds(cats: CatRow[], authed: boolean): Set<number> {
	if (authed) return new Set(cats.map((c) => c.id));
	const byId = new Map(cats.map((c) => [c.id, c]));
	const allowed = new Set<number>();
	for (const cat of cats) {
		let cur: CatRow | undefined = cat;
		let ok = true;
		while (cur) {
			if (cur.visibility !== "public") {
				ok = false;
				break;
			}
			cur = cur.parentId !== null ? byId.get(cur.parentId) : undefined;
		}
		if (ok) allowed.add(cat.id);
	}
	return allowed;
}

// 给书签列表附加标签名
async function attachTags<T extends { id: number }>(db: Db, rows: T[]) {
	if (rows.length === 0) return rows.map((r) => ({ ...r, tags: [] as string[] }));
	// 全量取标签关联后内存映射:避免 IN 列表超过 D1 单语句 100 个绑定变量的限制
	const links = await db
		.select({
			bookmarkId: bookmarkTags.bookmarkId,
			name: tags.name,
		})
		.from(bookmarkTags)
		.innerJoin(tags, eq(bookmarkTags.tagId, tags.id));
	const map = new Map<number, string[]>();
	for (const l of links) {
		const arr = map.get(l.bookmarkId) ?? [];
		arr.push(l.name);
		map.set(l.bookmarkId, arr);
	}
	return rows.map((r) => ({ ...r, tags: map.get(r.id) ?? [] }));
}

const bookmarkColumns = {
	id: bookmarks.id,
	title: bookmarks.title,
	url: bookmarks.url,
	description: bookmarks.description,
	icon: bookmarks.icon,
	categoryId: bookmarks.categoryId,
	sort: bookmarks.sort,
	clickCount: bookmarks.clickCount,
	isPinned: bookmarks.isPinned,
	visibility: bookmarks.visibility,
	status: bookmarks.status,
};

export const publicRoutes = new Hono<AppEnv>()
	// 站点配置(站名/Logo 等,均视为公开)
	.get("/site", async (c) => {
		const db = createDb(c.env.DB);
		const rows = await db.select().from(settings);
		return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
	})
	// AI 可用性(公开,供前端决定是否显示语义搜索入口)
	.get("/ai-config", async (c) => {
		const db = createDb(c.env.DB);
		const rows = await db
			.select({ key: settings.key, value: settings.value })
			.from(settings);
		const map = new Map(rows.map((r) => [r.key, r.value]));
		const enabled = map.get("ai.enabled") === "true";
		const semantic = map.get("ai.features.semanticSearch") === "true";
		return c.json({ aiEnabled: enabled, semanticSearch: enabled && semantic });
	})
	// 导航页数据:分类 + 书签(按登录态过滤,私密分类含子孙整体隐藏)
	.get("/bookmarks", async (c) => {
		const db = createDb(c.env.DB);
		const authed = !!c.get("user");
		const allCats = await db
			.select()
			.from(categories)
			.orderBy(asc(categories.sort), asc(categories.id));
		const allowed = allowedCategoryIds(allCats, authed);
		const cats = allCats.filter((cat) => allowed.has(cat.id));
		const rows = await db
			.select(bookmarkColumns)
			.from(bookmarks)
			.where(visibleBookmarks(authed))
			.orderBy(desc(bookmarks.isPinned), asc(bookmarks.sort), asc(bookmarks.id));
		const visible = rows.filter((b) => b.categoryId === null || allowed.has(b.categoryId));
		return c.json({
			authenticated: authed,
			categories: cats,
			bookmarks: await attachTags(db, visible),
		});
	})
	// 搜索(标题/描述/网址,按登录态过滤)
	.get(
		"/search",
		zValidator("query", z.object({ q: z.string().min(1).max(100) })),
		async (c) => {
			const db = createDb(c.env.DB);
			const authed = !!c.get("user");
			const kw = `%${c.req.valid("query").q}%`;
			const allCats = await db.select().from(categories);
			const allowed = allowedCategoryIds(allCats, authed);
			const rows = await db
				.select(bookmarkColumns)
				.from(bookmarks)
				.where(
					and(
						visibleBookmarks(authed),
						or(
							like(bookmarks.title, kw),
							like(bookmarks.description, kw),
							like(bookmarks.url, kw),
						),
					),
				)
				.orderBy(desc(bookmarks.clickCount))
				.limit(50);
			// 私密分类(含祖先私密)下的书签不可搜,与列表接口一致
			const visible = rows.filter(
				(b) => b.categoryId === null || allowed.has(b.categoryId),
			);
			return c.json({ bookmarks: await attachTags(db, visible) });
		},
	)
	// AI 语义搜索:自然语言 → 关键词扩展 → 关键词搜索
	.get(
		"/search/semantic",
		zValidator("query", z.object({ q: z.string().min(1).max(100) })),
		async (c) => {
			const db = createDb(c.env.DB);
			const aiSettings = await loadAISettings(db);
			if (!aiSettings.enabled || !aiSettings.features.semanticSearch) {
				return c.json({ error: "AI 语义搜索未启用" }, 400);
			}
			const query = c.req.valid("query").q;
			const authed = !!c.get("user");
			// 用 LLM 把自然语言转成可搜索的关键词
			const system =
				"你是一个书签搜索引擎。请把用户的自然语言查询改写成用于搜索的关键词列表(从书签的标题、描述、URL、标签里最可能命中的词)。";
			const user = `请以 JSON 数组返回 2-6 个关键词,不要包含其他内容:
["关键词1", "关键词2"]

查询: ${query}`;
			let keywords: string[] = [query];
			try {
				const raw = await runChat(
					c.env,
					aiSettings,
					[
						{ role: "system", content: system },
						{ role: "user", content: user },
					],
					"semanticSearch",
					db,
				);
				const parsed = extractJson<{ keywords?: string[] } | string[]>(raw);
				const list = Array.isArray(parsed) ? parsed : parsed.keywords ?? [];
				if (list.length) keywords = list.filter(Boolean);
			} catch {
				// 转换失败则直接使用原始查询
			}
			// 关键词 OR 匹配,优先同时命中多个词的
			const allCats = await db.select().from(categories);
			const allowed = allowedCategoryIds(allCats, authed);
			const rows = await db
				.select(bookmarkColumns)
				.from(bookmarks)
				.where(visibleBookmarks(authed))
				.orderBy(desc(bookmarks.clickCount));
			const tagged = await attachTags(db, rows);
			const needle = keywords.map((k) => k.toLowerCase());
			const scored = tagged
				.map((b) => {
					const hay = [b.title, b.description ?? "", b.url, ...b.tags]
						.join(" ")
						.toLowerCase();
					const hits = needle.filter((k) => hay.includes(k)).length;
					return { b, hits };
				})
				.filter((x) => x.hits > 0)
				.sort((a, b) => b.hits - a.hits)
				.map((x) => x.b)
				.filter((b) => b.categoryId === null || allowed.has(b.categoryId))
				.slice(0, 50);
			return c.json({ bookmarks: scored });
		},
	)
	// 点击计数上报
	.post(
		"/bookmarks/:id/click",
		zValidator("param", z.object({ id: z.coerce.number().int() })),
		async (c) => {
			const db = createDb(c.env.DB);
			await db
				.update(bookmarks)
				.set({ clickCount: sql`${bookmarks.clickCount} + 1` })
				.where(eq(bookmarks.id, c.req.valid("param").id));
			return c.json({ ok: true });
		},
	);
