/**
 * Business logic for managing the domain blocklist.
 */

import { createLogger } from '@/core/logger';
import { normalizeDomain } from '@/shared/domain';
import { getBlocklist, setBlocklist } from '@/blocklist/blocklist.storage';
import { syncRules } from '@/blocklist/blocklist.rules';
import type { Blocklist } from '@/core/storage';

const logger = createLogger('service_worker');

/**
 * Adds a domain to the blocklist and syncs declarativeNetRequest rules.
 *
 * Duplicate domains are silently ignored (warn-logged).
 *
 * @param rawInput - Raw user input (URL or bare hostname).
 * @param trace_id - Correlation ID for logging.
 */
export async function addDomain(rawInput: string, trace_id: string): Promise<void> {
  const domain = normalizeDomain(rawInput);
  // NOTE: read-modify-write is not concurrency-safe. Two concurrent ADD_DOMAIN messages
  // could both pass the duplicate check and the second write would overwrite the first.
  // Acceptable at current scale (<100 domains, single popup); revisit if needed.
  const oldList = await getBlocklist();

  if (oldList.includes(domain)) {
    logger.warn('domain_duplicate', { domain, trace_id });
    return;
  }

  const newList = [...oldList, domain];
  await syncRules(oldList, newList);
  await setBlocklist(newList);
  logger.info('domain_added', { domain, trace_id });
}

/**
 * Returns the current blocklist.
 *
 * @returns Ordered list of blocked hostnames.
 */
export async function getBlocklistDomains(): Promise<Blocklist> {
  return getBlocklist();
}
