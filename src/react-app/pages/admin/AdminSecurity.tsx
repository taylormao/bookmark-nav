import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStatus } from "@/lib/queries";
import { useChangePassword, useChangeUsername } from "@/lib/admin-queries";

export default function AdminSecurity() {
	const changePassword = useChangePassword();
	const [oldPassword, setOldPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	function handleChangePassword(e: FormEvent) {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			toast.error("两次输入的新密码不一致");
			return;
		}
		changePassword.mutate(
			{ oldPassword, newPassword },
			{
				onSuccess: () => {
					setOldPassword("");
					setNewPassword("");
					setConfirmPassword("");
				},
			},
		);
	}

	const { data: auth } = useAuthStatus();
	const changeUsername = useChangeUsername();
	const [username, setUsername] = useState("");
	const [usernamePassword, setUsernamePassword] = useState("");

	// 首次加载回填当前用户名
	useEffect(() => {
		if (auth?.user?.username) setUsername(auth.user.username);
	}, [auth?.user?.username]);

	function handleChangeUsername(e: FormEvent) {
		e.preventDefault();
		changeUsername.mutate(
			{ username, password: usernamePassword },
			{ onSuccess: () => setUsernamePassword("") },
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>修改用户名</CardTitle>
					<CardDescription>修改当前管理员账号的登录用户名</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleChangeUsername} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="username">用户名</Label>
							<Input
								id="username"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								maxLength={50}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="username-password">当前密码</Label>
							<Input
								id="username-password"
								type="password"
								value={usernamePassword}
								onChange={(e) => setUsernamePassword(e.target.value)}
								autoComplete="current-password"
								placeholder="验证身份后生效"
								required
							/>
						</div>
						<Button type="submit" disabled={changeUsername.isPending}>
							{changeUsername.isPending ? "修改中…" : "修改用户名"}
						</Button>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>修改密码</CardTitle>
					<CardDescription>修改当前管理员账号的登录密码</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleChangePassword} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="old-password">当前密码</Label>
							<Input
								id="old-password"
								type="password"
								value={oldPassword}
								onChange={(e) => setOldPassword(e.target.value)}
								autoComplete="current-password"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="new-password">新密码</Label>
							<Input
								id="new-password"
								type="password"
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
								autoComplete="new-password"
								minLength={6}
								placeholder="至少 6 位"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="confirm-password">确认新密码</Label>
							<Input
								id="confirm-password"
								type="password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								autoComplete="new-password"
								minLength={6}
								required
							/>
						</div>
						<Button type="submit" disabled={changePassword.isPending}>
							{changePassword.isPending ? "修改中…" : "修改密码"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
