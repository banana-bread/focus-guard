# Feature: Phase 1A — Core Infrastructure (messages, storage, config, domain, service-worker skeleton)

The following plan should be complete, but validate codebase patterns and task sanity before implementing.

Pay special attention to naming of existing types and imports. Use `@/` path alias throughout.

## Feature Description

Implement the Focus Guard-specific core infrastructure that all feature slices depend on. This is Pass A of MVP Phase 1 — everything except `shared/crypto.ts` (which is planned separately due to WebAuthn/CBOR complexity).

Files produced:
- `src/core/messages.ts` — typed discriminated union message protocol
- `src/core/storage.ts` — `chrome.storage.local` abstraction + key constants
- `src/core/config.ts` — RP ID, AAGUID allowlist, challenge TTL, transport constants
- `src/shared/domain.ts` — domain normalization utility
- `src/service-worker.ts` — entry point with message handler fan-out skeleton
- Updates to `manifest.json` and `vite.config.ts` to wire in the service worker

## User Story

As the Focus Guard service worker,
I want typed message contracts, a storage abstraction, and a configuration module,
So that all feature slices can be implemented without re-inventing infrastructure.

## Problem Statement

The scaffold (toolchain, logger, Chrome mock) is complete but there are no Focus Guard-specific types, storage helpers, or configuration. Feature slices cannot be written until these foundations exist.

## Solution Statement

Create the five infrastructure files in dependency order (config → storage → messages → domain → service-worker), each with JSDoc, strict types, and unit tests where behaviour exists to test.

## Feature Metadata

**Feature Type**: New Capability (infrastructure)
**Estimated Complexity**: Low–Medium
**Primary Systems Affected**: `core/`, `shared/`, `src/service-worker.ts`, `manifest.json`, `vite.config.ts`
**Dependencies**: None beyond existing scaffold

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `src/core/logger.ts` (all) — Pattern for how `core/` modules are structured: exported types, exported factory/function, JSDoc on everything exported, no default exports
- `src/core/logger.test.ts` (all) — Test pattern: `describe`/`it`/`expect`, import via `@/core/...`, vitest globals
- `src/__mocks__/chrome.ts` (all) — Chrome API mock already set up as vitest `setupFiles`; `chrome.storage.local`, `chrome.runtime`, `chrome.alarms`, `chrome.declarativeNetRequest` are all mocked with `vi.fn()`
- `vitest.config.ts` — `setupFiles: ['src/__mocks__/chrome.ts']` runs before every test; `globals: true`; `environment: 'jsdom'`; `@/` alias resolves to `src/`
- `tsconfig.json` — `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`; `@/` resolves to `src/`; target ES2022
- `vite.config.ts` — Current entry points; needs service worker added
- `manifest.json` — Background service worker entry is `TODO`; needs updating
- `.agents/prds/mvp.md` §6 (Architecture), §7.2 (WebAuthn flow), §11 (Message Protocol), §16 (Storage Key Reference) — Canonical source for message types, storage keys, and config values

### New Files to Create

- `src/core/messages.ts`
- `src/core/storage.ts`
- `src/core/config.ts`
- `src/shared/domain.ts`
- `src/shared/domain.test.ts`
- `src/service-worker.ts`

### Files to Update

- `manifest.json` — set `background.service_worker` to `"service-worker.js"`; add required permissions
- `vite.config.ts` — add `service-worker` entry point; remove placeholder `index` entry

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [chrome.storage.local MDN/Chrome Docs](https://developer.chrome.com/docs/extensions/reference/api/storage)
  - Section: `StorageArea.get`, `StorageArea.set`, `StorageArea.remove`
  - Why: Storage abstraction must wrap the callback-based API in Promises correctly
- [chrome.runtime.onMessage](https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onMessage)
  - Why: Service worker message handler registration pattern; `sendResponse` must be called synchronously or the channel closes (return `true` to keep it open for async handlers)
- [Chromium MV3 Service Worker](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers)
  - Why: Confirms module-type service worker import syntax and lifecycle

### Patterns to Follow

**Module structure** (mirror `src/core/logger.ts`):
```typescript
// Named exports only — no default export
// Types first, then implementation
// JSDoc on every exported symbol
export type Foo = { ... };
export function doThing(...): ReturnType { ... }
```

**Logging** (every file that has runtime behaviour):
```typescript
import { createLogger } from '@/core/logger';
const logger = createLogger('service_worker'); // or 'popup' etc.
```

**Test file pattern** (mirror `src/core/logger.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { functionUnderTest } from '@/path/to/module';
describe('functionUnderTest', () => {
  it('does X', () => { expect(...).toBe(...); });
});
```

**Import alias**: Always `@/core/...` or `@/shared/...`, never relative `../`.

**No default exports** anywhere in the codebase.

**`exactOptionalPropertyTypes`**: Optional fields must use `T | undefined` explicitly — do not rely on `?:` alone when you also need `undefined` as a value.

---

## IMPLEMENTATION PLAN

### Phase 1: Constants and Config

Create `core/config.ts` first — it has no internal deps and every other file may import from it.

### Phase 2: Storage Abstraction

Create `core/storage.ts` — depends only on Chrome types and config key names.

### Phase 3: Message Protocol

Create `core/messages.ts` — depends on storage types defined in storage.ts.

### Phase 4: Domain Utility + Tests

Create `shared/domain.ts` + `shared/domain.test.ts` — pure function, no deps, easy to test fully.

### Phase 5: Service Worker Skeleton

Create `src/service-worker.ts` — fan-out handler skeleton. Imports messages, logger. No slice handlers yet (they don't exist); each slice will register itself in a later phase.

### Phase 6: Wire Up Build + Manifest

Update `vite.config.ts` and `manifest.json` to reference the service worker.

---

## STEP-BY-STEP TASKS

### CREATE `src/core/config.ts`

- **IMPLEMENT**: Export the following constants. All values come from `.agents/prds/mvp.md` §10:
  ```typescript
  export const RP_ID: string = chrome.runtime.id;
  export const RP_NAME = 'Focus Guard';
  export const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 120_000
  export const DEFAULT_UNLOCK_DURATION_MS = 30 * 60 * 1000; // 30 min
  export const AAGUID_ALLOWLIST: readonly string[] = [
    '2fc0579f-8113-47ea-b116-bb5a8db9202a', // YubiKey 5 series
    // Extend with additional trusted AAGUIDs as needed
  ];
  export const ALLOWED_TRANSPORTS: readonly AuthenticatorTransport[] = ['usb', 'nfc', 'ble'];
  export const REJECTED_TRANSPORTS: readonly AuthenticatorTransport[] = ['internal', 'hybrid'];
  ```
- **GOTCHA**: `AuthenticatorTransport` is a DOM type — already in lib via `tsconfig.json` `"lib": ["ES2022", "DOM"]`. No import needed.
- **GOTCHA**: `chrome.runtime.id` is only available at runtime inside the extension context. `RP_ID` is a `const` assignment that runs when the module is first imported — this is correct for service worker / popup contexts. Do NOT make it a function; the PRD specifies it as a constant.
- **JSDoc**: Add module-level JSDoc and JSDoc on each export.
- **VALIDATE**: `pnpm typecheck`

---

### CREATE `src/core/storage.ts`

- **IMPLEMENT**: A typed Promise-based wrapper around `chrome.storage.local` plus storage key constants.

  Storage keys (from PRD §16):
  ```typescript
  export const STORAGE_KEYS = {
    CREDENTIAL: 'credential',
    BLOCKLIST: 'blocklist',
    UNLOCK_SESSIONS: 'unlock_sessions',
    SETTINGS: 'settings',
  } as const;
  ```

  Data types (minimal shapes — slices own the full schemas):
  ```typescript
  export interface StoredCredential {
    credentialId: Uint8Array;
    publicKey: ArrayBuffer;
    signCounter: number;
    aaguid: string;
  }

  export type Blocklist = string[];

  export interface UnlockSession {
    expiresAt: number; // Unix ms
    duration: number;  // ms
  }

  export type UnlockSessions = Record<string, UnlockSession>;

  export interface Settings {
    defaultUnlockDurationMs: number;
  }
  ```

  Generic helpers:
  ```typescript
  export async function storageGet<T>(key: string): Promise<T | undefined>
  export async function storageSet<T>(key: string, value: T): Promise<void>
  export async function storageRemove(key: string): Promise<void>
  ```

- **PATTERN**: `chrome.storage.local.get` returns `{ [key]: value }`. Use `Promise` wrapping:
  ```typescript
  export async function storageGet<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] as T | undefined);
      });
    });
  }
  ```
- **GOTCHA**: `chrome.storage.local.set` takes `{ [key]: value }` — not `(key, value)`. Pass an object literal.
- **GOTCHA**: `exactOptionalPropertyTypes` — the generic `<T>` return of `undefined` is fine because `T | undefined` is explicit.
- **NOTE**: `StoredCredential` stores `credentialId` as `Uint8Array` — but `chrome.storage.local` serialises typed arrays as plain objects on read-back. The credential slice will handle (de)serialisation. `storage.ts` just owns the type shapes.
- **JSDoc**: All exports.
- **VALIDATE**: `pnpm typecheck`

---

### CREATE `src/core/messages.ts`

- **IMPLEMENT**: Full typed discriminated union protocol from PRD §11. Add `trace_id: string` to every message (required by logging rules in CLAUDE.md).

  ```typescript
  export type AssertionOperation = 'unlock' | 'remove_domain' | 'replace_credential';

  // UI → Service Worker
  export type RequestMessage =
    | { type: 'GET_REGISTRATION_CHALLENGE'; trace_id: string }
    | { type: 'REGISTER_CREDENTIAL'; attestation: ArrayBuffer; trace_id: string }
    | { type: 'GET_ASSERTION_CHALLENGE'; operation: AssertionOperation; domain?: string; trace_id: string }
    | { type: 'VERIFY_ASSERTION'; assertion: ArrayBuffer; operation: AssertionOperation; domain?: string; durationMs?: number; trace_id: string }
    | { type: 'ADD_DOMAIN'; domain: string; trace_id: string }
    | { type: 'GET_BLOCKLIST'; trace_id: string }
    | { type: 'GET_UNLOCK_SESSION'; domain: string; trace_id: string }
    | { type: 'GET_SETTINGS'; trace_id: string }
    | { type: 'SET_SETTINGS'; settings: Partial<import('@/core/storage').Settings>; trace_id: string };

  // Service Worker → UI
  export type ResponseMessage =
    | { ok: true; data: unknown }
    | { ok: false; error: string };

  // Helper to build a success response
  export function okResponse(data: unknown): ResponseMessage {
    return { ok: true, data };
  }

  // Helper to build an error response
  export function errResponse(error: string): ResponseMessage {
    return { ok: false, error };
  }
  ```

- **GOTCHA**: `import('@/core/storage').Settings` uses a type-only inline import to avoid a circular dep risk. Alternatively, define `Settings` in `messages.ts` directly — but keeping it in `storage.ts` is correct per VSA (storage owns its own types).
- **GOTCHA**: `exactOptionalPropertyTypes` — `domain?: string` is fine here because these are external message shapes; the service worker will validate presence before use.
- **NOTE**: `trace_id` is on every message, not just cross-boundary ones, because the service worker logs every received message including `trace_id`. UI contexts generate a `trace_id` (e.g. `crypto.randomUUID()`) before sending.
- **JSDoc**: Module-level JSDoc explaining this is the full message protocol. JSDoc on each type alias.
- **VALIDATE**: `pnpm typecheck`

---

### CREATE `src/shared/domain.ts`

- **IMPLEMENT**: A single exported function `normalizeDomain(input: string): string` that strips scheme, `www.`, path, query string, and hash. Returns lowercase hostname only.

  ```typescript
  /**
   * Normalises a raw user input string to a bare hostname.
   * Strips scheme, www. prefix, path, query, and hash.
   *
   * @param input - Raw string e.g. "https://www.reddit.com/r/programming?foo=bar"
   * @returns Normalised hostname e.g. "reddit.com"
   */
  export function normalizeDomain(input: string): string {
    // Prepend scheme if missing so URL() can parse it
    const withScheme = input.includes('://') ? input : `https://${input}`;
    const { hostname } = new URL(withScheme);
    return hostname.replace(/^www\./, '').toLowerCase();
  }
  ```

- **GOTCHA**: `new URL()` throws if given an unparseable string. The function should either throw (and callers catch) or return `null` on failure. Given strict type safety, prefer throwing and let callers handle it via try/catch with an error log. Do NOT silently swallow — per CLAUDE.md logging rules.
- **GOTCHA**: `URL` is a DOM/Node global — available in both browser and jsdom test environments. No import needed.
- **VALIDATE**: `pnpm typecheck`

---

### CREATE `src/shared/domain.test.ts`

- **IMPLEMENT**: Full coverage of `normalizeDomain`. Test cases:

  | Input | Expected output |
  |---|---|
  | `"reddit.com"` | `"reddit.com"` |
  | `"www.reddit.com"` | `"reddit.com"` |
  | `"https://reddit.com"` | `"reddit.com"` |
  | `"https://www.reddit.com"` | `"reddit.com"` |
  | `"https://www.reddit.com/r/programming"` | `"reddit.com"` |
  | `"https://www.reddit.com/r/programming?foo=bar#section"` | `"reddit.com"` |
  | `"HTTP://REDDIT.COM"` | `"reddit.com"` (lowercase) |
  | Invalid string (e.g. `"not a domain!!"`) | throws |

- **PATTERN**: Mirror `src/core/logger.test.ts` — `describe`/`it`/`expect`, import from `@/shared/domain`
- **VALIDATE**: `pnpm test`

---

### CREATE `src/service-worker.ts`

- **IMPLEMENT**: MV3 service worker entry point. Registers a `chrome.runtime.onMessage` listener that fans out to slice handlers. No slice handlers exist yet — the fan-out is a skeleton with a logged unhandled-type warning.

  ```typescript
  import { createLogger } from '@/core/logger';
  import type { RequestMessage, ResponseMessage } from '@/core/messages';
  import { errResponse } from '@/core/messages';

  const logger = createLogger('service_worker');

  chrome.runtime.onMessage.addListener(
    (msg: RequestMessage, _sender, sendResponse: (r: ResponseMessage) => void): true => {
      const { trace_id } = msg;

      logger.debug('message_received', { type: msg.type, trace_id });

      void handleMessage(msg, sendResponse, trace_id);

      // Return true to keep the message channel open for async response
      return true;
    },
  );

  async function handleMessage(
    msg: RequestMessage,
    sendResponse: (r: ResponseMessage) => void,
    trace_id: string,
  ): Promise<void> {
    const start = Date.now();
    try {
      switch (msg.type) {
        // Slice handlers will be added here in Phase 2+
        default: {
          logger.warn('message_unhandled', {
            type: (msg as RequestMessage).type,
            trace_id,
            fix_suggestion: 'Register a handler for this message type in service-worker.ts',
          });
          sendResponse(errResponse(`Unhandled message type: ${(msg as RequestMessage).type}`));
        }
      }
    } catch (err) {
      logger.error('message_handler_threw', {
        type: msg.type,
        trace_id,
        error: err instanceof Error ? err.message : String(err),
        fix_suggestion: 'Check the slice handler for this message type for unhandled exceptions',
      });
      sendResponse(errResponse('Internal error'));
    }
    logger.debug('message_handled', { type: msg.type, trace_id, duration_ms: Date.now() - start });
  }
  ```

- **GOTCHA**: `chrome.runtime.onMessage` listener must return `true` (not a Promise) to keep the response channel open for async handlers. The `void handleMessage(...)` pattern fires the async work without making the listener itself async.
- **GOTCHA**: TypeScript `noUnusedParameters` — prefix unused `_sender` with underscore.
- **GOTCHA**: The `switch` exhaustive default — `msg` typed as `RequestMessage` with no matched cases will have `never` type in the default branch. Cast to `RequestMessage` for the `.type` access to log it.
- **JSDoc**: Module-level JSDoc.
- **VALIDATE**: `pnpm typecheck`

---

### UPDATE `manifest.json`

- **IMPLEMENT**: Set `background.service_worker` to `"service-worker.js"` and add all required permissions from PRD §16 Appendix:
  ```json
  {
    "manifest_version": 3,
    "name": "Focus Guard",
    "version": "0.1.0",
    "description": "Block distracting websites; unlock with a hardware security key.",
    "permissions": [
      "declarativeNetRequest",
      "declarativeNetRequestFeedback",
      "storage",
      "alarms"
    ],
    "host_permissions": ["<all_urls>"],
    "background": {
      "service_worker": "service-worker.js",
      "type": "module"
    },
    "action": {
      "default_popup": "TODO: popup/popup.html"
    }
  }
  ```
- **NOTE**: `default_popup` remains `TODO` — popup HTML doesn't exist yet and will be added in Phase 2.
- **VALIDATE**: `pnpm build` — manifest should copy to `dist/`

---

### UPDATE `vite.config.ts`

- **IMPLEMENT**: Replace the placeholder `index` entry with `service-worker`. The `src/index.ts` stub can be removed (or kept as a barrel — but there is nothing to export yet, so remove it from the build).

  ```typescript
  rollupOptions: {
    input: {
      'service-worker': resolve(__dirname, 'src/service-worker.ts'),
    },
    ...
  }
  ```

- **GOTCHA**: Vite output `entryFileNames: '[name].js'` means `service-worker.ts` → `service-worker.js` in `dist/` — matching `manifest.json`.
- **VALIDATE**: `pnpm build` — `dist/service-worker.js` should exist

---

## TESTING STRATEGY

### Unit Tests

`shared/domain.test.ts` — full path coverage of `normalizeDomain`:
- Happy paths: bare domain, `www.` prefix, full URL, uppercase
- Error path: throws on unparseable input

No unit tests needed for `core/config.ts` (pure constants), `core/storage.ts` (thin wrapper — tested via integration in slice tests), or `core/messages.ts` (pure types + two trivial helpers). The helpers `okResponse`/`errResponse` are so trivial that a test would just duplicate the implementation.

`service-worker.ts` is a skeleton — meaningful integration tests will be added in Phase 2 when real slice handlers exist.

### Edge Cases

- `normalizeDomain` with empty string → `new URL('https://')` → hostname is `""` → return `""` or throw? Throw — an empty domain is invalid input.
- `normalizeDomain` with IP address → returns the IP as-is (no `www.` to strip). Acceptable for MVP.
- `normalizeDomain` with port → `new URL('https://reddit.com:443').hostname` returns `"reddit.com"` (no port). Correct.

---

## VALIDATION COMMANDS

### Level 1: Type Check
```bash
pnpm typecheck
```

### Level 2: Lint
```bash
pnpm lint
```

### Level 3: Unit Tests
```bash
pnpm test
```

### Level 4: Build
```bash
pnpm build
```
Verify `dist/service-worker.js` exists and `dist/manifest.json` has correct `background.service_worker`.

### Level 5: Manual
Load `dist/` as unpacked extension in `brave://extensions`. Confirm:
- Extension loads without errors
- Background service worker shows as active
- No console errors in service worker DevTools

---

## ACCEPTANCE CRITERIA

- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm lint` — zero errors
- [ ] `pnpm test` — all tests pass including new `domain.test.ts`
- [ ] `pnpm build` — succeeds; `dist/service-worker.js` exists
- [ ] `dist/manifest.json` has correct permissions and `service_worker: "service-worker.js"`
- [ ] `src/core/messages.ts` — every message type in PRD §11 is present with `trace_id`
- [ ] `src/core/storage.ts` — all 4 storage keys defined; `storageGet/Set/Remove` are Promise-based
- [ ] `src/core/config.ts` — all constants from PRD §10 present
- [ ] `src/shared/domain.ts` — `normalizeDomain` handles scheme/www/path/case
- [ ] `src/service-worker.ts` — registers `onMessage` listener; logs received/handled; returns `true` for async

---

## COMPLETION CHECKLIST

- [ ] Tasks completed in order
- [ ] `pnpm typecheck` passes after each file
- [ ] `pnpm test` passes after `domain.test.ts` created
- [ ] `pnpm build` passes after vite.config and manifest updates
- [ ] No linting errors
- [ ] All acceptance criteria met

---

## NOTES

**Why `trace_id` on every message?** CLAUDE.md mandates `trace_id` on all cross-boundary logs. Since every `chrome.runtime.sendMessage` is a cross-boundary call, adding it to the message type enforces this at the type system level rather than relying on per-handler discipline.

**Why no `okResponse`/`errResponse` tests?** These are one-liner constructors. Testing them would be testing TypeScript's object literal syntax, not business logic.

**`src/index.ts`** — Currently just `export {};`. It can be left as-is (Vite ignores it once removed from inputs) or deleted. Prefer removing it from `vite.config.ts` inputs only; file deletion is a separate manual step and not blocking.

**Confidence Score: 9/10** — All patterns exist in the codebase, types are fully specced in the PRD, no external APIs involved beyond `chrome.*` which is already mocked. The only risk is TypeScript strictness edge cases (especially `exactOptionalPropertyTypes`) — the gotchas above cover the known ones.
