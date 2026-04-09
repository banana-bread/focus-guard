# Feature: Phase 3 — Unlock Slice + Countdown Timer

The following plan should be complete, but validate patterns and task sanity before implementing.
Pay special attention to how `credential.service.ts` models the pending-challenge pattern — mirror it for the unlock challenge Map.

## Feature Description

Implement the unlock flow (WebAuthn assertion against a blocked domain) and the per-domain session management that drives the blocked-page countdown timer. After this phase the full core user journey works: block a site → navigate to it → touch YubiKey → countdown → auto re-lock.

## User Story

As a user who needs temporary access to a blocked site,
I want to touch my YubiKey on the blocked page and unlock the domain for a chosen duration,
So that I can access it briefly without permanently removing it from my blocklist.

## Problem Statement

Phase 2 left the unlock/ slice entirely absent and the blocked page as a static display. The `GET_ASSERTION_CHALLENGE`, `VERIFY_ASSERTION`, and `GET_UNLOCK_SESSION` message types are defined in `core/messages.ts` but have no handlers.

## Solution Statement

Add the `unlock/` slice (challenge store, storage, service, handler), update `blocklist.rules.ts` to manage temporary allow rules, wire the alarm re-lock handler into the service worker, and rebuild `blocked.ts`/`blocked.html`/`blocked.css` with a live unlock UI and countdown timer.

## Feature Metadata

**Feature Type**: New Capability  
**Estimated Complexity**: Medium  
**Primary Systems Affected**: `unlock/`, `blocked/`, `blocklist/rules`, `service-worker.ts`  
**Dependencies**: `shared/webauthn.ts` (`verifyAssertion`), `core/config.ts`, `core/storage.ts`, `chrome.alarms`, `chrome.declarativeNetRequest`

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

| File | Relevance |
|---|---|
| `src/credential/credential.service.ts` (lines 1–75) | Module-level pending-challenge pattern to mirror in `unlock.challenge.ts` |
| `src/credential/credential.handler.ts` | Handler signature and logger usage pattern |
| `src/credential/credential.handler.test.ts` | Test scaffold: storageMap setup, vi.mock, message type pattern |
| `src/blocklist/blocklist.rules.ts` | `BLOCK_RULE_ID_BASE=1000`, `syncRules` — add allow-rule equivalents here |
| `src/blocklist/blocklist.service.ts` | `addDomain` — read-modify-write pattern; same pattern for allow rules |
| `src/blocklist/blocklist.storage.ts` | Storage accessor pattern to mirror in `unlock.storage.ts` |
| `src/core/messages.ts` | `GET_ASSERTION_CHALLENGE`, `VERIFY_ASSERTION`, `GET_UNLOCK_SESSION` already typed |
| `src/core/storage.ts` | `UnlockSession`, `UnlockSessions`, `STORAGE_KEYS.UNLOCK_SESSIONS` already defined |
| `src/core/config.ts` | `CHALLENGE_TTL_MS`, `DEFAULT_UNLOCK_DURATION_MS`, `REJECTED_TRANSPORTS`, `RP_ID` |
| `src/shared/webauthn.ts` (lines 100–165) | `verifyAssertion` signature — all 8 parameters |
| `src/credential/credential.storage.ts` | `getCredential` / `setCredential` — import getCredential to load stored key |
| `src/service-worker.ts` | Routing switch to extend with unlock cases + alarm listener |
| `src/popup/popup.ts` (lines 115–175) | WebAuthn registration flow in browser context — mirror for assertion in blocked.ts |
| `src/__mocks__/chrome.ts` | `chrome.alarms` mock already has `create`, `clear`, `onAlarm.addListener` |

### New Files to Create

| File | Purpose |
|---|---|
| `src/unlock/unlock.challenge.ts` | `Map<string, PendingChallenge>` store with 2-min TTL, single-use |
| `src/unlock/unlock.storage.ts` | `getUnlockSessions` / `setUnlockSessions` / `deleteUnlockSession` |
| `src/unlock/unlock.service.ts` | `issueChallenge`, `verifyAndUnlock`, `getSession`, `endSession` |
| `src/unlock/unlock.handler.ts` | Handlers for `GET_ASSERTION_CHALLENGE`, `VERIFY_ASSERTION`, `GET_UNLOCK_SESSION` |
| `src/unlock/unlock.handler.test.ts` | Integration tests for all three handler functions |

### Files to Modify

| File | Change |
|---|---|
| `src/blocklist/blocklist.rules.ts` | Add `ALLOW_RULE_ID_BASE=2000`, `addAllowRule(domain)`, `removeAllowRule(domain)` |
| `src/service-worker.ts` | Import unlock handlers, add 3 cases to switch, add `chrome.alarms.onAlarm` listener |
| `src/blocked/blocked.ts` | Full rewrite — unlock button, duration selector, assertion flow, countdown timer |
| `src/blocked/blocked.html` | Add unlock UI: button, duration `<select>`, timer `<div>`, error `<p>` |
| `src/blocked/blocked.css` | Add styles for btn, select, timer, error, unlocked/locked state classes |

---

## IMPLEMENTATION PLAN

### Task 1: CREATE `src/unlock/unlock.challenge.ts`

Module-level `Map<string, PendingChallenge>` keyed by domain. Same pattern as `credential.service.ts` pending challenge but keyed by domain (supports concurrent domains).

```typescript
interface PendingChallenge {
  bytes: Uint8Array;
  issuedAt: number;
  operation: AssertionOperation;
}
const challenges = new Map<string, PendingChallenge>();
```

- **IMPLEMENT**: `storeChallenge(domain: string, operation: AssertionOperation): Uint8Array` — calls `generateChallenge()`, stores in Map, returns bytes
- **IMPLEMENT**: `consumeChallenge(domain: string): PendingChallenge` — gets entry, deletes it immediately (single-use), throws if absent or expired (`Date.now() - issuedAt > CHALLENGE_TTL_MS`)
- **IMPORTS**: `generateChallenge` from `@/shared/crypto`; `AssertionOperation` from `@/core/messages`; `CHALLENGE_TTL_MS` from `@/core/config`
- **GOTCHA**: Key unlock challenges by domain string (not just operation) — multiple domains can have simultaneous pending challenges
- **VALIDATE**: `pnpm tsc --noEmit`

### Task 2: CREATE `src/unlock/unlock.storage.ts`

- **MIRROR**: `src/blocklist/blocklist.storage.ts`
- **IMPLEMENT**: `getUnlockSessions(): Promise<UnlockSessions>` → `storageGet<UnlockSessions>(STORAGE_KEYS.UNLOCK_SESSIONS) ?? {}`
- **IMPLEMENT**: `setUnlockSessions(sessions: UnlockSessions): Promise<void>`
- **IMPLEMENT**: `deleteUnlockSession(domain: string): Promise<void>` — read-modify-write removing one key
- **IMPORTS**: `storageGet`, `storageSet`, `STORAGE_KEYS`, `UnlockSessions` from `@/core/storage`
- **VALIDATE**: `pnpm tsc --noEmit`

### Task 3: UPDATE `src/core/storage.ts` — add `allowRuleId` to `UnlockSession`

The allow rule ID must be stored so the re-lock handler can remove the exact rule without recomputation.

```typescript
export interface UnlockSession {
  expiresAt: number;
  duration: number;
  allowRuleId: number;  // ADD THIS FIELD
}
```

- **VALIDATE**: `pnpm tsc --noEmit` (will surface any callers that need updating)

### Task 4: UPDATE `src/blocklist/blocklist.rules.ts` — add allow-rule support

```typescript
export const ALLOW_RULE_ID_BASE = 2000;
```

- **IMPLEMENT**: `domainAllowRuleId(domain: string): number` — deterministic: djb2 hash `% 500 + ALLOW_RULE_ID_BASE`
- **IMPLEMENT**: `addAllowRule(domain: string): Promise<number>` — calls `updateDynamicRules({ addRules: [rule], removeRuleIds: [] })` and returns the ruleId. Rule: `priority: 10` (higher than block rule's `priority: 1`), `action: { type: 'allow' }`, same `urlFilter` and `resourceTypes` as block rule.
- **IMPLEMENT**: `removeAllowRule(ruleId: number): Promise<void>` — calls `updateDynamicRules({ removeRuleIds: [ruleId], addRules: [] })`
- **CONFIRMED**: `action.type: 'allow'` at `priority: 10` correctly overrides the `redirect` at `priority: 1`. Chrome's matching algorithm picks the highest-priority rule first; action-type ordering is only a tiebreaker when priorities are equal. The allow rule fully suppresses the redirect (Chrome docs: "no effect on the request").
- **VALIDATE**: `pnpm tsc --noEmit`

### Task 5: CREATE `src/unlock/unlock.service.ts`

```typescript
export async function issueChallenge(domain: string, trace_id: string): Promise<{
  challenge: Uint8Array;
  credentialId: Uint8Array;
  rpId: string;
}>
```

Steps: load stored credential (throw `'No credential registered'` if absent), call `storeChallenge(domain, 'unlock')`, return `{ challenge, credentialId: credential.credentialId, rpId: RP_ID }`.

```typescript
export async function verifyAndUnlock(
  domain: string,
  assertion: { authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array; transport?: string },
  durationMs: number,
  trace_id: string,
): Promise<void>
```

Steps:
1. `consumeChallenge(domain)` → pending
2. Load credential (throw if absent)
3. Check `assertion.transport` is not in `REJECTED_TRANSPORTS` (throw `'Transport not allowed: <transport>'`)
4. Call `verifyAssertion(authData, clientDataJSON, signature, storedPublicKeyCose, signCounter, pending.bytes, expectedOrigin, RP_ID)`
5. Update `credential.signCounter` in storage (call `setCredential`)
6. `expiresAt = Date.now() + durationMs`
7. `ruleId = await addAllowRule(domain)`
8. Write session: `{ expiresAt, duration: durationMs, allowRuleId: ruleId }`
9. `chrome.alarms.create('relock:' + domain, { when: expiresAt })`
10. Log `unlock_session_started`

```typescript
export async function getSession(domain: string): Promise<UnlockSession | undefined>
export async function endSession(domain: string, trace_id: string): Promise<void>
```

`endSession`: load sessions → if session present, `removeAllowRule(session.allowRuleId)` → `deleteUnlockSession(domain)` → `chrome.alarms.clear('relock:' + domain)` → log `unlock_session_ended`. **Must be idempotent**: if session is absent (alarm fired after countdown already cleared it), return silently — do not throw.

- **IMPORTS**: `consumeChallenge`, `storeChallenge` from `./unlock.challenge`; `getCredential`, `setCredential` from `@/credential/credential.storage`; `verifyAssertion` from `@/shared/webauthn`; `addAllowRule`, `removeAllowRule` from `@/blocklist/blocklist.rules`; `getUnlockSessions`, `setUnlockSessions`, `deleteUnlockSession` from `./unlock.storage`; `RP_ID`, `REJECTED_TRANSPORTS`, `DEFAULT_UNLOCK_DURATION_MS` from `@/core/config`
- **GOTCHA**: `storedPublicKeyCose` — `credential.publicKey` is `ArrayBuffer`; pass `new Uint8Array(credential.publicKey)` to `verifyAssertion`
- **GOTCHA**: `expectedOrigin = RP_ID` (same as rpId in extension context) — see `credential.handler.ts:46`
- **NOTE**: `getCredential()` already deserializes `credentialId` as `Uint8Array` and `publicKey` as `ArrayBuffer` — no manual re-hydration needed (see `credential.storage.ts` `deserializeCredential`)
- **VALIDATE**: `pnpm tsc --noEmit`

### Task 6: CREATE `src/unlock/unlock.handler.ts`

Three handlers, each narrowed from `RequestMessage`:

| Handler | Message | Returns |
|---|---|---|
| `handleGetAssertionChallenge` | `GET_ASSERTION_CHALLENGE` | `{ challenge: number[], credentialId: number[], rpId: string }` |
| `handleVerifyAssertion` | `VERIFY_ASSERTION` | `null` on success |
| `handleGetUnlockSession` | `GET_UNLOCK_SESSION` | `UnlockSession \| null` |

For `handleVerifyAssertion`:
- Decode `msg.assertion` (number[]) → parse as structured clone: `{ authenticatorData: number[], clientDataJSON: number[], signature: number[], transport?: string }`
- Convert each field via `new Uint8Array(arr)`
- Call `verifyAndUnlock(msg.domain ?? '', ..., msg.durationMs ?? DEFAULT_UNLOCK_DURATION_MS, trace_id)`

- **GOTCHA**: `msg.assertion` is a serialised `AuthenticatorAssertionResponse` — the popup/blocked page must send `{ authenticatorData, clientDataJSON, signature, transport }` as `number[]` arrays packed into a single `number[]` — **do not** flatten all bytes together. Instead, define a `SerializedAssertion` interface and send the assertion as an object field on the message. See note in Task 10.
- **VALIDATE**: `pnpm tsc --noEmit`

### Task 7: UPDATE `src/core/messages.ts` — fix VERIFY_ASSERTION payload

The current `VERIFY_ASSERTION` type sends `assertion: number[]` (a flat buffer). This is ambiguous. Update to send the assertion components as separate arrays:

```typescript
| {
    type: 'VERIFY_ASSERTION';
    authenticatorData: number[];
    clientDataJSON: number[];
    signature: number[];
    transport?: string;
    operation: AssertionOperation;
    domain?: string;
    durationMs?: number;
    trace_id: string;
  }
```

Remove the old `assertion: number[]` field. Update `popup.ts` if it references `VERIFY_ASSERTION` (it does not yet, but check). Update `unlock.handler.ts` accordingly.

- **VALIDATE**: `pnpm tsc --noEmit` — will fail until all references are updated

### Task 8: UPDATE `src/service-worker.ts`

Add to imports:
```typescript
import { handleGetAssertionChallenge, handleVerifyAssertion, handleGetUnlockSession } from '@/unlock/unlock.handler';
import { endSession } from '@/unlock/unlock.service';
```

Add to switch:
```typescript
case 'GET_ASSERTION_CHALLENGE':
  sendResponse(await handleGetAssertionChallenge(msg, trace_id)); break;
case 'VERIFY_ASSERTION':
  sendResponse(await handleVerifyAssertion(msg, trace_id)); break;
case 'GET_UNLOCK_SESSION':
  sendResponse(await handleGetUnlockSession(msg, trace_id)); break;
```

Add alarm listener **outside** `onMessage.addListener` (top-level):
```typescript
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('relock:')) {
    const domain = alarm.name.slice('relock:'.length);
    void endSession(domain, crypto.randomUUID());
  }
});
```

- **VALIDATE**: `pnpm tsc --noEmit`

### Task 9: UPDATE `src/blocked/blocked.html`

Replace the static `.card` body with:
- `#domain` — domain display (keep)
- `#state-locked` div — contains unlock button, duration select, error paragraph
- `#state-unlocked` div — contains timer display `#timer`, "Site is unlocked" message

```html
<!-- inside .card, after .heading -->
<p id="domain" class="domain-text"></p>

<div id="state-locked">
  <p class="message">This site is on your blocklist.</p>
  <p class="hint">Touch your hardware key to unlock temporarily.</p>
  <div class="unlock-row">
    <select id="duration-select">
      <option value="300000">5 min</option>
      <option value="900000">15 min</option>
      <option value="1800000" selected>30 min</option>
      <option value="3600000">60 min</option>
    </select>
    <button id="btn-unlock" class="btn-primary">Unlock</button>
  </div>
  <p id="unlock-error" class="error hidden"></p>
</div>

<div id="state-unlocked" class="hidden">
  <p class="message">Site unlocked. Relocking in:</p>
  <p id="timer" class="timer">--:--</p>
</div>
```

- **VALIDATE**: `vite build` succeeds

### Task 10: UPDATE `src/blocked/blocked.css`

Add after existing rules:

```css
.btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.unlock-row { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
select { background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 14px; }
.timer { font-size: 36px; font-weight: 700; color: var(--accent); margin-top: 8px; letter-spacing: 0.05em; }
.error { color: #f87171; font-size: 13px; margin-top: 10px; }
.hidden { display: none; }
```

- **VALIDATE**: `vite build` succeeds

### Task 11: UPDATE `src/blocked/blocked.ts` — full rewrite

```typescript
/**
 * Blocked page script.
 * Reads ?domain= and renders either the unlock UI or the countdown timer.
 * Communicates with service worker via chrome.runtime.sendMessage.
 */
```

**Structure (no createLogger — browser context, same as popup.ts):**

1. `sendMessage` helper — copy from `popup.ts` exactly (lines 8–23)
2. DOM refs for all 8 IDs above
3. `show/hide` helpers
4. `formatTime(ms: number): string` — `Math.max(0, ms)` → `MM:SS`
5. `startCountdown(expiresAt: number): void` — `setInterval(tick, 1000)` where tick recomputes `remaining = expiresAt - Date.now()`, updates `#timer`, on `<= 0` clears interval and calls `showLockedState()`
6. `showLockedState()` — show `#state-locked`, hide `#state-unlocked`
7. `showUnlockedState(expiresAt: number)` — hide `#state-locked`, show `#state-unlocked`, call `startCountdown(expiresAt)`
8. `handleUnlock()` async — full WebAuthn assertion flow:
   - Get `durationMs` from `#duration-select`
   - Send `GET_ASSERTION_CHALLENGE { operation: 'unlock', domain, trace_id }`
   - Decode response → `{ challenge: number[], credentialId: number[], rpId: string }`
   - `navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ type:'public-key', id: credentialIdBuffer, transports: ['usb','nfc','ble'] }], rpId, userVerification: 'discouraged', hints: ['security-key'] } })`
   - Send `VERIFY_ASSERTION { authenticatorData, clientDataJSON, signature, transport, operation:'unlock', domain, durationMs, trace_id }`
   - On success → `showUnlockedState(Date.now() + durationMs)` — optimistic; re-poll for exact time
   - Actually: after `VERIFY_ASSERTION` succeeds, send `GET_UNLOCK_SESSION` to get exact `expiresAt`, then call `showUnlockedState(session.expiresAt)`
9. `init()` — send `GET_UNLOCK_SESSION { domain, trace_id }`, if session exists call `showUnlockedState(session.expiresAt)`, else call `showLockedState()`
10. Wire `#btn-unlock` click → `void handleUnlock()`

- **GOTCHA**: `challenge` from service worker is `number[]` — `new Uint8Array(challenge)` then pass as `BufferSource`
- **GOTCHA**: `credentialId` is `number[]` — `new Uint8Array(credentialId).buffer` for `allowCredentials[0].id`
- **GOTCHA**: `transport` on the assertion response is `getTransports()[0]` — `(pkc.response as AuthenticatorAssertionResponse).getTransports?.()[0]`
- **GOTCHA**: `durationMs` must be read as a `number` — `parseInt(selectEl.value, 10)` — and passed in the `VERIFY_ASSERTION` message
- **VALIDATE**: `pnpm tsc --noEmit && vite build`

### Task 12: CREATE `src/unlock/unlock.handler.test.ts`

**Setup** (mirror `credential.handler.test.ts`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/__mocks__/chrome';
vi.mock('@/shared/webauthn', () => ({ verifyAssertion: vi.fn() }));
vi.mock('@/credential/credential.storage', () => ({
  getCredential: vi.fn(),
  setCredential: vi.fn(),
}));
```

**Test cases:**

| Test | Scenario |
|---|---|
| `handleGetAssertionChallenge` — no credential | returns `ok:false` with "No credential registered" |
| `handleGetAssertionChallenge` — credential exists | returns `ok:true` with `challenge[]`, `credentialId[]`, `rpId` |
| `handleVerifyAssertion` — no pending challenge | returns `ok:false` |
| `handleVerifyAssertion` — valid | `verifyAssertion` resolves → `ok:true`; `chrome.alarms.create` called with `'relock:reddit.com'`; `chrome.declarativeNetRequest.updateDynamicRules` called with allow rule |
| `handleVerifyAssertion` — rejected transport | returns `ok:false` with "Transport not allowed" |
| `handleVerifyAssertion` — sign counter violation | `verifyAssertion` rejects → `ok:false` |
| `handleGetUnlockSession` — no session | returns `ok:true, data:null` |
| `handleGetUnlockSession` — session exists | returns session object with `expiresAt`, `duration`, `allowRuleId` |

**Storage mock setup** (copy storageMap pattern from `blocklist.handler.test.ts`):
- Mock `chrome.storage.local.get/set/remove`
- Mock `chrome.declarativeNetRequest.updateDynamicRules`
- Mock `chrome.alarms.create/clear`

- **VALIDATE**: `pnpm test src/unlock/unlock.handler.test.ts`

---

## TESTING STRATEGY

### Unit Tests
- `unlock.handler.test.ts` covers all three handler entry points + error paths
- No unit tests needed for `unlock.challenge.ts`, `unlock.storage.ts` (thin wrappers — covered by handler tests)

### Integration Tests
- Handler tests exercise the full service → storage → rules → alarms call chain with mocked Chrome APIs

### Edge Cases

| Case | Expected |
|---|---|
| Challenge consumed twice | Second call throws "No pending challenge" → handler returns `ok:false` |
| Challenge expired (> 2 min) | `consumeChallenge` throws → handler returns `ok:false` |
| `durationMs` undefined in `VERIFY_ASSERTION` | Falls back to `DEFAULT_UNLOCK_DURATION_MS` |
| Alarm fires for domain with no session | `endSession` is no-op (session already cleared) |
| `transport = 'internal'` | Rejected before `verifyAssertion` is called |

---

## VALIDATION COMMANDS

### Level 1: Type Safety
```bash
pnpm tsc --noEmit
```

### Level 2: Unit Tests
```bash
pnpm test src/unlock/unlock.handler.test.ts
pnpm test  # full suite — ensure no regressions
```

### Level 3: Build
```bash
vite build
```

### Level 4: Manual Validation

1. Load unpacked `dist/` in `brave://extensions`
2. Open popup → register YubiKey (if not already done)
3. Add `example.com` to blocklist
4. Navigate to `https://example.com` → blocked page shows with Unlock button and duration select
5. Select "5 min", click Unlock, touch key → timer counts down `05:00 → 04:59 …`
6. Navigate away and back → timer still running (session persists)
7. Wait for or simulate alarm expiry → blocked page transitions to locked state without reload

---

## ACCEPTANCE CRITERIA

- [ ] `GET_ASSERTION_CHALLENGE` returns challenge, credentialId, rpId for registered credentials
- [ ] `VERIFY_ASSERTION` writes an unlock session and creates a `relock:<domain>` alarm
- [ ] `declarativeNetRequest` allow rule (priority 10) added on unlock
- [ ] `chrome.alarms.onAlarm` handler removes allow rule and session on expiry
- [ ] Blocked page shows countdown timer after successful assertion
- [ ] Timer transitions to locked UI at zero without page reload
- [ ] Duration selector overrides default; `durationMs` passed through to service worker
- [ ] Rejected transports (`internal`, `hybrid`) return error without calling `verifyAssertion`
- [ ] Sign counter updated in storage after each successful assertion
- [ ] `pnpm tsc --noEmit` zero errors
- [ ] `vite build` succeeds
- [ ] All handler test cases pass

---

## NOTES

**Allow rule priority**: Block rules use `priority: 1`. Allow rules must use `priority: 10` to override. Using `priority: 2` would work numerically but `10` leaves room for future rule tiers.

**`VERIFY_ASSERTION` message shape change (Task 7)**: The existing `assertion: number[]` field is a flat buffer with no way to separate `authenticatorData`, `clientDataJSON`, and `signature`. This must be broken into separate fields before the handler can work. This is a breaking change to the message protocol — the blocked page (sole caller) is being rewritten in the same phase, so there are no callers to migrate.

**`credentialId` deserialization**: `StoredCredential.credentialId` is a `Uint8Array`. `chrome.storage.local` round-trips it as a plain object `{0: n, 1: m, …}`. `credential.storage.ts` likely handles this — check `getCredential` before using `.credentialId` directly; may need `new Uint8Array(Object.values(cred.credentialId))`.

**Session optimistic vs authoritative timer**: After `VERIFY_ASSERTION` succeeds, the blocked page could compute `expiresAt = Date.now() + durationMs` optimistically. But the service worker adds network/compute time. Sending a follow-up `GET_UNLOCK_SESSION` is more accurate and only costs one message round-trip.

**Confidence Score**: 10/10 — all three previously open risks are resolved:
1. `credentialId` deserialization: `credential.storage.ts` already handles it via `deserializeCredential` — `getCredential()` returns proper `Uint8Array`/`ArrayBuffer` with no extra handling needed.
2. DNR allow rule: confirmed that `priority: 10, action: 'allow'` fully overrides `priority: 1, action: 'redirect'` per Chrome docs.
3. `endSession` idempotency: specified explicitly — absent session is a silent no-op, preventing double-remove when countdown and alarm race.
