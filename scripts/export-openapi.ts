import { mkdir } from "node:fs/promises";
import { app } from "../server/app";
import { normalizeOpenApi31ExclusiveBounds } from "./openapi-normalize";

await mkdir("openapi", { recursive: true });
const response = await app.request("http://127.0.0.1/openapi.json");
if (!response.ok) throw new Error(`OpenAPI export failed: ${response.status}`);
const document = normalizeOpenApi31ExclusiveBounds(await response.json());
await Bun.write("openapi/openapi.json", `${JSON.stringify(document, null, 2)}\n`);
console.log("Wrote openapi/openapi.json");
