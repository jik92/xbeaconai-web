import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, CircleHelp, Coins, Images, PanelLeftClose, PanelLeftOpen, Search, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { listNotifications } from "@/api/generated/sdk.gen";
import { APP_CONFIG, isAssetOpen, isModuleOpen } from "@/app/config";
import { modules } from "@/app/routes";
import { useAuth } from "@/features/account/auth-context";
import { AuthScreen } from "@/features/account/auth-screen";
import { type WorkspacePanel, WorkspacePanelDrawer } from "@/features/account/workspace-panels";
import { BrandLogo } from "./brand-logo";

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { status, user } = useAuth();
  const [panel, setPanel] = useState<WorkspacePanel>(),
    [unread, setUnread] = useState(0),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => window.localStorage.getItem("sidebar-collapsed") === "true",
    );
  useEffect(() => {
    if (status !== "authenticated") setPanel(undefined);
  }, [status]);
  useEffect(() => {
    if (status !== "authenticated") return;
    const refresh = () =>
      void listNotifications({ throwOnError: true })
        .then(({ data }) => setUnread(data?.unreadCount ?? 0))
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(() => {
    window.localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  if (status === "loading")
    return (
      <main className="auth-page">
        <div className="app-loading">
          <BrandLogo className="loading-logo" />
          正在打开{APP_CONFIG.projectName}工作台…
        </div>
      </main>
    );
  if (status === "anonymous" || !user) return <AuthScreen />;
  return (
    <div className={`app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <BrandLogo className="brand-mark" />
          <div>
            <b>{APP_CONFIG.projectName}</b>
            <span>CREATIVE OPS</span>
          </div>
        </div>
        <div className="global-search">
          <Search size={16} />
          <input placeholder="搜索作品、任务或素材" />
          <kbd>⌘ K</kbd>
        </div>
        <div className="top-actions">
          <button className="credits" onClick={() => setPanel("recharge")}>
            <Coins size={16} />
            <span>{user.credits.toLocaleString()}</span>
            <b>充值</b>
          </button>
          <button aria-label="帮助" onClick={() => setPanel("help")}>
            <CircleHelp />
          </button>
          <button aria-label="通知" className={unread ? "has-dot" : ""} onClick={() => setPanel("notifications")}>
            <Bell />
          </button>
          <button className="avatar" aria-label="个人账号" onClick={() => setPanel("account")}>
            {user.avatarText}
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <button
          type="button"
          className="collapse"
          aria-label={sidebarCollapsed ? "展开导航" : "收起导航"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "展开导航" : "收起导航"}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span>{sidebarCollapsed ? "展开导航" : "收起导航"}</span>
        </button>
        {(["创作工作流", "AI 工具箱"] as const).map((group) => (
          <nav key={group}>
            <h3>{group}</h3>
            {modules
              .filter((m) => m.group === group)
              .map((m) =>
                isModuleOpen(m.id) ? (
                  <Link
                    key={m.id}
                    to={m.path}
                    aria-label={m.label}
                    title={sidebarCollapsed ? m.label : undefined}
                    className={path === m.path ? "active" : ""}
                  >
                    <m.icon />
                    <span>{m.label}</span>
                    {m.id === "video-remix" && <i>HOT</i>}
                  </Link>
                ) : (
                  <div
                    key={m.id}
                    className="sidebar-coming-soon"
                    aria-label={`${m.label} Coming Soon`}
                    aria-disabled="true"
                    title={sidebarCollapsed ? `${m.label}（即将上线）` : "等待产品验收"}
                  >
                    <m.icon />
                    <span>{m.label}</span>
                    <i>Coming Soon</i>
                  </div>
                ),
              )}
          </nav>
        ))}
        <nav>
          <h3>资产</h3>
          {isAssetOpen("portraits") ? (
            <Link
              to="/assets/portraits"
              aria-label="人像库"
              title={sidebarCollapsed ? "人像库" : undefined}
              className={path === "/assets/portraits" ? "active" : ""}
            >
              <Images />
              <span>人像库</span>
              <i>1125</i>
            </Link>
          ) : (
            <div
              className="sidebar-coming-soon"
              aria-label="人像库 Coming Soon"
              aria-disabled="true"
              title="等待产品验收"
            >
              <Images />
              <span>人像库</span>
              <i>Coming Soon</i>
            </div>
          )}
        </nav>
        <div className="sidebar-foot">
          <button
            type="button"
            aria-label="偏好设置"
            title={sidebarCollapsed ? "偏好设置" : undefined}
            onClick={() => setPanel("preferences")}
          >
            <Settings2 />
            偏好设置
          </button>
          <small>{APP_CONFIG.projectName}工作台 v0.1</small>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      {panel && (
        <WorkspacePanelDrawer
          panel={panel}
          onClose={() => setPanel(undefined)}
          onChange={setPanel}
          onUnread={setUnread}
        />
      )}
    </div>
  );
}
