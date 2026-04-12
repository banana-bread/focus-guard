# Feature: Validate blocklist domain input

The following plan should be complete, but validate documentation and codebase patterns and task sanity before implementing.

Pay special attention to naming of existing utils/types/models. Import from the right files.

## Feature Description

Reject non-domain input when adding an entry to the blocklist. Today the popup will happily accept a keyboard smash like `fdjkfjdakjlfjalfjdklsa` because `new URL("https://fdjkfjdakjlfjalfjdklsa")` parses successfully — the WHATWG URL parser treats any non-empty token as a valid hostname. We need structural validation that rejects hostnames without at least one dot-separated label and a TLD-like suffix, and surfaces a clear error in the popup UI.

## User Story

As a user of Focus Guard
I want the popup to reject clearly-invalid domain input
So that typos and accidental key-smashes don't pollute my blocklist (and I don't have to unlock with my YubiKey to clean them up).

## Problem Statement

`normalizeDomain()` (src/shared/domain.ts:13) relies solely on `new URL()` for validation. `new URL("https://fdjkfjdakjlfjalfjdklsa")` succeeds and returns the bogus string as `hostname`. Consequences:

1. Popup accepts garbage → added to blocklist storage.
2. User must now unlock via WebAuthn to remove garbage entries (removal requires assertion per `CLAUDE.md` → "Removing a domain or clearing a credential requires WebAuthn verification").

The reproduction is documented at `.agents/bugs/no-validation-entering-non-domain-to-blocklist.md`.

## Solution Statement

Add a pure validation function `isValidDomain(input: string): boolean` in `src/shared/domain.ts` that returns true only when the normalized hostname:

1. Contains at least one `.` (at least two labels).
2. Every label matches `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` (RFC 1123 host-label; no leading/trailing hyphen, ≤63 chars).
3. Total length ≤253 chars.
4. TLD (last label) has length ≥2 and contains at least one non-digit (reject pure-IPv4 last label like `1.2.3.4`).
5. Is not `localhost`.

Call it in `addDomain()` (src/blocklist/blocklist.service.ts:21) **after** `normalizeDomain()`. Throw a typed `Error` with a human-readable message (e.g. `"Not a valid domain: \"${input}\""`). The existing `handleAddDomain` try/catch (src/blocklist/blocklist.handler.ts:26) already converts thrown errors into `errResponse`, and the popup already renders `resp.error` via `showError(addDomainError, resp.error)` (src/popup/popup.ts:230). No popup/handler changes required — the fix is localized to `shared/domain.ts` + one call site.

Also do a lightweight client-side check in the popup so we don't even send the message for obviously-empty input (already done via `if (!domain) return`). We will NOT duplicate validation in the popup — the trust boundary is the service worker (CLAUDE.md). Popup stays thin.

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Low
**Primary Systems Affected**: `shared/domain` (validation util), `blocklist/blocklist.service` (call site)
**Dependencies**: None

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `src/shared/domain.ts` (lines 1-19) — Why: Current normalisation; add `isValidDomain` here alongside it.
- `src/shared/domain.test.ts` (lines 1-47) — Why: Test style and edge cases already covered; mirror structure when adding new cases.
- `src/blocklist/blocklist.service.ts` (lines 21-37) — Why: Call site where validation must be invoked (after normalise, before dedup/storage).
- `src/blocklist/blocklist.handler.ts` (lines 22-38) — Why: Already wraps `addDomain` in try/catch and returns `errResponse(err.message)` — no change needed, but confirms error propagation path.
- `src/blocklist/blocklist.handler.test.ts` (lines 20-73) — Why: Test harness pattern for handler-level tests; mirror for new "rejects invalid input" case.
- `src/popup/popup.ts` (lines 214-250) — Why: Confirms popup already shows `resp.error` via `showError(addDomainError, resp.error)`. No change required.
- `CLAUDE.md` — "Service worker is the trust boundary" + logging rules (snake_case event names, `fix_suggestion` on errors).

### New Files to Create

None. All changes are edits to existing files.

### Relevant Documentation

- [RFC 1123 §2.1 — Host name syntax](https://datatracker.ietf.org/doc/html/rfc1123#section-2.1)
  - Defines label rules (letters/digits/hyphen, no leading/trailing hyphen, ≤63 chars, total ≤253).
  - Why: Our label regex must match this.
- [WHATWG URL Standard — host parsing](https://url.spec.whatwg.org/#host-parsing)
  - Confirms that `new URL()` accepts any non-empty opaque host — motivates why URL-parse-only validation is insufficient.
  - Why: Explains the bug's root cause.

### Patterns to Follow

**Naming conventions:** camelCase functions; file-prefix grouping for tests (`domain.test.ts`). Match existing style in `src/shared/`.

**Error handling:** Throw `Error` subclasses or plain `Error` with a descriptive message. Handler catches and returns `errResponse(err.message)` — the message surfaces in popup UI, so keep it user-friendly (no stack traces, no internal jargon).

**Logging pattern (from CLAUDE.md):** In `addDomain`, if validation fails, the thrown error is already logged by `handleAddDomain` via `logger.error('add_domain_failed', { trace_id, domain, error, fix_suggestion })`. Do NOT add a second log in the service — one log per error. The existing `fix_suggestion` message is generic ("Check that the domain input is a valid URL or hostname"); leave it as-is (still accurate).

**Shared module rule (from memory):** Do NOT add a logger to `src/shared/domain.ts`. Shared crypto/utility files never import `createLogger`. The validator is a pure function; callers log.

---

## IMPLEMENTATION PLAN

### Phase 1: Add validation util

Add `isValidDomain()` to `src/shared/domain.ts`. Pure function, no logger, no side effects.

### Phase 2: Wire into service

Call `isValidDomain(domain)` in `addDomain()` **after** `normalizeDomain`. Throw descriptive error if invalid.

### Phase 3: Tests

Add unit tests for `isValidDomain` mirroring `normalizeDomain` style. Add one handler-level test confirming that garbage input returns `{ ok: false, error: ... }` and does NOT call `updateDynamicRules`.

### Phase 4: Manual validation

Load unpacked extension, reproduce the bug steps from `.agents/bugs/no-validation-entering-non-domain-to-blocklist.md`, confirm error message appears and blocklist unchanged.

---

## STEP-BY-STEP TASKS

Execute in order.

### UPDATE `src/shared/domain.ts`

- **IMPLEMENT**: Export a new function `isValidDomain(input: string): boolean`. Internally call `normalizeDomain(input)` inside a try/catch — if it throws, return `false`. Then run structural checks against the normalized hostname.
- **STRUCTURAL CHECKS** (all must pass):
  - `hostname.length >= 1 && hostname.length <= 253`
  - `hostname !== 'localhost'`
  - `hostname.includes('.')` (≥2 labels)
  - Every label matches `/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/` (single-char labels allowed)
  - Last label (TLD): `length >= 2` AND contains at least one letter (`/[a-z]/.test(tld)`) — this rejects IPv4 (`1.2.3.4`) and numeric-TLD junk.
- **PATTERN**: Match existing JSDoc style from `normalizeDomain` (src/shared/domain.ts:5-12).
- **IMPORTS**: None new.
- **GOTCHA**: `normalizeDomain` already lowercases and strips `www.`/scheme/path — validation operates on the normalized form. Don't re-implement normalization inside the validator.
- **GOTCHA**: Do NOT import `createLogger` here (see memory: "No logger in shared/").
- **VALIDATE**: `pnpm exec tsc --noEmit`

### UPDATE `src/blocklist/blocklist.service.ts`

- **IMPLEMENT**: After `const domain = normalizeDomain(rawInput);` (line 22), add:
  ```ts
  if (!isValidDomain(rawInput)) {
    throw new Error(`Not a valid domain: "${rawInput}"`);
  }
  ```
  Use `rawInput` in the error message (what the user typed), not `domain` (normalized).
- **IMPORTS**: Extend existing import — `import { normalizeDomain, isValidDomain } from '@/shared/domain';`
- **PATTERN**: Thrown error bubbles to `handleAddDomain` catch at `src/blocklist/blocklist.handler.ts:29`, which already logs with `fix_suggestion` and returns `errResponse`.
- **GOTCHA**: Pass `rawInput` to `isValidDomain`, not `domain`. The validator calls `normalizeDomain` internally — passing the already-normalized string would work but loses the ability to log the raw input. Either order is fine structurally; pick `rawInput` for consistency with error message.
- **GOTCHA**: Do NOT log separately here — the handler's catch already logs `add_domain_failed`. Duplicate logging violates CLAUDE.md logging rules ("one log per error").
- **VALIDATE**: `pnpm exec tsc --noEmit`

### UPDATE `src/shared/domain.test.ts`

- **IMPLEMENT**: Add a new `describe('isValidDomain', ...)` block. Cases to cover:
  - ✅ accepts `reddit.com`
  - ✅ accepts `news.reddit.com`
  - ✅ accepts `https://www.reddit.com/path?q=1` (URL input form)
  - ✅ accepts `example.co.uk`
  - ✅ accepts `a.io` (short labels)
  - ❌ rejects `fdjkfjdakjlfjalfjdklsa` (no dot) — **the bug repro**
  - ❌ rejects empty string
  - ❌ rejects `localhost`
  - ❌ rejects `1.2.3.4` (IPv4 — TLD has no letters)
  - ❌ rejects `example.` (trailing dot → empty label)
  - ❌ rejects `-foo.com` (label starts with hyphen)
  - ❌ rejects `foo-.com` (label ends with hyphen)
  - ❌ rejects a label >63 chars
  - ❌ rejects total hostname >253 chars
  - ❌ rejects `not a domain!!` (space → normalizeDomain throws → `false`)
- **IMPORTS**: Extend `import { normalizeDomain, isValidDomain } from '@/shared/domain';`
- **PATTERN**: Mirror the existing `normalizeDomain` block structure — one `it(...)` per case, `expect(isValidDomain(x)).toBe(true|false)`.
- **VALIDATE**: `pnpm exec vitest run src/shared/domain.test.ts`

### UPDATE `src/blocklist/blocklist.handler.test.ts`

- **IMPLEMENT**: Add one new case in `describe('handleAddDomain', ...)`:
  ```ts
  it('rejects invalid domain input and does not update rules', async () => {
    const msg: Extract<RequestMessage, { type: 'ADD_DOMAIN' }> = {
      type: 'ADD_DOMAIN',
      domain: 'fdjkfjdakjlfjalfjdklsa',
      trace_id: 't1',
    };
    const callsBefore = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls.length;
    const resp = await handleAddDomain(msg, 't1');
    expect(resp.ok).toBe(false);
    if (!resp.ok) expect(resp.error).toMatch(/not a valid domain/i);
    expect(vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls.length).toBe(callsBefore);
  });
  ```
- **PATTERN**: Mirrors existing "ignores duplicates" test shape (lines 58-72).
- **IMPORTS**: None new.
- **VALIDATE**: `pnpm exec vitest run src/blocklist/blocklist.handler.test.ts`

---

## TESTING STRATEGY

### Unit Tests

- `src/shared/domain.test.ts` — covers `isValidDomain` in isolation (15 cases listed above).
- `src/blocklist/blocklist.handler.test.ts` — covers the end-to-end handler path for the invalid case (1 new test).

### Integration Tests

None. This bug fix doesn't touch messaging, storage, or DNR beyond what existing tests already cover.

### Edge Cases

Covered in unit tests:
- Keyboard smash (no dots) — the reported bug
- IPv4 literal
- `localhost`
- Labels with leading/trailing hyphens
- Label length >63
- Hostname length >253
- Trailing dot
- Already-URL input form (scheme + path)
- Input that makes `normalizeDomain` itself throw (spaces, etc.)

---

## VALIDATION COMMANDS

Execute in pyramid order. See `.agents/reference/validation-pyramid.md`.

### Level 1: Syntax & Style

```bash
pnpm lint
pnpm format:check
```

### Level 2: Type Safety

```bash
pnpm exec tsc --noEmit
```

### Level 3: Unit Tests

```bash
pnpm exec vitest run src/shared/domain.test.ts
pnpm exec vitest run src/blocklist/blocklist.handler.test.ts
```

### Level 4: Integration Tests

```bash
pnpm exec vitest run
```

### Level 5: Manual Validation

1. `pnpm build`
2. In `brave://extensions` click reload on the Focus Guard card.
3. Open popup.
4. Type `fdjkfjdakjlfjalfjdklsa` → press Enter.
5. **Expect**: error text shown below the input (`Not a valid domain: "fdjkfjdakjlfjalfjdklsa"`), blocklist unchanged, input NOT cleared.
6. Type `reddit.com` → press Enter.
7. **Expect**: domain added, input cleared, list updated.
8. Type `https://news.ycombinator.com/item?id=1` → press Enter.
9. **Expect**: `news.ycombinator.com` added (normalization still works).
10. Type `1.2.3.4` → press Enter.
11. **Expect**: rejected with error.

### Level 6: Build

```bash
pnpm build
```

---

## ACCEPTANCE CRITERIA

- [ ] `isValidDomain` exported from `src/shared/domain.ts` with JSDoc matching `normalizeDomain` style.
- [ ] `addDomain` in `blocklist.service.ts` throws before storage mutation when input is invalid.
- [ ] Popup displays the error message from the service worker; blocklist is unchanged on invalid input.
- [ ] All 15 unit-test cases for `isValidDomain` pass.
- [ ] New handler-level test (invalid input returns `{ ok: false }` and does not call `updateDynamicRules`) passes.
- [ ] Existing tests (`handleAddDomain` happy path, URL normalization, duplicates) still pass.
- [ ] `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` all pass with zero errors.
- [ ] Manual repro from `.agents/bugs/no-validation-entering-non-domain-to-blocklist.md` no longer adds garbage to the blocklist.

---

## COMPLETION CHECKLIST

- [ ] `isValidDomain` added to `src/shared/domain.ts`
- [ ] `addDomain` calls `isValidDomain` and throws on failure
- [ ] Unit tests added for validator
- [ ] Handler test added for invalid-input rejection
- [ ] All validation levels pass
- [ ] Manual bug repro verified fixed
- [ ] Bug file `.agents/bugs/no-validation-entering-non-domain-to-blocklist.md` — leave in place or delete per project convention (check with user if unclear)

---

## NOTES

**Why not validate in the popup?** CLAUDE.md: "Service worker is the trust boundary. All state mutations and security checks happen in the service worker." Popup-side validation would be a convenience, not a safety net — a malicious/buggy popup build could still send bad messages. Keep validation in one place where it can't be bypassed.

**Why not extend `normalizeDomain` to throw on invalid?** It's used in other contexts (e.g. matching current tab domain for unlock). Making it stricter could break those call sites. Separate concerns: `normalizeDomain` = canonicalize, `isValidDomain` = validate. Explicit is better.

**Why not use a library like `psl` (public suffix list)?** Runtime-deps policy: "No runtime dependencies" (CLAUDE.md). PSL would be the correct choice for rejecting e.g. `.co.uk` TLD corner cases, but the bug at hand is keyboard-smash, not TLD edge cases. KISS: a simple label regex + dot check covers 99% of real input. Revisit if users report false-positives/negatives.

**Error message format** — `Not a valid domain: "xxx"` is short, quoted (so trailing whitespace is visible), and actionable. Don't prefix with `Error:` — the popup UI adds its own styling.
