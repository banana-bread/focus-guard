/**
 * Settings message handlers.
 *
 * Each function handles exactly one message type and returns a ResponseMessage.
 */

import { createLogger } from '@/core/logger';
import type { RequestMessage, ResponseMessage } from '@/core/messages';
import { okResponse, errResponse } from '@/core/messages';
import { getSettingsWithDefaults, updateSettings } from '@/settings/settings.service';

const logger = createLogger('service_worker');

/**
 * Returns the current settings.
 *
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response containing the settings.
 */
export async function handleGetSettings(trace_id: string): Promise<ResponseMessage> {
  const settings = await getSettingsWithDefaults();
  logger.debug('settings_queried', { trace_id });
  return okResponse(settings);
}

/**
 * Updates settings with the provided partial values.
 *
 * @param msg - The SET_SETTINGS message.
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response, or an error response if the update fails.
 */
export async function handleSetSettings(
  msg: Extract<RequestMessage, { type: 'SET_SETTINGS' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  try {
    await updateSettings(msg.settings, trace_id);
    return okResponse(null);
  } catch (err) {
    logger.error('settings_update_failed', {
      trace_id,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion: 'Check that the settings object contains valid fields',
    });
    return errResponse(err instanceof Error ? err.message : 'Failed to update settings');
  }
}
