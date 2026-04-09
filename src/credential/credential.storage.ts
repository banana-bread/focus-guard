/**
 * Storage accessors for the registered WebAuthn credential.
 *
 * Binary fields (credentialId, publicKey) are serialised as `number[]` in the wire
 * format so they survive chrome.storage.local's JSON round-trip without data loss.
 */

import { storageGet, storageSet, storageRemove, STORAGE_KEYS } from '@/core/storage';
import type { StoredCredential } from '@/core/storage';

/**
 * Wire format for a credential in chrome.storage.local.
 *
 * Binary fields are stored as `number[]` so they survive JSON serialization faithfully.
 * (`Uint8Array` serialises as `{0:1,…}` and `ArrayBuffer` as `{}` — both are lossy.)
 */
interface StoredCredentialRaw {
  credentialId: number[];
  publicKey: number[];
  signCounter: number;
  aaguid: string;
}

/**
 * Deserialises the raw storage record into a `StoredCredential`.
 */
function deserializeCredential(raw: StoredCredentialRaw): StoredCredential {
  return {
    credentialId: new Uint8Array(raw.credentialId),
    publicKey: new Uint8Array(raw.publicKey).buffer,
    signCounter: raw.signCounter,
    aaguid: raw.aaguid,
  };
}

/**
 * Serialises a `StoredCredential` to the wire format for chrome.storage.local.
 */
function serializeCredential(credential: StoredCredential): StoredCredentialRaw {
  return {
    credentialId: Array.from(credential.credentialId),
    publicKey: Array.from(new Uint8Array(credential.publicKey)),
    signCounter: credential.signCounter,
    aaguid: credential.aaguid,
  };
}

/**
 * Retrieves the stored credential, or `undefined` if none registered.
 *
 * @returns The stored credential or `undefined`.
 */
export async function getCredential(): Promise<StoredCredential | undefined> {
  const raw = await storageGet<StoredCredentialRaw>(STORAGE_KEYS.CREDENTIAL);
  if (!raw) return undefined;
  return deserializeCredential(raw);
}

/**
 * Persists a credential to storage.
 *
 * @param credential - The credential to store.
 */
export async function setCredential(credential: StoredCredential): Promise<void> {
  return storageSet<StoredCredentialRaw>(STORAGE_KEYS.CREDENTIAL, serializeCredential(credential));
}

/**
 * Removes the stored credential from storage.
 */
export async function removeCredential(): Promise<void> {
  return storageRemove(STORAGE_KEYS.CREDENTIAL);
}
