import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, ChevronDown, CircleHelp, Coins, Command, Menu, PanelLeftClose, Search, Settings2 } from "lucide-react";
import { modules } from "@/app/routes";

export function AppShell() {
  const path=useRouterState({select:s=>s.location.pathname});
  return <div className="app-frame"><header className="topbar"><div className="brand"><div className="brand-mark"><Command size={19}/></div><div><b>曜作</b><span>CREATIVE OPS</span></div></div><button className="top-menu"><Menu size={17}/>创作中心<ChevronDown size={14}/></button><div className="global-search"><Search size={16}/><input placeholder="搜索作品、任务或素材"/><kbd>⌘ K</kbd></div><div className="top-actions"><button className="credits"><Coins size={16}/><span>2,480</span><b>充值</b></button><button aria-label="帮助"><CircleHelp/></button><button aria-label="通知" className="has-dot"><Bell/></button><div className="avatar">曜</div></div></header>
  <aside className="sidebar"><button className="collapse"><PanelLeftClose size={16}/>收起导航</button>{(["创作工作流","AI 工具箱"] as const).map(group=><nav key={group}><h3>{group}</h3>{modules.filter(m=>m.group===group).map(m=><Link key={m.id} to={m.path} className={path===m.path?"active":""}><m.icon/><span>{m.label}</span>{m.id==="video-remix"&&<i>HOT</i>}</Link>)}</nav>)}<div className="sidebar-foot"><button><Settings2/>偏好设置</button><small>曜作工作台 v0.1</small></div></aside>
  <main className="content"><Outlet/></main></div>;
}
