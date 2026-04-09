# Feature: Phase 2 — Blocklist & Credential Slices + UI

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Implements the first two feature slices (credential + blocklist) and two UI surfaces (popup + blocked page). After this phase, a user can register a YubiKey, add domains to a blocklist, and see a branded blocked page on navigation.

## User Stories

- As a first-time user, I want to register my YubiKey so that all future security operations require a hardware touch.
- As a user, I want to add a domain to my blocklist so that navigating to it is immediately blocked.
- As a blocked user, I want to see a clear "you blocked this" page so I understand why the site is inaccessible.

## Feature Metadata

**Feature Type**: New Capability | **Complexity**: High
**Systems Affected**: `credential/`, `blocklist/`, `popup/`, `blocked/`, `service-worker.ts`, `vite.config.ts`, `manifest.json`

---

## CRITICAL RESEARCH FINDINGS

### 1. `Uint8Array` does NOT survive `chrome.runtime.sendMessage`

Chrome uses JSON-like serialization, NOT structured clone. `new Uint8Array([1,2,3])` becomes `{0:1, 1:2, 2:3}`. All binary fields in `RequestMessage` must use `number[]`. Senders: `Array.from(uint8Array)`. Receivers: `new Uint8Array(array)`.

**Sources:** [Chromium #248548](https://bugs.chromium.org/p/chromium/issues/detail?id=248548), [webextension-polyfill #643](https://github.com/mozilla/webextension-polyfill/issues/643)

### 2. Vite HTML entry output paths are NOT controllable

Vite ignores input key names for HTML entries; uses file path relative to root. `src/popup/popup.html` → `dist/src/popup/popup.html`. **Solution:** Use only `.ts` entries + `vite-plugin-static-copy` for HTML/CSS.

**Source:** [vitejs/vite#15612](https://github.com/vitejs/vite/issues/15612)

### 3. `declarativeNetRequest` — use `extensionPath`, not `url`

`redirect.extensionPath: '/blocked/blocked.html?domain=...'` resolves automatically to `chrome-extension://<id>/...`. Enum values are strings (`"redirect"`, `"main_frame"`). Requires `web_accessible_resources` in manifest.

**Source:** [Chrome declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)

---

## CONTEXT REFERENCES — MUST READ BEFORE IMPLEMENTING

- `src/core/messages.ts` — Message protocol. Binary fields must change `Uint8Array` → `number[]`.
- `src/core/storage.ts` — `storageGet/Set/Remove`, `STORAGE_KEYS`, `StoredCredential`, `Blocklist` types.
- `src/core/config.ts` — `RP_ID`, `RP_NAME`, `AAGUID_ALLOWLIST`, `ALLOWED_TRANSPORTS`, `REJECTED_TRANSPORTS`.
- `src/core/logger.ts` — `createLogger(context)`. Do NOT add logger to `shared/` modules (see memory).
- `src/shared/crypto.ts` — `generateChallenge()`, `base64urlEncode()`.
- `src/shared/webauthn.ts` — `verifyRegistration(attestationObjectBytes, clientDataJSON, expectedChallenge, expectedOrigin, expectedRpId)` → `VerifiedRegistration`.
- `src/shared/domain.ts` — `normalizeDomain()`.
- `src/service-worker.ts` — Fan-out skeleton with `switch` block to replace.
- `src/__mocks__/chrome.ts` — Chrome API mock for vitest.
- `vite.config.ts` — Needs popup/blocked TS entries + static copy targets.
- `manifest.json` — Needs popup path fix + `web_accessible_resources`.

### New Files to Create

| Slice | Files |
|---|---|
| credential | `credential.storage.ts`, `credential.service.ts`, `credential.handler.ts`, `credential.handler.test.ts` |
| blocklist | `blocklist.storage.ts`, `blocklist.rules.ts`, `blocklist.service.ts`, `blocklist.handler.ts`, `blocklist.handler.test.ts` |
| popup | `popup.html`, `popup.ts`, `popup.css` |
| blocked | `blocked.html`, `blocked.ts`, `blocked.css` |

---

## DESIGN SYSTEM — Security Blue Theme

```css
:root {
  --bg-primary: #0f172a; --bg-surface: #1e293b; --bg-elevated: #334155; --border: #334155;
  --accent: #3b82f6; --accent-hover: #2563eb; --accent-muted: #1d4ed8;
  --success: #10b981; --danger: #ef4444; --danger-hover: #dc2626;
  --text-primary: #f1f5f9; --text-muted: #94a3b8; --text-disabled: #475569;
}
```

- Font: `'Inter', system-ui, -apple-system, sans-serif` at `14px`
- Popup: `340px` wide, auto height
- Corners: `8px` (cards), `6px` (inputs/buttons)
- Shield icon `🛡` in popup header

---

## STEP-BY-STEP TASKS

### 1. UPDATE `src/core/messages.ts`

- Change `REGISTER_CREDENTIAL.attestation` from `Uint8Array` to `number[]`
- Add `clientDataJSON: number[]` to `REGISTER_CREDENTIAL` variant
- Change `VERIFY_ASSERTION.assertion` from `Uint8Array` to `number[]`
- Add `| { type: 'GET_CREDENTIAL_STATUS'; trace_id: string }` to `RequestMessage`
- **VALIDATE**: `pnpm typecheck`

### 2. CREATE `src/credential/credential.storage.ts`

- Three wrappers: `getCredential()`, `setCredential(c)`, `removeCredential()` using `storageGet/Set/Remove` with `STORAGE_KEYS.CREDENTIAL`.
- **GOTCHA**: `chrome.storage.local` deserializes `Uint8Array` as plain objects. Add JSDoc note.
- **VALIDATE**: `pnpm typecheck`

### 3. CREATE `src/credential/credential.service.ts`

- `createRegistrationChallenge(): Uint8Array` — calls `generateChallenge()`, stores in module-level `let pendingChallenge: Uint8Array | null`. Returns challenge.
- `registerCredential(attestation: Uint8Array, clientDataJSON: Uint8Array, expectedOrigin: string, expectedRpId: string): Promise<VerifiedRegistration>` — retrieves/clears `pendingChallenge`, calls `verifyRegistration(...)`, checks `aaguid` against `AAGUID_ALLOWLIST`, calls `setCredential(...)`.
- `getCredentialStatus(): Promise<boolean>` — checks storage.
- **GOTCHA**: Clear `pendingChallenge` in `finally` block. Pass `expectedOrigin`/`expectedRpId` from handler (don't use `chrome.*` at module level).
- **VALIDATE**: `pnpm typecheck`

### 4. CREATE `src/credential/credential.handler.ts`

- Export `handleCredentialMessage(msg, sendResponse, trace_id): Promise<boolean>`. Return `true` if handled, `false` otherwise.
- `GET_REGISTRATION_CHALLENGE` → `okResponse({ challenge: Array.from(challenge) })`
- `REGISTER_CREDENTIAL` → convert `number[]` to `Uint8Array`, call `registerCredential(...)`, origin = `'chrome-extension://' + chrome.runtime.id`, rpId = `chrome.runtime.id`
- `GET_CREDENTIAL_STATUS` → `okResponse({ registered: boolean })`
- Log: `registration_challenge_created`, `credential_registered` (with aaguid), errors with `fix_suggestion`.
- **VALIDATE**: `pnpm typecheck`

### 5. CREATE `src/blocklist/blocklist.storage.ts`

- `getBlocklist(): Promise<Blocklist>` (returns `[]` if undefined), `setBlocklist(list): Promise<void>`.
- **VALIDATE**: `pnpm typecheck`

### 6. CREATE `src/blocklist/blocklist.rules.ts`

- `BLOCK_RULE_ID_BASE = 1000`. Rule IDs: `BLOCK_RULE_ID_BASE + index`.
- `buildBlockRule(domain: string, index: number): chrome.declarativeNetRequest.Rule`:
  ```typescript
  { id, priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: '/blocked/blocked.html?domain=' + encodeURIComponent(domain) } },
    condition: { urlFilter: '||' + domain, resourceTypes: ['main_frame', 'sub_frame'] } }
  ```
- `syncRules(oldList, newList): Promise<void>` — full rebuild: remove all old IDs, add all new rules.
- **GOTCHA**: Do NOT call `chrome.runtime.getURL()` at module parse time.
- **VALIDATE**: `pnpm typecheck`

### 7. CREATE `src/blocklist/blocklist.service.ts`

- `addDomain(rawInput: string, trace_id: string): Promise<void>` — normalize, check duplicate, append, `syncRules(old, new)`, `setBlocklist`.
- `getBlocklistDomains(): Promise<Blocklist>` — thin storage wrapper.
- Log: `domain_added`, `domain_duplicate` (warn, don't throw).
- **VALIDATE**: `pnpm typecheck`

### 8. CREATE `src/blocklist/blocklist.handler.ts`

- `handleBlocklistMessage(msg, sendResponse, trace_id): Promise<boolean>`.
- `ADD_DOMAIN` → `addDomain(msg.domain, trace_id)`, `okResponse(null)`.
- `GET_BLOCKLIST` → `getBlocklistDomains()`, `okResponse(list)`.
- **VALIDATE**: `pnpm typecheck`

### 9. UPDATE `src/service-worker.ts`

- Import both handlers. Replace `switch` block with fan-out:
  ```typescript
  const handled =
    (await handleCredentialMessage(msg, sendResponse, trace_id)) ||
    (await handleBlocklistMessage(msg, sendResponse, trace_id));
  if (!handled) { logger.warn('message_unhandled', {...}); sendResponse(errResponse(...)); }
  ```
- Keep the `try/catch` and `duration_ms` logging.
- **VALIDATE**: `pnpm typecheck`

### 10. CREATE `src/popup/popup.css`

- Use design tokens from Design System section.
- Key classes: `.header`, `.section`, `.section-title`, `.btn`/`.btn-primary`/`.btn-full`, `.input`, `.domain-list`/`.domain-item`/`.domain-name`, `.empty-state`, `.key-registered-badge`, `.status-dot` (`.registered`/`.unregistered`), `.error-text`.
- **VALIDATE**: Visual inspection after build.

### 11. CREATE `src/popup/popup.html`

- Sections (all `hidden` by default, toggled by JS): `section-register` (register button), `section-key-status` (green badge), `section-add-domain` (input + add button), `section-blocklist` (ul + empty state).
- `<script type="module" src="popup.js"></script>` — references built output name.
- **VALIDATE**: `pnpm build`

### 12. CREATE `src/popup/popup.ts`

- Helper: `sendMessage(msg: RequestMessage): Promise<ResponseMessage>` wrapping `chrome.runtime.sendMessage`.
- **Startup**: `GET_CREDENTIAL_STATUS` → show/hide sections, set status dot. If registered, `GET_BLOCKLIST` → render list.
- **Register button**: `GET_REGISTRATION_CHALLENGE` → `navigator.credentials.create({ publicKey: { challenge, rp: { id: chrome.runtime.id, name: 'Focus Guard' }, user: { id, name, displayName }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { authenticatorAttachment: 'cross-platform' }, attestation: 'direct' } })` → `REGISTER_CREDENTIAL` with `Array.from(...)` for both attestation and clientDataJSON.
- **Add domain**: `ADD_DOMAIN` → refresh blocklist.
- **GOTCHA**: `navigator.credentials.create()` returns `null` on cancel — handle gracefully.
- **GOTCHA**: Don't import `createLogger` — it uses `process.env.VITEST` which fails in browser. Use plain `console` if needed.
- Include `escapeHtml()` utility for domain rendering.
- **VALIDATE**: `pnpm typecheck`

### 13. CREATE `src/blocked/blocked.{html,css,ts}`

- **HTML**: Centered card with shield icon, "Site Blocked" heading, `#domain` paragraph, message, unlock hint.
- **CSS**: Full-screen flex centering, same design tokens.
- **TS**: Read `?domain=` from `URLSearchParams`, set `#domain` textContent. No unlock button yet (Phase 3).
- **VALIDATE**: `pnpm typecheck`

### 14. UPDATE `vite.config.ts`

TS-only entries + static copy (NOT HTML entries — see Finding #2):
```typescript
input: {
  'service-worker': resolve(__dirname, 'src/service-worker.ts'),
  'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
  'blocked/blocked': resolve(__dirname, 'src/blocked/blocked.ts'),
},
output: {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name].js',
  assetFileNames: 'assets/[name][extname]',
},
```
Static copy targets: `manifest.json`, `src/popup/popup.{html,css}`, `src/blocked/blocked.{html,css}`.

Output: `dist/service-worker.js`, `dist/popup/{popup.html,popup.css,popup.js}`, `dist/blocked/{blocked.html,blocked.css,blocked.js}`, `dist/manifest.json`.
- **VALIDATE**: `pnpm build && ls dist/popup/popup.js dist/blocked/blocked.js dist/service-worker.js`

### 15. UPDATE `manifest.json`

- Change `action.default_popup` to `"popup/popup.html"`.
- Add:
  ```json
  "web_accessible_resources": [{
    "resources": ["blocked/blocked.html", "blocked/blocked.css", "blocked/blocked.js"],
    "matches": ["<all_urls>"]
  }]
  ```
- **VALIDATE**: `pnpm build`

### 16. CREATE `src/credential/credential.handler.test.ts`

- Mock `@/shared/webauthn` (`vi.mock`) to return controlled `VerifiedRegistration`.
- Tests: challenge returns 32-element `number[]`; valid registration calls storage; bad AAGUID rejects; no pending challenge rejects; `GET_CREDENTIAL_STATUS` returns `registered: true/false`; unrelated message returns `false`.
- **VALIDATE**: `pnpm test`

### 17. CREATE `src/blocklist/blocklist.handler.test.ts`

- Tests: `ADD_DOMAIN` calls `updateDynamicRules` with correct rule shape; URL input normalizes; duplicate ignored; `GET_BLOCKLIST` returns list; empty returns `[]`; unrelated message returns `false`.
- Mock: `chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined)`.
- **VALIDATE**: `pnpm test`

---

## VALIDATION COMMANDS

Execute in pyramid order — each level gates the next.

```bash
# Level 1: Syntax & Style
pnpm lint && pnpm format:check

# Level 2: Type Safety
pnpm typecheck

# Level 3: Tests
pnpm test

# Level 4: Build
pnpm build

# Level 5: Verify output structure
ls dist/service-worker.js dist/manifest.json dist/popup/popup.{html,css,js} dist/blocked/blocked.{html,css,js}
```

**Level 6: Manual** — Load unpacked `dist/` in `brave://extensions`, verify: popup opens with registration state, register key works, add domain works, blocked page shows domain.

---

## ACCEPTANCE CRITERIA

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass
- [ ] `dist/` contains exact structure (service-worker.js, manifest.json, popup/*, blocked/*)
- [ ] Extension loads without errors
- [ ] Popup shows registration/blocklist UI, both states work
- [ ] Blocked page shows domain name with shield icon
- [ ] `messages.ts` uses `number[]` for all binary wire fields
- [ ] No file exceeds 300 lines
- [ ] UI uses navy `#0f172a` background, blue `#3b82f6` accents

---

## NOTES

- **Logger in popup**: `createLogger` uses `process.env.VITEST` — may fail in browser. Use `console` in popup/blocked if needed.
- **AAGUID allowlist**: Only YubiKey 5 (`2fc0579f-...`) currently. Other keys will fail registration. Mock `verifyRegistration` in tests.
- **Rule ID strategy**: `1000 + index`. Full rule set rebuilt on every change — O(n) but fine for <100 domains.
- **Phase 3 stub**: Blocked page shows "unlock requires key" hint but no button yet.

**Confidence Score**: 10/10
