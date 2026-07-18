import { app, queue } from "./app";
import { env } from "./env";
import { resolve, sep } from "node:path";
import { APP_CONFIG } from "../src/app/config";

queue.start();

console.log(`${APP_CONFIG.projectName} API ready at http://${env.host}:${env.port}`);
console.log(`OpenAPI: http://${env.host}:${env.port}/openapi.json`);

const distRoot = resolve("dist");
const indexFile = Bun.file(resolve(distRoot,"index.html"));

async function fetch(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/openapi.json") return app.fetch(request);
  let pathname:string;
  try { pathname=decodeURIComponent(url.pathname); } catch { return new Response("Bad request",{status:400}); }
  const requested = resolve(distRoot, `.${pathname}`);
  if (requested !== distRoot && !requested.startsWith(`${distRoot}${sep}`)) return new Response("Not found",{status:404});
  const asset = Bun.file(requested);
  if (await asset.exists() && asset.type !== "application/octet-stream") return new Response(asset,{headers:{"Cache-Control":pathname.startsWith("/assets/")?"public, max-age=31536000, immutable":"no-cache"}});
  if (await indexFile.exists()) return new Response(indexFile,{headers:{"Cache-Control":"no-cache"}});
  return new Response("Frontend build not found. Run bun run build first.",{status:503});
}

export default { port: env.port, hostname: env.host, fetch };
