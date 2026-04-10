# System Review: Phase 3 — Unlock Slice + Countdown Timer

**Date:** 2026-04-10  
**Plan reviewed:** `.agents/plans/phase3-unlock-timer.md`  
**Execution report:** `.agents/execution-reports/phase3-unlock-timer.md`

---

## Overall Alignment Score: 10/10

All 12 tasks implemented, all acceptance criteria met, zero skipped items. Three divergences — all classified good. No rework pass needed. This was the cleanest execution so far across the three phases.

---

## Divergence Analysis

```yaml
divergence: addAllowRule removes existing rule before adding in same updateDynamicRules call
planned: addRules: [rule], removeRuleIds: []
actual:  removeRuleIds: [ruleId], addRules: [rule] — removes-then-adds atomically
reason: If the same domain hash produces the same ruleId and a stale rule already exists
        (e.g., from a fast unlock→lock→unlock cycle), chrome.declarativeNetRequest would
        reject the add with a duplicate-ID conflict. Pre-removing in the same call is atomic.
classification: good ✅
justified: yes
root_cause: Plan specified the happy-path only; didn't consider the duplicate ruleId edge case
            that arises from deterministic hash-based rule IDs.
```

```yaml
divergence: navigator.credentials.get options cast as PublicKeyCredentialRequestOptions
            rather than using hints field directly
planned: hints: ['security-key'] as a literal property in the options object
actual:  full options object cast to PublicKeyCredentialRequestOptions — hints still sent at
         runtime but TypeScript type checker doesn't see it
reason: 'hints' is a WebAuthn Level 3 field absent from the TypeScript DOM lib bundled with
        the project. Direct assignment would produce a type error.
classification: good ✅
justified: yes
root_cause: Plan specified a runtime-valid Chrome API property without verifying it exists
            in the project's TypeScript lib types. Same class of issue as phase1a's implicit
            callback type — plan-side assumption about TS coverage.
```

```yaml
divergence: transport field passed via spread-conditional, not direct assignment
planned: assertion: { authenticatorData, clientDataJSON, signature, transport } inline
actual:  ...(transport !== undefined ? { transport } : {}) spread in three places
         (handler, blocked.ts, test file)
reason: exactOptionalPropertyTypes: true is enabled in tsconfig. Assigning `string | undefined`
        to an `?: string` field is a compile error under this flag. The spread-conditional
        idiom is the standard workaround.
classification: good ✅
justified: yes
root_cause: Plan mentioned exactOptionalPropertyTypes in the CLAUDE.md checklist reference
            but did not call out the specific field (transport?: string) as requiring this idiom.
            A targeted note would have prevented all three instances being discovered at typecheck.
```

---

## Pattern Compliance

- [x] Followed codebase architecture (VSA slices, service worker as trust boundary, thin UI scripts)
- [x] Used documented patterns (structured logging with trace_id, JSDoc on exports, @/ aliases, no default exports)
- [x] Applied testing patterns correctly (storageMap mock, vi.mock for webauthn/storage, describe/it/expect)
- [x] Met all validation requirements (typecheck zero errors, 101 tests pass, vite build clean)
- [x] No file exceeds 300 lines (largest new file: unlock.service.ts at 138 lines)
- [x] No logger in shared/ utilities — correctly placed in service layer only

---

## System Improvement Actions

### Update CLAUDE.md

- [ ] **Add `exactOptionalPropertyTypes` spread-conditional pattern.**
  This came up in 3 places across handler, blocked page, and tests. Any optional field in a message type (e.g., `transport?: string`) will hit this in the message-passing layer. Add to the "Key Rules" or "Chrome API Patterns" section:

  ```markdown
  ## TypeScript: exactOptionalPropertyTypes Pattern

  This project enables `exactOptionalPropertyTypes: true`. You **cannot** assign `T | undefined`
  to an `?: T` field — the types are distinct.

  Use the spread-conditional idiom for optional message fields:

  ```typescript
  // ✅ Correct
  const msg = {
    type: 'VERIFY_ASSERTION',
    domain,
    ...(transport !== undefined ? { transport } : {}),
  };

  // ❌ Fails to compile
  const msg = { type: 'VERIFY_ASSERTION', domain, transport }; // transport may be undefined
  ```

  This pattern applies wherever an optional field is conditionally present (message types,
  storage objects, handler test fixtures).
  ```

- [ ] **Add WebAuthn DOM type gap documentation.**
  Two fields are absent from the TypeScript DOM lib but are valid at runtime in Chrome 128+:
  - `hints` in `PublicKeyCredentialRequestOptions`
  - `getTransports()` on `AuthenticatorAssertionResponse`

  Add to "Chrome API Patterns":

  ```markdown
  ## WebAuthn DOM Type Gaps

  The following WebAuthn Level 3 APIs are valid at runtime (Chrome 128+) but absent from
  TypeScript's bundled DOM lib:

  | API | Workaround |
  |-----|------------|
  | `hints: ['security-key']` in credential request options | Cast the full options object: `options as PublicKeyCredentialRequestOptions` |
  | `assertionResponse.getTransports()` | Cast to `unknown as { getTransports?: () => string[] }` before access |

  Do not upgrade the tsconfig `lib` to pick these up — the cast workaround is minimal and
  avoids potential lib compatibility issues.
  ```

### Update Plan Template

- [ ] **Plans that reference DOM/Chrome API properties should include a TS lib verification note.**
  The phase1a review recommended flagging plan snippets as non-copy-paste-safe. Phase3 had the
  same issue: `hints: ['security-key']` was specified as valid TypeScript without noting the
  DOM lib gap. Add to the plan template preamble:

  ```
  > NOTE: Code snippets are illustrative. Any property referencing a Chrome-specific or
  > WebAuthn Level 3 API (hints, getTransports, etc.) may require a type cast — verify against
  > `lib.dom.d.ts` before assuming direct assignment compiles.
  ```

- [ ] **For message types with optional fields, add a note about exactOptionalPropertyTypes.**
  When a plan introduces or modifies a message type with `?: T` fields, add:
  ```
  > GOTCHA: fields typed `?: T` require the spread-conditional idiom at all construction sites
  > when exactOptionalPropertyTypes is enabled. Check tsconfig before assuming direct assignment.
  ```

- [ ] **For deterministic hash-based IDs, flag duplicate-on-reuse edge case.**
  The `domainAllowRuleId` uses djb2 hash deterministically. Plans that use deterministic IDs
  should note: "pre-remove before re-adding to handle cases where the same ID already exists."
  This is now documented in the implementation but not captured in the plan pattern.

### No New Commands Needed

No manual process was repeated 3+ times that would warrant a new command. The existing loop worked exactly as designed.

---

## Key Learnings

**What worked well:**

- **Plan context references were exhaustive and accurate.** All 13 listed files were read once and provided sufficient pattern context. Zero exploratory reads beyond the plan's reference table. This is the highest-fidelity plan-to-execution match across all three phases.
- **Idempotency specification was explicit.** The plan's note "endSession must be idempotent: if session absent, return silently" was implemented exactly and prevented a potential double-remove race between the countdown and the alarm.
- **Test scaffold transferred without modification.** The storageMap pattern from credential.handler.test.ts was described precisely enough that 8 new test cases were written without reading any additional test files during implementation.
- **Message protocol change was clean.** Breaking `assertion: number[]` into separate fields (Task 7) required touching only 3 files (messages.ts, blocked.ts, unlock.handler.ts) — all rewritten in the same phase — so there were no migration callers to manage.
- **`consumeChallenge` delete-before-TTL-check was a correct safety detail** the plan left implicit but the implementation got right instinctively.

**What needs improvement:**

- **Plan snippets reference DOM APIs without TS lib verification.** `hints: ['security-key']` and `getTransports()` both required casts. This is now the third phase where a plan snippet doesn't compile verbatim — the pattern is clear enough to warrant a CLAUDE.md rule.
- **`exactOptionalPropertyTypes` impact on optional message fields is not documented.** It surfaced in 3 places and will surface again whenever a new optional field is added to `core/messages.ts`. A CLAUDE.md rule prevents this from being rediscovered each phase.

**For next implementation:**

1. When adding any `?: T` field to `core/messages.ts`, use the spread-conditional idiom at every construction site. Do not attempt direct assignment.
2. Any WebAuthn credential API call that references `hints` or `getTransports` needs a type cast — reference the cast pattern in CLAUDE.md rather than rediscovering it.
3. Deterministic hash-based rule IDs should always pre-remove before adding in `updateDynamicRules` to handle stale-ID conflicts.
