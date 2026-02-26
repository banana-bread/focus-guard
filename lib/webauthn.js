import { cborDecode } from './cbor.js';

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
