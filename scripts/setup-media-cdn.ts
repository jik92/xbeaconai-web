import TosClient, { TosServerCode, TosServerError } from "@volcengine/tos-sdk";
import { callVolcOpenApi, VolcOpenApiError } from "../server/providers/volc-openapi";

export const MEDIA_CDN_DEFAULT_ALLOWED_REFERERS = ["app.xbeaconai.com", "127.0.0.1"];
export const MEDIA_IMAGE_STYLES = {
  thumbnail: "image/resize,w_320,h_320,m_lfit/quality,q_75/format,webp",
  preview: "image/resize,w_1280,h_1280,m_lfit/format,webp",
} as const;
export const VOICE_PREVIEW_LIFECYCLE_RULE_ID = "expire-voice-previews";

type MediaLifecycleRule = {
  ID?: string;
  Prefix?: string;
  Status: "Enabled" | "Disabled";
  Expiration?: { Date?: string; Days?: number };
  [key: string]: unknown;
};

export function upsertVoicePreviewLifecycleRule<T extends MediaLifecycleRule>(rules: T[]) {
  return [
    ...rules.filter((rule) => rule.ID !== VOICE_PREVIEW_LIFECYCLE_RULE_ID),
    {
      ID: VOICE_PREVIEW_LIFECYCLE_RULE_ID,
      Prefix: "ephemeral/voice-previews/",
      Status: "Enabled" as const,
      Expiration: { Days: 1 },
    },
  ];
}

export interface MediaCdnConfigInput {
  domain: string;
  bucket: string;
  region: string;
  allowedReferers: string[];
}

export function mediaCdnDesiredConfig(_input: MediaCdnConfigInput) {
  const originAddress = `${_input.bucket}.tos-${_input.region}.volces.com`;
  return {
    Origin: [
      {
        OriginAction: {
          OriginLines: [
            {
              Address: originAddress,
              BucketName: _input.bucket,
              InstanceType: "tos",
              OriginHost: originAddress,
              OriginType: "primary",
              PrivateBucketAccess: true,
              Region: _input.region,
              Weight: "1",
            },
          ],
        },
      },
    ],
    CacheKey: [
      {
        CacheKeyAction: {
          CacheKeyComponents: [
            {
              Action: "include",
              IgnoreCase: true,
              Object: "queryString",
              Subobject: "*",
            },
          ],
        },
        Condition: {
          ConditionRule: [
            {
              Name: "",
              Object: "directory",
              Operator: "match",
              Type: "url",
              Value: "/",
            },
          ],
        },
      },
    ],
    RefererAccessRule: {
      Switch: true,
      RuleType: "allow",
      Referers: _input.allowedReferers,
      AllowEmpty: false,
      IgnoreCase: true,
    },
    Cache: [
      {
        CacheAction: {
          Action: "cache",
          DefaultPolicy: "force_cache",
          Ttl: 31_536_000,
        },
        Condition: {
          ConditionRule: [
            {
              Object: "directory",
              Operator: "match",
              Type: "url",
              Value: "/",
            },
          ],
        },
      },
    ],
  };
}

interface CdnDomain {
  Cname?: string;
  Domain?: string;
  Status?: string;
}

interface DnsRecord {
  Enable?: boolean;
  Host?: string;
  Type?: string;
  Value?: string;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

const domain = () => process.env.MEDIA_CDN_DOMAIN?.trim() || "files.xbeaconai.com";
const bucket = () => process.env.TOS_BUCKET?.trim() || "xbeacon-shanghai";
const region = () => process.env.TOS_REGION?.trim() || "cn-shanghai";
const zone = () => process.env.DNS_ZONE?.trim() || "xbeaconai.com";

function cloudConfig(service: "CDN" | "dns") {
  return {
    accessKeyId: required("TOS_ACCESS_KEY_ID"),
    secretAccessKey: required("TOS_SECRET_ACCESS_KEY"),
    endpoint: service === "CDN" ? "https://cdn.volcengineapi.com" : "https://dns.volcengineapi.com",
    region: service === "CDN" ? "cn-north-1" : "cn-beijing",
    service,
    version: service === "CDN" ? "2021-03-01" : "2018-08-01",
  };
}

function createTosClient() {
  const tosRegion = region();
  return new TosClient({
    accessKeyId: required("TOS_ACCESS_KEY_ID"),
    accessKeySecret: required("TOS_SECRET_ACCESS_KEY"),
    region: tosRegion,
    endpoint: process.env.TOS_SERVER_ENDPOINT?.trim() || `tos-${tosRegion}.ivolces.com`,
    secure: true,
    requestTimeout: 60_000,
    connectionTimeout: 15_000,
    maxRetryCount: 2,
  });
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readLifecycleRules(client: TosClient, bucketName: string) {
  try {
    return (await client.getBucketLifecycle({ bucket: bucketName })).data.Rules ?? [];
  } catch (error) {
    if (
      error instanceof TosServerError &&
      (error.statusCode === 404 || error.code === TosServerCode.NoSuchLifecycleConfiguration)
    )
      return [];
    throw error;
  }
}

export async function ensureMediaBucketOptimization(input: { apply: boolean }) {
  const bucketName = bucket();
  const client = createTosClient();
  const styles: Record<string, { current: string | null; desired: string; changed: boolean }> = {};
  for (const [styleName, desiredContent] of Object.entries(MEDIA_IMAGE_STYLES)) {
    const current = (await client.getBucketImageStyle(bucketName, styleName)).data?.Content ?? null;
    const changed = current !== desiredContent;
    styles[styleName] = { current, desired: desiredContent, changed };
    if (input.apply && changed)
      await client.putBucketImageStyle({
        bucket: bucketName,
        styleName,
        content: desiredContent,
      });
  }

  const currentLifecycle = await readLifecycleRules(client, bucketName);
  const desiredLifecycle = upsertVoicePreviewLifecycleRule(
    currentLifecycle as unknown as MediaLifecycleRule[],
  ) as Parameters<TosClient["putBucketLifecycle"]>[0]["rules"];
  const lifecycleChanged = !sameJson(currentLifecycle, desiredLifecycle);
  if (input.apply && lifecycleChanged)
    await client.putBucketLifecycle({
      bucket: bucketName,
      rules: desiredLifecycle,
    });

  const result = {
    mode: input.apply ? "apply" : "read-only",
    bucket: bucketName,
    styles,
    voicePreviewLifecycle: {
      changed: lifecycleChanged,
      ruleId: VOICE_PREVIEW_LIFECYCLE_RULE_ID,
      prefix: "ephemeral/voice-previews/",
      expirationDays: 1,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function cdn<Result>(action: string, input: Record<string, unknown>) {
  return callVolcOpenApi<Result>(cloudConfig("CDN"), action, input);
}

async function dns<Result>(action: string, input: Record<string, unknown>) {
  return callVolcOpenApi<Result>(cloudConfig("dns"), action, input);
}

async function listDomain() {
  const result = await cdn<{ Data?: CdnDomain[] }>("ListCdnDomains", {
    Domain: domain(),
    PageNum: 1,
    PageSize: 10,
  });
  return result?.Data?.find((item) => item.Domain === domain());
}

async function ensureDnsRecord(cname: string) {
  const zones = await dns<{ Zones?: Array<{ ZID?: number; ZoneName?: string }> }>("ListZones", {
    SearchMode: "exact",
    Key: zone(),
    PageNumber: 1,
    PageSize: 10,
  });
  const zid = zones?.Zones?.find((item) => item.ZoneName === zone())?.ZID;
  if (!zid) throw new Error(`DNS Zone 不存在：${zone()}`);
  const listed = await dns<{ Records?: DnsRecord[] }>("ListRecords", {
    ZID: zid,
    PageNumber: 1,
    PageSize: 500,
  });
  const host = domain().replace(`.${zone()}`, "");
  const existing = listed?.Records?.filter((item) => item.Host === host) ?? [];
  const normalizedCname = cname.replace(/\.$/, "");
  if (
    existing.some(
      (item) => item.Enable !== false && item.Type === "CNAME" && item.Value?.replace(/\.$/, "") === normalizedCname,
    )
  )
    return;
  if (existing.length) throw new Error(`${domain()} 已存在不一致的 DNS 记录，请人工核对后再执行`);
  await dns("CreateRecord", {
    ZID: zid,
    Host: host,
    Type: "CNAME",
    Value: normalizedCname,
    Line: "default",
    TTL: 600,
    Weight: 1,
    Remark: "xbeacon library media CDN",
  });
}

async function waitForCname() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await listDomain();
    if (current?.Cname) return current.Cname;
    await Bun.sleep(10_000);
  }
  throw new Error("等待媒体 CDN CNAME 超时");
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.includes("--bucket-only")) {
    await ensureMediaBucketOptimization({ apply });
    return;
  }
  const input = {
    domain: domain(),
    bucket: bucket(),
    region: region(),
    allowedReferers: (process.env.MEDIA_CDN_ALLOWED_REFERERS || MEDIA_CDN_DEFAULT_ALLOWED_REFERERS.join(","))
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
  const desired = mediaCdnDesiredConfig(input);
  const current = await listDomain();
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "read-only",
        domain: input.domain,
        bucket: input.bucket,
        current: current ? { status: current.Status, cname: current.Cname } : null,
        desired,
      },
      null,
      2,
    ),
  );
  await ensureMediaBucketOptimization({ apply });
  if (!apply) return;

  const certificateId = required("MEDIA_CDN_CERT_ID");
  if (!current) {
    await cdn("AddCdnDomain", {
      Domain: input.domain,
      ServiceType: "download",
      ServiceRegion: "chinese_mainland",
      OriginProtocol: "https",
      Project: "default",
      ...desired,
    });
  } else {
    await cdn("UpdateCdnConfig", { Domain: input.domain, ...desired });
  }
  const deployed = await cdn<{
    DeployResult?: Array<{ Domain?: string; ErrorMsg?: string; Status?: string }>;
  }>("BatchDeployCert", {
    CertId: certificateId,
    Domain: input.domain,
  });
  const failed = deployed?.DeployResult?.find((item) => item.Status !== "success");
  if (failed) throw new Error(`媒体 CDN 证书部署失败：${failed.ErrorMsg ?? failed.Domain ?? "未知错误"}`);
  const cname = await waitForCname();
  await ensureDnsRecord(cname);
  console.log(`媒体 CDN 配置完成：bucket=${input.bucket} cname=${cname} url=https://${input.domain}/`);
}

if (import.meta.main)
  main().catch((error) => {
    if (error instanceof VolcOpenApiError)
      console.error(`火山引擎 API 错误：code=${error.code} requestId=${error.requestId ?? "unknown"}`);
    else console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
