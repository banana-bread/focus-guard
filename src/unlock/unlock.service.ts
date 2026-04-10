/**
 * Business logic for unlock session management.
 *
 * Handles issuing assertion challenges, verifying assertions,
 * creating/reading/ending unlock sessions.
 */

import { createLogger } from '@/core/logger';
import { storeChallenge, consumeChallenge } from '@/unlock/unlock.challenge';
import { getCredential, setCredential } from '@/credential/credential.storage';
import { verifyAssertion } from '@/shared/webauthn';
import { addAllowRule, removeAllowRule } from '@/blocklist/blocklist.rules';
import { getUnlockSessions, setUnlockSessions, deleteUnlockSession } from '@/unlock/unlock.storage';
import { RP_ID, REJECTED_TRANSPORTS } from '@/core/config';
import type { UnlockSession } from '@/core/storage';

const logger = createLogger('service_worker');

/**
 * Issues an assertion challenge for the given domain.
 *
 * @param domain - The domain being unlocked.
 * @param trace_id - Correlation ID for logging.
 * @returns Challenge bytes, credential ID, and RP ID needed for `navigator.credentials.get`.
 * @throws {Error} If no credential is registered.
 */
export async function issueChallenge(
  domain: string,
  trace_id: string,
): Promise<{ challenge: Uint8Array; credentialId: Uint8Array; rpId: string }> {
  const credential = await getCredential();
  if (!credential) {
    throw new Error('No credential registered');
  }

  const challenge = storeChallenge(domain, 'unlock');
  logger.info('webauthn_challenge_created', { domain, trace_id, ttl_ms: 120_000 });

  return { challenge, credentialId: credential.credentialId, rpId: RP_ID };
}

/**
 * Verifies a WebAuthn assertion and creates an unlock session for the domain.
 *
 * @param domain - The domain being unlocked.
 * @param assertion - The assertion response components.
 * @param durationMs - How long to unlock the domain for (ms).
 * @param trace_id - Correlation ID for logging.
 * @throws {Error} If verification fails or transport is rejected.
 */
export async function verifyAndUnlock(
  domain: string,
  assertion: {
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
    transport?: string;
  },
  durationMs: number,
  trace_id: string,
): Promise<void> {
  const pending = consumeChallenge(domain);

  const credential = await getCredential();
  if (!credential) {
    throw new Error('No credential registered');
  }

  if (
    assertion.transport !== undefined &&
    REJECTED_TRANSPORTS.includes(assertion.transport as 'internal' | 'hybrid')
  ) {
    throw new Error(`Transport not allowed: ${assertion.transport}`);
  }

  const expectedOrigin = RP_ID;
  const { newSignCounter } = await verifyAssertion(
    assertion.authenticatorData,
    assertion.clientDataJSON,
    assertion.signature,
    new Uint8Array(credential.publicKey),
    credential.signCounter,
    pending.bytes,
    expectedOrigin,
    RP_ID,
  );

  await setCredential({ ...credential, signCounter: newSignCounter });

  const expiresAt = Date.now() + durationMs;
  const ruleId = await addAllowRule(domain);

  const sessions = await getUnlockSessions();
  sessions[domain] = { expiresAt, duration: durationMs, allowRuleId: ruleId };
  await setUnlockSessions(sessions);

  chrome.alarms.create('relock:' + domain, { when: expiresAt });

  logger.info('unlock_session_started', {
    domain,
    trace_id,
    expiresAt,
    duration_ms: durationMs,
    ruleId,
  });
}

/**
 * Returns the active unlock session for a domain, or `undefined` if none.
 *
 * @param domain - The domain to query.
 * @returns The unlock session or `undefined`.
 */
export async function getSession(domain: string): Promise<UnlockSession | undefined> {
  const sessions = await getUnlockSessions();
  return sessions[domain];
}

/**
 * Ends an unlock session for a domain. Idempotent — safe to call even if no session exists.
 *
 * @param domain - The domain to re-lock.
 * @param trace_id - Correlation ID for logging.
 */
export async function endSession(domain: string, trace_id: string): Promise<void> {
  const sessions = await getUnlockSessions();
  const session = sessions[domain];

  if (!session) {
    return;
  }

  await removeAllowRule(session.allowRuleId);
  await deleteUnlockSession(domain);
  chrome.alarms.clear('relock:' + domain);

  logger.info('unlock_session_ended', { domain, trace_id });
}
