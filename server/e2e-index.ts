export {};

process.env.FORCE_MOCK = "true";
process.env.YAOZUO_DATA_DIR = `.data/e2e-${process.pid}`;
const { app, queue } = await import("./app");
const { env } = await import("./env");
queue.start();
Bun.serve({ port:env.port,hostname:env.host,fetch:app.fetch });
console.log(`曜作 E2E API ready at http://${env.host}:${env.port}`);
