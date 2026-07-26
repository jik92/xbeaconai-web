# Makefile 数据库命令设计

## 目标

在 Makefile 中暴露项目已有的 Drizzle 数据库命令，方便通过统一入口生成和执行迁移。

## 设计

- `make db-generate` 调用 `bun run db:generate`，根据 `server/db/schema.ts` 生成版本化迁移。
- `make db-migrate` 调用 `bun run db:migrate`，将 `drizzle/` 中尚未执行的迁移应用到当前配置数据库。
- 两个目标都依赖 `_check_bun`。
- 不增加自动组合命令，不改变 Server 启动时的迁移行为。

## 验证

使用 Make dry-run 验证目标展开到正确的 Bun 脚本，避免在命令验证期间生成迁移或修改数据库。
