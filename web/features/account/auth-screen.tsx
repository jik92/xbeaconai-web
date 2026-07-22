import { ArrowLeft, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { APP_CONFIG } from "@/app/config";
import { BrandLogo } from "@/components/domain/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage, useAuth } from "./auth-context";

type AuthView = "login" | "register" | "forgot" | "setup";

const viewTitles: Record<AuthView, string> = {
  login: "登录",
  register: "注册",
  forgot: "忘记密码",
  setup: "设置登录密码",
};

export function AuthScreen() {
  const { login, register, verifyPasswordReset, setupPassword, sendVerificationCode } = useAuth();
  const [view, setView] = useState<AuthView>("login");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [displayedVerificationCode, setDisplayedVerificationCode] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const validPhone = /^1[3-9]\d{9}$/.test(phone);

  useEffect(() => {
    if (!countdown) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  function changeView(next: AuthView) {
    setView(next);
    setError("");
    setNotice("");
    setVerificationCode("");
    setDisplayedVerificationCode("");
    setPassword("");
    setConfirmPassword("");
    setCountdown(0);
    setShow(false);
  }

  async function requestCode() {
    setError("");
    setNotice("");
    setDisplayedVerificationCode("");
    setSendingCode(true);
    try {
      const purpose = view === "forgot" ? "reset_password" : "register";
      const result = await sendVerificationCode(phone, purpose);
      setCountdown(result.retryAfterSeconds);
      setDisplayedVerificationCode(result.verificationCode ?? "");
      setNotice("验证码已发送");
    } catch (reason) {
      setError(apiErrorMessage(reason, "验证码发送失败"));
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (view === "setup" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (view === "login") {
        await login({ phone, password });
      } else if (view === "register") {
        const challenge = await register({ phone, verificationCode });
        setSetupToken(challenge.setupToken);
        setPhone(challenge.phone);
        changeView("setup");
        setNotice("手机号验证成功，请设置登录密码");
      } else if (view === "forgot") {
        const challenge = await verifyPasswordReset({ phone, verificationCode });
        setSetupToken(challenge.setupToken);
        setPhone(challenge.phone);
        changeView("setup");
        setNotice("手机号验证成功，请设置新的登录密码");
      } else {
        await setupPassword({ setupToken, password });
      }
    } catch (reason) {
      const fallback = view === "login" ? "登录失败，请检查手机号和密码" : "操作失败，请检查输入";
      setError(apiErrorMessage(reason, fallback));
    } finally {
      setBusy(false);
    }
  }

  const verificationView = view === "register" || view === "forgot";
  return (
    <main className="grid min-h-screen place-items-center bg-white px-4 py-8 font-sans text-ink">
      <Card className="h-[480px] w-full max-w-sm gap-0 overflow-hidden py-0">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-6">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <BrandLogo className="w-9 rounded-md" />
            {APP_CONFIG.projectName}
          </span>
          <h1 className="text-sm font-medium">{viewTitles[view]}</h1>
        </header>

        <CardContent className="flex-1 px-6 py-5">
          {(view === "login" || view === "register") && (
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-surface-muted p-1">
              <Button
                variant="ghost"
                size="sm"
                className={view === "login" ? "bg-white shadow-sm hover:bg-white" : "text-muted"}
                onClick={() => changeView("login")}
              >
                登录
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={view === "register" ? "bg-white shadow-sm hover:bg-white" : "text-muted"}
                onClick={() => changeView("register")}
              >
                注册
              </Button>
            </div>
          )}

          {(view === "forgot" || view === "setup") && (
            <div className="mb-4 flex h-8 items-center justify-between">
              <Button variant="ghost" size="sm" className="-ml-2 px-2 text-muted" onClick={() => changeView("login")}>
                <ArrowLeft /> 返回登录
              </Button>
              {view === "setup" && <span className="text-xs text-muted">{phone}</span>}
            </div>
          )}

          <form className="space-y-4" onSubmit={submit}>
            {view !== "setup" && (
              <div className="space-y-2">
                <Label className="text-xs" htmlFor="auth-phone">
                  手机号
                </Label>
                <Input
                  id="auth-phone"
                  className="h-9"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
                  pattern="1[3-9][0-9]{9}"
                  placeholder="请输入 11 位手机号"
                  required
                />
              </div>
            )}

            {verificationView && (
              <div className="space-y-2">
                <Label className="text-xs" htmlFor="auth-code">
                  短信验证码
                </Label>
                <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2">
                  <Input
                    id="auth-code"
                    className="h-9"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    pattern="[0-9]{6}"
                    placeholder="6 位验证码"
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 px-2 text-xs"
                    disabled={!validPhone || sendingCode || countdown > 0}
                    onClick={() => void requestCode()}
                  >
                    {sendingCode ? "发送中…" : countdown > 0 ? `${countdown}s` : "获取验证码"}
                  </Button>
                </div>
              </div>
            )}

            {(view === "login" || view === "setup") && (
              <div className="space-y-2">
                <Label className="text-xs" htmlFor="auth-password">
                  {view === "setup" ? "新密码" : "密码"}
                </Label>
                <div className="relative">
                  <Input
                    id="auth-password"
                    className="h-9 pr-10"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={view === "setup" ? 10 : 1}
                    maxLength={128}
                    autoComplete={view === "setup" ? "new-password" : "current-password"}
                    placeholder={view === "setup" ? "至少 10 位，包含字母和数字" : "输入密码"}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 size-7 text-muted"
                    aria-label={show ? "隐藏密码" : "显示密码"}
                    onClick={() => setShow((value) => !value)}
                  >
                    {show ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
            )}

            {view === "setup" && (
              <div className="space-y-2">
                <Label className="text-xs" htmlFor="auth-confirm-password">
                  确认密码
                </Label>
                <Input
                  id="auth-confirm-password"
                  className="h-9"
                  type={show ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="再次输入新密码"
                  required
                />
              </div>
            )}

            {view === "login" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto flex h-7 px-1 text-xs text-muted"
                onClick={() => changeView("forgot")}
              >
                忘记密码？
              </Button>
            )}

            {error && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="flex items-center justify-between gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
                <span>{notice}</span>
                {displayedVerificationCode && (
                  <span className="shrink-0" role="status">
                    当前验证码：<strong className="font-semibold tracking-widest">{displayedVerificationCode}</strong>
                  </span>
                )}
              </p>
            )}

            <Button type="submit" className="h-9 w-full" disabled={busy || (verificationView && sendingCode)}>
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : view === "login" ? (
                "登录工作台"
              ) : view === "register" ? (
                "验证并注册"
              ) : view === "forgot" ? (
                "验证手机号"
              ) : (
                "设置密码并登录"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
