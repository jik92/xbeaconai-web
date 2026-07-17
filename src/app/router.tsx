import { createRootRoute, createRoute, createRouter, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/domain/app-shell";
import { ModulePage } from "@/components/domain/module-page";
import { RemixProject } from "@/features/video-remix/remix-project";
import { defaultPath, modules } from "./routes";

const rootRoute=createRootRoute({component:AppShell});
const indexRoute=createRoute({getParentRoute:()=>rootRoute,path:"/",component:()=> <Navigate to={defaultPath}/>});
const moduleRoutes=modules.map(config=>createRoute({getParentRoute:()=>rootRoute,path:config.path,component:()=> config.id==="video-remix"?<RemixProject/>:<ModulePage config={config}/> }));
const routeTree=rootRoute.addChildren([indexRoute,...moduleRoutes]);
export const router=createRouter({routeTree,defaultPreload:"intent"});
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
