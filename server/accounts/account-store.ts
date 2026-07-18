import { Database } from "bun:sqlite";
import { env } from "../env";
import { APP_CONFIG } from "../../src/app/config";

export interface UserSummary { id:string; email:string; displayName:string; avatarText:string; credits:number }
export interface Preferences { theme:"light"|"system"; defaultRatio:"9:16"|"16:9"|"1:1"; language:"zh-CN"|"en"; taskNotifications:boolean; autoplayResults:boolean }
export interface NotificationItem { id:string; type:string; title:string; body:string; readAt?:string; createdAt:string }
export interface RechargeOrder { id:string; packageId:string; amountCny:number; credits:number; status:"succeeded"; paymentMode:"mock"; balanceAfter:number; createdAt:string }
export interface MediaAsset { id:string; ownerUserId:string; storageKey:string; originalName:string; mimeType:string; byteSize:number; createdAt:string }
export interface ArtifactRecord { id:string; ownerUserId:string; jobId:string; storageKey:string; name:string; mimeType:string; createdAt:string }

interface UserRow { id:string; email:string; password_hash:string; display_name:string; avatar_text:string; credits:number; status:string; password_version:number; created_at:string; updated_at:string }
interface SessionRow { id:string;user_id:string;jti:string;expires_at:string;revoked_at:string|null;password_version:number }
interface NotificationRow { id:string;type:string;title:string;body:string;read_at:string|null;created_at:string }
interface OrderRow { id:string;package_id:string;amount_cny:number;credits:number;balance_after:number;status:string;created_at:string }

export class AccountError extends Error {
  constructor(readonly code:string, message:string, readonly status:400|401|404|409|422=400) { super(message); }
}

export const rechargePackages = [
  { id:"starter",name:"轻量补给",amountCny:19,credits:1000,badge:"适合体验" },
  { id:"creator",name:"创作加速",amountCny:49,credits:3000,badge:"最受欢迎" },
  { id:"studio",name:"工作室包",amountCny:99,credits:7500,badge:"高频创作" },
] as const;

const normalizeEmail=(email:string)=>email.trim().toLowerCase();
const now=()=>new Date().toISOString();
const userSummary=(row:UserRow):UserSummary=>({id:row.id,email:row.email,displayName:row.display_name,avatarText:row.avatar_text,credits:row.credits});

export class AccountStore {
  readonly db:Database;
  constructor(path=env.databasePath){
    this.db=new Database(path,{create:true,strict:true});
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,avatar_text TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 2480 CHECK(credits>=0 AND credits<=9007199254740991),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),password_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),jti TEXT NOT NULL UNIQUE,password_version INTEGER NOT NULL,
        expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id),theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','system')),
        default_ratio TEXT NOT NULL DEFAULT '9:16' CHECK(default_ratio IN ('9:16','16:9','1:1')),
        language TEXT NOT NULL DEFAULT 'zh-CN' CHECK(language IN ('zh-CN','en')),
        task_notifications INTEGER NOT NULL DEFAULT 1,autoplay_results INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL,source_id TEXT,title TEXT NOT NULL,
        body TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_idx ON notifications(user_id,type,source_id) WHERE source_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS recharge_orders (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),idempotency_key TEXT NOT NULL,package_id TEXT NOT NULL,
        amount_cny INTEGER NOT NULL CHECK(amount_cny>0),credits INTEGER NOT NULL CHECK(credits>0),balance_after INTEGER NOT NULL,
        request_fingerprint TEXT NOT NULL,status TEXT NOT NULL CHECK(status='succeeded'),created_at TEXT NOT NULL,completed_at TEXT NOT NULL,
        UNIQUE(user_id,idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL REFERENCES users(id),original_name TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,expires_at TEXT,created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL,storage_key TEXT NOT NULL,
        name TEXT NOT NULL,mime_type TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credit_charges (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL UNIQUE,
        amount INTEGER NOT NULL CHECK(amount>0),balance_after INTEGER NOT NULL CHECK(balance_after>=0),created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS artifacts_owner_idx ON artifacts(owner_user_id,id);
      CREATE TABLE IF NOT EXISTS migration_state (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
    `);
    const jobColumns=this.db.query("PRAGMA table_info(jobs)").all() as Array<{name:string}>;
    if(jobColumns.length&&!jobColumns.some(column=>column.name==="owner_user_id"))this.db.exec("ALTER TABLE jobs ADD COLUMN owner_user_id TEXT");
    if(jobColumns.length)this.db.exec("CREATE INDEX IF NOT EXISTS jobs_owner_created_idx ON jobs(owner_user_id,created_at DESC)");
  }

  async register(input:{email:string;password:string;displayName:string}){
    const email=normalizeEmail(input.email);const passwordHash=await Bun.password.hash(input.password);const id=crypto.randomUUID();const created=now();let claimedLegacy=false;
    try{
      this.db.exec("BEGIN IMMEDIATE");
      this.db.query("INSERT INTO users(id,email,password_hash,display_name,avatar_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,email,passwordHash,input.displayName.trim(),input.displayName.trim().slice(0,2)||"曜",created,created);
      this.db.query("INSERT INTO user_preferences(user_id,updated_at) VALUES(?,?)").run(id,created);
      this.db.query("INSERT INTO notifications(id,user_id,type,title,body,created_at) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(),id,"welcome",`欢迎来到${APP_CONFIG.projectName}`,"账号已创建，可以开始你的第一个创作任务。",created);
      const legacy=this.db.query("SELECT value FROM migration_state WHERE key='legacy_owner_user_id'").get() as {value:string}|null;
      if(!legacy){this.db.query("INSERT INTO migration_state(key,value,updated_at) VALUES('legacy_owner_user_id',?,?)").run(id,created);this.db.query("UPDATE jobs SET owner_user_id=? WHERE owner_user_id IS NULL").run(id);claimedLegacy=true}
      this.db.exec("COMMIT");
    }catch(error){try{this.db.exec("ROLLBACK")}catch{/* no transaction */}if(String(error).includes("UNIQUE"))throw new AccountError("EMAIL_ALREADY_REGISTERED","该邮箱已注册",409);throw error}
    return {user:this.getUser(id)!,claimedLegacy};
  }

  async verifyCredentials(email:string,password:string){
    const row=this.db.query("SELECT * FROM users WHERE email=?").get(normalizeEmail(email)) as UserRow|null;
    const valid=row?await Bun.password.verify(password,row.password_hash):await Bun.password.verify(password,"$2b$10$7EqJtq98hPqEX7fNZaFWoOhiLK9IrXAMiE0gfs7JZ/fH5rVgqpE7i").catch(()=>false);
    if(!row||!valid||row.status!=="active")throw new AccountError("INVALID_CREDENTIALS","邮箱或密码错误",401);
    return userSummary(row);
  }

  getUser(id:string){const row=this.db.query("SELECT * FROM users WHERE id=?").get(id) as UserRow|null;return row?userSummary(row):undefined}
  getUserSecurity(id:string){return this.db.query("SELECT * FROM users WHERE id=?").get(id) as UserRow|null}
  createSession(userId:string,expiresAt:string){const user=this.getUserSecurity(userId)!;const session={id:crypto.randomUUID(),jti:crypto.randomUUID(),passwordVersion:user.password_version};const t=now();this.db.query("INSERT INTO auth_sessions(id,user_id,jti,password_version,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(session.id,userId,session.jti,session.passwordVersion,expiresAt,t,t);return session}
  validateSession(userId:string,sid:string,jti:string,passwordVersion:number,allowRevoked=false){const row=this.db.query("SELECT * FROM auth_sessions WHERE id=? AND jti=? AND user_id=?").get(sid,jti,userId) as SessionRow|null;const user=this.getUserSecurity(userId);if(!row||!user||user.status!=="active"||row.password_version!==passwordVersion||user.password_version!==passwordVersion||(!allowRevoked&&row.revoked_at))return undefined;if(Date.parse(row.expires_at)<=Date.now())return undefined;return {user:userSummary(user),revoked:Boolean(row.revoked_at)}}
  revokeSession(sid:string){this.db.query("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(now(),sid)}

  updateProfile(userId:string,input:{email:string;displayName:string;avatarText:string}){try{this.db.query("UPDATE users SET email=?,display_name=?,avatar_text=?,updated_at=? WHERE id=?").run(normalizeEmail(input.email),input.displayName.trim(),input.avatarText.trim().slice(0,2),now(),userId)}catch(error){if(String(error).includes("UNIQUE"))throw new AccountError("EMAIL_ALREADY_REGISTERED","该邮箱已被使用",409);throw error}return this.getUser(userId)!}
  async changePassword(userId:string,currentPassword:string,newPassword:string){const user=this.getUserSecurity(userId);if(!user||!await Bun.password.verify(currentPassword,user.password_hash))throw new AccountError("CURRENT_PASSWORD_INVALID","当前密码不正确",400);const hash=await Bun.password.hash(newPassword);const t=now();this.db.exec("BEGIN IMMEDIATE");try{this.db.query("UPDATE users SET password_hash=?,password_version=password_version+1,updated_at=? WHERE id=?").run(hash,t,userId);this.db.query("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?").run(t,userId);this.db.exec("COMMIT")}catch(error){this.db.exec("ROLLBACK");throw error}}

  getPreferences(userId:string):Preferences{const row=this.db.query("SELECT * FROM user_preferences WHERE user_id=?").get(userId) as any;return{theme:row.theme,defaultRatio:row.default_ratio,language:row.language,taskNotifications:Boolean(row.task_notifications),autoplayResults:Boolean(row.autoplay_results)}}
  savePreferences(userId:string,p:Preferences){this.db.query("UPDATE user_preferences SET theme=?,default_ratio=?,language=?,task_notifications=?,autoplay_results=?,updated_at=? WHERE user_id=?").run(p.theme,p.defaultRatio,p.language,p.taskNotifications?1:0,p.autoplayResults?1:0,now(),userId);return this.getPreferences(userId)}
  taskNotificationsEnabled(userId:string){const row=this.db.query("SELECT task_notifications FROM user_preferences WHERE user_id=?").get(userId) as {task_notifications:number}|null;return Boolean(row?.task_notifications)}
  listNotifications(userId:string){const rows=this.db.query("SELECT id,type,title,body,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50").all(userId) as NotificationRow[];return{notifications:rows.map(row=>({id:row.id,type:row.type,title:row.title,body:row.body,readAt:row.read_at??undefined,createdAt:row.created_at})),unreadCount:rows.filter(row=>!row.read_at).length}}
  markNotification(userId:string,id:string){const result=this.db.query("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?").run(now(),id,userId);if(!result.changes)throw new AccountError("NOT_FOUND","通知不存在",404);return this.listNotifications(userId).unreadCount}
  markAllNotifications(userId:string){this.db.query("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=?").run(now(),userId);return 0}
  createNotification(userId:string,type:string,title:string,body:string,sourceId?:string){try{this.db.query("INSERT INTO notifications(id,user_id,type,source_id,title,body,created_at) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(),userId,type,sourceId??null,title,body,now())}catch(error){if(!String(error).includes("UNIQUE"))throw error}}

  listOrders(userId:string){const rows=this.db.query("SELECT * FROM recharge_orders WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50").all(userId) as OrderRow[];return rows.map(row=>this.order(row))}
  recharge(userId:string,packageId:string,idempotencyKey:string){const pack=rechargePackages.find(item=>item.id===packageId);if(!pack)throw new AccountError("RECHARGE_PACKAGE_NOT_FOUND","充值套餐不存在",404);const fingerprint=`${userId}:${packageId}`;this.db.exec("BEGIN IMMEDIATE");try{const prior=this.db.query("SELECT * FROM recharge_orders WHERE user_id=? AND idempotency_key=?").get(userId,idempotencyKey) as OrderRow&{request_fingerprint:string}|null;if(prior){if(prior.request_fingerprint!==fingerprint)throw new AccountError("IDEMPOTENCY_CONFLICT","幂等键已用于其他套餐",409);this.db.exec("COMMIT");return this.order(prior)}const user=this.getUser(userId)!;const balance=user.credits+pack.credits;if(!Number.isSafeInteger(balance))throw new AccountError("BALANCE_LIMIT","余额超过安全上限",409);const id=crypto.randomUUID(),created=now();this.db.query("UPDATE users SET credits=?,updated_at=? WHERE id=?").run(balance,created,userId);this.db.query("INSERT INTO recharge_orders(id,user_id,idempotency_key,package_id,amount_cny,credits,balance_after,request_fingerprint,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,userId,idempotencyKey,pack.id,pack.amountCny,pack.credits,balance,fingerprint,"succeeded",created,created);this.createNotification(userId,"recharge_succeeded","充值成功",`${pack.name} 已到账 ${pack.credits.toLocaleString()} 创作点。`,id);this.db.exec("COMMIT");return this.order(this.db.query("SELECT * FROM recharge_orders WHERE id=?").get(id) as OrderRow)}catch(error){try{this.db.exec("ROLLBACK")}catch{/* committed replay */}throw error}}
  private order(row:OrderRow):RechargeOrder{return{id:row.id,packageId:row.package_id,amountCny:row.amount_cny,credits:row.credits,status:"succeeded",paymentMode:"mock",balanceAfter:row.balance_after,createdAt:row.created_at}}

  createAsset(asset:MediaAsset){this.db.query("INSERT INTO media_assets(id,owner_user_id,original_name,storage_key,mime_type,byte_size,created_at) VALUES(?,?,?,?,?,?,?)").run(asset.id,asset.ownerUserId,asset.originalName,asset.storageKey,asset.mimeType,asset.byteSize,asset.createdAt)}
  ownsAsset(userId:string,id:string){return Boolean(this.db.query("SELECT 1 FROM media_assets WHERE id=? AND owner_user_id=?").get(id,userId))}
  getOwnedAsset(userId:string,id:string){const row=this.db.query("SELECT id,owner_user_id,storage_key,original_name,mime_type,byte_size,created_at FROM media_assets WHERE id=? AND owner_user_id=?").get(id,userId) as {id:string;owner_user_id:string;storage_key:string;original_name:string;mime_type:string;byte_size:number;created_at:string}|null;return row?{id:row.id,ownerUserId:row.owner_user_id,storageKey:row.storage_key,originalName:row.original_name,mimeType:row.mime_type,byteSize:row.byte_size,createdAt:row.created_at}:undefined}
  createArtifact(record:ArtifactRecord){this.db.query("INSERT INTO artifacts(id,owner_user_id,job_id,storage_key,name,mime_type,created_at) VALUES(?,?,?,?,?,?,?)").run(record.id,record.ownerUserId,record.jobId,record.storageKey,record.name,record.mimeType,record.createdAt)}
  getArtifact(userId:string,id:string){return this.db.query("SELECT * FROM artifacts WHERE id=? AND owner_user_id=?").get(id,userId) as {storage_key:string;name:string;mime_type:string}|null}
}
