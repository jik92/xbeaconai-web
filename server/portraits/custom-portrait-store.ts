import { and, desc, eq } from "drizzle-orm";
import type { PortraitGender } from "../../shared/portraits/portrait-tags";
import { type AppDatabase, openDatabase } from "../db/database";
import { arkPortraitGroups, customPortraits } from "../db/schema";
import { env } from "../env";

export type CustomPortraitStatus = "queued" | "processing" | "active" | "failed";

export interface CustomPortraitRecord {
  assetId: string;
  jobId?: string;
  ownerUserId: string;
  groupId?: string;
  arkAssetId?: string;
  gender?: PortraitGender;
  status: CustomPortraitStatus;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

type CustomPortraitRow = typeof customPortraits.$inferSelect;
type ArkPortraitGroupRow = typeof arkPortraitGroups.$inferSelect;

const portraitRecord = (row: CustomPortraitRow): CustomPortraitRecord => ({
  assetId: row.assetId,
  jobId: row.jobId ?? undefined,
  ownerUserId: row.ownerUserId,
  groupId: row.groupId ?? undefined,
  arkAssetId: row.arkAssetId ?? undefined,
  gender: row.gender ?? undefined,
  status: row.status,
  errorCode: row.errorCode ?? undefined,
  errorMessage: row.errorMessage ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class CustomPortraitStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(path = env.databasePath) {
    const connection = openDatabase(path);
    this.client = connection.client;
    this.db = connection.db;
  }

  close() {
    this.client.close();
  }

  create(input: { assetId: string; jobId: string; ownerUserId: string; gender?: PortraitGender; createdAt?: string }) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .insert(customPortraits)
      .values({ ...input, status: "queued", createdAt, updatedAt: createdAt })
      .onConflictDoNothing()
      .run();
    return this.getOwned(input.ownerUserId, input.assetId);
  }

  get(assetId: string) {
    const row = this.db.select().from(customPortraits).where(eq(customPortraits.assetId, assetId)).get();
    return row ? portraitRecord(row) : undefined;
  }

  getOwned(ownerUserId: string, assetId: string) {
    const row = this.db
      .select()
      .from(customPortraits)
      .where(and(eq(customPortraits.ownerUserId, ownerUserId), eq(customPortraits.assetId, assetId)))
      .get();
    return row ? portraitRecord(row) : undefined;
  }

  listOwned(ownerUserId: string) {
    return this.db
      .select()
      .from(customPortraits)
      .where(eq(customPortraits.ownerUserId, ownerUserId))
      .orderBy(desc(customPortraits.createdAt))
      .all()
      .map(portraitRecord);
  }

  update(
    assetId: string,
    patch: Partial<Pick<CustomPortraitRow, "groupId" | "arkAssetId" | "status" | "errorCode" | "errorMessage">>,
  ) {
    this.db
      .update(customPortraits)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(customPortraits.assetId, assetId))
      .run();
    return this.get(assetId);
  }

  claimGroupCreation(ownerUserId: string, claimToken: string) {
    const timestamp = new Date().toISOString();
    this.db
      .insert(arkPortraitGroups)
      .values({
        ownerUserId,
        projectName: "default",
        status: "creating",
        claimToken,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing()
      .run();
    const current = this.getGroup(ownerUserId);
    if (current?.status === "failed") {
      this.db
        .update(arkPortraitGroups)
        .set({ status: "creating", claimToken, errorMessage: null, updatedAt: timestamp })
        .where(and(eq(arkPortraitGroups.ownerUserId, ownerUserId), eq(arkPortraitGroups.status, "failed")))
        .run();
    }
    const claimed = this.getGroup(ownerUserId);
    return { group: claimed, claimed: claimed?.status === "creating" && claimed.claimToken === claimToken };
  }

  getGroup(ownerUserId: string): ArkPortraitGroupRow | undefined {
    return this.db.select().from(arkPortraitGroups).where(eq(arkPortraitGroups.ownerUserId, ownerUserId)).get();
  }

  activateGroup(ownerUserId: string, claimToken: string, groupId: string) {
    this.db
      .update(arkPortraitGroups)
      .set({ groupId, status: "active", errorMessage: null, updatedAt: new Date().toISOString() })
      .where(and(eq(arkPortraitGroups.ownerUserId, ownerUserId), eq(arkPortraitGroups.claimToken, claimToken)))
      .run();
    return this.getGroup(ownerUserId);
  }

  failGroup(ownerUserId: string, claimToken: string, message: string) {
    this.db
      .update(arkPortraitGroups)
      .set({ status: "failed", errorMessage: message.slice(0, 500), updatedAt: new Date().toISOString() })
      .where(and(eq(arkPortraitGroups.ownerUserId, ownerUserId), eq(arkPortraitGroups.claimToken, claimToken)))
      .run();
  }
}
