/**
 * High-level WebAuthn verification entry points for Focus Guard.
 *
 * Wraps the lower-level primitives from shared/crypto.ts to implement
 * the full registration and assertion verification flows.
 *
 * NOTE: For MVP, only fmt='none' attestation is verified. fmt='packed'
 * (used by YubiKey with attestation:'direct') — the AAGUID is extracted and
 * the assertion signature is verified, but the attestation certificate chain
 * is NOT cryptographically verified against FIDO MDS. This is a known
 * limitation to be addressed post-MVP.
 */

import { cborDecode } from '@/shared/cbor';
import type { CborMap } from '@/shared/cbor';
import {
  parseAuthData,
  verifyClientData,
  importCosePublicKey,
  verifySignature,
  bytesEqual,
} from '@/shared/crypto';

/** Result returned by a successful registration verification. */
export interface VerifiedRegistration {
  /** Raw credential ID bytes. */
  credentialId: Uint8Array;
  /** COSE key bytes as ArrayBuffer — stored as-is, re-imported on assertion. */
  publicKey: ArrayBuffer;
  /** Initial sign counter from registration authData. */
  signCounter: number;
  /** AAGUID formatted as UUID string. */
  aaguid: string;
}

/** Result returned by a successful assertion verification. */
export interface VerifiedAssertion {
  /** Updated sign counter to persist in storage. */
  newSignCounter: number;
}

/**
 * Verifies a WebAuthn registration (attestationObject + clientDataJSON).
 *
 * Steps:
 * 1. CBOR-decode attestationObject → { fmt, authData, attStmt }
 * 2. Parse authData
 * 3. Verify clientDataJSON (type, challenge, origin)
 * 4. Verify rpIdHash matches SHA-256(expectedRpId)
 * 5. Check AT flag is set
 * 6. Return credential data for storage
 *
 * @param attestationObjectBytes - CBOR-encoded attestationObject from the authenticator.
 * @param clientDataJSON - Raw clientDataJSON bytes.
 * @param expectedChallenge - The challenge that was sent to the authenticator.
 * @param expectedOrigin - Expected origin (e.g. 'chrome-extension://<id>').
 * @param expectedRpId - Expected RP ID (e.g. the extension's chrome.runtime.id).
 * @returns Verified credential data ready for storage.
 * @throws {Error} If any verification step fails.
 */
export async function verifyRegistration(
  attestationObjectBytes: Uint8Array,
  clientDataJSON: Uint8Array,
  expectedChallenge: Uint8Array,
  expectedOrigin: string,
  expectedRpId: string,
): Promise<VerifiedRegistration> {
  const attObjDecoded = cborDecode(attestationObjectBytes);
  if (!(attObjDecoded instanceof Map)) {
    throw new Error('verifyRegistration: attestationObject is not a CBOR map');
  }
  const attObj: CborMap = attObjDecoded;
  const authDataBytes = attObj.get('authData') as Uint8Array;
  if (!(authDataBytes instanceof Uint8Array)) {
    throw new Error('verifyRegistration: authData not found in attestationObject');
  }

  const parsed = parseAuthData(authDataBytes);

  verifyClientData(clientDataJSON, 'webauthn.create', expectedChallenge, expectedOrigin);

  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expectedRpId)),
  );

  if (!bytesEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new Error('verifyRegistration: rpIdHash mismatch');
  }

  if (!(parsed.flags & 0x01)) {
    throw new Error('verifyRegistration: UP flag not set — user presence required');
  }

  const atFlag = (parsed.flags >> 6) & 1;
  if (!atFlag) {
    throw new Error('verifyRegistration: AT flag not set — no attested credential data');
  }

  return {
    credentialId: parsed.credentialId,
    publicKey: parsed.publicKeyCose.buffer as ArrayBuffer,
    signCounter: parsed.signCounter,
    aaguid: parsed.aaguid,
  };
}

/**
 * Verifies a WebAuthn assertion (authenticatorData + clientDataJSON + signature).
 *
 * Steps:
 * 1. Verify clientDataJSON (type, challenge, origin)
 * 2. Verify rpIdHash in authenticatorData
 * 3. Import stored public key
 * 4. Verify signature
 * 5. Enforce sign counter monotonicity
 * 6. Return new sign counter
 *
 * @param authenticatorData - Raw authenticator data bytes from the assertion.
 * @param clientDataJSON - Raw clientDataJSON bytes.
 * @param signature - ECDSA signature in DER format.
 * @param storedPublicKeyCose - COSE key bytes as stored from registration.
 * @param storedSignCounter - Sign counter value stored from last successful assertion.
 * @param expectedChallenge - The challenge that was sent to the authenticator.
 * @param expectedOrigin - Expected origin.
 * @param expectedRpId - Expected RP ID.
 * @returns The new sign counter to persist.
 * @throws {Error} If any verification step fails.
 */
export async function verifyAssertion(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
  storedPublicKeyCose: Uint8Array,
  storedSignCounter: number,
  expectedChallenge: Uint8Array,
  expectedOrigin: string,
  expectedRpId: string,
): Promise<VerifiedAssertion> {
  verifyClientData(clientDataJSON, 'webauthn.get', expectedChallenge, expectedOrigin);

  const parsed = parseAuthData(authenticatorData);

  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expectedRpId)),
  );
  if (!bytesEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new Error('verifyAssertion: rpIdHash mismatch');
  }

  if (!(parsed.flags & 0x01)) {
    throw new Error('verifyAssertion: UP flag not set — user presence required');
  }

  const publicKey = await importCosePublicKey(storedPublicKeyCose);
  const valid = await verifySignature(publicKey, authenticatorData, clientDataJSON, signature);
  if (!valid) {
    throw new Error('assertion_signature_invalid');
  }

  const newSignCounter = parsed.signCounter;
  // Counter 0 means device doesn't track — only enforce if either side is non-zero
  if (newSignCounter !== 0 || storedSignCounter !== 0) {
    if (newSignCounter <= storedSignCounter) {
      throw new Error('sign_counter_violation: possible cloned authenticator');
    }
  }

  return { newSignCounter };
}
