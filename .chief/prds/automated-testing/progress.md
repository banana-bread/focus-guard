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
