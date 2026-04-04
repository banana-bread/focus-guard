# Feature: scaffold-phase3-chrome-mock-logger

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to existing ESLint config — it bans `no-console`, `no-default-export`, and requires `explicit-function-return-type`. Test/mock files have `no-console` and `no-default-export` relaxed.

## Feature Description

Implement the Chrome API mock and structured logger that every future feature slice will depend on. This is Phase 3 of the scaffold PRD — the final infrastructure layer before feature development begins.

Two files need to be created from nearly-empty stubs:
1. `src/__mocks__/chrome.ts` — currently `export {};`, needs the full Chrome API mock body
2. `src/core/logger.ts` — does not yet exist, needs the `createLogger` factory
3. `src/core/logger.test.ts` — smoke tests for the logger

## User Story

As an AI coding agent implementing feature slices,
I want a pre-wired Chrome API mock and a structured logger factory,
So that I can write tests and log structured events without any infrastructure decisions.

## Problem Statement

`src/__mocks__/chrome.ts` is an empty stub. `src/core/` does not exist. No structured logging is available. The `vitest.config.ts` already wires `setupFiles: ['src/__mocks__/chrome.ts']`, so the mock is injected automatically once it contains content.

## Solution Statement

Fill in the Chrome mock with `vi.fn()` stubs for `storage`, `runtime`, `alarms`, and `declarativeNetRequest`. Create `src/core/logger.ts` using the factory pattern from the PRD. Write smoke tests covering: suppression in Vitest, all four log levels, and `context` auto-injection.

## Feature Metadata

**Feature Type**: New Capability (infrastructure)
**Estimated Complexity**: Low
**Primary Systems Affected**: `src/__mocks__/chrome.ts`, `src/core/`
**Dependencies**: `vitest` (already installed), no new packages needed

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `src/__mocks__/chrome.ts` — currently `export {};`, replace entirely
- `src/index.ts` — currently `export {};`, **do not touch** (it's the Rollup stub from phase 1)
- `vitest.config.ts` — confirms `setupFiles: ['src/__mocks__/chrome.ts']` and `globals: true`
- `eslint.config.ts` — relaxes `no-console` and `import-x/no-default-export` for `**/*.test.ts` and `src/__mocks__/**/*.ts`; all other files must use named exports and no `console.*`
- `tsconfig.json` — `"types": ["chrome"]` is already present; strict mode on
- `package.json` — test script is `vitest run --passWithNoTests`; lint script uses `node --experimental-strip-types`

### New Files to Create

- `src/core/logger.ts` — `createLogger` factory, zero dependencies
- `src/core/logger.test.ts` — smoke tests (collocated)

### Relevant Documentation

- PRD spec `§7.4` — exact Chrome mock shape (storage.local, runtime, alarms, declarativeNetRequest)
- PRD spec `§7.5` — exact logger implementation, suppression logic, `LogEntry` interface
- PRD spec `§5` stories S-004 and S-005 — acceptance criteria

### Patterns to Follow

**Named exports only** (ESLint enforces `import-x/no-default-export` on non-test files):
```typescript
export function createLogger(context: Context): Logger { ... }
```

**Explicit return types** (ESLint enforces `@typescript-eslint/explicit-function-return-type`):
```typescript
function emit(context: Context, level: LogLevel, event: string, fields: Record<string, unknown> = {}): void { ... }
```

**Logger, never console** — the logger itself calls `console[level]` internally (this is the one allowed call site), but ESLint's `no-console` is NOT relaxed for `src/core/logger.ts`. The PRD's logger uses `console[level]` — this will be flagged. To satisfy ESLint, disable the rule inline for that one line:
```typescript
// eslint-disable-next-line no-console
console[level](JSON.stringify(entry));
```

**Vitest globals** — `vitest.config.ts` has `globals: true`, so `vi`, `describe`, `it`, `expect` are available without imports in test files. However, importing explicitly (`import { vi, describe, it, expect } from 'vitest'`) is also valid and preferred for clarity with explicit-function-return-type enforcement.

**Chrome mock pattern** — `vitest.config.ts` uses `setupFiles`, so the mock file runs before all tests. Assign to `globalThis` so the `chrome` global is available:
```typescript
import { vi } from 'vitest';
const chrome = { ... };
(globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;
```
The file is in `src/__mocks__/**/*.ts` so `no-default-export` is relaxed — but we still use only named exports or no exports (just side-effect assignment).

**Logger suppression** — use `process.env['VITEST']` (Vitest sets this automatically). The PRD says to check `import.meta.env.VITEST` as a fallback but `process.env` is sufficient for Node/jsdom test environments.

---

## IMPLEMENTATION PLAN

### Phase 1: Chrome API Mock

Replace the empty stub with the full mock body per PRD §7.4.

### Phase 2: Logger Implementation

Create `src/core/logger.ts` with the factory from PRD §7.5. Add the inline ESLint disable comment for the `console[level]` call.

### Phase 3: Logger Tests

Write smoke tests in `src/core/logger.test.ts` covering:
- All four log levels call the underlying output mechanism
- Logger is suppressed when `VITEST` env var is set (it already is during test runs, so test the inverse by temporarily unsetting)
- `context` is auto-included in every log entry
- `fields` are spread into the log entry

---

## STEP-BY-STEP TASKS

### REPLACE `src/__mocks__/chrome.ts`

- **IMPLEMENT**: Full Chrome mock per PRD §7.4 — `storage.local.{get,set,remove}`, `runtime.{sendMessage,onMessage,id,lastError}`, `alarms.{create,clear,get,onAlarm}`, `declarativeNetRequest.{updateDynamicRules,getDynamicRules}`
- **PATTERN**: PRD §7.4 exact shape
- **IMPORTS**: `import { vi } from 'vitest';`
- **GOTCHA**: File needs no named exports — it's a side-effect setup file. The ESLint config relaxes `no-default-export` for this file, but we're not exporting at all.
- **GOTCHA**: `onMessage` in the PRD has `addListener` and `removeListener`. `onAlarm` has only `addListener`.
- **VALIDATE**: `pnpm test` exits 0 (no tests yet, but setup file must not error)

### CREATE `src/core/logger.ts`

- **IMPLEMENT**: Types `LogLevel`, `Context`, `LogEntry`, `Logger`; function `emit`; exported `createLogger`
- **PATTERN**: PRD §7.5 exact implementation
- **IMPORTS**: No imports needed (zero dependencies)
- **GOTCHA**: ESLint `no-console` is enabled for this file — add `// eslint-disable-next-line no-console` immediately before the `console[level](...)` line
- **GOTCHA**: `exactOptionalPropertyTypes` is on in tsconfig. The `[key: string]: unknown` index signature on `LogEntry` is compatible — no issue.
- **GOTCHA**: `emit` has `fields: Record<string, unknown> = {}` — the default value satisfies strict mode.
- **GOTCHA**: The `Context` type is `string` — leave it as-is per PRD (the feature PRD will narrow it to a union).
- **VALIDATE**: `pnpm run typecheck` exits 0; `pnpm run lint` exits 0

### CREATE `src/core/logger.test.ts`

- **IMPLEMENT**: Smoke tests covering:
  1. `createLogger` returns an object with `debug`, `info`, `warn`, `error` methods
  2. When `VITEST` env var is set (already true during tests), `emit` returns early — verify via `vi.spyOn(console, 'info')` that nothing is logged
  3. When `VITEST` env var is unset, output is JSON with correct shape — set `process.env['VITEST'] = ''`, call logger, restore
  4. `context` appears in every emitted entry
  5. Extra `fields` are spread into the entry
- **IMPORTS**: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';` and `import { createLogger } from '@/core/logger';`
- **GOTCHA**: ESLint relaxes `no-console` for test files, so `vi.spyOn(console, 'info')` is fine.
- **GOTCHA**: When testing non-suppressed output, you must delete or empty `process.env['VITEST']` and restore it in `afterEach`. Use `vi.spyOn(console, 'info')` to capture without actual output.
- **GOTCHA**: `explicit-function-return-type` is enforced even in test files for non-arrow callbacks. Use arrow functions for `it(` callbacks — they are exempt.
- **VALIDATE**: `pnpm test` passes with all smoke tests green

---

## TESTING STRATEGY

### Unit Tests

Collocated in `src/core/logger.test.ts`. No integration tests needed — the logger has no external dependencies.

### Edge Cases

- `fields` omitted → entry has only `level`, `event`, `context`
- `fields` provided → all fields merged into entry
- Suppression: no `console.*` call when `VITEST` is set
- Non-suppression: JSON output has correct shape when `VITEST` is unset

---

## VALIDATION COMMANDS

### Level 1: TypeScript

```
pnpm run typecheck
```

### Level 2: Lint

```
pnpm run lint
```

### Level 3: Tests

```
pnpm test
```

### Level 4: Build

```
pnpm run build
```

All four must exit 0 with zero errors or warnings.

---

## ACCEPTANCE CRITERIA

- [ ] `src/__mocks__/chrome.ts` contains the full Chrome API mock (not `export {}`)
- [ ] `src/core/logger.ts` exists with `createLogger` as a named export
- [ ] `src/core/logger.test.ts` exists with passing smoke tests
- [ ] `pnpm run typecheck` — zero errors
- [ ] `pnpm run lint` — zero errors or warnings
- [ ] `pnpm test` — all logger tests pass
- [ ] `pnpm run build` — `dist/` produced, no build errors

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each validation command passed immediately after the task
- [ ] `pnpm test` green
- [ ] `pnpm run lint` clean
- [ ] `pnpm run typecheck` clean
- [ ] `pnpm run build` clean

---

## NOTES

- The `eslint-plugin-import-x` (not `eslint-plugin-import`) is installed. Import paths in the plan use `@/core/logger` — this resolves via the alias in both `tsconfig.json` and `vitest.config.ts`.
- `vitest.config.ts` has `globals: true` — you can import vitest globals explicitly or rely on globals. Explicit imports are clearer given the explicit-return-type rule.
- The `src/core/` directory does not exist yet — create it implicitly by creating the files inside it.
- `pnpm` is the package manager (not `npm`).

**Confidence Score: 10/10** — All three risks verified by live probe:
1. `// eslint-disable-next-line no-console` works correctly in `src/core/` files — `pnpm run lint` exits 0.
2. `import { vi } from 'vitest'` works in the jsdom environment with the current config.
3. `process.env['VITEST']` is `'true'` (truthy string) during test runs — suppression logic `if (process.env['VITEST']) return` is correct.
