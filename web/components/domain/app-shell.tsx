import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  Coins,
  Eye,
  EyeOff,
  Files,
  GripVertical,
  Images,
  LockKeyhole,
  LogOut,
  type LucideIcon,
  Megaphone,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  ReceiptText,
  RotateCcw,
  Settings2,
  Store,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fetchLibraryAssets, fetchProducts } from "@/api/api-client";
import { listNotifications } from "@/api/generated/sdk.gen";
import { APP_CONFIG, type AssetFeatureId, isAssetOpen, isDeliveryOpen, isModuleOpen } from "@/app/config";
import { modules } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/features/account/auth-context";
import { AuthScreen } from "@/features/account/auth-screen";
import { type WorkspacePanel, WorkspacePanelDrawer } from "@/features/account/workspace-panels";
import { fetchPortraits } from "@/features/portrait-library/portrait-data";
import { moduleProviderAvailability, useProviderFeatures } from "@/features/provider/provider-features";
import { sceneCatalog } from "../../../shared/scenes/scene-catalog";
import { BrandLogo } from "./brand-logo";
import { GlobalSearch } from "./global-search";
import {
  createDefaultSidebarMenuPreferences,
  isSidebarMenuItemHidden,
  moveSidebarMenuItem,
  normalizeSidebarMenuPreferences,
  reorderSidebarMenuItem,
  setSidebarMenuItemVisibility,
} from "./sidebar-menu-preferences";

const SIDEBAR_MENU_STORAGE_KEY = "yaozuo:sidebar-menu:v2";
const SIDEBAR_GROUP_STORAGE_KEY = "yaozuo:sidebar-groups:v1";
const SIDEBAR_GROUPS = ["创作工作流", "AI 工具箱", "实用工具", "投放", "资产"] as const;
type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

interface SidebarMenuItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  available: boolean;
}

const ASSET_MENU_ITEMS = [
  { id: "materials", path: "/assets/materials", label: "素材库", icon: Files },
  { id: "portraits", path: "/assets/portraits", label: "人像库", icon: Images },
  { id: "products", path: "/assets/products", label: "商品库", icon: Package },
  { id: "scenes", path: "/assets/scenes", label: "场景库", icon: PanelsTopLeft },
  { id: "voices", path: "/assets/voices", label: "音色库", icon: AudioLines },
] as const;

const SCRIPT_REMIX_MENU_ITEM: SidebarMenuItem = {
  id: "script-remix",
  path: "/aigc/script-remix",
  label: "脚本二创",
  icon: Clapperboard,
  available: true,
};

export function assetSidebarCounts(input: {
  materials?: readonly unknown[];
  portraits?: readonly unknown[];
  products?: readonly unknown[];
  scenes?: readonly unknown[];
  voices?: readonly unknown[];
}): Partial<Record<AssetFeatureId, string>> {
  return Object.fromEntries(
    (Object.entries(input) as Array<[AssetFeatureId, readonly unknown[] | undefined]>)
      .filter((entry): entry is [AssetFeatureId, readonly unknown[]] => entry[1] !== undefined)
      .map(([id, items]) => [id, String(items.length)]),
  );
}

const sidebarMenuItems: Record<SidebarGroup, SidebarMenuItem[]> = {
  创作工作流: modules
    .filter((item) => item.group === "创作工作流")
    .map((item) => ({ ...item, id: `module:${item.id}`, available: isModuleOpen(item.id) }))
    .flatMap((item) => (item.id === "module:video-remix" ? [item, SCRIPT_REMIX_MENU_ITEM] : [item])),
  "AI 工具箱": modules
    .filter((item) => item.group === "AI 工具箱")
    .map((item) => ({ ...item, id: `module:${item.id}`, available: isModuleOpen(item.id) })),
  实用工具: modules
    .filter((item) => item.group === "实用工具")
    .map((item) => ({ ...item, id: `module:${item.id}`, available: isModuleOpen(item.id) })),
  投放: [
    {
      id: "delivery:qianchuan-merchants",
      path: "/delivery/qianchuan-merchants",
      label: "千川商户绑定",
      icon: Store,
      available: isDeliveryOpen("qianchuan-merchants"),
    },
    {
      id: "delivery:qianchuan-pc",
      path: "/delivery/qianchuan-pc",
      label: "千川PC投放",
      icon: Megaphone,
      available: isDeliveryOpen("qianchuan-pc"),
    },
  ],
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

function loadExpandedSidebarGroups() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SIDEBAR_GROUP_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return new Set<SidebarGroup>();
    return new Set(saved.filter((group): group is SidebarGroup => SIDEBAR_GROUPS.includes(group as SidebarGroup)));
  } catch {
    return new Set<SidebarGroup>();
  }
}

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { status, user, logout } = useAuth();
  const providerFeatures = useProviderFeatures(status === "authenticated");
  const assetQueriesEnabled = status === "authenticated";
  const materials = useQuery({
    queryKey: ["asset-library", "media", ""],
    queryFn: () => fetchLibraryAssets("media"),
    enabled: assetQueriesEnabled && isAssetOpen("materials"),
    staleTime: 30_000,
  });
  const portraits = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    enabled: assetQueriesEnabled && isAssetOpen("portraits"),
    staleTime: Infinity,
  });
  const products = useQuery({
    queryKey: ["product-library"],
    queryFn: fetchProducts,
    enabled: assetQueriesEnabled && isAssetOpen("products"),
    staleTime: 30_000,
  });
  const voices = useQuery({
    queryKey: ["asset-library", "voice"],
    queryFn: () => fetchLibraryAssets("voice"),
    enabled: assetQueriesEnabled && isAssetOpen("voices"),
    staleTime: 30_000,
  });
  const assetCounts = assetSidebarCounts({
    materials: materials.data,
    portraits: portraits.data,
    products: products.data,
    scenes: sceneCatalog,
    voices: voices.data,
  });
  const runtimeAvailability = (item: SidebarMenuItem) => {
    if (!item.id.startsWith("module:")) return undefined;
    return moduleProviderAvailability(providerFeatures.data, item.id.slice(7) as (typeof modules)[number]["id"]);
  };
  const [panel, setPanel] = useState<WorkspacePanel>(),
    [unread, setUnread] = useState(0),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => window.localStorage.getItem("sidebar-collapsed") === "true",
    ),
    [expandedSidebarGroups, setExpandedSidebarGroups] = useState(loadExpandedSidebarGroups),
    [menuEditing, setMenuEditing] = useState(false),
    [menuPreferences, setMenuPreferences] = useState(loadSidebarMenuPreferences),
    [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const searchPages = SIDEBAR_GROUPS.flatMap((group) =>
    menuPreferences.order[group]
      .map((itemId) => sidebarMenuItems[group].find((item) => item.id === itemId))
      .filter((item): item is SidebarMenuItem => Boolean(item))
      .filter((item) => !isSidebarMenuItemHidden(menuPreferences, item.id, item.available))
      .filter((item) => !item.id.startsWith("module:") || runtimeAvailability(item)?.enabled === true)
      .map((item) => ({ id: item.id, label: item.label, path: item.path, group })),
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
    if (sidebarCollapsed) setMenuEditing(false);
  }, [sidebarCollapsed]);
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_GROUP_STORAGE_KEY, JSON.stringify([...expandedSidebarGroups]));
  }, [expandedSidebarGroups]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_MENU_STORAGE_KEY, JSON.stringify(menuPreferences));
    } catch {
      // The navigation remains usable if private browsing blocks local storage writes.
    }
  }, [menuPreferences]);
  if (status === "loading")
    return (
      <main className="grid min-h-screen place-items-center bg-surface font-sans">
        <div className="flex items-center gap-2 type-helper text-muted">
          <BrandLogo className="w-9 rounded-md" />
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
        <GlobalSearch pages={searchPages} />
        <div className="top-actions">
          <Button variant="ghost" size="sm" className="credits" onClick={() => setPanel("recharge")}>
            <Coins size={16} />
            <span>{user.credits.toLocaleString()}</span>
            <b>充值</b>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-[34px]"
            aria-label="帮助"
            onClick={() => setPanel("help")}
          >
            <CircleHelp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="通知"
            className={`size-[34px]${unread ? " has-dot" : ""}`}
            onClick={() => setPanel("notifications")}
          >
            <Bell />
          </Button>
          <Popover open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="account-trigger" aria-label="打开用户菜单">
                <span className="truncate">{user.displayName || user.phone}</span>
                <ChevronDown className="size-3.5 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-60 p-2" role="menu" aria-label="用户菜单">
              <div className="border-b border-line px-2 py-2">
                <b className="block truncate type-body-strong">{user.displayName || user.phone}</b>
                <span className="block truncate type-helper text-muted">{user.phone}</span>
                <small className="mt-1 block type-helper text-muted">{user.credits.toLocaleString()} 创作点</small>
              </div>
              <div className="grid gap-1 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  className="flex h-9 w-full items-center justify-start gap-2 rounded-md px-2 text-left type-body text-ink hover:bg-surface-muted"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setPanel("profile");
                  }}
                >
                  <UserRound className="size-4" />
                  个人资料
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  className="flex h-9 w-full items-center justify-start gap-2 rounded-md px-2 text-left type-body text-ink hover:bg-surface-muted"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setPanel("security");
                  }}
                >
                  <LockKeyhole className="size-4" />
                  账号与密码
                </Button>
                <Link
                  to="/billing/ai"
                  role="menuitem"
                  className="flex h-9 items-center gap-2 rounded-md px-2 type-body text-ink hover:bg-surface-muted"
                  onClick={() => setAccountMenuOpen(false)}
                >
                  <ReceiptText className="size-4" />
                  AI账单
                </Link>
                {user.isAdmin && (
                  <Link
                    to="/admin"
                    role="menuitem"
                    className="flex h-9 items-center gap-2 rounded-md px-2 type-body text-ink hover:bg-surface-muted"
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    <Settings2 className="size-4" />
                    管理后台
                  </Link>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                role="menuitem"
                className="flex h-9 w-full items-center justify-start gap-2 border-t border-line px-2 pt-2 text-left type-body text-error hover:bg-surface-muted"
                onClick={() => {
                  setAccountMenuOpen(false);
                  void logout();
                }}
              >
                <LogOut className="size-4" />
                退出登录
              </Button>
            </PopoverContent>
          </Popover>
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
            const groupExpanded = expandedSidebarGroups.has(group);
            return (
              <nav
                key={group}
                aria-label={group}
                className={!groupExpanded && !sidebarCollapsed ? "sidebar-group-collapsed" : undefined}
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="sidebar-group-trigger"
                  aria-expanded={groupExpanded}
                  onClick={() =>
                    setExpandedSidebarGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                >
                  <span>{group}</span>
                  {groupExpanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
                {groupItems.map((item, index) => {
                  const hidden = isSidebarMenuItemHidden(menuPreferences, item.id, item.available);
                  const providerAvailability = runtimeAvailability(item);
                  const providerEnabled = !item.id.startsWith("module:") || providerAvailability?.enabled === true;
                  const assetCount = item.id.startsWith("asset:")
                    ? assetCounts[item.id.slice(6) as AssetFeatureId]
                    : undefined;
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
                          <Button
                            type="button"
                            aria-label={`上移${item.label}`}
                            title="上移"
                            disabled={index === 0}
                            onClick={() =>
                              setMenuPreferences((current) => moveSidebarMenuItem(current, group, item.id, -1))
                            }
                          >
                            <ChevronUp />
                          </Button>
                          <Button
                            type="button"
                            aria-label={`下移${item.label}`}
                            title="下移"
                            disabled={index === groupItems.length - 1}
                            onClick={() =>
                              setMenuPreferences((current) => moveSidebarMenuItem(current, group, item.id, 1))
                            }
                          >
                            <ChevronDown />
                          </Button>
                          <Button
                            type="button"
                            aria-label={`${hidden ? "显示" : "隐藏"}${item.label}`}
                            title={hidden ? "显示菜单" : "隐藏菜单"}
                            onClick={() =>
                              setMenuPreferences((current) => setSidebarMenuItemVisibility(current, item.id, hidden))
                            }
                          >
                            {hidden ? <EyeOff /> : <Eye />}
                          </Button>
                        </div>
                      </fieldset>
                    );
                  return item.available && providerEnabled ? (
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
                      {assetCount !== undefined && <i>{assetCount}</i>}
                    </Link>
                  ) : item.available ? (
                    <Button
                      type="button"
                      key={item.id}
                      className="sidebar-coming-soon"
                      aria-label={`${item.label} 不可用`}
                      aria-disabled="true"
                      title={providerAvailability?.disabledReason ?? "Provider 尚未检测通过"}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                      <i>不可用</i>
                    </Button>
                  ) : (
                    <Button
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
                    </Button>
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
              <Button
                type="button"
                onClick={() => setMenuPreferences(createDefaultSidebarMenuPreferences(defaultSidebarMenuOrder))}
              >
                <RotateCcw size={13} />
                恢复默认
              </Button>
            </div>
          )}
          <div className="sidebar-footer-actions">
            <Button
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
            </Button>
            <Button
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
            </Button>
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
