import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
	DndContext,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, HeartPulse, Lock, Pencil, Pin, Plus, Trash2, Wand2, Globe } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { bookmarkIcon, flattenCategoryTree, type Bookmark, type Category } from "@/lib/api";
import { ConfirmDialog, type ConfirmState } from "@/components/confirm-dialog";
import {
	useAdminBookmarks,
	useAdminCategories,
	useAdminSettings,
	useBatchDeleteBookmarks,
	useBatchMoveBookmarks,
	useCheckDeadLinks,
	useDeleteBookmark,
	useFetchMetadata,
	useFetchMetadataAI,
	useReorderBookmarks,
	useRepairLink,
	useSummarize,
	useSaveBookmark,
	type BookmarkPayload,
} from "@/lib/admin-queries";

// 编辑/新建书签表单弹窗
function BookmarkDialog({
	bookmark,
	categories,
	open,
	onOpenChange,
	aiEnabled,
	aiAutoFill,
}: {
	bookmark: Bookmark | null;
	categories: Category[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	aiEnabled: boolean;
	aiAutoFill: boolean;
}) {
	const save = useSaveBookmark();
	const fetchMeta = useFetchMetadata();
	const fetchMetaAI = useFetchMetadataAI();
	const [form, setForm] = useState<BookmarkPayload>({ title: "", url: "" });
	const flatCats = flattenCategoryTree(categories);

	// 弹窗打开时同步表单初始值(open 由父组件控制,不能依赖 onOpenChange 回调)
	useEffect(() => {
		if (!open) return;
		setForm(
			bookmark
				? {
						title: bookmark.title,
						url: bookmark.url,
						description: bookmark.description,
						icon: bookmark.icon,
						categoryId: bookmark.categoryId,
						isPinned: bookmark.isPinned,
						visibility: bookmark.visibility,
						tags: bookmark.tags,
					}
				: { title: "", url: "", visibility: "public" },
		);
	}, [open, bookmark]);

	async function handleFetchMeta() {
		if (!form.url) return;
		const meta = await fetchMeta.mutateAsync(form.url);
		setForm((f) => ({
			...f,
			title: f.title || meta.title || "",
			description: f.description || meta.description,
			icon: f.icon || meta.icon,
		}));
	}

	async function handleFetchMetaAI() {
		if (!form.url) return;
		const meta = await fetchMetaAI.mutateAsync(form.url);
		setForm((f) => ({
			...f,
			title: f.title || meta.title || "",
			description: f.description || meta.description,
			icon: f.icon || meta.icon,
			tags: f.tags?.length ? f.tags : meta.tags,
			categoryId: f.categoryId != null ? f.categoryId : (meta.categoryId ?? null),
		}));
	}


	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		await save.mutateAsync({ id: bookmark?.id, data: form });
		onOpenChange(false);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{bookmark ? "编辑书签" : "新建书签"}</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="bm-url">网址</Label>
						<div className="flex gap-2">
							<Input
								id="bm-url"
								type="url"
								value={form.url}
								onChange={(e) => setForm({ ...form, url: e.target.value })}
								placeholder="https://…"
								required
							/>
							{aiEnabled && aiAutoFill && (
								<Button
									type="button"
									onClick={handleFetchMetaAI}
									disabled={!form.url || fetchMetaAI.isPending}
									title="使用 AI 智能提取标题、描述、标签和图标"
								>
									<Wand2 className="size-4" />
									{fetchMetaAI.isPending ? "AI 分析中…" : "AI 填充"}
								</Button>
							)}
							<Button
								type="button"
								variant="outline"
								onClick={handleFetchMeta}
								disabled={!form.url || fetchMeta.isPending}
								title="自动抓取标题/描述/图标"
							>
								<Globe className="size-4" />
								{fetchMeta.isPending ? "抓取中…" : "抓取"}
							</Button>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="bm-title">标题</Label>
						<Input
							id="bm-title"
							value={form.title}
							onChange={(e) => setForm({ ...form, title: e.target.value })}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="bm-desc">描述</Label>
						<Textarea
							id="bm-desc"
							value={form.description ?? ""}
							onChange={(e) => setForm({ ...form, description: e.target.value })}
							rows={2}
							/>
							</div>
							<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
							<Label>分类</Label>
							<Select
								value={form.categoryId != null ? String(form.categoryId) : "none"}
								onValueChange={(v) =>
									setForm({ ...form, categoryId: v === "none" ? null : Number(v) })
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">未分类</SelectItem>
									{flatCats.map(({ category: c, path }) => (
										<SelectItem key={c.id} value={String(c.id)}>
											{path}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							</div>
							<div className="space-y-2">
							<Label htmlFor="bm-tags">标签(逗号分隔)</Label>
							<Input
								id="bm-tags"
								value={(form.tags ?? []).join(", ")}
								onChange={(e) =>
									setForm({
										...form,
										tags: e.target.value
											.split(/[,，]/)
											.map((t) => t.trim())
											.filter(Boolean),
									})
								}
								placeholder="工具, 文档"
							/>
							</div>
							</div>
					<div className="space-y-2">
						<Label htmlFor="bm-icon">图标地址(留空自动取 favicon)</Label>
						<Input
							id="bm-icon"
							value={form.icon ?? ""}
							onChange={(e) => setForm({ ...form, icon: e.target.value || null })}
						/>
					</div>
					<div className="flex items-center gap-6">
						<label className="flex items-center gap-2 text-sm">
							<Switch
								checked={form.visibility === "private"}
								onCheckedChange={(v) =>
									setForm({ ...form, visibility: v ? "private" : "public" })
								}
							/>
							私密(仅登录可见)
						</label>
						<label className="flex items-center gap-2 text-sm">
							<Switch
								checked={!!form.isPinned}
								onCheckedChange={(v) => setForm({ ...form, isPinned: v })}
							/>
							置顶
						</label>
					</div>
					<div className="flex justify-end gap-2">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							取消
						</Button>
						<Button type="submit" disabled={save.isPending}>
							{save.isPending ? "保存中…" : "保存"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// 可拖拽的表格行
function SortableRow({
	bookmark,
	categoryName,
	selected,
	onToggleSelect,
	onEdit,
	onDelete,
	onRepair,
	aiDeadLinkRepair,
	repairPending,
	onSummarize,
	aiSummary,
	summarizePending,
}: {
	bookmark: Bookmark;
	categoryName: string;
	selected: boolean;
	onToggleSelect: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onRepair: () => void;
	aiDeadLinkRepair: boolean;
	repairPending: boolean;
	onSummarize: () => void;
	aiSummary: boolean;
	summarizePending: boolean;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: bookmark.id });
	const icon = bookmarkIcon(bookmark);
	return (
		<TableRow
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={isDragging ? "relative z-10 bg-muted" : undefined}
		>
			<TableCell className="w-8">
				<Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label="选择" />
			</TableCell>
			<TableCell className="w-8 cursor-grab" {...attributes} {...listeners}>
				<GripVertical className="size-4 text-muted-foreground" />
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-2">
					{icon && (
						<img
							src={icon}
							alt=""
							className="size-4 shrink-0"
							onError={(e) => {
								e.currentTarget.style.display = "none";
							}}
						/>
					)}
					<span className="max-w-52 truncate font-medium">{bookmark.title}</span>
					{bookmark.status === "dead" && (
						<Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-xs">
							死链
						</Badge>
					)}
					{bookmark.isPinned && <Pin className="size-3.5 shrink-0 text-amber-500" />}
					{bookmark.visibility === "private" && (
						<Lock className="size-3.5 shrink-0 text-muted-foreground" />
					)}
				</div>
				<div className="max-w-72 truncate text-xs text-muted-foreground">
					{bookmark.url}
				</div>
			</TableCell>
			<TableCell>{categoryName}</TableCell>
			<TableCell>
				<div className="flex max-w-40 flex-wrap gap-1">
					{bookmark.tags.map((t) => (
						<Badge key={t} variant="secondary" className="px-1.5 py-0 text-xs">
							{t}
						</Badge>
					))}
				</div>
			</TableCell>
			<TableCell className="text-center">{bookmark.clickCount}</TableCell>
			<TableCell>
				<div className="flex justify-end gap-1">
					{aiSummary && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onSummarize}
							disabled={summarizePending}
							aria-label="AI 摘要"
							title="使用 AI 生成内容摘要"
						>
							<Wand2 className="size-4 text-sky-500" />
						</Button>
					)}
					{bookmark.status === "dead" && aiDeadLinkRepair && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRepair}
							disabled={repairPending}
							aria-label="AI 修复"
							title="使用 AI 推断替代链接"
						>
							<Wand2 className="size-4 text-orange-500" />
						</Button>
					)}
					<Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="编辑">
						<Pencil className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-destructive"
						onClick={onDelete}
						aria-label="删除"
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</TableCell>
		</TableRow>
	);
}

export default function AdminBookmarks() {
	const { data, isLoading } = useAdminBookmarks();
	const { data: catData } = useAdminCategories();
	const { data: settings } = useAdminSettings();
	const del = useDeleteBookmark();
	const reorder = useReorderBookmarks();
	const batchMove = useBatchMoveBookmarks();
	const batchDel = useBatchDeleteBookmarks();
	const checkLinks = useCheckDeadLinks();
	const repairLink = useRepairLink();
	const summarize = useSummarize();
	const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(
		null,
	);
	const [repairResult, setRepairResult] = useState<{
		title: string;
		url: string;
		alternative: string | null;
		wayback: string;
		reason: string;
	} | null>(null);
	const [summaryResult, setSummaryResult] = useState<{
		title: string;
		url: string;
		summary: string;
	} | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<Bookmark | null>(null);
	const [filterCat, setFilterCat] = useState<string>("all");
	const [onlyDead, setOnlyDead] = useState(false);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

	const categories: Category[] = catData?.categories ?? [];
	// 拍平分类树,下拉框/表格里展示完整路径
	const flatCats = useMemo(() => flattenCategoryTree(categories), [categories]);
	const catName = useMemo(
		() => new Map(flatCats.map(({ category: c, path }) => [c.id, path])),
		[flatCats],
	);

	const bookmarks: Bookmark[] = useMemo(() => {
		let all = (data?.bookmarks ?? []) as Bookmark[];
		if (onlyDead) all = all.filter((b) => b.status === "dead");
		if (filterCat === "all") return all;
		if (filterCat === "none") return all.filter((b) => b.categoryId === null);
		return all.filter((b) => b.categoryId === Number(filterCat));
	}, [data, filterCat, onlyDead]);

	const deadCount = useMemo(
		() => ((data?.bookmarks ?? []) as Bookmark[]).filter((b) => b.status === "dead").length,
		[data],
	);

	// 分批检测全部书签,进度实时显示在按钮上
	function handleCheckLinks() {
		const ids = ((data?.bookmarks ?? []) as Bookmark[]).map((b) => b.id);
		if (ids.length === 0 || checkLinks.isPending) return;
		setCheckProgress({ done: 0, total: ids.length });
		checkLinks.mutate(
			{ ids, onProgress: (done, total) => setCheckProgress({ done, total }) },
			{ onSettled: () => setCheckProgress(null) },
		);
	}

	async function handleRepair(b: Bookmark) {
		const r = await repairLink.mutateAsync({ title: b.title, url: b.url });
		setRepairResult({ title: b.title, url: b.url, ...r });
	}

	async function handleSummarize(b: Bookmark) {
		const r = await summarize.mutateAsync({
			title: b.title,
			description: b.description ?? undefined,
			url: b.url,
		});
		setSummaryResult({ title: b.title, url: b.url, summary: r.summary });
	}

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);

	// 当前筛选结果中已选中的数量,表头全选框据此展示全选/半选
	const selectedInView = bookmarks.filter((b) => selected.has(b.id)).length;

	function toggleSelect(id: number) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// 全选/取消全选仅作用于当前筛选结果
	function toggleSelectAll() {
		setSelected((prev) => {
			const next = new Set(prev);
			if (selectedInView === bookmarks.length) {
				for (const b of bookmarks) next.delete(b.id);
			} else {
				for (const b of bookmarks) next.add(b.id);
			}
			return next;
		});
	}

	function handleBatchMove(v: string) {
		batchMove.mutate(
			{ ids: [...selected], categoryId: v === "none" ? null : Number(v) },
			{ onSuccess: () => setSelected(new Set()) },
		);
	}

	function handleBatchDelete() {
		setConfirmState({
			title: `确定删除选中的 ${selected.size} 个书签?`,
			description: "删除后不可恢复",
			onConfirm: () =>
				batchDel.mutate([...selected], { onSuccess: () => setSelected(new Set()) }),
		});
	}

	function handleDragEnd(e: DragEndEvent) {
		const { active, over } = e;
		if (!over || active.id === over.id) return;
		const oldIndex = bookmarks.findIndex((b) => b.id === active.id);
		const newIndex = bookmarks.findIndex((b) => b.id === over.id);
		const next = arrayMove(bookmarks, oldIndex, newIndex);
		reorder.mutate(next.map((b) => b.id));
	}

	return (
		<div className="mx-auto max-w-5xl">
			{/* 操作工具栏 */}
			<div className="mb-4 flex flex-wrap items-center justify-end gap-3">
				<div className="flex flex-wrap items-center gap-2">
					{deadCount > 0 && (
						<Button
							variant={onlyDead ? "destructive" : "outline"}
							size="sm"
							onClick={() => setOnlyDead((v) => !v)}
						>
							死链 {deadCount}
						</Button>
					)}
					<Button
						variant="outline"
						onClick={handleCheckLinks}
						disabled={checkLinks.isPending || isLoading}
					>
						<HeartPulse className="size-4" />
						{checkProgress ? "检测中…" : "死链检测"}
					</Button>
					<Select value={filterCat} onValueChange={setFilterCat}>
						<SelectTrigger className="w-36">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">全部分类</SelectItem>
							<SelectItem value="none">未分类</SelectItem>
							{flatCats.map(({ category: c, path }) => (
								<SelectItem key={c.id} value={String(c.id)}>
									{path}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Dialog>
						<DialogTrigger asChild>
							<Button
								onClick={() => {
									setEditing(null);
									setDialogOpen(true);
								}}
							>
								<Plus className="size-4" /> 新建书签
							</Button>
						</DialogTrigger>
					</Dialog>
				</div>
			</div>

			{/* 批量操作栏:有选中时显示 */}
			{selected.size > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-4 py-2">
					<span className="text-sm font-medium">已选 {selected.size} 项</span>
					<Select value="" onValueChange={handleBatchMove}>
						<SelectTrigger className="h-8 w-40" disabled={batchMove.isPending}>
							<SelectValue placeholder="移动到分类…" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">未分类</SelectItem>
							{flatCats.map(({ category: c, path }) => (
								<SelectItem key={c.id} value={String(c.id)}>
									{path}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						variant="destructive"
						size="sm"
						onClick={handleBatchDelete}
						disabled={batchDel.isPending}
					>
						<Trash2 className="size-4" />
						{batchDel.isPending ? "删除中…" : "删除"}
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
						取消选择
					</Button>
				</div>
			)}

			{/* 死链检测进度条 */}
			{checkProgress && (
				<div className="mb-4 flex items-center gap-3 rounded-xl border bg-background px-4 py-3">
					<Progress
						value={(checkProgress.done / checkProgress.total) * 100}
						className="flex-1"
					/>
					<span className="shrink-0 text-sm tabular-nums text-muted-foreground">
						{checkProgress.done}/{checkProgress.total}
					</span>
				</div>
			)}

			<div className="rounded-xl border bg-background">
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8">
									<Checkbox
										checked={
											bookmarks.length > 0 && selectedInView === bookmarks.length
												? true
												: selectedInView > 0
													? "indeterminate"
													: false
										}
										onCheckedChange={toggleSelectAll}
										aria-label="全选"
									/>
								</TableHead>
								<TableHead className="w-8" />
								<TableHead>书签</TableHead>
								<TableHead>分类</TableHead>
								<TableHead>标签</TableHead>
								<TableHead className="text-center">点击</TableHead>
								<TableHead className="text-right">操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<SortableContext
								items={bookmarks.map((b) => b.id)}
								strategy={verticalListSortingStrategy}
							>
								{bookmarks.map((b) => (
									<SortableRow
										key={b.id}
										bookmark={b}
										selected={selected.has(b.id)}
										onToggleSelect={() => toggleSelect(b.id)}
										categoryName={
											b.categoryId !== null
												? (catName.get(b.categoryId) ?? "-")
												: "未分类"
										}
										onEdit={() => {
											setEditing(b);
											setDialogOpen(true);
										}}
										onDelete={() => {
											setConfirmState({
												title: `确定删除「${b.title}」?`,
												description: "删除后不可恢复",
												onConfirm: () => del.mutate(b.id),
											});
										}}
										onRepair={() => handleRepair(b)}
										aiDeadLinkRepair={
											settings?.["ai.enabled"] === "true" &&
											settings?.["ai.features.deadLinkRepair"] === "true"
										}
										repairPending={repairLink.isPending}
										onSummarize={() => handleSummarize(b)}
										aiSummary={
											settings?.["ai.enabled"] === "true" &&
											settings?.["ai.features.summary"] === "true"
										}
										summarizePending={summarize.isPending}
									/>
								))}
							</SortableContext>
						</TableBody>
					</Table>
				</DndContext>
				{isLoading && (
					<p className="py-10 text-center text-muted-foreground">加载中…</p>
				)}
				{!isLoading && bookmarks.length === 0 && (
					<p className="py-10 text-center text-muted-foreground">暂无书签</p>
				)}
			</div>

			<BookmarkDialog
				bookmark={editing}
				categories={categories}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				aiEnabled={settings?.["ai.enabled"] === "true"}
				aiAutoFill={settings?.["ai.features.autoFill"] === "true"}
			/>
			<ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

			<Dialog open={repairResult !== null} onOpenChange={(o) => !o && setRepairResult(null)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>AI 死链修复建议</DialogTitle>
					</DialogHeader>
					{repairResult && (
						<div className="space-y-3 text-sm">
							<div>
								<span className="text-muted-foreground">标题：</span>
								{repairResult.title}
							</div>
							<div>
								<span className="text-muted-foreground">原链接：</span>
								<span className="break-all">{repairResult.url}</span>
							</div>
							<div>
								<span className="text-muted-foreground">AI 建议替代：</span>
								{repairResult.alternative ? (
									<a
										href={repairResult.alternative}
										target="_blank"
										rel="noreferrer"
										className="break-all text-primary underline"
									>
										{repairResult.alternative}
									</a>
								) : (
									<span className="text-muted-foreground">未找到</span>
								)}
							</div>
							<div>
								<span className="text-muted-foreground">存档链接：</span>
								<a
									href={repairResult.wayback}
									target="_blank"
									rel="noreferrer"
									className="break-all text-primary underline"
								>
									{repairResult.wayback}
								</a>
							</div>
							{repairResult.reason && (
								<p className="text-muted-foreground">{repairResult.reason}</p>
							)}
							<div className="flex justify-end gap-2 pt-1">
								<Button variant="outline" onClick={() => setRepairResult(null)}>
									关闭
								</Button>
								{repairResult.alternative && (
									<Button
										onClick={() => {
											if (editing && editing.url === repairResult.url) {
												// 若该死链正在编辑,直接回填
											}
											navigator.clipboard?.writeText(repairResult.alternative!);
											toast.success("已复制替代链接");
										}}
									>
										复制替代链接
									</Button>
								)}
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			<Dialog
				open={summaryResult !== null}
				onOpenChange={(o) => !o && setSummaryResult(null)}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>AI 内容摘要</DialogTitle>
					</DialogHeader>
					{summaryResult && (
						<div className="space-y-3 text-sm">
							<div>
								<span className="text-muted-foreground">标题：</span>
								{summaryResult.title}
							</div>
							<div>
								<span className="text-muted-foreground">链接：</span>
								<span className="break-all">{summaryResult.url}</span>
							</div>
							<div className="rounded-lg border bg-muted/50 p-3">
								{summaryResult.summary}
							</div>
							<div className="flex justify-end gap-2 pt-1">
								<Button variant="outline" onClick={() => setSummaryResult(null)}>
									关闭
								</Button>
								<Button
									onClick={() => {
										navigator.clipboard?.writeText(summaryResult.summary);
										toast.success("已复制摘要");
									}}
								>
									复制摘要
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
