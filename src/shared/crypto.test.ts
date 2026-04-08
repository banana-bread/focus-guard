import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateChallenge,
  base64urlEncode,
  base64urlDecode,
  parseAuthData,
  verifyClientData,
  importCosePublicKey,
  verifySignature,
} from '@/shared/crypto';
import { verifyRegistration, verifyAssertion } from '@/shared/webauthn';

// ---------------------------------------------------------------------------
// Helpers used across multiple describe blocks
// ---------------------------------------------------------------------------

function buildAuthData(opts: {
  rpIdHash?: Uint8Array;
  flags?: number;
  signCounter?: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  publicKeyCose?: Uint8Array;
}): Uint8Array {
  const rpIdHash = opts.rpIdHash ?? new Uint8Array(32);
  const flags = opts.flags ?? 0x41; // UP | AT
  const signCounter = opts.signCounter ?? 0;
  const aaguid = opts.aaguid ?? new Uint8Array(16);
  const credentialId = opts.credentialId ?? new Uint8Array(16).fill(0x42);
  const publicKeyCose = opts.publicKeyCose ?? new Uint8Array([0xa0]); // empty CBOR map

  const credIdLen = credentialId.length;
  const buf = new Uint8Array(55 + credIdLen + publicKeyCose.length);
  const view = new DataView(buf.buffer);

  buf.set(rpIdHash, 0);
  buf[32] = flags;
  view.setUint32(33, signCounter, false); // big-endian
  buf.set(aaguid, 37);
  view.setUint16(53, credIdLen, false); // big-endian
  buf.set(credentialId, 55);
  buf.set(publicKeyCose, 55 + credIdLen);

  return buf;
}

/**
 * Encodes a COSE_Key map for an EC P-256 public key.
 * kty=2, alg=-7, crv=1, x=<32 bytes>, y=<32 bytes>
 */
function buildCoseKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  // map(5): {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  const xLen = x.length; // 32
  const yLen = y.length; // 32
  // Each bstr of 32 bytes: 0x58 0x20 <32 bytes>
  const buf = new Uint8Array(5 + 2 + 2 + 2 + 2 + (2 + xLen) + 2 + (2 + yLen));
  let i = 0;
  buf[i++] = 0xa5; // map(5)
  buf[i++] = 0x01;
  buf[i++] = 0x02; // kty: 2
  buf[i++] = 0x03;
  buf[i++] = 0x26; // alg: -7
  buf[i++] = 0x20;
  buf[i++] = 0x01; // crv: 1 (P-256)
  buf[i++] = 0x21;
  buf[i++] = 0x58;
  buf[i++] = xLen;
  buf.set(x, i);
  i += xLen; // x
  buf[i++] = 0x22;
  buf[i++] = 0x58;
  buf[i++] = yLen;
  buf.set(y, i); // y
  return buf;
}

/** Encodes attestationObject as CBOR: { fmt: "none", authData: <bytes>, attStmt: {} } */
function buildAttestationObject(authData: Uint8Array): Uint8Array {
  const fmtKey = new TextEncoder().encode('fmt');
  const noneVal = new TextEncoder().encode('none');
  const authDataKey = new TextEncoder().encode('authData');
  const attStmtKey = new TextEncoder().encode('attStmt');

  // authData as bstr — may be > 23 bytes, use 2-byte length
  const authDataLen = authData.length;
  let authDataEncoded: Uint8Array;
  if (authDataLen <= 23) {
    authDataEncoded = new Uint8Array([0x40 | authDataLen, ...authData]);
  } else if (authDataLen <= 255) {
    authDataEncoded = new Uint8Array([0x58, authDataLen, ...authData]);
  } else {
    authDataEncoded = new Uint8Array([
      0x59,
      (authDataLen >> 8) & 0xff,
      authDataLen & 0xff,
      ...authData,
    ]);
  }

  return new Uint8Array([
    0xa3, // map(3)
    0x63,
    ...fmtKey, // "fmt"
    0x64,
    ...noneVal, // "none"
    0x68,
    ...authDataKey, // "authData"
    ...authDataEncoded,
    0x67,
    ...attStmtKey, // "attStmt" (7 chars)
    0xa0, // {}
  ]);
}

/** Converts P1363 (r||s, 64 bytes) to DER encoding. */
function p1363ToDer(p1363: Uint8Array): Uint8Array {
  const r = p1363.slice(0, 32);
  const s = p1363.slice(32, 64);
  const rDer = r[0]! & 0x80 ? new Uint8Array([0x00, ...r]) : r;
  const sDer = s[0]! & 0x80 ? new Uint8Array([0x00, ...s]) : s;
  const seq = new Uint8Array(6 + rDer.length + sDer.length);
  let i = 0;
  seq[i++] = 0x30;
  seq[i++] = 4 + rDer.length + sDer.length;
  seq[i++] = 0x02;
  seq[i++] = rDer.length;
  seq.set(rDer, i);
  i += rDer.length;
  seq[i++] = 0x02;
  seq[i++] = sDer.length;
  seq.set(sDer, i);
  return seq;
}

// ---------------------------------------------------------------------------
// generateChallenge
// ---------------------------------------------------------------------------

describe('generateChallenge', () => {
  it('returns Uint8Array of length 32', () => {
    const ch = generateChallenge();
    expect(ch).toBeInstanceOf(Uint8Array);
    expect(ch.length).toBe(32);
  });

  it('produces different values on each call', () => {
    const a = generateChallenge();
    const b = generateChallenge();
    const c = generateChallenge();
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
  });
});

// ---------------------------------------------------------------------------
// base64urlEncode / base64urlDecode
// ---------------------------------------------------------------------------

describe('base64urlEncode', () => {
  it('does not contain +, /, or =', () => {
    const data = new Uint8Array(64).fill(0xff);
    const encoded = base64urlEncode(data);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('round-trips with base64urlDecode', () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const decoded = base64urlDecode(base64urlEncode(original));
    expect(decoded).toEqual(original);
  });

  it('handles all-zeros input', () => {
    const data = new Uint8Array(32);
    const encoded = base64urlEncode(data);
    expect(base64urlDecode(encoded)).toEqual(data);
  });

  it('handles padding-free input on decode', () => {
    // Manually base64url-encode a known value
    const data = new Uint8Array([0xfb, 0xff, 0xfe]); // encodes to "-_/+" in standard, "-__+" url
    const encoded = base64urlEncode(data);
    expect(encoded.includes('=')).toBe(false);
    expect(base64urlDecode(encoded)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// parseAuthData
// ---------------------------------------------------------------------------

describe('parseAuthData', () => {
  it('extracts rpIdHash (bytes 0..31)', () => {
    const rpIdHash = new Uint8Array(32).fill(0x42);
    const authData = buildAuthData({ rpIdHash });
    const parsed = parseAuthData(authData);
    expect(parsed.rpIdHash).toEqual(rpIdHash);
  });

  it('extracts flags byte', () => {
    const authData = buildAuthData({ flags: 0x41 });
    const parsed = parseAuthData(authData);
    expect(parsed.flags).toBe(0x41);
  });

  it('extracts signCounter (big-endian uint32)', () => {
    const authData = buildAuthData({ signCounter: 0x0001_0203 });
    const parsed = parseAuthData(authData);
    expect(parsed.signCounter).toBe(0x0001_0203);
  });

  it('extracts signCounter = 0', () => {
    const authData = buildAuthData({ signCounter: 0 });
    expect(parseAuthData(authData).signCounter).toBe(0);
  });

  it('extracts signCounter = max uint32', () => {
    const authData = buildAuthData({ signCounter: 0xffff_ffff });
    expect(parseAuthData(authData).signCounter).toBe(0xffff_ffff);
  });

  it('formats AAGUID as UUID string', () => {
    const aaguid = new Uint8Array([
      0x2f, 0xc0, 0x57, 0x9f, 0x81, 0x13, 0x47, 0xea, 0xb1, 0x16, 0xbb, 0x5a, 0x8d, 0xb9, 0x20,
      0x2a,
    ]);
    const authData = buildAuthData({ aaguid });
    const parsed = parseAuthData(authData);
    expect(parsed.aaguid).toBe('2fc0579f-8113-47ea-b116-bb5a8db9202a');
  });

  it('extracts credentialId of variable length', () => {
    const credentialId = new Uint8Array(64).fill(0xcc);
    const authData = buildAuthData({ credentialId });
    const parsed = parseAuthData(authData);
    expect(parsed.credentialId).toEqual(credentialId);
  });

  it('throws if authData is shorter than 37 bytes', () => {
    expect(() => parseAuthData(new Uint8Array(36))).toThrow();
  });

  it('throws if AT flag set but not enough bytes for AAGUID', () => {
    // flags = 0x41 (AT set) but buffer only 37 bytes (no room for AAGUID)
    const buf = new Uint8Array(37);
    buf[32] = 0x41; // set AT flag
    expect(() => parseAuthData(buf)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// verifyClientData
// ---------------------------------------------------------------------------

describe('verifyClientData', () => {
  const challenge = new Uint8Array(32).fill(0x01);
  const origin = 'chrome-extension://abcdef1234567890abcdef1234567890';

  function makeClientData(
    overrides?: Partial<{ type: string; challenge: string; origin: string }>,
  ): Uint8Array {
    const obj = {
      type: 'webauthn.create',
      challenge: base64urlEncode(challenge),
      origin,
      ...overrides,
    };
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  it('passes with correct type, challenge, and origin', () => {
    expect(() =>
      verifyClientData(makeClientData(), 'webauthn.create', challenge, origin),
    ).not.toThrow();
  });

  it('throws on wrong type', () => {
    expect(() =>
      verifyClientData(
        makeClientData({ type: 'webauthn.get' }),
        'webauthn.create',
        challenge,
        origin,
      ),
    ).toThrow('clientDataJSON type mismatch');
  });

  it('throws on wrong challenge', () => {
    const wrongChallenge = new Uint8Array(32).fill(0x02);
    expect(() =>
      verifyClientData(makeClientData(), 'webauthn.create', wrongChallenge, origin),
    ).toThrow('clientDataJSON challenge mismatch');
  });

  it('throws on wrong origin', () => {
    expect(() =>
      verifyClientData(makeClientData(), 'webauthn.create', challenge, 'https://evil.com'),
    ).toThrow('clientDataJSON origin mismatch');
  });

  it('throws on invalid JSON', () => {
    expect(() =>
      verifyClientData(new TextEncoder().encode('not json'), 'webauthn.create', challenge, origin),
    ).toThrow();
  });

  it('passes with extra JSON fields present', () => {
    const extra = {
      type: 'webauthn.create',
      challenge: base64urlEncode(challenge),
      origin,
      extra: 'field',
    };
    expect(() =>
      verifyClientData(
        new TextEncoder().encode(JSON.stringify(extra)),
        'webauthn.create',
        challenge,
        origin,
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// importCosePublicKey + verifySignature
// ---------------------------------------------------------------------------

describe('importCosePublicKey + verifySignature', () => {
  let keyPair: CryptoKeyPair;
  let coseKey: Uint8Array;

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const x = base64urlDecode(jwk.x!);
    const y = base64urlDecode(jwk.y!);
    coseKey = buildCoseKey(x, y);
  });

  it('imports a COSE public key without throwing', async () => {
    const key = await importCosePublicKey(coseKey);
    expect(key).toBeDefined();
    expect(key.type).toBe('public');
  });

  it('throws when COSE key bytes decode to a non-Map CBOR value', async () => {
    // 0x41 0xAB = CBOR byte string of length 1 — not a map
    await expect(importCosePublicKey(new Uint8Array([0x41, 0xab]))).rejects.toThrow(
      'COSE key is not a CBOR map',
    );
  });

  it('verifySignature returns true for a valid signature', async () => {
    const authData = new Uint8Array(32).fill(0x05);
    const clientDataJSON = new TextEncoder().encode('{"type":"test"}');

    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authData.length + 32);
    signedData.set(authData, 0);
    signedData.set(new Uint8Array(clientDataHash), authData.length);

    const p1363Sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData),
    );
    const derSig = p1363ToDer(p1363Sig);

    const pubKey = await importCosePublicKey(coseKey);
    const valid = await verifySignature(pubKey, authData, clientDataJSON, derSig);
    expect(valid).toBe(true);
  });

  it('verifySignature returns false for tampered signature', async () => {
    const authData = new Uint8Array(32).fill(0x05);
    const clientDataJSON = new TextEncoder().encode('{"type":"test"}');

    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authData.length + 32);
    signedData.set(authData, 0);
    signedData.set(new Uint8Array(clientDataHash), authData.length);

    const p1363Sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData),
    );
    const derSig = p1363ToDer(p1363Sig);
    derSig[4] ^= 0xff; // tamper

    const pubKey = await importCosePublicKey(coseKey);
    const valid = await verifySignature(pubKey, authData, clientDataJSON, derSig);
    expect(valid).toBe(false);
  });

  it('verifySignature returns false for tampered authData', async () => {
    const authData = new Uint8Array(32).fill(0x05);
    const clientDataJSON = new TextEncoder().encode('{"type":"test"}');

    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authData.length + 32);
    signedData.set(authData, 0);
    signedData.set(new Uint8Array(clientDataHash), authData.length);

    const p1363Sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData),
    );
    const derSig = p1363ToDer(p1363Sig);

    const tamperedAuthData = authData.slice();
    tamperedAuthData[0] ^= 0xff;

    const pubKey = await importCosePublicKey(coseKey);
    const valid = await verifySignature(pubKey, tamperedAuthData, clientDataJSON, derSig);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyRegistration
// ---------------------------------------------------------------------------

describe('verifyRegistration', () => {
  const RP_ID = 'test-rp-id';
  const ORIGIN = 'chrome-extension://testtest';
  let keyPair: CryptoKeyPair;
  let coseKey: Uint8Array;
  let rpIdHash: Uint8Array;
  let challenge: Uint8Array;

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const x = base64urlDecode(jwk.x!);
    const y = base64urlDecode(jwk.y!);
    coseKey = buildCoseKey(x, y);

    rpIdHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID)),
    );
    challenge = generateChallenge();
  });

  it('verifies a valid registration', async () => {
    const aaguid = new Uint8Array([
      0x2f, 0xc0, 0x57, 0x9f, 0x81, 0x13, 0x47, 0xea, 0xb1, 0x16, 0xbb, 0x5a, 0x8d, 0xb9, 0x20,
      0x2a,
    ]);
    const credentialId = new Uint8Array(16).fill(0x77);
    const authData = buildAuthData({
      rpIdHash,
      flags: 0x41,
      signCounter: 0,
      aaguid,
      credentialId,
      publicKeyCose: coseKey,
    });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      }),
    );
    const attestationObject = buildAttestationObject(authData);

    const result = await verifyRegistration(
      attestationObject,
      clientDataJSON,
      challenge,
      ORIGIN,
      RP_ID,
    );
    expect(result.credentialId).toEqual(credentialId);
    expect(result.aaguid).toBe('2fc0579f-8113-47ea-b116-bb5a8db9202a');
    expect(result.signCounter).toBe(0);
    expect(result.publicKey).toBeInstanceOf(ArrayBuffer);
  });

  it('throws when attestationObject decodes to a non-Map (e.g. a CBOR integer)', async () => {
    // 0x01 = CBOR integer 1 — not a map
    await expect(
      verifyRegistration(new Uint8Array([0x01]), new Uint8Array(), new Uint8Array(), ORIGIN, RP_ID),
    ).rejects.toThrow('attestationObject is not a CBOR map');
  });

  it('throws on wrong challenge', async () => {
    const authData = buildAuthData({ rpIdHash, publicKeyCose: coseKey });
    const wrongChallenge = new Uint8Array(32).fill(0x99);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: base64urlEncode(wrongChallenge),
        origin: ORIGIN,
      }),
    );
    const attestationObject = buildAttestationObject(authData);

    await expect(
      verifyRegistration(attestationObject, clientDataJSON, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('clientDataJSON challenge mismatch');
  });

  it('throws on wrong origin', async () => {
    const authData = buildAuthData({ rpIdHash, publicKeyCose: coseKey });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: base64urlEncode(challenge),
        origin: 'https://evil.com',
      }),
    );
    const attestationObject = buildAttestationObject(authData);

    await expect(
      verifyRegistration(attestationObject, clientDataJSON, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('clientDataJSON origin mismatch');
  });

  it('throws on rpIdHash mismatch', async () => {
    const wrongRpIdHash = new Uint8Array(32).fill(0xde);
    const authData = buildAuthData({ rpIdHash: wrongRpIdHash, publicKeyCose: coseKey });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      }),
    );
    const attestationObject = buildAttestationObject(authData);

    await expect(
      verifyRegistration(attestationObject, clientDataJSON, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('rpIdHash mismatch');
  });

  it('throws when UP flag is not set (flags=0x40, AT set but UP clear)', async () => {
    // flags=0x40 = AT set, UP clear — simulates a response without user presence
    const authData = buildAuthData({ rpIdHash, flags: 0x40, publicKeyCose: coseKey });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      }),
    );
    const attestationObject = buildAttestationObject(authData);

    await expect(
      verifyRegistration(attestationObject, clientDataJSON, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('UP flag not set');
  });
});

// ---------------------------------------------------------------------------
// verifyAssertion
// ---------------------------------------------------------------------------

describe('verifyAssertion', () => {
  const RP_ID = 'test-rp-id';
  const ORIGIN = 'chrome-extension://testtest';
  let keyPair: CryptoKeyPair;
  let coseKey: Uint8Array;
  let rpIdHash: Uint8Array;
  let challenge: Uint8Array;

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const x = base64urlDecode(jwk.x!);
    const y = base64urlDecode(jwk.y!);
    coseKey = buildCoseKey(x, y);

    rpIdHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID)),
    );
    challenge = generateChallenge();
  });

  async function makeAssertion(signCounter: number): Promise<{
    authData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
  }> {
    const authData = buildAuthData({ rpIdHash, flags: 0x01, signCounter });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      }),
    );
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authData.length + 32);
    signedData.set(authData, 0);
    signedData.set(new Uint8Array(clientDataHash), authData.length);

    const p1363Sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData),
    );
    return { authData, clientDataJSON, signature: p1363ToDer(p1363Sig) };
  }

  it('verifies a valid assertion and returns newSignCounter', async () => {
    const { authData, clientDataJSON, signature } = await makeAssertion(1);
    const result = await verifyAssertion(
      authData,
      clientDataJSON,
      signature,
      coseKey,
      0,
      challenge,
      ORIGIN,
      RP_ID,
    );
    expect(result.newSignCounter).toBe(1);
  });

  it('throws on sign counter not greater than stored (equal)', async () => {
    const { authData, clientDataJSON, signature } = await makeAssertion(5);
    await expect(
      verifyAssertion(authData, clientDataJSON, signature, coseKey, 5, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('sign_counter_violation');
  });

  it('throws on sign counter decrease', async () => {
    const { authData, clientDataJSON, signature } = await makeAssertion(3);
    await expect(
      verifyAssertion(authData, clientDataJSON, signature, coseKey, 5, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('sign_counter_violation');
  });

  it('accepts counter 0 on both sides (device without counter support)', async () => {
    const { authData, clientDataJSON, signature } = await makeAssertion(0);
    const result = await verifyAssertion(
      authData,
      clientDataJSON,
      signature,
      coseKey,
      0,
      challenge,
      ORIGIN,
      RP_ID,
    );
    expect(result.newSignCounter).toBe(0);
  });

  it('accepts counter 0 stored with non-zero new (first use after registration)', async () => {
    const { authData, clientDataJSON, signature } = await makeAssertion(1);
    const result = await verifyAssertion(
      authData,
      clientDataJSON,
      signature,
      coseKey,
      0,
      challenge,
      ORIGIN,
      RP_ID,
    );
    expect(result.newSignCounter).toBe(1);
  });

  it('throws on bad signature', async () => {
    const { authData, clientDataJSON, signature } = await makeAssertion(1);
    signature[4] ^= 0xff; // tamper
    await expect(
      verifyAssertion(authData, clientDataJSON, signature, coseKey, 0, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('assertion_signature_invalid');
  });

  it('throws on rpIdHash mismatch', async () => {
    const wrongRpIdHash = new Uint8Array(32).fill(0xde);
    const authData = buildAuthData({ rpIdHash: wrongRpIdHash, flags: 0x01, signCounter: 1 });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      }),
    );
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authData.length + 32);
    signedData.set(authData, 0);
    signedData.set(new Uint8Array(clientDataHash), authData.length);
    const p1363Sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData),
    );
    const signature = p1363ToDer(p1363Sig);

    await expect(
      verifyAssertion(authData, clientDataJSON, signature, coseKey, 0, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('rpIdHash mismatch');
  });

  it('throws when UP flag is not set (flags=0x00)', async () => {
    // Manually build an assertion with flags=0x00 (no UP, no AT)
    const authData = buildAuthData({ rpIdHash, flags: 0x00, signCounter: 1 });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      }),
    );
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authData.length + 32);
    signedData.set(authData, 0);
    signedData.set(new Uint8Array(clientDataHash), authData.length);
    const p1363Sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData),
    );
    const signature = p1363ToDer(p1363Sig);

    await expect(
      verifyAssertion(authData, clientDataJSON, signature, coseKey, 0, challenge, ORIGIN, RP_ID),
    ).rejects.toThrow('UP flag not set');
  });
});
