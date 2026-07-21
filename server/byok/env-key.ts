import { type ProviderCredentialName, providerCredentialNames } from "./credential-definitions";

export const maxEnvKeyBytes = 64 * 1024;
const credentialNameSet = new Set<string>(providerCredentialNames);
const providerEnvironmentNamePattern = /^(?:OPENAI_|VOLC_|TOS_)/;
const relatedProviderEnvironmentNames = new Set(["VIDEO_ANALYSIS_MODEL"]);
const assignmentPattern = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export interface ParsedEnvKey {
  values: Partial<Record<ProviderCredentialName, string>>;
  empty: ProviderCredentialName[];
  ignored: string[];
}

function parseValue(raw: string, lineNumber: number) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length === 1) throw new Error(`第 ${lineNumber} 行双引号未闭合`);
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new Error(`第 ${lineNumber} 行双引号内容无效`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) throw new Error(`第 ${lineNumber} 行单引号未闭合`);
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvKey(contents: string): ParsedEnvKey {
  if (Buffer.byteLength(contents, "utf8") > maxEnvKeyBytes) throw new Error(".env.key 不能超过 64KB");
  const values: ParsedEnvKey["values"] = {};
  const empty = new Set<ProviderCredentialName>();
  const ignored = new Set<string>();
  for (const [index, sourceLine] of contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(assignmentPattern);
    if (!match) throw new Error(`第 ${index + 1} 行不是有效的 KEY=VALUE`);
    const name = match[1] ?? "";
    if (!credentialNameSet.has(name)) {
      ignored.add(name);
      continue;
    }
    const credentialName = name as ProviderCredentialName;
    const value = parseValue(match[2] ?? "", index + 1).trim();
    if (value) {
      values[credentialName] = value;
      empty.delete(credentialName);
    } else {
      delete values[credentialName];
      empty.add(credentialName);
    }
  }
  return { values, empty: [...empty], ignored: [...ignored] };
}

export function serializeEnvKey(values: Partial<Record<ProviderCredentialName, string>>) {
  return `${providerCredentialNames.map((name) => `${name}=${values[name] ?? ""}`).join("\n")}\n`;
}

export function removeProviderEnvironment(contents: string) {
  return contents
    .split(/(?<=\n)/)
    .filter((line) => {
      const match = line.trim().match(assignmentPattern);
      const name = match?.[1] ?? "";
      return !match || (!providerEnvironmentNamePattern.test(name) && !relatedProviderEnvironmentNames.has(name));
    })
    .join("");
}
