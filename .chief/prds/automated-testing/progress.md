## 2026-03-02 - US-008
- What was implemented: 22 unit tests for `popup.js` covering all UI event handlers and DOM rendering
- Files changed:
  - `tests/unit/popup.test.js` (new) — tests for add-domain form (button click, Enter key, invalid domain, input clearing, list rendering), remove domain (button click, list update), register security key (registerCredential call, key-registered/unregistered state, error messages, button re-enable), remove security key (CLEAR_CREDENTIAL message, confirm cancel, state switch), unlock duration (UPDATE_SETTINGS message, numeric value, all presets), initial state rendering (blocklist render, credential display)
  - `.chief/prds/automated-testing/prd.json` — US-008 marked passes: true
- **Learnings for future iterations:**
  - DOM must be set up via `document.body.innerHTML = POPUP_HTML` in `beforeAll` BEFORE dynamic import of popup.js — popup.js queries DOM elements at module load time
  - `loadState()` is called without `await` at the bottom of popup.js — use `await new Promise(r => setTimeout(r, 0))` in beforeAll to flush the async operations
  - `window.confirm` in jsdom returns `false` by default — use `vi.spyOn(window, 'confirm').mockReturnValue(true)` for tests that click remove-key-btn
  - Event listeners attached at module load persist across tests — `beforeEach` should reset DOM element state (hidden flags, innerHTML, value) to ensure test isolation
  - `setupChromeMock()` in `beforeEach` replaces `global.chrome` — popup.js references `chrome` as a global at call time (not import time), so new mock is picked up correctly
  - `vi.clearAllMocks()` clears call history on all mocks but preserves `mockResolvedValue` — call it before setting up test-specific implementations
  - `flushAsync()` helper (setTimeout 0) reliably flushes popup.js's async handlers in all tests
---

## Codebase Patterns
- service-worker.js registers event listeners at module load time — set up `global.chrome` via `setupChromeMock()` in `beforeAll` BEFORE the dynamic `import('../../service-worker.js')`, then capture handlers via `addListener.mock.calls[0][0]`
- Dynamic import in `beforeAll` (not static import) is required for service-worker.js so that chrome mock is in place when listeners are registered
- `vi.mock()` is hoisted; use `const { fn } = await import('lib/...')` after the `vi.mock()` call to get the mocked function reference in ESM
- `vi.clearAllMocks()` in `beforeEach` resets call history but NOT `mockResolvedValue` implementations — safe to use for shared mocks like `verifyAssertionData`
- `pendingChallenges` in service-worker.js is module-level state; it persists across tests but challenges are always consumed on `UNLOCK_DOMAIN`, so tests are isolated as long as each sets up its own challenge
- In the jsdom/vitest environment, `ArrayBuffer.prototype.slice()` produces a vm-context ArrayBuffer that Node.js's `crypto.subtle.importKey` rejects. Pass a Uint8Array (TypedArray) directly instead — it is accepted as an ArrayBufferView by importKey in all environments.
- All lib/ files use ES module `export` syntax — use `type: "module"` in package.json
- vitest.config.js uses `resolve.alias` to map `lib/` → project root `lib/` directory
- Chrome mock uses `vi.fn()` (vitest global) — `globals: true` must be set in vitest config
- `chrome.storage.local.get` mock needs to handle string, array, object, and null key forms
- lib/webauthn.js imports from `./cbor.js` and `./storage.js` (relative) — no alias needed inside lib/
- service-worker.js imports via `./lib/...` paths (relative to root)

---

## 2026-03-02 - US-001
- What was implemented: Vitest test infrastructure with jsdom environment, Chrome API mock helper, and directory structure
- Files changed:
  - `package.json` (new) — vitest, @vitest/coverage-v8, jsdom as devDependencies; `npm test` runs `vitest run`
  - `vitest.config.js` (new) — jsdom environment, globals: true, lib/ alias
  - `tests/helpers/chrome-mock.js` (new) — setupChromeMock() stubs chrome.storage.local, .runtime, .declarativeNetRequest, .alarms, .tabs
  - `tests/unit/infrastructure.test.js` (new) — sanity tests verifying mock setup and lib/ alias
  - `tests/unit/.gitkeep`, `tests/flows/.gitkeep` (new) — directory structure
- **Learnings for future iterations:**
  - vitest globals (`vi`, `describe`, `it`, `expect`, `beforeEach`) are available without imports when `globals: true` is set
  - The `lib/` alias in vitest.config.js uses `resolve(__dirname, 'lib')` — __dirname works in vitest configs even with type:module because vitest transforms the config
  - `setupChromeMock()` sets `global.chrome` directly; call it in `beforeEach` to get a fresh mock per test
  - `chrome.storage.local._storage` provides direct access to the backing store for test assertions
  - npm install produced 6 moderate vulnerabilities from jsdom/whatwg-encoding — these are dev-only and acceptable
---

## 2026-03-02 - US-003
- What was implemented: 25 unit tests for `lib/cbor.js` covering all CBOR major types and error cases
- Files changed:
  - `tests/unit/cbor.test.js` (new) — tests for unsigned int, negative int, byte string, text string, array, map, nested structures, simple values (true/false/null), and error handling
  - `.chief/prds/automated-testing/prd.json` — US-003 marked passes: true
- **Learnings for future iterations:**
  - `cborDecode` accepts ArrayBuffer or TypedArray (Uint8Array etc.) — the `bytes(...args)` helper using `new Uint8Array(args).buffer` works well for inline test data
  - CBOR major types encoded in high 3 bits: 0=uint, 1=neg, 2=bytes, 3=text, 4=array, 5=map, 7=simple; type 6 (tag) is unsupported and throws
  - Map keys are coerced to strings in the output object (e.g. integer key 1 → string key "1")
  - Indefinite-length encoding (additionalInfo=31) throws "CBOR: unsupported length encoding"
  - Empty buffer (bytes()) causes DataView read to throw (RangeError), satisfying the truncated input test
---

## 2026-03-02 - US-004
- What was implemented: 26 unit tests for `lib/storage.js` covering all storage read/write/delete operations
- Files changed:
  - `tests/unit/storage.test.js` (new) — tests for getBlocklist/setBlocklist, getCredential/setCredential/clearCredential, getUnlocks/setUnlock/removeUnlock, getSettings/updateSettings
  - `.chief/prds/automated-testing/prd.json` — US-004 marked passes: true
- **Learnings for future iterations:**
  - `chrome.storage.local._storage` from the mock allows direct read/write for test setup and assertion
  - Default values in `storage.js` use `?? DEFAULTS[key]` — so if storage returns `undefined`, the default kicks in
  - `updateSettings` validates `unlockDurationMinutes` must be integer, finite, 1–1440; boundary values (1, 1440) are valid
  - `setUnlock` and `removeUnlock` do a read-modify-write cycle internally, so the mock's `get`/`set` both get called
---

## 2026-03-02 - US-005
- What was implemented: 13 unit tests for `lib/blocker.js` covering syncBlockRules, unlockDomain, relockDomain, and getDynamicRules
- Files changed:
  - `tests/unit/blocker.test.js` (new) — tests for block rule creation/removal, allow rule creation/removal, unlocked domain skipping, ID assignment, serialized concurrent unlocks
  - `.chief/prds/automated-testing/prd.json` — US-005 marked passes: true
- **Learnings for future iterations:**
  - `blocker.js` uses module-level `_allowRuleQueue` promise chain — tests must be careful about test isolation since the queue persists across tests (fresh mock per `beforeEach` keeps this clean)
  - `syncBlockRules` filters block IDs as 1–9999 and allow IDs as 10001–19999 (separate ranges)
  - `relockDomain` matches by `condition.urlFilter === \`||${domain}/\`` — the double-pipe prefix is part of the URL filter pattern
  - `unlockDomain` uses `Math.max(...allowIds) + 1` for next ID — when no allow rules exist, starts at ALLOW_ID_BASE (10001)
  - `getDynamicRules` mock returns `[]` by default; use `mockResolvedValue` to set up custom rule lists per test
---

## 2026-03-02 - US-006
- What was implemented: 13 unit tests for `lib/webauthn.js` covering `registerCredential` and `verifyAssertionData` with real ECDSA P-256 crypto
- Files changed:
  - `tests/unit/webauthn.test.js` (new) — registerCredential tests (success shape, storage persistence, transport rejection for 'internal'/'hybrid', hardware transport acceptance, AAGUID allowlist enforcement); verifyAssertionData tests (successful verification, challenge mismatch, wrong clientData.type, invalid signature, sign count clone detection, sign count reset anomaly)
  - `lib/webauthn.js` — fixed `importPublicKey` to pass `Uint8Array` directly instead of `spkiBytes.buffer.slice(...)` to avoid jsdom cross-realm ArrayBuffer rejection
  - `.chief/prds/automated-testing/prd.json` — US-006 marked passes: true
- **Learnings for future iterations:**
  - `navigator.credentials` must be stubbed using `vi.stubGlobal('navigator', { credentials: { create: vi.fn(), get: vi.fn() } })` with matching `vi.unstubAllGlobals()` in afterEach
  - `chrome.runtime.getURL('')` in the real Chrome returns a URL ending with `/`; the mock must mimic this (e.g. `path === '' ? '${ORIGIN}/' : ...`) so `.slice(0, -1)` gives the correct origin
  - `verifyAssertionData` does NOT call `navigator.credentials.get` — it takes pre-fetched assertion parts; only `registerCredential` calls `navigator.credentials.create`
  - For real signature tests: WebCrypto `sign()` returns IEEE P1363 format (r||s); webauthn.js expects DER format (from real authenticators), so tests must convert P1363 → DER before passing to `verifyAssertionData`
  - Build the CBOR attestation object manually: `A1 68 "authData" 58 <len> <authData bytes>` — authData bytes 37-52 hold the AAGUID
  - `buildValidAssertion` helper must compute `SHA-256(rpId)` and embed it in authData bytes 0-31; rpId = `new URL(ORIGIN).hostname`
  - `beforeAll` is the right place for expensive key generation; `beforeEach` for fresh chrome mock + navigator stub
---

## 2026-03-02 - US-007
- What was implemented: 19 unit tests for `service-worker.js` covering ADD_DOMAIN, REMOVE_DOMAIN, UNLOCK_DOMAIN message handlers, relock alarm handler, and GET_STATE
- Files changed:
  - `tests/unit/service-worker.test.js` (new) — tests for all message types and alarm handler
  - `.chief/prds/automated-testing/prd.json` — US-007 marked passes: true
- **Learnings for future iterations:**
  - Must set up `global.chrome` before dynamically importing service-worker.js — use `beforeAll` with `setupChromeMock()` then `await import('../../service-worker.js')`
  - Capture listener callbacks via `addListener.mock.calls[0][0]` after the import
  - `vi.mock('lib/webauthn.js', ...)` with `await import('lib/webauthn.js')` (top-level await) gives access to the mocked function for per-test configuration
  - `vi.clearAllMocks()` in `beforeEach` clears call history without removing `mockResolvedValue` — safe for resetting between tests
  - `setupUnlock()` helper: seeds storage with blocklist + credential, then calls `GET_CHALLENGE` to issue a pending challenge — covers the full UNLOCK_DOMAIN preconditions
  - FAKE_B64 = 'AAAA' is valid base64url (decodes to 3 null bytes) — sufficient for mocked paths where `verifyAssertionData` doesn't inspect the payload
---

## 2026-03-02 - US-002
- What was implemented: 25 unit tests for `lib/normalize.js` covering all normalization edge cases
- Files changed:
  - `tests/unit/normalize.test.js` (new) — tests for protocol stripping, www removal, port stripping, path/query/hash stripping, trailing dot stripping, lowercasing, already-normalized input, invalid inputs (null, non-string, no-dot, spaces, wildcard chars)
  - `.chief/prds/automated-testing/prd.json` — US-002 marked passes: true
- **Learnings for future iterations:**
  - `normalizeDomain` returns `null` for inputs with `*`, `^`, `|` (URL filter special chars), no dot, spaces, empty string, or non-string
  - `lib/normalize.js` exports a single named export `normalizeDomain` — import via the `lib/` alias works directly
  - No chrome mock needed for normalize tests — it's a pure function with no side effects
---
