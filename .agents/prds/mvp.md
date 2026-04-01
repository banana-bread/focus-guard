# Focus Guard — MVP Product Requirements Document

**Version:** 1.0  
**Branch:** `rewrite/vsa-typescript`  
**Date:** 2026-04-01  
**Status:** Active

---

## 1. Executive Summary

Focus Guard is a Chromium MV3 browser extension that blocks distracting websites and requires a physical hardware security key (YubiKey/FIDO2/WebAuthn) to temporarily unlock them. The core mechanic is deliberate friction: impulsive access to blocked sites demands a conscious physical action — touching a hardware key — making it impossible to mindlessly open a distraction on autopilot.

The extension is entirely client-side. There are no servers, no accounts, no cloud sync. All state lives in `chrome.storage.local`. The service worker is the sole trust boundary; all security decisions are made there. The UI (popup and blocked page) is a thin rendering layer that sends messages and displays responses.

This rewrite exists to fix a critical security bug in the original vanilla JS version (domains could be removed without authentication), add TypeScript type safety, establish a proper build pipeline with Vite, and introduce a clean Vertical Slice Architecture (VSA) that scales without god-files.

---

## 2. Mission

**Mission Statement:** Make self-discipline easy to enforce and impossible to circumvent without deliberate effort — no servers, no accounts, just hardware friction.

**Core Principles:**

1. **Hardware as the gate** — Unlocking any blocked domain requires a physical touch on a registered FIDO2 key. Software-only bypasses are not possible by design.
2. **Service worker as truth** — All state mutations, security checks, and business logic live in the service worker. UI contexts are display-only.
3. **No implicit trust** — Removing a domain, clearing a credential, and unlocking all require WebAuthn verification. No destructive action is unauthenticated.
4. **Per-domain independence** — Each domain has its own unlock session, timer, and expiry. Unblocking reddit.com has zero effect on youtube.com.
5. **Zero external dependencies** — No runtime npm packages. No CDN. No analytics. Client-side only, forever auditable.

---

## 3. Target Users

**Primary Persona: The Self-Disciplined Developer / Knowledge Worker**

- Technically comfortable — they know what a YubiKey is, own one, and use it for SSH/GitHub/2FA
- Struggling with chronic distraction from social media, news, video sites during focus blocks
- Has tried blockers before (Cold Turkey, LeechBlock) but found software-only solutions too easy to bypass
- Values privacy — no accounts, no telemetry, no cloud
- Uses Brave or Chrome on macOS or Windows

**Key Needs:**
- Block sites that are genuinely hard to unblock impulsively
- Per-site granularity — they may want reddit blocked but not YouTube
- Short unlock windows (15–30 min) that automatically re-lock
- Confidence that the extension can't be trivially defeated by opening devtools or the popup

**Pain Points:**
- Existing blockers are too easy to disable (browser extension toggle, incognito mode, etc.)
- Password-based blockers can be bypassed by pasting a saved password
- No hardware-backed blocker exists for browsers

---

## 4. MVP Scope

### Core Functionality

| Feature | Status |
|---|---|
| ✅ Add domains to the blocklist | In scope |
| ✅ Remove domains from the blocklist (requires WebAuthn) | In scope |
| ✅ Block HTTP and HTTPS traffic via `declarativeNetRequest` | In scope |
| ✅ Redirect blocked domains to a custom blocked page | In scope |
| ✅ Register a FIDO2/WebAuthn hardware credential | In scope |
| ✅ Unlock a domain via WebAuthn assertion | In scope |
| ✅ Per-domain unlock sessions with independent expiry | In scope |
| ✅ Per-domain unlock duration override at unlock time | In scope |
| ✅ Re-lock via `chrome.alarms` (survives browser restarts) | In scope |
| ✅ Countdown timer on blocked page (updates every second) | In scope |
| ✅ Auto-refresh blocked page UI when timer hits zero (no reload) | In scope |
| ✅ Clear/replace registered credential (requires WebAuthn) | In scope |
| ✅ Global default unlock duration setting | In scope |
| ❌ Multi-device sync | Deferred |
| ❌ Firefox support | Deferred |
| ❌ DNS/network-level blocking | Deferred |
| ❌ Scheduled block windows (e.g. block only 9am–5pm) | Deferred |
| ❌ Multiple hardware key registration | Deferred |
| ❌ Block categories / preset lists | Deferred |

### Technical

| Item | Status |
|---|---|
| ✅ TypeScript strict mode, no implicit `any` | In scope |
| ✅ Vite build pipeline | In scope |
| ✅ Typed discriminated union message protocol | In scope |
| ✅ Vertical Slice Architecture | In scope |
| ✅ Vitest unit + integration tests | In scope |
| ✅ File size limit ~300 lines (split by responsibility) | In scope |
| ❌ E2E browser automation tests | Deferred |
| ❌ CI/CD pipeline | Deferred |

---

## 5. User Stories

### US-001 — Register Hardware Key
**As a** first-time user,  
**I want to** register my YubiKey with the extension,  
**so that** I have a hardware-backed credential that gates all future security operations.

- User opens popup, sees "No key registered" state
- Clicks "Register Key" → service worker creates a WebAuthn registration challenge
- Browser WebAuthn dialog appears; user touches their YubiKey
- Credential (ID, public key, sign counter) stored in `chrome.storage.local`
- Popup reflects "Key registered" state

### US-002 — Add Domain to Blocklist
**As a** user,  
**I want to** add a domain (e.g. `reddit.com`) to my blocklist,  
**so that** navigating to that site is blocked immediately.

- User types domain in popup input field, presses Enter or clicks Add
- Service worker normalizes domain, adds `declarativeNetRequest` block rule
- Domain appears in popup list; navigating to reddit.com shows blocked page

### US-003 — Unlock a Blocked Domain
**As a** user who needs to access a blocked site for a legitimate reason,  
**I want to** unlock a domain for a set duration by touching my YubiKey,  
**so that** I can access it temporarily without permanently removing it from the blocklist.

- On blocked page, user clicks "Unlock"
- User can optionally change duration (default: global setting, e.g. 30 min)
- Service worker issues a single-use challenge (2-min TTL)
- Browser WebAuthn dialog; user touches key
- Service worker verifies assertion, adds temporary allow rule, sets `chrome.alarms` re-lock timer
- Blocked page updates to show unlock countdown

### US-004 — Countdown Timer on Blocked Page
**As a** user whose session on a blocked domain is active,  
**I want to** see a live countdown of how much time remains,  
**so that** I can manage my time and know when the site will re-lock.

- Blocked page renders a countdown (`MM:SS`) that updates every second via `setInterval`
- When timer hits zero, UI transitions to locked state without a page reload
- Timer reflects the actual expiry stored in the service worker (polled or pushed via message)

### US-005 — Per-Domain Unlock Duration Override
**As a** user unlocking a domain,  
**I want to** choose "unlock for 15 minutes" instead of the default,  
**so that** I can calibrate friction per task without changing the global default.

- Unlock UI presents a duration selector (e.g. 5 / 15 / 30 / 60 min, or custom)
- Selected duration is sent with the unlock request message
- Service worker uses this duration for that unlock session; global default unchanged

### US-006 — Remove Domain from Blocklist
**As a** user,  
**I want to** permanently remove a domain from my blocklist,  
**so that** I no longer need to use a hardware key to access it.

- User clicks × next to a domain in popup
- Service worker issues a challenge; user touches YubiKey to confirm
- Domain is removed from blocklist and `declarativeNetRequest` rules are updated
- Domain no longer appears in popup list

### US-007 — Replace Registered Credential
**As a** user who has lost or replaced their YubiKey,  
**I want to** register a new credential after verifying with the old one (or via a recovery flow),  
**so that** I maintain access to my blocked sites configuration.

- User opens Settings in popup, clicks "Replace Key"
- Service worker issues assertion challenge against existing credential
- After verification, initiates new registration flow
- New credential replaces old one in storage

### US-008 — Re-lock on Alarm Expiry
**As a** user,  
**I want** unlocked domains to automatically re-lock when the timer expires,  
**so that** I don't need to manually re-lock and unlock sessions don't persist indefinitely.

- Service worker handles `chrome.alarms` event keyed by domain (e.g. `relock:reddit.com`)
- On alarm: removes temporary allow rule, clears unlock session from storage
- If blocked page is open for that domain, it transitions to locked state

---

## 6. Core Architecture & Patterns

### Vertical Slice Architecture

Each feature is a self-contained slice. Slices own their messages, their storage keys, their service worker handler, and their UI fragment. Cross-slice communication happens only through the message protocol defined in `core/messages.ts`.

```
focus-guard/
├── core/                        # Universal infrastructure
│   ├── messages.ts              # All message types (discriminated unions)
│   ├── storage.ts               # Storage abstraction + key constants
│   ├── config.ts                # Extension-wide constants (RP ID, AAGUID list, etc.)
│   └── logger.ts                # Structured JSON logger (context injection, trace_id, test suppression)
├── shared/                      # Utilities used by 3+ slices
│   ├── crypto.ts                # WebAuthn helpers, challenge generation, assertion verify
│   └── domain.ts                # Domain normalization (strip www, scheme, path)
├── blocklist/                   # Add/remove domains, sync declarativeNetRequest rules
│   ├── blocklist.service.ts     # Business logic
│   ├── blocklist.storage.ts     # Storage r/w for blocklist
│   ├── blocklist.rules.ts       # declarativeNetRequest rule builder
│   └── blocklist.handler.ts     # Message handler (registered in service worker)
├── unlock/                      # WebAuthn challenge/assertion flow, unlock sessions
│   ├── unlock.service.ts
│   ├── unlock.storage.ts
│   ├── unlock.challenge.ts      # In-memory challenge store (Map, 2-min TTL)
│   └── unlock.handler.ts
├── settings/                    # Global defaults (unlock duration)
│   ├── settings.service.ts
│   ├── settings.storage.ts
│   └── settings.handler.ts
├── credential/                  # Registration and management of WebAuthn credential
│   ├── credential.service.ts
│   ├── credential.storage.ts
│   └── credential.handler.ts
├── popup/                       # Popup UI
│   ├── popup.html
│   ├── popup.ts
│   └── popup.css
├── blocked/                     # Blocked page UI + countdown timer
│   ├── blocked.html
│   ├── blocked.ts
│   └── blocked.css
└── service-worker.ts            # Entry point — registers all slice handlers
```

### Key Patterns

- **Message Protocol:** All `chrome.runtime.sendMessage` calls use typed discriminated unions from `core/messages.ts`. No stringly-typed messages anywhere.
- **Handler Registration:** Each slice exports a `handleMessage(msg, sendResponse)` function. `service-worker.ts` fans out to the correct handler based on `msg.type`.
- **Storage Abstraction:** All reads/writes go through `core/storage.ts`. No slice calls `chrome.storage.local` directly.
- **In-Memory Challenge Store:** Challenges are stored in a `Map<string, Challenge>` in service worker memory (never persisted). A challenge is keyed by domain and expires after 2 minutes.
- **Alarm Naming Convention:** Re-lock alarms are named `relock:<domain>` (e.g. `relock:reddit.com`).

---

## 7. Feature Specifications

### 7.1 Blocklist Management

**Add Domain:**
- Input: raw string (user types `reddit.com`, `www.reddit.com`, `https://reddit.com/r/...`)
- Normalization: strip scheme, strip `www.`, strip path → `reddit.com`
- Duplicate check before adding
- `declarativeNetRequest` block rule added with `redirect` action pointing to `blocked.html?domain=<domain>`

**Remove Domain:**
- Requires WebAuthn assertion (full challenge/verify flow)
- Removes block rule and any temporary allow rule
- Cancels active `relock:<domain>` alarm if present
- Clears any active unlock session in storage

### 7.2 WebAuthn Flow

**Registration:**
```
popup → GET_REGISTRATION_CHALLENGE → service worker
service worker → creates PublicKeyCredentialCreationOptions (cross-platform, attestation=direct)
service worker → returns challenge to popup
popup → navigator.credentials.create(options)
popup → REGISTER_CREDENTIAL { attestation } → service worker
service worker → verifies attestation, extracts public key + AAGUID
service worker → checks AAGUID against allowlist
service worker → stores { credentialId, publicKey, signCounter, aaguid }
```

**Assertion (unlock / remove / replace):**
```
popup/blocked → GET_ASSERTION_CHALLENGE { domain?, operation } → service worker
service worker → creates challenge, stores in memory Map with 2-min TTL
service worker → returns { challenge, credentialId, rpId }
UI → navigator.credentials.get(options)
UI → VERIFY_ASSERTION { assertion, domain?, operation } → service worker
service worker → retrieves + invalidates challenge (single-use)
service worker → verifies signature against stored public key
service worker → checks sign counter > stored value (clone detection)
service worker → updates sign counter
service worker → executes operation (unlock/remove/replace)
```

**Hardware Enforcement:**
- `authenticatorAttachment: "cross-platform"` in all calls
- Transport filter: reject `"internal"` and `"hybrid"` transports on assertion response
- AAGUID allowlist checked at registration time (configurable in `core/config.ts`)

### 7.3 Unlock Sessions

**Storage Schema:**
```typescript
// chrome.storage.local key: "unlock_sessions"
type UnlockSessions = {
  [domain: string]: {
    expiresAt: number;  // Unix ms
    duration: number;   // ms — for display purposes
  };
};
```

**Unlock Flow:**
1. Verify assertion (see above)
2. Compute `expiresAt = Date.now() + durationMs`
3. Add `declarativeNetRequest` allow rule for domain (higher priority than block rule)
4. Write session to `chrome.storage.local`
5. Create `chrome.alarms.create("relock:<domain>", { when: expiresAt })`

**Re-lock Flow (alarm handler):**
1. Remove temporary allow rule
2. Delete session from `chrome.storage.local`
3. Any open blocked page for the domain should poll or receive a push message to update UI

### 7.4 Countdown Timer

- `blocked.ts` reads `?domain=` query param on load
- Sends `GET_UNLOCK_SESSION { domain }` to service worker
- If session exists: starts `setInterval(tick, 1000)`
- Each tick: recomputes `remaining = session.expiresAt - Date.now()`
- If `remaining <= 0`: clears interval, transitions UI to locked state (no reload)
- Format: `MM:SS` with leading zeros

### 7.5 Settings

- **Global default unlock duration** — stored in `chrome.storage.local` under `settings`
- Default value: `30` minutes
- Settable via popup Settings panel
- Per-unlock override: duration selector in unlock modal (options: 5 / 15 / 30 / 60 / custom minutes)

---

## 8. Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.x (strict mode) |
| Bundler | Vite 5.x |
| Testing | Vitest 2.x |
| Runtime | Chromium MV3 (Chrome 120+, Brave) |
| Storage | `chrome.storage.local` |
| Networking/Blocking | `declarativeNetRequest` |
| Timers | `chrome.alarms` |
| Auth | WebAuthn (`navigator.credentials`) |
| UI | Vanilla TypeScript + HTML + CSS |
| Runtime deps | **None** |

**Build-time dev dependencies only:**
- `typescript`
- `vite`
- `vitest`
- `@types/chrome`

---

## 9. Logging

### Philosophy

Logs are optimized for AI consumption. Every log entry must include enough context for an LLM to understand and fix an issue without human intervention. This means structured objects over strings, specific event names over vague labels, and `fix_suggestion` fields on every error/warn.

### Setup

All files import the shared logger from `core/logger.ts`:

```typescript
import { logger } from '@/core/logger';
```

The logger wraps `console` with structured JSON output and auto-injects a `context` field (e.g. `service_worker`, `popup`, `blocked_page`).

### Log Levels

| Level | When to use |
|---|---|
| `error` | Security failures, unrecoverable errors |
| `warn` | Recoverable problems (retry, fallback) |
| `info` | Business events, state transitions |
| `debug` | Entry/exit of complex operations, variable states |

### Required Rules

**1. Structured objects only — no string interpolation:**
```typescript
logger.info('domain_unlocked', { domain, duration_ms: 3_600_000, method: 'webauthn' }); // ✅
logger.info(`Unlocked ${domain}`); // ❌
```

**2. Event names are `snake_case` and answer "what happened?"**
- Good: `challenge_created`, `credential_verified`, `domain_blocked`, `unlock_session_expired`
- Bad: `done`, `success`, `error`, `update`

**3. Always include `trace_id`** when logging across message-passing boundaries (popup → service worker → blocked page). Pass `trace_id` through `chrome.runtime.sendMessage` payloads.

**4. Errors include full context + `fix_suggestion`:**
```typescript
logger.error('assertion_verification_failed', {
  domain,
  trace_id,
  error: err instanceof Error ? err.message : String(err),
  fix_suggestion: 'Check rpIdHash and origin match; verify sign counter is monotonically increasing',
});
```

**5. Never log sensitive data** — no private keys, raw assertions, credentials, or tokens.

**6. Never silently catch exceptions** — always log with context or re-throw.

### Chrome Extension Context Rules

Every log entry must include:

| Field | Values |
|---|---|
| `context` | `service_worker` \| `popup` \| `blocked_page` \| `content_script` |
| `tab_id` | Required for per-tab operations (blocking, unlocking) |
| `trace_id` | Required for cross-boundary message round-trips |

**Service worker logs are ephemeral** — the SW can be killed after 30s idle. For logs that must survive restarts, persist them to `chrome.storage.local`.

### Canonical Log Patterns

**Message handling in service worker:**
```typescript
logger.debug('message_received', { type: msg.type, trace_id, tab_id });
// ... handle ...
logger.info('message_handled', { type: msg.type, trace_id, duration_ms });
```

**WebAuthn flows (log entry + exit for all security-critical paths):**
```typescript
logger.info('webauthn_challenge_created', { domain, trace_id, ttl_ms: 120_000 });
logger.info('webauthn_assertion_verified', { domain, trace_id, sign_counter });
```

**State transitions:**
```typescript
logger.info('unlock_session_started', { domain, trace_id, expires_at, duration_ms });
logger.info('unlock_session_expired', { domain, trace_id });
```

### `core/logger.ts` Deliverable

Phase 1 must produce `core/logger.ts` with:
- Structured JSON output wrapping `console`
- Auto-injected `context` based on calling environment
- `trace_id` propagation support
- Log level filtering (configurable via `core/config.ts`)
- No log output in Vitest environments (suppress via env flag)

---

## 10. Security & Configuration

### WebAuthn Configuration (`core/config.ts`)

```typescript
export const RP_ID = chrome.runtime.id; // extension origin
export const RP_NAME = "Focus Guard";
export const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes
export const AAGUID_ALLOWLIST: string[] = [
  // YubiKey 5 series, Security Key series
  "2fc0579f-8113-47ea-b116-bb5a8db9202a",
  // Add other trusted AAGUIDs
];
export const ALLOWED_TRANSPORTS: AuthenticatorTransport[] = ["usb", "nfc", "ble"];
export const REJECTED_TRANSPORTS: AuthenticatorTransport[] = ["internal", "hybrid"];
```

### Security Invariants

| Invariant | Enforcement Point |
|---|---|
| All destructive operations require WebAuthn | Service worker handler — no exceptions |
| Challenges are single-use | Deleted from Map on first retrieval |
| Challenges expire after 2 minutes | TTL checked on retrieval |
| Sign counter must be strictly increasing | Assertion verifier — reject and alert on violation |
| Only cross-platform authenticators accepted | `authenticatorAttachment: "cross-platform"` |
| `internal` and `hybrid` transports rejected | Post-assertion transport check |
| AAGUID must be on allowlist | Registration verifier |
| rpIdHash verified on every assertion | Assertion verifier |
| Origin verified on every assertion | Assertion verifier |

### Out-of-Scope Security

- Remote attestation validation (attestation stored and logged, but not verified against FIDO MDS in MVP)
- Protection against a malicious browser extension with higher privilege
- Incognito mode blocking (requires separate `incognito: split` manifest key — deferred)

---

## 11. Message Protocol

All messages are typed in `core/messages.ts` as discriminated unions.

```typescript
// Outbound (UI → Service Worker)
type RequestMessage =
  | { type: "GET_REGISTRATION_CHALLENGE" }
  | { type: "REGISTER_CREDENTIAL"; attestation: ArrayBuffer }
  | { type: "GET_ASSERTION_CHALLENGE"; operation: AssertionOperation; domain?: string }
  | { type: "VERIFY_ASSERTION"; assertion: ArrayBuffer; operation: AssertionOperation; domain?: string; durationMs?: number }
  | { type: "ADD_DOMAIN"; domain: string }
  | { type: "GET_BLOCKLIST" }
  | { type: "GET_UNLOCK_SESSION"; domain: string }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; settings: Partial<Settings> };

type AssertionOperation = "unlock" | "remove_domain" | "replace_credential";

// Inbound (Service Worker → UI)
type ResponseMessage =
  | { ok: true; data: unknown }
  | { ok: false; error: string };
```

---

## 12. Success Criteria

### MVP is complete when:

| Criterion | Type |
|---|---|
| ✅ A user can register a YubiKey and see confirmation in popup | Functional |
| ✅ Adding a domain blocks it immediately in the browser | Functional |
| ✅ Navigating to a blocked domain shows the custom blocked page | Functional |
| ✅ Touching YubiKey on the blocked page unlocks the domain for the selected duration | Functional |
| ✅ Blocked page shows a live countdown that transitions to locked UI at zero | Functional |
| ✅ Domain automatically re-locks after the timer expires (even if browser was closed) | Functional |
| ✅ Removing a domain from popup requires YubiKey touch | Security |
| ✅ Replacing credential requires YubiKey touch with old key | Security |
| ✅ Sign counter violation (cloned key) is detected and rejected | Security |
| ✅ Internal/hybrid authenticators are rejected | Security |
| ✅ All service worker message paths are covered by Vitest integration tests | Quality |
| ✅ No file exceeds 300 lines | Quality |
| ✅ TypeScript compiles with `strict: true`, zero errors | Quality |
| ✅ `vite build` produces a loadable extension | Build |

---

## 13. Implementation Phases

### Phase 1 — Project-Specific Core
**Goal:** Write the Focus Guard-specific infrastructure that all slices depend on. The scaffold (toolchain, linting, logger, Chrome mock, directory structure) is already complete — see `scaffold.md`.

- ✅ `core/messages.ts` — full typed message protocol (discriminated unions for all `chrome.runtime.sendMessage` types)
- ✅ `core/storage.ts` — storage abstraction + Focus Guard key constants (`credential`, `blocklist`, `unlock_sessions`, `settings`)
- ✅ `core/config.ts` — RP ID, AAGUID allowlist, challenge TTL, allowed/rejected transports
- ✅ `shared/domain.ts` — domain normalization (strip scheme, `www.`, path)
- ✅ `shared/crypto.ts` — challenge generation, CBOR parsing, assertion verification helpers
- ✅ `service-worker.ts` — entry point with message handler fan-out skeleton

**Validation:** `tsc --noEmit` clean; `vite build` succeeds; service worker loads in `brave://extensions` without errors.

### Phase 2 — Blocklist + Credential Slices
**Goal:** Core security flows — block domains, register key.

- ✅ `credential/` slice — registration flow end-to-end
- ✅ `blocklist/` slice — add domain, `declarativeNetRequest` rule sync
- ✅ Popup HTML/TS — minimal UI: register key, add domain, list domains
- ✅ `blocked/` HTML/TS — static blocked page with domain name display
- ✅ Integration tests for credential and blocklist handlers

**Validation:** User can register key, add domain, see it blocked in browser.

### Phase 3 — Unlock + Timer Slices
**Goal:** The unlock flow and per-domain session management.

- ✅ `unlock/` slice — challenge issuance, assertion verification, session write, alarm creation
- ✅ `blocked/` countdown timer — live `MM:SS`, auto-transition on expiry
- ✅ Per-domain unlock duration override in unlock UI
- ✅ Alarm handler for re-lock
- ✅ Integration tests for unlock handler

**Validation:** Full user journey works: block → navigate → unlock with YubiKey → countdown → auto re-lock.

### Phase 4 — Settings + Remove + Polish
**Goal:** Authenticated destructive operations, settings, and hardening.

- ✅ `settings/` slice — global default duration, settings UI
- ✅ Authenticated domain removal (WebAuthn challenge before × removes domain)
- ✅ Authenticated credential replacement
- ✅ AAGUID allowlist check at registration
- ✅ Transport filter check at assertion
- ✅ Sign counter monotonicity enforcement
- ✅ All file sizes within 300-line limit
- ✅ Final `vite build` verification

**Validation:** All MVP success criteria pass; extension loads cleanly on Brave.

---

## 14. Future Considerations

- **Multiple key registration** — Register a backup YubiKey; any registered key can perform operations
- **Scheduled block windows** — Block reddit only during work hours (9am–5pm weekdays)
- **Block categories** — Curated preset lists (social media, news, video)
- **Incognito support** — Extend blocking to incognito windows via manifest `incognito: split`
- **Remote attestation (FIDO MDS)** — Validate device authenticity against FIDO Alliance metadata service
- **Firefox support** — Requires MV2 compatibility layer or MV3 polyfill
- **Import/export blocklist** — JSON backup and restore
- **Emergency bypass** — Cryptographic time-locked override for genuine emergencies (e.g. TOTP-gated)

---

## 15. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `declarativeNetRequest` rule limits (MV3 caps at 5000 dynamic rules) | Low | High | Normalize domains aggressively; alert user when approaching limit; document the cap |
| Service worker termination clears in-memory challenge store | Medium | Medium | Challenges are short-lived (2 min); UI must re-request challenge if assertion takes too long; surface error gracefully |
| WebAuthn not available in extension context on some Chromium builds | Low | High | Feature-detect on startup; show clear error if unavailable; document minimum Chrome version |
| Sign counter regression (authenticator firmware bug) | Low | Medium | Log counter violations; provide a "trust this counter reset" escape hatch behind a second verification |
| User loses only registered YubiKey with no recovery | Medium | High | Warn at registration to note down credential ID; document recovery procedure (requires manual storage clear) |

---

## 16. Appendix

### Related Documents

- `.agents/prds/scaffold.md` — **Prerequisite.** Toolchain, linting, logger, Chrome mock. Must be complete before this PRD's Phase 1 begins.
- `vibe-planning-prompt.md` — Original planning context and requirements
- `CLAUDE.md` — Project coding rules and architecture reference
- `.agents/reference/vsa-patterns.md` — Vertical Slice Architecture pattern reference (local copy of the Rasmus Widing guide; canonical reference for `core/` vs `shared/` vs slice decision rules)
- **https://webauthn.guide/** — Primary WebAuthn implementation reference. **Required reading before implementing `shared/crypto.ts` or any assertion/registration handler.** Covers the full 19-step registration validation procedure, COSE public key parsing, `clientDataJSON` structure, and critical gotchas (CBOR encoding of `attestationObject`, challenge must be `BufferSource` not a string, `userHandle` unreliability, `allowCredentials` correctness).

### WebAuthn Implementation Gotchas (from webauthn.guide)

These are the non-obvious failure modes most relevant to Focus Guard — treat this as a checklist when implementing `shared/crypto.ts`:

| Gotcha | Impact on Focus Guard |
|---|---|
| `attestationObject` is CBOR-encoded, not JSON | Must implement or import a minimal CBOR parser to extract `authData` and the COSE public key |
| Challenge must be raw `BufferSource` (not a string) | Generate as `crypto.getRandomValues(new Uint8Array(32))`, encode as base64url for transport, decode back to `Uint8Array` before passing to WebAuthn API |
| `clientDataJSON` `origin` field must be verified | In extension context, origin is `chrome-extension://<id>` — verify this explicitly, not just the `rpId` |
| `clientDataJSON` `type` must be `"webauthn.create"` / `"webauthn.get"` | Check type field in both registration and assertion verifiers |
| Sign counter of `0` means the device doesn't support counters | A counter that is always `0` is acceptable; a counter that decreases is not |
| `userHandle` in assertion responses may be null | Use `credentialId` for credential lookup, never `userHandle` |
| `allowCredentials` with wrong IDs causes wrong prompt | Always populate with the stored `credentialId` bytes, decoded from storage correctly |
| `attestation: "direct"` leaks AAGUID and device metadata | Required for AAGUID allowlist enforcement — this is intentional in Focus Guard |

### Manifest Permissions Required

```json
{
  "permissions": [
    "declarativeNetRequest",
    "declarativeNetRequestFeedback",
    "storage",
    "alarms"
  ],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "service-worker.js" }
}
```

### Storage Key Reference

| Key | Type | Owner Slice |
|---|---|---|
| `credential` | `StoredCredential` | `credential/` |
| `blocklist` | `string[]` | `blocklist/` |
| `unlock_sessions` | `UnlockSessions` | `unlock/` |
| `settings` | `Settings` | `settings/` |

### Alarm Name Convention

| Pattern | Purpose |
|---|---|
| `relock:<domain>` | Re-lock alarm for a specific domain unlock session |
