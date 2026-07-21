import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { APP_CONFIG } from "@/app/config";
import { BrandLogo } from "@/components/domain/brand-logo";
import { apiErrorMessage, useAuth } from "./auth-context";

export function AuthScreen() {
  const { login, register, sendRegistrationCode } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login"),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [sendingCode, setSendingCode] = useState(false),
    [countdown, setCountdown] = useState(0),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [verificationCode, setVerificationCode] = useState("");
  const validPhone = /^1[3-9]\d{9}$/.test(phone);
  useEffect(() => {
    if (!countdown) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [countdown]);
  async function requestCode() {
    setError("");
    setNotice("");
    setSendingCode(true);
    try {
      const result = await sendRegistrationCode(phone);
      setCountdown(result.retryAfterSeconds);
      setNotice("验证码已发送，请查看服务端日志");
    } catch (reason) {
      setError(apiErrorMessage(reason, "验证码发送失败"));
    } finally {
      setSendingCode(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login({ phone, password });
      else await register({ phone, password, displayName, verificationCode });
    } catch (reason) {
      setError(apiErrorMessage(reason, mode === "login" ? "登录失败，请检查账号密码" : "注册失败，请检查输入"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <header>
          <span className="auth-brand">
            <BrandLogo />
            {APP_CONFIG.projectName}
          </span>
          <p>一个账号，连接你的全部创作任务与素材</p>
        </header>
        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
              setNotice("");
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
              setNotice("");
            }}
          >
            注册
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              显示名称
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                minLength={2}
                maxLength={40}
                placeholder="你的工作室或昵称"
                required
              />
            </label>
          )}
          <label>
            手机号
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
              pattern="1[3-9][0-9]{9}"
              placeholder="请输入 11 位手机号"
              required
            />
          </label>
          {mode === "register" && (
            <label>
              短信验证码
              <span className="verification-field">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  pattern="[0-9]{6}"
                  placeholder="6 位验证码"
                  required
                />
                <button
                  type="button"
                  disabled={!validPhone || sendingCode || countdown > 0}
                  onClick={() => void requestCode()}
                >
                  {sendingCode ? "发送中…" : countdown > 0 ? `${countdown}s` : "获取验证码"}
                </button>
              </span>
            </label>
          )}
          <label>
            密码
            <span className="password-field">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === "register" ? 10 : 1}
                maxLength={128}
                placeholder={mode === "register" ? "至少 10 位，包含字母和数字" : "输入密码"}
                required
              />
              <button
                type="button"
                aria-label={show ? "隐藏密码" : "显示密码"}
                onClick={() => setShow((value) => !value)}
              >
                {show ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="form-notice">{notice}</p>}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : mode === "login" ? "登录工作台" : "创建账号并登录"}
          </button>
        </form>
        <small>本地工作台 · 数据保存在当前设备的 SQLite 中</small>
      </section>
    </main>
  );
}
