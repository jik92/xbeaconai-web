import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AssetFolder } from "../../web/entities/types";

const window = new Window();
const roots: Root[] = [];
const folders: AssetFolder[] = [
  {
    id: "folder-default",
    name: "默认素材",
    storagePrefix: "users/test/default/",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    isDefault: true,
  },
  {
    id: "folder-child",
    parentId: "folder-default",
    name: "子文件夹",
    storagePrefix: "users/test/default/child/",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  },
];
const createdFolder: AssetFolder = {
  id: "folder-created",
  name: "今日成片",
  storagePrefix: "users/test/today/",
  createdAt: "2026-07-26T01:00:00.000Z",
  updatedAt: "2026-07-26T01:00:00.000Z",
};
const fetchAssetFolders = mock(async () => folders);
const createAssetFolder = mock(async (_name: string) => createdFolder);
const setDefaultAssetFolder = mock(async (_folderId: string) => ({ ...createdFolder, isDefault: true }));

mock.module("@/api/api-client", () => ({
  fetchAssetFolders,
  createAssetFolder,
  setDefaultAssetFolder,
}));

const { SaveLocationPicker } = await import("../../web/components/domain/save-location-picker");

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  fetchAssetFolders.mockClear();
  createAssetFolder.mockClear();
  setDefaultAssetFolder.mockClear();
});

async function renderPicker(value = "", onChange = mock((_folderId: string) => undefined)) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SaveLocationPicker value={value} onChange={onChange} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { container, onChange };
}

describe("SaveLocationPicker", () => {
  test("selects the default folder and renders nested folders", async () => {
    const { container, onChange } = await renderPicker();

    expect(onChange).toHaveBeenCalledWith("folder-default");
    expect(container.querySelector("select")?.textContent).toContain("默认素材（默认）");
    expect(container.querySelector("select")?.textContent).toContain("　子文件夹");
  });

  test("creates a root folder, selects it, and makes it the default", async () => {
    const { container, onChange } = await renderPicker("folder-default");
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "新建文件夹",
    );
    expect(createButton).not.toBeUndefined();

    act(() => createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = container.querySelector('input[placeholder="输入文件夹名称"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, "  今日成片  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "创建并设为默认",
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createAssetFolder).toHaveBeenCalledWith("今日成片");
    expect(onChange).toHaveBeenCalledWith("folder-created");
    expect(setDefaultAssetFolder).toHaveBeenCalledWith("folder-created");
  });
});
