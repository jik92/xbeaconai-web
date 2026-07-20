import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { APP_CONFIG } from "../../web/app/config";
import { type AppDatabase, openDatabase } from "../db/database";
import {
  artifacts,
  assetFolders,
  authSessions,
  jobs,
  mediaAssets,
  migrationState,
  notifications,
  rechargeOrders,
  userPreferences,
  users,
} from "../db/schema";
import { env } from "../env";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  avatarText: string;
  credits: number;
}
export interface Preferences {
  theme: "light" | "system";
  defaultRatio: "9:16" | "16:9" | "1:1";
  language: "zh-CN" | "en";
  taskNotifications: boolean;
  autoplayResults: boolean;
}
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
}
export interface RechargeOrder {
  id: string;
  packageId: string;
  amountCny: number;
  credits: number;
  status: "succeeded";
  paymentMode: "mock";
  balanceAfter: number;
  createdAt: string;
}
export interface MediaAsset {
  id: string;
  ownerUserId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationSec?: number;
  kind: "media" | "product" | "portrait" | "voice";
  displayName: string;
  description?: string;
  folderId?: string;
  createdAt: string;
}
export interface AssetFolder {
  id: string;
  ownerUserId: string;
  parentId?: string;
  name: string;
  storagePrefix: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProductRecord {
  id: string;
  ownerUserId: string;
  name: string;
  description?: string;
  sharingScope: "private" | "team" | "organization";
  images: MediaAsset[];
  createdAt: string;
}
export interface ArtifactRecord {
  id: string;
  ownerUserId: string;
  jobId: string;
  storageKey: string;
  name: string;
  mimeType: string;
  createdAt: string;
}

export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 422 = 400,
  ) {
    super(message);
  }
}

export const rechargePackages = [
  { id: "starter", name: "轻量补给", amountCny: 19, credits: 1000, badge: "适合体验" },
  { id: "creator", name: "创作加速", amountCny: 49, credits: 3000, badge: "最受欢迎" },
  { id: "studio", name: "工作室包", amountCny: 99, credits: 7500, badge: "高频创作" },
] as const;

type UserRow = typeof users.$inferSelect;
type MediaAssetRow = typeof mediaAssets.$inferSelect;
type AssetFolderRow = typeof assetFolders.$inferSelect;
type OrderRow = typeof rechargeOrders.$inferSelect;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const now = () => new Date().toISOString();
const userSummary = (row: UserRow): UserSummary => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  avatarText: row.avatarText,
  credits: row.credits,
});
const mediaAsset = (row: MediaAssetRow): MediaAsset => ({
  id: row.id,
  ownerUserId: row.ownerUserId,
  storageKey: row.storageKey,
  originalName: row.originalName,
  mimeType: row.mimeType,
  byteSize: row.byteSize,
  width: row.width ?? undefined,
  height: row.height ?? undefined,
  durationSec: row.durationSec ?? undefined,
  kind: row.assetKind,
  displayName: row.displayName || row.originalName,
  description: row.description ?? undefined,
  folderId: row.folderId ?? undefined,
  createdAt: row.createdAt,
});
const assetFolder = (row: AssetFolderRow): AssetFolder => ({
  id: row.id,
  ownerUserId: row.ownerUserId,
  parentId: row.parentId ?? undefined,
  name: row.name,
  storagePrefix: row.storagePrefix,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class AccountStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(path = env.databasePath) {
    const connection = openDatabase(path);
    this.client = connection.client;
    this.db = connection.db;
    this.db
      .update(mediaAssets)
      .set({ displayName: mediaAssets.originalName })
      .where(eq(mediaAssets.displayName, ""))
      .run();
  }

  close() {
    this.client.close();
  }

  async register(input: { email: string; password: string; displayName: string }) {
    const email = normalizeEmail(input.email);
    const passwordHash = await Bun.password.hash(input.password);
    const id = crypto.randomUUID();
    const created = now();
    try {
      const claimedLegacy = this.db.transaction(
        (tx) => {
          tx.insert(users)
            .values({
              id,
              email,
              passwordHash,
              displayName: input.displayName.trim(),
              avatarText: input.displayName.trim().slice(0, 2) || "曜",
              createdAt: created,
              updatedAt: created,
            })
            .run();
          const defaultFolderId = crypto.randomUUID();
          tx.insert(assetFolders)
            .values({
              id: defaultFolderId,
              ownerUserId: id,
              parentId: null,
              name: "默认",
              storagePrefix: `${id}/materials/${defaultFolderId}/`,
              createdAt: created,
              updatedAt: created,
            })
            .run();
          tx.insert(userPreferences)
            .values({ userId: id, defaultAssetFolderId: defaultFolderId, updatedAt: created })
            .run();
          tx.insert(notifications)
            .values({
              id: crypto.randomUUID(),
              userId: id,
              type: "welcome",
              title: `欢迎来到${APP_CONFIG.projectName}`,
              body: "账号已创建，可以开始你的第一个创作任务。",
              createdAt: created,
            })
            .run();
          const legacy = tx.select().from(migrationState).where(eq(migrationState.key, "legacy_owner_user_id")).get();
          if (legacy) return false;
          tx.insert(migrationState).values({ key: "legacy_owner_user_id", value: id, updatedAt: created }).run();
          tx.update(jobs).set({ ownerUserId: id }).where(isNull(jobs.ownerUserId)).run();
          return true;
        },
        { behavior: "immediate" },
      );
      const user = this.getUser(id);
      if (!user) throw new Error("注册后无法读取账号");
      return { user, claimedLegacy };
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new AccountError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册", 409);
      throw error;
    }
  }

  async verifyCredentials(email: string, password: string) {
    const row = this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get();
    const valid = row
      ? await Bun.password.verify(password, row.passwordHash)
      : await Bun.password
          .verify(password, "$2b$10$7EqJtq98hPqEX7fNZaFWoOhiLK9IrXAMiE0gfs7JZ/fH5rVgqpE7i")
          .catch(() => false);
    if (!row || !valid || row.status !== "active") throw new AccountError("INVALID_CREDENTIALS", "邮箱或密码错误", 401);
    return userSummary(row);
  }

  getUser(id: string) {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ? userSummary(row) : undefined;
  }
  getUserSecurity(id: string) {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }
  createSession(userId: string, expiresAt: string) {
    const user = this.getUserSecurity(userId);
    if (!user) throw new AccountError("USER_NOT_FOUND", "账号不存在", 404);
    const session = { id: crypto.randomUUID(), jti: crypto.randomUUID(), passwordVersion: user.passwordVersion };
    const time = now();
    this.db
      .insert(authSessions)
      .values({
        id: session.id,
        userId,
        jti: session.jti,
        passwordVersion: session.passwordVersion,
        expiresAt,
        createdAt: time,
        lastSeenAt: time,
      })
      .run();
    return session;
  }
  validateSession(userId: string, sid: string, jti: string, passwordVersion: number, allowRevoked = false) {
    const row = this.db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.id, sid), eq(authSessions.jti, jti), eq(authSessions.userId, userId)))
      .get();
    const user = this.getUserSecurity(userId);
    if (
      !row ||
      !user ||
      user.status !== "active" ||
      row.passwordVersion !== passwordVersion ||
      user.passwordVersion !== passwordVersion ||
      (!allowRevoked && row.revokedAt)
    )
      return undefined;
    if (Date.parse(row.expiresAt) <= Date.now()) return undefined;
    return { user: userSummary(user), revoked: Boolean(row.revokedAt) };
  }
  revokeSession(sid: string) {
    this.db
      .update(authSessions)
      .set({ revokedAt: now() })
      .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)))
      .run();
  }

  updateProfile(userId: string, input: { email: string; displayName: string; avatarText: string }) {
    try {
      this.db
        .update(users)
        .set({
          email: normalizeEmail(input.email),
          displayName: input.displayName.trim(),
          avatarText: input.avatarText.trim().slice(0, 2),
          updatedAt: now(),
        })
        .where(eq(users.id, userId))
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new AccountError("EMAIL_ALREADY_REGISTERED", "该邮箱已被使用", 409);
      throw error;
    }
    const user = this.getUser(userId);
    if (!user) throw new AccountError("USER_NOT_FOUND", "账号不存在", 404);
    return user;
  }
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = this.getUserSecurity(userId);
    if (!user || !(await Bun.password.verify(currentPassword, user.passwordHash)))
      throw new AccountError("CURRENT_PASSWORD_INVALID", "当前密码不正确", 400);
    const hash = await Bun.password.hash(newPassword);
    const time = now();
    this.db.transaction(
      (tx) => {
        tx.update(users)
          .set({ passwordHash: hash, passwordVersion: user.passwordVersion + 1, updatedAt: time })
          .where(eq(users.id, userId))
          .run();
        tx.update(authSessions)
          .set({ revokedAt: time })
          .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
          .run();
      },
      { behavior: "immediate" },
    );
  }

  getPreferences(userId: string): Preferences {
    const row = this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
    if (!row) throw new AccountError("USER_NOT_FOUND", "账号偏好不存在", 404);
    return {
      theme: row.theme,
      defaultRatio: row.defaultRatio,
      language: row.language,
      taskNotifications: row.taskNotifications,
      autoplayResults: row.autoplayResults,
    };
  }
  savePreferences(userId: string, preferences: Preferences) {
    this.db
      .update(userPreferences)
      .set({ ...preferences, updatedAt: now() })
      .where(eq(userPreferences.userId, userId))
      .run();
    return this.getPreferences(userId);
  }
  taskNotificationsEnabled(userId: string) {
    return Boolean(
      this.db
        .select({ enabled: userPreferences.taskNotifications })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .get()?.enabled,
    );
  }
  listNotifications(userId: string) {
    const rows = this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(50)
      .all();
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        readAt: row.readAt ?? undefined,
        createdAt: row.createdAt,
      })),
      unreadCount: rows.filter((row) => !row.readAt).length,
    };
  }
  markNotification(userId: string, id: string) {
    const existing = this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .get();
    if (!existing) throw new AccountError("NOT_FOUND", "通知不存在", 404);
    this.db
      .update(notifications)
      .set({ readAt: now() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)))
      .run();
    return this.listNotifications(userId).unreadCount;
  }
  markAllNotifications(userId: string) {
    this.db
      .update(notifications)
      .set({ readAt: now() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .run();
    return 0;
  }
  createNotification(userId: string, type: string, title: string, body: string, sourceId?: string) {
    this.db
      .insert(notifications)
      .values({ id: crypto.randomUUID(), userId, type, sourceId, title, body, createdAt: now() })
      .onConflictDoNothing()
      .run();
  }

  listOrders(userId: string) {
    return this.db
      .select()
      .from(rechargeOrders)
      .where(eq(rechargeOrders.userId, userId))
      .orderBy(desc(rechargeOrders.createdAt), desc(rechargeOrders.id))
      .limit(50)
      .all()
      .map((row) => this.order(row));
  }
  recharge(userId: string, packageId: string, idempotencyKey: string) {
    const pack = rechargePackages.find((item) => item.id === packageId);
    if (!pack) throw new AccountError("RECHARGE_PACKAGE_NOT_FOUND", "充值套餐不存在", 404);
    const fingerprint = `${userId}:${packageId}`;
    return this.db.transaction(
      (tx) => {
        const prior = tx
          .select()
          .from(rechargeOrders)
          .where(and(eq(rechargeOrders.userId, userId), eq(rechargeOrders.idempotencyKey, idempotencyKey)))
          .get();
        if (prior) {
          if (prior.requestFingerprint !== fingerprint)
            throw new AccountError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他套餐", 409);
          return this.order(prior);
        }
        const user = tx.select().from(users).where(eq(users.id, userId)).get();
        if (!user) throw new AccountError("USER_NOT_FOUND", "账号不存在", 404);
        const balance = user.credits + pack.credits;
        if (!Number.isSafeInteger(balance)) throw new AccountError("BALANCE_LIMIT", "余额超过安全上限", 409);
        const id = crypto.randomUUID();
        const created = now();
        tx.update(users).set({ credits: balance, updatedAt: created }).where(eq(users.id, userId)).run();
        const order: typeof rechargeOrders.$inferInsert = {
          id,
          userId,
          idempotencyKey,
          packageId: pack.id,
          amountCny: pack.amountCny,
          credits: pack.credits,
          balanceAfter: balance,
          requestFingerprint: fingerprint,
          status: "succeeded",
          createdAt: created,
          completedAt: created,
        };
        tx.insert(rechargeOrders).values(order).run();
        tx.insert(notifications)
          .values({
            id: crypto.randomUUID(),
            userId,
            type: "recharge_succeeded",
            sourceId: id,
            title: "充值成功",
            body: `${pack.name} 已到账 ${pack.credits.toLocaleString()} 创作点。`,
            createdAt: created,
          })
          .onConflictDoNothing()
          .run();
        return this.order(order as OrderRow);
      },
      { behavior: "immediate" },
    );
  }
  private order(row: OrderRow): RechargeOrder {
    return {
      id: row.id,
      packageId: row.packageId,
      amountCny: row.amountCny,
      credits: row.credits,
      status: "succeeded",
      paymentMode: "mock",
      balanceAfter: row.balanceAfter,
      createdAt: row.createdAt,
    };
  }

  createAsset(asset: MediaAsset) {
    this.db
      .insert(mediaAssets)
      .values({
        id: asset.id,
        ownerUserId: asset.ownerUserId,
        originalName: asset.originalName,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        durationSec: asset.durationSec,
        assetKind: asset.kind,
        displayName: asset.displayName,
        description: asset.description,
        folderId: asset.folderId,
        createdAt: asset.createdAt,
      })
      .run();
  }
  createProductAssets(product: Omit<ProductRecord, "images">, images: MediaAsset[]) {
    this.db.transaction(
      (tx) => {
        if (!images.length) return;
        tx.insert(mediaAssets)
          .values(
            images.map((asset, index) => ({
              id: asset.id,
              ownerUserId: asset.ownerUserId,
              originalName: asset.originalName,
              storageKey: asset.storageKey,
              mimeType: asset.mimeType,
              byteSize: asset.byteSize,
              width: asset.width,
              height: asset.height,
              durationSec: asset.durationSec,
              assetKind: "product" as const,
              displayName: product.name,
              description: product.description,
              productGroupId: product.id,
              sortOrder: index,
              sharingScope: product.sharingScope,
              createdAt: asset.createdAt,
            })),
          )
          .run();
      },
      { behavior: "immediate" },
    );
  }
  listProducts(userId: string): ProductRecord[] {
    const rows = this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.ownerUserId, userId), eq(mediaAssets.assetKind, "product")))
      .orderBy(desc(mediaAssets.createdAt), asc(mediaAssets.sortOrder))
      .all();
    const groups = new Map<string, ProductRecord>();
    for (const row of rows) {
      const groupId = row.productGroupId ?? row.id;
      const product = groups.get(groupId) ?? {
        id: groupId,
        ownerUserId: row.ownerUserId,
        name: row.displayName || row.originalName,
        description: row.description ?? undefined,
        sharingScope: row.sharingScope,
        images: [],
        createdAt: row.createdAt,
      };
      product.images.push(mediaAsset(row));
      groups.set(groupId, product);
    }
    return [...groups.values()];
  }
  listAssets(userId: string, kind?: MediaAsset["kind"], folderId?: string): MediaAsset[] {
    const conditions = [eq(mediaAssets.ownerUserId, userId)];
    if (kind) conditions.push(eq(mediaAssets.assetKind, kind));
    if (folderId) conditions.push(eq(mediaAssets.folderId, folderId));
    return this.db
      .select()
      .from(mediaAssets)
      .where(and(...conditions))
      .orderBy(desc(mediaAssets.createdAt))
      .all()
      .map(mediaAsset);
  }
  ensureDefaultAssetFolder(userId: string): AssetFolder {
    const existing = this.db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.ownerUserId, userId), isNull(assetFolders.parentId)))
      .orderBy(asc(assetFolders.createdAt))
      .limit(1)
      .get();
    if (existing) {
      const preferences = this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
      if (preferences && !preferences.defaultAssetFolderId)
        this.db
          .update(userPreferences)
          .set({ defaultAssetFolderId: existing.id })
          .where(eq(userPreferences.userId, userId))
          .run();
      return assetFolder(existing);
    }
    const id = crypto.randomUUID();
    const created = now();
    this.db
      .insert(assetFolders)
      .values({
        id,
        ownerUserId: userId,
        parentId: null,
        name: "默认",
        storagePrefix: `${userId}/materials/${id}/`,
        createdAt: created,
        updatedAt: created,
      })
      .run();
    const preferences = this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
    if (preferences && !preferences.defaultAssetFolderId)
      this.db
        .update(userPreferences)
        .set({ defaultAssetFolderId: id, updatedAt: created })
        .where(eq(userPreferences.userId, userId))
        .run();
    const folder = this.getAssetFolder(userId, id);
    if (!folder) throw new Error("默认文件夹创建失败");
    return folder;
  }
  getDefaultAssetFolderId(userId: string) {
    const folderId = this.db
      .select({ id: userPreferences.defaultAssetFolderId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get()?.id;
    return folderId && this.getAssetFolder(userId, folderId) ? folderId : this.ensureDefaultAssetFolder(userId).id;
  }
  setDefaultAssetFolder(userId: string, folderId: string) {
    const folder = this.getAssetFolder(userId, folderId);
    if (!folder) throw new AccountError("FOLDER_NOT_FOUND", "文件夹不存在", 404);
    this.db
      .update(userPreferences)
      .set({ defaultAssetFolderId: folderId, updatedAt: now() })
      .where(eq(userPreferences.userId, userId))
      .run();
    return folder;
  }
  listAssetFolders(userId: string): AssetFolder[] {
    this.ensureDefaultAssetFolder(userId);
    return this.db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.ownerUserId, userId))
      .orderBy(asc(assetFolders.createdAt))
      .all()
      .map(assetFolder);
  }
  getAssetFolder(userId: string, id: string): AssetFolder | undefined {
    const row = this.db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.id, id), eq(assetFolders.ownerUserId, userId)))
      .get();
    return row ? assetFolder(row) : undefined;
  }
  createAssetFolder(userId: string, name: string, parentId?: string): AssetFolder {
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) throw new AccountError("INVALID_FOLDER_NAME", "文件夹名称不能为空", 422);
    const parent = parentId ? this.getAssetFolder(userId, parentId) : undefined;
    if (parentId && !parent) throw new AccountError("FOLDER_NOT_FOUND", "上级文件夹不存在", 404);
    const parentCondition = parentId ? eq(assetFolders.parentId, parentId) : isNull(assetFolders.parentId);
    const duplicate = this.db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(and(eq(assetFolders.ownerUserId, userId), eq(assetFolders.name, cleanName), parentCondition))
      .get();
    if (duplicate) throw new AccountError("FOLDER_EXISTS", "同级目录下已存在同名文件夹", 409);
    const id = crypto.randomUUID();
    const created = now();
    const storagePrefix = parent ? `${parent.storagePrefix}${id}/` : `${userId}/materials/${id}/`;
    this.db
      .insert(assetFolders)
      .values({
        id,
        ownerUserId: userId,
        parentId,
        name: cleanName,
        storagePrefix,
        createdAt: created,
        updatedAt: created,
      })
      .run();
    const folder = this.getAssetFolder(userId, id);
    if (!folder) throw new Error("文件夹创建失败");
    return folder;
  }
  renameAssetFolder(userId: string, id: string, name: string): AssetFolder {
    const folder = this.getAssetFolder(userId, id);
    if (!folder) throw new AccountError("FOLDER_NOT_FOUND", "文件夹不存在", 404);
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) throw new AccountError("INVALID_FOLDER_NAME", "文件夹名称不能为空", 422);
    this.db
      .update(assetFolders)
      .set({ name: cleanName, updatedAt: now() })
      .where(and(eq(assetFolders.id, id), eq(assetFolders.ownerUserId, userId)))
      .run();
    return { ...folder, name: cleanName };
  }
  deleteAssetFolder(userId: string, id: string) {
    const folder = this.getAssetFolder(userId, id);
    if (!folder) throw new AccountError("FOLDER_NOT_FOUND", "文件夹不存在", 404);
    if (this.getDefaultAssetFolderId(userId) === id)
      throw new AccountError("DEFAULT_FOLDER_IN_USE", "请先将其他文件夹设为默认", 409);
    const hasChildren = this.db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(eq(assetFolders.parentId, id))
      .limit(1)
      .get();
    const hasAssets = this.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.folderId, id))
      .limit(1)
      .get();
    if (hasChildren || hasAssets) throw new AccountError("FOLDER_NOT_EMPTY", "请先移出或删除文件夹内的素材", 409);
    const roots = this.db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(and(eq(assetFolders.ownerUserId, userId), isNull(assetFolders.parentId)))
      .all();
    if (!folder.parentId && roots.length <= 1)
      throw new AccountError("DEFAULT_FOLDER_REQUIRED", "默认文件夹不能删除", 409);
    this.db
      .delete(assetFolders)
      .where(and(eq(assetFolders.id, id), eq(assetFolders.ownerUserId, userId)))
      .run();
  }
  ownsAsset(userId: string, id: string) {
    return Boolean(
      this.db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, id), eq(mediaAssets.ownerUserId, userId)))
        .get(),
    );
  }
  getOwnedAsset(userId: string, id: string) {
    const row = this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.ownerUserId, userId)))
      .get();
    return row ? mediaAsset(row) : undefined;
  }
  updateAssetMetadata(userId: string, id: string, metadata: { width?: number; height?: number; durationSec?: number }) {
    const current = this.getOwnedAsset(userId, id);
    if (!current || current.kind !== "media") return current;
    this.db
      .update(mediaAssets)
      .set({
        width: current.width ?? metadata.width,
        height: current.height ?? metadata.height,
        durationSec: current.durationSec ?? metadata.durationSec,
      })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.ownerUserId, userId), eq(mediaAssets.assetKind, "media")))
      .run();
    return this.getOwnedAsset(userId, id);
  }
  createArtifact(record: ArtifactRecord) {
    this.db.insert(artifacts).values(record).run();
  }
  getArtifact(userId: string, id: string) {
    const row = this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.ownerUserId, userId)))
      .get();
    return row ? { storage_key: row.storageKey, name: row.name, mime_type: row.mimeType } : null;
  }
}
