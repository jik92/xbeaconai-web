import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

const migrationUrl = new URL("../../drizzle/0019_true_black_crow.sql", import.meta.url);

test("千川迁移可在已有千川表的数据库中安全执行", async () => {
  const sql = (await Bun.file(migrationUrl).text()).replaceAll("--> statement-breakpoint", "");
  const database = new Database(":memory:");

  try {
    database.exec(sql);
    expect(() => database.exec(sql)).not.toThrow();
  } finally {
    database.close();
  }
});
