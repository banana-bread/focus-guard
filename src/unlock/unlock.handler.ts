/**
 * Unlock message handlers.
 *
 * Each function handles exactly one message type and returns a ResponseMessage.
 * Routing lives in service-worker.ts; these functions receive already-narrowed types.
 */

import { createLogger } from '@/core/logger';
import type { RequestMessage, ResponseMessage } from '@/core/messages';
import { okResponse, errResponse } from '@/core/messages';
import { DEFAULT_UNLOCK_DURATION_MS } from '@/core/config';
import { issueChallenge, verifyAndUnlock, getSession } from '@/unlock/unlock.service';

const logger = createLogger('service_worker');

/**
 * Issues a WebAuthn assertion challenge for the given domain.
 *
 * @param msg - The GET_ASSERTION_CHALLENGE message.
 * @param trace_id - Correlation ID for logging.
 * @returns Challenge bytes, credential ID, and RP ID as number arrays.
 */
export async function handleGetAssertionChallenge(
  msg: Extract<RequestMessage, { type: 'GET_ASSERTION_CHALLENGE' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  const domain = msg.domain ?? '';
  try {
    const { challenge, credentialId, rpId } = await issueChallenge(domain, trace_id);
    return okResponse({
      challenge: Array.from(challenge),
      credentialId: Array.from(credentialId),
      rpId,
    });
  } catch (err) {
    logger.error('assertion_challenge_failed', {
      domain,
      trace_id,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion: 'Ensure a credential is registered before requesting an assertion challenge',
    });
    return errResponse(err instanceof Error ? err.message : 'Challenge failed');
  }
}

/**
 * Verifies a WebAuthn assertion and creates an unlock session.
 *
 * @param msg - The VERIFY_ASSERTION message with authenticatorData, clientDataJSON, signature.
 * @param trace_id - Correlation ID for logging.
 * @returns `null` on success, or an error response.
 */
export async function handleVerifyAssertion(
  msg: Extract<RequestMessage, { type: 'VERIFY_ASSERTION' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  const domain = msg.domain ?? '';
  const durationMs = msg.durationMs ?? DEFAULT_UNLOCK_DURATION_MS;
  try {
    await verifyAndUnlock(
      domain,
      {
        authenticatorData: new Uint8Array(msg.authenticatorData),
        clientDataJSON: new Uint8Array(msg.clientDataJSON),
        signature: new Uint8Array(msg.signature),
        ...(msg.transport !== undefined ? { transport: msg.transport } : {}),
      },
      durationMs,
      trace_id,
    );
    logger.info('webauthn_assertion_verified', { domain, trace_id });
    return okResponse(null);
  } catch (err) {
    logger.error('assertion_verification_failed', {
      domain,
      trace_id,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion:
        'Check rpIdHash and origin match; verify sign counter is monotonically increasing',
    });
    return errResponse(err instanceof Error ? err.message : 'Assertion failed');
  }
}

/**
 * Returns the active unlock session for a domain.
 *
 * @param msg - The GET_UNLOCK_SESSION message.
 * @param trace_id - Correlation ID for logging.
 * @returns The unlock session or `null` if no active session.
 */
export async function handleGetUnlockSession(
  msg: Extract<RequestMessage, { type: 'GET_UNLOCK_SESSION' }>,
  trace_id: string,
): Promise<ResponseMessage> {
  const session = await getSession(msg.domain);
  logger.debug('unlock_session_queried', { domain: msg.domain, trace_id, found: session !== undefined });
  return okResponse(session ?? null);
}
