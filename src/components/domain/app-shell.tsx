import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, CircleHelp, Coins, Command, Images, PanelLeftClose, Search, Settings2 } from "lucide-react";
import { modules } from "@/app/routes";
import { useAuth } from "@/features/account/auth-context";
import { AuthScreen } from "@/features/account/auth-screen";
import { WorkspacePanelDrawer, type WorkspacePanel } from "@/features/account/workspace-panels";
import { listNotifications } from "@/api/generated/sdk.gen";

export function AppShell() {
  const path=useRouterState({select:s=>s.location.pathname});
  const {status,user}=useAuth();const [panel,setPanel]=useState<WorkspacePanel>(),[unread,setUnread]=useState(0);
  useEffect(()=>{if(status!=="authenticated")setPanel(undefined)},[status]);
  useEffect(()=>{if(status!=="authenticated")return;const refresh=()=>void listNotifications({throwOnError:true}).then(({data})=>setUnread(data?.unreadCount??0)).catch(()=>{});refresh();const timer=window.setInterval(refresh,5_000);return()=>window.clearInterval(timer)},[status]);
  if(status==="loading")return <main className="auth-page"><div className="app-loading"><Command/>正在打开曜作工作台…</div></main>;
  if(status==="anonymous"||!user)return <AuthScreen/>;
  return <div className="app-frame"><header className="topbar"><div className="brand"><div className="brand-mark"><Command size={19}/></div><div><b>曜作</b><span>CREATIVE OPS</span></div></div><div className="global-search"><Search size={16}/><input placeholder="搜索作品、任务或素材"/><kbd>⌘ K</kbd></div><div className="top-actions"><button className="credits" onClick={()=>setPanel("recharge")}><Coins size={16}/><span>{user.credits.toLocaleString()}</span><b>充值</b></button><button aria-label="帮助" onClick={()=>setPanel("help")}><CircleHelp/></button><button aria-label="通知" className={unread?"has-dot":""} onClick={()=>setPanel("notifications")}><Bell/></button><button className="avatar" aria-label="个人账号" onClick={()=>setPanel("account")}>{user.avatarText}</button></div></header>
  <aside className="sidebar"><button className="collapse"><PanelLeftClose size={16}/>收起导航</button>{(["创作工作流","AI 工具箱"] as const).map(group=><nav key={group}><h3>{group}</h3>{modules.filter(m=>m.group===group).map(m=><Link key={m.id} to={m.path} aria-label={m.label} className={path===m.path?"active":""}><m.icon/><span>{m.label}</span>{m.id==="video-remix"&&<i>HOT</i>}</Link>)}</nav>)}<nav><h3>资产</h3><Link to="/assets/portraits" aria-label="人像库" className={path==="/assets/portraits"?"active":""}><Images/><span>人像库</span><i>1125</i></Link></nav><div className="sidebar-foot"><button onClick={()=>setPanel("preferences")}><Settings2/>偏好设置</button><small>曜作工作台 v0.1</small></div></aside>
  <main className="content"><Outlet/></main>{panel&&<WorkspacePanelDrawer panel={panel} onClose={()=>setPanel(undefined)} onChange={setPanel} onUnread={setUnread}/>}</div>;
}
