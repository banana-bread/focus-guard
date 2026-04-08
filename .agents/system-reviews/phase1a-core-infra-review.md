# System Review: Phase 1A — Core Infrastructure

**Date:** 2026-04-07
**Plan reviewed:** `.agents/plans/phase1a-core-infra.md`
**Execution report:** `.agents/execution-reports/phase1a-core-infra.md`

---

## Overall Alignment Score: 9/10

All acceptance criteria met. Two minor divergences, both justified improvements over the plan. No skipped items. Zero rework needed. The plan's 9/10 confidence estimate proved accurate.

---

## Divergence Analysis

```yaml
divergence: chrome.storage.local.get callback parameter type annotation
planned: chrome.storage.local.get(key, (result) => { ... })  # implicit type
actual:  chrome.storage.local.get(key, (result: Record<string, unknown>) => { ... })
reason: TypeScript strict mode (noImplicitAny) cannot infer result type; plan's snippet would have failed typecheck
classification: good ✅
justified: yes
root_cause: plan assumption wrong — plan included code that would fail its own validation step
```

```yaml
divergence: Settings import style in messages.ts
planned: inline type import — import('@/core/storage').Settings inside the union
actual:  top-level import type { Settings } from '@/core/storage'
reason: top-level form is cleaner and avoids confusion with dynamic imports; plan explicitly noted the alternative
classification: good ✅
justified: yes
root_cause: plan presented two valid options; agent selected the better one
```

---

## Pattern Compliance

- [x] Followed codebase architecture (VSA, core/ / shared/ split)
- [x] Used documented patterns (named exports, JSDoc, createLogger, @/ aliases)
- [x] Applied testing patterns correctly (describe/it/expect, vitest globals, @/ imports)
- [x] Met all validation requirements (typecheck, lint, test, build all green)

---

## System Improvement Actions

### Update CLAUDE.md

- [ ] **Add Chrome storage callback typing rule.**
  The plan's code snippet used implicit callback parameter types that would fail `noImplicitAny`. This is a recurring gotcha for anyone adding storage helpers.

  Add to the "Key Rules" or a new "Chrome API Patterns" section:

  ```markdown
  **`chrome.storage.local.get` callback must be explicitly typed:**
  ```typescript
  chrome.storage.local.get(key, (result: Record<string, unknown>) => {
    resolve(result[key] as T | undefined);
  });
  ```
  The callback parameter cannot be inferred in strict mode. Always annotate as `Record<string, unknown>`.
  ```

- [ ] **Add import style preference for cross-module type references.**
  The plan offered two options and the agent correctly chose the better one, but this choice should not be left to per-agent judgment.

  Add to the "Key Rules" section:

  ```markdown
  **Prefer top-level `import type` over inline `import()` type references:**
  ```typescript
  // ✅ Correct
  import type { Settings } from '@/core/storage';
  // ❌ Avoid — looks like a dynamic import
  | { settings: Partial<import('@/core/storage').Settings> }
  ```
  ```

### Update Plan Template / Planning Guidance

- [ ] **Flag code snippets in plans as non-copy-paste.** The `storageGet` snippet in the plan used an implicit callback type that would have failed `noImplicitAny`. Plans should note that included snippets are illustrative and must pass `pnpm typecheck` — they are not guaranteed to compile as written.

  Consider adding to the plan template header:
  ```
  > NOTE: Code snippets in this plan are illustrative. Always run `pnpm typecheck`
  > after each file. The snippet may need minor strict-mode adjustments.
  ```

- [ ] **Add per-file typecheck instruction explicitly.** The plan lists `pnpm typecheck` as the final VALIDATE step per task, but the execution report recommends running it after each individual file. Make this explicit in the COMPLETION CHECKLIST:
  ```
  - [ ] `pnpm typecheck` passes after EACH new file (not just at the end)
  ```

### Update Execute Command Checklist

- [ ] **Add Chrome mock coverage check.** The execute command should prompt: "Does the Chrome mock (`src/__mocks__/chrome.ts`) cover all `chrome.*` APIs used in the new files?" This prevents silent test environment failures when new Chrome APIs are introduced.

  Add to the per-file validation checklist in the execute command:
  ```
  - Does the Chrome mock cover every chrome.* API called in this file?
  ```

---

## Key Learnings

**What worked well:**

- **Plan completeness was the dominant success factor.** Every file had exact patterns, dependency order, gotchas, and validation commands. The agent needed zero research during implementation — it just executed.
- **Pre-identified gotchas prevented iteration.** `noUnusedParameters` → `_sender`, `switch` default `never` cast, `AuthenticatorTransport` as DOM global — all called out, all handled first-pass.
- **Existing Chrome mock alignment.** The mock already covered `storage.local.get/set/remove` — no mock updates needed. The plan correctly assessed this upfront.
- **Explicit test strategy section** (`domain.test.ts` — yes; `config.ts` / `messages.ts` — no, with reasoning) prevented over-testing trivial helpers.

**What needs improvement:**

- **Plan snippets are not typecheck-verified.** The `storageGet` snippet used an implicit callback type that would fail strict mode. Plans should carry a disclaimer that snippets are illustrative, not copy-paste-safe.
- **Per-file validation instruction is implicit.** The plan lists `pnpm typecheck` as a per-task VALIDATE step but the COMPLETION CHECKLIST implies it's a final-pass operation. Making per-file typechecking explicit in the checklist would catch errors earlier.

**For next implementation:**

1. Add `Record<string, unknown>` annotation to any new `chrome.storage.local.get` callbacks.
2. Run `pnpm typecheck` after each file, not just at the end of the phase.
3. Before creating new files that call `chrome.*` APIs, verify mock coverage in `src/__mocks__/chrome.ts`.
4. Prefer `import type { X } from '@/...'` over inline `import('@/...').X` in type positions.
