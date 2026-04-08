/**
 * WebAuthn cryptographic primitives for Focus Guard.
 *
 * Challenge generation, base64url helpers, authData parsing,
 * clientDataJSON verification, COSE key import, and signature verification.
 * High-level entry points (verifyRegistration, verifyAssertion) are in shared/webauthn.ts.
 */

import { cborDecode } from '@/shared/cbor';
import type { CborMap } from '@/shared/cbor';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed fields from a WebAuthn authenticator data structure. */
export interface ParsedAuthData {
  /** SHA-256 of the RP ID (32 bytes). */
  rpIdHash: Uint8Array;
  /** Raw flags byte. Bit 0 = UP (user presence), bit 6 = AT (attested credential data). */
  flags: number;
  /** Signature counter (uint32, big-endian). 0 = device does not support counters. */
  signCounter: number;
  /** AAGUID formatted as "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx". */
  aaguid: string;
  /** Raw credential ID bytes. */
  credentialId: Uint8Array;
  /** Raw COSE_Key bytes (CBOR-encoded EC2 public key). */
  publicKeyCose: Uint8Array;
}

// ---------------------------------------------------------------------------
// Challenge generation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random 32-byte challenge.
 *
 * @returns A 32-byte Uint8Array suitable for use as a WebAuthn challenge.
 */
export function generateChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

// ---------------------------------------------------------------------------
// Base64url encoding/decoding
// ---------------------------------------------------------------------------

/**
 * Encodes a Uint8Array as a base64url string (no padding).
 *
 * @param data - The bytes to encode.
 * @returns A base64url-encoded string without `=` padding.
 */
export function base64urlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Decodes a base64url string (with or without padding) to a Uint8Array.
 *
 * @param str - The base64url-encoded string.
 * @returns The decoded bytes.
 */
export function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + '='.repeat(padLen);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// authData parser
// ---------------------------------------------------------------------------

/**
 * Parses a WebAuthn authenticator data buffer into its component fields.
 *
 * Layout (per §6.1 of the WebAuthn spec):
 * [0..31]   rpIdHash (32 bytes)
 * [32]      flags
 * [33..36]  signCount (uint32 big-endian)
 * [37..52]  AAGUID (16 bytes) — only if AT flag (bit 6) set
 * [53..54]  credIdLen (uint16 big-endian)
 * [55..55+credIdLen-1] credentialId
 * [55+credIdLen..] credentialPublicKey (CBOR COSE_Key)
 *
 * @param authData - Raw authenticator data bytes.
 * @returns Parsed fields.
 * @throws {Error} If authData is too short or malformed.
 */
export function parseAuthData(authData: Uint8Array): ParsedAuthData {
  if (authData.length < 37) {
    throw new Error('parseAuthData: authData too short (< 37 bytes)');
  }

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32]!;
  const signCounter = view.getUint32(33, false); // big-endian

  const atFlag = (flags >> 6) & 1;
  if (!atFlag) {
    // AT not set — no credential data; return minimal struct
    return {
      rpIdHash,
      flags,
      signCounter,
      aaguid: '00000000-0000-0000-0000-000000000000',
      credentialId: new Uint8Array(0),
      publicKeyCose: new Uint8Array(0),
    };
  }

  if (authData.length < 55) {
    throw new Error('parseAuthData: authData too short for attested credential data (< 55 bytes)');
  }

  const aaguidBytes = authData.slice(37, 53);
  const aaguid = formatAaguid(aaguidBytes);

  const credIdLen = view.getUint16(53, false); // big-endian
  const credIdEnd = 55 + credIdLen;
  if (authData.length < credIdEnd) {
    throw new Error('parseAuthData: authData truncated before credentialId end');
  }

  const credentialId = authData.slice(55, credIdEnd);
  const publicKeyCose = authData.slice(credIdEnd);

  return { rpIdHash, flags, signCounter, aaguid, credentialId, publicKeyCose };
}

function formatAaguid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// clientDataJSON verifier
// ---------------------------------------------------------------------------

/**
 * Verifies the clientDataJSON fields against expected values.
 *
 * @param clientDataJSON - UTF-8 encoded JSON bytes from the authenticator response.
 * @param expectedType - Expected type string ('webauthn.create' or 'webauthn.get').
 * @param expectedChallenge - The challenge bytes that were sent to the authenticator.
 * @param expectedOrigin - The expected origin string (e.g. 'chrome-extension://<id>').
 * @throws {Error} If any field does not match.
 */
export function verifyClientData(
  clientDataJSON: Uint8Array,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: Uint8Array,
  expectedOrigin: string,
): void {
  const json = new TextDecoder().decode(clientDataJSON);
  const parsed = JSON.parse(json) as Record<string, unknown>;

  if (parsed['type'] !== expectedType) {
    throw new Error(
      `clientDataJSON type mismatch: expected ${expectedType}, got ${String(parsed['type'])}`,
    );
  }

  const challengeDecoded = base64urlDecode(String(parsed['challenge']));
  if (!bytesEqual(challengeDecoded, expectedChallenge)) {
    throw new Error('clientDataJSON challenge mismatch');
  }

  if (parsed['origin'] !== expectedOrigin) {
    throw new Error(
      `clientDataJSON origin mismatch: expected ${expectedOrigin}, got ${String(parsed['origin'])}`,
    );
  }
}

/**
 * Compares two Uint8Arrays for byte equality.
 *
 * @param a - First byte array.
 * @param b - Second byte array.
 * @returns true if both arrays have identical length and bytes.
 *
 * @remarks This is NOT constant-time (short-circuits on first mismatch).
 * Do not use for secret comparison (e.g., HMAC tags). Only safe for
 * public values such as rpIdHash and challenge bytes.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// COSE public key import
// ---------------------------------------------------------------------------

/**
 * Imports a COSE_Key (EC2/P-256) as a CryptoKey for use with SubtleCrypto.
 *
 * Extracts x (key -2) and y (key -3) coordinates from the CBOR map, then
 * imports the uncompressed point via SubtleCrypto.importKey.
 *
 * @param coseKey - CBOR-encoded COSE_Key bytes.
 * @returns A CryptoKey for ECDSA P-256 verification.
 * @throws {Error} If the COSE key is malformed or missing required fields.
 */
export async function importCosePublicKey(coseKey: Uint8Array): Promise<CryptoKey> {
  const decoded = cborDecode(coseKey);
  if (!(decoded instanceof Map)) {
    throw new Error('importCosePublicKey: COSE key is not a CBOR map');
  }
  const map: CborMap = decoded;
  const x = map.get(-2) as Uint8Array;
  const y = map.get(-3) as Uint8Array;

  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error('importCosePublicKey: missing x or y coordinate in COSE key');
  }

  const rawKey = new Uint8Array(1 + x.length + y.length);
  rawKey[0] = 0x04; // uncompressed point prefix
  rawKey.set(x, 1);
  rawKey.set(y, 1 + x.length);

  return crypto.subtle.importKey('raw', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ]);
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies a WebAuthn ECDSA P-256 assertion signature.
 *
 * The signed data is: authData || SHA-256(clientDataJSON).
 * Signature must be in ASN.1 DER format (as returned by real authenticators).
 * DER is converted to IEEE P1363 format before passing to SubtleCrypto.
 *
 * @param publicKey - Imported CryptoKey for verification.
 * @param authData - Raw authenticator data bytes.
 * @param clientDataJSON - Raw clientDataJSON bytes.
 * @param signature - ECDSA signature in DER format.
 * @returns true if signature is valid, false otherwise.
 */
export async function verifySignature(
  publicKey: CryptoKey,
  authData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const clientDataHash = await crypto.subtle.digest(
    'SHA-256',
    clientDataJSON as Uint8Array<ArrayBuffer>,
  );
  const signedData = new Uint8Array(authData.length + 32);
  signedData.set(authData, 0);
  signedData.set(new Uint8Array(clientDataHash), authData.length);

  let p1363: Uint8Array<ArrayBuffer>;
  try {
    p1363 = derToP1363(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, p1363, signedData);
}

/**
 * Converts an ECDSA signature from ASN.1 DER format to IEEE P1363 (r||s, 64 bytes).
 *
 * Real authenticators (YubiKey) return DER. SubtleCrypto.verify expects P1363.
 */
function derToP1363(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error('der_to_p1363: missing SEQUENCE tag');
  let offset = 2; // skip 0x30 + seqLen
  if (der[offset] !== 0x02) throw new Error('der_to_p1363: missing r INTEGER tag');
  offset++;
  const rLen = der[offset++]!;
  let r = der.slice(offset, offset + rLen);
  if (r[0] === 0x00) r = r.slice(1); // strip sign-extension byte
  if (r.length > 32) throw new Error('der_to_p1363: r component too long');
  offset += rLen;
  if (der[offset] !== 0x02) throw new Error('der_to_p1363: missing s INTEGER tag');
  offset++;
  const sLen = der[offset++]!;
  let s = der.slice(offset, offset + sLen);
  if (s[0] === 0x00) s = s.slice(1);
  if (s.length > 32) throw new Error('der_to_p1363: s component too long');
  // Left-pad r and s to 32 bytes
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}
