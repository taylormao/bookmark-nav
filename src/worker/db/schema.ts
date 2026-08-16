import { sql } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// 管理员用户(单用户模型,建表便于扩展)
export const users = sqliteTable("users", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	username: text("username").notNull().unique(),
	passwordHash: text("password_hash").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

// 分类(支持任意层级嵌套,parentId 为 null 表示顶级)
export const categories = sqliteTable("categories", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	icon: text("icon"),
	parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id, {
		onDelete: "cascade",
	}),
	sort: integer("sort").notNull().default(0),
	// public: 所有人可见; private: 登录后可见
	visibility: text("visibility", { enum: ["public", "private"] })
		.notNull()
		.default("public"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

// 书签
export const bookmarks = sqliteTable("bookmarks", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	title: text("title").notNull(),
	url: text("url").notNull(),
	description: text("description"),
	icon: text("icon"),
	categoryId: integer("category_id").references(() => categories.id, {
		onDelete: "set null",
	}),
	sort: integer("sort").notNull().default(0),
	clickCount: integer("click_count").notNull().default(0),
	isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
	// public: 所有人可见; private: 登录后可见
	visibility: text("visibility", { enum: ["public", "private"] })
		.notNull()
		.default("public"),
	// active: 正常; dead: 死链检测标记失效
	status: text("status", { enum: ["active", "dead"] })
		.notNull()
		.default("active"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

// 标签
export const tags = sqliteTable("tags", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull().unique(),
});

// 书签-标签 多对多
export const bookmarkTags = sqliteTable(
	"bookmark_tags",
	{
		bookmarkId: integer("bookmark_id")
			.notNull()
			.references(() => bookmarks.id, { onDelete: "cascade" }),
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.bookmarkId, t.tagId] })],
);

// 站点配置(key-value)
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

// AI 调用用量记录(免费额度防刷 + 自定义 API 防滥用)
export const aiUsage = sqliteTable("ai_usage", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	feature: text("feature").notNull(),
	provider: text("provider").notNull(),
	success: integer("success").notNull(),
	durationMs: integer("duration_ms"),
	error: text("error"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});
