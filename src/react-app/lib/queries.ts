import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "./api";

// 登录态:所有受登录态影响的列表 query 都应把 auth 状态纳入 key 或在变更后失效
export function useAuthStatus() {
	return useQuery({
		queryKey: ["auth-status"],
		queryFn: async () => {
			const res = await client.api.auth.status.$get();
			if (!res.ok) throw new Error("获取登录状态失败");
			return res.json();
		},
		staleTime: 60_000,
	});
}

export function useLogout() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async () => {
			await client.api.auth.logout.$post();
		},
		onSuccess: () => qc.invalidateQueries(),
	});
}

export function useNavData() {
	const { data: auth } = useAuthStatus();
	return useQuery({
		// 登录态变化时自动重新拉取
		queryKey: ["nav-bookmarks", auth?.authenticated ?? false],
		queryFn: async () => {
			const res = await client.api.public.bookmarks.$get();
			if (!res.ok) throw new Error("加载书签失败");
			return res.json();
		},
	});
}

export function useSiteSettings() {
	return useQuery({
		queryKey: ["site-settings"],
		queryFn: async () => {
			const res = await client.api.public.site.$get();
			if (!res.ok) throw new Error("加载站点配置失败");
			return res.json() as Promise<Record<string, string>>;
		},
		staleTime: 5 * 60_000,
	});
}

export function useAISearchConfig() {
	return useQuery({
		queryKey: ["ai-config"],
		queryFn: async () => {
			const res = await client.api.public["ai-config"].$get();
			if (!res.ok) return { aiEnabled: false, semanticSearch: false };
			return res.json() as Promise<{ aiEnabled: boolean; semanticSearch: boolean }>;
		},
		staleTime: 5 * 60_000,
	});
}
