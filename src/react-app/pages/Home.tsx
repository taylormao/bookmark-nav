import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Lock, Pin, Search, Settings, LogOut, User, Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	client,
	bookmarkIcon,
	flattenCategoryTree,
	type Bookmark,
	type Category,
} from "@/lib/api";
import { useAuthStatus, useLogout, useNavData, useSiteSettings, useAISearchConfig } from "@/lib/queries";

function BookmarkCard({ bookmark }: { bookmark: Bookmark }) {
	const icon = bookmarkIcon(bookmark);
	return (
		<a
			href={bookmark.url}
			target="_blank"
			rel="noreferrer"
			onClick={() => {
				// 点击计数上报,不阻塞跳转
				void client.api.public.bookmarks[":id"].click.$post({
					param: { id: String(bookmark.id) },
				});
			}}
			className="group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
		>
			<div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
				{icon ? (
					<img
						src={icon}
						alt=""
						className="size-6"
						loading="lazy"
						onError={(e) => {
							e.currentTarget.style.display = "none";
						}}
					/>
				) : (
					<Globe className="size-5 text-muted-foreground" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate font-medium group-hover:text-primary">
						{bookmark.title}
					</span>
					{bookmark.isPinned && <Pin className="size-3.5 shrink-0 text-amber-500" />}
					{bookmark.visibility === "private" && (
						<Lock className="size-3.5 shrink-0 text-muted-foreground" />
					)}
				</div>
				{bookmark.description && (
					<p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
						{bookmark.description}
					</p>
				)}
				{bookmark.tags.length > 0 && (
					<div className="mt-1.5 flex flex-wrap gap-1">
						{bookmark.tags.map((t) => (
							<Badge key={t} variant="secondary" className="px-1.5 py-0 text-xs">
								{t}
							</Badge>
						))}
					</div>
				)}
			</div>
		</a>
	);
}

export default function Home() {
	const { data: auth } = useAuthStatus();
	const { data, isLoading, isError } = useNavData();
	const { data: site } = useSiteSettings();
	const { data: aiConfig } = useAISearchConfig();
	const logout = useLogout();
	const [keyword, setKeyword] = useState("");
	const [aiSearch, setAiSearch] = useState(false);
	const [aiResults, setAiResults] = useState<Bookmark[] | null>(null);
	const [aiLoading, setAiLoading] = useState(false);

	const siteName = site?.siteName || "书签导航";

	// AI 语义搜索(请求后端 /api/public/search/semantic)
	async function runAISearch(q: string) {
		if (!q.trim() || !aiConfig?.semanticSearch) return;
		setAiLoading(true);
		try {
			const res = await client.api.public["search"].semantic.$get({ query: { q } });
			if (res.ok) {
				const body = (await res.json()) as { bookmarks: Bookmark[] };
				setAiResults(body.bookmarks);
			} else {
				setAiResults(null);
			}
		} catch {
			setAiResults(null);
		} finally {
			setAiLoading(false);
		}
	}

	// 关闭 AI 或清空关键词时回到本地过滤
	useEffect(() => {
		if (!aiSearch || !keyword.trim()) setAiResults(null);
	}, [aiSearch, keyword]);

	// 实际展示结果:AI 搜索优先,否则本地过滤
	const displayBookmarks = aiResults ?? (data?.bookmarks ?? []);
	const aiActive = aiSearch && aiResults !== null;

	// 分类树按深度优先拍平成小节,子分类标题显示父级路径前缀(超过两级省略为 … / 上级)
	const grouped = useMemo(() => {
		const flat = flattenCategoryTree(data?.categories ?? []);
		const groups: {
			category: Category | null;
			parentPath: string;
			items: Bookmark[];
		}[] = flat.map(({ category, path }) => {
			const segments = path.split(" / ").slice(0, -1);
			return {
				category,
				parentPath:
					segments.length > 2
						? `… / ${segments[segments.length - 1]}`
						: segments.join(" / "),
				items: [],
			};
		});
		const uncategorized: Bookmark[] = [];
		const byId = new Map(groups.map((g) => [g.category!.id, g]));
		for (const b of displayBookmarks) {
			const g = b.categoryId !== null ? byId.get(b.categoryId) : undefined;
			if (g) g.items.push(b);
			else uncategorized.push(b);
		}
		if (uncategorized.length > 0)
			groups.push({ category: null, parentPath: "", items: uncategorized });
		return groups.filter((g) => g.items.length > 0);
	}, [data, displayBookmarks]);

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-x-3 px-4">
					<Link to="/" className="shrink-0 text-lg font-bold">
						{siteName}
					</Link>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{auth?.authenticated ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="icon" aria-label="账户菜单">
										<User className="size-4.5" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem asChild>
										<Link to="/admin">
											<Settings className="size-4" /> 后台管理
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => logout.mutate()}>
										<LogOut className="size-4" /> 退出登录
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : (
							<Button variant="ghost" size="sm" asChild>
								<Link to="/login">登录</Link>
							</Button>
						)}
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 py-8">
				{/* 搜索区:独立于 header,整体居中且限制宽度,语义上更聚焦 */}
				<div className="mx-auto mb-8 flex max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center">
					<div className="relative flex-1">
						<Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={keyword}
							onChange={(e) => {
								const v = e.target.value;
								setKeyword(v);
								if (aiSearch && v.trim()) void runAISearch(v);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" && aiSearch && keyword.trim())
									void runAISearch(keyword);
							}}
							placeholder={aiSearch ? "用自然语言搜索,如「CSS 工具」…" : "搜索书签…"}
							className="pl-9"
						/>
						{aiLoading && (
							<Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
						)}
					</div>
					{aiConfig?.semanticSearch && (
						<div className="flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/30 px-3 py-2">
							<Sparkles
								className={`size-4 ${aiSearch ? "text-orange-500" : "text-muted-foreground"}`}
							/>
							<Switch
								checked={aiSearch}
								onCheckedChange={setAiSearch}
								aria-label="AI 语义搜索"
							/>
							<span className="text-xs text-muted-foreground">AI 语义</span>
						</div>
					)}
				</div>
				{isLoading && (
					<p className="py-20 text-center text-muted-foreground">加载中…</p>
				)}
				{isError && (
					<p className="py-20 text-center text-destructive">加载失败,请刷新重试</p>
				)}
				{grouped.map(({ category, parentPath, items }) => (
					<section key={category?.id ?? "uncategorized"} className="mb-10">
						<h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
							{category?.icon && <span>{category.icon}</span>}
							{parentPath && (
								<span className="font-normal text-muted-foreground">
									{parentPath} /
								</span>
							)}
							{category?.name ?? "未分类"}
							{category?.visibility === "private" && (
								<Lock className="size-3.5 text-muted-foreground" />
							)}
							<span className="text-sm font-normal text-muted-foreground">
								{items.length}
							</span>
						</h2>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{items.map((b) => (
								<BookmarkCard key={b.id} bookmark={b} />
							))}
						</div>
					</section>
				))}
				{!isLoading && !isError && grouped.length === 0 && (
					<p className="py-20 text-center text-muted-foreground">
						{aiActive
							? "AI 没有找到相关书签,换个说法试试?"
							: keyword
								? "没有匹配的书签"
								: "还没有书签,登录后台添加吧"}
					</p>
				)}
			</main>
			{site?.footer && (
				<footer className="border-t py-6 text-center text-sm text-muted-foreground">
					{site.footer}
				</footer>
			)}
		</div>
	);
}
