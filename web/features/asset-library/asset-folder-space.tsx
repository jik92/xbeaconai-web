import { useQueryClient } from "@tanstack/react-query";
import { Files, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { createAssetFolder, deleteAssetFolder, renameAssetFolder } from "@/api/api-client";
import type { AssetFolder } from "@/entities/types";

interface AssetFolderSpaceProps {
  folders: AssetFolder[];
  selectedFolderId: string;
  loading?: boolean;
  onSelect: (folderId: string) => void;
}

export function AssetFolderSpace({ folders, selectedFolderId, loading, onSelect }: AssetFolderSpaceProps) {
  const queryClient = useQueryClient();
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
  const addFolder = async () => {
    const name = window.prompt("请输入新文件夹名称");
    if (!name?.trim()) return;
    try {
      const folder = await createAssetFolder(name.trim());
      await refreshFolders();
      onSelect(folder.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件夹创建失败");
    }
  };
  const renameFolder = async (folder: AssetFolder) => {
    const name = window.prompt("请输入新的文件夹名称", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    try {
      await renameAssetFolder(folder.id, name.trim());
      await refreshFolders();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件夹重命名失败");
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
    <aside className="material-folder-sidebar" aria-label="文件夹空间管理">
      <header>
        <div>
          <span>FOLDER SPACE</span>
          <b>我的文件夹</b>
        </div>
        <button type="button" aria-label="新建文件夹" title="新建文件夹" onClick={() => void addFolder()}>
          <FolderPlus />
        </button>
      </header>
      <nav aria-label="素材文件夹">
        <div className={!selectedFolderId ? "active" : ""}>
          <button type="button" onClick={() => onSelect("")}>
            <Files />
            <span>全部素材</span>
          </button>
        </div>
        {orderedFolders.map(({ folder, depth }) => (
          <div key={folder.id} className={selectedFolderId === folder.id ? "active" : ""}>
            <button type="button" style={{ paddingLeft: 7 + depth * 18 }} onClick={() => onSelect(folder.id)}>
              {selectedFolderId === folder.id ? <FolderOpen /> : <Folder />}
              <span>{folder.name}</span>
            </button>
            <span className="folder-actions">
              <button
                type="button"
                aria-label={`重命名 ${folder.name}`}
                title="重命名"
                onClick={() => void renameFolder(folder)}
              >
                <Pencil />
              </button>
              <button
                type="button"
                aria-label={`删除 ${folder.name}`}
                title="删除"
                onClick={() => void removeFolder(folder)}
              >
                <Trash2 />
              </button>
            </span>
          </div>
        ))}
        {loading && <p className="folder-space-state">正在加载文件夹…</p>}
      </nav>
      <footer>
        <span>当前空间</span>
        <b>{selectedFolder?.storagePrefix ?? (loading ? "正在初始化…" : "全部素材")}</b>
      </footer>
    </aside>
  );
}
