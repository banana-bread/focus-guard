# Feature: Phase 1b — `shared/crypto.ts` + `shared/cbor.ts`

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Implement the WebAuthn cryptographic helper layer for Focus Guard. This is the last missing Phase 1 deliverable — `shared/crypto.ts` (and its extracted helper `shared/cbor.ts`). These modules provide the building blocks that all security-critical slices (`credential/`, `unlock/`) depend on: challenge generation, base64url encoding/decoding, minimal CBOR decoding (for `attestationObject`), `authData` parsing (extracts AAGUID, credentialId, public key coordinates), `clientDataJSON` verification, and signature verification via SubtleCrypto.

**TDD mandate**: Write failing tests first, then implement. Each logical unit gets its own `describe` block. Tests use programmatically generated keys (SubtleCrypto in jsdom) — no hardcoded byte blobs.

## User Story

As a Focus Guard developer  
I want cryptographic primitives for WebAuthn registration and assertion verification  
So that slice handlers can verify hardware key interactions without re-implementing crypto

## Problem Statement

`shared/crypto.ts` is listed in the Phase 1 deliverables (MVP PRD §13) but has not been implemented. Without it, the `credential/` and `unlock/` slices cannot be built. The module must handle the non-obvious WebAuthn gotchas documented in MVP PRD §16 (CBOR encoding, origin format, sign counter semantics, AAGUID extraction).

## Solution Statement

Split the implementation into two files to respect the 300-line limit:

1. **`shared/cbor.ts`** — minimal CBOR decoder sufficient to parse `attestationObject` (map + byte-string values only; no full CBOR spec needed)
2. **`shared/crypto.ts`** — challenge generation, base64url helpers, `authData` parser, `clientDataJSON` verifier, signature verifier, and two high-level entry points: `verifyRegistration` and `verifyAssertion`

All crypto uses the Web Crypto API (`crypto.subtle`) — available in both Chrome extension service workers and jsdom (Vitest).

## Feature Metadata

**Feature Type**: New Capability  
**Estimated Complexity**: High  
**Primary Systems Affected**: `shared/` layer — consumed by `credential/` and `unlock/` slices  
**Dependencies**: Web Crypto API (built-in), no npm packages

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `src/core/config.ts` (full file) — `ALLOWED_TRANSPORTS`, `REJECTED_TRANSPORTS`, `AAGUID_ALLOWLIST`, `CHALLENGE_TTL_MS`, `RP_ID`. The crypto helpers must be agnostic to these constants (callers pass them in), but understanding what they are informs parameter naming.
- `src/core/storage.ts` (lines 21-26) — `StoredCredential` interface: `{ credentialId: Uint8Array; publicKey: ArrayBuffer; signCounter: number; aaguid: string }`. `verifyRegistration` must return a shape compatible with this.
- `src/core/messages.ts` (lines 22-43) — `RequestMessage`. The `attestation` and `assertion` fields are `Uint8Array`. This informs the function signatures in `shared/crypto.ts`.
- `src/shared/domain.ts` — pattern reference: a focused utility module with JSDoc, `export function`, no default exports, ~20 lines. Mirror this style.
- `src/shared/domain.test.ts` — **primary test pattern reference**: `describe`/`it`/`expect`, imports via `@/shared/...`, no test setup needed for pure functions.
- `src/core/logger.test.ts` — pattern for tests that need `vi.spyOn` or env manipulation.
- `src/__mocks__/chrome.ts` — already registered as `setupFiles` in `vitest.config.ts`. `globalThis.chrome` is available in all tests.
- `vitest.config.ts` — `environment: 'jsdom'` → SubtleCrypto is available via `globalThis.crypto.subtle`.

### New Files to Create

- `src/shared/cbor.ts` — minimal CBOR decoder
- `src/shared/cbor.test.ts` — unit tests for CBOR decoder
- `src/shared/crypto.ts` — WebAuthn crypto helpers
- `src/shared/crypto.test.ts` — unit + integration tests for crypto helpers

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [WebAuthn Spec — authData structure](https://www.w3.org/TR/webauthn-2/#sctn-authenticator-data)
  - Section: Authenticator Data, §6.1
  - Why: Defines the exact byte layout of `authData` (rpIdHash[32] | flags[1] | signCount[4] | AAGUID[16] | credIdLen[2] | credId[N] | COSE key)
- [WebAuthn Spec — Registration verification](https://www.w3.org/TR/webauthn-2/#sctn-registering-a-new-credential)
  - Section: §7.1 steps 1–21
  - Why: Defines exactly what to check in `clientDataJSON` and `attestationObject`
- [WebAuthn Spec — Assertion verification](https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion)
  - Section: §7.2
  - Why: Defines sign-counter check semantics and signature verification steps
- [COSE Key Format (RFC 8152)](https://datatracker.ietf.org/doc/html/rfc8152#section-13.1)
  - Section: §13.1 — EC2 key parameters (kty=2, alg=-7, crv=1, x, y)
  - Why: `authData` embeds the credential public key as a COSE_Key CBOR map; need to extract `x` and `y` to import via `SubtleCrypto.importKey`
- [SubtleCrypto.importKey — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)
  - Section: ECDSA with P-256 (named curve)
  - Why: Import raw/COSE public key for `verify` operation
- [SubtleCrypto.verify — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify)
  - Section: ECDSA
  - Why: Verify the assertion signature over `authData + SHA-256(clientDataJSON)`
- [webauthn.guide](https://webauthn.guide/)
  - Why: Human-readable walkthrough of the full 19-step process; see also MVP PRD §16 for the gotcha checklist distilled from this resource

### Patterns to Follow

**File structure** (mirror `src/shared/domain.ts`):
```typescript
/**
 * Module-level JSDoc.
 */

export function foo(...): ... { ... }
```
No default exports, no classes, exported pure functions only.

**Test structure** (mirror `src/shared/domain.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { foo } from '@/shared/crypto';

describe('foo', () => {
  it('does X when Y', () => {
    expect(foo(input)).toBe(expected);
  });
});
```

**JSDoc** (required on all exports, per `CLAUDE.md`):
```typescript
/**
 * Short summary.
 *
 * @param paramName - Description.
 * @returns Description.
 * @throws {ErrorType} When condition.
 */
```

**Logging**: `shared/` utilities do NOT log. Callers (slice handlers) log using `createLogger`. Do not import logger in `shared/`.

**Error throwing**: Throw typed `Error` with a descriptive message. Use `VerificationError` only if it provides value — in MVP, a plain `Error` with a descriptive string is fine.

---

## IMPLEMENTATION PLAN

### Phase 1: CBOR Decoder (TDD)

Write `cbor.test.ts` first, then `cbor.ts`.

The CBOR decoder only needs to handle the subset of CBOR used in a WebAuthn `attestationObject`:
- Major type 5 (map) — top-level object with string/int keys
- Major type 2 (byte string) — for `authData`, `sig`, `x5c`
- Major type 3 (text string) — for `fmt`
- Major type 4 (array) — for `x5c`
- Major type 0/1 (unsigned/negative int) — for map keys and COSE key entries

**Not needed**: tagged items, floats, indefinite-length encoding, streaming.

### Phase 2: Base64url Helpers + Challenge Generation (TDD)

Write tests first. Functions:
- `generateChallenge(): Uint8Array` — `crypto.getRandomValues(new Uint8Array(32))`
- `base64urlEncode(data: Uint8Array): string`
- `base64urlDecode(str: string): Uint8Array`

These are pure and easily testable with round-trip assertions.

### Phase 3: `authData` Parser (TDD)

Write tests first with hand-crafted `authData` byte arrays to verify correct extraction.

`authData` layout (bytes):
```
[0..31]   rpIdHash        — SHA-256 of rpId (32 bytes)
[32]      flags           — bit 0 = UP (user presence), bit 6 = AT (attested credential data present)
[33..36]  signCount       — uint32 big-endian
[37..52]  aaguid          — 16 bytes (only present if AT flag set)
[53..54]  credIdLen       — uint16 big-endian
[55..55+credIdLen-1] credentialId
[55+credIdLen..] credentialPublicKey — CBOR COSE_Key
```

Function:
```typescript
export interface ParsedAuthData {
  rpIdHash: Uint8Array;       // 32 bytes
  flags: number;              // raw flags byte
  signCounter: number;        // uint32
  aaguid: string;             // formatted as "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  credentialId: Uint8Array;
  publicKeyCose: Uint8Array;  // raw COSE_Key bytes (CBOR map)
}

export function parseAuthData(authData: Uint8Array): ParsedAuthData
```

### Phase 4: `clientDataJSON` Verifier (TDD)

Write tests first.

```typescript
export function verifyClientData(
  clientDataJSON: Uint8Array,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: Uint8Array,
  expectedOrigin: string,
): void  // throws on any mismatch
```

Checks:
1. Decode `clientDataJSON` as UTF-8 JSON
2. `type === expectedType`
3. base64url decode `challenge` field and compare with `expectedChallenge` (constant-time not required for challenge — it's not secret)
4. `origin === expectedOrigin`

### Phase 5: Public Key Import + Signature Verification (TDD)

```typescript
export async function importCosePublicKey(coseKey: Uint8Array): Promise<CryptoKey>
export async function verifySignature(
  publicKey: CryptoKey,
  authData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
): Promise<boolean>
```

`verifySignature` computes: `ECDSA-P256-SHA256.verify(sig, authData || SHA-256(clientDataJSON))`

**CONFIRMED**: `crypto.subtle.sign` for ECDSA returns **P1363 format** (64 bytes for P-256), NOT DER. Real YubiKey assertions arrive in DER format. `verifySignature` must call `derToP1363(signature)` before passing to `subtle.verify`. In tests, manually DER-encode the P1363 output from `subtle.sign` to exercise the conversion path.

`derToP1363` (unexported helper, ~25 lines):
```typescript
function derToP1363(der: Uint8Array): Uint8Array {
  // DER layout: 30 <seqLen> 02 <rLen> [00?] <r> 02 <sLen> [00?] <s>
  if (der[0] !== 0x30) throw new Error('der_to_p1363: missing SEQUENCE tag');
  let offset = 2; // skip 0x30 + seqLen
  if (der[offset] !== 0x02) throw new Error('der_to_p1363: missing r INTEGER tag');
  offset++;
  let rLen = der[offset++]!;
  let r = der.slice(offset, offset + rLen);
  if (rLen === 33 && r[0] === 0x00) r = r.slice(1); // strip sign-extension byte
  offset += rLen;
  if (der[offset] !== 0x02) throw new Error('der_to_p1363: missing s INTEGER tag');
  offset++;
  let sLen = der[offset++]!;
  let s = der.slice(offset, offset + sLen);
  if (sLen === 33 && s[0] === 0x00) s = s.slice(1);
  // Left-pad r and s to 32 bytes
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}
```

Edge cases handled:
- r or s = 33 bytes with leading `0x00` (high bit set → DER adds sign byte) → strip it
- r or s < 32 bytes (leading zero bits omitted by DER) → left-pad with zeros

### Phase 6: High-Level Entry Points (TDD)

```typescript
export interface VerifiedRegistration {
  credentialId: Uint8Array;
  publicKey: ArrayBuffer;    // COSE key bytes — stored as-is, re-imported on assertion
  signCounter: number;
  aaguid: string;
}

export async function verifyRegistration(
  attestationObjectBytes: Uint8Array,
  clientDataJSON: Uint8Array,
  expectedChallenge: Uint8Array,
  expectedOrigin: string,
  expectedRpId: string,
): Promise<VerifiedRegistration>

export interface VerifiedAssertion {
  newSignCounter: number;
}

export async function verifyAssertion(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
  storedPublicKeyCose: Uint8Array,
  storedSignCounter: number,
  expectedChallenge: Uint8Array,
  expectedOrigin: string,
  expectedRpId: string,
): Promise<VerifiedAssertion>
```

`verifyRegistration` steps:
1. CBOR-decode `attestationObjectBytes` → `{ fmt, authData, attStmt }`
2. Parse `authData` via `parseAuthData`
3. Verify `clientDataJSON` (type=`webauthn.create`, challenge, origin)
4. Verify `rpIdHash` matches `SHA-256(expectedRpId)`
5. Check AT flag is set
6. Return `{ credentialId, publicKey: authData.publicKeyCose.buffer, signCounter, aaguid }`

`verifyAssertion` steps:
1. Verify `clientDataJSON` (type=`webauthn.get`, challenge, origin)
2. Verify `rpIdHash` in `authenticatorData` matches `SHA-256(expectedRpId)`
3. Import public key from stored COSE bytes
4. Verify signature
5. Check sign counter: if `storedSignCounter > 0 || newCounter > 0`, enforce `newCounter > storedSignCounter`
6. Return `{ newSignCounter }`

---

## STEP-BY-STEP TASKS

**IMPORTANT**: Write tests first (TDD). Each task follows: write failing test → run → implement → run → green.

---

### TASK 1: CREATE `src/shared/cbor.test.ts`

- **IMPLEMENT**: Test suite for CBOR decoder. Cover:
  - Decode map with text-string keys and byte-string values (simulates `attestationObject` top level)
  - Decode map with integer keys and byte-string values (simulates COSE_Key)
  - Decode nested map
  - Decode byte string of length 0, 1, 23, 24 (short vs 1-byte length prefix)
  - Decode text string
  - Decode array of byte strings
  - Decode positive integer
  - Throw on unsupported major type (e.g. float tag)
  - Throw on truncated input
- **PATTERN**: `src/shared/domain.test.ts` — describe/it/expect structure
- **IMPORTS**: `import { cborDecode } from '@/shared/cbor'`
- **GOTCHA**: CBOR length encoding: values 0–23 are encoded inline; 24 = 1-byte length follows; 25 = 2-byte; 26 = 4-byte
- **VALIDATE**: `pnpm test` (tests will fail — that's expected at this point)

---

### TASK 2: CREATE `src/shared/cbor.ts`

- **IMPLEMENT**: Minimal CBOR decoder. Export single function:
  ```typescript
  export function cborDecode(data: Uint8Array): CborValue
  export type CborValue = number | string | Uint8Array | CborMap | CborValue[]
  export type CborMap = Map<number | string, CborValue>
  ```
  Internal decoder reads from a `DataView` with an offset pointer. Parse major type from top 3 bits, additional info from bottom 5 bits.
- **PATTERN**: No existing CBOR in codebase — implement from scratch per [CBOR RFC 7049 §2](https://datatracker.ietf.org/doc/html/rfc7049#section-2)
- **IMPORTS**: None (pure TS, no dependencies)
- **GOTCHA**: 
  - `DataView` is the right tool for big-endian multi-byte reads
  - Map keys in COSE_Key are integers (not strings) — support both
  - Do NOT use recursion beyond 3 levels deep (no infinite recursion defense needed for MVP, just document the limitation)
- **VALIDATE**: `pnpm test -- cbor` → all cbor tests green

---

### TASK 3: CREATE `src/shared/crypto.test.ts` — base64url + challenge

- **IMPLEMENT**: Tests for:
  - `generateChallenge()` returns `Uint8Array` of length 32
  - `generateChallenge()` produces different values on each call (run 3 times)
  - `base64urlEncode` → `base64urlDecode` round-trip is identity
  - `base64urlDecode` handles padding-free input (standard base64url has no `=`)
  - `base64urlEncode` does not contain `+`, `/`, or `=`
- **PATTERN**: `src/shared/domain.test.ts`
- **IMPORTS**: `import { generateChallenge, base64urlEncode, base64urlDecode } from '@/shared/crypto'`
- **VALIDATE**: `pnpm test -- crypto` (failing — expected)

---

### TASK 4: CREATE `src/shared/crypto.ts` — base64url + challenge (stub file)

- **IMPLEMENT**: 
  ```typescript
  export function generateChallenge(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }
  export function base64urlEncode(data: Uint8Array): string { ... }
  export function base64urlDecode(str: string): Uint8Array { ... }
  ```
  `base64urlEncode`: convert to standard base64 (via `btoa(String.fromCharCode(...data))`), then replace `+`→`-`, `/`→`_`, strip `=`.
  `base64urlDecode`: re-add padding, replace `-`→`+`, `_`→`/`, then `atob()` → `Uint8Array`.
- **GOTCHA**: `btoa` requires a byte string (Latin-1). Use `String.fromCharCode(...data)` for small arrays. For larger arrays use a loop to avoid stack overflow on spread.
- **VALIDATE**: `pnpm test -- crypto` → base64url + challenge tests green

---

### TASK 5: ADD `parseAuthData` tests to `crypto.test.ts`

- **IMPLEMENT**: Construct synthetic `authData` byte arrays in tests:
  ```typescript
  function buildAuthData(opts: {
    rpIdHash?: Uint8Array;  // 32 bytes, defaults to zeros
    flags?: number;          // default 0x41 (UP + AT)
    signCounter?: number;    // default 0
    aaguid?: Uint8Array;    // 16 bytes
    credentialId?: Uint8Array;
    publicKeyCose?: Uint8Array;
  }): Uint8Array
  ```
  Test cases:
  - Correct extraction of `rpIdHash` (bytes 0..31)
  - Correct extraction of `signCounter` (big-endian uint32 at offset 33)
  - Correct extraction of `aaguid` formatted as UUID string `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
  - Correct extraction of `credentialId` (variable length)
  - Throws if `authData` is too short (< 37 bytes)
  - Throws if `authData` is too short for credential data (AT flag set but not enough bytes)
- **VALIDATE**: `pnpm test -- crypto` (failing — expected)

---

### TASK 6: ADD `parseAuthData` to `crypto.ts`

- **IMPLEMENT**: 
  ```typescript
  export function parseAuthData(authData: Uint8Array): ParsedAuthData
  ```
  Use `DataView` for multi-byte reads. AAGUID formatting: convert 16 bytes to hex groups `8-4-4-4-12`.
- **GOTCHA**: `signCounter` is big-endian uint32 at offset 33 — use `view.getUint32(33, false)` (big-endian = `false` for littleEndian param)
- **VALIDATE**: `pnpm test -- crypto` → parseAuthData tests green

---

### TASK 7: ADD `verifyClientData` tests to `crypto.test.ts`

- **IMPLEMENT**: Tests for:
  - Passes with correct type, challenge, origin
  - Throws `'clientDataJSON type mismatch'` on wrong type
  - Throws `'clientDataJSON challenge mismatch'` on wrong challenge
  - Throws `'clientDataJSON origin mismatch'` on wrong origin
  - Throws on invalid JSON
- **GOTCHA**: `clientDataJSON` is UTF-8 encoded JSON. In tests, construct via `new TextEncoder().encode(JSON.stringify({...}))`
- **VALIDATE**: `pnpm test -- crypto` (failing — expected)

---

### TASK 8: ADD `verifyClientData` to `crypto.ts`

- **IMPLEMENT**:
  ```typescript
  export function verifyClientData(
    clientDataJSON: Uint8Array,
    expectedType: 'webauthn.create' | 'webauthn.get',
    expectedChallenge: Uint8Array,
    expectedOrigin: string,
  ): void
  ```
  Decode with `new TextDecoder().decode(clientDataJSON)`, parse JSON, check fields.
- **VALIDATE**: `pnpm test -- crypto` → verifyClientData tests green

---

### TASK 9: ADD `importCosePublicKey` + `verifySignature` tests to `crypto.test.ts`

- **IMPLEMENT**: Tests using programmatically generated keys:
  ```typescript
  // In beforeAll or inline
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  ```
  - Export key as raw/COSE, import back via `importCosePublicKey`, verify a signature with `verifySignature`
  - `verifySignature` returns `false` for a tampered signature
  - `verifySignature` returns `false` for a tampered `authData`
  
  **For `importCosePublicKey` tests**: Export the generated `CryptoKey` as JWKK via `subtle.exportKey('jwk', keyPair.publicKey)`, then manually build the CBOR COSE_Key from the `x`/`y` values (base64url decode them, pack into CBOR map). This gives a realistic COSE key to test import.

- **GOTCHA**: `crypto.subtle` is async — tests must be `async`; use `await` throughout
- **VALIDATE**: `pnpm test -- crypto` (failing — expected)

---

### TASK 10: ADD `importCosePublicKey` + `verifySignature` to `crypto.ts`

- **IMPLEMENT**:
  ```typescript
  export async function importCosePublicKey(coseKey: Uint8Array): Promise<CryptoKey>
  ```
  Steps:
  1. `cborDecode(coseKey)` → `CborMap`
  2. Extract `x` (key -2) and `y` (key -3) as `Uint8Array`
  3. Build raw public key: `new Uint8Array([0x04, ...x, ...y])` (uncompressed point)
  4. `crypto.subtle.importKey('raw', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])`

  ```typescript
  export async function verifySignature(
    publicKey: CryptoKey,
    authData: Uint8Array,
    clientDataJSON: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean>
  ```
  Steps:
  1. `clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON)`
  2. `signedData = concat(authData, new Uint8Array(clientDataHash))`
  3. `return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, signedData)`

- **GOTCHA**: `subtle.sign` returns P1363 (confirmed: 64 bytes exactly in jsdom). Real YubiKey assertions are DER. Add `derToP1363` (unexported helper) per the exact implementation in Phase 5 above. For tests, convert the P1363 output of `subtle.sign` back to DER manually so the test exercises the real code path:
  ```typescript
  // In test: convert P1363 → DER to simulate a real authenticator signature
  function p1363ToDer(p1363: Uint8Array): Uint8Array {
    const r = p1363.slice(0, 32);
    const s = p1363.slice(32, 64);
    // Add 0x00 prefix if high bit set
    const rDer = r[0]! & 0x80 ? new Uint8Array([0x00, ...r]) : r;
    const sDer = s[0]! & 0x80 ? new Uint8Array([0x00, ...s]) : s;
    const seq = new Uint8Array(6 + rDer.length + sDer.length);
    let i = 0;
    seq[i++] = 0x30; seq[i++] = 4 + rDer.length + sDer.length;
    seq[i++] = 0x02; seq[i++] = rDer.length; seq.set(rDer, i); i += rDer.length;
    seq[i++] = 0x02; seq[i++] = sDer.length; seq.set(sDer, i);
    return seq;
  }
  ```
- **VALIDATE**: `pnpm test -- crypto` → importCosePublicKey + verifySignature tests green

---

### TASK 11: ADD `verifyRegistration` tests to `crypto.test.ts`

- **IMPLEMENT**: Integration test that exercises the full registration path:
  1. Generate a P-256 key pair
  2. Build a synthetic `authData` (with correct `rpIdHash = SHA-256('test-rp-id')`, AT flag, known AAGUID, credentialId, COSE public key)
  3. Build `clientDataJSON` with `type='webauthn.create'`, correct challenge and origin
  4. Build `attestationObject`: CBOR-encode `{ fmt: 'none', authData: <bytes>, attStmt: {} }`
  5. Call `verifyRegistration(...)` → assert returned `credentialId`, `aaguid`, `signCounter`
  6. Throws on wrong challenge
  7. Throws on wrong origin
  8. Throws on rpIdHash mismatch
- **VALIDATE**: `pnpm test -- crypto` (failing — expected)

---

### TASK 12: ADD `verifyRegistration` to `crypto.ts`

- **IMPLEMENT**: Per the plan in Phase 6 above. Use `cborDecode`, `parseAuthData`, `verifyClientData`, and SubtleCrypto `digest` for rpIdHash check.
- **GOTCHA**:
  - `attestationObject` fmt `'none'` is the most common in testing/dev — only check `authData` and `clientDataJSON`, ignore `attStmt`
  - rpIdHash check: `await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expectedRpId))` then compare byte-by-byte
  - `publicKey` field in `VerifiedRegistration` should be the raw COSE bytes as `ArrayBuffer` (for storage compatibility with `StoredCredential.publicKey`)
- **VALIDATE**: `pnpm test -- crypto` → verifyRegistration tests green

---

### TASK 13: ADD `verifyAssertion` tests to `crypto.test.ts`

- **IMPLEMENT**: Integration test:
  1. Generate P-256 key pair
  2. Build `authData` with correct rpIdHash, flags, signCounter=1
  3. Build `clientDataJSON`
  4. Sign `authData || SHA-256(clientDataJSON)` with private key → get signature in DER format (note: `subtle.sign` for ECDSA returns P1363 format, so for this test the conversion isn't needed — but test DER input for the real path)
  5. Call `verifyAssertion(...)` → assert `newSignCounter`
  6. Throws on sign counter not greater than stored (pass `storedSignCounter=5`, `signCounter=5`)
  7. Throws on bad signature
  8. Throws on rpIdHash mismatch
  9. Sign counter of 0 when stored is 0 is acceptable (device doesn't support counters)
- **VALIDATE**: `pnpm test -- crypto` (failing — expected)

---

### TASK 14: ADD `verifyAssertion` to `crypto.ts`

- **IMPLEMENT**: Per Phase 6 description above.
- **GOTCHA**: Sign counter rule (from WebAuthn spec and MVP PRD §16):
  ```typescript
  // Counter 0 means device doesn't track — only enforce if either side is non-zero
  if (newSignCounter !== 0 || storedSignCounter !== 0) {
    if (newSignCounter <= storedSignCounter) {
      throw new Error('sign_counter_violation: possible cloned authenticator');
    }
  }
  ```
- **VALIDATE**: `pnpm test -- crypto` → all crypto tests green

---

### TASK 15: VALIDATE full suite + type check + build

- **IMPLEMENT**: Run the full validation pyramid
- **VALIDATE**:
  ```bash
  pnpm lint
  pnpm format:check
  pnpm typecheck
  pnpm test
  pnpm build
  ```

---

## TESTING STRATEGY

### Unit Tests

Each exported function has its own `describe` block. Pure functions (CBOR, base64url, `parseAuthData`, `verifyClientData`) use synchronous tests with hand-crafted byte arrays. Async functions use `async/await`.

### Integration Tests

`verifyRegistration` and `verifyAssertion` tests exercise the full call chain end-to-end using programmatically generated keys — no hardcoded byte literals that could rot.

### Edge Cases

| Function | Edge Cases |
|---|---|
| `cborDecode` | Short-length (0–23), 1-byte length (24), 2-byte length (25), truncated input |
| `base64urlDecode` | No padding, all-zeros input, known vector |
| `parseAuthData` | Too short, AT flag absent, signCounter=0, max signCounter |
| `verifyClientData` | Wrong type string, wrong challenge length, extra JSON fields (should pass) |
| `verifySignature` | Tampered signature byte, tampered authData byte, correct → true |
| `verifyAssertion` | Counter=0 both sides (ok), counter=0 stored/non-zero new (ok), decrease (throw), equal (throw) |

---

## VALIDATION COMMANDS

Execute in pyramid order. Do not proceed if a level fails.

### Level 1: Syntax & Style
```bash
pnpm lint
pnpm format:check
```

### Level 2: Type Safety
```bash
pnpm typecheck
```

### Level 3: Unit Tests (cbor only)
```bash
pnpm test -- cbor
```

### Level 4: Unit Tests (crypto only)
```bash
pnpm test -- crypto
```

### Level 5: Full Test Suite
```bash
pnpm test
```

### Level 6: Build
```bash
pnpm build
```

---

## ACCEPTANCE CRITERIA

- [ ] `src/shared/cbor.ts` exports `cborDecode` with `CborValue` and `CborMap` types
- [ ] `src/shared/crypto.ts` exports: `generateChallenge`, `base64urlEncode`, `base64urlDecode`, `parseAuthData`, `verifyClientData`, `importCosePublicKey`, `verifySignature`, `verifyRegistration`, `verifyAssertion`
- [ ] All exported types: `ParsedAuthData`, `VerifiedRegistration`, `VerifiedAssertion`
- [ ] No file exceeds 300 lines
- [ ] All tests pass (`pnpm test`)
- [ ] Zero TypeScript errors (`pnpm typecheck`)
- [ ] Zero lint errors (`pnpm lint`)
- [ ] `pnpm build` succeeds
- [ ] DER→P1363 signature conversion is implemented (real YubiKey assertions are DER-encoded)
- [ ] Sign counter rule matches WebAuthn spec (0/0 = ok, decrease = throw, equal = throw)
- [ ] AAGUID formatted as UUID string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

---

## COMPLETION CHECKLIST

- [ ] All 15 tasks completed in order
- [ ] Each task's validation command passed before moving to next
- [ ] Full test suite green
- [ ] Type check clean
- [ ] Lint clean
- [ ] Build succeeds
- [ ] No file > 300 lines
- [ ] Acceptance criteria all met

---

## NOTES

### Why two files?

`cbor.ts` is a self-contained data format decoder with no crypto dependencies. Keeping it separate from `crypto.ts` respects the single-responsibility principle and keeps both files under the 300-line limit.

### Why store `publicKey` as raw COSE bytes?

`SubtleCrypto.CryptoKey` objects are not serializable. Storing the raw COSE `Uint8Array` allows round-tripping through `chrome.storage.local`. On each assertion, the key is re-imported via `importCosePublicKey`. This is slightly slower than storing JWK but keeps storage format consistent and avoids the `CryptoKey → JWK → CryptoKey` round-trip complexity.

### DER→P1363 is mandatory

Real authenticators (including YubiKey) return ECDSA signatures in ASN.1 DER format. `SubtleCrypto.verify` for ECDSA expects IEEE P1363 (raw `r||s`). Without the converter, assertion verification will always fail against real hardware. The conversion is well-understood and safe to implement (~15 lines).

### Transport filter is NOT in `shared/crypto.ts`

Transport filtering (`REJECTED_TRANSPORTS` check) is a policy decision made by the `credential/` and `unlock/` slice handlers, not a crypto primitive. `shared/crypto.ts` does not import from `core/config.ts`.

### Attestation format

For MVP, only `fmt: 'none'` (no attestation statement) is verified. `fmt: 'packed'` (used by YubiKey with `attestation: 'direct'`) verification is deferred — the AAGUID is still extracted and checked against the allowlist at the slice level, but the attestation signature itself is not cryptographically verified. Document this as a known limitation.

**Confidence Score: 9.5/10**

### Environment Probe Results (confirmed 2026-04-07)

| Check | Result |
|---|---|
| jsdom version | 29.0.1 ✅ |
| vitest version | 2.1.9 ✅ |
| `crypto.subtle.generateKey` P-256 | ✅ works in jsdom |
| `crypto.subtle.sign` + `verify` ECDSA P-256 | ✅ works in jsdom |
| `crypto.subtle.exportKey('raw', ...)` | ✅ returns 65-byte uncompressed point (0x04 prefix) |
| `crypto.subtle.exportKey('jwk', ...)` | ✅ returns x/y as base64url strings |
| `subtle.sign` output format | ✅ P1363 (64 bytes exactly) — NOT DER |
| `crypto.subtle.digest` SHA-256 | ✅ works in jsdom |

### Remaining Risk (0.5 points)

- `btoa` spread of large Uint8Arrays can hit JS argument count limits (~65k args). Use a loop in `base64urlEncode` for correctness:
  ```typescript
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  ```
