# Qwen Official Dialect TTS CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parameterized Bun CLI for official Qwen-Audio-TTS dialect/style synthesis and generate eight listening samples.

**Architecture:** Keep pure catalog, argument parsing, instruction, and payload builders importable for unit tests. Gate network execution behind `import.meta.main`, read the authorized workspace CSV only at runtime, and download each returned audio URL with bounded retries.

**Tech Stack:** Bun, TypeScript, Bun Test, Alibaba Cloud Model Studio HTTP API.

## Global Constraints

- Never print or persist the API Key.
- Use the official Beijing workspace endpoint and nested `input` payload.
- Only expose dialect names explicitly supported by the official model documentation.
- Preserve unrelated working-tree changes.

---

### Task 1: Pure CLI contract

**Files:**
- Create: `scripts/qwen-official-tts.ts`
- Test: `tests/unit/qwen-official-tts.test.ts`

**Interfaces:**
- Produces: `parseQwenTtsArgs`, `buildQwenTtsInstruction`, `buildQwenTtsRequest`, dialect/style catalogs.

- [ ] Write failing tests for accepted options, rejected values, instruction composition, and the official request payload.
- [ ] Run `bun test tests/unit/qwen-official-tts.test.ts` and confirm the missing module failure.
- [ ] Implement the pure catalog and builder functions.
- [ ] Run the test and confirm it passes.

### Task 2: Official API execution

**Files:**
- Modify: `scripts/qwen-official-tts.ts`

**Interfaces:**
- Consumes: parsed CLI options and request builder.
- Produces: a validated WAV file for single or sample mode.

- [ ] Add secure CSV parsing, official endpoint construction, request error handling, and three-attempt audio download.
- [ ] Add single and eight-sample execution modes behind `import.meta.main`.
- [ ] Run Biome and TypeScript checks.
- [ ] Execute `--samples` against the authorized CSV.
- [ ] Verify all files with FFprobe.
