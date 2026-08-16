import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";
import Home from "./pages/Home";
import Login from "./pages/Login";

// 后台按路由懒加载,不拖累前台首屏
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminBookmarks = lazy(() => import("./pages/admin/AdminBookmarks"));
const AdminCategories = lazy(() => import("./pages/admin/AdminCategories"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminAppearance = lazy(() => import("./pages/admin/AdminAppearance"));
const AdminSecurity = lazy(() => import("./pages/admin/AdminSecurity"));
const AdminImportExport = lazy(() => import("./pages/admin/AdminImportExport"));
const AdminAI = lazy(() => import("./pages/admin/AdminAI"));

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: 1, refetchOnWindowFocus: false },
	},
});

// 首帧防闪烁:React 挂载前先按已存偏好置 dark 类,之后由 next-themes 接管(默认跟随系统)
const stored = localStorage.getItem("theme");
if (
	stored === "dark" ||
	((!stored || stored === "system") &&
		window.matchMedia("(prefers-color-scheme: dark)").matches)
) {
	document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<QueryClientProvider client={queryClient}>
				<BrowserRouter>
					<Suspense
						fallback={
							<div className="flex min-h-screen items-center justify-center text-muted-foreground">
								加载中…
							</div>
						}
					>
						<Routes>
							<Route path="/" element={<Home />} />
							<Route path="/login" element={<Login />} />
							<Route path="/admin" element={<AdminLayout />}>
								<Route index element={<AdminBookmarks />} />
								<Route path="categories" element={<AdminCategories />} />
								<Route path="import-export" element={<AdminImportExport />} />
								<Route path="settings" element={<AdminSettings />} />
								<Route path="appearance" element={<AdminAppearance />} />
								<Route path="security" element={<AdminSecurity />} />
								<Route path="ai" element={<AdminAI />} />
								</Route>
						</Routes>
					</Suspense>
				</BrowserRouter>
				<Toaster position="top-center" />
			</QueryClientProvider>
		</ThemeProvider>
	</StrictMode>,
);
