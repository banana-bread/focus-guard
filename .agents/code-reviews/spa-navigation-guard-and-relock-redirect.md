# Code Review — SPA navigation guard & relock tab redirect

**Stats:**
- Files Modified: 3 (manifest.json, src/service-worker.ts, src/unlock/unlock.service.ts)
- Files Added: 2 (src/blocklist/spa-navigation-guard.ts, src/blocklist/spa-navigation-guard.test.ts)
- Files Deleted: 0
- New lines: ~180
- Deleted lines: ~1

## Summary

The change adds a `webNavigation`-based SPA guard to supplement declarativeNetRequest, and redirects already-open tabs when an unlock session expires. Architecture, slice boundaries, logging, and typing all look good. Tests cover the pure decision function well. A few real issues below — mostly medium/low.

---

severity: medium
file: src/service-worker.ts
line: 35-41
issue: `onCommitted` listener is redundant with DNR and adds overhead on every page load
detail: DNR runs in the network layer *before* `webNavigation.onCommitted` fires. By the time `onCommitted` runs, DNR has already redirected blocked requests to `blocked.html`, so the guard's onCommitted path only ever sees allowed navigations — yet it still hits storage twice (`getBlocklist` + `getUnlockSessions`) for every committed navigation in every tab. `onHistoryStateUpdated` is the one that actually closes the SPA gap; `onCommitted` is defensive overlap that costs a double storage read per page load.
suggestion: Drop the `onCommitted` listener, or if you want belt-and-braces, at minimum cache the blocklist in a SW-module variable invalidated on `ADD_DOMAIN`/remove so the hot path is in-memory. Also consider early-returning before the `getUnlockSessions` call when the blocklist match fails.

---

severity: medium
file: src/blocklist/spa-navigation-guard.ts
line: 76-82
issue: Storage read on every navigation event; no in-memory cache
detail: `handleSpaNavigation` calls `getBlocklist()` and `getUnlockSessions()` for every top-frame navigation in every tab. `chrome.storage.local` reads are async and cheap but not free, and this fires for navigations to domains that will never be on the blocklist. Combined with the double registration above, that's ~4 storage reads per normal page load.
suggestion: Cache blocklist and sessions in SW module state, refresh on mutation messages and on `chrome.storage.onChanged`. SW memory is ephemeral so cache cold-start cost is bounded.

---

severity: low
file: src/unlock/unlock.service.ts
line: 152-154
issue: `tabs.query` URL pattern doesn't cover non-standard ports or exact-host edge cases cleanly
detail: Patterns `*://${domain}/*` and `*://*.${domain}/*` work for typical hosts, but if `domain` is ever something like `localhost:3000` (not realistic given `normalizeDomain`, but the function does not reject ports explicitly) the match pattern would be malformed and the query would throw. `normalizeDomain` currently goes via `new URL().hostname`, which strips the port, so this is latent rather than active.
suggestion: Not urgent. Add an assertion that `domain` matches `/^[a-z0-9.-]+$/` before interpolating into the match pattern, to harden against future regressions in `normalizeDomain`.

---

severity: low
file: src/unlock/unlock.service.ts
line: 151-172
issue: `redirectOpenTabsToBlockedPage` failures are unlogged and swallowed by `Promise.all` rejection
detail: If any `chrome.tabs.update` rejects (e.g., tab closed mid-flight), `Promise.all` rejects and the caller `endSession` has no try/catch around it. The error then propagates out of the alarm listener's `void endSession(...)` and is lost silently, and the subsequent `logger.info('unlock_session_ended', ...)` never runs — the session state transition log is missing for that case.
suggestion: Wrap the redirect call in try/catch inside `endSession`, or use `Promise.allSettled` inside `redirectOpenTabsToBlockedPage` and log per-tab failures with `tab_id` + `fix_suggestion`. The unlock session is already deleted from storage at that point, so the redirect is best-effort and should not mask the end-of-session event.

---

severity: low
file: src/blocklist/spa-navigation-guard.ts
line: 31
issue: Loose return type `{ block: boolean; domain?: string }` instead of discriminated union
detail: The function actually returns two distinct shapes; `domain` is always defined when `block` is `true`. The caller then re-checks `decision.domain === undefined` defensively (line 84), which is dead code.
suggestion: Change return type to `{ block: false } | { block: true; domain: string }` and drop the `decision.domain === undefined` guard in `handleSpaNavigation`.

---

severity: low
file: src/blocklist/spa-navigation-guard.ts
line: 45
issue: Subdomain match uses string suffix rather than a label boundary helper
detail: `domain.endsWith('.' + entry)` is correct in practice, but the same label-matching logic likely exists (or should exist) elsewhere (e.g., `blocklist.rules.ts`). Duplicating ad-hoc suffix checks across slices risks divergence.
suggestion: If a `matchesDomain(host, entry)` helper already exists in `shared/domain.ts` or a blocklist util, use it. Otherwise, fine as-is — promote to `shared/domain.ts` only when a second caller needs it (YAGNI).

---

severity: low
file: src/blocklist/spa-navigation-guard.ts
line: 85
issue: `spa_navigation_allowed` logged at debug for every navigation in every tab
detail: At debug level this is not technically wrong, but it roughly doubles SW log volume and the event carries no `url`/`domain` so it's not actionable. The "allowed" branch is the uninteresting hot path.
suggestion: Remove the debug log on the allowed branch, or gate it behind an explicit dev flag. Keep the blocked branch log.

---

severity: low
file: src/blocklist/spa-navigation-guard.test.ts
line: 5-15
issue: Time-dependent fixtures use `Date.now()` at call time without freezing the clock
detail: `future()` and `past()` compute expiry relative to wall-clock. On a machine under load (or CI freeze) `past()` with `-1_000` ms could theoretically race, and `future()` with `+60_000` ms is fine but brittle. Tests pass today but are sensitive to scheduler jitter.
suggestion: Use `vi.useFakeTimers()` + `vi.setSystemTime(...)` so the decision function sees a deterministic clock. Optional — low risk in practice.

---

severity: low
file: manifest.json
line: 10
issue: `webNavigation` permission addition — worth confirming user-visible permission prompt impact
detail: Adding `webNavigation` to an already-published extension triggers a re-consent prompt on update in Chrome/Brave. Not a code bug, but worth flagging to whoever ships the build.
suggestion: Note it in the release notes / PR description. No code change.

---

## Positive notes

- `shouldBlockNavigation` correctly separated as a pure function and well-tested.
- Non-http scheme early return prevents redirect loops on `chrome-extension://blocked.html`.
- `frameId !== 0` guard correctly ignores subframes.
- JSDoc on every exported symbol, structured logs with `trace_id`, `fix_suggestion` on the error path — all matching CLAUDE.md rules.
- Slice boundaries respected: the guard lives in `blocklist/` and imports `unlock.storage` as read-only; no reverse dependency.
- `redirectOpenTabsToBlockedPage` is kept file-local (not exported) and correctly narrows `tabs.Tab` to `{ id: number; url: string }` via a type guard.

---

## Verdict

No critical or high-severity issues. The medium findings are about eliminating avoidable storage reads on the hot path and tightening the end-of-session error path. Safe to ship as-is; file a follow-up for the caching work if perf becomes noticeable.
