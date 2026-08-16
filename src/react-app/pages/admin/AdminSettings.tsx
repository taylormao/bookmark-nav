import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminSettings, useSaveSettings } from "@/lib/admin-queries";

export default function AdminSettings() {
	const { data, isLoading } = useAdminSettings();
	const save = useSaveSettings();
	const [siteName, setSiteName] = useState("");
	const [footer, setFooter] = useState("");

	// 首次加载回填
	useEffect(() => {
		if (data) {
			setSiteName(data.siteName ?? "");
			setFooter(data.footer ?? "");
		}
	}, [data]);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		save.mutate({ siteName, footer });
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>基础信息</CardTitle>
					<CardDescription>前台展示页使用的站点配置</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="site-name">站点名称</Label>
							<Input
								id="site-name"
								value={siteName}
								onChange={(e) => setSiteName(e.target.value)}
								placeholder="书签导航"
								disabled={isLoading}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="site-footer">页脚文字</Label>
							<Textarea
								id="site-footer"
								value={footer}
								onChange={(e) => setFooter(e.target.value)}
								rows={2}
								disabled={isLoading}
							/>
						</div>
						<Button type="submit" disabled={save.isPending || isLoading}>
							{save.isPending ? "保存中…" : "保存"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
