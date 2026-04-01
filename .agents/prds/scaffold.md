# Chromium MV3 Extension — Scaffold PRD

**Version:** 1.0  
**Date:** 2026-04-01  
**Status:** Active  
**Reusable template:** Yes — nothing in this document is project-specific

---

## 1. Executive Summary

This document describes the scaffold phase for a TypeScript Chromium MV3 extension — the foundation that must exist before any feature slice is written. Every deliverable here is identical across any TypeScript Chromium extension project. Nothing in this PRD knows about the extension's purpose, its storage schema, its message protocol, or its feature set.

The goal is a repository where `vite build` succeeds, `vitest` runs tests against a realistic Chrome API mock, TypeScript strict mode is enforced by both the compiler and linter, and every future file has a single consistent import for structured logging. An AI agent handed a feature PRD after this scaffold is complete should implement feature slices without making any infrastructure decisions.

Reusability is a first-class concern. This scaffold can be copied wholesale into any new Chromium extension project — only the extension name and entry point names change.

---

## 2. Mission

**Mission Statement:** Produce the thinnest possible foundation that eliminates all infrastructure decisions for feature authors — consistent tooling, enforced conventions, and a running build from day one.

**Core Principles:**

1. **Zero project specifics** — No feature names, storage keys, message types, or domain logic anywhere in this PRD or its deliverables.
2. **Green checks = done** — The scaffold is complete when `tsc`, ESLint, Vitest, and `vite build` all pass with zero errors or warnings.
3. **Conventions over decisions** — File naming, import style, export style, and logging patterns are locked in here so feature authors never debate them.
4. **AI-navigable** — Named exports, consistent file naming, and path aliases let an AI agent grep its way around the codebase without hallucinating file locations.
5. **No premature abstraction** — Ship only what every feature slice will actually use. Nothing speculative.

---

## 3. Target Users

The primary "user" of the scaffold is an AI coding agent implementing feature slices. The secondary user is the human developer reviewing that output.

**AI agent needs:**
- Predictable file locations (glob-able structure)
- Searchable named exports (grep-able patterns)
- A single import path for shared infrastructure (`@/core/logger`)
- TypeScript errors that self-describe what to fix

**Human developer needs:**
- Confidence that TypeScript, linting, and tests are wired correctly before writing a single feature line
- A Chrome API mock that makes unit tests fast and deterministic
- A Vite build that produces a loadable extension on the first attempt

---

## 4. Scope

### In Scope

**Build & Bundling**
- ✅ `package.json` with all dev dependencies pinned
- ✅ `tsconfig.json` — strict mode, path aliases, correct lib targets for extension contexts
- ✅ `vite.config.ts` — multi-entry build skeleton, static asset copying
- ✅ `manifest.json` — MV3 skeleton with correct structure (permissions left as TODOs for the feature PRD)

**Linting & Formatting**
- ✅ ESLint flat config (`eslint.config.ts`) — TypeScript-aware, named exports enforced
- ✅ Prettier config (`.prettierrc`) — consistent formatting, enforced via ESLint
- ✅ `lint-staged` + `simple-git-hooks` for pre-commit enforcement

**Testing**
- ✅ `vitest.config.ts` — jsdom environment, path alias resolution, coverage config
- ✅ `src/__mocks__/chrome.ts` — shared Chrome API mock (storage, runtime, alarms, declarativeNetRequest)

**Logging Infrastructure**
- ✅ `src/core/logger.ts` — structured JSON logger, structured fields, Vitest suppression
- ✅ `src/core/logger.test.ts` — smoke tests

**Directory Skeleton**
- ✅ `src/core/` and `src/shared/` created (the only universal directories)
- ✅ `src/__mocks__/` for test infrastructure

### Out of Scope

**Project-specific infrastructure (belongs in the feature PRD)**
- ❌ Entry point files and HTML pages (names are project-specific)
- ❌ Feature slice directories (names are project-specific)
- ❌ Any `core/` file other than `logger.ts` (config, storage, messages are all project-specific)
- ❌ Anything in `shared/` (utilities are project-specific)
- ❌ `service-worker.ts` or any background script implementation

**CI/CD**
- ❌ GitHub Actions workflows (deferred)

---

## 5. Deliverable Stories

### S-001 — TypeScript Compiles Clean
`tsc --noEmit` passes with zero errors. Strict mode is on. Path aliases (`@/`) resolve correctly. The `lib` targets include `ES2022` and `DOM`. A note documents that service worker files must not use DOM APIs at runtime (TypeScript cannot enforce this across contexts without a separate tsconfig).

### S-002 — Vite Build Produces a Loadable Extension
`vite build` outputs a `dist/` directory that can be loaded via "Load unpacked" without errors. The config is a working multi-entry skeleton — entry point names are left as documented TODOs for the feature PRD to fill in. `manifest.json` and any static assets are copied to `dist/` automatically.

### S-003 — ESLint Enforces Grep-ability
ESLint rejects: default exports, implicit `any`, and `console.*` calls. Running `eslint src/` on the scaffold itself passes clean.

### S-004 — Vitest Runs With Chrome Mock
`vitest run` executes successfully. The Chrome API mock (`__mocks__/chrome.ts`) is auto-injected into all test files via `setupFiles`. The logger smoke test passes.

### S-005 — Logger Is the Only Console
`core/logger.ts` is implemented and tested. All entry point files call `createLogger('<context>')` once and use the returned instance. Direct `console.*` calls are rejected by ESLint. Logger output is suppressed in Vitest. In non-test environments it emits structured JSON with `context` automatically included on every entry.

### S-006 — Pre-commit Hook Passes
`simple-git-hooks` + `lint-staged` run ESLint and `tsc --noEmit` on staged files. A commit containing a TypeScript error or lint violation is rejected.

---

## 6. Core Architecture & Patterns

### Directory Structure

```
my-extension/
├── src/
│   ├── core/                    # Universal infrastructure — no feature logic
│   │   ├── logger.ts            # Structured JSON logger
│   │   └── logger.test.ts
│   ├── shared/                  # Cross-feature utilities (empty at scaffold)
│   └── __mocks__/
│       └── chrome.ts            # Chrome API mock for Vitest
├── dist/                        # Vite build output (gitignored)
├── manifest.json                # MV3 manifest skeleton
├── package.json
├── tsconfig.json
├── tsconfig.node.json           # For vite.config.ts compilation
├── vite.config.ts
├── vitest.config.ts
├── eslint.config.ts
└── .prettierrc
```

Feature slice directories and entry point files are **not** created by the scaffold — they are specified by the feature PRD.

### Key Patterns Enforced by Scaffold

**Named exports only:**
```typescript
// ✅ Correct — grep-able
export function processItem(id: string): Result { ... }

// ❌ Rejected by ESLint
export default function processItem(id: string): Result { ... }
```

**Path aliases over relative imports:**
```typescript
// ✅ Correct
import { logger } from '@/core/logger';

// ❌ Avoid
import { logger } from '../../core/logger';
```

**Logger, never console:**
```typescript
// ✅ Correct
import { logger } from '@/core/logger';
logger.info('item_processed', { id, trace_id });

// ❌ Rejected by ESLint
console.log('processed:', id);
```

**Collocated tests:**
```
src/core/logger.ts
src/core/logger.test.ts   ← lives next to the file it tests
```

---

## 7. Feature Specifications

### 7.1 `tsconfig.json`

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
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["chrome"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Note on extension contexts:** Background service workers cannot access DOM APIs at runtime despite `"lib": ["DOM"]` being present. Feature authors must not use `window`, `document`, or `fetch` in background scripts. A separate `tsconfig.sw.json` omitting `DOM` can be introduced later if violations occur.

### 7.2 `vite.config.ts`

The scaffold ships a working config skeleton with the entry points section left as a clearly documented TODO:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // TODO: Add extension entry points here.
        // Example:
        // 'background': resolve(__dirname, 'src/background/background.ts'),
        // 'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
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
        // TODO: Add HTML pages and icons here.
      ],
    }),
  ],
});
```

### 7.3 ESLint Flat Config (`eslint.config.ts`)

Key rules enforced:

| Rule | Purpose |
|---|---|
| `import/no-default-export` | Force named exports — grep-ability |
| `@typescript-eslint/no-explicit-any` | Enforce type safety |
| `no-console` | Force use of `core/logger` |
| `@typescript-eslint/explicit-function-return-type` | All functions explicitly typed |
| `@typescript-eslint/no-unused-vars` | Catch dead code |
| `import/order` | Consistent import grouping with `@/` as internal |

Test files relax `no-console` only.

### 7.4 Chrome API Mock (`src/__mocks__/chrome.ts`)

Covers the core APIs available to any MV3 extension:

```typescript
import { vi } from 'vitest';

const chrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    id: 'test-extension-id',
    lastError: null,
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    get: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  declarativeNetRequest: {
    updateDynamicRules: vi.fn(),
    getDynamicRules: vi.fn(),
  },
};

(globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;
```

Auto-injected via `vitest.config.ts` `setupFiles`. Projects that don't use `alarms` or `declarativeNetRequest` can ignore the unused mock methods — they cause no harm.

### 7.5 `core/logger.ts`

The logger uses a factory pattern so that `context` is injected once per entry point rather than passed manually on every call. The `context` type is a loose `string` — the feature PRD replaces this with a union of the extension's actual context names.

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// TODO: Replace with a union of your extension's actual context names.
// e.g. type Context = 'background' | 'popup' | 'options' | 'content_script';
type Context = string;

interface LogEntry {
  level: LogLevel;
  event: string;
  context: Context;
  [key: string]: unknown;
}

interface Logger {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info:  (event: string, fields?: Record<string, unknown>) => void;
  warn:  (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
}

function emit(
  context: Context,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  if (typeof process !== 'undefined' && process.env['VITEST']) return;
  const entry: LogEntry = { level, event, context, ...fields };
  console[level](JSON.stringify(entry));
}

export function createLogger(context: Context): Logger {
  return {
    debug: (event, fields) => emit(context, 'debug', event, fields),
    info:  (event, fields) => emit(context, 'info',  event, fields),
    warn:  (event, fields) => emit(context, 'warn',  event, fields),
    error: (event, fields) => emit(context, 'error', event, fields),
  };
}
```

Each entry point creates its logger once at the top of the file:

```typescript
// src/background/background.ts
import { createLogger } from '@/core/logger';
const logger = createLogger('background');

// src/popup/popup.ts
import { createLogger } from '@/core/logger';
const logger = createLogger('popup');
```

Every log from that file automatically includes `{ context: 'background', ... }` — callers never pass it manually.

**Constraints:**
- Zero dependencies — no external logger packages
- Suppressed when `VITEST=true` (set automatically by Vitest)
- Output is newline-delimited JSON — parseable by DevTools and any log aggregator
- `event` is always the first positional argument, enforcing `snake_case` event names by convention
- `Context` type is `string` in the template — the feature PRD narrows it to a project-specific union

**Convention: `fix_suggestion` on warn and error logs**

Where the cause of a warning or error is diagnosable, include a `fix_suggestion` field. This makes logs actionable for an AI agent debugging without human intervention:

```typescript
// ✅ Correct
logger.error('config_parse_failed', {
  file: 'manifest.json',
  error: err.message,
  fix_suggestion: 'Ensure manifest_version is 3 and all required fields are present',
});

// ❌ Avoid — no actionable context
logger.error('config_parse_failed', { error: err.message });
```

`fix_suggestion` is not enforced by the logger implementation — it is a calling convention. It is not required on every log, only where the fix is knowable at the call site.

---

## 8. Technology Stack

| Tool | Version | Purpose |
|---|---|---|
| TypeScript | 5.x | Language — strict mode |
| Vite | 5.x | Bundler — multi-entry extension build |
| Vitest | 2.x | Test runner |
| ESLint | 9.x | Linting — flat config format |
| `@typescript-eslint` | 8.x | TypeScript-aware ESLint rules |
| `eslint-plugin-import` | 2.x | Named export enforcement |
| Prettier | 3.x | Formatting |
| `lint-staged` | 15.x | Pre-commit staged file linting |
| `simple-git-hooks` | 2.x | Git hook wiring (no Husky) |
| `@types/chrome` | latest | Chrome extension type definitions |
| `vite-plugin-static-copy` | 1.x | Copy manifest + HTML to dist |

**Runtime dependencies: none.** All entries above are `devDependencies`.

---

## 9. Success Criteria

The scaffold is complete when all of the following pass with zero errors:

| Check | Command | Passes when |
|---|---|---|
| ✅ TypeScript compilation | `tsc --noEmit` | Zero type errors |
| ✅ ESLint | `eslint src/` | Zero errors or warnings |
| ✅ Vitest | `vitest run` | Logger smoke tests pass |
| ✅ Vite build | `vite build` | `dist/` produced, no build errors |
| ✅ Extension loads | Manual: load unpacked `dist/` | No errors in extensions page |
| ✅ Pre-commit hook | `git commit` with a TS error | Commit rejected |

---

## 10. Implementation Phases

### Phase 1 — Toolchain
**Goal:** TypeScript, Vite, and Vitest wired together.

- ✅ `package.json` with all dev dependencies
- ✅ `tsconfig.json` + `tsconfig.node.json`
- ✅ `vite.config.ts` skeleton with TODO entry points
- ✅ `vitest.config.ts` with jsdom + setupFiles
- ✅ `manifest.json` skeleton with permission TODOs

**Validation:** `vite build` succeeds; `vitest run` exits 0. Note: Rollup requires at least one entry in `input` — add a single `src/index.ts` stub (empty file) to satisfy the build during this phase. It will be replaced by real entry points in the feature PRD.

### Phase 2 — Linting & Formatting
**Goal:** Code conventions enforced automatically.

- ✅ `eslint.config.ts` with TypeScript + import rules
- ✅ `.prettierrc`
- ✅ `lint-staged` + `simple-git-hooks` config in `package.json`
- ✅ Pre-commit hook verified (intentional lint error rejected)

**Validation:** `eslint src/` passes clean.

### Phase 3 — Chrome Mock & Logger
**Goal:** Complete the shared infrastructure every feature file will import.

- ✅ `src/__mocks__/chrome.ts`
- ✅ `src/core/logger.ts`
- ✅ `src/core/logger.test.ts` — suppression in Vitest, JSON output format, all four log levels, `context` auto-injected on every entry

**Validation:** `vitest run` passes; `tsc --noEmit` and `eslint src/` clean; `vite build` still succeeds.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Vite multi-entry output conflicts with MV3 service worker requirements (MV3 requires a classic, non-module SW by default) | Set `rollupOptions.output.format: 'iife'` for background script entries; verify via `chrome://serviceworker-internals` |
| `@types/chrome` version mismatch causes phantom type errors | Pin to a specific version; update deliberately |
| ESLint flat config incompatible with a plugin that only supports legacy `.eslintrc` | Vet all plugins for flat config support; `eslint-plugin-import` v2 requires `eslint-import-resolver-typescript` |
| `simple-git-hooks` not installed after `npm install` on a fresh clone | Add `"prepare": "simple-git-hooks"` to `package.json` scripts |
| Logger Vitest suppression (`process.env.VITEST`) fails in browser-mode Vitest | Use `import.meta.env.VITEST` as fallback; test both paths |

---

## 12. Appendix

### Related Documents

- `.agents/articles/ai-coding-project-setup-guide.md` — Source article for linting philosophy and grep-ability rules (Rasmus Widing)
- `.agents/reference/vsa-patterns.md` — VSA pattern reference for `core/` vs `shared/` decisions

### `manifest.json` Skeleton

```json
{
  "manifest_version": 3,
  "name": "TODO: Extension name",
  "version": "0.1.0",
  "description": "TODO: Extension description",
  "permissions": [],
  "host_permissions": [],
  "background": {
    "service_worker": "TODO: background script path",
    "type": "module"
  },
  "action": {
    "default_popup": "TODO: popup path"
  }
}
```

### `package.json` Scripts

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
  },
  "lint-staged": {
    "src/**/*.ts": ["eslint --fix", "tsc --noEmit"]
  },
  "simple-git-hooks": {
    "pre-commit": "npx lint-staged"
  }
}
```
