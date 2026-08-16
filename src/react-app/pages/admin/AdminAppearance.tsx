import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export default function AdminAppearance() {
	const { theme, setTheme } = useTheme();
	const themeOptions = [
		{ value: "system", label: "跟随系统", icon: Monitor },
		{ value: "light", label: "浅色", icon: Sun },
		{ value: "dark", label: "深色", icon: Moon },
	] as const;

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>外观设置</CardTitle>
					<CardDescription>设置后台及前台的明暗主题，默认跟随系统</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{themeOptions.map(({ value, label, icon: Icon }) => (
							<Button
								key={value}
								type="button"
								variant="outline"
								size="sm"
								className={cn(
									"gap-2",
									theme === value && "border-primary bg-primary/10 text-primary",
								)}
								onClick={() => setTheme(value)}
							>
								<Icon className="size-4" />
								{label}
							</Button>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
