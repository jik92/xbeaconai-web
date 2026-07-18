# 仓库清理与 Biome 设计

## 目标

清除当前工作区全部非 ignored 的 Git 未跟踪内容，只保留已提交文件和 ignored 内容；随后引入 Biome，为手写源码提供统一的格式化和静态检查命令。

## 清理边界

- 删除 `git status --short` 中所有 `??` 文件与目录；`.gitignore` 已忽略的内容保持不变。
- 不删除、回退或覆盖任何 Git 已跟踪文件。
- 删除前使用 `git clean -nd` 输出精确目标，确认目标均为未跟踪内容。
- 使用 `git clean -fd` 执行删除，禁止使用会包含 ignored 内容的 `-x` 或 `-X`。删除内容不可通过 Git 恢复。
- 清理完成后，工作区只允许出现本任务新建或修改的 Biome 配置、依赖锁文件、脚本，以及格式化或安全修复产生的已跟踪源码改动。

## Biome 配置

- 将固定版本的 `@biomejs/biome` 加入 `devDependencies`，使用 Bun 更新锁文件。
- 新增根目录 `biome.json`。
- 通过 `files.includes` 只纳入 `src/**`、`server/**`、`scripts/**`、`tests/**` 中的 TypeScript、TSX、JavaScript、JSX、JSON、CSS，以及根目录同类型配置文件。
- 排除 `src/api/generated/**`、`openapi/**`、`dist/**`、`test-results/**`、`playwright-report/**`、`tests/fixtures/**`、`tests/visual/**`、`public/portraits.json` 和依赖目录。
- 启用 Git VCS 集成并设置 `useIgnoreFile: true`，让 `.gitignore` 继续生效。
- 对纳入的手写源码启用 formatter、推荐 lint 规则和 import organize assist。
- 使用 2 空格缩进、120 字符行宽、LF 换行、双引号、始终保留分号，并对 JavaScript/TypeScript 使用 `trailingCommas: "all"`。
- `check:fix` 只应用 Biome 的安全修复，不传 `--unsafe`，不自动执行可能改变产品行为的危险修复。
- 不对生成代码和大体积数据文件制造格式化噪音。

## 命令

- `bun run lint` → `biome lint .`。
- `bun run format` → `biome format --write .`。
- `bun run format:check` → `biome format .`。
- `bun run check` → `biome check .`，运行 formatter、linter 和已配置的 assist 检查。
- `bun run check:fix` → `biome check --write .`，应用安全修复、格式化和已配置的 assist；不启用 unsafe fixes。

## 验证

- `git status` 不再包含清理前的未跟踪内容。
- `bun run check` 和 `bun run format:check` 通过。
- 单元测试、TypeScript 检查和生产构建继续运行；若存在与本任务无关的既有错误，必须单独列出，不能通过扩大忽略范围掩盖。
