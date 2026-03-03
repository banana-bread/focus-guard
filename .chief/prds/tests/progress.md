## Codebase Patterns
- vitest and jsdom are already installed in `node_modules/` (no npm install needed)
- Use `passWithNoTests: true` in vitest config to avoid exit code 1 with no test files
- Project root: `/Users/adriano/code/focus-guard/`
- Test files go in `test/**/*.test.js`
- Chrome mock in `test/mocks/chrome.js` — use `buildChromeMock()` in `beforeEach`; access `chrome.storage.local._data` to pre-seed storage state

---

## 2026-03-02 - US-001
- What was implemented: Created `package.json` with `"type": "module"` and `"test": "vitest run"` script, and `vitest.config.js` with jsdom environment and `test/**/*.test.js` pattern
- Files changed: `package.json`, `vitest.config.js`
- **Learnings for future iterations:**
  - vitest exits with code 1 when no test files found; fixed with `passWithNoTests: true` in config
  - Both vitest and jsdom are already in `node_modules/` — no need to install
  - The `node_modules/` is in `.gitignore` so only config files need to be committed
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
