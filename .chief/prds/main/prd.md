# Focus Guard — Chrome Extension

## Overview
A Chrome extension (Manifest V3) that blocks distracting domains and requires a physical hardware security key (YubiKey/FIDO2) to temporarily unlock them. The goal is friction-based self-discipline: make impulsive access require a deliberate physical action, not just a click.

WebAuthn works from Chrome extension pages (`chrome-extension://` URLs). Client-side verification is used (no server) — challenges generated locally, signatures verified via Web Crypto API, credentials stored in `chrome.storage.local`. This is friction-based security, not protection against a determined adversary.

## Architecture

```
focus-guard/
├── manifest.json
├── service-worker.js          # Event-driven background: rules, alarms, messages
├── popup.html/js/css           # Settings UI: manage blocklist + register key
├── blocked.html/js/css         # "Site blocked" page with unlock button
├── lib/
│   ├── webauthn.js             # Registration, verification, CBOR decoder, base64url
│   ├── blocker.js              # declarativeNetRequest rule management
│   └── storage.js              # chrome.storage.local CRUD abstraction
└── icons/                      # Extension icons (16, 48, 128px)
```

## Storage Schema (chrome.storage.local)

- `blocklist`: `string[]` — domain list (e.g., `["reddit.com", "youtube.com"]`)
- `credential`: `{ credentialId, publicKeySpki, transports, signCount, aaguid, createdAt }` or `null`
- `unlocks`: `{ [domain]: { ruleId, alarmName, unlockedAt } }` — active temporary unlocks
- `settings`: `{ unlockDurationMinutes: 30 }` — user preferences

## User Stories

---

### Phase 1: Foundation

### US-001: Create manifest.json with required permissions
**Priority:** 1
**Description:** As a developer, I want a valid Manifest V3 `manifest.json` so the extension can be loaded in Chrome.

**Acceptance Criteria:**
- [ ] Manifest V3 format with `manifest_version: 3`
- [ ] Permissions: `declarativeNetRequest`, `storage`, `alarms`
- [ ] Host permissions: `<all_urls>`
- [ ] Service worker declared with `type: "module"` for ES module imports
- [ ] `web_accessible_resources` includes `blocked.html` for all URLs
- [ ] Popup set to `popup.html`
- [ ] `key` field included in manifest for stable extension ID across dev/production
- [ ] Extension loads in `chrome://extensions` with no errors

### US-002: Implement storage abstraction layer
**Priority:** 1
**Description:** As a developer, I want a `lib/storage.js` module that wraps `chrome.storage.local` so all storage access is centralized with typed helpers.

**Acceptance Criteria:**
- [ ] Exports async functions: `getBlocklist()`, `setBlocklist(domains)`, `getCredential()`, `setCredential(cred)`, `clearCredential()`, `getUnlocks()`, `setUnlock(domain, data)`, `removeUnlock(domain)`, `getSettings()`, `updateSettings(partial)`
- [ ] Default values: blocklist `[]`, credential `null`, unlocks `{}`, settings `{ unlockDurationMinutes: 30 }`
- [ ] All functions use `chrome.storage.local.get`/`set` under the hood
- [ ] ES module exports (no build step required)

### US-003: Add placeholder extension icons
**Priority:** 1
**Description:** As a user, I want the extension to have visible icons in the Chrome toolbar and extensions page.

**Acceptance Criteria:**
- [ ] Icons provided at 16px, 48px, and 128px sizes in `icons/` directory
- [ ] Icons referenced in `manifest.json` under `icons` and `action.default_icon`
- [ ] Simple, recognizable design (shield or lock motif)

---

### Phase 2: Domain Blocking

### US-004: Implement declarativeNetRequest block rule management
**Priority:** 2
**Description:** As a developer, I want `lib/blocker.js` to manage dynamic redirect rules so blocked domains are redirected to the blocked page.

**Acceptance Criteria:**
- [ ] `syncBlockRules(blocklist, unlocks)` — rebuilds all block redirect rules from the blocklist, skipping currently unlocked domains
- [ ] Block rules use `urlFilter: "||domain/"` pattern to match domain and all subdomains
- [ ] Block rules redirect to `blocked.html?domain=<matched_domain>`
- [ ] Block rules use priority 1, rule IDs in range 1–9999
- [ ] `unlockDomain(domain)` — adds a high-priority (priority 2) allow rule, rule IDs in range 10001–19999
- [ ] `relockDomain(domain)` — removes the allow rule for that domain
- [ ] All functions use `chrome.declarativeNetRequest.updateDynamicRules`
- [ ] ES module exports

### US-005: Implement service worker event handling
**Priority:** 2
**Description:** As a user, I want the extension to automatically block default distracting sites on install and maintain blocking state across browser restarts.

**Acceptance Criteria:**
- [ ] All event listeners registered synchronously at top level of `service-worker.js`
- [ ] `onInstalled`: sets default blocklist `["reddit.com", "youtube.com", "twitter.com", "facebook.com", "instagram.com", "tiktok.com"]` and syncs block rules
- [ ] `onStartup`: cleans up expired unlocks and syncs rules
- [ ] `onAlarm`: re-locks domains when timers expire (calls `relockDomain`, removes unlock record from storage)
- [ ] `onMessage`: routes messages from popup and blocked page — supports message types: `GET_BLOCKLIST`, `ADD_DOMAIN`, `REMOVE_DOMAIN`, `UNLOCK_DOMAIN`, `GET_STATE`
- [ ] Uses `chrome.alarms` (not `setTimeout`) for re-lock timers
- [ ] ES module imports from `lib/`

### US-006: Create minimal blocked page
**Priority:** 2
**Description:** As a user, when I navigate to a blocked domain I want to see a clear "Site Blocked" page that tells me which domain is blocked.

**Acceptance Criteria:**
- [ ] `blocked.html` reads the `domain` query parameter and displays it
- [ ] Shows a message like "reddit.com is blocked by Focus Guard"
- [ ] Has an "Unlock with Security Key" button (disabled/hidden until Phase 5, but present in markup)
- [ ] Clean, centered layout with minimal CSS
- [ ] Works when accessed via redirect from declarativeNetRequest

### US-007: Implement domain input normalization
**Priority:** 2
**Description:** As a user, I want to enter domains in any format (with/without protocol, www, paths) and have them normalized correctly.

**Acceptance Criteria:**
- [ ] Normalization function strips protocol (`https://`, `http://`)
- [ ] Strips paths, query strings, ports
- [ ] Strips `www.` prefix
- [ ] Lowercases the result
- [ ] Validates the result looks like a domain (contains at least one dot, no spaces)
- [ ] Reusable utility function (can live in `lib/storage.js` or a shared util)

---

### Phase 3: Popup UI — Blocklist Management

### US-008: Create popup UI for managing the blocklist
**Priority:** 3
**Description:** As a user, I want a popup UI where I can view, add, and remove domains from my blocklist.

**Acceptance Criteria:**
- [ ] `popup.html` with associated `popup.js` and `popup.css`
- [ ] Displays current blocklist as a list with remove buttons per domain
- [ ] Text input + "Add" button to add a new domain (uses domain normalization from US-007)
- [ ] Adding a domain sends `ADD_DOMAIN` message to service worker, which updates storage and syncs rules
- [ ] Removing a domain sends `REMOVE_DOMAIN` message to service worker, which updates storage and syncs rules
- [ ] List updates immediately after add/remove
- [ ] Shows validation error for invalid domain input
- [ ] Clean, functional CSS styling

---

### Phase 4: WebAuthn Registration

### US-009: Implement CBOR decoding and base64url utilities
**Priority:** 4
**Description:** As a developer, I want CBOR decoding and base64url helpers in `lib/webauthn.js` so attestation objects can be parsed for AAGUID extraction.

**Acceptance Criteria:**
- [ ] Vendor minified `cbor-web` (~6KB) as `lib/cbor.js` (zero build tooling approach) OR bundle via esbuild
- [ ] `base64urlEncode(buffer)` — converts ArrayBuffer/Uint8Array to base64url string
- [ ] `base64urlDecode(string)` — converts base64url string to Uint8Array
- [ ] CBOR decode used to parse `attestationObject` from registration response
- [ ] AAGUID extracted from authenticator data (bytes 37–52 of authData)

### US-010: Implement hardware key registration with four enforcement layers
**Priority:** 4
**Description:** As a user, I want to register my hardware security key so only a physical key (not Touch ID/Windows Hello) can unlock sites.

**Acceptance Criteria:**
- [ ] `registerCredential()` function in `lib/webauthn.js`
- [ ] Layer 1: `authenticatorAttachment: "cross-platform"` — blocks platform authenticators
- [ ] Layer 2: `hints: ["security-key"]` — Chrome 129+ UI hint for security key flow
- [ ] Layer 3: After credential creation, calls `getTransports()` and rejects if transports include `"hybrid"` or `"internal"`; accepts `"usb"`, `"nfc"`, `"ble"`; accepts empty array with a warning
- [ ] Layer 4: `attestation: "direct"` — extracts AAGUID from attestation object
- [ ] `userVerification: "discouraged"` on create (no PIN prompt, speed up flow)
- [ ] Challenge generated locally with `crypto.getRandomValues()`
- [ ] On success, stores to `chrome.storage.local` via storage module: `credentialId`, `publicKeySpki` (DER-encoded public key), `transports`, `signCount`, `aaguid`, `createdAt`
- [ ] Public key exported as SPKI DER format using `crypto.subtle.exportKey("spki", ...)`
- [ ] `importPublicKey(spkiBytes)` — detects ES256 vs RS256 from SPKI bytes (try ES256 first with P-256/SHA-256, fall back to RS256 with RSASSA-PKCS1-v1_5/SHA-256)

### US-011: Add registration UI to popup
**Priority:** 4
**Description:** As a user, I want to register my hardware key from the popup so I can set up the extension.

**Acceptance Criteria:**
- [ ] Popup shows "No security key registered" state with a "Register Security Key" button when no credential exists
- [ ] Popup shows "Security key registered" state with key info (AAGUID, date registered) and a "Remove Key" button when credential exists
- [ ] Clicking "Register" calls `registerCredential()` and updates UI on success
- [ ] Shows clear error messages if registration fails (e.g., user cancelled, non-hardware key detected)
- [ ] "Remove Key" clears credential from storage (with confirmation prompt)
- [ ] Unlock button on blocked page remains disabled until a key is registered

---

### Phase 5: WebAuthn Unlock Flow

### US-012: Implement client-side signature verification
**Priority:** 5
**Description:** As a developer, I want to verify WebAuthn assertion signatures client-side so unlocks are cryptographically validated without a server.

**Acceptance Criteria:**
- [ ] `verifyWithCredential(credentialData)` function in `lib/webauthn.js`
- [ ] Generates fresh challenge with `crypto.getRandomValues()`
- [ ] Calls `navigator.credentials.get()` with stored credential ID as `allowCredentials`, `userVerification: "discouraged"`
- [ ] Reconstructs the signed data: SHA-256 hash of `clientDataJSON` concatenated with `authenticatorData`
- [ ] Verifies signature using `crypto.subtle.verify()` with stored SPKI public key
- [ ] Enforces sign counter monotonicity: rejects if new counter <= stored counter (detects cloned authenticator), updates stored counter on success
- [ ] Returns verified domain unlock result on success

### US-013: Wire up unlock flow end-to-end
**Priority:** 5
**Description:** As a user, when I tap my security key on the blocked page I want the site to temporarily unlock and automatically re-lock after 30 minutes.

**Acceptance Criteria:**
- [ ] "Unlock with Security Key" button on `blocked.html` is enabled when a credential is registered
- [ ] Clicking the button triggers `navigator.credentials.get()` — user taps hardware key
- [ ] On successful verification, `blocked.js` sends `UNLOCK_DOMAIN` message to service worker
- [ ] Service worker calls `unlockDomain(domain)` to add high-priority allow rule
- [ ] Service worker creates a `chrome.alarm` with the configured duration (default 30 minutes)
- [ ] Service worker stores unlock record in `unlocks` storage
- [ ] User is redirected to `https://<domain>` after unlock
- [ ] When alarm fires, service worker calls `relockDomain(domain)`, removes unlock record, and the domain is blocked again
- [ ] Unlock duration is configurable via settings (default 30 min)

---

### Phase 6: Polish and Edge Cases

### US-014: Add error handling and edge case coverage
**Priority:** 6
**Description:** As a user, I want the extension to handle errors gracefully and cover edge cases so it doesn't break unexpectedly.

**Acceptance Criteria:**
- [ ] Blocked page handles missing/invalid `domain` query parameter gracefully
- [ ] Service worker handles storage read/write failures with appropriate error messages
- [ ] WebAuthn registration handles user cancellation (NotAllowedError) with a friendly message
- [ ] WebAuthn verification handles user cancellation gracefully
- [ ] Duplicate domain additions are silently ignored (no duplicate entries in blocklist)
- [ ] Adding a domain that is currently unlocked triggers re-lock
- [ ] Removing a domain that is currently unlocked cleans up the allow rule and alarm
- [ ] `onStartup` properly cleans up stale unlocks (e.g., alarm missed while browser was closed)

### US-015: Polish UI and styling
**Priority:** 6
**Description:** As a user, I want a clean, polished UI for both the popup and blocked page.

**Acceptance Criteria:**
- [ ] Popup has consistent, clean styling with appropriate spacing and typography
- [ ] Blocked page is visually clear and not intimidating — reinforces that this is self-discipline, not punishment
- [ ] Blocked page shows the domain prominently
- [ ] Loading/disabled states for buttons during async operations (registration, verification)
- [ ] Success/error feedback messages are visible and auto-dismiss
- [ ] Responsive layout that works well at popup dimensions (~350px wide)
- [ ] Proper extension icons (replace placeholders from US-003 if needed)

### US-016: Add unlock duration setting to popup
**Priority:** 6
**Description:** As a user, I want to configure how long a site stays unlocked after I tap my key.

**Acceptance Criteria:**
- [ ] Settings section in popup with unlock duration control
- [ ] Dropdown or input for duration (options: 5, 15, 30, 60 minutes, or custom)
- [ ] Setting persists in `chrome.storage.local` under `settings.unlockDurationMinutes`
- [ ] New unlocks use the configured duration
- [ ] Existing unlocks are not affected by changing the setting
