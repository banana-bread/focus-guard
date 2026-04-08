# Execution Report: Phase 1A — Core Infrastructure

**Date:** 2026-04-06
**Branch:** `rewrite/vsa-typescript`

---

## Meta Information

- **Plan file:** `.agents/plans/phase1a-core-infra.md`
- **Files added:**
  - `src/core/config.ts` (42 lines)
  - `src/core/storage.ts` (86 lines)
  - `src/core/messages.ts` (60 lines)
  - `src/shared/domain.ts` (18 lines)
  - `src/shared/domain.test.ts` (36 lines)
  - `src/service-worker.ts` (56 lines)
- **Files modified:**
  - `manifest.json` (+8 -3)
  - `vite.config.ts` (+1 -2)
- **Lines changed:** +307 added (new files) / +9 -5 (modified files)

---

## Validation Results

| Check | Result | Details |
|---|---|---|
| Type Checking (`pnpm typecheck`) | ✓ | Zero errors |
| Linting (`pnpm lint`) | ✓ | Zero errors |
| Unit Tests (`pnpm test`) | ✓ | 13/13 passed (5 logger + 8 domain) |
| Build (`pnpm build`) | ✓ | `dist/service-worker.js` 1.01 kB |
| Integration Tests | N/A | Not applicable at this phase |

---

## What Went Well

- **Plan completeness:** The plan was exceptionally detailed. Every file had exact code to copy or adapt, gotchas were pre-identified, and the dependency order (config → storage → messages → domain → service-worker → build) was correct. No research was needed during implementation.
- **Gotcha coverage:** The plan called out all the TypeScript strict-mode edge cases that would have caused iteration (`exactOptionalPropertyTypes`, `noUnusedParameters` requiring `_sender`, the `switch` default branch `never` type issue, `AuthenticatorTransport` being a DOM global).
- **Chrome mock alignment:** The existing `src/__mocks__/chrome.ts` already had `chrome.storage.local.get/set/remove` as `vi.fn()`, so `storage.ts` integration in tests required no mock changes.
- **Zero typecheck errors on first pass:** Strict mode (`exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`) produced no errors. The plan's gotchas were sufficient.
- **`normalizeDomain` test coverage:** All 8 planned cases passed including the throws-on-invalid edge case.

---

## Challenges Encountered

- **`chrome.storage.local.get` callback type:** The `get` callback receives `Record<string, unknown>` but `@types/chrome` types it differently. Needed to explicitly annotate the callback parameter `(result: Record<string, unknown>)` to satisfy strict mode and avoid implicit `any`. The plan did not call this out, but it was a one-line fix.
- **`storage.ts` callback-based API:** `chrome.storage.local.set` and `remove` callbacks have no parameters in the mock but `@types/chrome` types them with optional callback signatures. Wrapping in `Promise<void>` with a bare `resolve()` call worked cleanly — no issues beyond the expected verbosity.

---

## Divergences from Plan

**`storage.ts` — explicit callback type annotation**

- Planned: `chrome.storage.local.get(key, (result) => { ... })` (implicit parameter type)
- Actual: `chrome.storage.local.get(key, (result: Record<string, unknown>) => { ... })` (explicit annotation)
- Reason: TypeScript strict mode (`noImplicitAny`) required the annotation; without it the compiler could not infer the type of `result[key]`.
- Type: Plan assumption wrong (minor — the plan's code snippet would have failed typecheck as written)

**`messages.ts` — avoided inline type import**

- Planned: `import('@/core/storage').Settings` inline type import inside the union
- Actual: `import type { Settings } from '@/core/storage'` top-level import
- Reason: Both are valid TypeScript; the top-level import is cleaner, more conventional, and avoids a potential confusion with dynamic imports. The plan flagged the inline form as one option and noted the alternative explicitly.
- Type: Better approach found

---

## Skipped Items

None. All acceptance criteria from the plan were met:

- ✅ `src/core/messages.ts` — every message type present with `trace_id`
- ✅ `src/core/storage.ts` — all 4 keys; Promise-based helpers
- ✅ `src/core/config.ts` — all constants from PRD §10
- ✅ `src/shared/domain.ts` — `normalizeDomain` handles scheme/www/path/case
- ✅ `src/service-worker.ts` — registers `onMessage`; logs received/handled; returns `true`
- ✅ `dist/manifest.json` — correct permissions and `service_worker: "service-worker.js"`

---

## Recommendations

### Plan command improvements
- Add a note to explicitly annotate Chrome storage callback parameters when using TypeScript strict mode. The `(result) =>` pattern in the plan would fail `noImplicitAny` without the `Record<string, unknown>` annotation.
- Consider adding `pnpm typecheck` as a per-file validation step instruction rather than just a final step — catching errors file-by-file is faster than catching them all at the end.

### Execute command improvements
- The execute prompt asks to "verify syntax" after each file but provides no concrete mechanism. Suggesting `pnpm typecheck` after each new file (not just at the end) would make this actionable.
- For future phases, note that the Chrome mock may need updating alongside new files. Calling this out in the execute checklist ("does the Chrome mock cover all APIs used in new files?") would prevent test environment issues.

### CLAUDE.md additions
- Document that `chrome.storage.local.get` callback parameters must be explicitly typed as `Record<string, unknown>` in strict mode. This is a recurring gotcha when adding storage helpers.
- Consider noting the preference for top-level `import type` over inline `import()` type references, as the inline form is easy to misread as a dynamic import.
