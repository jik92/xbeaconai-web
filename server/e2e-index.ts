export {};

process.env.FORCE_MOCK = "true";
process.env.BLOCK_AI_OUTBOUND = "true";
process.env.YAOZUO_DATA_DIR = `.data/e2e-${process.pid}`;
const { app, queue } = await import("./app");
const { env } = await import("./env");
const { APP_CONFIG } = await import("../src/app/config");
queue.start();
Bun.serve({ port:env.port,hostname:env.host,fetch:app.fetch });
console.log(`${APP_CONFIG.projectName} E2E API ready at http://${env.host}:${env.port}`);
