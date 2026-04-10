/**
 * Storage accessors for per-domain unlock sessions.
 */

import { storageGet, storageSet, STORAGE_KEYS } from '@/core/storage';
import type { UnlockSessions } from '@/core/storage';

/**
 * Retrieves all active unlock sessions from storage.
 *
 * @returns The stored sessions map, or `{}` if none exist.
 */
export async function getUnlockSessions(): Promise<UnlockSessions> {
  return (await storageGet<UnlockSessions>(STORAGE_KEYS.UNLOCK_SESSIONS)) ?? {};
}

/**
 * Persists all unlock sessions to storage.
 *
 * @param sessions - The sessions map to store.
 */
export async function setUnlockSessions(sessions: UnlockSessions): Promise<void> {
  return storageSet<UnlockSessions>(STORAGE_KEYS.UNLOCK_SESSIONS, sessions);
}

/**
 * Removes a single domain's unlock session from storage.
 *
 * @param domain - The domain whose session to remove.
 */
export async function deleteUnlockSession(domain: string): Promise<void> {
  const sessions = await getUnlockSessions();
  delete sessions[domain];
  await setUnlockSessions(sessions);
}
