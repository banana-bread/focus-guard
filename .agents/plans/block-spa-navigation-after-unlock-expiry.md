# Feature: Block SPA Navigation After Unlock Expiry

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Currently, after a domain's unlock timer expires, declarativeNetRequest (DNR) re-enables the block rule. However, single-page applications (SPAs) such as YouTube navigate client-side via the History API (`pushState` / `replaceState`) without issuing a new `main_frame` network request. Because DNR only matches at the network layer, in-app link clicks continue to load content even though the domain is once again "blocked." A manual URL bar entry triggers a real `main_frame` request, which is correctly blocked — proving DNR rules are active, just bypassed by SPAs.

This feature adds a `chrome.webNavigation.onHistoryStateUpdated` listener in the service worker. On each SPA route change it checks whether the target URL's domain is on the blocklist AND lacks an active unlock session, and if so redirects the tab to the blocked page (same target DNR would have used). This closes the SPA bypass without touching the existing DNR-based flow for real navigations.

Additionally: when the `relock:` alarm fires (unlock timer expires), the service worker now also finds any currently-open tabs on the domain and redirects them to the blocked page. Without this, a user sitting on a single URL (e.g., watching a YouTube video with no route changes) would keep watching past the expiry — the DNR rule is re-armed but the existing tab's state is untouched until the next navigation.

## User Story

As a user trying to self-enforce focus
I want in-app navigation within blocked sites to be blocked once my unlock timer expires
So that I can't keep consuming content on a distracting site just because I never reloaded the page

## Problem Statement

DNR rules only fire on actual network requests (`main_frame` / `sub_frame`). SPAs change the visible URL and swap content via History API without a `main_frame` request, so DNR never sees the navigation. Result: an expired unlock does not interrupt an open SPA session — the user can keep clicking around indefinitely.

## Solution Statement

Add a `chrome.webNavigation.onHistoryStateUpdated` listener (and `onCommitted` as a defensive second net) in the service worker. For each event targeting a top-level frame (`frameId === 0`):

1. Extract and normalize the domain from the event URL.
2. Check if the domain is on the blocklist.
3. Check if there's an active (non-expired) unlock session for it.
4. If blocked and no active session: call `chrome.tabs.update(tabId, { url: <blocked-page-url> })` with the original URL embedded in the query string (matching the DNR redirect format).

Also add the `webNavigation` permission to `manifest.json`.

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Low
**Primary Systems Affected**: service worker, blocklist slice, manifest
**Dependencies**: `chrome.webNavigation` API (already available in MV3, requires permission)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/service-worker.ts` (entire file) — Where the new listener must be registered. Mirror the existing `chrome.alarms.onAlarm` listener pattern at the top of the file.
- `src/blocklist/blocklist.rules.ts` (lines 31-51) — `buildBlockRule` shows the exact redirect URL format (`${extensionBase}?domain=${encodeURIComponent(domain)}&url=<original>`). The SPA fallback must produce the same URL so the blocked page behaves identically.
- `src/blocklist/blocklist.storage.ts` — `getBlocklist()` returns the current `Blocklist` (`string[]`) used for membership checks.
- `src/unlock/unlock.service.ts` (lines 114-117) — `getSession(domain)` returns the active `UnlockSession | undefined`. Use this for unlock-state checks. Note: sessions are cleared by the `relock:` alarm handler (`endSession`), so a missing session implies "not currently unlocked."
- `src/unlock/unlock.storage.ts` — Backing store for unlock sessions (batch-read via `getUnlockSessions` if doing many checks; for a single event, `getSession` is fine).
- `src/core/storage.ts` — `UnlockSession` type (`{ expiresAt, duration, allowRuleId }`). Check `expiresAt > Date.now()` before trusting.
- `src/shared/domain.ts` (lines 13-18) — `normalizeDomain(input)`. Use this to derive the hostname from the event URL so comparison with blocklist entries (also normalized) is consistent. Note it strips `www.` and lowercases.
- `src/core/logger.ts` — `createLogger('service_worker')`. Follow the snake_case event-name convention from CLAUDE.md.
- `manifest.json` — Add `"webNavigation"` to the `permissions` array.
- `.agents/bugs/navigation-while-on-blocked-site-not-blocked.md` — Original bug report with reproduction steps.

### New Files to Create

- `src/blocklist/spa-navigation-guard.ts` — New module in the blocklist slice that owns the `webNavigation` listener logic (domain check + redirect). Kept in `blocklist/` because the responsibility is "block rule enforcement" — it's a parallel path to `blocklist.rules.ts` (DNR) for the SPA case.
- `src/blocklist/spa-navigation-guard.test.ts` — Unit tests for the guard's pure decision function (see Testing Strategy).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [chrome.webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
  - Sections: `onHistoryStateUpdated`, `onCommitted`, event filters
  - Why: Core API for this fix. Note that `onHistoryStateUpdated` fires for both `pushState` and `replaceState`. `frameId === 0` identifies the top-level frame.
- [chrome.webNavigation permissions](https://developer.chrome.com/docs/extensions/reference/api/webNavigation#permissions)
  - Why: Confirms `"webNavigation"` is the required permission string (not a host permission — we already have `<all_urls>`).
- [chrome.tabs.update](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-update)
  - Why: Used to redirect the tab to the blocked page when a SPA navigation violates the block.
- [declarativeNetRequest limitations](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#limitations)
  - Why: Documents why DNR cannot see History API navigations (network-layer only). Confirms that a `webNavigation`-based supplement is the standard pattern.

### Patterns to Follow

**Logger construction (file-scoped):**

```typescript
import { createLogger } from '@/core/logger';
const logger = createLogger('service_worker');
```

**Event-name convention (from CLAUDE.md):** snake_case, answers "what happened?"
- Good: `spa_navigation_blocked`, `spa_navigation_allowed`
- Bad: `nav`, `blocked`

**Trace IDs across async boundaries:** Generate via `crypto.randomUUID()` at the top of each listener invocation so logs can be correlated.

**Domain comparison:** Always run `normalizeDomain()` on both sides of a comparison (blocklist entries are already normalized at add-time in `blocklist.service.ts`; event URLs are not).

**Storage access ordering (performance):** Inside the hot path of a nav event, fetch blocklist first, early-return if empty or domain not present, only then fetch unlock session. Avoid doing two storage reads on every keystroke-level nav.

---

## IMPLEMENTATION PLAN

### Phase 1: Manifest & Permission

Add `webNavigation` to manifest permissions. Without this, the listener registration silently no-ops.

### Phase 2: SPA Navigation Guard Module

Create `src/blocklist/spa-navigation-guard.ts` exporting:
- `shouldBlockNavigation(url, blocklist, sessions)` — **pure function**, unit-testable, returns `{ block: boolean, domain?: string }`.
- `handleSpaNavigation(details)` — async listener entry point that fetches state, calls the pure function, and dispatches `chrome.tabs.update` on a block.
- `registerSpaNavigationGuard()` — registers the listeners on `chrome.webNavigation.onHistoryStateUpdated` AND `chrome.webNavigation.onCommitted`.

Why both events: `onCommitted` catches regular full-page navigations that bypass DNR for any reason (e.g., same-document nav that triggers a commit without a network request, bfcache restores). `onHistoryStateUpdated` catches the common SPA case. Both call the same handler; duplicate-redirect risk is negligible because once we redirect, the tab's next commit is to the extension page (which is not on the blocklist).

### Phase 3: Service Worker Registration

Import and call `registerSpaNavigationGuard()` from `src/service-worker.ts` at module top-level, alongside the existing alarms listener.

### Phase 4: Testing & Validation

Unit-test the pure `shouldBlockNavigation` function with all permutations of blocklist / session state. Manually validate the full reproduction flow from the bug report.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### UPDATE `manifest.json`

- **IMPLEMENT**: Add `"webNavigation"` to the `permissions` array after `"alarms"`.
- **GOTCHA**: This is a top-level permission, not a host permission. Do not touch `host_permissions`.
- **VALIDATE**: `jq '.permissions | contains(["webNavigation"])' manifest.json` → `true`.

### CREATE `src/blocklist/spa-navigation-guard.ts`

- **IMPLEMENT**: Three exports as described in Phase 2.
  - `shouldBlockNavigation(url: string, blocklist: string[], sessions: Record<string, UnlockSession>): { block: boolean; domain?: string }`
    - Parse URL via `new URL(url)`; catch and return `{ block: false }` on invalid URL.
    - Ignore any URL whose scheme is not `http:` or `https:` (skip extension, chrome://, file://, about:blank).
    - Normalize hostname via `normalizeDomain`.
    - If domain not in blocklist → `{ block: false }`.
    - If a session exists and `session.expiresAt > Date.now()` → `{ block: false }`.
    - Otherwise → `{ block: true, domain }`.
  - `handleSpaNavigation(details: { tabId: number; frameId: number; url: string })`
    - Early-return if `frameId !== 0` (ignore subframes — DNR still blocks those via existing rules on real requests, and SPA subframe nav is rare).
    - Generate `trace_id`.
    - `const blocklist = await getBlocklist();` → if empty, return.
    - `const sessions = await getUnlockSessions();`
    - Call `shouldBlockNavigation`. If not blocked, log `spa_navigation_allowed` at debug and return.
    - Build the blocked page URL with the exact same shape as `buildBlockRule`:
      ```typescript
      const target = `${chrome.runtime.getURL('/blocked/blocked.html')}?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(details.url)}`;
      ```
    - `await chrome.tabs.update(details.tabId, { url: target });`
    - Log `spa_navigation_blocked` at info with `{ domain, tab_id, trace_id }`. Include `fix_suggestion` on any thrown error.
  - `registerSpaNavigationGuard()`
    - Registers `handleSpaNavigation` on both `chrome.webNavigation.onHistoryStateUpdated.addListener` and `chrome.webNavigation.onCommitted.addListener`.
    - Wrap each handler body in try/catch → `logger.error('spa_navigation_handler_threw', { error, fix_suggestion: 'Check spa-navigation-guard.ts' })`.
- **PATTERN**: Mirror module layout of `src/blocklist/blocklist.rules.ts` — JSDoc at top, small focused exports.
- **IMPORTS**:
  ```typescript
  import { createLogger } from '@/core/logger';
  import { normalizeDomain } from '@/shared/domain';
  import { getBlocklist } from '@/blocklist/blocklist.storage';
  import { getUnlockSessions } from '@/unlock/unlock.storage';
  import type { UnlockSession } from '@/core/storage';
  ```
- **GOTCHA**:
  - Do NOT call `getSession` in a loop — read all sessions once per event.
  - Do NOT redirect the extension's own `/blocked/blocked.html` URL (early-return on non-http(s) scheme handles this).
  - `onCommitted` also fires for the extension redirect itself; the scheme filter prevents a loop.
  - `chrome.webNavigation` events may be fired for prerendered pages — `frameId === 0` plus the scheme filter are sufficient guards; do not add more early-returns without a concrete reason.
  - Use typed callback parameters — strict mode will reject implicit `any` on listener args. Annotate as `chrome.webNavigation.WebNavigationTransitionCallbackDetails` (or the concrete event detail type — verify against `@types/chrome`).
- **VALIDATE**: `pnpm tsc --noEmit` passes.

### CREATE `src/blocklist/spa-navigation-guard.test.ts`

- **IMPLEMENT**: Vitest unit tests for `shouldBlockNavigation` only (pure function). Cases:
  1. URL not on blocklist → `block: false`.
  2. URL on blocklist, no session → `block: true` with correct domain.
  3. URL on blocklist, active session (expiresAt in future) → `block: false`.
  4. URL on blocklist, expired session (expiresAt in past) → `block: true`.
  5. `www.youtube.com/watch?v=x` with blocklist `['youtube.com']` → `block: true` (normalization).
  6. Non-http scheme (`chrome-extension://...`) → `block: false`.
  7. Invalid URL string → `block: false` (no throw).
  8. Subdomain `music.youtube.com` with blocklist `['youtube.com']` → `block: true` (matches DNR regex behavior for subdomains).
- **PATTERN**: Mirror `src/blocklist/blocklist.handler.test.ts` style — `describe` / `it`, `expect` assertions, no chrome mocks needed for the pure function.
- **IMPORTS**:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { shouldBlockNavigation } from './spa-navigation-guard';
  ```
- **GOTCHA**: Do not attempt to unit-test `handleSpaNavigation` — its side effects on `chrome.webNavigation` and `chrome.tabs` are covered by manual validation. Keeping the test surface pure avoids brittle chrome-mock scaffolding.
- **VALIDATE**: `pnpm vitest run src/blocklist/spa-navigation-guard.test.ts` passes.

### UPDATE `src/service-worker.ts`

- **IMPLEMENT**: Import and invoke `registerSpaNavigationGuard()` at module top-level, right after the existing `chrome.alarms.onAlarm.addListener` block.
  ```typescript
  import { registerSpaNavigationGuard } from '@/blocklist/spa-navigation-guard';
  // ...
  registerSpaNavigationGuard();
  ```
- **PATTERN**: Mirror the top-level listener registration style already used for `chrome.alarms.onAlarm`.
- **GOTCHA**: Must be called at module parse time so the listener is registered synchronously during service worker wake-up (MV3 requirement — async registration misses events).
- **VALIDATE**: `pnpm tsc --noEmit && pnpm lint src/service-worker.ts` passes.

### VERIFY `src/blocklist/blocklist.service.ts` domain normalization

- **IMPLEMENT**: No change — just read and confirm that domains added via `handleAddDomain` are passed through `normalizeDomain` before storage. If they are NOT, file a follow-up; if they are, the guard's normalization will match correctly.
- **VALIDATE**: `grep -n normalizeDomain src/blocklist/blocklist.service.ts` returns a match.

### SUBDOMAIN MATCH — design decision

- **IMPLEMENT**: The pure function must match on `domain === entry || domain.endsWith('.' + entry)` so that `music.youtube.com` is blocked when `youtube.com` is blocklisted. This matches the DNR regex `(?:[^/?#]*\.)?${escaped}` in `buildBlockRule`.
- **GOTCHA**: Do NOT use `domain.includes(entry)` — that would match `myyoutube.com` against `youtube.com`.
- **VALIDATE**: Test case #8 above covers this.

### UPDATE `src/unlock/unlock.service.ts` — redirect open tabs on relock

- **IMPLEMENT**: At the end of `endSession` (after `deleteUnlockSession` and `chrome.alarms.clear`), find all open tabs on the domain and redirect them to the blocked page.
  ```typescript
  const tabs = await chrome.tabs.query({ url: [`*://${domain}/*`, `*://*.${domain}/*`] });
  const blockedBase = chrome.runtime.getURL('/blocked/blocked.html');
  await Promise.all(
    tabs
      .filter((t): t is chrome.tabs.Tab & { id: number; url: string } => t.id !== undefined && !!t.url)
      .map((t) =>
        chrome.tabs.update(t.id, {
          url: `${blockedBase}?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(t.url)}`,
        }),
      ),
  );
  logger.info('relock_tabs_redirected', { domain, trace_id, tab_count: tabs.length });
  ```
- **PATTERN**: Reuses the same blocked-page URL shape as `buildBlockRule` and the SPA guard.
- **GOTCHA**:
  - Must happen AFTER `removeAllowRule` so any mid-flight request also blocks correctly.
  - `chrome.tabs.query` requires no additional permission — the `tabs` permission is only needed to access `url`/`title` on tabs the extension didn't navigate itself. Since we already have `<all_urls>` host permission, `url` is accessible. Verify at runtime; if `url` is undefined, add `"tabs"` to manifest permissions.
  - The match patterns need both `*://${domain}/*` AND `*://*.${domain}/*` to catch subdomains.
  - Do NOT redirect tabs that are already on the extension's blocked page (the URL filter above excludes them since `chrome-extension://` doesn't match `*://`).
- **VALIDATE**: `pnpm tsc --noEmit` passes; manual test in Level 5 step 11 below.

### MANUAL REPRO

- **IMPLEMENT**: Run the full reproduction from the bug report end-to-end (see Level 5 below).
- **VALIDATE**: Step 4 now redirects to the blocked page instead of loading the new video/page.

---

## TESTING STRATEGY

### Unit Tests

Pure-function tests for `shouldBlockNavigation` (8 cases listed above). No chrome-API mocking — the function takes blocklist and sessions as parameters.

### Integration Tests

None. The listener wiring is one line; meaningful verification requires a real Chromium browser environment, which is covered by manual validation below. Do not attempt to fake `chrome.webNavigation` in vitest — the ROI is negative.

### Edge Cases

- Navigating from a blocked SPA to an unrelated domain (e.g., clicking an outbound link) — must NOT redirect since target is off-blocklist.
- Session expires mid-session while user is idle on the page — next SPA click is blocked (covered by expired-session test case).
- User unlocks, navigates SPA, then unlock remains valid — SPA nav must pass through (active-session test case).
- Back/forward button in SPA that triggers `onHistoryStateUpdated` after expiry — must redirect.
- `about:blank` / `chrome://newtab` in a reused tab — scheme filter skips it.
- Blocklist empty → early return, no redirect.

---

## VALIDATION COMMANDS

Execute every command in pyramid order. Each level gates the next — do not proceed if a level fails.

### Level 1: Syntax & Style

```bash
pnpm lint
pnpm format:check
```

### Level 2: Type Safety

```bash
pnpm tsc --noEmit
```

### Level 3: Unit Tests

```bash
pnpm vitest run src/blocklist/spa-navigation-guard.test.ts
pnpm vitest run
```

### Level 4: Integration Tests

N/A — see Testing Strategy.

### Level 5: Manual Validation

Exactly reproduces the bug report:

1. `pnpm build` (or `pnpm build --watch`).
2. Open `brave://extensions` → reload the unpacked extension.
3. In the popup, add `youtube.com` to the blocklist.
4. Unlock `youtube.com` for 1 minute (lowest duration for quick iteration; or temporarily reduce a constant).
5. Open a YouTube video.
6. Wait for the 1-minute timer to elapse (popup or blocked page timer confirms expiry).
7. Click any link within YouTube (a related video, the home icon, a channel). **Expected**: redirected to the Focus Guard blocked page with the original target URL as the `url=` query param. **Before fix**: the new video/page would load.
8. Also verify manual URL bar entry still works (regression check on the DNR path): type `youtube.com/feed/trending` — should be blocked.
9. Re-unlock and confirm SPA navigation works normally while unlocked (no false-positive blocks).
10. Open DevTools service-worker console and confirm `spa_navigation_blocked` events appear in step 7 with correct `domain` and `tab_id`.
11. **Idle-tab relock**: Unlock `youtube.com`, open a video, and simply wait (do NOT click anything) until the timer expires. **Expected**: the tab is redirected to the blocked page automatically at expiry. Confirm `relock_tabs_redirected` log event with non-zero `tab_count`.

### Level 6: Build

```bash
pnpm build
```

Verify `dist/` contains no references to the old behavior and loads cleanly in the browser.

---

## ACCEPTANCE CRITERIA

- [ ] After unlock expiry, clicking any link inside a previously-unlocked SPA on a blocked domain redirects to the Focus Guard blocked page.
- [ ] The redirect carries the original click target URL in the `url=` query param (so the blocked page's "original URL" display matches the DNR path).
- [ ] Active unlock sessions are unaffected — in-app navigation proceeds normally while the timer is running.
- [ ] Off-blocklist navigations (outbound links) are never redirected.
- [ ] Navigations to non-`http(s)` schemes (e.g. `chrome://`, `about:blank`) are never redirected.
- [ ] Subdomain matching is consistent with DNR rules (`music.youtube.com` blocked when `youtube.com` is blocklisted).
- [ ] `spa_navigation_blocked` and `spa_navigation_allowed` log events fire with `trace_id`, `domain`, and `tab_id`.
- [ ] `manifest.json` declares the `webNavigation` permission.
- [ ] All unit tests pass; lint, tsc, and build are clean.
- [ ] No regressions in the existing DNR-based blocking path (manual URL-bar entry still blocked).
- [ ] Open tabs on a blocked domain are redirected to the blocked page at unlock expiry, even with no user interaction.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Manual reproduction from the bug report no longer reproduces
- [ ] No linting or type checking errors
- [ ] Acceptance criteria all met

---

## NOTES

**Why not use `chrome.tabs.onUpdated`?** `tabs.onUpdated` fires on URL changes but is less precise for SPA route changes and has more noise (title updates, status changes). `webNavigation.onHistoryStateUpdated` is purpose-built for History API navigations.

**Why keep DNR rules at all?** DNR is faster (zero JS execution on the hot path) and survives service worker eviction — the SPA guard is a supplement for the SPA bypass, not a replacement. Dual-layer defense is intentional.

**Why register both `onHistoryStateUpdated` and `onCommitted`?** Defense in depth: there are rare cases (bfcache, same-document non-history commits) where `onCommitted` fires but `onHistoryStateUpdated` doesn't. Running the same idempotent check on both events has near-zero cost and closes the remaining gaps.

**Follow-up (do NOT include in this plan):** If users report flicker from the round-trip (SPA renders briefly, then redirects), consider adding a content script that intercepts at the click/History API level. That's a larger change and should be a separate plan after we confirm the current approach isn't sufficient.

**Why the guard lives in `blocklist/` and not `unlock/`:** The responsibility is "enforce the block when DNR can't see it." That's the blocklist slice's concern. The guard only *reads* unlock state; it does not own it.
