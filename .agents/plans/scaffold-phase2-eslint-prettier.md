# Feature: Scaffold Phase 2 — ESLint & Prettier

The following plan should be complete, but validate codebase state and task sanity before implementing.

Pay special attention to exact package names — `eslint-plugin-import` v2 has flat config bugs; this plan uses `eslint-plugin-import-x` instead. Also note the `eslint.config.ts` loading mechanism requires a Node flag (see GOTCHA below).

## Feature Description

Set up ESLint 9 (flat config), Prettier 3, `lint-staged`, and `simple-git-hooks` for the Focus Guard extension. When complete, `eslint src/` passes with zero errors, Prettier formatting is enforced via ESLint, and a pre-commit hook rejects commits that contain TypeScript errors or lint violations.

## User Story

As an AI coding agent (or developer) implementing feature slices,
I want automatic code-quality enforcement with zero configuration decisions,
So that I can write feature code without debating formatting, import style, or type safety — violations are caught before they land in git.

## Problem Statement

Phase 1 wired TypeScript, Vite, and Vitest but left `eslint.config.ts`, `.prettierrc`, and git hooks unconfigured. The `simple-git-hooks` `prepare` script is already in `package.json` but the hook isn't active. Currently nothing prevents a developer (or AI agent) from committing default exports, `console.log` calls, or unformatted code.

## Solution Statement

Create `eslint.config.ts` (TypeScript flat config) with `@typescript-eslint`, `eslint-plugin-import-x`, and `eslint-config-prettier`. Create `.prettierrc`. Activate `simple-git-hooks` by running `pnpm prepare`. Validate the entire chain end-to-end.

## Feature Metadata

**Feature Type**: New Capability (scaffold)
**Estimated Complexity**: Low-Medium
**Primary Systems Affected**: Linting, formatting, pre-commit hooks
**Dependencies**: `typescript-eslint`, `eslint-plugin-import-x`, `eslint-config-prettier`, `@eslint/js`, `jiti` (not needed — Node 22.14 supports `--experimental-strip-types`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — MUST READ BEFORE IMPLEMENTING

- `package.json` — current devDependencies (has `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint-plugin-import` — these will be REPLACED). Also has `lint-staged` and `simple-git-hooks` already installed.
- `tsconfig.json` — `strict: true`, `noImplicitAny: true`, `exactOptionalPropertyTypes: true`, `paths: { "@/*": ["src/*"] }`, `types: ["chrome", "vitest/globals"]`
- `tsconfig.node.json` — includes `eslint.config.ts` in its `include` array (already set up for this)
- `src/index.ts` — single-line `export {};` stub (the only src file at this point)
- `src/__mocks__/chrome.ts` — single-line `export {};` placeholder

### New Files to Create

- `eslint.config.ts` — ESLint 9 flat config (TypeScript)
- `.prettierrc` — Prettier options

### Files to Update

- `package.json` — replace `eslint-plugin-import` with `eslint-plugin-import-x`; add `typescript-eslint`, `@eslint/js`, `eslint-config-prettier`; update `lint-staged` config; update `test` script if needed

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [typescript-eslint flat config setup](https://typescript-eslint.io/getting-started/)
  - Why: Correct `tseslint` plugin/parser wiring for ESLint 9
- [eslint-plugin-import-x flat config](https://github.com/un-ts/eslint-plugin-import-x)
  - Why: Drop-in replacement for `eslint-plugin-import` with full flat config support; rules use `import-x/` prefix
- [eslint-config-prettier flat config](https://github.com/prettier/eslint-config-prettier)
  - Why: Import path is `eslint-config-prettier/flat` for flat config; must be placed last
- [ESLint config with TypeScript](https://eslint.org/docs/latest/use/configure/configuration-files#typescript-configuration-files)
  - Why: Node 22.14+ can load `eslint.config.ts` via `--experimental-strip-types` flag; no `jiti` needed
- [Prettier options](https://prettier.io/docs/options)
  - Why: `.prettierrc` field reference

---

## Patterns to Follow

**ESLint `files` override for test files** (relax `no-console` and `import-x/no-default-export`):
```typescript
{
  files: ['**/*.test.ts', '**/*.spec.ts', 'src/__mocks__/**/*.ts'],
  rules: {
    'no-console': 'off',
    'import-x/no-default-export': 'off',
  },
},
```

**Named exports only** — the key grep-ability rule:
```typescript
'import-x/no-default-export': 'error',
```

**Structured logging enforcement** — no raw `console.*`:
```typescript
'no-console': 'error',
```

**Explicit return types** — all exported functions must declare return type:
```typescript
'@typescript-eslint/explicit-function-return-type': 'error',
```

**`lint-staged` config** — runs ESLint on staged TS files, plus typecheck:
```json
"lint-staged": {
  "src/**/*.ts": ["eslint --fix", "tsc --noEmit"]
}
```

**IMPORTANT**: `tsc --noEmit` in `lint-staged` checks the full project (not just staged files). This is intentional — it catches cross-file type errors introduced by a staged change.

---

## IMPLEMENTATION PLAN

### Phase 1: Update dependencies

Replace `eslint-plugin-import` (v2, flat config bugs) with `eslint-plugin-import-x`. Add `typescript-eslint` (unified package that re-exports parser + plugin), `@eslint/js`, and `eslint-config-prettier`.

### Phase 2: Create `eslint.config.ts`

TypeScript flat config using `defineConfig` from `eslint/config`. Layers:
1. `eslint.configs.recommended` (base JS rules)
2. `tseslint.configs.recommended` (TS type-safe rules)
3. Custom rules object (parser, project service, explicit-return-type, no-console, etc.)
4. `importX.flatConfigs.recommended` + `.typescript` (import ordering, no-default-export)
5. Test file overrides
6. `eslintConfigPrettier` (last — disables formatting conflicts)

### Phase 3: Create `.prettierrc`

Minimal config: `singleQuote`, `trailingComma: "all"`, `semi`, `printWidth`.

### Phase 4: Activate pre-commit hook

Run `pnpm prepare` to install `simple-git-hooks`. Verify `.git/hooks/pre-commit` exists.

### Phase 5: End-to-end validation

Run `pnpm lint`, commit an intentional error to verify hook rejects it, then commit the clean state.

---

## STEP-BY-STEP TASKS

### UPDATE `package.json` — replace and add dependencies

- **REMOVE**: `eslint-plugin-import` from devDependencies (flat config compatibility issues — use `import-x` instead)
- **REMOVE**: `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` (replaced by unified `typescript-eslint` package)
- **ADD** to devDependencies:
  - `"typescript-eslint": "^8.0.0"` — unified package (parser + plugin)
  - `"@eslint/js": "^9.0.0"` — base JS recommended rules
  - `"eslint-plugin-import-x": "^4.0.0"` — flat-config-native import plugin
  - `"eslint-config-prettier": "^9.0.0"` — disables formatting rule conflicts
- **UPDATE** `lint-staged` config to match scaffold PRD §12 (see Patterns section above)
- **VALIDATE**: `pnpm install` exits 0

### CREATE `eslint.config.ts`

- **IMPLEMENT**: TypeScript flat config (full content below):

```typescript
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**'] },

  eslint.configs.recommended,

  // typescript-eslint: type-aware rules
  tseslint.configs.recommended,
  {
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },

  // import-x: named exports + import ordering
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    rules: {
      'import-x/no-default-export': 'error',
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },
  },

  // Relax rules for test and mock files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'src/__mocks__/**/*.ts'],
    rules: {
      'no-console': 'off',
      'import-x/no-default-export': 'off',
    },
  },

  // Prettier: disable conflicting formatting rules — MUST BE LAST
  eslintConfigPrettier,
);
```

- **GOTCHA — loading `eslint.config.ts`**: ESLint needs to strip types from `.ts` config files. On Node 22.14+ (which this project uses), run ESLint with:
  ```
  node --experimental-strip-types ./node_modules/.bin/eslint src/
  ```
  Update the `lint` script in `package.json` to pass this flag:
  ```json
  "lint": "node --experimental-strip-types ./node_modules/.bin/eslint src/",
  "lint:fix": "node --experimental-strip-types ./node_modules/.bin/eslint src/ --fix"
  ```
  Alternative: rename to `eslint.config.mjs` and use plain JS. TypeScript is preferred per the scaffold PRD.

- **GOTCHA — `import-x/no-unresolved`**: This rule may flag `@/` path aliases as unresolved. If it fires, add to the `import-x` rules block:
  ```typescript
  'import-x/no-unresolved': ['error', { ignore: ['^@/'] }],
  ```
  Or configure the resolver's `alias` to match `tsconfig.json` paths.

- **GOTCHA — `@typescript-eslint/explicit-function-return-type`**: The empty stubs (`src/index.ts`, `src/__mocks__/chrome.ts`) use `export {}` which is fine. But if they ever have functions without return types, this rule will fire — that's intentional.

- **VALIDATE**: `pnpm lint` — zero errors on current `src/` files

### CREATE `.prettierrc`

- **IMPLEMENT**:
```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true
}
```
- **WHY `singleQuote: true`**: Consistent with TypeScript community convention and easier to read in JSX-adjacent code.
- **WHY `trailingComma: "all"`**: Default in Prettier 3; avoids noisy diffs when adding parameters.
- **VALIDATE**: `pnpm exec prettier --check src/` — should pass (stubs are trivially formatted)

### RUN `pnpm prepare` — activate git hooks

- **IMPLEMENT**: `pnpm prepare`
- **VALIDATES**: `simple-git-hooks` reads the `simple-git-hooks` block in `package.json` and writes `.git/hooks/pre-commit`
- **VALIDATE**: `cat .git/hooks/pre-commit` — should contain `npx lint-staged`

### VERIFY pre-commit hook rejects bad commits

- **IMPLEMENT**: Manually test the hook:
  1. Add `console.log('test')` to `src/index.ts`
  2. `git add src/index.ts`
  3. `git commit -m "test"` — should be **rejected** by `lint-staged` (ESLint `no-console` violation)
  4. Revert: restore `src/index.ts` to `export {};`
- **VALIDATE**: Commit is rejected with ESLint error; after revert, `git commit` (with actual changes) succeeds

---

## TESTING STRATEGY

### Unit Tests

None for Phase 2 — linting is self-validating (the linter lints itself).

### Integration Tests

The pre-commit hook test (manual, described above) IS the integration test.

### Edge Cases

- **`eslint.config.ts` itself**: ESLint lints `src/` not root config files — the config file is excluded automatically. No circular linting issue.
- **`tsconfig.node.json`**: Already includes `eslint.config.ts` in its `include` — `pnpm typecheck` will type-check the config. Ensure no type errors in the config file itself.
- **`import-x/no-unresolved` false positives**: The `@/` alias may not be recognized without resolver config. See GOTCHA above.
- **`explicit-function-return-type` on empty stubs**: `export {}` is not a function — no violation. Safe.
- **lint-staged + tsc**: `tsc --noEmit` in lint-staged checks all included files, not just staged ones. This is correct behavior — it catches cross-file regressions.

---

## VALIDATION COMMANDS

### Level 1: Dependency install

```bash
pnpm install
```
Expected: exit 0, `node_modules/typescript-eslint`, `node_modules/eslint-plugin-import-x`, `node_modules/eslint-config-prettier` all present.

### Level 2: ESLint

```bash
pnpm lint
```
Expected: zero errors, zero warnings on `src/`.

### Level 3: TypeScript (ensure config file type-checks)

```bash
pnpm typecheck
```
Expected: zero errors (including `eslint.config.ts` via `tsconfig.node.json`).

### Level 4: Build (no regressions)

```bash
pnpm build
```
Expected: `dist/` produced, no Rollup errors.

### Level 5: Tests (no regressions)

```bash
pnpm test
```
Expected: exit 0.

### Level 6: Pre-commit hook verification (manual)

```bash
# Introduce a deliberate violation
echo "console.log('bad')" >> src/index.ts
git add src/index.ts
git commit -m "should fail"
# Expected: commit REJECTED with ESLint error output

# Restore
git checkout src/index.ts
```

---

## ACCEPTANCE CRITERIA

- [ ] `pnpm lint` passes with zero errors on current `src/` files
- [ ] `eslint.config.ts` uses flat config format with TypeScript
- [ ] `no-console` rule is active (error severity)
- [ ] `import-x/no-default-export` rule is active (error severity)
- [ ] `@typescript-eslint/explicit-function-return-type` rule is active
- [ ] Test/mock files have relaxed rules (`no-console: off`, `import-x/no-default-export: off`)
- [ ] `eslint-config-prettier` is last in config (no formatting conflicts)
- [ ] `.prettierrc` exists with `singleQuote`, `trailingComma: "all"`, `semi`, `printWidth`
- [ ] `.git/hooks/pre-commit` exists and contains `npx lint-staged`
- [ ] Pre-commit hook rejects a commit with a `no-console` violation
- [ ] `pnpm typecheck` still passes (no regressions)
- [ ] `pnpm build` still produces `dist/`
- [ ] `pnpm test` still exits 0

---

## COMPLETION CHECKLIST

- [ ] `package.json` devDependencies updated (removed `eslint-plugin-import`, added `eslint-plugin-import-x`, `typescript-eslint`, `@eslint/js`, `eslint-config-prettier`)
- [ ] `pnpm install` passes
- [ ] `eslint.config.ts` created
- [ ] `.prettierrc` created
- [ ] `pnpm lint` passes clean
- [ ] `pnpm typecheck` passes clean
- [ ] `pnpm build` passes clean
- [ ] `pnpm test` passes clean
- [ ] `pnpm prepare` run — `.git/hooks/pre-commit` exists
- [ ] Pre-commit hook manually verified (rejects bad commit, accepts clean commit)

---

## NOTES

### Why `eslint-plugin-import-x` instead of `eslint-plugin-import`

The scaffold PRD specifies `eslint-plugin-import` v2, but that package has a known flat config compatibility issue: its resolver does not handle the `exports` field in `package.json`, causing spurious `import/no-unresolved` errors on modern packages. `eslint-plugin-import-x` is a maintained fork with full ESLint 9 flat config support. Rule prefix changes from `import/` to `import-x/`.

### Why `typescript-eslint` (unified) instead of separate packages

`@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` (separate) still work but the unified `typescript-eslint` package is the recommended approach as of v8. It re-exports both as `tseslint.plugin` and `tseslint.parser` and simplifies config.

### Why `eslint-config-prettier` instead of `eslint-plugin-prettier`

`eslint-plugin-prettier` runs Prettier inside ESLint and reports formatting as lint errors. This is slow and produces noisy output. `eslint-config-prettier` only disables ESLint rules that conflict with Prettier — Prettier formatting is enforced separately via editor integration or a CI `prettier --check` command (future phase). This is the recommended approach per the Prettier team.

### Loading `eslint.config.ts` on Node 22.14

Node 22.14 ≥ 22.13, so native TypeScript stripping via `--experimental-strip-types` is available without `jiti`. The `lint` script in `package.json` must be updated to pass this flag when invoking ESLint. Alternative: use `eslint.config.js` (plain JS) but then we lose type safety on the config itself — TypeScript config preferred.
