export {};

process.env.FORCE_MOCK = "true";
process.env.BLOCK_AI_OUTBOUND = "true";
process.env.BYOK_ENCRYPTION_KEY = "playwright-byok-encryption-secret-at-least-32-characters";
process.env.ADMIN_PHONE = "17688743518";
process.env.SMS_VERIFICATION_FIXED_CODE = "246810";
process.env.YAOZUO_DATA_DIR = `.data/e2e-${process.pid}`;
const { app } = await import("./app");
const { env } = await import("./env");
const { APP_CONFIG } = await import("../web/app/config");
Bun.serve({ port: env.port, hostname: env.host, fetch: app.fetch });
console.log(`${APP_CONFIG.projectName} E2E API ready at http://${env.host}:${env.port}`);
