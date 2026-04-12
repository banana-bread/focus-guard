/**
 * Business logic for credential registration and status queries.
 *
 * Module-level `pendingChallenge` stores the most recently issued challenge.
 * It is single-use and cleared (in a finally block) immediately after use.
 */

import { generateChallenge } from '@/shared/crypto';
import { verifyRegistration } from '@/shared/webauthn';
import type { VerifiedRegistration } from '@/shared/webauthn';
import { AAGUID_ALLOWLIST, AAGUID_NAMES, CHALLENGE_TTL_MS } from '@/core/config';
import { getCredential, setCredential } from '@/credential/credential.storage';

interface PendingChallenge {
  bytes: Uint8Array;
  issuedAt: number;
}

let pendingChallenge: PendingChallenge | null = null;

/**
 * Generates and stores a new registration challenge.
 *
 * @returns A 32-byte random challenge.
 */
export function createRegistrationChallenge(): Uint8Array {
  const bytes = generateChallenge();
  pendingChallenge = { bytes, issuedAt: Date.now() };
  return bytes;
}

/**
 * Verifies and stores a new credential from a WebAuthn registration ceremony.
 *
 * @param attestation - Raw attestationObject bytes.
 * @param clientDataJSON - Raw clientDataJSON bytes.
 * @param expectedOrigin - Expected origin (e.g. `chrome-extension://<id>`).
 * @param expectedRpId - Expected RP ID (e.g. the extension's chrome.runtime.id).
 * @returns Verified registration data.
 * @throws {Error} If no pending challenge exists, AAGUID is not allowed, or verification fails.
 */
export async function registerCredential(
  attestation: Uint8Array,
  clientDataJSON: Uint8Array,
  expectedOrigin: string,
  expectedRpId: string,
): Promise<VerifiedRegistration> {
  const challenge = pendingChallenge;
  try {
    if (!challenge) {
      throw new Error('No pending challenge — call createRegistrationChallenge first');
    }

    if (Date.now() - challenge.issuedAt > CHALLENGE_TTL_MS) {
      throw new Error('Registration challenge expired');
    }

    const verified = await verifyRegistration(
      attestation,
      clientDataJSON,
      challenge.bytes,
      expectedOrigin,
      expectedRpId,
    );

    if (!AAGUID_ALLOWLIST.includes(verified.aaguid)) {
      throw new Error(`AAGUID not in allowlist: ${verified.aaguid}`);
    }

    await setCredential({
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      signCounter: verified.signCounter,
      aaguid: verified.aaguid,
    });

    return verified;
  } finally {
    pendingChallenge = null;
  }
}

/**
 * Returns credential registration status and device name.
 *
 * @returns Object with `registered` flag and optional `deviceName`.
 */
export async function getCredentialStatus(): Promise<{
  registered: boolean;
  deviceName?: string;
}> {
  const cred = await getCredential();
  if (!cred) {
    return { registered: false };
  }
  const deviceName = AAGUID_NAMES[cred.aaguid] ?? 'Security key';
  return { registered: true, deviceName };
}
