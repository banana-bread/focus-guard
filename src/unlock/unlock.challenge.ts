/**
 * In-memory pending assertion challenge store.
 *
 * Keyed by domain so multiple domains can have simultaneous pending challenges.
 * Each challenge is single-use and expires after CHALLENGE_TTL_MS.
 */

import { generateChallenge } from '@/shared/crypto';
import type { AssertionOperation } from '@/core/messages';
import { CHALLENGE_TTL_MS } from '@/core/config';

interface PendingChallenge {
  bytes: Uint8Array;
  issuedAt: number;
  operation: AssertionOperation;
}

const challenges = new Map<string, PendingChallenge>();

/**
 * Generates and stores a new assertion challenge for the given domain.
 *
 * @param domain - The domain being unlocked.
 * @param operation - The assertion operation being authorised.
 * @returns The 32-byte challenge.
 */
export function storeChallenge(domain: string, operation: AssertionOperation): Uint8Array {
  const bytes = generateChallenge();
  challenges.set(domain, { bytes, issuedAt: Date.now(), operation });
  return bytes;
}

/**
 * Retrieves and removes the pending challenge for a domain (single-use).
 *
 * @param domain - The domain whose challenge to consume.
 * @returns The pending challenge.
 * @throws {Error} If no challenge exists for the domain or it has expired.
 */
export function consumeChallenge(domain: string): PendingChallenge {
  const pending = challenges.get(domain);
  challenges.delete(domain);

  if (!pending) {
    throw new Error(`No pending challenge for domain: ${domain}`);
  }
  if (Date.now() - pending.issuedAt > CHALLENGE_TTL_MS) {
    throw new Error(`Challenge expired for domain: ${domain}`);
  }
  return pending;
}
