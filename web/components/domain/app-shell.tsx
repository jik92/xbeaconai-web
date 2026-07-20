import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Coins,
  Eye,
  EyeOff,
  Files,
  GripVertical,
  Images,
  type LucideIcon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { listNotifications } from "@/api/generated/sdk.gen";
import { APP_CONFIG, isAssetOpen, isModuleOpen } from "@/app/config";
import { modules } from "@/app/routes";
import { useAuth } from "@/features/account/auth-context";
import { AuthScreen } from "@/features/account/auth-screen";
import { type WorkspacePanel, WorkspacePanelDrawer } from "@/features/account/workspace-panels";
import { BrandLogo } from "./brand-logo";
import {
  createDefaultSidebarMenuPreferences,
  moveSidebarMenuItem,
  normalizeSidebarMenuPreferences,
  reorderSidebarMenuItem,
  toggleSidebarMenuItem,
} from "./sidebar-menu-preferences";

const SIDEBAR_MENU_STORAGE_KEY = "yaozuo:sidebar-menu:v1";
const SIDEBAR_GROUPS = ["创作工作流", "AI 工具箱", "资产"] as const;
type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

interface SidebarMenuItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
  available: boolean;
}

const ASSET_MENU_ITEMS = [
  { id: "materials", path: "/assets/materials", label: "素材库", icon: Files, badge: undefined },
  { id: "portraits", path: "/assets/portraits", label: "人像库", icon: Images, badge: "1125" },
  { id: "products", path: "/assets/products", label: "商品库", icon: Package, badge: undefined },
  { id: "voices", path: "/assets/voices", label: "音色库", icon: AudioLines, badge: undefined },
] as const;

const sidebarMenuItems: Record<SidebarGroup, SidebarMenuItem[]> = {
  创作工作流: modules
    .filter((item) => item.group === "创作工作流")
    .map((item) => ({ ...item, id: `module:${item.id}`, available: isModuleOpen(item.id) })),
  "AI 工具箱": modules
    .filter((item) => item.group === "AI 工具箱")
    .map((item) => ({ ...item, id: `module:${item.id}`, available: isModuleOpen(item.id) })),
  资产: ASSET_MENU_ITEMS.map((item) => ({
    ...item,
    id: `asset:${item.id}`,
    available: isAssetOpen(item.id),
  })),
};

const defaultSidebarMenuOrder = Object.fromEntries(
  SIDEBAR_GROUPS.map((group) => [group, sidebarMenuItems[group].map((item) => item.id)]),
) as Record<SidebarGroup, string[]>;

function loadSidebarMenuPreferences() {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_MENU_STORAGE_KEY);
    return normalizeSidebarMenuPreferences(saved ? JSON.parse(saved) : undefined, defaultSidebarMenuOrder);
  } catch {
    return createDefaultSidebarMenuPreferences(defaultSidebarMenuOrder);
  }
}

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { status, user } = useAuth();
  const [panel, setPanel] = useState<WorkspacePanel>(),
    [unread, setUnread] = useState(0),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => window.localStorage.getItem("sidebar-collapsed") === "true",
    ),
    [menuEditing, setMenuEditing] = useState(false),
    [menuPreferences, setMenuPreferences] = useState(loadSidebarMenuPreferences);

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
    if (sidebarCollapsed) setMenuEditing(false);
  }, [sidebarCollapsed]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_MENU_STORAGE_KEY, JSON.stringify(menuPreferences));
    } catch {
      // The navigation remains usable if private browsing blocks local storage writes.
    }
  }, [menuPreferences]);

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
          </div>
        </div>
        <div className="global-search">
          <Search size={16} />
          <input placeholder="搜索作品、任务或素材" />
          <kbd>⌘ K</kbd>
        </div>
        <div className="top-actions">
          <button type="button" className="credits" onClick={() => setPanel("recharge")}>
            <Coins size={16} />
            <span>{user.credits.toLocaleString()}</span>
            <b>充值</b>
          </button>
          <button type="button" aria-label="帮助" onClick={() => setPanel("help")}>
            <CircleHelp />
          </button>
          <button
            type="button"
            aria-label="通知"
            className={unread ? "has-dot" : ""}
            onClick={() => setPanel("notifications")}
          >
            <Bell />
          </button>
          <button type="button" className="avatar" aria-label="个人账号" onClick={() => setPanel("account")}>
            {user.avatarText}
          </button>
        </div>
      </header>
      <aside
        className="sidebar navigation-drawer"
        aria-label="主导航抽屉"
        data-display-mode={sidebarCollapsed ? "icon-tooltip" : "icon-title"}
      >
        <div className="sidebar-navigation">
          {SIDEBAR_GROUPS.map((group) => {
            const groupItems = menuPreferences.order[group]
              .map((itemId) => sidebarMenuItems[group].find((item) => item.id === itemId))
              .filter((item): item is SidebarMenuItem => Boolean(item));
            return (
              <nav key={group} aria-label={group}>
                <h3>{group}</h3>
                {groupItems.map((item, index) => {
                  const hidden = menuPreferences.hidden.includes(item.id);
                  if (hidden && !menuEditing) return null;
                  if (menuEditing)
                    return (
                      <fieldset
                        key={item.id}
                        aria-label={`编辑${item.label}`}
                        className={`sidebar-edit-item${hidden ? " hidden-item" : ""}`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", item.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const draggedId = event.dataTransfer.getData("text/plain");
                          setMenuPreferences((current) => reorderSidebarMenuItem(current, group, draggedId, item.id));
                        }}
                      >
                        <GripVertical className="menu-drag-handle" aria-hidden="true" />
                        <item.icon />
                        <span>{item.label}</span>
                        <div className="menu-item-actions">
                          <button
                            type="button"
                            aria-label={`上移${item.label}`}
                            title="上移"
                            disabled={index === 0}
                            onClick={() =>
                              setMenuPreferences((current) => moveSidebarMenuItem(current, group, item.id, -1))
                            }
                          >
                            <ChevronUp />
                          </button>
                          <button
                            type="button"
                            aria-label={`下移${item.label}`}
                            title="下移"
                            disabled={index === groupItems.length - 1}
                            onClick={() =>
                              setMenuPreferences((current) => moveSidebarMenuItem(current, group, item.id, 1))
                            }
                          >
                            <ChevronDown />
                          </button>
                          <button
                            type="button"
                            aria-label={`${hidden ? "显示" : "隐藏"}${item.label}`}
                            title={hidden ? "显示菜单" : "隐藏菜单"}
                            onClick={() => setMenuPreferences((current) => toggleSidebarMenuItem(current, item.id))}
                          >
                            {hidden ? <EyeOff /> : <Eye />}
                          </button>
                        </div>
                      </fieldset>
                    );
                  return item.available ? (
                    <Link
                      key={item.id}
                      to={item.path}
                      aria-label={item.label}
                      title={sidebarCollapsed ? item.label : undefined}
                      className={path === item.path ? "active" : ""}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                      {item.id === "module:video-remix" && <i>HOT</i>}
                      {item.badge && <i>{item.badge}</i>}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      key={item.id}
                      className="sidebar-coming-soon"
                      aria-label={`${item.label} Coming Soon`}
                      aria-disabled="true"
                      title={sidebarCollapsed ? `${item.label}（即将上线）` : "等待产品验收"}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                      <i>Coming Soon</i>
                    </button>
                  );
                })}
              </nav>
            );
          })}
        </div>
        <footer className="sidebar-footer">
          {menuEditing && (
            <div className="menu-edit-hint">
              <span>拖拽或使用箭头调整分组内顺序</span>
              <button
                type="button"
                onClick={() => setMenuPreferences(createDefaultSidebarMenuPreferences(defaultSidebarMenuOrder))}
              >
                <RotateCcw size={13} />
                恢复默认
              </button>
            </div>
          )}
          <div className="sidebar-footer-actions">
            <button
              type="button"
              className={`menu-edit-toggle${menuEditing ? " active" : ""}`}
              aria-label={menuEditing ? "完成菜单编辑" : "编辑菜单"}
              aria-pressed={menuEditing}
              title={sidebarCollapsed ? "编辑菜单" : undefined}
              onClick={() => {
                if (sidebarCollapsed) {
                  setSidebarCollapsed(false);
                  setMenuEditing(true);
                  return;
                }
                setMenuEditing((editing) => !editing);
              }}
            >
              {menuEditing ? <Check size={16} /> : <Settings2 size={16} />}
              <span>{menuEditing ? "完成" : "编辑菜单"}</span>
            </button>
            <button
              type="button"
              className="drawer-toggle"
              aria-label={sidebarCollapsed ? "展开导航，显示图标和标题" : "收起导航，仅显示图标"}
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? "展开导航" : "收起导航"}
              onClick={() => {
                if (!sidebarCollapsed) setMenuEditing(false);
                setSidebarCollapsed((collapsed) => !collapsed);
              }}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
        </footer>
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
