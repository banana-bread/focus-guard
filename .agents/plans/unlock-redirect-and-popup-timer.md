# Feature: unlock-redirect-and-popup-timer

The following plan should be complete, but validate codebase patterns and task sanity before implementing.
Pay special attention to existing DOM IDs, CSS class names, and TypeScript strict-mode constraints.

## Feature Description

After a user unlocks a blocked site, the current tab should reload to the exact URL they were trying to visit
(not stay on the blocked page). The countdown timer should move from the blocked page into the popup,
displayed inline next to the domain row in the "Blocked Sites" list.

## User Story

As a Focus Guard user  
I want the tab to redirect to my original URL after I unlock a site, and see the unlock timer in the popup  
So that the unlock flow is seamless and the blocked page disappears immediately after authentication

## Problem Statement

Currently: unlock → stays on `blocked.html` showing a countdown → user must manually navigate to their target URL.  
Also: the popup shows no indication that a domain is currently unlocked/has an active timer.

## Solution Statement

1. Capture the original URL in the block redirect (via `regexSubstitution`), pass it as `&url=RAW_URL` query param.
2. After successful WebAuthn assertion in `blocked.ts`, call `window.location.replace(originalUrl)` immediately — no countdown on blocked page.
3. In `popup.ts`, query unlock sessions for each domain after rendering the blocklist, attach a live MM:SS timer next to unlocked domain rows, refreshed by a single `setInterval`.

## Feature Metadata

**Feature Type**: Enhancement  
**Estimated Complexity**: Medium  
**Primary Systems Affected**: `blocklist/blocklist.rules.ts`, `blocked/blocked.*`, `popup/popup.*`  
**Dependencies**: None (no new permissions needed)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

| File | Lines | Why |
|------|-------|-----|
| `src/blocklist/blocklist.rules.ts` | 1–41 | `buildBlockRule` — changing `urlFilter`+`extensionPath` to `regexFilter`+`regexSubstitution` |
| `src/blocked/blocked.ts` | 1–233 | Full file — removing unlocked state/timer, adding redirect logic |
| `src/blocked/blocked.html` | 1–37 | Remove `#state-unlocked` div |
| `src/popup/popup.ts` | 80–96 | `renderBlocklist` — add timer spans and session polling |
| `src/popup/popup.css` | 111–133 | `.domain-item` / `.domain-name` — add `.domain-timer` class |
| `src/core/messages.ts` | 51 | `GET_UNLOCK_SESSION` message shape — `{ domain, trace_id }` → `{ expiresAt: number }` |

### New Files to Create

None.

### Patterns to Follow

**Strict-mode exactOptionalPropertyTypes** — already handled in blocked.ts line 175:
```typescript
...(transport !== undefined ? { transport } : {}),
```

**sendMessage wrapper** — identical in both `blocked.ts` and `popup.ts`; don't import from shared (no shared UI utils).

**`chrome.storage.local.get` callback** — must annotate `(result: Record<string, unknown>)`. Not touched in this plan.

**Timer format** — `formatTime(ms)` already exists in `blocked.ts:39-44`; replicate same logic in `popup.ts`.

**CSS variable palette** — `--text-muted: #94a3b8`, `--success: #10b981`, `--accent: #3b82f6`. Timer should use `--text-muted`.

---

## IMPLEMENTATION PLAN

### Phase 1: Pass original URL through block redirect

Change `buildBlockRule` in `blocklist.rules.ts` so the redirect URL embeds the original URL the user was navigating to. Use `regexFilter` + `regexSubstitution` instead of `urlFilter` + `extensionPath`.

### Phase 2: Blocked page — redirect on unlock, remove countdown

After assertion verified, call `window.location.replace(originalUrl)`. Remove `showUnlockedState`, `startCountdown`, and all unlocked-state DOM. If the page loads and the session already exists (edge case), redirect to `https://${domain}` as fallback.

### Phase 3: Popup — inline timer for unlocked domains

After `renderBlocklist`, fetch unlock sessions for all domains in parallel. Attach a `<span class="domain-timer">` to each unlocked domain's `<li>`. Run a `setInterval(1000)` that updates all timers, removes the span when time expires.

---

## STEP-BY-STEP TASKS

---

### TASK 1: UPDATE `src/blocklist/blocklist.rules.ts` — use regexFilter + regexSubstitution

**IMPLEMENT**: Replace `buildBlockRule` body. Use `regexFilter` to match any URL on the domain, capture the full URL in group 1, substitute into blocked page URL with `&url=\1`.

**PATTERN**: `chrome.runtime.id` is synchronous and available in service worker context.

**GOTCHA**: `regexSubstitution` value must be a literal string — `\1` references capture group 1 from `regexFilter`. The captured original URL is NOT percent-encoded by Chrome. This is intentional — blocked.ts will parse it with an `indexOf` approach to handle `&` and `?` in the original URL's query string.

**GOTCHA**: `regexFilter` replaces `urlFilter` — they cannot coexist on the same rule condition. Remove `urlFilter`.

**GOTCHA**: `regexFilter` patterns are evaluated as RE2 syntax (no lookaheads). Escape domain dots.

**CODE**:
```typescript
/** Escapes a domain string for use in a RE2 regex. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildBlockRule(domain: string, index: number): chrome.declarativeNetRequest.Rule {
  const escaped = escapeRegex(domain);
  // Matches https?:// + optional subdomains + domain + any path/query/hash
  const regexFilter = `^(https?://(?:[^/?#]*\\.)?${escaped}.*)$`;
  const extensionBase = chrome.runtime.getURL('/blocked/blocked.html');
  return {
    id: BLOCK_RULE_ID_BASE + index,
    priority: 1,
    action: {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        regexSubstitution: `${extensionBase}?domain=${encodeURIComponent(domain)}&url=\\1`,
      },
    },
    condition: {
      regexFilter,
      resourceTypes: [
        'main_frame' as chrome.declarativeNetRequest.ResourceType,
      ],
    },
  };
}
```

Note: Remove `sub_frame` from resourceTypes — blocking sub-frames causes issues when the site is unlocked and iframes try to load. Only block `main_frame` navigations.

**VALIDATE**: `npx tsc --noEmit` from project root.

---

### TASK 2: UPDATE `src/blocked/blocked.html` — remove unlocked state div

**REMOVE**: The entire `<div id="state-unlocked" class="hidden">` block (lines 30–33 in current file).

Result: only `#state-locked` remains. The page no longer has any post-unlock UI — it immediately redirects.

**VALIDATE**: `grep -n "state-unlocked" src/blocked/blocked.html` → no output.

---

### TASK 3: UPDATE `src/blocked/blocked.ts` — redirect on unlock, remove countdown code

**IMPLEMENT**:

1. Parse `originalUrl` from query string using `indexOf` to handle embedded `&`/`?` in original URL:
```typescript
const params = new URLSearchParams(window.location.search);
const domain = params.get('domain') ?? 'Unknown site';
// Use indexOf to avoid URLSearchParams truncating at embedded & chars
const search = window.location.search;
const urlMarker = '&url=';
const urlIdx = search.indexOf(urlMarker);
const originalUrl = urlIdx !== -1 ? search.slice(urlIdx + urlMarker.length) : null;
```

2. **REMOVE** from DOM references: `stateUnlocked`, `timerEl`.

3. **REMOVE** functions: `startCountdown`, `formatTime`, `showUnlockedState`. Keep `showLockedState`.

4. **REMOVE** `countdownInterval` variable.

5. In `handleUnlock`, replace the `showUnlockedState(session.expiresAt)` call at the end with a redirect:
```typescript
// After verifyResp.ok:
const target = originalUrl ?? `https://${domain}`;
window.location.replace(target);
return; // no further UI updates needed
```

6. In `init()`, replace `showUnlockedState(session.expiresAt)` with redirect to `https://${domain}` (we don't know original URL at init time if session already exists):
```typescript
if (sessionResp.ok && sessionResp.data !== null) {
  // Domain already unlocked — redirect away from blocked page
  window.location.replace(originalUrl ?? `https://${domain}`);
  return;
}
showLockedState();
```

**GOTCHA**: Keep `showLockedState()` — it's still needed for the initial state and error recovery.

**GOTCHA**: `stateUnlocked` and `timerEl` DOM queries will return `null` after removing them from HTML — remove those `document.getElementById` calls entirely to keep code clean.

**VALIDATE**: `npx tsc --noEmit`

---

### TASK 4: UPDATE `src/popup/popup.css` — add domain-timer style

**ADD** after `.domain-name` block:
```css
.domain-timer {
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-muted);
  white-space: nowrap;
  margin-left: 8px;
}

.domain-timer.active {
  color: var(--success);
}
```

**VALIDATE**: Visual check after build.

---

### TASK 5: UPDATE `src/popup/popup.ts` — add inline unlock timers

**IMPLEMENT** the following changes:

**A) Add `formatTime` helper** (same logic as blocked.ts):
```typescript
function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
```

**B) Update `renderBlocklist`** — add `data-domain` attribute and timer span placeholder:
```typescript
for (const domain of domains) {
  const li = document.createElement('li');
  li.className = 'domain-item';
  li.dataset['domain'] = domain;
  li.innerHTML = `<span class="domain-name">${escapeHtml(domain)}</span>`;
  // Timer span appended later by initTimers
  domainList.appendChild(li);
}
```

**C) Add `timerInterval` module-level variable and `initTimers` function**:
```typescript
let timerInterval: ReturnType<typeof setInterval> | null = null;

async function initTimers(domains: string[]): Promise<void> {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Fetch sessions in parallel
  const sessionResults = await Promise.all(
    domains.map(async (domain) => {
      const trace_id = crypto.randomUUID();
      const resp = await sendMessage({ type: 'GET_UNLOCK_SESSION', domain, trace_id });
      if (resp.ok && resp.data !== null) {
        return { domain, expiresAt: (resp.data as { expiresAt: number }).expiresAt };
      }
      return null;
    }),
  );

  // Attach expiresAt to DOM elements
  for (const result of sessionResults) {
    if (result === null) continue;
    const li = domainList?.querySelector<HTMLLIElement>(`[data-domain="${CSS.escape(result.domain)}"]`);
    if (!li) continue;
    li.dataset['expiresAt'] = String(result.expiresAt);
    const timerSpan = document.createElement('span');
    timerSpan.className = 'domain-timer active';
    timerSpan.id = `timer-${result.domain}`;
    timerSpan.textContent = formatTime(result.expiresAt - Date.now());
    li.appendChild(timerSpan);
  }

  // Single interval updates all active timers
  timerInterval = setInterval(() => {
    const timerSpans = domainList?.querySelectorAll<HTMLSpanElement>('[id^="timer-"]') ?? [];
    for (const span of timerSpans) {
      const li = span.closest('li') as HTMLLIElement | null;
      if (!li?.dataset['expiresAt']) continue;
      const remaining = Number(li.dataset['expiresAt']) - Date.now();
      if (remaining <= 0) {
        span.remove();
        delete li.dataset['expiresAt'];
      } else {
        span.textContent = formatTime(remaining);
      }
    }
  }, 1000);
}
```

**D) Call `initTimers`** after rendering the blocklist in `init()` and `handleAddDomain()`:

In `init()`:
```typescript
const domains = listResp.data as string[];
renderBlocklist(domains);
void initTimers(domains);
```

In `handleAddDomain()`:
```typescript
const domains = listResp.data as string[];
renderBlocklist(domains);
void initTimers(domains);
```

**GOTCHA**: `CSS.escape()` is a browser global — available in popup context, no import needed.

**GOTCHA**: `timerInterval` must be cleared and restarted when `renderBlocklist` is called again (e.g., after adding a domain), since `initTimers` handles this at the top.

**GOTCHA**: `exactOptionalPropertyTypes` — `li.dataset['expiresAt']` returns `string | undefined`; the `if (!li?.dataset['expiresAt'])` guard handles undefined safely.

**VALIDATE**: `npx tsc --noEmit`

---

## TESTING STRATEGY

No automated test runner. Manual validation only.

### Manual Test Cases

| Scenario | Expected |
|----------|----------|
| Navigate to `reddit.com/r/news`, blocked → unlock → key tap | Tab navigates to `reddit.com/r/news`, not `reddit.com` |
| Navigate to `reddit.com/search?q=test&sort=new`, blocked → unlock | Tab navigates to full URL with query params intact |
| Open popup during active unlock session | Timer shows next to domain, counts down MM:SS |
| Timer reaches 00:00 in popup | Timer span disappears from popup UI |
| Add new domain to blocklist while timer is active | Timer still shows after list re-render |
| Navigate to blocked page directly (no URL in query) | Redirects to `https://{domain}` after unlock |

---

## VALIDATION COMMANDS

### Level 1: Type Safety
```bash
npx tsc --noEmit
```

### Level 2: Build
```bash
npx vite build
```

### Level 3: Lint (if configured)
```bash
npx eslint src/ --ext .ts 2>/dev/null || echo "No eslint config"
```

### Level 4: Manual
1. `npx vite build`
2. Load `dist/` as unpacked extension in `brave://extensions`
3. Add `reddit.com` to blocklist
4. Navigate to `https://reddit.com/r/news`
5. Verify blocked page shows domain, unlock button
6. Tap YubiKey → tab should redirect to `reddit.com/r/news`
7. Open popup → verify timer shows next to `reddit.com`
8. Wait for timer expiry → timer disappears from popup

---

## ACCEPTANCE CRITERIA

- [ ] Unlocking redirects current tab to exact original URL (including path and query params)
- [ ] Blocked page shows no countdown timer — disappears immediately after unlock
- [ ] Popup shows MM:SS countdown next to unlocked domain, right-aligned, in muted/green color
- [ ] Timer in popup updates every second without full re-render
- [ ] Re-locking (timer expiry) still works — blocked page returns on next navigation
- [ ] Popup timer span disappears when session expires (00:00 reached)
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npx vite build` completes with no errors

---

## COMPLETION CHECKLIST

- [ ] Task 1: `buildBlockRule` uses `regexFilter` + `regexSubstitution`
- [ ] Task 2: `blocked.html` `#state-unlocked` removed
- [ ] Task 3: `blocked.ts` redirects on unlock, countdown code removed
- [ ] Task 4: `popup.css` `.domain-timer` added
- [ ] Task 5: `popup.ts` `initTimers`, `formatTime`, timer spans added
- [ ] All type checks pass
- [ ] Build succeeds
- [ ] Manual end-to-end flow verified

---

## NOTES

**Why `indexOf('&url=')` instead of `URLSearchParams`**: The original URL may contain `&` or `?` characters in its query string. `URLSearchParams` splits on `&`, so `?url=https://site.com/path?q=test&sort=new` would return only `https://site.com/path?q=test`. The `indexOf` approach returns everything after `&url=` — the original URL verbatim — which handles all query string patterns.

**Why remove `sub_frame` from block rule resourceTypes**: Sub-frame blocking can cause issues when the allow rule exists — iframes on unlocked sites may still trigger block rules. Only `main_frame` matters for the user-visible "go to site" experience.

**Why no `GET_ORIGINAL_URL` message or webNavigation permission**: Storing the URL in the redirect query string is simpler, requires no new permissions, and avoids service worker memory state that could be lost on SW restart. The only downside is the edge case of `&url=` appearing in the original URL's query string — acceptable.

**Popup timer lifecycle**: The popup is destroyed when closed, so no cleanup needed for `timerInterval`. When the popup reopens, `init()` re-runs and `initTimers` creates a fresh interval.
