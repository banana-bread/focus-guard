/**
 * Business logic for user settings.
 */

import { createLogger } from '@/core/logger';
import type { Settings } from '@/core/storage';
import { getSettings, setSettings } from '@/settings/settings.storage';

const logger = createLogger('service_worker');

/**
 * Returns current settings with defaults applied.
 *
 * @returns The current settings.
 */
export async function getSettingsWithDefaults(): Promise<Settings> {
  return getSettings();
}

/**
 * Merges partial settings into the existing settings and persists.
 *
 * @param partial - The settings fields to update.
 * @param trace_id - Correlation ID for logging.
 */
export async function updateSettings(partial: Partial<Settings>, trace_id: string): Promise<void> {
  const current = await getSettings();
  const updated: Settings = { ...current, ...partial };
  await setSettings(updated);
  logger.info('settings_updated', { trace_id, settings: updated });
}
