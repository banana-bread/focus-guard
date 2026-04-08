# Code Review: Phase 1b — shared/crypto.ts, shared/cbor.ts, shared/webauthn.ts (v2)

**Date:** 2026-04-08  
**Reviewer:** Claude (independent pass — prior review at phase1b-shared-crypto.md)  
**Branch:** rewrite/vsa-typescript  
**Scope:** All 5 new files: cbor.ts, cbor.test.ts, crypto.ts, crypto.test.ts, webauthn.ts

---

## Stats

- Files Added: 5
- Files Modified: 0
- New lines: ~700 (source) + ~670 (tests)
- Deleted lines: 0

---

## Issues Found

---

```
severity: high
file: src/shared/webauthn.ts
line: 74–95 (verifyRegistration), 132 (verifyAssertion)
issue: User Presence (UP) flag never checked — authenticator presence bypass
detail: WebAuthn Level 2 §7.1 step 17 (registration) and §7.2 step 17 (assertion) require
        that the UP flag (bit 0 of the flags byte) MUST be set. Without this check, a
        response synthesized from a credential where the user did not actually touch the
        device would be accepted. In verifyRegistration, `parsed.flags` is available at
        line 81 but only the AT flag (bit 6) is checked. In verifyAssertion, `parsed.flags`
        is available at line 132 but no flag checks are performed at all.
        For a hardware-key security extension this is a material security gap: the whole
        threat model is "friction from physical touch" — skipping the UP check undermines it.
suggestion: In verifyRegistration, after line 82 (AT flag check), add:
        const upFlag = parsed.flags & 0x01;
        if (!upFlag) throw new Error('verifyRegistration: UP flag not set — user presence required');
        In verifyAssertion, after line 132, add:
        const upFlag = parsed.flags & 0x01;
        if (!upFlag) throw new Error('verifyAssertion: UP flag not set — user presence required');
        Add corresponding test cases to crypto.test.ts for both paths (flags=0x40, flags=0x00).
```

---

```
severity: medium
file: src/shared/crypto.ts
line: 208
issue: importCosePublicKey does not validate that cborDecode returned a Map
detail: `cborDecode(coseKey) as CborMap` uses a type assertion without runtime verification.
        If `coseKey` is malformed CBOR (e.g., a byte string instead of a map), `cborDecode`
        will return a non-Map CborValue. The subsequent `map.get(-2)` call will throw
        "map.get is not a function" — a confusing runtime error that leaks internal structure
        to the caller.
        Given that the COSE key bytes come from stored credential data, this is unlikely in
        practice, but it violates the principle of failing explicitly.
suggestion: Replace the cast with a runtime check:
        const decoded = cborDecode(coseKey);
        if (!(decoded instanceof Map)) {
          throw new Error('importCosePublicKey: COSE key is not a CBOR map');
        }
        const map = decoded;
```

---

```
severity: medium
file: src/shared/webauthn.ts
line: 81–88
issue: AT flag checked after rpIdHash — inverted order gives misleading error messages
detail: verifyRegistration checks rpIdHash (line 86) before the AT flag (line 82).
        If both are wrong, the caller gets "AT flag not set" only if the rpId happens to
        match; otherwise they get "rpIdHash mismatch". The spec-recommended order is:
        (1) clientDataJSON, (2) rpIdHash, (3) UP flag, (4) AT flag.
        There is no security impact since both checks are performed, but error attribution
        is wrong when both conditions are violated simultaneously.
suggestion: Move the AT flag check (lines 81–84) to after the rpIdHash comparison (line 86).
```

---

```
severity: low
file: src/shared/webauthn.ts
line: 92
issue: Redundant .slice() before .buffer in verifyRegistration
detail: `parsed.publicKeyCose.slice().buffer` — `parseAuthData` already returns
        `publicKeyCose` as a freshly allocated Uint8Array via `authData.slice(credIdEnd)`.
        That slice already owns an independent ArrayBuffer, so the additional `.slice()`
        creates a gratuitous copy.
suggestion: `publicKey: parsed.publicKeyCose.buffer as ArrayBuffer`
        or, if the sub-array offset concern matters:
        `publicKey: parsed.publicKeyCose.buffer.slice(
          parsed.publicKeyCose.byteOffset,
          parsed.publicKeyCose.byteOffset + parsed.publicKeyCose.byteLength
        )`
        But since parseAuthData.slice() always produces a zero-offset Uint8Array,
        `parsed.publicKeyCose.buffer` is sufficient.
```

---

```
severity: low
file: src/shared/crypto.ts
line: 185
issue: bytesEqual is exported without JSDoc
detail: All exported symbols require JSDoc per CLAUDE.md. bytesEqual has no doc comment.
suggestion: Add:
        /**
         * Compares two Uint8Arrays for constant-time-like byte equality.
         *
         * @param a - First byte array.
         * @param b - Second byte array.
         * @returns true if both arrays have the same length and identical bytes.
         */
        Note: this is NOT constant-time (early exit on length mismatch, loop exits on first
        different byte). If used for secret comparison in the future, replace with a
        constant-time implementation. Add a @remarks note to this effect.
```

---

## Prior Review Status

The prior review (phase1b-shared-crypto.md) flagged several issues. Current code status:

| Prior issue | Status in current code |
|---|---|
| Dead try/catch in verifyAssertion | **Already resolved** — no try/catch exists in current webauthn.ts |
| Re-exports at bottom of crypto.ts | **Already resolved** — no re-exports in current crypto.ts |
| Vestigial `cborDecode` import in test | **Already resolved** — crypto.test.ts imports only from @/shared/crypto and @/shared/webauthn |
| r/s length guard in derToP1363 | **Already resolved** — lines 276 and 283 add explicit throws |
| Unnecessary .slice() on clientDataJSON | **Partially present** — still `.slice()` on line 249, low priority |
| AT flag before rpIdHash ordering | **Still present** — carried forward as medium above |
| bytesEqual / rpIdHashEqual duplication | **Not applicable** — webauthn.ts uses `bytesEqual` imported from crypto.ts directly; no duplication |

---

## Summary

**One new critical security issue:** UP flag (user presence) is never verified in either registration or assertion. This is a direct violation of the WebAuthn spec and undermines the extension's core security model. Fix before any slice handlers call these functions.

**Two medium issues:** COSE key type validation and flag check ordering.

**Two low issues:** redundant copy and missing JSDoc.

The CBOR decoder, DER→P1363 conversion, rpIdHash verification, sign counter enforcement, and challenge/origin checks are all correctly implemented. Test coverage is thorough for the happy path and common error cases.

### Recommended fixes before unlock/ slice is built:
1. **Add UP flag checks** to both `verifyRegistration` and `verifyAssertion` (high, ~4 lines)
2. **Add Map type guard** in `importCosePublicKey` (medium, ~3 lines)
3. **Add UP flag test cases** to crypto.test.ts (high companion, ~20 lines)
