/**
 * Storage accessors for user settings.
 */

import { storageGet, storageSet, STORAGE_KEYS } from '@/core/storage';
import type { Settings } from '@/core/storage';

/** Default settings applied when no persisted settings exist. */
const DEFAULTS: Settings = {
  defaultUnlockDurationMs: 1_800_000, // 30 minutes
};

/**
 * Retrieves settings from storage, falling back to defaults.
 *
 * @returns The stored settings merged with defaults.
 */
export async function getSettings(): Promise<Settings> {
  const stored = await storageGet<Settings>(STORAGE_KEYS.SETTINGS);
  return stored ?? { ...DEFAULTS };
}

/**
 * Persists settings to storage.
 *
 * @param settings - The full settings object to store.
 */
export async function setSettings(settings: Settings): Promise<void> {
  await storageSet<Settings>(STORAGE_KEYS.SETTINGS, settings);
}
