import {
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  CreditCard,
  LockKeyhole,
  LogOut,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  changePassword,
  createRechargeOrder,
  getPreferences,
  listNotifications,
  listRechargeOrders,
  listRechargePackages,
  markAllNotificationsRead,
  markNotificationRead,
  savePreferences,
  updateProfile,
} from "@/api/generated/sdk.gen";
import type { NotificationItem, Preferences, RechargeOrder } from "@/api/generated/types.gen";
import { randomUuid } from "@/lib/random-id";
import { apiErrorMessage, useAuth } from "./auth-context";

export type WorkspacePanel = "help" | "preferences" | "notifications" | "recharge" | "account" | "profile" | "security";

function Drawer({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="workspace-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="workspace-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <span>{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="workspace-body">{children}</div>
      </section>
    </div>
  );
}
const Loading = () => <p className="panel-muted">正在载入…</p>;

function HelpPanel() {
  return (
    <div className="help-list">
      <article>
        <CircleHelp />
        <div>
          <b>快速开始</b>
          <p>选择左侧创作工具，上传素材并提交任务。任务会在后台运行，完成后自动通知。</p>
        </div>
      </article>
      <article>
        <Bell />
        <div>
          <b>任务状态</b>
          <p>排队、处理中、完成或失败都会保存在任务中心；关闭页面不会丢失任务。</p>
        </div>
      </article>
      <article>
        <CreditCard />
        <div>
          <b>关于创作点</b>
          <p>当前充值是本地 Mock 流程，仅用于完整验证余额和订单链路，不会产生真实扣款。</p>
        </div>
      </article>
      <article>
        <LockKeyhole />
        <div>
          <b>账号与数据</b>
          <p>账号、任务和素材按用户隔离，密码使用哈希保存；登录令牌存储在本机浏览器。</p>
        </div>
      </article>
    </div>
  );
}

function PreferencesPanel() {
  const [value, setValue] = useState<Preferences>(),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    void getPreferences({ throwOnError: true }).then(({ data }) => setValue(data));
  }, []);
  if (!value) return <Loading />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await savePreferences({ body: value!, throwOnError: true });
      setValue(data);
      toast.success("偏好设置已保存");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <label>
        界面主题
        <select
          value={value.theme}
          onChange={(event) => setValue({ ...value, theme: event.target.value as Preferences["theme"] })}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
        </select>
      </label>
      <label>
        默认画面比例
        <select
          value={value.defaultRatio}
          onChange={(event) => setValue({ ...value, defaultRatio: event.target.value as Preferences["defaultRatio"] })}
        >
          <option>9:16</option>
          <option>16:9</option>
          <option>1:1</option>
        </select>
      </label>
      <label>
        界面语言
        <select
          value={value.language}
          onChange={(event) => setValue({ ...value, language: event.target.value as Preferences["language"] })}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="switch-row">
        <span>
          <b>任务完成通知</b>
          <small>任务结束时写入通知中心</small>
        </span>
        <input
          type="checkbox"
          checked={value.taskNotifications}
          onChange={(event) => setValue({ ...value, taskNotifications: event.target.checked })}
        />
      </label>
      <label className="switch-row">
        <span>
          <b>自动播放结果</b>
          <small>打开结果时自动播放音视频</small>
        </span>
        <input
          type="checkbox"
          checked={value.autoplayResults}
          onChange={(event) => setValue({ ...value, autoplayResults: event.target.checked })}
        />
      </label>
      <button className="panel-primary" disabled={saving}>
        {saving ? "保存中…" : "保存设置"}
      </button>
    </form>
  );
}

function NotificationsPanel({ onUnread }: { onUnread: (count: number) => void }) {
  const [items, setItems] = useState<NotificationItem[]>(),
    [unread, setUnread] = useState(0);
  async function load() {
    const { data } = await listNotifications({ throwOnError: true });
    setItems(data?.notifications ?? []);
    setUnread(data?.unreadCount ?? 0);
    onUnread(data?.unreadCount ?? 0);
  }
  useEffect(() => {
    void load();
  }, []);
  if (!items) return <Loading />;
  return (
    <div className="notification-list">
      <div className="panel-toolbar">
        <span>{unread} 条未读</span>
        <button
          disabled={!unread}
          onClick={() => void markAllNotificationsRead({ throwOnError: true }).then(() => load())}
        >
          全部已读
        </button>
      </div>
      {!items.length && <p className="panel-muted">暂时没有通知</p>}
      {items.map((item) => (
        <button
          key={item.id}
          className={item.readAt ? "read" : ""}
          onClick={() =>
            void markNotificationRead({ path: { notificationId: item.id }, throwOnError: true }).then(() => load())
          }
        >
          <i>{item.readAt ? <Check /> : <Bell />}</i>
          <span>
            <b>{item.title}</b>
            <p>{item.body}</p>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function RechargePanel() {
  const { setUser } = useAuth();
  const [packages, setPackages] =
      useState<Array<{ id: string; name: string; amountCny: number; credits: number; badge: string }>>(),
    [orders, setOrders] = useState<RechargeOrder[]>([]),
    [busy, setBusy] = useState("");
  async function load() {
    const [p, o] = await Promise.all([
      listRechargePackages({ throwOnError: true }),
      listRechargeOrders({ throwOnError: true }),
    ]);
    setPackages(p.data?.packages ?? []);
    setOrders(o.data?.orders ?? []);
  }
  useEffect(() => {
    void load();
  }, []);
  if (!packages) return <Loading />;
  async function buy(packageId: string) {
    setBusy(packageId);
    try {
      const { data } = await createRechargeOrder({
        body: { packageId },
        headers: { "Idempotency-Key": randomUuid() },
        throwOnError: true,
      });
      if (data) {
        setUser(data.user);
        toast.success(`到账 ${data.order.credits.toLocaleString()} 创作点`);
        await load();
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "充值失败"));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="mock-warning">演示支付：不会调用真实支付渠道或产生扣款</div>
      <div className="package-grid">
        {packages.map((item) => (
          <article key={item.id}>
            <span>{item.badge}</span>
            <b>{item.name}</b>
            <strong>
              {item.credits.toLocaleString()} <small>创作点</small>
            </strong>
            <p>¥ {item.amountCny}.00</p>
            <button disabled={Boolean(busy)} onClick={() => void buy(item.id)}>
              {busy === item.id ? "处理中…" : "模拟支付"}
            </button>
          </article>
        ))}
      </div>
      <h3 className="panel-subtitle">最近订单</h3>
      <div className="order-list">
        {!orders.length && <p className="panel-muted">暂无充值订单</p>}
        {orders.map((order) => (
          <div key={order.id}>
            <span>
              <b>+{order.credits.toLocaleString()} 创作点</b>
              <small>{new Date(order.createdAt).toLocaleString()}</small>
            </span>
            <em>¥{order.amountCny} · 已到账</em>
          </div>
        ))}
      </div>
    </>
  );
}

function AccountPanel({ open }: { open: (panel: WorkspacePanel) => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="account-summary">
      <div className="account-hero">
        <i>{user?.avatarText}</i>
        <div>
          <b>{user?.displayName}</b>
          <span>{user?.phone}</span>
          <small>{user?.credits.toLocaleString()} 创作点</small>
        </div>
      </div>
      <button onClick={() => open("profile")}>
        <UserRound />
        <span>
          <b>个人资料</b>
          <small>名称、头像文字与手机号</small>
        </span>
        <ChevronRight />
      </button>
      <button onClick={() => open("security")}>
        <LockKeyhole />
        <span>
          <b>账号与密码</b>
          <small>修改登录密码并退出其他会话</small>
        </span>
        <ChevronRight />
      </button>
      <button className="logout-button" onClick={() => void logout()}>
        <LogOut />
        退出登录
      </button>
    </div>
  );
}

function ProfilePanel() {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? ""),
    [avatarText, setAvatarText] = useState(user?.avatarText ?? ""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data } = await updateProfile({ body: { displayName, avatarText }, throwOnError: true });
      if (data) {
        setUser(data.user);
        toast.success("个人资料已更新");
      }
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <div className="avatar-editor">{avatarText || "曜"}</div>
      <label>
        头像文字
        <input
          value={avatarText}
          onChange={(event) => setAvatarText(event.target.value.slice(0, 2))}
          minLength={1}
          maxLength={2}
          required
        />
      </label>
      <label>
        显示名称
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          minLength={2}
          maxLength={40}
          required
        />
      </label>
      <label>
        登录手机号
        <input type="tel" value={user?.phone ?? ""} disabled />
      </label>
      <button className="panel-primary" disabled={busy}>
        {busy ? "保存中…" : "保存个人资料"}
      </button>
    </form>
  );
}

function SecurityPanel() {
  const { logout } = useAuth();
  const [currentPassword, setCurrent] = useState(""),
    [newPassword, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await changePassword({ body: { currentPassword, newPassword }, throwOnError: true });
      toast.success("密码已修改，请重新登录");
      await logout();
    } catch (reason) {
      setError(apiErrorMessage(reason, "密码修改失败"));
      setBusy(false);
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <div className="security-note">
        <LockKeyhole />
        修改成功后会注销当前账号的全部登录会话。
      </div>
      <label>
        当前密码
        <input type="password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} required />
      </label>
      <label>
        新密码
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNext(event.target.value)}
          minLength={10}
          maxLength={128}
          placeholder="至少 10 位，包含字母和数字"
          required
        />
      </label>
      <label>
        确认新密码
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="panel-primary" disabled={busy}>
        {busy ? "修改中…" : "修改密码"}
      </button>
    </form>
  );
}

const titles: Record<WorkspacePanel, [string, string]> = {
  help: ["使用帮助", "HELP"],
  preferences: ["偏好设置", "PREFERENCES"],
  notifications: ["通知中心", "NOTIFICATIONS"],
  recharge: ["创作点充值", "MOCK PAYMENT"],
  account: ["账号中心", "ACCOUNT"],
  profile: ["个人资料", "PROFILE"],
  security: ["账号与密码", "SECURITY"],
};
export function WorkspacePanelDrawer({
  panel,
  onClose,
  onChange,
  onUnread,
}: {
  panel: WorkspacePanel;
  onClose: () => void;
  onChange: (panel: WorkspacePanel) => void;
  onUnread: (count: number) => void;
}) {
  const [title, eyebrow] = titles[panel];
  return (
    <Drawer title={title} eyebrow={eyebrow} onClose={onClose}>
      {panel === "help" && <HelpPanel />}
      {panel === "preferences" && <PreferencesPanel />}
      {panel === "notifications" && <NotificationsPanel onUnread={onUnread} />}
      {panel === "recharge" && <RechargePanel />}
      {panel === "account" && <AccountPanel open={onChange} />}
      {panel === "profile" && <ProfilePanel />}
      {panel === "security" && <SecurityPanel />}
    </Drawer>
  );
}
