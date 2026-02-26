import { cborDecode } from './cbor.js';
import { getCredential, setCredential } from './storage.js';

/**
 * Converts an ArrayBuffer or Uint8Array to a base64url-encoded string.
 */
export function base64urlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Converts a base64url-encoded string to a Uint8Array.
 */
export function base64urlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Extracts the AAGUID (bytes 37–52 of authData) from an attestation object.
 * @param {ArrayBuffer} attestationObject - Raw attestation object from registration response
 * @returns {string} AAGUID as a hex string formatted as UUID
 */
export function extractAAGUID(attestationObject) {
  const decoded = cborDecode(attestationObject);
  const authData = decoded.authData;
  const aaguidBytes = authData.slice(37, 53);
  return formatUUID(aaguidBytes);
}

function formatUUID(bytes) {
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Imports a public key from SPKI DER bytes.
 * Tries ES256 (P-256) first, falls back to RS256.
 */
export async function importPublicKey(spkiBytes) {
  const spkiBuffer = spkiBytes instanceof ArrayBuffer ? spkiBytes : spkiBytes.buffer.slice(spkiBytes.byteOffset, spkiBytes.byteOffset + spkiBytes.byteLength);
  try {
    return await crypto.subtle.importKey(
      'spki', spkiBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify']
    );
  } catch {
    return await crypto.subtle.importKey(
      'spki', spkiBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
  }
}

/**
 * Registers a hardware security key credential with four enforcement layers.
 * Returns the stored credential data on success.
 */
export async function registerCredential() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKeyOptions = {
    challenge,
    rp: { name: 'Focus Guard' },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: 'focus-guard-user',
      displayName: 'Focus Guard User',
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256
      { alg: -257, type: 'public-key' },  // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'cross-platform',  // Layer 1: block platform authenticators
      userVerification: 'discouraged',
    },
    hints: ['security-key'],  // Layer 2: Chrome 129+ UI hint
    attestation: 'direct',    // Layer 4: get attestation for AAGUID
    timeout: 60000,
  };

  const credential = await navigator.credentials.create({ publicKey: publicKeyOptions });
  const response = credential.response;

  // Layer 3: transport check
  const transports = typeof response.getTransports === 'function' ? response.getTransports() : [];
  if (transports.length > 0) {
    const rejected = transports.filter(t => t === 'hybrid' || t === 'internal');
    if (rejected.length > 0) {
      throw new Error(`Non-hardware key detected (transports: ${transports.join(', ')}). Only USB, NFC, or BLE security keys are supported.`);
    }
  }

  // Extract AAGUID from attestation object
  const aaguid = extractAAGUID(response.attestationObject);

  // Extract and export public key as SPKI DER
  const publicKey = response.getPublicKey();
  // Verify key is importable
  await importPublicKey(new Uint8Array(publicKey));

  // Extract sign count from authData (bytes 33–36, big-endian uint32)
  const authData = new Uint8Array(response.getAuthenticatorData());
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);

  const credentialData = {
    credentialId: base64urlEncode(credential.rawId),
    publicKeySpki: base64urlEncode(publicKey),
    transports,
    signCount,
    aaguid,
    createdAt: new Date().toISOString(),
  };

  await setCredential(credentialData);
  return credentialData;
}

/**
 * Verifies a WebAuthn assertion signature client-side using the stored credential.
 * Generates a fresh challenge, requests a signature from the hardware key,
 * and verifies it against the stored SPKI public key.
 * Enforces sign counter monotonicity to detect cloned authenticators.
 * @returns {Promise<{verified: true}>}
 */
export async function verifyWithCredential() {
  const credentialData = await getCredential();
  if (!credentialData) {
    throw new Error('No credential registered');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = base64urlDecode(credentialData.credentialId);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{
        id: credentialId,
        type: 'public-key',
        transports: credentialData.transports,
      }],
      userVerification: 'discouraged',
      timeout: 60000,
    },
  });

  const response = assertion.response;
  const authenticatorData = new Uint8Array(response.authenticatorData);
  const clientDataJSON = new Uint8Array(response.clientDataJSON);
  const signature = new Uint8Array(response.signature);

  // Reconstruct signed data: authenticatorData + SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData);
  signedData.set(clientDataHash, authenticatorData.length);

  // Import stored public key and verify signature
  const spkiBytes = base64urlDecode(credentialData.publicKeySpki);
  const publicKey = await importPublicKey(spkiBytes);

  // Determine algorithm based on key algorithm
  const algorithm = publicKey.algorithm.name === 'ECDSA'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' };

  const valid = await crypto.subtle.verify(algorithm, publicKey, signature, signedData);
  if (!valid) {
    throw new Error('Signature verification failed');
  }

  // Enforce sign counter monotonicity
  const newSignCount = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4
  ).getUint32(0);

  if (newSignCount !== 0 && newSignCount <= credentialData.signCount) {
    throw new Error('Sign counter did not increase — possible cloned authenticator');
  }

  // Update stored sign count
  await setCredential({ ...credentialData, signCount: newSignCount });

  return { verified: true };
}
