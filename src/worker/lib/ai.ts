import type { Db } from "../db/client";
import { aiUsage, settings } from "../db/schema";

export type AIProvider = "builtin" | "custom";

export type AISettings = {
	enabled: boolean;
	provider: AIProvider;
	apiEndpoint: string;
	apiKey: string;
	model: string;
	features: {
		autoFill: boolean;
		tagSuggest: boolean;
		semanticSearch: boolean;
		summary: boolean;
		autoCategorize: boolean;
		deadLinkRepair: boolean;
	};
};

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export async function loadAISettings(db: Db): Promise<AISettings> {
	const rows = await db
		.select({ key: settings.key, value: settings.value })
		.from(settings);
	const map = new Map(rows.map((r) => [r.key, r.value]));
	const getBool = (key: string) => map.get(key) === "true";
	const getStr = (key: string, fallback = "") => map.get(key) ?? fallback;

	return {
		enabled: getBool("ai.enabled"),
		provider: (getStr("ai.provider", "builtin") as AIProvider) ?? "builtin",
		apiEndpoint: getStr("ai.apiEndpoint"),
		apiKey: getStr("ai.apiKey"),
		model: getStr("ai.model", DEFAULT_MODEL),
		features: {
			autoFill: getBool("ai.features.autoFill"),
			tagSuggest: getBool("ai.features.tagSuggest"),
			semanticSearch: getBool("ai.features.semanticSearch"),
			summary: getBool("ai.features.summary"),
			autoCategorize: getBool("ai.features.autoCategorize"),
			deadLinkRepair: getBool("ai.features.deadLinkRepair"),
		},
	};
}

export type AIMessage = { role: "system" | "user"; content: string };

export async function runChat(
	env: Env,
	settings: AISettings,
	messages: AIMessage[],
	feature: string,
	db?: Db,
): Promise<string> {
	if (!settings.enabled) {
		throw new Error("AI 功能未启用");
	}

	const provider = settings.provider;
	const start = Date.now();
	let success = false;
	let errorMsg: string | undefined;

	try {
		if (provider === "custom") {
			if (!settings.apiEndpoint) throw new Error("自定义 API Endpoint 未配置");
			if (!settings.apiKey) throw new Error("自定义 API Key 未配置");
			if (!settings.model) throw new Error("自定义模型未配置");

			const res = await fetch(`${settings.apiEndpoint.replace(/\/$/, "")}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings.apiKey}`,
				},
				body: JSON.stringify({
					model: settings.model,
					messages,
					temperature: 0.2,
				}),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`自定义 AI 请求失败 (${res.status}): ${text}`);
			}
			const body = (await res.json()) as {
				choices?: { message?: { content?: string } }[];
			};
			const content = body.choices?.[0]?.message?.content;
			if (!content) throw new Error("自定义 AI 返回内容为空");
			return content;
		}

		// 内置 Workers AI
		const model = settings.model || DEFAULT_MODEL;
		const result = await env.AI.run(model as any, { messages });
		const content = (result as { response?: string }).response;
		if (!content) throw new Error("Workers AI 返回内容为空");
		return content;
	} catch (err) {
		errorMsg = err instanceof Error ? err.message : String(err);
		throw err;
	} finally {
		success = !errorMsg;
		if (db) {
			await db
				.insert(aiUsage)
				.values({
					feature,
					provider,
					success: success ? 1 : 0,
					durationMs: Date.now() - start,
					error: errorMsg,
				})
				.catch((e) => console.error("写入 AI 用量记录失败:", e));
		}
	}
}

// 用临时配置(非已保存设置)试跑一次,验证 provider / endpoint / key / model 是否可用
export async function testModel(env: Env, cfg: {
	provider: AIProvider;
	apiEndpoint?: string;
	apiKey?: string;
	model: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	const messages: AIMessage[] = [
		{ role: "system", content: "你是连接测试助手,只回复 ok 两个字母。" },
		{ role: "user", content: "ping" },
	];
	try {
		if (cfg.provider === "custom") {
			if (!cfg.apiEndpoint) return { ok: false, error: "自定义 API Endpoint 未填写" };
			if (!cfg.apiKey) return { ok: false, error: "自定义 API Key 未填写" };
			if (!cfg.model) return { ok: false, error: "自定义模型未填写" };
			const res = await fetch(
				`${cfg.apiEndpoint.replace(/\/$/, "")}/chat/completions`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${cfg.apiKey}`,
					},
					body: JSON.stringify({ model: cfg.model, messages, temperature: 0 }),
					signal: AbortSignal.timeout(20000),
				},
			);
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				return { ok: false, error: `请求失败 (${res.status}): ${text.slice(0, 300)}` };
			}
			const body = (await res.json()) as {
				choices?: { message?: { content?: string } }[];
			};
			if (!body.choices?.[0]?.message?.content) {
				return { ok: false, error: "返回内容为空" };
			}
			return { ok: true };
		}

		// 内置 Workers AI
		const model = cfg.model || DEFAULT_MODEL;
		const result = await env.AI.run(model as any, { messages }, { signal: AbortSignal.timeout(20000) } as any);
		const content = (result as { response?: string }).response;
		if (!content) return { ok: false, error: "Workers AI 返回内容为空" };
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

export function extractJson<T>(text: string): T {
	// 先尝试整个文本
	try {
		return JSON.parse(text) as T;
	} catch {
		// 尝试提取 ```json ... ``` 或 {...}
		const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		if (codeBlock) {
			try {
				return JSON.parse(codeBlock[1]) as T;
			} catch {
				/* ignore */
			}
		}
		const object = text.match(/\{[\s\S]*\}/);
		if (object) {
			try {
				return JSON.parse(object[0]) as T;
			} catch {
				/* ignore */
			}
		}
	}
	throw new Error("AI 返回内容不是有效 JSON");
}
