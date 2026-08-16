import { useEffect, useState, type FormEvent } from "react";
import { Sparkles, Eye, EyeOff, FlaskConical, Zap, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAdminSettings, useSaveSettings, useAIUsage, useTestAI } from "@/lib/admin-queries";

// 今日免费额度软上限(仅展示预警,不拦截). Workers AI 免费版每日调用上限有限,接近时提醒
const DAILY_SOFT_LIMIT = 1000;

// 内置 Workers AI 默认模型(作为占位符,用户可自定义其它模型 id)
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

// Cloudflare Workers AI 模型列表,供用户查找可用的 model id
const WORKERS_AI_MODELS_URL = "https://developers.cloudflare.com/workers-ai/models/";

// 埋点 feature 名 -> 中文标签
const FEATURE_LABELS: Record<string, string> = {
	autoFill: "自动填充",
	tagSuggest: "标签推荐",
	semanticSearch: "语义搜索",
	summary: "内容摘要",
	autoCategorize: "自动分类",
	deadLinkRepair: "死链修复",
};

// 模型输入框(内置 / 自定义共用)
function ModelField({
	model,
	onModelChange,
	placeholder,
	disabled,
}: {
	model: string;
	onModelChange: (v: string) => void;
	placeholder: string;
	disabled: boolean;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor="ai-model">模型名称</Label>
			<Input
				id="ai-model"
				value={model}
				onChange={(e) => onModelChange(e.target.value)}
				placeholder={placeholder}
				disabled={disabled}
			/>
		</div>
	);
}

const FEATURES = [
	{
		key: "ai.features.autoFill",
		label: "自动填充书签信息",
		description: "输入 URL 时自动抓取并补全标题、描述和图标",
	},
	{
		key: "ai.features.tagSuggest",
		label: "智能标签推荐",
		description: "保存书签后根据内容自动推荐标签",
	},
	{
		key: "ai.features.semanticSearch",
		label: "语义搜索",
		description: "用自然语言搜索书签，如「找 CSS 工具」",
	},
	{
		key: "ai.features.summary",
		label: "内容摘要",
		description: "为书签自动生成一句话中文摘要",
	},
	{
		key: "ai.features.autoCategorize",
		label: "自动分类",
		description: "添加书签时推荐最合适的分类",
	},
	{
		key: "ai.features.deadLinkRepair",
		label: "死链修复",
		description: "为失效链接推断替代地址或存档",
	},
];

export default function AdminAI() {
	const { data, isLoading } = useAdminSettings();
	const save = useSaveSettings();
	const { data: usage, isLoading: usageLoading } = useAIUsage();
	const testAI = useTestAI();

	const [enabled, setEnabled] = useState(false);
	const [provider, setProvider] = useState<"builtin" | "custom">("builtin");
	const [apiEndpoint, setApiEndpoint] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [features, setFeatures] = useState<Record<string, boolean>>({});

	useEffect(() => {
		if (data) {
			setEnabled(data["ai.enabled"] === "true");
			setProvider((data["ai.provider"] as "builtin" | "custom") ?? "builtin");
			setApiEndpoint(data["ai.apiEndpoint"] ?? "");
			setApiKey(data["ai.apiKey"] ?? "");
			setModel(data["ai.model"] ?? "");
			const f: Record<string, boolean> = {};
			for (const feat of FEATURES) {
				f[feat.key] = data[feat.key] === "true";
			}
			setFeatures(f);
		}
	}, [data]);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const payload: Record<string, string> = {
			"ai.enabled": String(enabled),
			"ai.provider": provider,
			"ai.apiEndpoint": apiEndpoint,
			"ai.apiKey": apiKey,
			"ai.model": model,
		};
		for (const feat of FEATURES) {
			payload[feat.key] = String(features[feat.key] ?? false);
		}
		save.mutate(payload);
	}

	const handleTest = async () => {
		const cfg = {
			provider,
			apiEndpoint: apiEndpoint || undefined,
			apiKey: apiKey || undefined,
			model,
		};
		try {
			await testAI.mutateAsync(cfg);
			toast.success("连接成功，模型可用");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "检测失败");
		}
	};

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			{/* 用量概览(免费额度防刷 + 自定义 API 防滥用) */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<BarChart3 className="size-5 text-orange-500" />
						<CardTitle>用量概览</CardTitle>
					</div>
					<CardDescription>统计最近 24 小时内的 AI 调用情况</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					{usageLoading ? (
						<p className="text-sm text-muted-foreground">加载中…</p>
					) : (
						<>
							{/* 今日核心指标 */}
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<Metric label="今日调用" value={usage?.today.total ?? 0} />
								<Metric
									label="成功率"
									value={`${usage?.today.successRate ?? 100}%`}
								/>
								<Metric label="失败" value={usage?.today.failed ?? 0} />
								<Metric
									label="平均耗时"
									value={`${usage?.today.avgDurationMs ?? 0}ms`}
								/>
							</div>

							{/* 免费额度软上限预警(builtin 才展示) */}
							{usage && provider === "builtin" && usage.today.total > 0 && (
								<SoftLimitBar total={usage.today.total} />
							)}

							{/* 各功能分布 */}
							<div className="space-y-2">
								<p className="text-xs font-medium text-muted-foreground">
									各功能调用次数
								</p>
								{usage && usage.byFeature.length > 0 ? (
									usage.byFeature.map((f) => (
										<div key={f.feature} className="space-y-1">
											<div className="flex items-center justify-between text-xs">
												<span>
													{FEATURE_LABELS[f.feature] ?? f.feature}
												</span>
												<span className="text-muted-foreground">
													{f.total} 次{f.success < f.total ? ` · ${f.total - f.success} 失败` : ""}
												</span>
											</div>
											<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
												<div
													className="h-full rounded-full bg-orange-500"
													style={{
														width: `${Math.min(
															100,
															(f.total /
																(usage.today.total || 1)) *
																100,
														)}%`,
													}}
												/>
											</div>
										</div>
									))
								) : (
									<p className="text-xs text-muted-foreground">
										今日暂无 AI 调用记录
									</p>
								)}
							</div>

							{/* 提供商分布 */}
							{usage && usage.byProvider.length > 0 && (
								<div className="space-y-1 text-xs text-muted-foreground">
									{usage.byProvider.map((p) => (
										<div
											key={p.provider}
											className="flex items-center justify-between"
										>
											<span>
												{p.provider === "builtin"
													? "内置 Workers AI"
													: "自定义 API"}
											</span>
											<span>{p.total} 次</span>
										</div>
									))}
								</div>
							)}

							{/* 最近错误 */}
							{usage && usage.recentErrors.length > 0 && (
								<div className="space-y-1.5">
									<p className="text-xs font-medium text-muted-foreground">
										最近失败记录
									</p>
									{usage.recentErrors.slice(0, 8).map((e, i) => (
										<div
											key={i}
											className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs"
										>
											<span className="font-medium text-destructive">
												{FEATURE_LABELS[e.feature] ?? e.feature}
											</span>
											<span className="text-muted-foreground">
												{" "}
												· {new Date(e.createdAt).toLocaleTimeString()}
											</span>
											<p className="mt-0.5 break-all text-muted-foreground">
												{e.error}
											</p>
										</div>
									))}
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* 总开关 */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<Sparkles className="size-5 text-orange-500" />
						<CardTitle>AI 功能</CardTitle>
					</div>
					<CardDescription>
						启用后可使用 AI 辅助书签管理。AI 调用会产生少量费用，默认关闭。
					</CardDescription>
				</CardHeader>
				<CardContent className="flex items-center justify-between">
					<Label htmlFor="ai-enabled" className="text-sm text-muted-foreground">
						{enabled ? "已启用" : "已关闭"}
					</Label>
					<Switch
						id="ai-enabled"
						checked={enabled}
						onCheckedChange={setEnabled}
						disabled={isLoading}
					/>
				</CardContent>
			</Card>

			{/* 提供商配置 */}
			<Card>
				<CardHeader>
					<CardTitle>AI 提供商</CardTitle>
					<CardDescription>选择调用 AI 的方式</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-3">
						<Button
							type="button"
							size="sm"
							variant={provider === "builtin" ? "default" : "outline"}
							onClick={() => setProvider("builtin")}
							className="flex items-center gap-1.5"
						>
							<Zap className="size-3.5" />
							内置
						</Button>
						<Button
							type="button"
							size="sm"
							variant={provider === "custom" ? "default" : "outline"}
							onClick={() => setProvider("custom")}
							className="flex items-center gap-1.5"
						>
							<FlaskConical className="size-3.5" />
							自定义 API
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{provider === "builtin"
							? "使用 Cloudflare Workers AI，在免费额度内不产生费用。"
							: "兼容 OpenAI 格式的 API，可接入第三方模型服务。"}
					</p>

					{provider === "custom" && (
						<form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
							<div className="space-y-2">
								<Label htmlFor="ai-endpoint">API Endpoint</Label>
								<Input
									id="ai-endpoint"
									value={apiEndpoint}
									onChange={(e) => setApiEndpoint(e.target.value)}
									placeholder="https://api.openai.com/v1"
									disabled={isLoading}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="ai-key">API Key</Label>
								<div className="flex gap-2">
									<Input
										id="ai-key"
										type={showKey ? "text" : "password"}
										value={apiKey}
										onChange={(e) => setApiKey(e.target.value)}
										placeholder="sk-••••••••"
										disabled={isLoading}
										className="flex-1"
									/>
									<Button
										type="button"
										size="icon"
										variant="outline"
										onClick={() => setShowKey((v) => !v)}
										disabled={isLoading}
										aria-label={showKey ? "隐藏密钥" : "显示密钥"}
									>
										{showKey ? (
											<EyeOff className="size-4" />
										) : (
											<Eye className="size-4" />
										)}
									</Button>
								</div>
							</div>
							<ModelField
								model={model}
								onModelChange={setModel}
								placeholder="gpt-4o-mini"
								disabled={isLoading}
							/>
						</form>
					)}

					{provider === "builtin" && (
						<form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
							<ModelField
								model={model}
								onModelChange={setModel}
								placeholder={DEFAULT_MODEL}
								disabled={isLoading}
							/>
							<p className="text-xs text-muted-foreground">
								留空则使用默认模型{" "}
								<code className="rounded bg-muted px-1 py-0.5">
									{DEFAULT_MODEL}
								</code>
								。可在{" "}
								<a
									href={WORKERS_AI_MODELS_URL}
									target="_blank"
									rel="noreferrer"
									className="text-blue-500 hover:underline"
								>
									Cloudflare Workers AI 模型列表
								</a>{" "}
								查找其它可用的 model id。
							</p>
						</form>
					)}

					<div className="pt-1">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={handleTest}
							disabled={isLoading || testAI.isPending}
							className="flex items-center gap-1.5"
						>
							<FlaskConical className="size-3.5" />
							{testAI.isPending ? "检测中…" : "测试连接"}
						</Button>
						<p className="mt-1.5 text-xs text-muted-foreground">
							用当前表单配置试跑一次，验证模型是否可用（不会保存设置）。
						</p>
					</div>
				</CardContent>
			</Card>

			{/* 功能开关 */}
			<Card>
				<CardHeader>
					<CardTitle>功能开关</CardTitle>
					<CardDescription>单独启用或关闭各项 AI 功能</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{FEATURES.map((feat) => (
						<div
							key={feat.key}
							className="flex items-center justify-between gap-4"
						>
							<div className="space-y-0.5">
								<Label htmlFor={feat.key} className="text-sm">
									{feat.label}
								</Label>
								<p className="text-xs text-muted-foreground">
									{feat.description}
								</p>
							</div>
							<Switch
								id={feat.key}
								checked={features[feat.key] ?? false}
								onCheckedChange={(v) =>
									setFeatures((prev) => ({ ...prev, [feat.key]: v }))
								}
								disabled={isLoading || !enabled}
							/>
						</div>
					))}
				</CardContent>
			</Card>

			{/* 隐私说明 & 保存 */}
			<Card>
				<CardHeader>
					<CardTitle>隐私说明</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
						<li>书签标题和 URL 会发送至所选 AI 提供商用于内容分析</li>
						<li>数据仅用于推理，不会用于模型训练</li>
						<li>可随时关闭 AI 功能，已产生的分析结果不受影响</li>
					</ul>
					<Button
						type="button"
						onClick={handleSubmit}
						disabled={save.isPending || isLoading}
					>
						{save.isPending ? "保存中…" : "保存设置"}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="rounded-lg border bg-muted/30 p-3 text-center">
			<div className="text-lg font-semibold tabular-nums">{value}</div>
			<div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
		</div>
	);
}

function SoftLimitBar({ total }: { total: number }) {
	const ratio = Math.min(1, total / DAILY_SOFT_LIMIT);
	const near = ratio >= 0.8 && ratio < 1;
	const over = ratio >= 1;
	const color = over
		? "bg-destructive"
		: near
			? "bg-yellow-500"
			: "bg-orange-500";
	const text = over
		? `今日免费额度已接近上限（${total}/${DAILY_SOFT_LIMIT}），注意可能被限流`
		: near
			? `今日免费额度使用较多（${total}/${DAILY_SOFT_LIMIT}），请注意`
			: `今日免费额度使用 ${total}/${DAILY_SOFT_LIMIT}`;
	return (
		<div className="space-y-1.5">
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div className={`h-full ${color}`} style={{ width: `${ratio * 100}%` }} />
			</div>
			<p className="text-xs text-muted-foreground">{text}</p>
		</div>
	);
}
