# Feature: Phase 4 — Settings, Authenticated Remove, Credential Replace & UI Polish

The following plan should be complete, but validate documentation and codebase patterns before implementing.
Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Phase 4 completes the MVP: authenticated domain removal from popup, credential replacement, settings slice (default unlock duration), AAGUID-based device name display, and UI polish. The user wants per-row delete buttons on blocklist items and dynamic key name detection instead of hard-coded "YubiKey registered".

## User Story

As a Focus Guard user
I want to remove blocked domains (with YubiKey verification), replace my credential, configure default unlock duration, and see my actual key name
So that I have full control over my blocklist with hardware-backed security and a polished UI

## Problem Statement

Currently: no way to remove domains, no settings UI, "YubiKey registered" is hard-coded text, no credential replacement flow. Phase 4 fills all remaining MVP gaps.

## Solution Statement

1. Add inline delete (×) button per domain row → triggers WebAuthn assertion → removes domain
2. Add AAGUID→device name map in config → `GET_CREDENTIAL_STATUS` returns device name → badge shows it
3. Create `settings/` slice (handler, service, storage) for default unlock duration
4. Wire `REMOVE_DOMAIN`, `GET_SETTINGS`, `SET_SETTINGS` messages + handlers in service worker

## Feature Metadata

**Feature Type**: Enhancement (completing MVP)
**Estimated Complexity**: Medium
**Primary Systems Affected**: popup/, credential/, blocklist/, settings/ (new), core/messages.ts, service-worker.ts, core/config.ts
**Dependencies**: None (all internal)
**Deferred**: Credential replacement — deferred to future multi-key feature (add/remove keys is a cleaner model than replace)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

| File | Why |
|------|-----|
| `src/popup/popup.ts` (full) | Main popup logic — add remove handler, settings UI, replace flow |
| `src/popup/popup.render.ts` (full) | Render helpers — add delete button to `renderBlocklist`, settings render |
| `src/popup/popup.html` (full) | Add settings section, replace button, update badge |
| `src/popup/popup.css` (full) | Styles for new UI elements |
| `src/core/messages.ts` (full) | Add `REMOVE_DOMAIN`, `GET_SETTINGS`, `SET_SETTINGS` message types |
| `src/service-worker.ts` (full) | Wire new handlers |
| `src/core/config.ts` (full) | Add AAGUID→name map |
| `src/blocklist/blocklist.service.ts` (full) | Add `removeDomain()` business logic |
| `src/blocklist/blocklist.handler.ts` (full) | Add `handleRemoveDomain` |
| `src/credential/credential.service.ts` (full) | Existing registration logic — extend for replacement |
| `src/credential/credential.handler.ts` (full) | Add handler for credential status with device name |
| `src/credential/credential.storage.ts` (full) | Already has `removeCredential()` |
| `src/unlock/unlock.service.ts` (full) | `verifyAndUnlock` — pattern for assertion verification; need generic verify |
| `src/unlock/unlock.challenge.ts` (full) | Challenge store — already supports `operation` discriminant |
| `src/blocklist/blocklist.rules.ts` (full) | `syncRules`, `removeAllowRule` — needed for domain removal |
| `src/unlock/unlock.storage.ts` | `deleteUnlockSession` — needed for cleanup on domain removal |

### New Files to Create

| File | Purpose |
|------|---------|
| `src/settings/settings.handler.ts` | Message handlers for GET_SETTINGS, SET_SETTINGS |
| `src/settings/settings.service.ts` | Business logic: get/update settings with defaults |
| `src/settings/settings.storage.ts` | Storage read/write for settings key |

### Patterns to Follow

**Handler pattern** — mirror `src/blocklist/blocklist.handler.ts`: export named handler functions, each takes narrowed message + trace_id, returns `Promise<ResponseMessage>`.

**Service pattern** — mirror `src/blocklist/blocklist.service.ts`: pure business logic, imports from own storage + shared utils.

**Storage pattern** — mirror `src/blocklist/blocklist.storage.ts`: thin get/set wrappers around `storageGet`/`storageSet` from `core/storage.ts`.

**CSS**: dark theme variables from `:root` in `popup.css`. Use `var(--danger)` / `var(--danger-hover)` for delete buttons.

**exactOptionalPropertyTypes**: use spread-conditional `...(x !== undefined ? { x } : {})` for all optional fields.

---

## IMPLEMENTATION PLAN

### Phase 1: Message Protocol & Config Updates

Add new message types to `core/messages.ts`, AAGUID name map to `core/config.ts`.

### Phase 2: Settings Slice

Create `settings/` slice (storage, service, handler) — straightforward CRUD for `Settings`.

### Phase 3: Blocklist Remove + Generic Assertion Verify

Add `removeDomain()` to blocklist service, `REMOVE_DOMAIN` handler. Extract a reusable `verifyAssertionOnly()` from unlock service so remove and replace can verify without creating an unlock session.

### Phase 4: Device Name in Credential Status

Enhance `GET_CREDENTIAL_STATUS` to return AAGUID + device name from config map.

### Phase 5: Popup UI

Add delete buttons to domain rows, settings section, replace key button, dynamic device name badge. Wire all message flows.

### Phase 6: Testing

Unit tests for new handlers and services.

---

## STEP-BY-STEP TASKS

### Task 1: UPDATE `src/core/config.ts` — Add AAGUID name map

- **IMPLEMENT**: Add `AAGUID_NAMES: Record<string, string>` mapping known AAGUIDs to human-readable names:
  ```typescript
  export const AAGUID_NAMES: Record<string, string> = {
    '2fc0579f-8113-47ea-b116-bb5a8db9202a': 'YubiKey 5',
  };
  ```
- **VALIDATE**: `pnpm typecheck`

### Task 2: UPDATE `src/core/messages.ts` — Add REMOVE_DOMAIN message

- **IMPLEMENT**: Add to `RequestMessage` union:
  - `{ type: 'REMOVE_DOMAIN'; domain: string; authenticatorData: number[]; clientDataJSON: number[]; signature: number[]; transport?: string; trace_id: string }`
  - Already has `GET_SETTINGS` and `SET_SETTINGS` — verify they exist (they do in the type but no handlers yet)
- **GOTCHA**: `REMOVE_DOMAIN` bundles assertion data in the message itself (one WebAuthn ceremony → one message → one handler). This keeps service-worker.ts branching on `msg.type` only.
- **VALIDATE**: `pnpm typecheck`

### Task 3: CREATE `src/settings/settings.storage.ts`

- **IMPLEMENT**: `getSettings()` → returns `Settings` (with defaults), `setSettings()` → persists
- **PATTERN**: Mirror `src/blocklist/blocklist.storage.ts`
- **IMPORTS**: `storageGet`, `storageSet`, `STORAGE_KEYS`, `Settings` from `@/core/storage`
- **DEFAULT**: `{ defaultUnlockDurationMs: 1_800_000 }` (30 min)
- **VALIDATE**: `pnpm typecheck`

### Task 4: CREATE `src/settings/settings.service.ts`

- **IMPLEMENT**: `getSettingsWithDefaults()`, `updateSettings(partial)` — merge partial into existing
- **IMPORTS**: From `settings.storage.ts`
- **VALIDATE**: `pnpm typecheck`

### Task 5: CREATE `src/settings/settings.handler.ts`

- **IMPLEMENT**: `handleGetSettings(trace_id)`, `handleSetSettings(msg, trace_id)`
- **PATTERN**: Mirror `src/blocklist/blocklist.handler.ts`
- **VALIDATE**: `pnpm typecheck`

### Task 6: UPDATE `src/unlock/unlock.service.ts` — Extract `verifyAssertionGeneric`

- **IMPLEMENT**: Extract the challenge-consume + assertion-verify + counter-update logic from `verifyAndUnlock` into a new exported function:
  ```typescript
  export async function verifyAssertionGeneric(
    domain: string,
    assertion: { authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array; transport?: string },
    expectedOperation: AssertionOperation,
    trace_id: string,
  ): Promise<void>
  ```
  This function: consumes challenge, checks operation matches, rejects bad transports, verifies signature, updates sign counter. Does NOT create an unlock session.
- Then refactor `verifyAndUnlock` to call `verifyAssertionGeneric` + session creation.
- **GOTCHA**: The challenge store is keyed by domain. For `remove_domain` the domain is the domain being removed.
- **VALIDATE**: `pnpm typecheck && pnpm test`

### Task 7: UPDATE `src/blocklist/blocklist.service.ts` — Add `removeDomain`

- **IMPLEMENT**: `removeDomain(domain, assertion, trace_id)`:
  1. Call `verifyAssertionGeneric(domain, assertion, 'remove_domain', trace_id)`
  2. Get current blocklist, filter out domain
  3. `syncRules(oldList, newList)` + `setBlocklist(newList)`
  4. If domain has active unlock session: `endSession(domain, trace_id)` (cancel alarm, remove allow rule)
  5. Log `domain_removed`
- **IMPORTS**: `verifyAssertionGeneric` from `@/unlock/unlock.service`, `endSession` from same, blocklist storage/rules
- **VALIDATE**: `pnpm typecheck`

### Task 8: UPDATE `src/blocklist/blocklist.handler.ts` — Add `handleRemoveDomain`

- **IMPLEMENT**: Handler for `REMOVE_DOMAIN` messages. Deserializes `number[]` → `Uint8Array`, calls `removeDomain`.
- **VALIDATE**: `pnpm typecheck`

### Task 9: UPDATE `src/credential/credential.handler.ts` — Enhance status with device name

- **IMPLEMENT**: `handleGetCredentialStatus` now returns `{ registered: boolean; deviceName?: string }` — read credential from storage, look up AAGUID in `AAGUID_NAMES`, fall back to `'Security key'` if not in map.
- **VALIDATE**: `pnpm typecheck`

### Task 10: UPDATE `src/unlock/unlock.handler.ts` — Keep unlock-only

- **IMPLEMENT**: No changes needed. `handleVerifyAssertion` stays unlock-only — it calls `verifyAndUnlock` which internally calls `verifyAssertionGeneric`. Remove is handled by its own `REMOVE_DOMAIN` message type/handler.
- **VALIDATE**: `pnpm typecheck`

### Task 11: UPDATE `src/service-worker.ts` — Wire new handlers

- **IMPLEMENT**: Add cases for `REMOVE_DOMAIN`, `GET_SETTINGS`, `SET_SETTINGS` in the switch. Import handlers from blocklist and settings slices.
- **VALIDATE**: `pnpm typecheck`

### Task 12: UPDATE `src/popup/popup.html` — UI additions

- **IMPLEMENT**:
  1. In `section-key-status`: change hard-coded "YubiKey registered" to a `<span id="device-name">Security key registered</span>` placeholder.
  2. Add new settings section before the blocklist section:
     ```html
     <div id="section-settings" class="section hidden">
       <p class="section-title">Settings</p>
       <label class="settings-label">Default unlock duration
         <select id="select-duration" class="input">
           <option value="300000">5 minutes</option>
           <option value="900000">15 minutes</option>
           <option value="1800000" selected>30 minutes</option>
           <option value="3600000">1 hour</option>
         </select>
       </label>
     </div>
     ```
- **VALIDATE**: Open popup.html in browser to sanity-check structure

### Task 13: UPDATE `src/popup/popup.render.ts` — Delete buttons, device name

- **IMPLEMENT**:
  1. In `renderBlocklist`: add a `<button class="btn-delete" data-domain="${domain}" aria-label="Remove ${domain}" title="Remove">×</button>` to each `<li>`. The `×` is compact — just a character, no icon library needed.
  2. Export `setDeviceName(el: HTMLElement | null, name: string)` to update the badge text.
  3. Export `renderSettings(selectEl: HTMLSelectElement | null, durationMs: number)` to set the selected option.
- **GOTCHA**: The delete button must NOT use `innerHTML` for the domain — use `escapeHtml`. Current `renderBlocklist` already does this for `.domain-name`.
- **VALIDATE**: `pnpm typecheck`

### Task 14: UPDATE `src/popup/popup.css` — Styles for new elements

- **IMPLEMENT**:
  ```css
  .btn-delete {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.15s, background 0.15s;
    margin-left: 8px;
    flex-shrink: 0;
  }
  .btn-delete:hover {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
  }
  .settings-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--text-muted);
    font-size: 13px;
  }
  .settings-label select {
    width: auto;
    margin-bottom: 0;
  }
  ```
- **VALIDATE**: Visual check in browser

### Task 15: UPDATE `src/popup/popup.ts` — Wire remove, settings, replace

- **IMPLEMENT**:
  1. **Remove domain flow**: Add event delegation on `domainList` for clicks on `.btn-delete`:
     - Get `domain` from `button.dataset.domain`
     - Call `GET_ASSERTION_CHALLENGE` with `operation: 'remove_domain'`, `domain`
     - Invoke `navigator.credentials.get()` (same pattern as `blocked.ts` unlock flow)
     - Send `REMOVE_DOMAIN` with assertion data
     - On success: re-fetch and re-render blocklist
  2. **Settings init**: On init (after registered), send `GET_SETTINGS`, call `renderSettings` with response
  3. **Settings change**: Listen for `change` on `#select-duration`, send `SET_SETTINGS`
  4. **Device name**: On init, use `deviceName` from `GET_CREDENTIAL_STATUS` response to set badge
  5. Show `section-settings` alongside other post-registration sections
- **GOTCHA**: `popup.ts` is 272 lines. Adding remove + settings will push it close to 300. Extract the WebAuthn ceremony helper (get challenge → credentials.get → return assertion data) into a shared function since it's used by remove now and future operations later.
- **VALIDATE**: `pnpm typecheck`

### Task 16: ADD tests — `src/settings/settings.handler.test.ts`

- **IMPLEMENT**: Tests for `handleGetSettings` (returns defaults), `handleSetSettings` (updates duration)
- **PATTERN**: Mirror `src/blocklist/blocklist.handler.test.ts`
- **VALIDATE**: `pnpm test`

### Task 17: ADD tests — `src/blocklist/blocklist.handler.test.ts` — remove domain

- **IMPLEMENT**: Add test for `handleRemoveDomain` — mock `verifyAssertionGeneric`, verify domain removed from storage and rules synced
- **VALIDATE**: `pnpm test`

### Task 18: Final validation

- **VALIDATE**: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
- **MANUAL**: Load extension in Brave, test:
  1. Register key → badge shows actual device name (e.g. "YubiKey 5 registered")
  2. Add domain → row has × button
  3. Click × → WebAuthn prompt → domain removed
  4. Change default duration → persists across popup close/reopen
  5. Replace key → old key verify → new key register → badge updates

---

## TESTING STRATEGY

### Unit Tests

- `settings.handler.test.ts`: GET_SETTINGS returns defaults; SET_SETTINGS updates; partial merge works
- `blocklist.handler.test.ts`: REMOVE_DOMAIN removes domain + cleans up rules/sessions; rejects if assertion fails
- Existing tests must still pass — `pnpm test` is the gate

### Edge Cases

| Case | Expected |
|------|----------|
| Remove last domain | Blocklist empty, empty state shown |
| Remove domain with active unlock session | Session ended, alarm cancelled, allow rule removed |
| Settings: select same value | No-op, no error |
| AAGUID not in name map | Fall back to "Security key registered" |
| Delete button during pending WebAuthn prompt | Button disabled while assertion in flight |

---

## VALIDATION COMMANDS

Execute in pyramid order. Each level gates the next.

### Level 1: Syntax & Style
```bash
pnpm lint && pnpm format:check
```

### Level 2: Type Safety
```bash
pnpm typecheck
```

### Level 3: Unit Tests
```bash
pnpm test
```

### Level 4: Build
```bash
pnpm build
```

### Level 5: Manual Validation
1. Load unpacked from `dist/` in `brave://extensions`
2. Register key → verify badge shows device name
3. Add 2 domains → verify × buttons appear, rows aren't crowded
4. Remove a domain → YubiKey touch → domain gone
5. Change default duration → close/reopen popup → setting persisted

---

## ACCEPTANCE CRITERIA

- [ ] Domains removable via inline × button with WebAuthn verification
- [ ] Badge shows AAGUID-derived device name (falls back to "Security key")
- [ ] Settings section with default unlock duration selector (5/15/30/60 min)
- [ ] All new message types (`REMOVE_DOMAIN`, `GET_SETTINGS`, `SET_SETTINGS`) handled in service worker
- [ ] All validation commands pass with zero errors
- [ ] No file exceeds ~300 lines
- [ ] No regressions in existing functionality

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Manual testing confirms all flows work in Brave
- [ ] Acceptance criteria all met

---

## NOTES

### UI Decision: Inline Delete Button

The × button is a single character with muted color that only highlights red on hover. It won't crowd the row because: (a) the domain name has `flex: 1` with `text-overflow: ellipsis`, (b) the × is fixed-width at ~28px, (c) the timer (if present) sits between name and ×. Layout: `[domain-name (flex:1)] [timer?] [×]`.

### REMOVE_DOMAIN Message Design

The remove flow bundles assertion data in the `REMOVE_DOMAIN` message itself (rather than a separate VERIFY_ASSERTION + REMOVE_DOMAIN pair). This keeps it atomic: one message, one handler, no intermediate state. The popup does: challenge → WebAuthn → REMOVE_DOMAIN (with assertion). The handler verifies inline.

### verifyAssertionGeneric Extraction

The core assertion verification logic (consume challenge, check transport, verify signature, update counter) is duplicated if we don't extract it. `verifyAssertionGeneric` is the shared primitive that `verifyAndUnlock`, `handleRemoveDomain`, and `handleVerifyAssertion` (for replace) all call.
