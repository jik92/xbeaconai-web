import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./server/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.YAOZUO_DATABASE_URL ?? `${process.env.YAOZUO_DATA_DIR ?? ".data"}/yaozuo.sqlite`,
  },
});
