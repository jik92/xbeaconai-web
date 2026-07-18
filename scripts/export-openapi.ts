import { mkdir } from "node:fs/promises";
import { app } from "../server/app";

await mkdir("openapi", { recursive: true });
const response = await app.request("http://127.0.0.1/openapi.json");
if (!response.ok) throw new Error(`OpenAPI export failed: ${response.status}`);
const document = await response.json();
await Bun.write("openapi/openapi.json", `${JSON.stringify(document, null, 2)}\n`);
console.log("Wrote openapi/openapi.json");
