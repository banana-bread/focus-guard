# Execution Report: unlock-redirect-and-popup-timer

## Meta Information

- **Plan file**: `.agents/plans/unlock-redirect-and-popup-timer.md`
- **Files added**: None
- **Files modified**:
  - `src/blocklist/blocklist.rules.ts`
  - `src/blocked/blocked.html`
  - `src/blocked/blocked.ts`
  - `src/popup/popup.css`
  - `src/popup/popup.ts`
- **Lines changed**: +103 -68 (src/ only)

---

## Validation Results

- **Syntax & Linting**: ✓ No eslint config present; no syntax errors
- **Type Checking**: ✓ `npx tsc --noEmit` passes with zero errors (after one fix — see Challenges)
- **Unit Tests**: N/A — no automated test runner configured
- **Integration Tests**: N/A — manual only per project convention

---

## What Went Well

- **Plan quality**: All five tasks were fully specified with exact code snippets, gotchas, and validation steps. Implementation was straightforward — no ambiguity or gaps.
- **`indexOf` URL parsing**: The plan's rationale for using `indexOf('&url=')` instead of `URLSearchParams` was clear and correct. The approach handles embedded `&` and `?` in the original URL without any special-casing.
- **`regexFilter` + `regexSubstitution`**: The RE2 pattern and `escapeRegex` helper dropped in cleanly. The plan correctly identified that `urlFilter` and `regexFilter` cannot coexist.
- **Dead code removal in `blocked.ts`**: Removing `formatTime`, `startCountdown`, `showUnlockedState`, `countdownInterval`, `stateUnlocked`, and `timerEl` was clean — the file shrank from 233 to ~180 lines and the remaining logic is simpler.
- **`initTimers` design**: Parallel `Promise.all` session fetch, single shared `setInterval`, DOM-stored `expiresAt` as `data-*` attribute — all clean patterns that avoid unnecessary complexity.

---

## Challenges Encountered

**`NodeListOf` iteration under the project's `tsconfig` target**

The plan specified:
```typescript
const timerSpans = domainList?.querySelectorAll<HTMLSpanElement>('[id^="timer-"]') ?? [];
```

This caused a TS error:
```
error TS2488: Type 'never[] | NodeListOf<HTMLSpanElement>' must have a '[Symbol.iterator]()' method that returns an iterator.
```

`NodeListOf` is not iterable under the project's `lib` target (ES2020 / DOM). The fix was straightforward:
```typescript
const timerSpans = Array.from(domainList?.querySelectorAll<HTMLSpanElement>('[id^="timer-"]') ?? []);
```

`Array.from` accepts `NodeListOf` directly and produces a typed array. The issue is the `??` coalescing producing a union type `NodeListOf<...> | never[]` which the `for...of` couldn't iterate. Wrapping the entire expression in `Array.from()` resolves both the union and the iterator requirement in one step.

---

## Divergences from Plan

**`NodeListOf` fallback idiom**

- **Planned**: `?? []` as fallback for optional chaining on `querySelectorAll`
- **Actual**: `Array.from(...?? [])` wrapping the entire expression
- **Reason**: TS2488 — `NodeListOf` is not iterable at the project's lib target. The `??` produces a union type that breaks `for...of`.
- **Type**: Plan assumption wrong (assumed `NodeListOf` is iterable via `for...of` at this target)

No other divergences. All five tasks implemented exactly as specified.

---

## Skipped Items

None. All plan tasks implemented.

---

## Recommendations

### CLAUDE.md additions

Add a note about `NodeListOf` iteration:

```markdown
**`NodeListOf` iteration — always use `Array.from`:**

`NodeListOf<T>` is not directly iterable via `for...of` under this project's TS lib target. Always wrap with `Array.from()`:

```typescript
// ✅ Correct
const spans = Array.from(el?.querySelectorAll<HTMLSpanElement>('...') ?? []);

// ❌ Fails TS2488
const spans = el?.querySelectorAll<HTMLSpanElement>('...') ?? [];
```
```

### Plan command improvements

The plan's `timerSpans` snippet should use `Array.from` — the current snippet will fail type checking and could mislead future implementors. Worth noting this pattern in the plan template's "known gotchas" section.

### Execute command improvements

None — execution flow was clean. Reading all referenced files before implementing was the right call and prevented any misalignment with existing code.
