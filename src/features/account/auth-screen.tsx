import { Command, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { APP_CONFIG } from "@/app/config";
import { apiErrorMessage, useAuth } from "./auth-context";

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login"),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [displayName, setDisplayName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login({ email, password });
      else await register({ email, password, displayName });
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
            <Command />
            {APP_CONFIG.projectName}
          </span>
          <p>一个账号，连接你的全部创作任务与素材</p>
        </header>
        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
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
                autoFocus
              />
            </label>
          )}
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              autoFocus={mode === "login"}
            />
          </label>
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
          <button className="auth-submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : mode === "login" ? "登录工作台" : "创建账号并登录"}
          </button>
        </form>
        <small>本地工作台 · 数据保存在当前设备的 SQLite 中</small>
      </section>
    </main>
  );
}
