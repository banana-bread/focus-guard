## Codebase Patterns
- Pure vanilla JS, no build system. No lint/typecheck scripts — manual extension reload to test.
- ES modules throughout (`import`/`export`). Service worker uses top-level `import` (MV3).
- `lib/webauthn.js` exports both registration and verification helpers; `base64urlEncode`/`base64urlDecode` are also exported and reusable.
- `lib/storage.js` exports all individual getters/setters (including `setCredential`).
- `chrome.runtime.sendMessage` callback style used in content/blocked scripts; async `handleMessage` in the service worker returns values directly.
- No automated tests. Acceptance criteria are verified manually in the browser.

---

## 2026-02-28 - US-001
- **What was implemented**: Moved WebAuthn assertion verification from the blocked-page context into the service worker, closing the critical bypass where `UNLOCK_DOMAIN` could be called from DevTools without a hardware-key touch.
- **Files changed**:
  - `lib/webauthn.js` — extracted `verifyAssertionData(assertionParts, challenge, credentialData)`: pure crypto function (no `navigator.credentials`), validates challenge embedded in `clientDataJSON`, verifies signature, enforces sign-counter monotonicity. `verifyWithCredential()` now delegates to it.
  - `service-worker.js` — imported `verifyAssertionData`, `base64urlDecode`, `base64urlEncode`, `setCredential`; added module-level `pendingChallenges` Map; added `GET_CHALLENGE` case; rewrote `UNLOCK_DOMAIN` to consume the stored challenge, call `verifyAssertionData`, update the sign count, then unlock.
  - `blocked.js` — replaced `verifyWithCredential()` call with: GET_CHALLENGE → `navigator.credentials.get()` → forward raw assertion bytes to UNLOCK_DOMAIN.
- **Learnings for future iterations:**
  - Service workers cannot call `navigator.credentials` — keep any WebAuthn browser API calls in page/popup contexts and pass raw bytes to the SW for verification.
  - In-memory Map for challenges is acceptable: the SW stays alive for the short GET_CHALLENGE → UNLOCK_DOMAIN round-trip. If the SW is ever killed in between, the user just needs to retry (safe failure).
  - `setCredential` was already exported from `lib/storage.js` — no changes needed there.
  - `blocked.js` uses callback-style `chrome.runtime.sendMessage` wrapped in a Promise for cleaner async flow.
---

## 2026-02-28 - US-002
- **What was implemented**: Added a curated AAGUID allowlist in `lib/webauthn.js` and enforced it during registration. If the enrolling authenticator's AAGUID is not on the list, registration throws a clear error surfaced in `popup.js`.
- **Files changed**:
  - `lib/webauthn.js` — added exported `AAGUID_ALLOWLIST` constant (array of UUID strings with inline comments per device); added allowlist check in `registerCredential()` immediately after `extractAAGUID()` (replaces the placeholder "Layer 4" comment).
- **Learnings for future iterations:**
  - `popup.js` `handleRegister()` already shows `err.message` via `showKeyError`, so any Error thrown in `registerCredential()` is automatically surfaced to the user — no popup changes needed.
  - AAGUID `00000000-0000-0000-0000-000000000000` is commonly used by virtual/software authenticators (e.g. Touch ID, Windows Hello) and authenticators that opt out of attestation — it will correctly be rejected by the allowlist.
  - The allowlist is exported so it can be imported and checked from tests or other modules if needed in the future.
---

## 2026-02-28 - US-003
- **What was implemented**: Added server-side domain validation in the service worker. `normalizeDomain()` is now imported and called on every inbound `payload.domain` in `ADD_DOMAIN`, `REMOVE_DOMAIN`, `GET_CHALLENGE`, and `UNLOCK_DOMAIN` handlers. `UNLOCK_DOMAIN` additionally verifies the (normalized) domain is present in the blocklist before proceeding.
- **Files changed**:
  - `service-worker.js` — imported `normalizeDomain` from `lib/normalize.js`; added normalization + null-check guard at the top of each relevant `case`; added blocklist membership check in `UNLOCK_DOMAIN`.
- **Learnings for future iterations:**
  - `normalizeDomain` already lowercases, strips www/protocol/port/path — calling it in the SW means both popup and SW agree on the canonical form, so `blocklist.includes(domain)` comparisons stay consistent.
  - The blocklist check in `UNLOCK_DOMAIN` must come after normalization so the comparison is apples-to-apples (stored domains are also normalized).
  - `GET_CHALLENGE` also needed normalization so the pendingChallenges Map key matches the key used later in `UNLOCK_DOMAIN`.
---

## 2026-02-28 - US-005
- **What was implemented**: Added stripping of `*`, `^`, and `|` characters in `normalizeDomain()` to prevent crafted input from creating overly broad `declarativeNetRequest` URL filter rules.
- **Files changed**:
  - `lib/normalize.js` — added `domain.replace(/[*^|]/g, "")` after the `www.` prefix strip; if removing these chars leaves an invalid domain (no dot, etc.) the existing validation still returns `null`.
- **Learnings for future iterations:**
  - The strip-then-validate approach is the right pattern: remove dangerous chars, then let existing validation catch any newly-invalidated domains.
  - The special chars `*`, `^`, `|` are meaningful in `declarativeNetRequest` URL filters (wildcard, separator, anchor) but have no valid use in a plain domain string.
---

## 2026-02-28 - US-004
- **What was implemented**: Added strict validation for `UPDATE_SETTINGS` payload. The handler now extracts only `unlockDurationMinutes`, validates it as a finite integer in [1, 1440], and returns an error for any invalid value. `updateSettings()` in `lib/storage.js` enforces the same constraint so the check cannot be bypassed by calling storage directly.
- **Files changed**:
  - `service-worker.js` — `UPDATE_SETTINGS` case now destructures only `unlockDurationMinutes`, validates it with `Number.isFinite` + `Number.isInteger` + range check, returns `{ error }` on failure, and passes only `{ unlockDurationMinutes }` to `updateSettings()`.
  - `lib/storage.js` — `updateSettings()` validates `unlockDurationMinutes` and throws on invalid input; merges only that key (not arbitrary spread) into stored settings.
- **Learnings for future iterations:**
  - `Number.isFinite` rejects `Infinity`, `-Infinity`, `NaN`, and non-numbers; `Number.isInteger` additionally rejects floats — both checks together cover all the required rejection cases.
  - Validation is duplicated intentionally in both the SW handler and `updateSettings()` to ensure the constraint is enforced regardless of call site.
---

## 2026-02-28 - US-006
- **What was implemented**: Fixed TOCTOU race in allow-rule ID generation in `lib/blocker.js`. `unlockDomain()` is now serialised via a module-level promise chain (mutex pattern) so concurrent calls cannot read the same existing-rules state, compute the same `nextId`, and collide on `updateDynamicRules`. Errors from `updateDynamicRules` propagate to the caller (the service worker `UNLOCK_DOMAIN` handler) which returns them to the client.
- **Files changed**:
  - `lib/blocker.js` — changed `unlockDomain` from `async function` to a regular function that chains onto `_allowRuleQueue`; the chain is advanced with `.catch(() => {})` so one failure cannot stall subsequent calls, while the original promise still rejects for the caller.
- **Learnings for future iterations:**
  - Standard promise-chain mutex pattern: `queue = queue.then(work); queue = queue.catch(() => {})` — the second line keeps the queue alive after errors; `result` (before the catch) is what you return to callers so they still see failures.
  - The error is already propagated to callers correctly: `service-worker.js` wraps `handleMessage` in `.catch((err) => sendResponse({ error: err.message }))`, so any thrown error from `unlockDomain` automatically surfaces as `{ error: ... }` to the blocked page.
---

## 2026-02-28 - US-007
- **What was implemented**: Added blocklist validation in `blocked.js` before rendering the unlock UI. By reusing the existing `GET_STATE` message, the page now checks whether the `?domain=` query parameter is actually in the blocklist before enabling the unlock button. If not, the button is hidden and "This domain is not blocked." is displayed — preventing an open-redirect attack where a crafted `blocked.html?domain=evil.com` URL could trick the user into authenticating with their hardware key.
- **Files changed**:
  - `blocked.js` — expanded the initial `GET_STATE` callback to check `response.blocklist.includes(domain)`; on mismatch, hides the unlock button (`style.display = 'none'`) and shows an error message; returns early so the credential check is skipped.
- **Learnings for future iterations:**
  - `web_accessible_resources` with `matches: ["<all_urls>"]` is technically required because `declarativeNetRequest` redirect rules need to redirect arbitrary blocked URLs to `blocked.html`. No restriction is possible without breaking the core feature.
  - The service worker's `UNLOCK_DOMAIN` handler already validates blocklist membership (from US-003), providing a second line of defence.
  - Using `GET_STATE` (already called for credential check) avoids adding a new `CHECK_DOMAIN` message type — combining the two checks into one round-trip keeps the code minimal.
---
