const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "");
const ipHostname = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function apiBaseUrl() {
  if (
    typeof window !== "undefined" &&
    (ipHostname.test(window.location.hostname) || window.location.hostname === "localhost")
  )
    return window.location.origin;
  if (configuredApiBaseUrl) return configuredApiBaseUrl;
  return typeof window === "undefined" ? "http://127.0.0.1:8787" : window.location.origin;
}

export function apiUrl(path: string) {
  return new URL(path, `${apiBaseUrl()}/`).toString();
}
