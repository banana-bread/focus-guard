## Codebase Patterns
- vitest and jsdom are already installed in `node_modules/` (no npm install needed)
- Use `passWithNoTests: true` in vitest config to avoid exit code 1 with no test files
- Project root: `/Users/adriano/code/focus-guard/`
- Test files go in `test/**/*.test.js`

---

## 2026-03-02 - US-001
- What was implemented: Created `package.json` with `"type": "module"` and `"test": "vitest run"` script, and `vitest.config.js` with jsdom environment and `test/**/*.test.js` pattern
- Files changed: `package.json`, `vitest.config.js`
- **Learnings for future iterations:**
  - vitest exits with code 1 when no test files found; fixed with `passWithNoTests: true` in config
  - Both vitest and jsdom are already in `node_modules/` — no need to install
  - The `node_modules/` is in `.gitignore` so only config files need to be committed
---
