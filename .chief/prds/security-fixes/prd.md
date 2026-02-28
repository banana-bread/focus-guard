# Focus Guard — Security Fixes

## Overview

Address all findings from the 2026-02-28 security review. The extension has a
well-considered architecture but contains one critical flaw that completely
bypasses the hardware-key guarantee, plus several high- and medium-severity
issues that must be resolved before publishing. This PRD covers all 10
actionable findings (issues 1–9, 11 from the review; rate limiting excluded).

## User Stories

### US-001: Move WebAuthn verification into the service worker
**Priority:** 1
**Description:** As a user, I want the hardware key check to be enforced by the
service worker so that no one can unlock a domain by sending a message from the
DevTools console or any other extension context without actually touching the key.

**Acceptance Criteria:**
- [ ] Service worker exposes a `GET_CHALLENGE` message type that generates a
      cryptographically random 32-byte challenge, stores it (keyed by domain),
      and returns it to the caller.
- [ ] `UNLOCK_DOMAIN` message type accepts the full WebAuthn assertion object
      (`clientDataJSON`, `authenticatorData`, `signature`) alongside the domain.
- [ ] Service worker verifies the assertion using `crypto.subtle` and the stored
      `publicKeySpki` before calling `unlockDomain()`.
- [ ] If verification fails or no challenge exists for the domain, the service
      worker returns an error and does NOT unlock.
- [ ] Stored challenges are single-use: consumed (deleted) immediately after
      verification attempt regardless of outcome.
- [ ] `blocked.js` is updated to (1) request a challenge, (2) pass it to
      `navigator.credentials.get()`, (3) forward the full assertion to the
      service worker instead of calling `unlockDomain` itself.
- [ ] Existing `verifyWithCredential()` logic in `lib/webauthn.js` is reused or
      adapted for the service worker context.


### US-002: Implement AAGUID allowlist validation
**Priority:** 2
**Description:** As a security-conscious user, I want only authenticators with
known hardware AAGUIDs to be accepted during registration so that virtual or
software-backed keys cannot be enrolled.

**Acceptance Criteria:**
- [ ] A curated AAGUID allowlist (covering common USB/NFC security keys, e.g.
      YubiKey 5 series, Google Titan, SoloKey) is defined in `lib/webauthn.js`.
- [ ] After extracting the AAGUID during attestation, registration is rejected
      if the AAGUID is not in the allowlist.
- [ ] The rejection surfaces a clear error message to the user in `popup.js`
      explaining that the authenticator is not on the approved hardware list.
- [ ] The allowlist is easy to extend (simple array of UUID strings with
      comments identifying each device).


### US-003: Add server-side domain validation in the service worker
**Priority:** 3
**Description:** As a user, I want the service worker to re-normalize and
validate every domain it receives so that a crafted message sent directly from
the console cannot create dangerous or malformed blocking rules.

**Acceptance Criteria:**
- [ ] `normalizeDomain()` is imported and called on `payload.domain` at the top
      of every relevant `case` block in the service worker message handler
      (`ADD_DOMAIN`, `REMOVE_DOMAIN`, `UNLOCK_DOMAIN`).
- [ ] If `normalizeDomain()` returns null/empty the handler returns an error
      response and performs no side effects.
- [ ] `UNLOCK_DOMAIN` verifies the domain is present in the blocklist before
      proceeding; if not, it returns an error.
- [ ] Existing popup-side normalization is kept as a UX convenience but is no
      longer the sole line of defence.


### US-004: Validate UPDATE_SETTINGS payload
**Priority:** 4
**Description:** As a user, I want settings changes to be validated so that
invalid values cannot break re-lock alarms or inject unexpected keys into
storage.

**Acceptance Criteria:**
- [ ] `UPDATE_SETTINGS` handler extracts only the known key `unlockDurationMinutes`
      from the payload (no spread of arbitrary keys).
- [ ] `unlockDurationMinutes` is validated as a finite positive integer in the
      range 1–1440 (1 minute to 24 hours); values outside that range return an
      error and are not persisted.
- [ ] `updateSettings()` in `lib/storage.js` is updated to enforce the same
      validation so the constraint is not bypassable by calling storage directly.
- [ ] Existing tests (manual or automated) confirm that 0, -1, `Infinity`,
      `"string"`, and extra keys are all rejected.


### US-005: Strip URL filter special characters in normalizeDomain
**Priority:** 5
**Description:** As a user, I want domain normalization to strip `*`, `^`, and
`|` so that specially crafted input cannot create overly broad
`declarativeNetRequest` URL filter rules.

**Acceptance Criteria:**
- [ ] `lib/normalize.js` removes (or rejects) the characters `*`, `^`, and `|`
      from the input before returning the normalized domain.
- [ ] A domain containing any of those characters either (a) has them stripped
      if the remainder is still a valid domain, or (b) causes `normalizeDomain`
      to return `null`.
- [ ] Existing normalization behaviour for valid domains is unchanged.


### US-006: Fix TOCTOU race in allow-rule ID generation
**Priority:** 6
**Description:** As a user, I want concurrent unlock requests to never silently
fail due to duplicate rule IDs so that two rapid unlock attempts both succeed
reliably.

**Acceptance Criteria:**
- [ ] `lib/blocker.js` serialises allow-rule creation (e.g. via a module-level
      promise chain / mutex) so that concurrent calls cannot compute the same
      `nextId`.
- [ ] Alternatively, a globally unique ID scheme (e.g. based on a monotonic
      counter persisted in `chrome.storage.local`) is used to avoid the read-
      compute-write race entirely.
- [ ] If `updateDynamicRules` fails for any reason the error is propagated to
      the service worker message handler and returned to the caller rather than
      swallowed.


### US-007: Restrict blocked.html open redirect
**Priority:** 7
**Description:** As a user, I want the blocked page to refuse to display or
unlock a domain that is not actually in my blocklist so that an attacker cannot
trick me into authenticating against a fake blocked-site page that redirects to
a malicious URL.

**Acceptance Criteria:**
- [ ] Before rendering the unlock UI, `blocked.js` sends a `CHECK_DOMAIN`
      message (or reuses an existing query) to verify the domain in the
      `?domain=` query parameter is present in the blocklist.
- [ ] If the domain is not in the blocklist, `blocked.html` shows an error
      state ("This domain is not blocked") and does not render the unlock
      button.
- [ ] The service worker validates the same condition inside the `UNLOCK_DOMAIN`
      handler (covered by US-003) as a second line of defence.
- [ ] `web_accessible_resources` in `manifest.json` is restricted to
      `matches: ["<all_urls>"]` only if technically required; otherwise scope it
      to the extension's own pages.


### US-008: Sanitize error messages returned from the service worker
**Priority:** 8
**Description:** As a developer, I want the service worker to return generic
error messages to callers so that internal implementation details are not
unnecessarily leaked.

**Acceptance Criteria:**
- [ ] The top-level `.catch` in `service-worker.js` returns a fixed generic
      string (e.g. `"An internal error occurred."`) instead of `err.message`.
- [ ] Errors that are user-actionable (e.g. domain not found, validation
      failure) continue to return specific, safe messages defined as constants.
- [ ] Internal errors are still logged via `console.error` for developer
      debugging, but not forwarded to the caller.


### US-009: Flag sign counter reset as anomalous
**Priority:** 9
**Description:** As a security-conscious user, I want the extension to detect
when an authenticator's sign counter drops from a non-zero value to zero so
that potential key cloning is not silently accepted.

**Acceptance Criteria:**
- [ ] In `lib/webauthn.js`, the counter check is updated so that if the stored
      `signCount` is non-zero and the new value is `0`, verification returns an
      error (counter reset anomaly detected).
- [ ] The error message clearly states that the authenticator may have been
      cloned or reset and advises the user to re-register their key.
- [ ] The existing check for `newSignCount <= credentialData.signCount` (non-
      zero case) is preserved.


### US-010: Strip trailing dots in normalizeDomain
**Priority:** 10
**Description:** As a user, I want domains entered with a trailing dot (valid
DNS notation) to be normalised correctly so that blocking and matching rules
work as expected.

**Acceptance Criteria:**
- [ ] `lib/normalize.js` trims one or more trailing dots from the domain string
      before returning the result.
- [ ] `foo.com.` and `foo.com` both normalise to `foo.com`.
- [ ] The change does not affect domains without trailing dots.
