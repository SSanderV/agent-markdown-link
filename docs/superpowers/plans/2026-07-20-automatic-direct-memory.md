# Automatic Direct Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every accepted durable-memory capture an immediately searchable, immutable Markdown record without requiring Inbox promotion.

**Architecture:** Add one optional top-level `memoryPath` and a `memory` write mode. Capture writes one no-overwrite record beneath that shared vault path, while lexical search automatically adds the same path to every project's configured roots; `projectId` remains provenance only. Existing Inbox and outbox behavior remains compatible.

**Tech Stack:** Node.js 22, TypeScript 6, Ajv JSON Schema, Vitest, existing Node filesystem APIs, existing artifact packager.

## Global Constraints

- Implement only direct memory capture and immediate global lexical recall; do not add curation, scheduling, embeddings, deduplication, migration, sharding, deletion, quotas, project filters, or dependencies.
- Preserve local-only operation, sanitized errors, bounded inputs and outputs, vault containment, symlink safety, no overwrite, credential refusal, no content in logs or metrics, and the capture kill switch.
- Do not invoke Git, network services, Obsidian, sync software, or background processes from runtime code.
- New setup configurations default to `writeMode: "memory"`; existing valid configurations retain their behavior, and omitted `writeMode` still resolves to `outbox`.
- `memoryPath` is global across all configured projects. `projectId` is written only as provenance and never restricts default retrieval.
- Keep the current capture request and receipt fields, including `candidateId`, for compatibility.
- Use existing Node APIs and current helpers. Add no framework, capability layer, factory, interface hierarchy, or general-purpose abstraction.
- Use test-driven development: add each behavior test, observe the expected failure, implement the minimum code, then rerun the focused tests.
- Do not touch a real vault, local installed plugin, user configuration, remote, or release service.

---

### Task 1: Add the backward-compatible configuration contract

**Files:**
- Modify: `schemas/config.schema.json`
- Modify: `packages/core/src/config/types.ts`
- Test: `packages/core/test/unit/config.test.ts`

**Interfaces:**
- Produces: `WriteMode = "outbox" | "inbox" | "memory"`.
- Produces: optional top-level `AgentMarkdownConfigV1.memoryPath` and `AgentMarkdownConfigV1.inboxPath`.
- Guarantees: a validated `memory` configuration has `memoryPath`; a validated `inbox` configuration has `inboxPath`; `outbox` needs neither.

- [ ] **Step 1: Add failing configuration tests**

Add focused cases equivalent to:

```ts
it("accepts direct memory and preserves its shared vault path", () => {
  const resolved = validateConfig({
    ...validConfig,
    inboxPath: undefined,
    writeMode: "memory",
    memoryPath: "Memory/Automatic",
  });
  expect(resolved).toMatchObject({ writeMode: "memory", memoryPath: "Memory/Automatic" });
});

it.each([
  ["memory without memoryPath", { ...validConfig, inboxPath: undefined, writeMode: "memory" }],
  ["inbox without inboxPath", { ...validConfig, inboxPath: undefined, writeMode: "inbox" }],
  ["escaping memoryPath", { ...validConfig, writeMode: "memory", memoryPath: "../Memory" }],
])("rejects %s", (_name, value) => {
  expect(() => validateConfig(value)).toThrowError(
    expect.objectContaining({ code: "E_CONFIG_INVALID" }),
  );
});

it("allows an explicit outbox without an Inbox", () => {
  expect(() => validateConfig({ ...validConfig, inboxPath: undefined, writeMode: "outbox" }))
    .not.toThrow();
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```text
npx vitest run packages/core/test/unit/config.test.ts
```

Expected: the new memory-mode cases fail because `memoryPath` and `memory` are not in schema v1 and `inboxPath` is globally required.

- [ ] **Step 3: Implement the minimum schema and type changes**

Change the types to:

```ts
export type WriteMode = "outbox" | "inbox" | "memory";

export interface AgentMarkdownConfigV1 {
  readonly schemaVersion: 1;
  readonly vaultRoot: string;
  readonly inboxPath?: string;
  readonly memoryPath?: string;
  // Existing fields remain unchanged.
}
```

In `config.schema.json`:

- remove `inboxPath` from the root `required` list;
- add `memoryPath` using the existing `vaultRelativePath` definition;
- add `memory` to the `writeMode` enum; and
- add two `if`/`then` conditions that require `inboxPath` only for explicit `writeMode: "inbox"` and `memoryPath` only for explicit `writeMode: "memory"`.

Do not change the schema version. Let the existing `validateConfig` default keep omitted `writeMode` as `outbox`.

- [ ] **Step 4: Run focused configuration validation and confirm GREEN**

Run:

```text
npx vitest run packages/core/test/unit/config.test.ts
npm run validate:schemas
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the configuration slice**

```text
git add schemas/config.schema.json packages/core/src/config/types.ts packages/core/test/unit/config.test.ts
git commit -m "feat: add direct memory configuration"
```

### Task 2: Store immutable memory and search it globally

**Files:**
- Modify: `packages/core/src/candidates/serialize.ts`
- Modify: `packages/core/src/candidates/capture.ts`
- Modify: `packages/core/src/search/search.ts`
- Test: `packages/core/test/unit/context-candidate.test.ts`
- Test: `packages/core/test/unit/search.test.ts`

**Interfaces:**
- Consumes: validated optional `memoryPath` and `writeMode: "memory"` from Task 1.
- Produces: `serializeMemory(request, metadata): string` alongside the unchanged candidate serializer.
- Produces: one memory record at `<memoryPath>/<timestamp>-<uuid>.md` with the existing receipt shape.
- Produces: search roots equal to configured project roots plus the one shared `memoryPath`, with existing canonical-file suppression handling overlap.

- [ ] **Step 1: Add failing direct-capture tests**

Extend the test fixture to accept `writeMode: "memory"` and `memoryPath`. Create the memory directory before capture, then assert:

```ts
const result = await captureCandidate(config, project, request, FIXED_OPTIONS);
expect(result.relativePath).toBe(
  "Memory/Automatic/20260717T123456789Z-11111111-2222-4333-8444-555555555555.md",
);
expect(await readFile(memoryFile, "utf8")).toContain(
  "schema: agent-markdown-link/memory",
);
expect(await readFile(memoryFile, "utf8")).toContain("status: memory");
expect(await readFile(memoryFile, "utf8")).toContain("## Memory\n\nKeep this fact.");
```

Retain assertions for ordered metadata, rationale/evidence, no absolute-path leakage, and the second-write `E_ALREADY_EXISTS` failure. Keep the existing Inbox and outbox tests unchanged.

- [ ] **Step 2: Add failing global-recall tests**

Add a search fixture option for `memoryPath`. With `project.searchRoots` empty, create `Memory/Automatic/decision.md` and assert `searchMarkdown` finds it. Add a second project with different workspace/search roots and call search with that project to prove the same global memory is returned. Add an overlap case where `searchRoots` already contains `Memory` and confirm `searchedFiles` counts the memory file once.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```text
npx vitest run packages/core/test/unit/context-candidate.test.ts packages/core/test/unit/search.test.ts
```

Expected: direct capture and empty-project-root recall fail because memory mode is not implemented.

- [ ] **Step 4: Implement the direct serializer and write branch**

Keep both serializers in `serialize.ts`. The new serializer uses the existing field order and optional sections, changing only:

```ts
"schema: agent-markdown-link/memory"
"status: memory"
`## Memory\n\n${request.proposedKnowledge}`
```

In `captureCandidate`, select `serializeMemory` only for `writeMode === "memory"`. Publish memory under `config.vaultRoot` with:

```ts
relativePath = `${memoryPath}/${filename}`;
```

If an impossible post-validation missing path reaches capture, throw the fixed `E_INTERNAL` error. Do not create the memory directory and do not change the existing Inbox/outbox paths or receipt.

- [ ] **Step 5: Add the shared memory root to lexical search**

Inside `searchMarkdown`, derive the roots without adding a new exported abstraction:

```ts
const searchRoots = [
  ...project.searchRoots,
  ...(config.memoryPath === undefined ? [] : [config.memoryPath]),
];
```

Use `searchRoots` for both the early-empty check and traversal loop. Keep all current traversal budgets, symlink handling, sorting, ranking, truncation, and canonical-file tracking intact.

- [ ] **Step 6: Run focused and security regressions and confirm GREEN**

Run:

```text
npx vitest run packages/core/test/unit/context-candidate.test.ts packages/core/test/unit/search.test.ts
npm run test:security
npm run typecheck
npm run lint
```

Expected: all commands exit 0 with no warnings.

- [ ] **Step 7: Commit the core vertical path**

```text
git add packages/core/src/candidates/serialize.ts packages/core/src/candidates/capture.ts packages/core/src/search/search.ts packages/core/test/unit/context-candidate.test.ts packages/core/test/unit/search.test.ts
git commit -m "feat: store and recall direct memories"
```

### Task 3: Make new setup and packaged hosts use direct memory

**Files:**
- Modify: `packages/cli/src/init.ts`
- Modify: `packages/cli/src/mcp-server.ts`
- Test: `packages/cli/test/unit/main.test.ts`
- Test: `tests/integration/plugins/mcp-server.test.ts`
- Modify: `skills/agent-markdown-link/SKILL.md`
- Modify: `README.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/SUBMISSION-TESTS.md`
- Modify: `docs/reference/example-config.json`
- Modify: `PRIVACY.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `packages/core/package.json`
- Modify: `packages/cli/package.json`
- Modify: `.claude-plugin/marketplace.json`
- Test: `tests/contracts/plugin-artifacts.test.ts`
- Test: `tests/contracts/release-readiness.test.ts`
- Generated by existing build: `marketplace/claude/plugins/agent-markdown-link/**`
- Generated by existing build: `marketplace/codex/plugins/agent-markdown-link/**`

**Interfaces:**
- Consumes: direct memory configuration, capture, and search from Tasks 1–2.
- Produces: new wizard configs with `writeMode: "memory"` and an existing `memoryPath` by default.
- Produces: an explicit legacy `inbox` wizard choice without changing existing configurations.
- Produces: matching Codex/Claude packaged runtime and skill artifacts at version `0.4.0`.

- [ ] **Step 1: Add failing setup-wizard tests**

Update the primary wizard test input to choose the default memory mode and an existing `Memory/Automatic` directory. Assert the config contains `memoryPath` and no `inboxPath`, and stdout includes a short warning that AML does not configure Git or sync exclusions.

Add one legacy-mode test that enters `inbox`, supplies an existing Inbox, and receives the old `writeMode: "inbox"` shape. Update the unsafe/missing-directory tests so memory traversal and a nonexistent memory directory both return the sanitized input failure without creating a config.

- [ ] **Step 2: Run the wizard tests and confirm RED**

Run:

```text
npx vitest run packages/cli/test/unit/main.test.ts
```

Expected: the memory-mode expectations fail because the wizard always writes Inbox mode.

- [ ] **Step 3: Implement the minimal wizard choice**

Add a local parser that accepts only an empty answer/`memory` or `inbox`. Prompt:

```text
Capture destination [memory/inbox] [memory]:
```

For memory, prompt for `Existing automatic memory folder, relative to vault [Memory/Agent Markdown Link]:`; for Inbox, retain the existing Inbox prompt. Build exactly one of `memoryPath` or `inboxPath`, validate the config, and call `assertDirectory(path.join(validated.vaultRoot, selectedPath))`. Do not create vault folders. After writing the config, print one fixed warning that AML does not configure Git or sync exclusions and private memory must not be published unintentionally.

- [ ] **Step 4: Add the Cowork/default-project integration assertion**

In the MCP integration fixture, configure `defaultProjectId`, `memoryPath`, and no project search roots. Create one synthetic memory note, invoke the MCP `search` tool without a mapped `CLAUDE_PROJECT_DIR`, and assert its vault-relative result path is returned. Keep the vault temporary and assert no canonical note changes.

- [ ] **Step 5: Update host-facing descriptions and agent behavior**

Change the MCP capture description to direct durable-memory language that remains accurate for legacy Inbox configurations. Update the source skill so it says accepted captures are stored according to local configuration and are immediately searchable in memory mode; remove the instruction that every capture always awaits human promotion. Retain the durable-only, credential-free, no-direct-summary-edit rules.

- [ ] **Step 6: Update concise public documentation and the example**

Document:

- direct memory as the new setup default;
- the existing-folder requirement;
- immediate global search across mapped/default projects;
- `projectId` as provenance, not a retrieval boundary for `memoryPath`;
- Inbox/outbox compatibility and the one-time manual opt-in for existing users;
- plaintext/sync/Git privacy responsibility;
- curated startup notes as optional derived views that AML does not edit automatically; and
- no automatic Git, network, Obsidian, sync, deletion, summary editing, or background activity.

Update the synthetic example to `writeMode: "memory"` with `memoryPath: "Memory/Automatic"`. Do not mention product retirement history or private user data.

- [ ] **Step 7: Bump the unreleased plugin artifacts to 0.4.0**

Update only the existing version locations and dependency pin from `0.3.0` to `0.4.0`, update contract expectations, and add a `0.4.0 - 2026-07-20` changelog entry describing direct memory/global recall. Do not publish, tag, push, or install it.

- [ ] **Step 8: Run focused tests and build generated artifacts**

Run:

```text
npx vitest run packages/cli/test/unit/main.test.ts tests/integration/plugins/mcp-server.test.ts
npm run build
npm run validate:plugins
npm run test:release
```

Expected: all commands exit 0, and generated Codex/Claude marketplace artifacts contain matching runtime, skill, docs, and version metadata.

- [ ] **Step 9: Run the exact final verification suite**

Run:

```text
npm ci
npm run ci
git diff --check
```

Expected: dependency installation exits 0; the full build, typecheck, lint, schema, unit, integration, security, plugin, and release checks all pass; diff check reports nothing.

- [ ] **Step 10: Commit the setup, docs, release metadata, and generated artifacts**

```text
git add packages/cli packages/core/package.json package.json package-lock.json schemas skills README.md docs PRIVACY.md SECURITY.md CHANGELOG.md .claude-plugin tests marketplace
git commit -m "feat: default new setups to direct memory"
```

## Final Autonomous Review Gate

- [ ] Record the feature branch base and head commits and prepare one full diff package.
- [ ] Give one independent reviewer a compact capsule containing only `GOAL`, `CRITERIA`, `DELTA`, `EVIDENCE`, `REMAINING_GAP`, and `KNOWN_BLOCKERS`, plus the design, plan, and diff-package paths.
- [ ] Require `VERDICT: PASS | BLOCKED`, `BLOCKERS`, and `NEXT_GAP`.
- [ ] Fix every Critical or Important finding in one repair pass, rerun covering tests, then request one fresh re-review. Record Minor findings unless trivial and clearly valuable.
- [ ] Stop if the same blocker survives two repairs or two consecutive iterations show no measurable progress.
- [ ] After the last mutation, rerun `npm run ci` and `git diff --check` on the exact branch head. Do not push, publish, release, globally install, modify the user's real configuration, or touch the real vault.
