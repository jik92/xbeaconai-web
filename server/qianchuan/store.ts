import { and, desc, eq, gte, lte } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import {
  qianchuanAdvertisers,
  qianchuanBindings,
  qianchuanDeliveries,
  qianchuanMaterials,
  qianchuanOauthStates,
  qianchuanReports,
} from "../db/schema";
import { env } from "../env";
import { decryptQianchuanToken, encryptQianchuanToken } from "./crypto";
import type { QianchuanAdvertiserSummary, QianchuanDeliveryInput, QianchuanTokenPayload } from "./types";

export class QianchuanStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(path = env.databasePath) {
    const connection = openDatabase(path);
    this.db = connection.db;
    this.client = connection.client;
  }

  close() {
    this.client.close();
  }

  createOauthState(ownerUserId: string, stateHash: string, expiresAt: string) {
    this.db
      .insert(qianchuanOauthStates)
      .values({ stateHash, ownerUserId, expiresAt, createdAt: new Date().toISOString() })
      .run();
  }

  consumeOauthState(stateHash: string) {
    const row = this.db.select().from(qianchuanOauthStates).where(eq(qianchuanOauthStates.stateHash, stateHash)).get();
    if (!row || row.consumedAt || Date.parse(row.expiresAt) <= Date.now()) return undefined;
    this.db
      .update(qianchuanOauthStates)
      .set({ consumedAt: new Date().toISOString() })
      .where(eq(qianchuanOauthStates.stateHash, stateHash))
      .run();
    return row.ownerUserId;
  }

  upsertBinding(ownerUserId: string, token: QianchuanTokenPayload) {
    const now = new Date().toISOString();
    const access = encryptQianchuanToken(token.accessToken);
    const refresh = encryptQianchuanToken(token.refreshToken);
    const existing = this.db
      .select()
      .from(qianchuanBindings)
      .where(and(eq(qianchuanBindings.ownerUserId, ownerUserId), eq(qianchuanBindings.authUserId, token.authUserId)))
      .get();
    const id = existing?.id ?? crypto.randomUUID();
    this.db
      .insert(qianchuanBindings)
      .values({
        id,
        ownerUserId,
        authUserId: token.authUserId,
        subjectName: existing?.subjectName ?? "",
        accessTokenCiphertext: access.ciphertext,
        accessTokenNonce: access.nonce,
        accessTokenAuthTag: access.authTag,
        refreshTokenCiphertext: refresh.ciphertext,
        refreshTokenNonce: refresh.nonce,
        refreshTokenAuthTag: refresh.authTag,
        accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + token.refreshTokenExpiresIn * 1000).toISOString(),
        defaultAdvertiserId: existing?.defaultAdvertiserId,
        status: "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qianchuanBindings.ownerUserId, qianchuanBindings.authUserId],
        set: {
          accessTokenCiphertext: access.ciphertext,
          accessTokenNonce: access.nonce,
          accessTokenAuthTag: access.authTag,
          refreshTokenCiphertext: refresh.ciphertext,
          refreshTokenNonce: refresh.nonce,
          refreshTokenAuthTag: refresh.authTag,
          accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + token.refreshTokenExpiresIn * 1000).toISOString(),
          status: "active",
          updatedAt: now,
        },
      })
      .run();
    return this.getOwnedBinding(ownerUserId, id);
  }

  getOwnedBinding(ownerUserId: string, id: string) {
    return this.db
      .select()
      .from(qianchuanBindings)
      .where(and(eq(qianchuanBindings.id, id), eq(qianchuanBindings.ownerUserId, ownerUserId)))
      .get();
  }

  listBindings(ownerUserId: string) {
    return this.db
      .select()
      .from(qianchuanBindings)
      .where(eq(qianchuanBindings.ownerUserId, ownerUserId))
      .orderBy(desc(qianchuanBindings.updatedAt))
      .all();
  }

  accessToken(binding: typeof qianchuanBindings.$inferSelect) {
    return decryptQianchuanToken({
      ciphertext: binding.accessTokenCiphertext,
      nonce: binding.accessTokenNonce,
      authTag: binding.accessTokenAuthTag,
    });
  }

  refreshToken(binding: typeof qianchuanBindings.$inferSelect) {
    return decryptQianchuanToken({
      ciphertext: binding.refreshTokenCiphertext,
      nonce: binding.refreshTokenNonce,
      authTag: binding.refreshTokenAuthTag,
    });
  }

  replaceAdvertisers(bindingId: string, advertisers: QianchuanAdvertiserSummary[]) {
    const now = new Date().toISOString();
    for (const item of advertisers)
      this.db
        .insert(qianchuanAdvertisers)
        .values({ id: crypto.randomUUID(), bindingId, ...item, updatedAt: now })
        .onConflictDoUpdate({
          target: [qianchuanAdvertisers.bindingId, qianchuanAdvertisers.advertiserId],
          set: { name: item.name, accountRole: item.accountRole, status: item.status, updatedAt: now },
        })
        .run();
  }

  listAdvertisers(bindingId: string) {
    return this.db.select().from(qianchuanAdvertisers).where(eq(qianchuanAdvertisers.bindingId, bindingId)).all();
  }

  setDefaultAdvertiser(ownerUserId: string, bindingId: string, advertiserId: string) {
    const binding = this.getOwnedBinding(ownerUserId, bindingId);
    if (!binding) return undefined;
    const advertiser = this.db
      .select()
      .from(qianchuanAdvertisers)
      .where(and(eq(qianchuanAdvertisers.bindingId, bindingId), eq(qianchuanAdvertisers.advertiserId, advertiserId)))
      .get();
    if (!advertiser) return undefined;
    this.db
      .update(qianchuanBindings)
      .set({ defaultAdvertiserId: advertiserId, updatedAt: new Date().toISOString() })
      .where(eq(qianchuanBindings.id, bindingId))
      .run();
    return advertiser;
  }

  deleteBinding(ownerUserId: string, bindingId: string) {
    const binding = this.getOwnedBinding(ownerUserId, bindingId);
    if (!binding) return false;
    this.db.delete(qianchuanBindings).where(eq(qianchuanBindings.id, bindingId)).run();
    return true;
  }

  createMaterial(
    ownerUserId: string,
    bindingId: string,
    advertiserId: string,
    assetId: string,
    kind: "video" | "image",
  ) {
    const existing = this.db
      .select()
      .from(qianchuanMaterials)
      .where(
        and(
          eq(qianchuanMaterials.advertiserId, advertiserId),
          eq(qianchuanMaterials.assetId, assetId),
          eq(qianchuanMaterials.kind, kind),
        ),
      )
      .get();
    if (existing) return existing;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      ownerUserId,
      bindingId,
      advertiserId,
      assetId,
      kind,
      status: "queued" as const,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(qianchuanMaterials).values(row).run();
    return row;
  }

  getMaterial(id: string) {
    return this.db.select().from(qianchuanMaterials).where(eq(qianchuanMaterials.id, id)).get();
  }

  updateMaterial(id: string, patch: Partial<typeof qianchuanMaterials.$inferInsert>) {
    this.db
      .update(qianchuanMaterials)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(qianchuanMaterials.id, id))
      .run();
    return this.getMaterial(id);
  }

  listMaterials(ownerUserId: string, advertiserId?: string) {
    const predicate = advertiserId
      ? and(eq(qianchuanMaterials.ownerUserId, ownerUserId), eq(qianchuanMaterials.advertiserId, advertiserId))
      : eq(qianchuanMaterials.ownerUserId, ownerUserId);
    return this.db.select().from(qianchuanMaterials).where(predicate).orderBy(desc(qianchuanMaterials.updatedAt)).all();
  }

  createDelivery(ownerUserId: string, bindingId: string, input: QianchuanDeliveryInput, idempotencyKey: string) {
    const existing = this.db
      .select()
      .from(qianchuanDeliveries)
      .where(
        and(eq(qianchuanDeliveries.ownerUserId, ownerUserId), eq(qianchuanDeliveries.idempotencyKey, idempotencyKey)),
      )
      .get();
    if (existing) return existing;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      ownerUserId,
      bindingId,
      advertiserId: input.advertiserId,
      idempotencyKey,
      name: input.name,
      status: "queued" as const,
      requestPayload: { ...input },
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(qianchuanDeliveries).values(row).run();
    return row;
  }

  getDelivery(id: string) {
    return this.db.select().from(qianchuanDeliveries).where(eq(qianchuanDeliveries.id, id)).get();
  }

  getOwnedDelivery(ownerUserId: string, id: string) {
    return this.db
      .select()
      .from(qianchuanDeliveries)
      .where(and(eq(qianchuanDeliveries.id, id), eq(qianchuanDeliveries.ownerUserId, ownerUserId)))
      .get();
  }

  updateDelivery(id: string, patch: Partial<typeof qianchuanDeliveries.$inferInsert>) {
    this.db
      .update(qianchuanDeliveries)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(qianchuanDeliveries.id, id))
      .run();
    return this.getDelivery(id);
  }

  listDeliveries(ownerUserId: string) {
    return this.db
      .select()
      .from(qianchuanDeliveries)
      .where(eq(qianchuanDeliveries.ownerUserId, ownerUserId))
      .orderBy(desc(qianchuanDeliveries.updatedAt))
      .all();
  }

  upsertReport(
    ownerUserId: string,
    deliveryId: string,
    reportDate: string,
    level: "account" | "campaign" | "material",
    metrics: Record<string, number>,
  ) {
    this.db
      .insert(qianchuanReports)
      .values({
        id: crypto.randomUUID(),
        ownerUserId,
        deliveryId,
        reportDate,
        level,
        metrics,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [qianchuanReports.deliveryId, qianchuanReports.reportDate, qianchuanReports.level],
        set: { metrics, updatedAt: new Date().toISOString() },
      })
      .run();
  }

  listReports(ownerUserId: string, startDate: string, endDate: string) {
    return this.db
      .select()
      .from(qianchuanReports)
      .where(
        and(
          eq(qianchuanReports.ownerUserId, ownerUserId),
          gte(qianchuanReports.reportDate, startDate),
          lte(qianchuanReports.reportDate, endDate),
        ),
      )
      .orderBy(desc(qianchuanReports.reportDate))
      .all();
  }
}

export const qianchuanStore = new QianchuanStore();
