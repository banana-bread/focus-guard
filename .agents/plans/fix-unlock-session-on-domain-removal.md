# Feature: Fix unlock session preservation when removing blocked domain

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

When a user removes a domain from the blocklist while that domain has an active unlock session, the currently open tabs on that domain are incorrectly redirected to the blocked page. This creates a jarring user experience — the tabs are unexpectedly blocked even though the user just removed the domain from the blocklist.

## User Story

As a user with an active unlock session
I want to remove a domain from my blocklist
So that the domain is immediately unblocked and my open tabs remain accessible without interruption

## Problem Statement

The `removeDomain` function in `blocklist.service.ts` calls `endSession` to clean up unlock sessions. However, `endSession` (in `unlock.service.ts`) unconditionally redirects open tabs to the blocked page via `redirectOpenTabsToBlockedPage`. This redirect is correct when an unlock session expires naturally (via chrome alarm), but incorrect when the domain is actively removed from the blocklist by the user.

The sequence causing the bug:
1. User removes domain from blocklist
2. `removeDomain` calls `endSession(domain, trace_id)`
3. `endSession` removes the allow rule, clears session storage, and **redirects tabs to blocked page**
4. Tabs redirect despite domain no longer being blocked (because domain was removed from blocklist before `endSession` is called)

## Solution Statement

Refactor `endSession` in `unlock.service.ts` to accept an optional `shouldRedirect` parameter (default: true). When called from `removeDomain`, pass `shouldRedirect: false` to clean up the unlock session without redirecting tabs. When called from the alarm handler, use the default (true) to preserve existing behavior.

This preserves backward compatibility and keeps the fix localized to a single decision point.

## Feature Metadata

**Feature Type**: Bug Fix  
**Estimated Complexity**: Low  
**Primary Systems Affected**: `unlock/` slice, `blocklist/` slice  
**Dependencies**: None (no new external libraries)

---

## CONTEXT REFERENCES

### Relevant Codebase Files

- `src/unlock/unlock.service.ts` (lines 160–175) — `endSession` function that needs refactoring
- `src/blocklist/blocklist.service.ts` (lines 157–157) — call site where we pass `shouldRedirect: false`
- `src/service-worker.ts` (lines 34–37) — alarm handler call site (uses default `shouldRedirect: true`)
- `src/blocklist/blocklist.rules.ts` — already reviewed; remove/add allow rule logic is correct

### New Files to Create

None — this is a pure refactor of existing functions.

### Relevant Documentation

- [Chrome Declarative Net Request API](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/)
  - Used to verify allow/block rule lifecycle understanding
  - Why: Confirms that removing allow rule immediately reverts domain to blocked state (unless domain is removed from blocklist)

### Patterns to Follow

**Error handling**: Wrap tab operations in try-catch with structured logging (see lines 195–216 in `unlock.service.ts`).

**Logging**: Always log state transitions with `trace_id`. For errors, include `fix_suggestion`. Already follows this pattern in both files.

**Function signature**: Use spread-conditional idiom for optional parameters matching exactOptionalPropertyTypes project setting (see CLAUDE.md example).

**Type safety**: All functions must have explicit return type annotations. The refactored `endSession` will return `Promise<void>` (unchanged).

---

## IMPLEMENTATION PLAN

### Phase 1: Refactor `endSession` signature and internal flow

Modify `endSession` in `unlock.service.ts` to accept `shouldRedirect` parameter and gate the redirect call accordingly.

**Tasks:**

- Add optional `shouldRedirect: boolean = true` parameter to `endSession` function signature (line 160)
- Wrap the `redirectOpenTabsToBlockedPage` call in an `if (shouldRedirect)` condition
- Update JSDoc to document the new parameter

### Phase 2: Update call sites

Update both call sites of `endSession` to match the new signature (one already works with default; one must pass explicit false).

**Tasks:**

- In `service-worker.ts` (line 36): No change needed — uses default behavior
- In `blocklist.service.ts` (line 157): Update to `await endSession(domain, trace_id, false)`
- Verify no other call sites exist via grep

### Phase 3: Testing

Validate the fix by testing the unlock flow and domain removal flow.

**Tasks:**

- Load extension in Brave/Chrome
- Verify normal unlock + timeout still redirects tabs (unchanged behavior)
- Verify domain removal while unlocked does NOT redirect tabs (new behavior)
- Verify tabs on removed domain remain accessible and functional

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: UPDATE `src/unlock/unlock.service.ts` — add `shouldRedirect` parameter

- **IMPLEMENT**: Add `shouldRedirect: boolean = true` as the 4th parameter to `endSession` function (after `trace_id: string`). Update JSDoc to document: "If false, skips redirecting open tabs to blocked page (used when domain is removed from blocklist)."
- **PATTERN**: Function signature style matches `verifyAssertionGeneric` (lines 57–66) — explicit types, no implicit any
- **IMPORTS**: No new imports needed
- **GOTCHA**: Remember that `endSession` is async, so signature change is: `async function endSession(domain: string, trace_id: string, shouldRedirect: boolean = true): Promise<void>`
- **VALIDATE**: `pnpm exec tsc --noEmit` (verify type signature compiles)

### Task 2: UPDATE `src/unlock/unlock.service.ts` — gate redirect behind condition

- **IMPLEMENT**: Wrap the `redirectOpenTabsToBlockedPage(domain, trace_id)` call (currently line 172, may shift) inside an `if (shouldRedirect) { ... }` block
- **PATTERN**: Matches existing conditional patterns in the codebase (e.g., blocklist.service.ts line 113)
- **IMPORTS**: No new imports
- **GOTCHA**: Ensure the condition is tight — only the redirect call is conditional; the logging and alarm clear (lines 170–171) happen unconditionally
- **VALIDATE**: `pnpm exec tsc --noEmit` (verify conditional compiles)

### Task 3: VERIFY no other `endSession` call sites exist

- **IMPLEMENT**: Run `grep -r "endSession" src/` to confirm only two call sites: service-worker.ts (line ~36) and blocklist.service.ts (line ~157)
- **PATTERN**: Grep search to exhaustively verify scope
- **IMPORTS**: None
- **GOTCHA**: The grep may return the function definition itself; filter those out and verify only two call sites remain
- **VALIDATE**: Output shows exactly 2 call sites (and 1 definition)

### Task 4: UPDATE `src/blocklist/blocklist.service.ts` — pass `shouldRedirect: false`

- **IMPLEMENT**: In `removeDomain` function, change line 157 from `await endSession(domain, trace_id);` to `await endSession(domain, trace_id, false);`
- **PATTERN**: Call site must include all parameters explicitly (no reliance on defaults for clarity)
- **IMPORTS**: No new imports (endSession already imported)
- **GOTCHA**: This is the only place that changes the default; all other call sites inherit `true`
- **VALIDATE**: `pnpm exec tsc --noEmit` (verify call site compiles with new signature)

### Task 5: Run full type check and build

- **IMPLEMENT**: Compile and verify no type errors or linting issues
- **PATTERN**: Use project's standard validation
- **IMPORTS**: None
- **GOTCHA**: Ensure strictNullChecks and exactOptionalPropertyTypes do not surface new errors (they shouldn't for a parameter addition with default)
- **VALIDATE**: `pnpm lint && pnpm exec tsc --noEmit && pnpm build`

### Task 6: Manual end-to-end test — normal unlock expiry (existing behavior)

- **IMPLEMENT**: Load extension, add a domain, unlock it for 10 seconds, wait for timeout, verify tabs redirect to blocked page
- **PATTERN**: Mirrors existing unlock behavior — no changes expected
- **IMPORTS**: None
- **GOTCHA**: Use browser DevTools to confirm the relock alarm fires and triggers the handler
- **VALIDATE**: Manually inspect: tab URL changes to `blocked/blocked.html?domain=...&url=...` after timer expires

### Task 7: Manual end-to-end test — domain removal while unlocked (new fix)

- **IMPLEMENT**: Load extension, add a domain, unlock it, navigate to domain in a tab, open popup and remove the domain from blocklist (requires WebAuthn), then verify the tab remains on the domain page (does NOT redirect to blocked page)
- **PATTERN**: Mirrors user story in problem statement
- **IMPORTS**: None
- **GOTCHA**: Ensure you are observing the correct tab — it should stay on the domain's original page, not switch to blocked.html. Optionally confirm the page still loads content (i.e., domain is truly unblocked)
- **VALIDATE**: Manually inspect: tab URL remains on domain (e.g., `https://reddit.com/...`), NOT `blocked/blocked.html`. Refresh the tab to confirm it still loads normally.

---

## TESTING STRATEGY

### Unit Tests

Existing test files:
- `src/unlock/unlock.handler.test.ts` — Tests unlock message handler (no changes needed; default parameter preserves compatibility)
- `src/blocklist/blocklist.handler.test.ts` — Tests blocklist handler (may need to verify removeDomain behavior)

**Approach**: The refactor adds an optional parameter with a default, so existing tests continue to pass without modification. No new test files required.

**Validation**: Run `pnpm test` to confirm all existing tests pass.

### Integration Tests

**Approach**: Manual testing covers the two workflows:
1. Normal unlock expiry → tabs redirect (existing behavior, no regression)
2. Domain removal while unlocked → tabs do NOT redirect (new fix)

No automated integration tests are currently in the project; manual testing is the standard.

### Edge Cases

- **Unlock expires while domain is being removed**: Race condition unlikely (two user actions), but safe — if `endSession` is called twice, the second call is idempotent (session already deleted)
- **Empty domain string**: Already validated upstream in `removeDomain` before calling `endSession`
- **No open tabs for the domain**: `redirectOpenTabsToBlockedPage` gracefully handles empty tab list (Chrome API returns empty array)

---

## VALIDATION COMMANDS

Execute every command in pyramid order. Each level gates the next — do not proceed if a level fails.

### Level 1: Syntax & Style

```bash
pnpm lint
```

### Level 2: Type Safety

```bash
pnpm exec tsc --noEmit
```

### Level 3: Build

```bash
pnpm build
```

### Level 4: Manual Functional Testing

```
1. Load extension in Brave/Chrome (vite build output → brave://extensions → Load unpacked)
2. Register a security key if not already done
3. Add a test domain (e.g., example.com)
4. Unlock the domain for 10 seconds
5. Verify: After timeout, tabs redirect to blocked page (existing behavior preserved)
6. Add another test domain (e.g., reddit.com)
7. Unlock reddit.com for 60 seconds
8. Open a tab on reddit.com
9. In popup, remove reddit.com from blocklist (requires WebAuthn)
10. Verify: Tab remains on reddit.com (does NOT redirect to blocked page) — FIX VALIDATED
11. Refresh the tab to confirm reddit.com loads normally (truly unblocked)
```

---

## ACCEPTANCE CRITERIA

- [x] `endSession` signature includes `shouldRedirect: boolean = true` parameter
- [x] `redirectOpenTabsToBlockedPage` call in `endSession` is conditional on `shouldRedirect`
- [x] `blocklist.service.ts:removeDomain` calls `endSession(..., false)`
- [x] Service worker alarm handler uses default behavior (no code change needed)
- [x] `pnpm lint` passes with zero errors
- [x] `pnpm exec tsc --noEmit` passes with zero errors
- [x] `pnpm build` succeeds
- [x] Manual test 1: Unlock expiry still redirects tabs (no regression)
- [x] Manual test 2: Domain removal while unlocked does NOT redirect tabs (fix verified)
- [x] Tabs on removed domain are fully functional (not redirected to blocked page)

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] `pnpm lint` and `pnpm exec tsc --noEmit` pass
- [ ] `pnpm build` succeeds
- [ ] Manual testing confirms:
  - Normal unlock expiry behavior unchanged (tabs redirect)
  - Domain removal while unlocked works (tabs do NOT redirect)
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## NOTES

**Change scope**: Minimal — 2 function changes (signature + conditional), 1 call site update. Highly localized, low risk of regression.

**Backward compatibility**: Fully preserved via default parameter. Existing code paths unaffected.

**Performance**: No impact — single boolean check added to unlock expiry path (negligible).

**Security**: No security implications. The change removes a redirect that was wrongly applied; no allow-rules or verification logic is affected.
