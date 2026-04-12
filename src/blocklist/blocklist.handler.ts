/**
 * Blocklist message handlers.
 *
 * Each function handles exactly one message type and returns a ResponseMessage.
 * Routing lives in service-worker.ts; these functions receive already-narrowed types.
 */

import type { RequestMessage, ResponseMessage } from '@/core/messages';
import { okResponse, errResponse } from '@/core/messages';
import { addDomain, removeDomain, getBlocklistDomains } from '@/blocklist/blocklist.service';
import { createLogger } from '@/core/logger';

const logger = createLogger('service_worker');

/**
 * Adds a domain to the blocklist and syncs declarativeNetRequest rules.
 *
 * @param msg - The ADD_DOMAIN message.
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response, or an error response if the domain is invalid.
 */
export async function handleAddDomain(
  msg: Extract<RequestMessage, { type: 'ADD_DOMAIN' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  try {
    await addDomain(msg.domain, trace_id);
    return okResponse(null);
  } catch (err) {
    logger.error('add_domain_failed', {
      trace_id,
      domain: msg.domain,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion: 'Check that the domain input is a valid URL or hostname',
    });
    return errResponse(err instanceof Error ? err.message : 'Failed to add domain');
  }
}

/**
 * Removes a domain from the blocklist after WebAuthn verification.
 *
 * @param msg - The REMOVE_DOMAIN message with assertion data.
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response, or an error response if verification/removal fails.
 */
export async function handleRemoveDomain(
  msg: Extract<RequestMessage, { type: 'REMOVE_DOMAIN' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  try {
    await removeDomain(
      msg.domain,
      {
        authenticatorData: new Uint8Array(msg.authenticatorData),
        clientDataJSON: new Uint8Array(msg.clientDataJSON),
        signature: new Uint8Array(msg.signature),
        ...(msg.transport !== undefined ? { transport: msg.transport } : {}),
      },
      trace_id,
    );
    return okResponse(null);
  } catch (err) {
    logger.error('remove_domain_failed', {
      trace_id,
      domain: msg.domain,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion: 'Verify assertion is valid and domain exists in the blocklist',
    });
    return errResponse(err instanceof Error ? err.message : 'Failed to remove domain');
  }
}

/**
 * Returns the current blocklist.
 *
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response containing the ordered list of blocked domains.
 */
export async function handleGetBlocklist(trace_id: string): Promise<ResponseMessage> {
  const list = await getBlocklistDomains();
  logger.debug('blocklist_queried', { trace_id, count: list.length });
  return okResponse(list);
}
