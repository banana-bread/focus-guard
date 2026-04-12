/**
 * Credential message handlers.
 *
 * Each function handles exactly one message type and returns a ResponseMessage.
 * Routing lives in service-worker.ts; these functions receive already-narrowed types.
 */

import { createLogger } from '@/core/logger';
import type { RequestMessage, ResponseMessage } from '@/core/messages';
import { okResponse, errResponse } from '@/core/messages';
import {
  createRegistrationChallenge,
  registerCredential,
  getCredentialStatus,
} from '@/credential/credential.service';

const logger = createLogger('service_worker');

/**
 * Generates a registration challenge and returns it as a `number[]`.
 *
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response containing the challenge bytes.
 */
export function handleGetRegistrationChallenge(trace_id: string): ResponseMessage {
  const challenge = createRegistrationChallenge();
  logger.info('registration_challenge_created', { trace_id });
  return okResponse({ challenge: Array.from(challenge) });
}

/**
 * Verifies and stores a new WebAuthn credential.
 *
 * @param msg - The REGISTER_CREDENTIAL message with attestation and clientDataJSON.
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response, or an error response if verification fails.
 */
export async function handleRegisterCredential(
  msg: Extract<RequestMessage, { type: 'REGISTER_CREDENTIAL' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  const attestation = new Uint8Array(msg.attestation);
  const clientDataJSON = new Uint8Array(msg.clientDataJSON);
  const expectedOrigin = `chrome-extension://${chrome.runtime.id}`;
  const expectedRpId = `chrome-extension://${chrome.runtime.id}`;
  try {
    const verified = await registerCredential(
      attestation,
      clientDataJSON,
      expectedOrigin,
      expectedRpId,
    );
    logger.info('credential_registered', { trace_id, aaguid: verified.aaguid });
    return okResponse(null);
  } catch (err) {
    logger.error('credential_registration_failed', {
      trace_id,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion:
        'Ensure a valid registration challenge was requested first and the key AAGUID is in the allowlist',
    });
    return errResponse(err instanceof Error ? err.message : 'Registration failed');
  }
}

/**
 * Returns whether a credential is currently registered.
 *
 * @param trace_id - Correlation ID for logging.
 * @returns A successful response containing `{ registered: boolean }`.
 */
export async function handleGetCredentialStatus(trace_id: string): Promise<ResponseMessage> {
  const status = await getCredentialStatus();
  logger.debug('credential_status_queried', { trace_id, registered: status.registered });
  return okResponse(status);
}
