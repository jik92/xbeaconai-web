import { createRootRoute, createRoute, createRouter, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/domain/app-shell";
import { ComingSoonPage, ProjectComingSoonPage } from "@/components/domain/coming-soon-page";
import { ModulePage } from "@/components/domain/module-page";
import { AiGeneratePage } from "@/features/ai-generate/ai-generate-page";
import { PortraitLibrary } from "@/features/portrait-library/portrait-library";
import { RemixProject } from "@/features/video-remix/remix-project";
import { isAssetOpen, isModuleOpen } from "./config";
import { homeDestination, modules } from "./routes";

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () =>
    homeDestination.kind === "route" ? <Navigate to={homeDestination.path} /> : <ProjectComingSoonPage />,
});
const moduleRoutes = modules.map((config) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: config.path,
    component: () =>
      !isModuleOpen(config.id) ? (
        <ComingSoonPage config={config} />
      ) : config.id === "video-remix" ? (
        <RemixProject />
      ) : config.id === "ai-generate" ? (
        <AiGeneratePage />
      ) : (
        <ModulePage config={config} />
      ),
  }),
);
const portraitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/portraits",
  component: () =>
    isAssetOpen("portraits") ? <PortraitLibrary /> : <ComingSoonPage config={{ id: "portraits", label: "人像库" }} />,
});
const routeTree = rootRoute.addChildren([indexRoute, ...moduleRoutes, portraitRoute]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
