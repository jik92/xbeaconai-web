import { readFile } from "node:fs/promises";
import { callVolcOpenApi, VolcOpenApiError } from "../server/providers/volc-openapi";
import { ensureWebBucket } from "./deploy-web-cdn";

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

const domain = () => process.env.CDN_DOMAIN?.trim() || "app.xbeaconai.com";
const bucket = () => process.env.TOS_WEB_BUCKET?.trim() || "xbeaconai-web-prod";
const zone = () => process.env.DNS_ZONE?.trim() || "xbeaconai.com";
const apiServerIp = () => process.env.API_SERVER_IP?.trim() || "118.196.101.57";

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

async function cdn<Result>(action: string, input: Record<string, unknown>) {
  return callVolcOpenApi<Result>(cloudConfig("CDN"), action, input);
}

async function dns<Result>(action: string, input: Record<string, unknown>) {
  return callVolcOpenApi<Result>(cloudConfig("dns"), action, input);
}

async function listCdnDomain() {
  const result = await cdn<{ Data?: CdnDomain[] }>("ListCdnDomains", {
    Domain: domain(),
    PageNum: 1,
    PageSize: 10,
  });
  return result?.Data?.find((item) => item.Domain === domain());
}

async function ensureCdnDomain() {
  const existing = await listCdnDomain();
  if (!existing) {
    const originAddress = `${bucket()}.tos-${required("TOS_REGION")}.volces.com`;
    await cdn("AddCdnDomain", {
      Domain: domain(),
      ServiceType: "web",
      ServiceRegion: "chinese_mainland",
      OriginProtocol: "https",
      Project: "default",
      Origin: [
        {
          OriginAction: {
            OriginLines: [
              {
                Address: originAddress,
                BucketName: bucket(),
                InstanceType: "tos",
                OriginHost: originAddress,
                OriginType: "primary",
                PrivateBucketAccess: true,
                Region: required("TOS_REGION"),
                Weight: "1",
              },
            ],
          },
        },
      ],
    });
  }

  await cdn("UpdateCdnConfig", {
    Domain: domain(),
    OriginRewrite: {
      Switch: true,
      OriginRewriteRule: [
        {
          OriginRewriteAction: {
            SourcePath: "^/(?:[^./]+/)*[^./]*$",
            TargetPath: "/index.html",
          },
        },
      ],
    },
  });
}

async function ensureCertificate() {
  const listed = await cdn<{ CertInfo?: Array<{ CertId?: string }> }>("ListCertInfo", {
    Source: "volc_cert_center",
    CertType: "server_cert",
    Name: domain(),
    Status: "running",
    PageNum: 1,
    PageSize: 100,
  });
  let certId = listed?.CertInfo?.find((item) => item.CertId)?.CertId;
  if (!certId) {
    const certificatePath =
      process.env.CDN_CERTIFICATE_PATH?.trim() || `/etc/letsencrypt/live/${domain()}/fullchain.pem`;
    const privateKeyPath = process.env.CDN_PRIVATE_KEY_PATH?.trim() || `/etc/letsencrypt/live/${domain()}/privkey.pem`;
    const [certificate, privateKey] = await Promise.all([
      readFile(certificatePath, "utf8"),
      readFile(privateKeyPath, "utf8"),
    ]);
    const added = await cdn<{ CertId?: string }>("AddCertificate", {
      Source: "volc_cert_center",
      Certificate: certificate.replaceAll("\n", "\r\n"),
      PrivateKey: privateKey.replaceAll("\n", "\r\n"),
      Repeatable: false,
      Desc: `${domain()} production`,
    });
    certId = added?.CertId;
  }
  if (!certId) throw new Error("无法获取 CDN 证书 ID");
  const deployed = await cdn<{ DeployResult?: Array<{ Domain?: string; ErrorMsg?: string; Status?: string }> }>(
    "BatchDeployCert",
    { CertId: certId, Domain: domain() },
  );
  const failed = deployed?.DeployResult?.find((item) => item.Status !== "success");
  if (failed) throw new Error(`CDN 证书部署失败：${failed.ErrorMsg ?? failed.Domain ?? "未知错误"}`);
}

async function waitForCname() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await listCdnDomain();
    if (current?.Cname) return current;
    await Bun.sleep(10_000);
  }
  throw new Error("等待 CDN CNAME 超时");
}

async function ensureDnsRecord(zid: number, record: Required<Pick<DnsRecord, "Host" | "Type" | "Value">>) {
  const listed = await dns<{ Records?: DnsRecord[] }>("ListRecords", {
    ZID: zid,
    PageNumber: 1,
    PageSize: 500,
  });
  const existing = listed?.Records?.filter((item) => item.Host === record.Host) ?? [];
  const matching = existing.find(
    (item) => item.Enable !== false && item.Type === record.Type && item.Value?.replace(/\.$/, "") === record.Value,
  );
  if (matching) return;
  if (existing.length > 0) {
    throw new Error(`${record.Host}.${zone()} 已存在不一致的 DNS 记录，请人工核对后再执行`);
  }
  await dns("CreateRecord", {
    ZID: zid,
    Host: record.Host,
    Type: record.Type,
    Value: record.Value,
    Line: "default",
    TTL: 600,
    Weight: 1,
    Remark: "xbeacon web",
  });
}

async function ensureDns(cname: string) {
  const zones = await dns<{ Zones?: Array<{ ZID?: number; ZoneName?: string }> }>("ListZones", {
    SearchMode: "exact",
    Key: zone(),
    PageNumber: 1,
    PageSize: 10,
  });
  const zid = zones?.Zones?.find((item) => item.ZoneName === zone())?.ZID;
  if (!zid) throw new Error(`DNS Zone 不存在：${zone()}`);
  await ensureDnsRecord(zid, { Host: "app", Type: "CNAME", Value: cname.replace(/\.$/, "") });
  await ensureDnsRecord(zid, { Host: "api", Type: "A", Value: apiServerIp() });
}

async function main() {
  await ensureWebBucket();
  await ensureCdnDomain();
  await ensureCertificate();
  const current = await waitForCname();
  const cname = current.Cname?.replace(/\.$/, "");
  if (!cname) throw new Error("CDN 未返回 CNAME");
  await ensureDns(cname);
  console.log(`CDN 初始化完成：bucket=${bucket()} cname=${cname} url=https://${domain()}/`);
}

if (import.meta.main)
  main().catch((error) => {
    if (error instanceof VolcOpenApiError)
      console.error(`火山引擎 API 错误：action failed code=${error.code} requestId=${error.requestId ?? "unknown"}`);
    else console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
