import Dexie, { type EntityTable } from "dexie";
import type { MockTask } from "@/entities/types";

export interface Draft {
  id: string;
  values: Record<string, string>;
  updatedAt: number;
}
export interface Asset {
  id: string;
  name: string;
  kind: "video" | "audio" | "image";
  url?: string;
  createdAt: number;
}
export class StudioDB extends Dexie {
  tasks!: EntityTable<MockTask, "id">;
  drafts!: EntityTable<Draft, "id">;
  assets!: EntityTable<Asset, "id">;
  constructor(name = "yaozuo-studio") {
    super(name);
    this.version(1).stores({
      tasks: "id,moduleId,status,updatedAt",
      drafts: "id,updatedAt",
      assets: "id,kind,createdAt",
    });
  }
}
export const db = new StudioDB();
