# Execution Report: Phase 1b — shared/crypto.ts + shared/cbor.ts

**Date:** 2026-04-08  
**Branch:** rewrite/vsa-typescript

---

## Meta Information

- **Plan file:** `.agents/plans/phase1b-shared-crypto.md`
- **Files added:**
  - `src/shared/cbor.ts` (114 lines)
  - `src/shared/cbor.test.ts` (214 lines)
  - `src/shared/crypto.ts` (296 lines)
  - `src/shared/crypto.test.ts` (673 lines)
  - `src/shared/webauthn.ts` (168 lines) — unplanned split, see Divergences
- **Files modified:** None
- **Lines changed:** +1,465 added, 0 removed

---

## Validation Results

- **Syntax & Linting:** ✓ zero ESLint errors
- **Type Checking:** ✓ `tsc --noEmit` clean, strict mode
- **Unit Tests (cbor):** ✓ 25/25 passed
- **Unit Tests (crypto):** ✓ 36/36 passed
- **Full suite:** ✓ 76/76 passed
- **Build:** ✓ `vite build` succeeds

---

## What Went Well

- **CBOR decoder was clean on first pass.** The DataView + major-type approach matched the spec exactly. All 25 CBOR tests passed immediately after implementation.

- **Test helpers were the right investment.** `buildAuthData`, `buildCoseKey`, `buildAttestationObject`, and `p1363ToDer` in the test file enabled clean, readable integration tests for `verifyRegistration` and `verifyAssertion` without any hardcoded byte blobs. The plan's suggestion to use these helpers was sound.

- **DER→P1363 implementation worked first try.** The plan provided the exact implementation and edge cases (33-byte r/s with leading 0x00, left-pad to 32). No surprises here.

- **Sign counter semantics were straightforward.** The 0/0 = ok, non-zero decrease = violation rule mapped directly from spec to code with no ambiguity.

- **The plan's CBOR encoding examples were accurate.** The documented byte values for major types, inline lengths (0–23), and 1/2-byte length prefixes were all correct and directly usable.

---

## Challenges Encountered

1. **`buildAttestationObject` had a CBOR encoding bug for "attStmt".** The test helper used `0x68` (major 3, length 8) for the key `"attStmt"` which is 7 characters. Should have been `0x67`. This caused CBOR decode failures in `verifyRegistration` tests with the misleading error "cbor_decode: truncated map value" rather than pointing to the key mismatch. Fixed by correcting the byte.

2. **`derToP1363` + tampered signature threw instead of returning false.** The test for "tampered signature → verifySignature returns false" failed because tampering byte 4 (the r-length field) produced an out-of-bounds `out.set(r, 32 - r.length)` call inside `derToP1363`. The solution: wrap DER parsing in `verifySignature` with a try/catch that returns `false` on parse errors. This is semantically correct — a malformed DER signature is not a valid signature.

3. **TypeScript strict-mode `ArrayBufferLike` vs `ArrayBuffer` mismatch.** `Uint8Array.prototype.buffer` returns `ArrayBufferLike` (which includes `SharedArrayBuffer`), but `SubtleCrypto` APIs require `ArrayBuffer`. The fix was to call `.slice()` to produce a fresh `Uint8Array` with a plain `ArrayBuffer` backing, or `.slice().buffer` when returning as `ArrayBuffer`.

4. **`parseAuthData` test for "AT flag but < 55 bytes" used all-zeros buffer.** The 37-byte all-zeros buffer has `flags = 0` (bit 6 not set), so the AT path was never reached. Fixed by setting `buf[32] = 0x41` before passing to the parser.

5. **`crypto.ts` exceeded 300-line limit.** The plan estimated two files would be sufficient, but the primitives layer alone reached 296 lines, leaving no room for `verifyRegistration` + `verifyAssertion`. Required a third file (`webauthn.ts`) as the natural split point.

---

## Divergences from Plan

**Unplanned third file: `shared/webauthn.ts`**

- **Planned:** All exports live in `shared/crypto.ts` and `shared/cbor.ts`.
- **Actual:** High-level entry points (`verifyRegistration`, `verifyAssertion`, `VerifiedRegistration`, `VerifiedAssertion`) moved to `shared/webauthn.ts`. `crypto.ts` re-exports them so the public API is unchanged.
- **Reason:** `crypto.ts` hit 445 lines with all functions included. The 300-line limit is a hard acceptance criterion. The split at the high-level/low-level boundary was the cleanest responsibility division.
- **Type:** Plan assumption wrong (line-count estimate was too optimistic)

**`verifySignature` catches DER parse errors and returns `false`**

- **Planned:** `derToP1363` throws on malformed DER; callers handle errors.
- **Actual:** `verifySignature` catches DER parse errors internally and returns `false`. `verifyAssertion` still throws `assertion_signature_invalid` via the `if (!valid)` path.
- **Reason:** The test contract for `verifySignature` (used directly in tests) is "returns false for tampered signature" — not "throws". Internally catching and returning false is the correct semantic: a malformed signature is simply not valid.
- **Type:** Better approach found

**`verifyAssertion` wraps `verifySignature` in try/catch redundantly**

- **Planned:** `verifySignature` throws, `verifyAssertion` catches.
- **Actual:** `verifySignature` now returns `false` for all failure cases (DER errors and crypto failures). The try/catch in `verifyAssertion` is defensive but unnecessary. Left in place as it guards against unexpected future throws without any cost.
- **Type:** Minor — no functional impact.

---

## Skipped Items

Nothing was skipped. All 15 tasks were implemented. All acceptance criteria are met:

- [x] `shared/cbor.ts` exports `cborDecode`, `CborValue`, `CborMap`
- [x] `shared/crypto.ts` exports all specified functions and types (via re-export where needed)
- [x] All exported types: `ParsedAuthData`, `VerifiedRegistration`, `VerifiedAssertion`
- [x] No file exceeds 300 lines
- [x] All tests pass
- [x] Zero TypeScript errors
- [x] Zero lint errors
- [x] `pnpm build` succeeds
- [x] DER→P1363 implemented
- [x] Sign counter rule matches spec
- [x] AAGUID formatted as UUID string

---

## Recommendations

### Plan command improvements

- **Provide explicit line-count budgets per section.** The plan said "keep both files under 300 lines" but didn't budget how many lines each logical section would consume. A rough budget (e.g., "CBOR decoder: ~100 lines, base64url + challenge: ~30 lines, authData parser: ~60 lines...") would have flagged the overflow before implementation started.

- **Document the CBOR encoding of test helper bytes explicitly.** The plan described the `buildAttestationObject` helper conceptually but left byte-level CBOR encoding to the implementer. The 1-byte-off bug for `"attStmt"` (7 vs 8 chars) was caused by this. Including a note like "count string lengths carefully for major-type-3 headers" would prevent this.

- **Specify error contract for `verifySignature` more precisely.** The plan said it "returns false for tampered signature" in the test section but didn't address what happens when the signature is malformed DER (not just cryptographically wrong). Clarifying "returns false for any invalid signature, including malformed DER" would have surfaced the `derToP1363` catch pattern earlier.

### Execute command improvements

- No significant gaps. The TDD mandate (write tests first, run to confirm red, then implement) was followed and caught integration issues early.

### CLAUDE.md additions

- Consider adding a note: **"Uint8Array.buffer is `ArrayBufferLike`, not `ArrayBuffer`. Use `.slice().buffer` when passing to SubtleCrypto APIs or assigning to `ArrayBuffer`-typed fields."** This is a recurring strict-mode gotcha with WebCrypto.
