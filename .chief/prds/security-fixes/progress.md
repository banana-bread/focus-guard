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
