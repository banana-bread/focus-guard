/**
 * Storage accessors for the domain blocklist.
 */

import { storageGet, storageSet, STORAGE_KEYS } from '@/core/storage';
import type { Blocklist } from '@/core/storage';

/**
 * Retrieves the current blocklist from storage.
 *
 * @returns The stored blocklist, or `[]` if none exists.
 */
export async function getBlocklist(): Promise<Blocklist> {
  return (await storageGet<Blocklist>(STORAGE_KEYS.BLOCKLIST)) ?? [];
}

/**
 * Persists the blocklist to storage.
 *
 * @param list - The blocklist to store.
 */
export async function setBlocklist(list: Blocklist): Promise<void> {
  return storageSet<Blocklist>(STORAGE_KEYS.BLOCKLIST, list);
}
