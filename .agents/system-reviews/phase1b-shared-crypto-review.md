# System Review: Phase 1b — shared/crypto.ts + shared/cbor.ts

**Date:** 2026-04-08  
**Plan:** `.agents/plans/phase1b-shared-crypto.md`  
**Execution Report:** `.agents/execution-reports/phase1b-shared-crypto.md`  
**Code Review (final):** `.agents/code-reviews/phase1b-shared-crypto-v3.md`

---

## Overall Alignment Score: 9/10

Implementation was faithful, all 15 tasks completed, all acceptance criteria met. The single structural divergence (third file `webauthn.ts`) was both justified and correct. Minor issues in the code review were resolved across iterations.

---

## Divergence Analysis

```yaml
divergence: Unplanned third file — shared/webauthn.ts
planned: All exports in shared/crypto.ts + shared/cbor.ts
actual: High-level entry points (verifyRegistration, verifyAssertion) split into shared/webauthn.ts
reason: crypto.ts reached 445 lines with all functions included — 300-line limit is an acceptance criterion
classification: good ✅
justified: yes
root_cause: Plan line-count estimate was too optimistic; no per-section budget was provided
```

```yaml
divergence: verifySignature catches DER parse errors internally, returns false
planned: derToP1363 throws; callers handle errors
actual: verifySignature wraps derToP1363 in try/catch and returns false on any parse failure
reason: Test contract for verifySignature is "returns false for invalid signature" — malformed DER is not a valid signature
classification: good ✅
justified: yes
root_cause: Plan specified return type correctly (boolean) but didn't clarify DER-parse-error contract
```

```yaml
divergence: Defensive try/catch left in verifyAssertion around verifySignature
planned: not specified
actual: try/catch wraps verifySignature call even though it now returns false instead of throwing
reason: Left as defensive guard against unexpected future throws; no functional impact
classification: good ✅
justified: yes — low cost, defensive depth is fine at a trust boundary
root_cause: Minor; no plan gap
```

---

## Code Review Iteration Count: 3

Three review passes were needed. This is one too many for a well-planned feature. Root causes:

1. **v1 → v2:** UP flag not checked in verifyRegistration/verifyAssertion. This is a security requirement explicit in CLAUDE.md ("UP flag required") but not in the plan's verification steps.
2. **v2 → v3:** Missing `instanceof Map` guard before `.get()` on decoded attestationObject. The plan showed a type assertion (`as CborMap`) without flagging that it must be a runtime-checked guard for external input.

---

## Pattern Compliance

- [x] Followed codebase architecture (no logger in shared/, pure exports, no default exports)
- [x] Used documented patterns (DataView for multi-byte reads, strict typing, JSDoc on all exports)
- [x] Applied testing patterns correctly (describe/it/expect, @/ imports, programmatic keys)
- [x] Met validation requirements (lint → typecheck → tests → build all green)
- [x] No file exceeds 300 lines

---

## System Improvement Actions

### Update CLAUDE.md

- [ ] **Add WebCrypto strict-mode gotcha:**
  ```
  ## WebCrypto / TypeScript Strict Mode Gotchas
  
  **`Uint8Array.buffer` is `ArrayBufferLike`, not `ArrayBuffer`:**
  SubtleCrypto APIs and `ArrayBuffer`-typed fields require `ArrayBuffer` specifically.
  Use `.slice().buffer as ArrayBuffer` or cast explicitly when assigning to typed storage fields.
  ```

- [ ] **Add runtime guard requirement for CBOR/external-input decoding:**
  ```
  ## Decoding External Input
  
  When decoding CBOR or any external-input format, always add a runtime type guard
  before calling methods on the decoded value — even when TypeScript types are satisfied:
  
  // ✅ Correct
  const decoded = cborDecode(bytes);
  if (!(decoded instanceof Map)) throw new Error('expected CBOR map');
  const map: CborMap = decoded;
  
  // ❌ Avoid — type assertion without runtime check
  const map = cborDecode(bytes) as CborMap;
  map.get('authData'); // throws TypeError if decoded was not actually a Map
  ```

- [ ] **Clarify logging policy for shared/ vs slices:**
  The code review v3 incorrectly suggested adding `logger` imports to `shared/webauthn.ts`. 
  CLAUDE.md already says "shared/ utilities do NOT log", but this was missed by the reviewer.
  Reinforce by adding to CLAUDE.md:
  ```
  ## Logging Boundary: shared/ vs slices
  
  shared/ utilities NEVER import logger. Logging belongs exclusively in slice handlers
  (unlock/, credential/, etc.) where domain, trace_id, and tab_id context is available.
  The code reviewer flagging "no logging in verifyRegistration" is a false positive.
  ```

### Update Plan Template (plan-feature.md / phase1b plan)

- [ ] **Add per-section line-count budget.** The plan said "keep files under 300 lines" but didn't budget how lines would be distributed. Add a step:
  > Before estimating file splits, rough-count lines per exported symbol: types (~5), small functions (~15–25), complex functions (~40–60). Sum per file. If total approaches 250, plan an additional split point now.

- [ ] **Specify error contract for all boolean-return functions.** For functions like `verifySignature`, add:
  > Specify the contract for malformed-input cases explicitly: "returns false for any reason the signature cannot be verified, including malformed encoding." This prevents the plan from being ambiguous between "returns false" (catch internally) vs "throws" (caller catches).

- [ ] **Flag UP flag checks as a required step in WebAuthn verification plans.** The v1 code review found missing UP flag checks. Add to any WebAuthn implementation plan:
  > Security checklist: (1) UP flag set in authData, (2) rpIdHash matches, (3) challenge matches, (4) origin matches, (5) sign counter monotonicity.

- [ ] **CBOR test-helper byte encoding note.** The `buildAttestationObject` bug (0x68 vs 0x67 for "attStmt", 7 chars) cost a debugging cycle. Add:
  > When writing CBOR test helpers with hardcoded bytes, verify text-string headers: `0x60 | len` where len is the UTF-8 byte count of the string. Off-by-one is common — count carefully.

---

## Key Learnings

**What worked well:**
- TDD mandate was followed and caught integration bugs early (e.g., `buildAttestationObject` CBOR encoding bug surfaced during red phase, not after)
- `buildAuthData` / `buildCoseKey` / `p1363ToDer` test helpers made integration tests readable and maintainable without hardcoded blobs — the plan's suggestion here was correct
- The plan's `derToP1363` implementation was provided verbatim and worked first try
- The 3-file split (cbor / crypto / webauthn) is the right architecture — the plan's 2-file estimate was optimistic but the natural third split point was obvious

**What needs improvement:**
- Plans for security-critical code should include an explicit security checklist (UP flag, rpIdHash, challenge, origin, counter) rather than leaving it implicit
- Plans that specify type assertions (`as T`) on decoded external input should always pair them with a required runtime guard note
- Code review passes should check against the "no logger in shared/" rule explicitly — it was missed in v3

**For next implementation:**
- Use the per-section line budget technique before starting any multi-function file
- Pre-list all external-input decode sites and mark each one "needs runtime guard"
- When a plan says "export X from file Y," run a rough line-count estimate across all planned exports before writing any code
