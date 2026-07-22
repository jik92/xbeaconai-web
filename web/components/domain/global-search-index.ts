import type { Job } from "@/api/generated/types.gen";
import type { LibraryAsset, LibraryProduct } from "@/entities/types";
import type { Portrait } from "@/features/portrait-library/portrait-data";

export interface GlobalSearchPage {
  id: string;
  label: string;
  path: string;
  group: string;
}

export interface GlobalSearchSources {
  pages: GlobalSearchPage[];
  jobs?: Job[];
  materials?: LibraryAsset[];
  products?: LibraryProduct[];
  voices?: LibraryAsset[];
  portraits?: Portrait[];
}

export type GlobalSearchResultKind = "page" | "task" | "material" | "product" | "voice" | "portrait";

export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchResultKind;
  section: string;
  label: string;
  meta: string;
  href: string;
}

const statusLabels: Record<Job["status"], string> = {
  queued: "排队中",
  processing: "处理中",
  succeeded: "已完成",
  partially_succeeded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

function matches(query: string, values: Array<string | number | undefined>) {
  return values.some((value) =>
    String(value ?? "")
      .toLocaleLowerCase("zh-CN")
      .includes(query),
  );
}

function modulePath(pages: GlobalSearchPage[], moduleId: Job["moduleId"]) {
  const targetId =
    moduleId === "douyin-video-import" || moduleId === "share-content-import" ? "video-extract" : moduleId;
  return pages.find((page) => page.id === `module:${targetId}`)?.path;
}

export function buildGlobalSearchResults(sources: GlobalSearchSources, rawQuery: string, limitPerSection = 6) {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  const pageResults: GlobalSearchResult[] = sources.pages
    .filter((page) => !query || matches(query, [page.label, page.group]))
    .slice(0, query ? limitPerSection : 10)
    .map((page) => ({
      id: `page:${page.id}`,
      kind: "page",
      section: "页面",
      label: page.label,
      meta: page.group,
      href: page.path,
    }));
  if (!query) return pageResults;

  const taskResults: GlobalSearchResult[] = (sources.jobs ?? [])
    .flatMap((job) => {
      const href = modulePath(sources.pages, job.moduleId);
      if (!href || !matches(query, [job.title, job.stage, job.moduleId, job.result?.summary])) return [];
      return [
        {
          id: `task:${job.id}`,
          kind: "task" as const,
          section: "任务",
          label: job.title,
          meta: `${job.stage} · ${statusLabels[job.status]}`,
          href: `${href}?jobId=${encodeURIComponent(job.id)}`,
        },
      ];
    })
    .slice(0, limitPerSection);

  const materialResults: GlobalSearchResult[] = (sources.materials ?? [])
    .filter((asset) => matches(query, [asset.name, asset.originalName, asset.description, asset.mimeType]))
    .slice(0, limitPerSection)
    .map((asset) => ({
      id: `material:${asset.id}`,
      kind: "material",
      section: "素材",
      label: asset.name,
      meta: asset.originalName,
      href: `/assets/materials?${new URLSearchParams({
        assetIds: asset.id,
        ...(asset.folderId ? { folderId: asset.folderId } : {}),
      }).toString()}`,
    }));

  const productResults: GlobalSearchResult[] = (sources.products ?? [])
    .filter((product) => matches(query, [product.name, product.description]))
    .slice(0, limitPerSection)
    .map((product) => ({
      id: `product:${product.id}`,
      kind: "product",
      section: "商品",
      label: product.name,
      meta: `${product.images.length} 张商品图`,
      href: `/assets/products?productId=${encodeURIComponent(product.id)}`,
    }));

  const voiceResults: GlobalSearchResult[] = (sources.voices ?? [])
    .filter((voice) => matches(query, [voice.name, voice.originalName, voice.description]))
    .slice(0, limitPerSection)
    .map((voice) => ({
      id: `voice:${voice.id}`,
      kind: "voice",
      section: "音色",
      label: voice.name,
      meta: voice.description || voice.originalName,
      href: `/assets/voices?assetId=${encodeURIComponent(voice.id)}`,
    }));

  const portraitResults: GlobalSearchResult[] = (sources.portraits ?? [])
    .filter((portrait) =>
      matches(query, [portrait.name, portrait.description, portrait.profession, portrait.age, portrait.gender]),
    )
    .slice(0, limitPerSection)
    .map((portrait) => ({
      id: `portrait:${portrait.index}`,
      kind: "portrait",
      section: "人像",
      label: portrait.name,
      meta: `${portrait.age} 岁 · ${portrait.gender}性 · ${portrait.profession}`,
      href: `/assets/portraits?portraitId=${portrait.index}`,
    }));

  return [pageResults, taskResults, materialResults, productResults, voiceResults, portraitResults].flat();
}
