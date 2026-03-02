## Codebase Patterns
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
