# Focus Guard — Integration Tests

## Overview

Add an integration-style test suite covering `service-worker.js`, `blocked.js`, and `popup.js`.
Tests exercise real application logic end-to-end while mocking all external services:
`chrome.*` APIs, `navigator.credentials`, and `chrome.storage.local` state.

**Toolchain:** Vitest (already installed) + jsdom (already installed). No new runtime
dependencies. A `package.json` and `vitest.config.js` must be added to wire everything up.

**Approach per file:**
- `service-worker.js` — export `handleMessage`, drive it directly, mock Chrome APIs
- `blocked.js` / `popup.js` — set up a matching jsdom DOM, then dynamically `import()` the
  module so top-level code runs against the mocked environment

---

## User Stories

### US-001: Add package.json and vitest configuration
**Priority:** 1
**Description:** As a developer, I want `npm test` to discover and run all test files so the
suite can be executed with a single command.

**Acceptance Criteria:**
- [ ] `package.json` exists at the repo root with `"type": "module"` and a `"test"` script
      that runs `vitest run`
- [ ] `vitest.config.js` configures the `jsdom` environment globally and sets the test file
      pattern to `test/**/*.test.js`
- [ ] Running `npm test` with no test files present exits cleanly (no crash)

---

### US-002: Create shared Chrome API mock
**Priority:** 2
**Description:** As a developer, I want a single reusable mock for `chrome.*` so every test
file gets consistent, controllable stubs without boilerplate.

**Acceptance Criteria:**
- [ ] `test/mocks/chrome.js` exports a `buildChromeMock()` factory that returns a fresh mock
      object on each call (prevents state leakage between tests)
- [ ] The mock covers every `chrome` API surface used by the three files:
  - `chrome.runtime.sendMessage(msg, cb)` — `vi.fn()`, invokes `cb` with a configurable
    return value
  - `chrome.storage.local.get(key)` / `.set(obj)` / `.remove(key)` — backed by a plain
    in-memory JS object so tests can pre-seed state and inspect writes
  - `chrome.declarativeNetRequest.getDynamicRules()` / `.updateDynamicRules(delta)` —
    `vi.fn()` backed by an in-memory rules array
  - `chrome.alarms.create(name, opts)` / `.clear(name)` / `onAlarm.addListener(fn)` —
    `vi.fn()` stubs; `onAlarm` exposes a `trigger(alarm)` helper for tests
  - `chrome.runtime.onInstalled.addListener` / `onStartup.addListener` / `onMessage.addListener`
    — `vi.fn()` stubs (service-worker event wiring is not exercised through these in tests)
  - `chrome.runtime.getURL(path)` — returns a deterministic string like
    `chrome-extension://test-extension-id${path}`
- [ ] Each test file assigns `global.chrome = buildChromeMock()` in `beforeEach` and resets
      it in `afterEach`

---

### US-003: Export `handleMessage` from service-worker.js
**Priority:** 3
**Description:** As a developer, I want to call the service worker's message handler directly
in tests so I can exercise all message types without wiring up `chrome.runtime.onMessage`.

**Acceptance Criteria:**
- [ ] `handleMessage(message)` is exported from `service-worker.js` (add the `export` keyword)
- [ ] All existing behaviour is unchanged — the function is still wired to `onMessage` inside
      the same file
- [ ] No other refactoring is required

---

### US-004: Service worker integration tests
**Priority:** 4
**Description:** As a developer, I want tests for every `handleMessage` case so I can verify
the service worker handles valid input, rejects invalid input, and manages storage/rules
correctly.

**Acceptance Criteria:**
- [ ] Test file: `test/service-worker.test.js`
- [ ] `GET_STATE` — returns current blocklist, credential, unlocks, and settings from storage
- [ ] `GET_BLOCKLIST` — returns current blocklist
- [ ] `ADD_DOMAIN`:
  - [ ] Valid domain is appended to blocklist and syncBlockRules is called
  - [ ] Duplicate domain is silently ignored
  - [ ] Currently-unlocked domain is re-locked (allow rule removed, alarm cleared) when added
  - [ ] Invalid domain string returns `{ error: "Invalid domain." }`
- [ ] `REMOVE_DOMAIN`:
  - [ ] Domain is removed from blocklist and syncBlockRules is called
  - [ ] Currently-unlocked domain has its allow rule and alarm cleaned up on removal
  - [ ] Invalid domain string returns `{ error: "Invalid domain." }`
- [ ] `GET_CHALLENGE`:
  - [ ] Valid domain in the blocklist returns `{ challenge: "<base64url>" }`
  - [ ] Domain not in blocklist returns `{ error: "Domain is not in the blocklist." }`
  - [ ] Invalid domain string returns `{ error: "Invalid domain." }`
- [ ] `UNLOCK_DOMAIN`:
  - [ ] No pending challenge returns `{ error: "No pending challenge…" }`
  - [ ] Expired challenge returns `{ error: "Challenge expired…" }` (advance time with
        `vi.setSystemTime`)
  - [ ] Challenge is consumed (deleted) on both success and failure
  - [ ] Domain not in blocklist returns `{ error: "Domain is not in the blocklist." }`
  - [ ] No registered credential returns `{ error: "No credential registered." }`
  - [ ] `verifyAssertionData` is mocked; on mock success the function adds an allow rule,
        stores an unlock record, creates an alarm, and returns `{ success: true }`
  - [ ] `verifyAssertionData` mock throws → handler returns `{ error: <err.message> }`
- [ ] `UPDATE_SETTINGS`:
  - [ ] Valid `unlockDurationMinutes` (e.g. 15) persists and returns updated settings
  - [ ] Value 0, -1, 1441, `Infinity`, and a string all return a validation error
- [ ] `CLEAR_CREDENTIAL` — removes credential and returns `{ success: true }`
- [ ] Unknown message type — returns `{ error: "Unknown message type: …" }`

---

### US-005: blocked.js integration tests
**Priority:** 5
**Description:** As a developer, I want tests that exercise `blocked.js` against a real jsdom
DOM so I can verify the page renders correctly, enforces the open-redirect guard, and
completes the full unlock flow.

**Acceptance Criteria:**
- [ ] Test file: `test/blocked.test.js`
- [ ] `beforeEach` sets up the DOM with the exact element IDs used by `blocked.js`
      (`domain-display`, `unlock-btn`, `status-msg`), configures `global.chrome`, and
      mocks `navigator.credentials`
- [ ] The module is loaded with a dynamic `import()` after DOM + mocks are in place; the
      module cache is cleared between tests using `vi.resetModules()`
- [ ] **Domain display:**
  - [ ] `?domain=reddit.com` → `#domain-display` shows `reddit.com`
  - [ ] No `?domain` param → `#domain-display` shows `Unknown site`
- [ ] **Open-redirect guard (GET_STATE on load):**
  - [ ] Domain present in `response.blocklist` → unlock button remains visible
  - [ ] Domain absent from `response.blocklist` → unlock button is hidden, status shows
        error message
  - [ ] `normalizeDomain` is applied before the blocklist check (e.g. `?domain=Reddit.com`
        is normalised to `reddit.com` before comparison)
- [ ] **Unlock button enabled state:**
  - [ ] `response.credential` is non-null → button is enabled
  - [ ] `response.credential` is null → button stays disabled
- [ ] **Full unlock flow (click):**
  - [ ] `GET_STATE` → `GET_CHALLENGE` → `navigator.credentials.get` → `UNLOCK_DOMAIN` →
        `window.location.href` set to `https://reddit.com`
  - [ ] Button label changes to `"Verifying…"` during the flow and is re-enabled if an
        error occurs
- [ ] **Error handling:**
  - [ ] `GET_CHALLENGE` returns an error → status message shows the error, button re-enabled
  - [ ] `UNLOCK_DOMAIN` returns an error → status message shows the error, button re-enabled
  - [ ] `navigator.credentials.get` throws `NotAllowedError` → status shows
        `"Verification cancelled."`, button re-enabled
  - [ ] Generic error thrown → status shows `"Error: <message>"`, button re-enabled

---

### US-006: popup.js integration tests
**Priority:** 6
**Description:** As a developer, I want tests that exercise `popup.js` against a real jsdom
DOM so I can verify initial state rendering, blocklist management, key registration, and
settings changes.

**Acceptance Criteria:**
- [ ] Test file: `test/popup.test.js`
- [ ] `beforeEach` sets up the DOM with all element IDs used by `popup.js` (`domain-input`,
      `add-btn`, `error-msg`, `success-msg`, `blocklist`, `key-unregistered`, `key-registered`,
      `key-info`, `key-error`, `register-btn`, `remove-key-btn`, `unlock-duration`),
      configures `global.chrome`, and mocks `registerCredential` from `lib/webauthn.js`
- [ ] Module is reloaded per test via `vi.resetModules()` and dynamic `import()`
- [ ] **Initial load (`loadState`):**
  - [ ] Blocklist renders one `<li>` per domain with a remove button
  - [ ] `credential: null` → `#key-unregistered` is visible, `#key-registered` is hidden
  - [ ] `credential` present → `#key-registered` is visible, AAGUID and date shown in
        `#key-info`
  - [ ] Settings with `unlockDurationMinutes: 15` → `#unlock-duration` select is set to `"15"`
- [ ] **Add domain:**
  - [ ] Valid input `"reddit.com"` → `ADD_DOMAIN` message sent, list re-renders, input cleared,
        success message shown
  - [ ] Input normalised before sending (e.g. `"https://Reddit.com/r/foo"` → `"reddit.com"`)
  - [ ] Invalid input (e.g. `"not a domain"`) → error message shown, no message sent
  - [ ] Enter key on the input triggers add domain
- [ ] **Remove domain:**
  - [ ] Clicking the `×` button on a list item sends `REMOVE_DOMAIN` and re-renders the list
- [ ] **Register key:**
  - [ ] `registerCredential` mock resolves → `renderKeyState` is called with the credential,
        `#key-registered` becomes visible
  - [ ] `registerCredential` mock rejects with `NotAllowedError` → key error shown as
        `"Registration cancelled."`
  - [ ] `registerCredential` mock rejects with a generic error → key error shows `err.message`
  - [ ] Button is disabled during registration and re-enabled after (success or failure)
- [ ] **Remove key:**
  - [ ] `window.confirm` returns `false` → no message sent, key state unchanged
  - [ ] `window.confirm` returns `true` → `CLEAR_CREDENTIAL` sent, `#key-unregistered`
        becomes visible
- [ ] **Settings:**
  - [ ] Changing `#unlock-duration` select sends `UPDATE_SETTINGS` with the selected number
