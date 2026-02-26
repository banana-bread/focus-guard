## Codebase Patterns
- Chrome extension project using Manifest V3, no build step, ES modules
- Extension root is /Users/adriano/code/focus-guard/
- Lib modules go in lib/ directory
- Icons in icons/ directory
- Alarm names use "relock:<domain>" convention
- onMessage handler returns true and uses async wrapper for sendResponse
- Unlock records store { unlockedAt, expiresAt }
- popup.js uses GET_STATE (not GET_BLOCKLIST) to load all state in one call
- blocked.js is now a module script (type="module"); can import from lib/ directly

---

## 2026-02-26 - US-001
- Created manifest.json with MV3, declarativeNetRequest/storage/alarms permissions, host_permissions <all_urls>, service worker with type: "module", web_accessible_resources for blocked.html, stable key field
- Created placeholder stubs: service-worker.js, popup.html, blocked.html
- Generated placeholder shield icons at 16/48/128px
- Files changed: manifest.json, service-worker.js, popup.html, blocked.html, icons/icon-{16,48,128}.png
- **Learnings for future iterations:**
  - Project starts from scratch - no existing code patterns to follow yet
  - Icons generated via Python script as minimal valid PNGs with shield shape
---

## 2026-02-26 - US-002
- Implemented lib/storage.js with all required async functions wrapping chrome.storage.local
- Functions: getBlocklist, setBlocklist, getCredential, setCredential, clearCredential, getUnlocks, setUnlock, removeUnlock, getSettings, updateSettings
- Default values: blocklist [], credential null, unlocks {}, settings { unlockDurationMinutes: 30 }
- Files changed: lib/storage.js
- **Learnings for future iterations:**
  - Storage module uses private get/set helpers to reduce repetition
  - Defaults are defined in a single DEFAULTS object at the top
---

## 2026-02-26 - US-003
- Added placeholder shield icons at 16px, 48px, and 128px in icons/ directory
- Icons are blue shield shape on transparent background, generated as valid PNGs
- manifest.json already had correct references from US-001
- Files changed: icons/icon-16.png, icons/icon-48.png, icons/icon-128.png
- **Learnings for future iterations:**
  - Python struct+zlib approach works well for generating simple PNG icons without dependencies
  - Icons directory wasn't created by US-001 despite progress notes saying so - always verify files exist
---

## 2026-02-26 - US-004
- Implemented lib/blocker.js with declarativeNetRequest dynamic rule management
- syncBlockRules(blocklist, unlocks) — rebuilds block redirect rules, skipping unlocked domains
- unlockDomain(domain) — adds priority-2 allow rule (IDs 10001–19999)
- relockDomain(domain) — removes allow rule by matching urlFilter
- Block rules use priority 1, IDs 1–9999, redirect to blocked.html?domain=<domain>
- Files changed: lib/blocker.js
- **Learnings for future iterations:**
  - Block rules use urlFilter `||domain/` pattern for domain+subdomain matching
  - Allow rules have higher priority (2) than block rules (1) to override them
  - Rule IDs are partitioned: 1–9999 for blocks, 10001–19999 for allows
---

## 2026-02-26 - US-005
- Implemented service-worker.js with all event listeners registered synchronously at top level
- onInstalled: sets default blocklist and syncs rules; preserves existing blocklist if present
- onStartup: cleans up expired unlocks, then syncs rules
- onAlarm: re-locks domains when "relock:<domain>" alarms fire
- onMessage: routes GET_BLOCKLIST, ADD_DOMAIN, REMOVE_DOMAIN, UNLOCK_DOMAIN, GET_STATE
- Uses chrome.alarms for re-lock timers with configurable duration from settings
- Files changed: service-worker.js
- **Learnings for future iterations:**
  - onMessage listener must return true for async sendResponse; uses wrapper pattern with handleMessage()
  - Alarm names use "relock:<domain>" convention for domain identification
  - Unlock records store { unlockedAt, expiresAt } for expiry checking on startup
---

## 2026-02-26 - US-006
- Created blocked.html with clean centered layout showing blocked domain info
- blocked.js reads `domain` query parameter and displays "{domain} is blocked by Focus Guard"
- "Unlock with Security Key" button present but disabled (for future phases)
- Handles missing domain parameter gracefully
- Files changed: blocked.html, blocked.js
- **Learnings for future iterations:**
  - blocked.js is a separate file (not inline script) for CSP compliance
  - Unlock button uses disabled attribute + CSS opacity for disabled state
---

## 2026-02-26 - US-007
- Implemented lib/normalize.js with normalizeDomain() utility function
- Strips protocol (http/https), www. prefix, paths, query strings, hash, ports
- Lowercases and validates (must contain dot, no spaces)
- Returns null for invalid input
- Files changed: lib/normalize.js
- **Learnings for future iterations:**
  - Domain normalization is a standalone module in lib/normalize.js for reuse by popup and other consumers
---

## 2026-02-26 - US-008
- Created popup.html, popup.js, popup.css for managing the blocklist
- Displays current blocklist with remove buttons (× character)
- Text input + Add button with domain normalization from lib/normalize.js
- Sends ADD_DOMAIN/REMOVE_DOMAIN messages to service worker, re-renders list from response
- Enter key support on input, validation error for invalid domains
- Files changed: popup.html, popup.js, popup.css
- **Learnings for future iterations:**
  - popup.js uses type="module" script tag to import from lib/normalize.js
  - List re-renders from the service worker response to stay in sync with actual state
  - Chrome extension popups need explicit width set on body (320px)
---

## 2026-02-26 - US-009
- Implemented minimal CBOR decoder in lib/cbor.js (~60 lines) supporting unsigned/negative ints, byte/text strings, arrays, maps, and simple values
- Created lib/webauthn.js with base64urlEncode(), base64urlDecode(), and extractAAGUID() functions
- AAGUID extracted from bytes 37–52 of authData, formatted as UUID string
- Files changed: lib/cbor.js, lib/webauthn.js
- **Learnings for future iterations:**
  - Wrote minimal CBOR decoder instead of vendoring cbor-web (which bundles buffer/stream polyfills and is too large)
  - CBOR major types: 0=uint, 1=negint, 2=bytes, 3=text, 4=array, 5=map, 7=simple
  - WebAuthn authData layout: rpIdHash(32) + flags(1) + signCount(4) + aaguid(16) + ...
---

## 2026-02-26 - US-010
- Implemented registerCredential() in lib/webauthn.js with four enforcement layers
- Layer 1: authenticatorAttachment: "cross-platform" blocks platform authenticators
- Layer 2: hints: ["security-key"] for Chrome 129+ UI
- Layer 3: Post-creation transport check rejects "hybrid" and "internal" transports
- Layer 4: attestation: "direct" enables AAGUID extraction
- Implemented importPublicKey(spkiBytes) — tries ES256 (P-256) first, falls back to RS256
- Public key exported as SPKI DER via response.getPublicKey(), stored as base64url
- Credential data stored via storage module: credentialId, publicKeySpki, transports, signCount, aaguid, createdAt
- Files changed: lib/webauthn.js
- **Learnings for future iterations:**
  - response.getPublicKey() returns SPKI DER directly (no need for crypto.subtle.exportKey)
  - response.getAuthenticatorData() gives raw authData for sign count extraction
  - Sign count is at bytes 33–36 of authData (after rpIdHash + flags)
  - Transport validation happens after credential creation since getTransports() is only available on the response
---

## 2026-02-26 - US-011
- Added security key registration UI to popup with register/remove functionality
- Popup shows "No security key registered" + Register button when no credential exists
- Popup shows "Security key registered" with AAGUID, date, and Remove Key button when credential exists
- Registration calls registerCredential() from lib/webauthn.js, handles errors (NotAllowedError = user cancelled)
- Remove Key requires confirmation prompt, then sends CLEAR_CREDENTIAL to service worker
- Updated service-worker.js: GET_STATE now returns credential, added CLEAR_CREDENTIAL handler
- Updated blocked.js: unlock button enabled only when credential is registered (checks via GET_STATE)
- Files changed: popup.html, popup.js, popup.css, service-worker.js, blocked.js
- **Learnings for future iterations:**
  - popup.js uses loadState() calling GET_STATE (instead of GET_BLOCKLIST) to get both blocklist and credential in one call
  - CLEAR_CREDENTIAL message type added to service worker for credential removal
  - blocked.js uses chrome.runtime.sendMessage callback (not async) since it's not a module script
---

## 2026-02-26 - US-013
- Wired up the full unlock flow: blocked page → verifyWithCredential() → UNLOCK_DOMAIN message → redirect
- Converted blocked.js from plain script to ES module (`type="module"`) to import verifyWithCredential from lib/webauthn.js
- Added click handler on unlock button: disables button during verification, shows status messages on error
- On successful verification, sends UNLOCK_DOMAIN to service worker then redirects to `https://<domain>`
- Added status message element to blocked.html for error feedback
- Service worker already had UNLOCK_DOMAIN handler, alarm creation, and relock logic from US-005
- Files changed: blocked.html, blocked.js
- **Learnings for future iterations:**
  - blocked.js is now a module script — can import from lib/ directly since blocked.html loads via chrome-extension:// origin
  - chrome.runtime.sendMessage works with promises in module context (no need for callback pattern anymore)
  - The service worker UNLOCK_DOMAIN handler was already complete from US-005 — this story was mainly about the blocked page client-side wiring
---

## 2026-02-26 - US-012
- Implemented verifyWithCredential() in lib/webauthn.js for client-side WebAuthn assertion verification
- Generates fresh challenge, calls navigator.credentials.get() with stored credential ID
- Reconstructs signed data: authenticatorData + SHA-256(clientDataJSON)
- Verifies signature via crypto.subtle.verify() with stored SPKI public key
- Detects ES256 vs RS256 from imported key's algorithm name
- Enforces sign counter monotonicity (rejects if new counter <= stored, unless counter is 0)
- Updates stored sign count on success
- Files changed: lib/webauthn.js
- **Learnings for future iterations:**
  - WebAuthn signed data = authenticatorData || SHA-256(clientDataJSON), NOT raw clientDataJSON
  - Sign counter of 0 means the authenticator doesn't support counters — skip monotonicity check in that case
  - crypto.subtle.verify needs different algorithm objects for ECDSA ({name, hash}) vs RSA ({name} only)
  - Added getCredential import to webauthn.js for reading stored credential during verification
---

## 2026-02-26 - US-014
- Added try/catch wrappers to onInstalled, onStartup, and onAlarm handlers with console.error logging for storage failures
- ADD_DOMAIN now re-locks domain if currently unlocked (removes allow rule, unlock record, and alarm)
- REMOVE_DOMAIN now cleans up allow rule, unlock record, and alarm if domain was unlocked
- onStartup cleanup now also clears stale alarms for expired unlocks
- All other acceptance criteria (missing domain param, WebAuthn cancellation, duplicate domains) were already handled
- Files changed: service-worker.js
- **Learnings for future iterations:**
  - Most error handling was already in place from earlier stories — the main gaps were unlock cleanup on add/remove domain
  - chrome.alarms.clear(name) cleans up a specific alarm by name
  - The onMessage handler already had .catch() error propagation via sendResponse
---

## 2026-02-26 - US-015
- Polished popup UI: wider (350px), subtle background, input focus states, smooth transitions, status dot indicators for key state
- Polished blocked page: encouraging "Taking a breather" tone, gradient background, softer card shadow, domain shown prominently in blue
- Added auto-dismissing success/error feedback messages with CSS fade animation
- Added loading/disabled states for Add button during async operations
- Added "Blocked sites" label and empty state message for blocklist
- Generated improved shield icons at 16/48/128px with blue gradient
- Added icon to popup header
- Files changed: popup.html, popup.css, popup.js, blocked.html, blocked.js, icons/icon-{16,48,128}.png
- **Learnings for future iterations:**
  - CSS `animationend` event + class toggle works well for auto-dismiss feedback without JS timers for the fade itself
  - `#blocklist:empty::after` pseudo-element is a clean way to show empty state without JS
  - Blocked page uses `chrome-extension://` origin so it can reference icons/ directly
---

## 2026-02-26 - US-016
- Added unlock duration settings section to popup with dropdown (5, 15, 30, 60 min) and custom option
- Added UPDATE_SETTINGS message handler to service worker
- Settings persist via chrome.storage.local through existing updateSettings() in lib/storage.js
- GET_STATE already returned settings, so no change needed there
- Existing unlocks are not affected by changing the setting (only new unlocks use the new duration)
- Files changed: popup.html, popup.js, popup.css, service-worker.js
- **Learnings for future iterations:**
  - GET_STATE already returned settings from earlier stories — always check what's already available before adding new message types
  - updateSettings() in lib/storage.js merges partial updates, so only changed keys need to be sent
  - Custom duration uses an input[type=number] with min/max validation for simplicity
---
