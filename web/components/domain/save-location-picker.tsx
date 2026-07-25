import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createAssetFolder,
  fetchAssetFolders,
  fetchToolOutputFolder,
  setDefaultAssetFolder,
  setToolOutputFolder,
} from "@/api/api-client";
import type { AssetFolder } from "@/entities/types";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";

export interface SaveLocationPickerProps {
  id?: string;
  moduleId?: string;
  value: string;
  onChange: (folderId: string) => void;
  required?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

export function orderAssetFolders(folders: AssetFolder[]) {
  const ordered: Array<{ folder: AssetFolder; depth: number }> = [];
  const visited = new Set<string>();
  const append = (parentId: string | undefined, depth: number) => {
    for (const folder of folders.filter((item) => item.parentId === parentId)) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      ordered.push({ folder, depth });
      append(folder.id, depth + 1);
    }
  };
  append(undefined, 0);
  for (const folder of folders) {
    if (!visited.has(folder.id)) ordered.push({ folder, depth: 0 });
  }
  return ordered;
}

export function SaveLocationPicker({
  id,
  moduleId,
  value,
  onChange,
  required,
  invalid,
  disabled,
  className,
}: SaveLocationPickerProps) {
  const queryClient = useQueryClient();
  const { data: folders = [], isLoading } = useQuery({
    queryKey: ["asset-folders"],
    queryFn: fetchAssetFolders,
  });
  const { data: moduleDefault, isLoading: defaultLoading } = useQuery({
    queryKey: ["tool-output-folder", moduleId],
    queryFn: () => fetchToolOutputFolder(moduleId ?? ""),
    enabled: Boolean(moduleId),
  });
  const orderedFolders = useMemo(() => orderAssetFolders(folders), [folders]);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!folders.length || folders.some((folder) => folder.id === value)) return;
    const preferred = moduleId ? moduleDefault : folders.find((folder) => folder.isDefault);
    if (!preferred) return;
    const resolved = folders.find((folder) => folder.id === preferred.id) ?? folders[0];
    onChange(resolved.id);
  }, [folders, moduleDefault, moduleId, onChange, value]);

  const selectFolder = async (folderId: string) => {
    onChange(folderId);
    setError("");
    try {
      if (moduleId) {
        const folder = await setToolOutputFolder(moduleId, folderId);
        queryClient.setQueryData(["tool-output-folder", moduleId], folder);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务默认文件夹设置失败");
    }
  };

  const cancelCreate = () => {
    setCreating(false);
    setName("");
    setError("");
  };

  const createFolder = async () => {
    const cleanName = name.trim();
    if (!cleanName || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const folder = await createAssetFolder(cleanName);
      queryClient.setQueryData<AssetFolder[]>(["asset-folders"], (current = []) => [...current, folder]);
      onChange(folder.id);
      setName("");
      setCreating(false);
      try {
        const defaultFolder = moduleId
          ? await setToolOutputFolder(moduleId, folder.id)
          : await setDefaultAssetFolder(folder.id);
        if (moduleId) queryClient.setQueryData(["tool-output-folder", moduleId], defaultFolder);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "任务默认文件夹设置失败");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["asset-folders"] }),
        ...(moduleId ? [queryClient.invalidateQueries({ queryKey: ["tool-output-folder", moduleId] })] : []),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文件夹创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <NativeSelect
          id={id}
          aria-label="保存位置"
          className={cn("h-8", invalid && "border-red-500")}
          required={required}
          disabled={disabled || isLoading || (Boolean(moduleId) && defaultLoading) || !folders.length}
          value={value}
          onChange={(event) => void selectFolder(event.target.value)}
        >
          <option value="" disabled>
            {isLoading ? "正在加载我的文件夹…" : folders.length ? "请选择我的文件夹" : "暂无文件夹"}
          </option>
          {orderedFolders.map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {`${"　".repeat(depth)}${folder.name}${
                folder.id === moduleDefault?.id ? "（此任务默认）" : folder.isDefault ? "（素材库默认）" : ""
              }`}
            </option>
          ))}
        </NativeSelect>
        {!creating && (
          <Button
            className="h-7 px-2 text-xs"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setCreating(true);
              setError("");
            }}
          >
            <Plus />
            新建文件夹
          </Button>
        )}
      </div>
      {creating && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Input
            autoFocus
            className="h-8 w-44"
            maxLength={80}
            placeholder="输入文件夹名称"
            value={name}
            disabled={submitting}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createFolder();
              }
              if (event.key === "Escape") cancelCreate();
            }}
          />
          <Button
            className="h-7 px-2 text-xs"
            size="sm"
            disabled={!name.trim() || submitting}
            onClick={() => void createFolder()}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <Check />}
            创建并设为默认
          </Button>
          <Button
            aria-label="取消新建文件夹"
            className="size-7 p-0"
            size="icon"
            variant="ghost"
            disabled={submitting}
            onClick={cancelCreate}
          >
            <X />
          </Button>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
