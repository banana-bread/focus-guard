# Code Review: Phase 1b — shared/crypto.ts + shared/cbor.ts

**Date:** 2026-04-08  
**Reviewer:** Claude  
**Branch:** rewrite/vsa-typescript

---

## Stats

- Files Added: 5 (`cbor.ts`, `cbor.test.ts`, `crypto.ts`, `crypto.test.ts`, `webauthn.ts`)
- Files Modified: 0
- New lines: +1,465
- Deleted lines: 0

---

## Issues Found

---

```
severity: high
file: src/shared/crypto.ts
line: 119
issue: AT flag boundary check uses wrong threshold — misses edge case
detail: The check `if (authData.length < 55)` fires only when the AT flag is set, but
        55 is the minimum to read AAGUID (bytes 37–52) AND credIdLen (bytes 53–54). This
        is correct for the AAGUID case, but the authData spec places credIdLen at bytes
        53–54, meaning a buffer of exactly 54 bytes would allow AAGUID extraction but
        crash DataView.getUint16(53) with a bounds error when trying to read credIdLen.
        The check should be `< 55` to ensure both AAGUID and credIdLen are readable, which
        is what it does — BUT the check only covers ≥55, not ≥55+credIdLen. If credIdLen
        is nonzero and there are no credential bytes, `authData.slice(55, credIdEnd)` on a
        55-byte buffer with credIdLen=4 would return an empty Uint8Array rather than throwing.
        The subsequent check on line 128 (`if (authData.length < credIdEnd)`) does catch
        this, so the logic is actually correct end-to-end. However, the comment on line 119
        says "< 55 bytes" but the minimum needed to safely reach credIdLen is 55 bytes (for
        the 2-byte credIdLen field at offsets 53–54), not 54. This is correct — no real bug,
        but the threshold needs a 1-byte note: 53+2=55 is the minimum to read credIdLen.
        *** After re-analysis this is NOT a bug. Downgrading to medium. ***
```

```
severity: medium
file: src/shared/webauthn.ts
line: 84–87
issue: AT flag is checked after rpIdHash — ordering leak in verifyRegistration
detail: `verifyRegistration` checks `rpIdHash` (step 4) before checking the AT flag
        (step 5). The AT flag check should logically come first: if AT is not set,
        there is no credential data to extract, so `parsed.credentialId` and
        `parsed.publicKeyCose` are empty Uint8Arrays (per the parseAuthData fallback).
        The rpIdHash check still works on empty data because rpIdHash is always
        populated. This is not a security vulnerability (rpIdHash is checked either way),
        but it means a request with AT=0 will be rejected with "rpIdHash mismatch" instead
        of the more informative "AT flag not set" if the rpId also happens to be wrong.
        The ordering in the plan's steps was: (3) clientDataJSON, (4) rpIdHash, (5) AT flag.
        Inverting 4 and 5 gives a better error message path with no security impact.
```

```
severity: medium
file: src/shared/webauthn.ts
line: 141–149
issue: Redundant try/catch around verifySignature — dead code path
detail: `verifySignature` (crypto.ts:254–259) already catches all DER parse errors
        internally and returns `false`. It no longer throws under any reachable path.
        The try/catch in `verifyAssertion` (lines 142–146) will never be entered.
        The `if (!valid)` check on line 147 is sufficient. The dead try/catch adds
        noise and misleads readers into thinking `verifySignature` can throw.
suggestion: Remove the try/catch. Keep only:
        const valid = await verifySignature(publicKey, authenticatorData, clientDataJSON, signature);
        if (!valid) throw new Error('assertion_signature_invalid');
```

```
severity: medium
file: src/shared/crypto.ts
line: 249
issue: Unnecessary .slice() on clientDataJSON before digest
detail: `clientDataJSON.slice()` creates a full copy of the bytes solely to work around
        the TypeScript `ArrayBufferLike` issue. But `crypto.subtle.digest` accepts
        `BufferSource` which includes `ArrayBufferView`. A `Uint8Array` IS an
        `ArrayBufferView`, so the type error only appears when the Uint8Array was created
        from a `SharedArrayBuffer`-backed array (which never happens in this codebase).
        The `.slice()` call allocates an unnecessary copy on every signature verification.
        Similarly, `.slice()` on line 263 and 264 for `p1363` and `signedData` are
        unnecessary copies — `subtle.verify` doesn't mutate its inputs.
suggestion: Assert the type instead: `clientDataJSON as unknown as Uint8Array<ArrayBuffer>`
        or simply use `// @ts-expect-error` with a comment, or restructure to avoid the
        issue (e.g., always construct Uint8Arrays from `new ArrayBuffer()`). The cleanest
        fix is a single helper: `function toBuffer(u: Uint8Array): ArrayBuffer {
        return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; }`.
        But for MVP, `.slice()` is acceptable if the allocation cost is understood.
```

```
severity: medium
file: src/shared/crypto.ts
line: 273–292
issue: derToP1363 does not validate r/s component length after stripping sign byte
detail: After stripping the optional leading 0x00 sign-extension byte, r or s could
        still be > 32 bytes (e.g., a malformed DER where rLen=34). The current code
        calls `out.set(r, 32 - r.length)` which would produce a negative offset
        (e.g., `32 - 34 = -2`) and throw a RangeError. While `verifySignature` wraps
        this in try/catch and returns false, the validation gap means corrupted DER
        with unexpectedly large components silently returns false instead of a clear
        parse error. This doesn't cause incorrect verification (still returns false),
        but the root cause is obscured.
suggestion: After stripping the sign byte, add:
        `if (r.length > 32) throw new Error('der_to_p1363: r component too long');`
        `if (s.length > 32) throw new Error('der_to_p1363: s component too long');`
        This makes the failure mode explicit rather than incidentally caught.
```

```
severity: low
file: src/shared/crypto.ts
line: 294–296
issue: Re-exports of verifyRegistration/verifyAssertion are unnecessary indirection
detail: crypto.ts re-exports functions it doesn't use from webauthn.ts solely to
        satisfy the plan's acceptance criteria ("shared/crypto.ts exports X"). No
        current callers exist. When the credential/ and unlock/ slices are built,
        they'll import from wherever the functions actually live. These re-exports
        add a layer of indirection that makes the module graph less honest.
suggestion: Remove the re-exports. Slice handlers should import directly from
        `@/shared/webauthn`. Update the acceptance criteria note in the plan if needed.
        (This was already flagged by the user during review.)
```

```
severity: low
file: src/shared/webauthn.ts
line: 162–168
issue: Duplicated bytesEqual / rpIdHashEqual utility
detail: `webauthn.ts` defines `rpIdHashEqual` and `crypto.ts` defines `bytesEqual` —
        they are identical functions with different names. This duplication exists
        because `bytesEqual` is unexported in `crypto.ts` (correctly — it's an
        internal helper) and `webauthn.ts` can't import it.
suggestion: Export `bytesEqual` from `crypto.ts` (rename to something generic) and
        import it in `webauthn.ts`, removing `rpIdHashEqual`. Or keep the duplication
        as-is since both are 6 lines and the coupling isn't worth it at this scale.
```

```
severity: low
file: src/shared/cbor.ts
line: 48–52
issue: byte string slice shares underlying ArrayBuffer
detail: `new Uint8Array(view.buffer, view.byteOffset + offset, argument)` creates a
        view into the original buffer without copying. The subsequent `.slice()` call
        correctly copies it. This is fine — but the intermediate view is unnecessary.
        Can simplify to: `return [new Uint8Array(view.buffer, view.byteOffset + offset,
        argument).slice(), offset + argument]`. Already doing this correctly; just a
        minor readability note.
```

```
severity: low
file: src/shared/crypto.test.ts
line: last line (671)
issue: Dead `void (cborDecode as unknown)` suppressor
detail: The line `void (cborDecode as unknown);` at the bottom of the test file is a
        workaround to suppress an "imported but never used" lint error for `cborDecode`,
        which is imported but only used indirectly via `buildAttestationObject`'s comment.
        Looking at the actual imports, `cborDecode` is imported on line 9 but not called
        anywhere in the test file — `buildAttestationObject` is a pure test helper that
        doesn't call `cborDecode` either. The import is vestigial.
suggestion: Remove the `import { cborDecode } from '@/shared/cbor'` import and the
        `void (cborDecode as unknown)` suppressor entirely.
```

---

## Summary

No critical or security issues. The WebAuthn trust boundaries are correct — all verification happens in the shared layer with no side effects, no storage access, and no logging (per spec). The sign counter rule, DER→P1363 conversion, rpIdHash and origin checks are all implemented correctly.

The most actionable fixes before the slice handlers are built:
1. **Remove the dead try/catch** in `verifyAssertion` (medium, 3 lines)
2. **Add r/s length guards** in `derToP1363` (medium, 2 lines)
3. **Remove the re-exports** at the bottom of `crypto.ts` (low, already agreed)
4. **Remove the vestigial `cborDecode` import** in `crypto.test.ts` (low, 2 lines)
