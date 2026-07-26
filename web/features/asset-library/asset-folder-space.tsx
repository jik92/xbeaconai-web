import { useQueryClient } from "@tanstack/react-query";
import { Files, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createAssetFolder, deleteAssetFolder, renameAssetFolder } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { TextInputModal } from "@/components/ui/text-input-modal";
import type { AssetFolder } from "@/entities/types";
import { cn } from "@/lib/utils";

interface AssetFolderSpaceProps {
  folders: AssetFolder[];
  selectedFolderId: string;
  loading?: boolean;
  onSelect: (folderId: string) => void;
}

export function AssetFolderSpace({ folders, selectedFolderId, loading, onSelect }: AssetFolderSpaceProps) {
  const queryClient = useQueryClient();
  const [folderEditor, setFolderEditor] = useState<{ mode: "create" } | { mode: "rename"; folder: AssetFolder }>();
  const orderedFolders = useMemo(() => {
    const result: Array<{ folder: AssetFolder; depth: number }> = [];
    const appendChildren = (parentId: string | undefined, depth: number) => {
      for (const folder of folders.filter((item) => item.parentId === parentId)) {
        result.push({ folder, depth });
        appendChildren(folder.id, depth + 1);
      }
    };
    appendChildren(undefined, 0);
    return result;
  }, [folders]);
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId);

  const refreshFolders = () => queryClient.invalidateQueries({ queryKey: ["asset-folders"] });
  const submitFolder = async (name: string) => {
    if (folderEditor?.mode === "create") {
      const folder = await createAssetFolder(name);
      await refreshFolders();
      onSelect(folder.id);
      return;
    }

    if (folderEditor?.mode === "rename" && name !== folderEditor.folder.name) {
      await renameAssetFolder(folderEditor.folder.id, name);
      await refreshFolders();
    }
  };
  const removeFolder = async (folder: AssetFolder) => {
    if (!window.confirm(`确定删除文件夹“${folder.name}”吗？仅空文件夹可以删除。`)) return;
    try {
      await deleteAssetFolder(folder.id);
      if (selectedFolderId === folder.id) onSelect("");
      await refreshFolders();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件夹删除失败");
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-white" aria-label="文件夹空间管理">
      <header className="flex h-8 flex-none items-center justify-between px-1">
        <b className="text-xs font-medium text-ink">我的文件夹</b>
        <Button
          className="size-8"
          size="icon"
          variant="ghost"
          aria-label="新建文件夹"
          title="新建文件夹"
          onClick={() => setFolderEditor({ mode: "create" })}
        >
          <FolderPlus />
        </Button>
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="素材文件夹">
        <div>
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted hover:bg-surface-muted",
              !selectedFolderId && "bg-surface-muted text-ink",
            )}
            onClick={() => onSelect("")}
          >
            <Files />
            <span className="truncate">全部素材</span>
          </button>
        </div>
        {orderedFolders.map(({ folder, depth }) => (
          <div className="group flex items-center" key={folder.id}>
            <button
              type="button"
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-1 text-left text-xs text-muted hover:bg-surface-muted",
                selectedFolderId === folder.id && "bg-surface-muted text-ink",
              )}
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => onSelect(folder.id)}
            >
              {selectedFolderId === folder.id ? <FolderOpen /> : <Folder />}
              <span className="truncate">{folder.name}</span>
            </button>
            <span className="hidden items-center group-hover:flex">
              <Button
                className="size-7"
                size="icon"
                variant="ghost"
                aria-label={`重命名 ${folder.name}`}
                title="重命名"
                onClick={() => setFolderEditor({ mode: "rename", folder })}
              >
                <Pencil />
              </Button>
              <Button
                className="size-7 text-danger"
                size="icon"
                variant="ghost"
                aria-label={`删除 ${folder.name}`}
                title="删除"
                onClick={() => void removeFolder(folder)}
              >
                <Trash2 />
              </Button>
            </span>
          </div>
        ))}
        {loading && <p className="px-2 py-3 text-2xs text-muted">正在加载文件夹…</p>}
      </nav>
      <footer className="flex-none border-t border-line px-2 py-2">
        <span className="block text-2xs text-muted">当前空间</span>
        <b className="mt-0.5 block truncate text-2xs font-medium text-ink">
          {selectedFolder?.storagePrefix ?? (loading ? "正在初始化…" : "全部素材")}
        </b>
      </footer>
      <TextInputModal
        open={Boolean(folderEditor)}
        title={folderEditor?.mode === "rename" ? "重命名文件夹" : "新建文件夹"}
        label="文件夹名称"
        initialValue={folderEditor?.mode === "rename" ? folderEditor.folder.name : ""}
        placeholder="输入文件夹名称"
        confirmLabel={folderEditor?.mode === "rename" ? "保存" : "创建"}
        submittingLabel={folderEditor?.mode === "rename" ? "保存中…" : "创建中…"}
        maxLength={80}
        requiredMessage="请输入文件夹名称"
        onOpenChange={(open) => {
          if (!open) setFolderEditor(undefined);
        }}
        onSubmit={submitFolder}
      />
    </aside>
  );
}
