import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { APP_CONFIG } from "@/app/config";
import { BrandLogo } from "@/components/domain/brand-logo";
import { apiErrorMessage, useAuth } from "./auth-context";

type AuthView = "login" | "register" | "forgot" | "setup";

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
      setDisplayedVerificationCode(result.verificationCode);
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
        setNotice("手机号验证成功，账号已注册，请设置登录密码");
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
    <main className="auth-page">
      <section className="auth-card">
        <header>
          <span className="auth-brand">
            <BrandLogo />
            {APP_CONFIG.projectName}
          </span>
          <p>一个账号，连接你的全部创作任务与素材</p>
        </header>

        {(view === "login" || view === "register") && (
          <div className="auth-tabs">
            <button type="button" className={view === "login" ? "active" : ""} onClick={() => changeView("login")}>
              登录
            </button>
            <button
              type="button"
              className={view === "register" ? "active" : ""}
              onClick={() => changeView("register")}
            >
              注册
            </button>
          </div>
        )}

        {(view === "forgot" || view === "setup") && (
          <div className="auth-flow-heading">
            <button type="button" onClick={() => changeView("login")}>
              ← 返回登录
            </button>
            <b>{view === "forgot" ? "忘记密码" : "设置登录密码"}</b>
            <span>{view === "forgot" ? "验证已注册手机号" : `账号 ${phone}`}</span>
          </div>
        )}

        <form onSubmit={submit}>
          {view !== "setup" && (
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
          )}

          {verificationView && (
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

          {(view === "login" || view === "setup") && (
            <label>
              {view === "setup" ? "新密码" : "密码"}
              <span className="password-field">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={view === "setup" ? 10 : 1}
                  maxLength={128}
                  autoComplete={view === "setup" ? "new-password" : "current-password"}
                  placeholder={view === "setup" ? "至少 10 位，包含字母和数字" : "输入密码"}
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
          )}

          {view === "setup" && (
            <label>
              确认密码
              <input
                type={show ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                placeholder="再次输入新密码"
                required
              />
            </label>
          )}

          {view === "login" && (
            <button type="button" className="auth-text-action" onClick={() => changeView("forgot")}>
              忘记密码？
            </button>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="form-notice">{notice}</p>}
          {displayedVerificationCode && (
            <p className="verification-code-display" role="status">
              当前验证码：<strong>{displayedVerificationCode}</strong>
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={busy || (verificationView && sendingCode)}>
            {busy ? (
              <LoaderCircle className="spin" />
            ) : view === "login" ? (
              "登录工作台"
            ) : view === "register" ? (
              "验证并注册"
            ) : view === "forgot" ? (
              "验证手机号"
            ) : (
              "设置密码并登录"
            )}
          </button>
        </form>
        <small>本地工作台 · 数据保存在当前设备的 SQLite 中</small>
      </section>
    </main>
  );
}
