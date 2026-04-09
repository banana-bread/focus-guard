/**
 * Storage accessors for the registered WebAuthn credential.
 *
 * Handles deserialisation of `Uint8Array` / `ArrayBuffer` fields that
 * `chrome.storage.local` serialises as plain objects on read-back.
 */

import { storageGet, storageSet, storageRemove, STORAGE_KEYS } from '@/core/storage';
import type { StoredCredential } from '@/core/storage';

/**
 * Deserialises a raw storage record into a `StoredCredential`.
 *
 * `chrome.storage.local` serialises `Uint8Array` / `ArrayBuffer` as plain objects on read-back.
 * This function reconstructs the correct typed values from those plain objects.
 */
function deserializeCredential(raw: Record<string, unknown>): StoredCredential {
  const credentialId = new Uint8Array(Object.values(raw['credentialId'] as Record<number, number>));
  // publicKey may already be an ArrayBuffer (same-session write) or a plain object after restart
  const rawPublicKey = raw['publicKey'] as ArrayBuffer | { buffer?: ArrayBuffer };
  const publicKey =
    rawPublicKey instanceof ArrayBuffer
      ? rawPublicKey
      : ((rawPublicKey as { buffer?: ArrayBuffer }).buffer ?? new ArrayBuffer(0));

  return {
    credentialId,
    publicKey,
    signCounter: raw['signCounter'] as number,
    aaguid: raw['aaguid'] as string,
  };
}

/**
 * Retrieves the stored credential, or `undefined` if none registered.
 *
 * @returns The stored credential or `undefined`.
 */
export async function getCredential(): Promise<StoredCredential | undefined> {
  const raw = await storageGet<Record<string, unknown>>(STORAGE_KEYS.CREDENTIAL);
  if (!raw) return undefined;
  return deserializeCredential(raw);
}

/**
 * Persists a credential to storage.
 *
 * @param credential - The credential to store.
 */
export async function setCredential(credential: StoredCredential): Promise<void> {
  return storageSet<StoredCredential>(STORAGE_KEYS.CREDENTIAL, credential);
}

/**
 * Removes the stored credential from storage.
 */
export async function removeCredential(): Promise<void> {
  return storageRemove(STORAGE_KEYS.CREDENTIAL);
}
