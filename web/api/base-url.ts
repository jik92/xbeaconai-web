const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "");
const ipHostname = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const productionApiOrigins: Readonly<Record<string, string>> = {
  "app.xbeaconai.com": "https://api.xbeaconai.com",
};

interface BrowserLocation {
  readonly hostname: string;
  readonly origin: string;
}

export function resolveApiBaseUrl(configured: string | undefined, location?: BrowserLocation) {
  if (location && (ipHostname.test(location.hostname) || location.hostname === "localhost")) return location.origin;
  const normalized = configured?.trim().replace(/\/$/, "");
  if (normalized) return normalized;
  if (!location) return "http://127.0.0.1:8787";
  return (
    productionApiOrigins[location.hostname] ??
    (URL.canParse(location.origin) ? location.origin : "http://127.0.0.1:8787")
  );
}

export function apiBaseUrl() {
  return resolveApiBaseUrl(configuredApiBaseUrl, typeof window === "undefined" ? undefined : window.location);
}

export function apiUrl(path: string) {
  return new URL(path, `${apiBaseUrl()}/`).toString();
}
