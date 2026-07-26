# Makefile Database Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 Drizzle 脚本增加 `make db-generate` 和 `make db-migrate` 两个入口。

**Architecture:** Makefile 只作为现有 `package.json` 脚本的薄代理层。命令执行前复用 `_check_bun`，不复制 Drizzle 配置或数据库路径逻辑。

**Tech Stack:** GNU Make、Bun、Drizzle Kit

## Global Constraints

- 只增加 `db-generate` 和 `db-migrate`。
- 不增加组合命令。
- 不改变数据库 Schema、迁移文件或启动迁移逻辑。

---

### Task 1: 增加 Makefile 数据库目标

**Files:**
- Modify: `Makefile`

**Interfaces:**
- Consumes: `package.json` 中的 `db:generate` 与 `db:migrate` scripts。
- Produces: `make db-generate` 与 `make db-migrate` 命令。

- [ ] **Step 1: 验证目标当前不存在**

Run: `make -n db-generate`
Expected: FAIL with `No rule to make target 'db-generate'`

- [ ] **Step 2: 添加最小实现**

```make
.PHONY: _check_bun run-dev run-server run-worker db-generate db-migrate lint test ci

db-generate: _check_bun
	$(BUN) run db:generate

db-migrate: _check_bun
	$(BUN) run db:migrate
```

- [ ] **Step 3: 验证命令展开**

Run: `make -n db-generate && make -n db-migrate`
Expected: 输出分别包含 `bun run db:generate` 和 `bun run db:migrate`。

- [ ] **Step 4: 检查补丁格式**

Run: `git diff --check`
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add Makefile docs/plans/2026-07-26-makefile-database-commands-design.md docs/superpowers/plans/2026-07-26-makefile-database-commands.md
git commit -m "chore: add make database migration commands"
```
