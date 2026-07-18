const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "");

export function apiBaseUrl() {
  if (configuredApiBaseUrl) return configuredApiBaseUrl;
  return typeof window === "undefined" ? "http://127.0.0.1:8787" : window.location.origin;
}

export function apiUrl(path: string) {
  return new URL(path, `${apiBaseUrl()}/`).toString();
}
