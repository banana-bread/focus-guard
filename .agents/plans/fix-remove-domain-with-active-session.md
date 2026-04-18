# Bug Fix: Remove domain with active unlock session redirects to error page

The following plan should be complete, but validate codebase patterns and task sanity before implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

When removing a domain from the blocklist while that domain has an active unlock session, the user's open tab is erroneously redirected to the blocked page (which then 404s). The domain should simply become permanently unblocked — no redirect to the blocked page should occur.

## User Story

As a Focus Guard user
I want to remove a blocked domain while it's temporarily unlocked
So that the domain becomes permanently unblocked without disrupting my open tabs

## Problem Statement

`removeDomain` in `blocklist.service.ts` calls `endSession(domain)` to clean up the unlock session. But `endSession` unconditionally calls `redirectOpenTabsToBlockedPage(domain)`, which redirects the user's open tab to `blocked.html`. Since the domain was just removed from the blocklist, the blocked page has nothing to display — and the subsequent `unblockBlockedPageTabs` call races with the in-flight navigation, causing ERR_FILE_NOT_FOUND.

## Solution Statement

Replace the `endSession(domain, trace_id)` call in `removeDomain` with direct calls to the individual cleanup steps (removeAllowRule, deleteUnlockSession, clear alarm) — skipping `redirectOpenTabsToBlockedPage` entirely. This avoids the erroneous redirect while still properly cleaning up session state.

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Low
**Primary Systems Affected**: `blocklist/blocklist.service.ts`, `blocklist/blocklist.handler.test.ts`
**Dependencies**: None

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

| File | Lines | Why |
|------|-------|-----|
| `src/blocklist/blocklist.service.ts` | 133–163 | `removeDomain` — the function to fix |
| `src/unlock/unlock.service.ts` | 160–175 | `endSession` — shows the steps we need to inline minus the redirect |
| `src/unlock/unlock.storage.ts` | 31–35 | `deleteUnlockSession` — we'll import this directly |
| `src/blocklist/blocklist.rules.ts` | 98–107 | `removeAllowRule` — already imported via unlock.service, need direct import |
| `src/unlock/unlock.storage.ts` | 13–15 | `getUnlockSessions` — needed to read session before cleanup |
| `src/blocklist/blocklist.handler.test.ts` | all | Existing test patterns to follow |

### New Files to Create

None.

### Patterns to Follow

**Import style:** Top-level named imports grouped by slice, `@/` path alias.

**Logging:** Structured JSON with `snake_case` event name, `trace_id`, `fix_suggestion` on warn/error.

**Optional fields:** Use spread-conditional idiom per `exactOptionalPropertyTypes`.

---

## IMPLEMENTATION PLAN

### Phase 1: Fix `removeDomain` in `blocklist.service.ts`

Replace the `endSession` call with inline cleanup that skips the tab redirect.

### Phase 2: Update tests

Add/update test for the remove-domain-with-active-session scenario.

### Phase 3: Validate

Run typecheck, lint, tests, build.

---

## STEP-BY-STEP TASKS

### Task 1: UPDATE `src/blocklist/blocklist.service.ts` — add imports

**IMPLEMENT**: Add imports for `removeAllowRule` from `blocklist.rules` (already in file? check), `getUnlockSessions`, `deleteUnlockSession` from `unlock.storage`, and remove the `endSession` import from `unlock.service` if it becomes unused.

Current imports from unlock.service (line 9):
```typescript
import { verifyAssertionGeneric, endSession } from '@/unlock/unlock.service';
```

After: remove `endSession` from this import. Add:
```typescript
import { getUnlockSessions, deleteUnlockSession } from '@/unlock/unlock.storage';
import { removeAllowRule } from '@/blocklist/blocklist.rules';
```

Note: `removeAllowRule` may already be accessible — check. `syncRules` is already imported from `blocklist.rules` (line 8), so add `removeAllowRule` to that import.

**VALIDATE**: `pnpm typecheck`

### Task 2: UPDATE `src/blocklist/blocklist.service.ts` — replace `endSession` call in `removeDomain`

**IMPLEMENT**: Replace lines 156–157:
```typescript
// Clean up any active unlock session for the removed domain
await endSession(domain, trace_id);
```

With inline cleanup that skips the redirect:
```typescript
// Clean up any active unlock session (without redirecting tabs to blocked page,
// since the domain is no longer blocked)
const sessions = await getUnlockSessions();
const session = sessions[domain];
if (session) {
  await removeAllowRule(session.allowRuleId);
  await deleteUnlockSession(domain);
  chrome.alarms.clear('relock:' + domain);
  logger.info('unlock_session_cleaned_up', { domain, trace_id });
}
```

**GOTCHA**: `endSession` is still used by `service-worker.ts` (relock alarm handler) — do NOT remove or modify `endSession` itself.

**VALIDATE**: `pnpm typecheck`

### Task 3: UPDATE tests — add remove-with-active-session test

**IMPLEMENT**: In `src/blocklist/blocklist.handler.test.ts`, add a test that verifies removing a domain with an active unlock session does NOT call `redirectOpenTabsToBlockedPage` / does NOT redirect tabs to blocked page, and DOES clean up the allow rule and session.

Follow existing test patterns in the file. The key assertions:
1. `removeAllowRule` is called with the session's `allowRuleId`
2. The unlock session is deleted from storage
3. The alarm is cleared
4. `chrome.tabs.update` is NOT called with a `blocked.html` URL (only called with the original URL for `unblockBlockedPageTabs`)

**VALIDATE**: `pnpm test`

---

## TESTING STRATEGY

### Unit Tests

- Test `removeDomain` when domain has an active unlock session: verify allow rule removed, session deleted, alarm cleared, tabs NOT redirected to blocked page, tabs on blocked page ARE redirected back to original URL.
- Test `removeDomain` when domain has NO active unlock session: verify existing behavior unchanged.

### Edge Cases

- Domain removed while unlock session exists and tabs are open on both the live domain and the blocked page
- Domain removed with no unlock session (regression — should still work)

---

## VALIDATION COMMANDS

Execute in order. Each level gates the next.

### Level 1: Syntax & Style

```bash
pnpm lint
pnpm format:check
```

### Level 2: Type Safety

```bash
pnpm typecheck
```

### Level 3: Unit Tests

```bash
pnpm test
```

### Level 4: Build

```bash
pnpm build
```

### Level 5: Manual Validation

1. Load extension in `brave://extensions` (dev mode, load unpacked `dist/`)
2. Add a domain to blocklist (e.g., `example.com`)
3. Unlock domain for 5 minutes via YubiKey
4. Navigate to `example.com` in a tab — confirm it loads
5. Remove domain from blocklist via popup (YubiKey auth)
6. Confirm the open tab stays on `example.com` (no redirect, no error)
7. Confirm domain is gone from blocklist in popup

---

## ACCEPTANCE CRITERIA

- [ ] Removing a blocked domain with active unlock session leaves open tabs undisturbed on the live site
- [ ] Allow rule, unlock session, and relock alarm are cleaned up
- [ ] Tabs stuck on the blocked page for that domain are redirected back to the original URL
- [ ] Removing a domain with no active session still works (no regression)
- [ ] All validation commands pass with zero errors

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] All validation commands pass
- [ ] Manual testing confirms fix
- [ ] No regressions

---

## NOTES

- `endSession` in `unlock.service.ts` is NOT modified — it's still correct for the relock-on-expiry path where the domain remains blocked.
- The inline cleanup in `removeDomain` is intentionally not extracted to a shared helper — it's 5 lines used in one place (YAGNI).
