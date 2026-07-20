import { createClient } from "@hey-api/openapi-ts";

await createClient({
  input: "./openapi/openapi.json",
  output: { path: "web/api/generated", clean: true },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk", "zod", "@tanstack/react-query"],
});

console.log("Generated web/api/generated");
