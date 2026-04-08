# Code Review: Phase 1b — shared/crypto.ts, shared/cbor.ts, shared/webauthn.ts (v3)

**Date:** 2026-04-08  
**Reviewer:** Claude (fresh pass — prior reviews at phase1b-shared-crypto.md, phase1b-shared-crypto-v2.md)  
**Branch:** rewrite/vsa-typescript  
**Scope:** 5 new files: cbor.ts, cbor.test.ts, crypto.ts, crypto.test.ts, webauthn.ts

---

## Prior Review Resolution

All issues from v2 review are resolved in the current code:
- ✅ UP flag checked in both `verifyRegistration` (line 86) and `verifyAssertion` (line 146)
- ✅ `importCosePublicKey` has `instanceof Map` runtime guard (line 220)
- ✅ `bytesEqual` has JSDoc with constant-time caveat
- ✅ Redundant `.slice()` before `.buffer` removed in `verifyRegistration` (line 97)
- ✅ Flag check order is now correct: clientDataJSON → rpIdHash → UP → AT

---

## Stats

- Files Added: 5
- Files Modified: 0
- New lines: ~583 (source) + ~930 (tests)
- Deleted lines: 0

---

## Issues Found

```
severity: high
file: src/shared/webauthn.ts
line: 68–70
issue: No runtime guard that cborDecode returns a Map in verifyRegistration
detail: `cborDecode(attestationObjectBytes) as CborMap` uses a type assertion without a
        runtime check. If `attestationObjectBytes` is malformed (not a CBOR map at the top
        level), `cborDecode` returns a non-Map CborValue (number, string, array, etc.).
        Then `attObj.get('authData')` at line 69 throws
        "TypeError: attObj.get is not a function" — a confusing native error with no context.
        The check at line 70 only verifies that authData is Uint8Array, not that attObj itself
        is a Map. This can be triggered by a caller passing arbitrary bytes as
        attestationObjectBytes.
suggestion: Add a guard immediately after decoding:
        const attObjDecoded = cborDecode(attestationObjectBytes);
        if (!(attObjDecoded instanceof Map)) {
          throw new Error('verifyRegistration: attestationObject is not a CBOR map');
        }
        const attObj: CborMap = attObjDecoded;
```

---

```
severity: low
file: src/shared/crypto.ts
line: 264
issue: Unnecessary .slice() on clientDataJSON before digest
detail: `crypto.subtle.digest('SHA-256', clientDataJSON.slice())` — SubtleCrypto.digest
        does not modify its input buffer. The `.slice()` allocates a full copy of the
        clientDataJSON bytes for no reason. In a hot path (multiple assertions per session),
        this creates unnecessary GC pressure.
suggestion: `const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);`
```

---

```
severity: low
file: src/shared/crypto.ts
line: 1 (file-level)
issue: File is at 304 lines — at the refactor threshold
detail: CLAUDE.md states "If a file exceeds ~300 lines, it's a refactor candidate — split by
        responsibility." crypto.ts is 304 lines. Natural split points exist:
        - base64url helpers (lines 48–74): could live in shared/base64url.ts if reused
        - authData parser (lines 79–143): could be shared/authdata.ts
        - COSE key import + signature verification (lines 208–304): stays in crypto.ts
        Not a blocking issue since the file is readable and well-organized; flagging for
        awareness before the file grows with future features.
suggestion: No immediate action required. If any of the three logical sections are needed
        by 3+ callers independently, split at that boundary.
```

---

```
severity: low
file: src/shared/webauthn.ts
line: 61–165 (both exported functions)
issue: No logging in security-critical entry points
detail: CLAUDE.md requires logging entry/exit for security-critical paths (WebAuthn flows).
        verifyRegistration and verifyAssertion are the two highest-trust functions in the
        entire extension — neither emits a single log line. If verification fails in
        production, there is no structured event to diagnose.
        Note: these are shared utilities, so the callers (in slices) are the primary place
        to log with domain/trace_id context. But the verification functions themselves should
        emit at least a debug log on entry and info/error on outcome.
suggestion: Add logger calls at entry and on success/failure:
        import { logger } from '@/core/logger';
        // in verifyRegistration:
        logger.debug('webauthn_registration_verify_start', { expectedOrigin, expectedRpId });
        // on success:
        logger.info('webauthn_registration_verified', { aaguid: parsed.aaguid, signCounter: parsed.signCounter });
        // errors should already propagate; wrap the top-level try/catch with:
        logger.error('webauthn_registration_failed', { error: ..., fix_suggestion: '...' });
```

---

## Summary

The prior high-severity UP flag issue and all medium issues are fixed. The implementation is
correct: rpIdHash verification, sign counter monotonicity, challenge/origin binding, DER→P1363
conversion, and CBOR parsing all look right. Test coverage is thorough.

**One new high issue:** missing `instanceof Map` guard before calling `.get()` on the decoded
attestationObject — can produce a confusing TypeError on malformed input.

**Three low issues:** unnecessary copy in verifySignature, file length approaching limit,
and no logging in the two critical entry points.

### Recommended fixes before unlock/ slice consumes these functions:
1. Add `instanceof Map` guard in `verifyRegistration` (high, ~4 lines)
2. Add logging to `verifyRegistration` and `verifyAssertion` (low, ~6 lines each)
3. Remove `.slice()` in `verifySignature` line 264 (low, 1 line)
