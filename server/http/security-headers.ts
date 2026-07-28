export function buildSecurityHeaders(publicMediaOrigin?: string) {
  const publicMediaSource = publicMediaOrigin ? ` ${publicMediaOrigin}` : "";
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
    "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:${publicMediaSource}; media-src 'self'${publicMediaSource}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  };
}
