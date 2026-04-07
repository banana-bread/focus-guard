# The 5-Level Validation Pyramid

Each level gates the next. Don't proceed if a level fails.

```
        Level 5: Human Review
              (Alignment with intent)
                    |
        Level 4: Integration Tests
              (System behavior)
                    |
        Level 3: Unit Tests
              (Isolated logic)
                    |
        Level 2: Type Safety
              (Type checking)
                    |
        Level 1: Syntax & Style
              (Linting, formatting)
```

---

## Level 1: Syntax & Style

**What:** Code format and linting rules

**Why:** Catch obvious errors fast

**Tools:** ESLint (flat config), Prettier

**Commands:**

```bash
pnpm lint
pnpm format:check
```

**AI Integration:** Run automatically after file writes

---

## Level 2: Type Safety

**What:** Type checking and static analysis

**Why:** Catch type errors before runtime. This project runs strict mode — no implicit `any`.

**Tools:** TypeScript (`tsc`)

**Command:**

```bash
pnpm typecheck
```

**AI Integration:** Run before running tests

---

## Level 3: Unit Tests

**What:** Test isolated functions and classes

**Why:** Verify logic correctness

**Tools:** Vitest

**Command:**

```bash
pnpm test
```

**AI Integration:** AI writes tests alongside implementation

**Common Pitfall:** AI mocking tests to pass
**Solution:** Require real test coverage, reject mocks without justification

---

## Level 4: Integration Tests

**What:** Test system interactions — e.g., service worker message handling, storage round-trips, WebAuthn flow

**Why:** Verify components work together in the Chrome extension context

**Tools:** Vitest + Chrome API mocks (see `src/__mocks__/chrome.ts`)

**Command:**

```bash
pnpm test
```

> Note: Unit and integration tests currently run in the same suite. As coverage grows, consider splitting into `tests/unit/` and `tests/integration/` with separate scripts.

**Common Pitfall:** Tests depend on external state or real browser APIs
**Solution:** Use the Chrome API mock layer; never call real `chrome.*` APIs in tests

---

## Level 5: Human Review

**What:** Strategic alignment check

**Why:** AI can't judge intent alignment

**Focus:**

- Does it match the plan?
- Are VSA slice boundaries respected?
- Is the security model intact? (service worker as trust boundary)
- Are patterns from `.agents/reference/vsa-patterns.md` followed?
- What would you change?

**Not:** Line-by-line code review (AI handles that at levels 1–4)

---

## Embedding in Plans

Plans should specify which validation commands to run after each phase. The `/execute` command already runs all validation commands from the plan in order and loops back on failures.

Use `/validate` to run the full pyramid (levels 1–4) at any point outside of plan execution.

## Validation as Feedback

When validation fails, it reveals:

- Missing context in the plan
- Unclear requirements
- Patterns to document in `.agents/reference/`
- Commands or mocks to improve

**Don't just fix the bug. Fix the system that allowed the bug.**

When you see the same validation failures repeatedly, that's a signal to improve your system — document the pattern, update the mock layer, or tighten the plan template.

---

## Current `/validate` Command Coverage

| Level | Command | Status |
|-------|---------|--------|
| 1 — Syntax & Style | `pnpm lint` | ✅ covered |
| 2 — Type Safety | `pnpm typecheck` | ✅ covered |
| 3 — Unit Tests | `pnpm test` | ✅ covered |
| 4 — Integration Tests | `pnpm test` (shared suite) | ⚠️ partial |
| 5 — Human Review | manual | — |

### Recommended Additions to `/validate`

- **`pnpm format:check`** — currently `lint` runs ESLint but Prettier formatting is not explicitly checked. Add as a distinct step between lint and typecheck.
- **`pnpm build`** — the build step is not in the current `/validate` command. A passing test suite with a broken bundle is a false green. Add it as the final automated gate.
- **Explicit ordering** — enforce pyramid order with early exit: lint → format → typecheck → test → build.
