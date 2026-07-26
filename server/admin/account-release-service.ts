import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { and, eq, inArray, or } from "drizzle-orm";
import type { AccountStore } from "../accounts/account-store";
import {
  adminCreditGrants,
  adScriptProjects,
  adScriptVariants,
  adScriptVersions,
  arkPortraitGroups,
  artifacts,
  assetFolders,
  authSessions,
  creditCharges,
  creditRefunds,
  customPortraits,
  jobs,
  mediaAssets,
  moduleOutputFolderDefaults,
  notifications,
  objectCleanup,
  passwordSetupTokens,
  providerCredentials,
  providerGenerationAudits,
  rechargeOrders,
  smsVerificationCodes,
  userPreferences,
  users,
  videoCreateMaterialVersions,
  videoCreateProjects,
  videoCreateScriptSections,
  videoCreateScriptVersions,
  videoCreateShots,
} from "../db/schema";
import { env } from "../env";
import { ArkAssetsError, arkAssets } from "../providers/ark-assets";
import { ossutils } from "../storage/ossutils";

const terminalJobStatuses = new Set(["succeeded", "partially_succeeded", "failed", "cancelled"]);

interface AccountReleaseStorage {
  configured: boolean;
  deletePrefixPermanently(prefix: string): Promise<number>;
  deleteKeysPermanently(keys: string[]): Promise<number>;
}

interface AccountReleaseArk {
  configured: boolean;
  deleteAsset(id: string, projectName?: string): Promise<unknown>;
  deleteAssetGroup(id: string, projectName?: string): Promise<unknown>;
}

export interface AdminAccountReleaseSummary {
  userId: string;
  displayName: string;
  phone: string;
  deletedArkAssets: number;
  deletedArkGroups: number;
  deletedTosObjects: number;
}

export class AccountReleaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AccountReleaseError";
  }
}

export interface AdminAccountReleaseServiceOptions {
  storage?: AccountReleaseStorage;
  ark?: AccountReleaseArk;
  dataDir?: string;
}

export class AdminAccountReleaseService {
  private readonly storage: AccountReleaseStorage;
  private readonly ark: AccountReleaseArk;
  private readonly dataDir: string;

  constructor(
    private readonly accounts: AccountStore,
    options: AdminAccountReleaseServiceOptions = {},
  ) {
    this.storage = options.storage ?? ossutils;
    this.ark = options.ark ?? arkAssets;
    this.dataDir = options.dataDir ?? env.dataDir;
  }

  private preflight(userId: string, adminUserId: string) {
    const user = this.accounts.getUserSecurity(userId);
    if (!user) throw new AccountReleaseError("USER_NOT_FOUND", "账号不存在");
    if (userId === adminUserId || env.adminPhones.has(user.phone))
      throw new AccountReleaseError("ADMIN_RELEASE_FORBIDDEN", "不能释放管理员账号");
    if (user.status !== "disabled") throw new AccountReleaseError("USER_NOT_DISABLED", "只能释放已注销账号");
    const activeJob = this.accounts.db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.ownerUserId, userId))
      .all()
      .find((job) => !terminalJobStatuses.has(job.status));
    if (activeJob)
      throw new AccountReleaseError("USER_HAS_ACTIVE_JOBS", "账号仍有排队或运行中的任务，请等待任务结束后重试", true);
    return user;
  }

  private async removeArkResource(operation: () => Promise<unknown>) {
    try {
      await operation();
      return true;
    } catch (error) {
      if (error instanceof ArkAssetsError && error.code.toLowerCase().includes("notfound")) return false;
      throw error;
    }
  }

  private async removeSafePath(root: string, key: string, recursive = false) {
    const target = resolve(root, key);
    const relativePath = relative(root, target);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return;
    await rm(target, { force: true, recursive });
  }

  private async removeLocalFiles(userId: string, storageKeys: string[]) {
    const uploadRoot = resolve(this.dataDir, "uploads");
    const resultRoot = resolve(this.dataDir, "results");
    for (const key of storageKeys) {
      await this.removeSafePath(uploadRoot, key);
      await this.removeSafePath(resultRoot, key);
    }
    await this.removeSafePath(uploadRoot, userId, true);
    await this.removeSafePath(resultRoot, userId, true);
  }

  private deleteDatabaseRecords(userId: string, phone: string, adminUserId: string) {
    this.accounts.db.transaction(
      (tx) => {
        const current = tx.select().from(users).where(eq(users.id, userId)).get();
        if (!current) throw new AccountReleaseError("USER_NOT_FOUND", "账号不存在");
        if (current.id === adminUserId || env.adminPhones.has(current.phone))
          throw new AccountReleaseError("ADMIN_RELEASE_FORBIDDEN", "不能释放管理员账号");
        if (current.status !== "disabled") throw new AccountReleaseError("USER_NOT_DISABLED", "只能释放已注销账号");
        const userJobs = tx
          .select({ id: jobs.id, status: jobs.status })
          .from(jobs)
          .where(eq(jobs.ownerUserId, userId))
          .all();
        if (userJobs.some((job) => !terminalJobStatuses.has(job.status)))
          throw new AccountReleaseError("USER_HAS_ACTIVE_JOBS", "账号仍有排队或运行中的任务", true);
        const jobIds = userJobs.map((job) => job.id);

        const adProjectIds = tx
          .select({ id: adScriptProjects.id })
          .from(adScriptProjects)
          .where(eq(adScriptProjects.ownerUserId, userId))
          .all()
          .map((item) => item.id);
        if (adProjectIds.length) {
          const variantIds = tx
            .select({ id: adScriptVariants.id })
            .from(adScriptVariants)
            .where(inArray(adScriptVariants.projectId, adProjectIds))
            .all()
            .map((item) => item.id);
          if (variantIds.length)
            tx.delete(adScriptVersions).where(inArray(adScriptVersions.variantId, variantIds)).run();
          tx.delete(adScriptVariants).where(inArray(adScriptVariants.projectId, adProjectIds)).run();
          tx.delete(adScriptProjects).where(inArray(adScriptProjects.id, adProjectIds)).run();
        }

        const videoProjectIds = tx
          .select({ id: videoCreateProjects.id })
          .from(videoCreateProjects)
          .where(eq(videoCreateProjects.ownerUserId, userId))
          .all()
          .map((item) => item.id);
        if (videoProjectIds.length) {
          const sectionIds = tx
            .select({ id: videoCreateScriptSections.id })
            .from(videoCreateScriptSections)
            .where(inArray(videoCreateScriptSections.projectId, videoProjectIds))
            .all()
            .map((item) => item.id);
          tx.delete(videoCreateMaterialVersions)
            .where(inArray(videoCreateMaterialVersions.projectId, videoProjectIds))
            .run();
          tx.delete(videoCreateShots).where(inArray(videoCreateShots.projectId, videoProjectIds)).run();
          if (sectionIds.length)
            tx.delete(videoCreateScriptVersions).where(inArray(videoCreateScriptVersions.sectionId, sectionIds)).run();
          tx.delete(videoCreateScriptSections)
            .where(inArray(videoCreateScriptSections.projectId, videoProjectIds))
            .run();
          tx.delete(videoCreateProjects).where(inArray(videoCreateProjects.id, videoProjectIds)).run();
        }

        tx.delete(customPortraits).where(eq(customPortraits.ownerUserId, userId)).run();
        tx.delete(arkPortraitGroups).where(eq(arkPortraitGroups.ownerUserId, userId)).run();
        tx.delete(providerGenerationAudits).where(eq(providerGenerationAudits.ownerUserId, userId)).run();
        tx.delete(artifacts).where(eq(artifacts.ownerUserId, userId)).run();
        if (jobIds.length) tx.delete(objectCleanup).where(inArray(objectCleanup.jobId, jobIds)).run();
        tx.delete(creditCharges).where(eq(creditCharges.userId, userId)).run();
        tx.delete(creditRefunds).where(eq(creditRefunds.userId, userId)).run();
        tx.delete(jobs).where(eq(jobs.ownerUserId, userId)).run();
        tx.delete(moduleOutputFolderDefaults).where(eq(moduleOutputFolderDefaults.ownerUserId, userId)).run();
        tx.delete(userPreferences).where(eq(userPreferences.userId, userId)).run();
        tx.delete(mediaAssets).where(eq(mediaAssets.ownerUserId, userId)).run();
        tx.delete(assetFolders).where(eq(assetFolders.ownerUserId, userId)).run();
        tx.delete(authSessions).where(eq(authSessions.userId, userId)).run();
        tx.delete(passwordSetupTokens).where(eq(passwordSetupTokens.userId, userId)).run();
        tx.delete(notifications).where(eq(notifications.userId, userId)).run();
        tx.delete(rechargeOrders).where(eq(rechargeOrders.userId, userId)).run();
        tx.delete(adminCreditGrants)
          .where(or(eq(adminCreditGrants.userId, userId), eq(adminCreditGrants.adminUserId, userId)))
          .run();
        tx.delete(smsVerificationCodes).where(eq(smsVerificationCodes.phone, phone)).run();
        tx.update(providerCredentials)
          .set({ updatedByUserId: null })
          .where(eq(providerCredentials.updatedByUserId, userId))
          .run();
        tx.delete(users)
          .where(and(eq(users.id, userId), eq(users.status, "disabled")))
          .run();
        if (tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).get())
          throw new AccountReleaseError("USER_RELEASE_CONFLICT", "账号状态已发生变化");
      },
      { behavior: "immediate" },
    );
  }

  async releaseUser(userId: string, adminUserId: string): Promise<AdminAccountReleaseSummary> {
    const user = this.preflight(userId, adminUserId);
    const portraits = this.accounts.db
      .select({ arkAssetId: customPortraits.arkAssetId })
      .from(customPortraits)
      .where(eq(customPortraits.ownerUserId, userId))
      .all();
    const group = this.accounts.db
      .select({ groupId: arkPortraitGroups.groupId, projectName: arkPortraitGroups.projectName })
      .from(arkPortraitGroups)
      .where(eq(arkPortraitGroups.ownerUserId, userId))
      .get();
    const mediaKeys = this.accounts.db
      .select({ key: mediaAssets.storageKey })
      .from(mediaAssets)
      .where(eq(mediaAssets.ownerUserId, userId))
      .all()
      .map((item) => item.key);
    const artifactKeys = this.accounts.db
      .select({ key: artifacts.storageKey })
      .from(artifacts)
      .where(eq(artifacts.ownerUserId, userId))
      .all()
      .map((item) => item.key);
    const stagingKeys = this.accounts.db
      .select({ keys: jobs.stagingKeys })
      .from(jobs)
      .where(eq(jobs.ownerUserId, userId))
      .all()
      .flatMap((item) => item.keys);
    const storageKeys = [...new Set([...mediaKeys, ...artifactKeys, ...stagingKeys])];
    const arkAssetIds = [...new Set(portraits.flatMap((item) => (item.arkAssetId ? [item.arkAssetId] : [])))];

    if ((arkAssetIds.length || group?.groupId) && !this.ark.configured)
      throw new AccountReleaseError("ARK_ASSETS_NOT_CONFIGURED", "Ark 素材服务未配置，无法删除自建虚拟人像", true);
    if (!this.storage.configured)
      throw new AccountReleaseError("TOS_NOT_CONFIGURED", "TOS 未配置，无法验证并删除账号对象", true);
    let deletedArkAssets = 0;
    for (const assetId of arkAssetIds) {
      if (await this.removeArkResource(() => this.ark.deleteAsset(assetId, group?.projectName))) deletedArkAssets += 1;
    }
    let deletedArkGroups = 0;
    const groupId = group?.groupId;
    if (groupId && (await this.removeArkResource(() => this.ark.deleteAssetGroup(groupId, group.projectName))))
      deletedArkGroups = 1;

    const prefix = `${userId}/`;
    let deletedTosObjects = await this.storage.deletePrefixPermanently(prefix);
    const extraKeys = storageKeys.filter((key) => !key.startsWith(prefix));
    deletedTosObjects += await this.storage.deleteKeysPermanently(extraKeys);
    await this.removeLocalFiles(userId, storageKeys);
    this.deleteDatabaseRecords(userId, user.phone, adminUserId);

    return {
      userId,
      displayName: user.displayName,
      phone: user.phone,
      deletedArkAssets,
      deletedArkGroups,
      deletedTosObjects,
    };
  }
}
