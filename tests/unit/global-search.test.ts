import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Job } from "../../web/api/generated/types.gen";
import type { LibraryAsset, LibraryProduct } from "../../web/entities/types";
import type { Portrait } from "../../web/features/portrait-library/portrait-data";
import { GlobalSearch, isGlobalSearchShortcut } from "../../web/components/domain/global-search";
import { buildGlobalSearchResults, type GlobalSearchPage } from "../../web/components/domain/global-search-index";

const pages: GlobalSearchPage[] = [
  { id: "module:video-cut", label: "视频分割", path: "/tools/video-cut", group: "AI 工具箱" },
  { id: "module:video-extract", label: "视频提取", path: "/utilities/video-extract", group: "实用工具" },
  { id: "asset:materials", label: "素材库", path: "/assets/materials", group: "资产" },
];

const job = {
  id: "job-1",
  moduleId: "video-cut",
  title: "夏季服装切片",
  stage: "镜头分析",
  status: "processing",
} as Job;
const material: LibraryAsset = {
  id: "asset-1",
  name: "夏季商品视频",
  originalName: "summer.mp4",
  mimeType: "video/mp4",
  size: 1024,
  kind: "media",
  description: "服装展示",
  folderId: "folder-1",
  url: "/api/assets/asset-1/content",
  createdAt: "2026-07-23T00:00:00.000Z",
};
const product: LibraryProduct = {
  id: "product-1",
  name: "夏季直筒裤",
  description: "高腰显瘦",
  sharingScope: "private",
  images: [material],
  createdAt: "2026-07-23T00:00:00.000Z",
};
const portrait = {
  index: 8,
  category: "女性",
  page: 1,
  name: "都市女性",
  description: "夏季穿搭模特",
  source_url: "/portraits/8.png",
  file: "8.png",
  age: 28,
  gender: "女",
  profession: "服装模特",
} satisfies Portrait;

describe("global search", () => {
  test("renders an accessible combobox and clickable shortcut button", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(GlobalSearch, { pages })),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('type="button"');
    expect(html).toContain("打开全局搜索");
    expect(html).toContain("⌘ K");
  });

  test("shows visible page entrances before a query is entered", () => {
    const results = buildGlobalSearchResults({ pages }, "");

    expect(results.map((item) => item.label)).toEqual(["视频分割", "视频提取", "素材库"]);
    expect(results.every((item) => item.kind === "page")).toBe(true);
  });

  test("searches tasks and assets and builds navigable target URLs", () => {
    const results = buildGlobalSearchResults(
      { pages, jobs: [job], materials: [material], products: [product], portraits: [portrait] },
      "夏季",
    );

    expect(results.find((item) => item.kind === "task")?.href).toBe("/tools/video-cut?jobId=job-1");
    expect(results.find((item) => item.kind === "material")?.href).toContain("assetIds=asset-1");
    expect(results.find((item) => item.kind === "product")?.href).toBe("/assets/products?productId=product-1");
    expect(results.find((item) => item.kind === "portrait")?.href).toBe("/assets/portraits?portraitId=8");
  });

  test("routes background import jobs to the visible video extract page", () => {
    const backgroundJob = { ...job, id: "job-2", moduleId: "share-content-import", title: "抖音导入" } as Job;
    const results = buildGlobalSearchResults({ pages, jobs: [backgroundJob] }, "抖音");

    expect(results[0]?.href).toBe("/utilities/video-extract?jobId=job-2");
  });

  test("recognizes both platform shortcut variants without hijacking modified shortcuts", () => {
    const base = { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isGlobalSearchShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isGlobalSearchShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isGlobalSearchShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isGlobalSearchShortcut({ ...base, key: "p", metaKey: true })).toBe(false);
  });
});
