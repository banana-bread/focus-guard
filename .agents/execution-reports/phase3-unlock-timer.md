# Execution Report: Phase 3 — Unlock Slice + Countdown Timer

**Date**: 2026-04-09  
**Plan file**: `.agents/plans/phase3-unlock-timer.md`

---

## Meta Information

### Files Added

| File | Lines |
|---|---|
| `src/unlock/unlock.challenge.ts` | 51 |
| `src/unlock/unlock.storage.ts` | 35 |
| `src/unlock/unlock.service.ts` | 138 |
| `src/unlock/unlock.handler.ts` | 99 |
| `src/unlock/unlock.handler.test.ts` | 200 |

### Files Modified

| File | Change summary |
|---|---|
| `src/core/storage.ts` | Added `allowRuleId: number` to `UnlockSession` |
| `src/core/messages.ts` | Replaced `assertion: number[]` with split fields on `VERIFY_ASSERTION` |
| `src/blocklist/blocklist.rules.ts` | Added `ALLOW_RULE_ID_BASE`, `addAllowRule`, `removeAllowRule` |
| `src/service-worker.ts` | Added 3 unlock cases + `chrome.alarms.onAlarm` listener |
| `src/blocked/blocked.html` | Replaced static card body with unlock UI + countdown state |
| `src/blocked/blocked.css` | Added btn, select, timer, error, hidden styles |
| `src/blocked/blocked.ts` | Full rewrite — WebAuthn assertion flow, countdown timer |

### Lines Changed

+862 insertions (339 in modified files, 523 in new files), -5 deletions

---

## Validation Results

| Check | Result | Detail |
|---|---|---|
| Type Checking (`pnpm tsc --noEmit`) | ✓ | Zero errors after 3 fixes |
| Unit Tests (`pnpm test`) | ✓ | 101 passed (8 new, 93 prior) |
| Build (`pnpm build`) | ✓ | 22 modules, no warnings |

---

## What Went Well

- **Plan fidelity was high**: The plan's context references (credential.service.ts pattern, blocklist.rules.ts structure, credential.handler.ts handler shape) accurately described the codebase, requiring no exploratory reads beyond those listed.

- **`consumeChallenge` design was clean**: Deleting from the Map immediately on retrieval (before TTL check) prevents a race where a second call could succeed after the first retrieved the value. The plan didn't specify this order explicitly, but the implementation naturally handled it.

- **`endSession` idempotency was straightforward**: Checking for session existence before removing the allow rule meant the alarm-fired-after-countdown race is handled without special logic.

- **`exactOptionalPropertyTypes` caught real bugs**: The compiler correctly rejected `transport: string | undefined` as a present-but-undefined property. The spread pattern (`...(x !== undefined ? { x } : {})`) is the right idiom and was applied consistently across handler, test, and blocked.ts.

- **Test coverage was complete**: All 8 test cases from the plan passed on first run after type errors were fixed. The `storageMap` pattern from `credential.handler.test.ts` transferred directly.

---

## Challenges Encountered

- **`hints` not in `PublicKeyCredentialRequestOptions`**: The plan specified `hints: ['security-key']` in `navigator.credentials.get`. The TypeScript lib types do not include `hints` (it's a newer WebAuthn Level 3 field). Fixed by casting the options object as `PublicKeyCredentialRequestOptions`, which suppresses the error without breaking runtime behaviour (Chrome supports it).

- **`getTransports()` not in `AuthenticatorAssertionResponse` type**: The method exists at runtime but is absent from the TypeScript DOM lib. Fixed by casting `assertionResponse` to `unknown as { getTransports?: () => string[] }` before accessing it.

- **`exactOptionalPropertyTypes` on `transport?: string`**: The `VERIFY_ASSERTION` message type declares `transport?: string` (absent vs present distinction). TypeScript with `exactOptionalPropertyTypes: true` rejects assigning `string | undefined` to this. Required spread-conditional pattern in three places: `unlock.handler.ts`, `blocked.ts`, and `unlock.handler.test.ts`.

---

## Divergences from Plan

**`blocklist.rules.ts` — `addAllowRule` removes the old rule ID before adding**

- Planned: `addRules: [rule], removeRuleIds: []`
- Actual: `removeRuleIds: [ruleId], addRules: [rule]` (removes-then-adds in a single call)
- Reason: If a domain is unlocked twice in quick succession (e.g., alarm fires, session cleared, user unlocks again with same hash), the second `addAllowRule` would fail with a duplicate rule ID conflict. Pre-removing is a safety measure.
- Type: Better approach found

**`blocked.ts` — `hints` removed from actual `navigator.credentials.get` call**

- Planned: `hints: ['security-key']` in the options object
- Actual: Cast the whole options object as `PublicKeyCredentialRequestOptions` — `hints` is still passed at runtime, TypeScript just doesn't know about it
- Reason: `hints` is absent from the TS lib types but is valid at runtime in Chrome 128+. The cast is the minimal fix.
- Type: Plan assumption wrong (assumed TS types include hints)

**`unlock.handler.ts` — `verifyAndUnlock` receives spread assertion, not inline object**

- Planned: `assertion: { authenticatorData, clientDataJSON, signature, transport }` assembled inline
- Actual: Same, but `transport` is conditionally included via spread to satisfy `exactOptionalPropertyTypes`
- Reason: `exactOptionalPropertyTypes: true` is enabled — this is correct and necessary
- Type: Plan assumption wrong (strict TS config not considered)

---

## Skipped Items

None. All 12 tasks from the plan were implemented.

---

## Recommendations

### CLAUDE.md Additions

- **`exactOptionalPropertyTypes` pattern**: Document that `transport?: string` and similar optional fields require the spread-conditional idiom — `...(x !== undefined ? { x } : {})` — not direct assignment of `T | undefined`. This came up in 3 places.
- **WebAuthn DOM type gaps**: Note that `hints` and `getTransports()` are absent from the TypeScript DOM lib. Document the cast workaround for each.

### Plan Command Improvements

- The plan specified `hints: ['security-key']` in the blocked page WebAuthn call without noting that the TS lib doesn't include this field. Plans that reference DOM/Chrome API properties should verify they exist in the project's TS lib version first, or pre-note that a cast will be needed.
- The plan noted `exactOptionalPropertyTypes` via the CLAUDE.md check list but didn't call out the specific `transport?: string` field as requiring the spread idiom. A plan note like "if `exactOptionalPropertyTypes` is enabled, use spread-conditional for optional fields" would have pre-empted all three instances.

### Execute Command Improvements

- Type errors after first `tsc` run were all fixable in one pass — the process worked well. No changes needed.
