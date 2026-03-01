import { cborDecode } from './cbor.js';
import { setCredential } from './storage.js';

/**
 * Curated allowlist of AAGUIDs for known hardware security keys.
 * Add new entries as new hardware is released/certified.
 * Source: FIDO Alliance Metadata Service (https://mds.fidoalliance.org/)
 */
export const AAGUID_ALLOWLIST = [
  // YubiKey 5 series (USB-A)
  '2fc0579f-8113-47ea-b116-bb5a8db9202a', // YubiKey 5 NFC
  '73bb0cd4-e502-49b8-9c6f-b59445bf720b', // YubiKey 5C NFC
  'cb69481e-8ff7-4039-93ec-0a2729a154a8', // YubiKey 5Ci
  'c5ef55ff-ad9a-4b9f-b580-adebafe026d0', // YubiKey 5C
  'fa2b99dc-9e39-4257-8f92-4a30d23c4118', // YubiKey 5 NFC (FIDO2)
  '149a2021-8ef6-4133-96b8-81f8d5b7f1f4', // YubiKey 5 Nano
  'a4e9fc6d-4cbe-4758-b8ba-37598bb5bbaa', // YubiKey 5C USB-A NFC
  'd8522d9f-575b-4866-88a9-ba99fa02f35b', // YubiKey Bio (FIDO Edition)
  '6d44ba9b-f6ec-2e49-b930-0c8fe920cb73', // Security Key NFC by Yubico
  'f8a011f3-8c0a-4d15-8006-17111f9edc7d', // Security Key by Yubico (USB-A)
  // Google Titan
  '42b4fb4a-2866-43b2-9bf7-6c6669c2e5d3', // Google Titan Security Key v2
  'b93fd961-f2e6-462f-b122-82002247de78', // Google Titan Security Key (USB-C/NFC)
  // SoloKeys
  '8876631b-d4a0-427f-5773-0ec71c9e0279', // Solo (SoloKeys v1)
  'e1a96183-5016-4f24-b55b-e3ae23614cc6', // Solo 2
  // Feitian
  '12ded745-4bed-47d4-abaa-e713f51d6393', // Feitian ePass FIDO2
  'b6ede29c-3772-412c-8a78-539c1f4c62d2', // Feitian BioPass FIDO2
  // Token2
  'ab32f0c6-2239-afbb-c470-d2ef4e254db7', // Token2 FIDO2
];

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
 * Converts a DER-encoded ECDSA signature to IEEE P1363 (raw r||s) format
 * expected by crypto.subtle.verify for ECDSA.
 * WebAuthn returns DER; WebCrypto expects raw.
 * @param {Uint8Array} der
 * @param {number} coordinateSize - bytes per coordinate (32 for P-256)
 * @returns {Uint8Array}
 */
function derToIEEEP1363(der, coordinateSize = 32) {
  // DER structure: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
  let offset = 2; // skip SEQUENCE tag + length byte(s)
  // Handle multi-byte length (rare for P-256, but safe)
  if (der[1] & 0x80) offset += (der[1] & 0x7f);

  // Parse r
  offset++; // skip INTEGER tag (0x02)
  const rLen = der[offset++];
  const rBytes = der.slice(offset, offset + rLen);
  offset += rLen;

  // Parse s
  offset++; // skip INTEGER tag (0x02)
  const sLen = der[offset++];
  const sBytes = der.slice(offset, offset + sLen);

  // DER integers may have a leading 0x00 byte (positive sign) or be shorter
  const raw = new Uint8Array(coordinateSize * 2);
  const rStart = rBytes.length > coordinateSize ? rBytes.length - coordinateSize : 0;
  const sStart = sBytes.length > coordinateSize ? sBytes.length - coordinateSize : 0;
  raw.set(rBytes.slice(rStart), coordinateSize - Math.min(rBytes.length, coordinateSize));
  raw.set(sBytes.slice(sStart), coordinateSize * 2 - Math.min(sBytes.length, coordinateSize));
  return raw;
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

  // Extract AAGUID from attestation object and validate against allowlist (Layer 4)
  const aaguid = extractAAGUID(response.attestationObject);
  if (!AAGUID_ALLOWLIST.includes(aaguid)) {
    throw new Error(
      `This authenticator is not on the approved hardware list (AAGUID: ${aaguid}). ` +
      'Only known hardware security keys (e.g. YubiKey, Google Titan, SoloKeys) are accepted.'
    );
  }

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
 * Verifies a WebAuthn assertion against a known challenge and stored credential data.
 * This is a pure crypto function that works in any context (service worker or page).
 * Does NOT call navigator.credentials and does NOT update storage.
 *
 * @param {{ authenticatorData: Uint8Array, clientDataJSON: Uint8Array, signature: Uint8Array }} assertionParts
 * @param {Uint8Array} challenge - The original challenge bytes that were issued
 * @param {object} credentialData - The stored credential object (publicKeySpki, signCount, …)
 * @returns {Promise<{ newSignCount: number }>}
 */
export async function verifyAssertionData({ authenticatorData, clientDataJSON, signature }, challenge, credentialData) {
  // Verify challenge embedded in clientDataJSON matches the issued challenge
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
  const receivedChallenge = base64urlDecode(clientData.challenge);
  if (
    receivedChallenge.length !== challenge.length ||
    !receivedChallenge.every((b, i) => b === challenge[i])
  ) {
    throw new Error('Challenge mismatch — assertion does not match the issued challenge');
  }

  // Verify this is an authentication response, not a registration response
  if (clientData.type !== 'webauthn.get') {
    throw new Error('clientData.type must be "webauthn.get"');
  }

  // Verify the assertion was made against this extension's origin
  const expectedOrigin = chrome.runtime.getURL('').slice(0, -1);
  if (clientData.origin !== expectedOrigin) {
    throw new Error(`Origin mismatch: expected ${expectedOrigin}, got ${clientData.origin}`);
  }

  // Verify rpIdHash (first 32 bytes of authenticatorData) matches SHA-256 of the rpId
  const rpId = new URL(expectedOrigin).hostname;
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))
  );
  const actualRpIdHash = authenticatorData.slice(0, 32);
  if (!expectedRpIdHash.every((b, i) => b === actualRpIdHash[i])) {
    throw new Error('rpIdHash mismatch');
  }

  // Reconstruct signed data: authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData);
  signedData.set(clientDataHash, authenticatorData.length);

  // Import stored public key and verify signature
  const spkiBytes = base64urlDecode(credentialData.publicKeySpki);
  const publicKey = await importPublicKey(spkiBytes);

  const algorithm = publicKey.algorithm.name === 'ECDSA'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' };

  const sigToVerify = publicKey.algorithm.name === 'ECDSA'
    ? derToIEEEP1363(signature)
    : signature;

  const valid = await crypto.subtle.verify(algorithm, publicKey, sigToVerify, signedData);
  if (!valid) {
    throw new Error('Signature verification failed');
  }

  // Enforce sign counter monotonicity
  const newSignCount = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4
  ).getUint32(0);

  if (credentialData.signCount !== 0 && newSignCount === 0) {
    throw new Error(
      'Sign counter reset anomaly detected — the authenticator may have been cloned or reset. ' +
      'Please re-register your security key.'
    );
  }

  if (newSignCount !== 0 && newSignCount <= credentialData.signCount) {
    throw new Error('Sign counter did not increase — possible cloned authenticator');
  }

  return { newSignCount };
}

