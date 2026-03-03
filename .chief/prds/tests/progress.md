## Codebase Patterns
- For blocked.js tests: use `Object.defineProperty(window, 'location', { value: { search, href: '' }, writable: true, configurable: true })` to mock location before each import
- Use `Object.defineProperty(global.navigator, 'credentials', { value: { get: vi.fn() }, writable: true, configurable: true })` to mock credentials API in jsdom
- `await flush()` (= `new Promise(resolve => setTimeout(resolve, 0))`) flushes all pending microtasks after triggering a click — sufficient because sendMessage callbacks are called synchronously by the mock
- The synchronous part of an async click handler (e.g. disabling a button, setting text) runs before the first `await`, so you can assert it immediately after `.click()` without awaiting
- vitest and jsdom are already installed in `node_modules/` (no npm install needed)
- Use `passWithNoTests: true` in vitest config to avoid exit code 1 with no test files
- Project root: `/Users/adriano/code/focus-guard/`
- Test files go in `test/**/*.test.js`
- Chrome mock in `test/mocks/chrome.js` — use `buildChromeMock()` in `beforeEach`; access `chrome.storage.local._data` to pre-seed storage state
- Use `vi.resetModules()` + dynamic `import()` in `beforeEach` to get fresh module state (especially for module-level Maps like `pendingChallenges`)
- `vi.mock('../lib/webauthn.js')` at top level works with `vi.resetModules()` — mock factory re-executes on each re-import, yielding fresh `vi.fn()` instances
- Import the mocked module after `vi.resetModules()` to get fresh mock references for `.mockResolvedValue()` etc.
- `vi.useFakeTimers()` + `vi.setSystemTime()` works for testing time-dependent logic; call `vi.useRealTimers()` in `afterEach` to clean up

---

## 2026-03-02 - US-001
- What was implemented: Created `package.json` with `"type": "module"` and `"test": "vitest run"` script, and `vitest.config.js` with jsdom environment and `test/**/*.test.js` pattern
- Files changed: `package.json`, `vitest.config.js`
- **Learnings for future iterations:**
  - vitest exits with code 1 when no test files found; fixed with `passWithNoTests: true` in config
  - Both vitest and jsdom are already in `node_modules/` — no need to install
  - The `node_modules/` is in `.gitignore` so only config files need to be committed
---

## 2026-03-02 - US-003
- What was implemented: Added `export` keyword to `handleMessage` function in `service-worker.js`
- Files changed: `service-worker.js`, `.chief/prds/tests/prd.json`
- **Learnings for future iterations:**
  - `handleMessage` is now importable directly in tests — import it with `import { handleMessage } from '../service-worker.js'`
  - The function is still wired to `onMessage` inside the same file, so runtime behavior is unchanged
---

## 2026-03-02 - US-004
- What was implemented: Created `test/service-worker.test.js` with 24 tests covering all `handleMessage` cases: GET_STATE, GET_BLOCKLIST, ADD_DOMAIN (4 cases), REMOVE_DOMAIN (3 cases), GET_CHALLENGE (3 cases), UNLOCK_DOMAIN (8 cases), UPDATE_SETTINGS (2 cases), CLEAR_CREDENTIAL, unknown type
- Files changed: `test/service-worker.test.js`, `.chief/prds/tests/prd.json`
- **Learnings for future iterations:**
  - `pendingChallenges` is module-level state in `service-worker.js` — use `vi.resetModules()` + dynamic import in `beforeEach` to get a fresh map each test
  - Mock `lib/webauthn.js` at top level with `vi.mock()` — after `vi.resetModules()`, re-import the mocked module to get fresh `vi.fn()` references
  - Pre-seed `chrome.declarativeNetRequest` rules by calling `updateDynamicRules({ addRules: [...] })` on the mock directly
  - `storage.js` uses `result[key] ?? DEFAULTS[key]` — unset keys correctly fall back to defaults (e.g. `credential: null`, `unlocks: {}`)
  - UNLOCK_DOMAIN checks blocklist BEFORE checking pending challenge — "domain not in blocklist" test doesn't need a prior GET_CHALLENGE
---

## 2026-03-02 - US-005
- What was implemented: Created `test/blocked.test.js` with 14 tests covering domain display, open-redirect guard, unlock button enabled state, full unlock flow, and error handling
- Files changed: `test/blocked.test.js`, `.chief/prds/tests/prd.json`
- **Learnings for future iterations:**
  - Mock `window.location` with `Object.defineProperty(window, 'location', { value: { search, href: '' }, writable: true, configurable: true })` — set BEFORE `loadBlocked()` since blocked.js reads `window.location.search` at module load time
  - `Object.defineProperty(global.navigator, 'credentials', { value: { get: vi.fn() }, writable: true, configurable: true })` works in jsdom to add the Credentials API
  - A `flush()` helper (`new Promise(resolve => setTimeout(resolve, 0))`) reliably flushes the entire async click handler chain because all sendMessage callbacks are synchronous in the mock
  - The synchronous part of the click handler (disabling button, setting "Verifying…") runs before the first `await`, so can be asserted right after `.click()` before `await flush()`
  - `vi.mock('../lib/webauthn.js')` at top level mocks both `base64urlDecode` and `base64urlEncode` — blocked.js uses both
  - `lib/normalize.js` does NOT need to be mocked — real normalization is needed for the open-redirect guard test (`Reddit.com` → `reddit.com`)
---

## 2026-03-02 - US-002
- What was implemented: Created `test/mocks/chrome.js` with `buildChromeMock()` factory covering all chrome API surfaces used by the extension
- Files changed: `test/mocks/chrome.js`, `.chief/prds/tests/prd.json`
- **Learnings for future iterations:**
  - `chrome.storage.local._data` is the backing object — pre-seed it directly in tests to set initial state
  - `chrome.alarms.onAlarm.trigger(alarm)` helper allows tests to fire alarm events
  - `chrome.declarativeNetRequest` mock maintains an in-memory `rulesArray` that `getDynamicRules` returns as a copy
  - `chrome.storage.local.get` handles string, array, or object-with-defaults key forms, matching the real Chrome API
---
