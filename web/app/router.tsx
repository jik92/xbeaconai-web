import { createRootRoute, createRoute, createRouter, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/domain/app-shell";
import { ComingSoonPage, ProjectComingSoonPage } from "@/components/domain/coming-soon-page";
import { ModulePage } from "@/components/domain/module-page";
import { AdScriptPage } from "@/features/ad-script/ad-script-page";
import { AdminPage } from "@/features/admin/admin-page";
import { AiGeneratePage } from "@/features/ai-generate/ai-generate-page";
import { AssetLibrary } from "@/features/asset-library/asset-library";
import { AiBillingPage } from "@/features/billing/ai-billing-page";
import { MediaUnderstandPage } from "@/features/media-understand/media-understand-page";
import { PortraitLibrary } from "@/features/portrait-library/portrait-library";
import { ProviderFeatureGate } from "@/features/provider/provider-feature-gate";
import { QianchuanMerchantBindingPage } from "@/features/qianchuan/qianchuan-merchant-binding-page";
import { QianchuanPcDeliveryPage } from "@/features/qianchuan/qianchuan-pc-delivery-page";
import { SceneLibrary } from "@/features/scene-library/scene-library";
import { VideoCreatePage } from "@/features/video-create/video-create-page";
import { VideoEditorPage } from "@/features/video-editor/video-editor-page";
import { VideoExtractPage } from "@/features/video-extract/video-extract-page";
import { VideoMashupPage } from "@/features/video-mashup/video-mashup-page";
import { RemixProject } from "@/features/video-remix/remix-project";
import { isAssetOpen, isDeliveryOpen, isModuleOpen } from "./config";
import { homeDestination, modules } from "./routes";

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () =>
    homeDestination.kind === "route" ? <Navigate to={homeDestination.path} /> : <ProjectComingSoonPage />,
});
function ModuleRouteContent({ config }: { config: (typeof modules)[number] }) {
  if (!isModuleOpen(config.id)) return <ComingSoonPage config={config} />;
  const content =
    config.id === "video-remix" ? (
      <RemixProject />
    ) : config.id === "video-create" ? (
      <VideoCreatePage />
    ) : config.id === "ad-script" ? (
      <AdScriptPage />
    ) : config.id === "ai-generate" ? (
      <AiGeneratePage />
    ) : config.id === "media-understand" ? (
      <MediaUnderstandPage />
    ) : config.id === "video-extract" ? (
      <VideoExtractPage />
    ) : config.id === "video-editor" ? (
      <VideoEditorPage />
    ) : config.id === "video-mashup" ? (
      <VideoMashupPage />
    ) : (
      <ModulePage config={config} />
    );
  return <ProviderFeatureGate moduleId={config.id}>{content}</ProviderFeatureGate>;
}
const moduleRoutes = modules.map((config) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: config.path,
    component: () => <ModuleRouteContent config={config} />,
  }),
);
const portraitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/portraits",
  component: () =>
    isAssetOpen("portraits") ? <PortraitLibrary /> : <ComingSoonPage config={{ id: "portraits", label: "人像库" }} />,
});
const materialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/materials",
  component: () =>
    isAssetOpen("materials") ? (
      <AssetLibrary kind="media" />
    ) : (
      <ComingSoonPage config={{ id: "materials", label: "素材库" }} />
    ),
});
const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/products",
  component: () =>
    isAssetOpen("products") ? (
      <AssetLibrary kind="product" />
    ) : (
      <ComingSoonPage config={{ id: "products", label: "商品库" }} />
    ),
});
const sceneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/scenes",
  component: () =>
    isAssetOpen("scenes") ? <SceneLibrary /> : <ComingSoonPage config={{ id: "scenes", label: "场景库" }} />,
});
const voiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/voices",
  component: () =>
    isAssetOpen("voices") ? (
      <AssetLibrary kind="voice" />
    ) : (
      <ComingSoonPage config={{ id: "voices", label: "音色库" }} />
    ),
});
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
});
const aiBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/billing/ai",
  component: AiBillingPage,
});
const qianchuanMerchantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/delivery/qianchuan-merchants",
  component: () =>
    isDeliveryOpen("qianchuan-merchants") ? (
      <QianchuanMerchantBindingPage />
    ) : (
      <ComingSoonPage config={{ id: "qianchuan-merchants", label: "千川商户绑定" }} />
    ),
});
const qianchuanPcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/delivery/qianchuan-pc",
  component: () =>
    isDeliveryOpen("qianchuan-pc") ? (
      <QianchuanPcDeliveryPage />
    ) : (
      <ComingSoonPage config={{ id: "qianchuan-pc", label: "千川PC投放" }} />
    ),
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  ...moduleRoutes,
  materialRoute,
  portraitRoute,
  productRoute,
  sceneRoute,
  voiceRoute,
  aiBillingRoute,
  qianchuanMerchantsRoute,
  qianchuanPcRoute,
  adminRoute,
]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
