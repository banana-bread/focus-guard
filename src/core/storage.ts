/**
 * Promise-based abstraction over `chrome.storage.local` plus storage key constants and data types.
 *
 * Slices own their full serialisation logic; this module owns the key namespace and thin get/set/remove helpers.
 */

/** Canonical storage key constants — all keys used by the extension live here. */
export const STORAGE_KEYS = {
  CREDENTIAL: 'credential',
  BLOCKLIST: 'blocklist',
  UNLOCK_SESSIONS: 'unlock_sessions',
  SETTINGS: 'settings',
} as const;

/**
 * A registered WebAuthn credential stored for the extension.
 *
 * NOTE: `credentialId` is stored as `Uint8Array` but `chrome.storage.local` serialises typed arrays
 * as plain objects on read-back. The credential slice is responsible for (de)serialisation.
 */
export interface StoredCredential {
  credentialId: Uint8Array;
  publicKey: ArrayBuffer;
  signCounter: number;
  aaguid: string;
}

/** Ordered list of blocked hostnames (bare, normalised). */
export type Blocklist = string[];

/** Per-domain unlock session tracking expiry and configured duration. */
export interface UnlockSession {
  /** Unix timestamp (ms) when the session expires. */
  expiresAt: number;
  /** Duration the unlock was granted for (ms). */
  duration: number;
  /** ID of the declarativeNetRequest allow rule to remove on re-lock. */
  allowRuleId: number;
}

/** Map of normalised domain → active unlock session. */
export type UnlockSessions = Record<string, UnlockSession>;

/** User-configurable extension settings. */
export interface Settings {
  defaultUnlockDurationMs: number;
}

/**
 * Retrieves a value from `chrome.storage.local` by key.
 *
 * @param key - Storage key to read.
 * @returns The stored value cast to `T`, or `undefined` if the key is absent.
 */
export async function storageGet<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

/**
 * Persists a value to `chrome.storage.local`.
 *
 * @param key - Storage key to write.
 * @param value - Value to store.
 */
export async function storageSet<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Removes a key from `chrome.storage.local`.
 *
 * @param key - Storage key to delete.
 */
export async function storageRemove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}
