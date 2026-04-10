# Code Review: unlock-redirect-and-popup-timer

## Stats

- Files Modified: 8
- Files Added: 0
- Files Deleted: 0
- New lines: +608
- Deleted lines: -98

---

## Issues

---

```
severity: high
file: src/blocklist/blocklist.rules.ts
line: 64
issue: domainAllowRuleId hash space (500 IDs) creates rule collision risk
detail: `(hash % 500) + ALLOW_RULE_ID_BASE` yields only 500 distinct IDs
(2000–2499). With 20 blocked domains, the birthday-problem collision
probability is ~31%; with 30 it climbs to ~58%. When two domains A and B
collide to the same ID, calling `addAllowRule(B)` removes A's active allow
rule — silently re-blocking a domain the user just unlocked. The symptom is
non-deterministic: navigation to domain A starts failing after domain B is
unlocked.
suggestion: Use the full 32-bit hash as the ID base and reserve a wider band
for allow rules. E.g. keep ALLOW_RULE_ID_BASE = 2000 but use modulo 30000
(Chrome's dynamic rule limit is 30 000 total):

  return (hash % 30000) + ALLOW_RULE_ID_BASE;

Or, because the service-worker already tracks sessions keyed by domain,
store the ruleId as a sequential counter instead of a hash, guaranteeing
uniqueness as long as the session map is the source of truth.
```

---

```
severity: medium
file: src/popup/popup.ts
line: 1
issue: File exceeds 300-line limit (344 lines) — refactor candidate
detail: Per CLAUDE.md the ~300-line limit signals a need to split by
responsibility. `popup.ts` currently owns helpers (sendMessage, formatTime,
escapeHtml, show/hide/showError/clearError), render logic (renderBlocklist,
initTimers, setRegisteredState, setUnregisteredState), and four distinct
async workflows (init, handleRegister, handleAddDomain, event wiring).
suggestion: Extract the pure helpers + render/timer functions into a
`popup.render.ts` module, leaving only the workflow handlers and boot
sequence in `popup.ts`. Alternatively extract `initTimers` into a dedicated
`popup.timers.ts`.
```

---

```
severity: low
file: src/unlock/unlock.handler.test.ts
line: 16
issue: mockSetCredential imported and reset but never asserted
detail: `mockSetCredential` is declared, reset in `beforeEach`, but no test
calls `expect(mockSetCredential).toHaveBeenCalled*`. This is dead test
scaffolding — it creates the impression that credential persistence is
covered when it isn't.
suggestion: Either add an assertion in the "returns ok:true" test that
`mockSetCredential` was called with the updated sign counter, or remove the
import and reset to keep the test surface honest.
```

---

## Previously Flagged (Resolved)

The following issues were raised in the prior review pass and are **fixed** in
the current code:

- ✅ `regexFilter` trailing `.*` replaced with `(?:[/?#].*)?$` — domain
  boundary now properly anchored.
- ✅ `setInterval` no-op guard added (`if (!hasActive) return`).
- ✅ `void initTimers(...).catch(...)` pattern applied at both call sites.

## Summary

One high-severity functional bug (allow-rule ID hash collision) and one
medium housekeeping flag (file size). The security model remains sound —
`originalUrl` is always constrained by the regex to start with `https?://`,
the `indexOf('&url=')` parse correctly handles embedded `&` and `?` in the
captured URL, and the WebAuthn transport filter correctly blocks `internal`
and `hybrid` transports.

The hash collision bug should be fixed before shipping; the file-size split
and test cleanup are optional improvements.
