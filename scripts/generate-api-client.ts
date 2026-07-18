import { createClient } from "@hey-api/openapi-ts";

await createClient({
  input: "./openapi/openapi.json",
  output: { path: "src/api/generated", clean: true },
  plugins: [
    "@hey-api/client-fetch",
    "@hey-api/typescript",
    "@hey-api/sdk",
    "zod",
    "@tanstack/react-query",
  ],
});

console.log("Generated src/api/generated");
