# Feature: Scaffold Phase 1 — Toolchain

The following plan should be complete, but validate codebase state and task sanity before implementing.

Pay special attention to exact package versions, config field names, and the specific Vite/Vitest gotchas for MV3 extensions.

## Feature Description

Set up the full build/test toolchain for the Focus Guard TypeScript Chromium MV3 extension. This is the foundation every feature slice depends on. When complete, `vite build` and `vitest run` both pass with zero errors, TypeScript strict mode is enforced, and the project structure is navigable by both humans and AI agents.

## User Story

As an AI coding agent (or developer) implementing feature slices,
I want a working build pipeline, test runner, and enforced conventions,
So that I can implement features without making any infrastructure decisions.

## Problem Statement

The repository currently contains only `CLAUDE.md`. Nothing compiles, nothing runs, nothing is enforced. Feature slices cannot be written without this foundation.

## Solution Statement

Create `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `manifest.json`, and a `src/index.ts` stub. Wire them so `vite build` produces a `dist/` and `vitest run` exits 0.

## Feature Metadata

**Feature Type**: New Capability (scaffold)  
**Estimated Complexity**: Low  
**Primary Systems Affected**: Build system, test runner, TypeScript compiler  
**Dependencies**: vite, vitest, typescript, @types/chrome, vite-plugin-static-copy  

---

## CONTEXT REFERENCES

### Relevant Codebase Files — MUST READ BEFORE IMPLEMENTING

- `.agents/prds/scaffold.md` (sections 4, 7, 8, 10) — Canonical spec. Defines exact package versions, tsconfig fields, vite config skeleton, vitest config, manifest skeleton, and package.json scripts. **This is the primary source of truth for all config content.**
- `CLAUDE.md` — Project rules: strict TS, named exports only, no implicit `any`, path alias `@/` maps to `src/`.

### New Files to Create

```
package.json
tsconfig.json
tsconfig.node.json
vite.config.ts
vitest.config.ts
manifest.json
src/index.ts            ← empty stub so Vite has ≥1 entry point
```

### Relevant Documentation — READ BEFORE IMPLEMENTING

- Vite lib mode / multi-entry: https://vitejs.dev/config/build-options.html#build-rollupoptions  
  - Why: `rollupOptions.input` must have at least one entry or Rollup errors; the stub `src/index.ts` satisfies this.
- `vite-plugin-static-copy`: https://github.com/sapphi-red/vite-plugin-static-copy  
  - Why: Used to copy `manifest.json` to `dist/`. Verify API matches v1.x (`targets` array with `src`/`dest`).
- Vitest config reference: https://vitest.dev/config/  
  - Why: `environment: 'jsdom'`, `setupFiles`, `resolve.alias` must all be present.
- `@types/chrome` npm: https://www.npmjs.com/package/@types/chrome  
  - Why: Pin to latest stable; confirm it's listed under `compilerOptions.types` in tsconfig.

### Patterns to Follow

**tsconfig.json** — From scaffold.md §7.1:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["chrome"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**tsconfig.node.json** — For vite.config.ts compilation:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "eslint.config.ts"]
}
```

**vite.config.ts skeleton** — From scaffold.md §7.2 (entry point is just the stub for now):
```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.ts'),
        // TODO: Replace with real extension entry points in feature PRD
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        // TODO: Add HTML pages and icons here
      ],
    }),
  ],
});
```

**GOTCHA — MV3 service worker**: MV3 requires a classic (non-module) service worker by default. When adding the real SW entry later, set `output.format: 'iife'` for that entry specifically. The stub `index.ts` is fine as ESM for now.

**vitest.config.ts**:
```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['src/__mocks__/chrome.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
```

**GOTCHA — setupFiles path**: `src/__mocks__/chrome.ts` must exist before `vitest run` is called. Phase 3 of the scaffold creates it — but for Phase 1 validation, create a minimal placeholder (empty export) so the config doesn't error.

**manifest.json skeleton** — From scaffold.md §12:
```json
{
  "manifest_version": 3,
  "name": "Focus Guard",
  "version": "0.1.0",
  "description": "Block distracting websites; unlock with a hardware security key.",
  "permissions": [],
  "host_permissions": [],
  "background": {
    "service_worker": "TODO: service-worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "TODO: popup/popup.html"
  }
}
```

**package.json scripts** — From scaffold.md §12:
```json
{
  "scripts": {
    "build": "vite build",
    "build:watch": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "typecheck": "tsc --noEmit",
    "prepare": "simple-git-hooks"
  }
}
```

**GOTCHA — `prepare` script**: `simple-git-hooks` is a Phase 2 deliverable. Include it in `package.json` now but it won't be installed yet — that's fine, `pnpm install` will warn but succeed.

---

## IMPLEMENTATION PLAN

### Phase 1: package.json + pnpm install

Create `package.json` with all dev dependencies from scaffold.md §8, then run `pnpm install`.

### Phase 2: TypeScript config

Create `tsconfig.json` and `tsconfig.node.json`. Validate with `tsc --noEmit` (expect zero errors since `src/index.ts` is an empty stub).

### Phase 3: Vite config + manifest

Create `vite.config.ts` and `manifest.json`. Validate with `vite build`.

### Phase 4: Vitest config + mocks placeholder

Create `vitest.config.ts` and the `src/__mocks__/chrome.ts` placeholder (empty for now — will be replaced in scaffold Phase 3). Validate with `vitest run` (no tests yet, just "no tests found" exit 0).

---

## STEP-BY-STEP TASKS

### CREATE `package.json`

- **IMPLEMENT**: Full `package.json` with name, version, type, scripts, and all devDependencies. Use exact versions from scaffold.md §8: `typescript@^5.0.0`, `vite@^5.0.0`, `vitest@^2.0.0`, `@types/chrome@latest`, `vite-plugin-static-copy@^1.0.0`, `eslint@^9.0.0`, `@typescript-eslint/eslint-plugin@^8.0.0`, `@typescript-eslint/parser@^8.0.0`, `eslint-plugin-import@^2.0.0`, `prettier@^3.0.0`, `lint-staged@^15.0.0`, `simple-git-hooks@^2.0.0`, `jsdom@latest`, `@vitest/coverage-v8@^2.0.0`.
- **INCLUDE**: `"type": "module"` at top level so ESM imports work in config files.
- **INCLUDE**: `lint-staged` and `simple-git-hooks` config blocks (from scaffold.md §12).
- **ADD**: `"packageManager": "pnpm@9"` field to `package.json`.
- **VALIDATE**: `pnpm install` exits 0, `node_modules/` created.

### CREATE `tsconfig.json`

- **IMPLEMENT**: Exact content from scaffold.md §7.1 (reproduced in Patterns section above).
- **VALIDATE**: `pnpm typecheck` — zero errors.

### CREATE `tsconfig.node.json`

- **IMPLEMENT**: Targets config files only (`vite.config.ts`, `vitest.config.ts`). Does NOT include `"DOM"` in lib.
- **GOTCHA**: Must be referenced by `vite.config.ts` — Vite auto-discovers `tsconfig.node.json` in newer versions, but explicit `"references"` in `tsconfig.json` is not required.
- **VALIDATE**: Part of `tsc --noEmit` pass.

### CREATE `src/index.ts`

- **IMPLEMENT**: Single-line empty export stub: `export {};`
- **WHY**: Vite/Rollup errors if `rollupOptions.input` is empty. This stub is replaced by real entry points in later phases.
- **VALIDATE**: File exists at `src/index.ts`.

### CREATE `src/__mocks__/chrome.ts` (placeholder)

- **IMPLEMENT**: Minimal placeholder — just `export {};` for now. Will be replaced in scaffold Phase 3 with the full Chrome API mock.
- **WHY**: `vitest.config.ts` references `setupFiles: ['src/__mocks__/chrome.ts']`. The file must exist or Vitest startup fails.
- **VALIDATE**: File exists at `src/__mocks__/chrome.ts`.

### CREATE `vite.config.ts`

- **IMPLEMENT**: Full skeleton from Patterns section above. Entry points: `{ index: resolve(__dirname, 'src/index.ts') }`.
- **IMPORTS**: `import { defineConfig } from 'vite'`, `import { resolve } from 'path'`, `import { viteStaticCopy } from 'vite-plugin-static-copy'`.
- **GOTCHA**: `vite.config.ts` is compiled by `tsconfig.node.json`, not `tsconfig.json`. Ensure `resolve(__dirname, ...)` is used (not `import.meta.dirname`) for broadest TS compatibility.
- **VALIDATE**: `pnpm build` — `dist/` is created, `manifest.json` is copied to `dist/manifest.json`, `dist/index.js` is produced.

### CREATE `manifest.json`

- **IMPLEMENT**: MV3 skeleton from Patterns section above. Use real name "Focus Guard" and real description.
- **VALIDATE**: After `pnpm build`, verify `dist/manifest.json` exists and `"manifest_version": 3`.

### CREATE `vitest.config.ts`

- **IMPLEMENT**: Full config from Patterns section above.
- **GOTCHA**: `globals: true` requires `"types": ["vitest/globals"]` in tsconfig OR `/// <reference types="vitest/globals" />` in test files. Simplest fix: add `"vitest/globals"` to `compilerOptions.types` in `tsconfig.json` alongside `"chrome"`.
- **VALIDATE**: `pnpm test` — exits 0 (no tests found is acceptable; "no test files found" is a warning, not an error in Vitest).

---

## TESTING STRATEGY

No feature tests in this phase — only toolchain validation.

### Unit Tests

None required for Phase 1. The logger smoke tests are Phase 3 (scaffold).

### Integration Tests

None.

### Edge Cases

- Vite build with zero HTML entry points: handled by `src/index.ts` stub.
- `vitest run` with zero test files: Vitest exits 0 by default when no tests are found (confirm with `--passWithNoTests` flag if needed).
- `tsc --noEmit` with `exactOptionalPropertyTypes: true` can cause unexpected errors in config files if any third-party types are non-exact. If this happens, drop `exactOptionalPropertyTypes` from `tsconfig.node.json` only.

---

## VALIDATION COMMANDS

### Level 1: TypeScript

```bash
pnpm typecheck
```
Expected: zero errors.

### Level 2: Build

```bash
pnpm build
```
Expected: `dist/` created, `dist/manifest.json` present, no Rollup errors.

### Level 3: Tests

```bash
pnpm test
```
Expected: exits 0 (no tests found is acceptable).

### Level 4: Manual

- Verify `dist/manifest.json` content has `"manifest_version": 3`.
- Verify `dist/index.js` exists.
- Optionally: open `brave://extensions`, enable Developer Mode, Load Unpacked → `dist/`. Extension should appear without errors (it will have no functionality — that's expected).

---

## ACCEPTANCE CRITERIA

- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm build` produces `dist/` with `manifest.json` and `index.js`
- [ ] `pnpm test` exits 0
- [ ] `tsconfig.json` has `strict: true`, `noImplicitAny: true`, `exactOptionalPropertyTypes: true`
- [ ] Path alias `@/` resolves to `src/` in both tsconfig and vite/vitest configs
- [ ] `src/__mocks__/chrome.ts` exists (placeholder)
- [ ] `src/index.ts` stub exists

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] `pnpm install` passes
- [ ] `tsc --noEmit` passes
- [ ] `vite build` passes
- [ ] `vitest run` passes
- [ ] `dist/manifest.json` present and valid
- [ ] No files exceed 300 lines

---

## NOTES

- **Do not implement Phase 2 (ESLint/Prettier/lint-staged) or Phase 3 (Chrome mock + logger) in this plan.** Those are separate executions.
- The `src/index.ts` stub and `src/__mocks__/chrome.ts` placeholder are intentionally minimal — they exist only to satisfy toolchain requirements and will be replaced/fleshed out in subsequent phases.
- The `simple-git-hooks` `prepare` script is included in `package.json` now but won't function until Phase 2 installs and configures the hooks.
- `"type": "module"` in `package.json` is required so that `vite.config.ts` and `vitest.config.ts` can use ESM `import` syntax at the Node level.
- If `vitest run` warns "no tests found, exiting with code 1", add `--passWithNoTests` to the `test` script: `"test": "vitest run --passWithNoTests"`.
