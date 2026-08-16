# Bookmark Nav

多功能简洁书签导航站。前台是一个干净的公开导航页,后台提供完整的书签管理能力,数据完全存放在你自己的 Cloudflare 账号里。

## 功能特性

- 📌 **前台导航页**:分类分组展示、置顶、点击计数、实时搜索、深色/浅色/跟随系统主题
- 🗂 **多级分类**:分类无限嵌套,支持拖拽排序、批量删除(级联)
- 🔒 **私密书签**:书签和分类均可设为私密,仅登录后可见;私密分类整棵子树对外隐藏
- 📥 **导入导出**:兼容 Chrome / Edge / Firefox 的 HTML 书签格式,多级文件夹结构完整保留
- 🔗 **死链检测**:后台一键批量检测失效书签,支持筛选和批量清理
- ✂️ **批量操作**:书签批量移动分类、批量删除;分类多选全选
- 🏷 **标签**:书签支持多标签,搜索时一并匹配
- 📱 **移动端适配**:前后台均适配小屏幕

## 浏览器插件

Bookmark Nav 配套浏览器插件，支持一键将当前页面保存到你的 Bookmark Nav 书签库。

### 功能

- 点击插件图标弹出面板，快速添加当前页面为书签
- 自动填充标题、URL、页面图标
- 支持选择分类和设置公开/私密可见性
- 与 Bookmark Nav 后端无缝配合，通过 Cookie 认证

### 安装

1. 下载插件包：[bookmark-nav-extension-v2.0.0.zip](./extension/bookmark-nav-extension-v2.0.0.zip) 并解压到本地目录
2. 打开 Chrome/Edge 浏览器，进入 `chrome://extensions`（或 `edge://extensions`）
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择解压后的文件夹
5. 点击插件图标，在弹出面板中登录你的 Bookmark Nav 账号即可使用

> 插件通过 `credentials: 'include'` 自动携带认证 Cookie，无需手动配置 Token。

## 部署

1. 点击本仓库右上角 **Fork**
2. 在 [Cloudflare 控制台](https://dash.cloudflare.com) → **存储和数据库 → D1** → 创建数据库(名称随意,如 `bookmark-nav-db`),复制其**数据库 ID**
3. 控制台 → **Workers 和 Pages → 创建 → 导入存储库**,选择你 fork 的仓库,构建配置(下面都要填,不能留默认值):
   - 构建命令:`npm run build`
   - 部署命令:`npm run deploy`
   - 构建变量 `D1_DATABASE_ID`:值为第 2 步复制的数据库 ID
   - 构建变量 `JWT_SECRET`:登录会话签名密钥,填随机长字符串(可用 `openssl rand -hex 32` 生成),建议勾选“加密”
4. 访问 Worker 域名,首次打开会引导你创建管理员账号

> 为什么 `JWT_SECRET` 放在**构建变量**而不是 Worker 的“变量和机密”:通过 GitHub 集成部署时,每次 `wrangler deploy` 会清空面板上手动添加的机密([cloudflare/workers-sdk#8871](https://github.com/cloudflare/workers-sdk/issues/8871)),导致登录报错;放在构建变量则会在构建时自动注入,每次部署都带上,永不丢失。

> Fork 部署不需要修改仓库里的任何文件(配置均通过构建变量在部署时自动注入),你的 fork 与本仓库永远保持零差异,因此可以随时用 GitHub 的 **Sync fork** 按钮一键同步新版本。

## 更新版本

在你 fork 的仓库页面点 **Sync fork → Update branch**,同步后 Cloudflare 自动重新构建部署,完成。



> 注意:`deploy` 脚本中的 `db:migrate` 使用的库名(`bookmark-nav-db`)与 `wrangler.json` 的 `database_name` 保持一致。若你改过该名称,请相应调整命令中的库名。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入任意 JWT_SECRET
npx wrangler d1 migrations apply DB --local
npm run dev                      # http://localhost:5173
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 · Vite · TanStack Query · shadcn/ui · Tailwind CSS v4 |
| 后端 | Hono(RPC 模式,前后端类型共享) |
| 数据库 | Cloudflare D1(SQLite)+ Drizzle ORM |
| 部署 | Cloudflare Workers(静态资源 + API 同一 Worker) |

后端仅依赖标准 Web API 与 SQLite,如需迁移到自托管环境(Node + SQLite/Postgres),只需替换 D1 绑定与部署配置。

## 许可证

[GPL-3.0](./LICENSE)
