/**
 * Business logic for managing the domain blocklist.
 */

import { createLogger } from '@/core/logger';
import { normalizeDomain, isValidDomain } from '@/shared/domain';
import { getBlocklist, setBlocklist } from '@/blocklist/blocklist.storage';
import { syncRules } from '@/blocklist/blocklist.rules';
import { verifyAssertionGeneric, endSession } from '@/unlock/unlock.service';
import type { Blocklist } from '@/core/storage';

const logger = createLogger('service_worker');

// ---------------------------------------------------------------------------
// Tab redirect helpers
// ---------------------------------------------------------------------------

/**
 * Redirects open tabs on a domain (or its subdomains) to the blocked page.
 * Called after adding a domain to the blocklist so existing tabs are blocked immediately.
 */
async function blockOpenTabs(domain: string, trace_id: string): Promise<void> {
  const matchingTabs = await chrome.tabs.query({
    url: [`*://${domain}/*`, `*://*.${domain}/*`],
  });
  const blockedBase = chrome.runtime.getURL('/blocked/blocked.html');
  const redirectable = matchingTabs.filter(
    (t): t is chrome.tabs.Tab & { id: number; url: string } =>
      t.id !== undefined && typeof t.url === 'string' && t.url.length > 0,
  );
  const results = await Promise.allSettled(
    redirectable.map((t) =>
      chrome.tabs.update(t.id, {
        url: `${blockedBase}?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(t.url)}`,
      }),
    ),
  );
  let succeeded = 0;
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      succeeded++;
      return;
    }
    const tab = redirectable[idx];
    logger.warn('block_tab_redirect_failed', {
      domain,
      trace_id,
      tab_id: tab?.id,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      fix_suggestion: 'Tab may have been closed mid-flight; safe to ignore',
    });
  });
  logger.info('block_tabs_redirected', { domain, trace_id, tab_count: succeeded });
}

/**
 * Redirects tabs showing the blocked page for a domain back to the original URL.
 * Called after removing a domain from the blocklist so blocked-page tabs are freed.
 */
async function unblockBlockedPageTabs(domain: string, trace_id: string): Promise<void> {
  const blockedBase = chrome.runtime.getURL('/blocked/blocked.html');
  const allExtTabs = await chrome.tabs.query({
    url: `${blockedBase}*`,
  });
  const matching = allExtTabs.filter(
    (t): t is chrome.tabs.Tab & { id: number; url: string } =>
      t.id !== undefined &&
      typeof t.url === 'string' &&
      new URL(t.url).searchParams.get('domain') === domain,
  );
  const results = await Promise.allSettled(
    matching.map((t) => {
      const originalUrl = new URL(t.url).searchParams.get('url') ?? `https://${domain}`;
      return chrome.tabs.update(t.id, { url: originalUrl });
    }),
  );
  let succeeded = 0;
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      succeeded++;
      return;
    }
    const tab = matching[idx];
    logger.warn('unblock_tab_redirect_failed', {
      domain,
      trace_id,
      tab_id: tab?.id,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      fix_suggestion: 'Tab may have been closed mid-flight; safe to ignore',
    });
  });
  logger.info('unblock_tabs_redirected', { domain, trace_id, tab_count: succeeded });
}

/**
 * Adds a domain to the blocklist and syncs declarativeNetRequest rules.
 *
 * Duplicate domains are silently ignored (warn-logged).
 *
 * @param rawInput - Raw user input (URL or bare hostname).
 * @param trace_id - Correlation ID for logging.
 */
export async function addDomain(rawInput: string, trace_id: string): Promise<void> {
  if (!isValidDomain(rawInput)) {
    throw new Error(`Not a valid domain: "${rawInput}"`);
  }
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
  await blockOpenTabs(domain, trace_id);
  logger.info('domain_added', { domain, trace_id });
}

/**
 * Removes a domain from the blocklist after verifying a WebAuthn assertion.
 *
 * @param domain - The normalised domain to remove.
 * @param assertion - The assertion response components.
 * @param trace_id - Correlation ID for logging.
 * @throws {Error} If assertion verification fails or domain is not in the blocklist.
 */
export async function removeDomain(
  domain: string,
  assertion: {
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
    transport?: string;
  },
  trace_id: string,
): Promise<void> {
  await verifyAssertionGeneric(domain, assertion, 'remove_domain', trace_id);

  const oldList = await getBlocklist();
  const newList = oldList.filter((d: string) => d !== domain);

  if (oldList.length === newList.length) {
    logger.warn('domain_not_in_blocklist', { domain, trace_id });
    return;
  }

  await syncRules(oldList, newList);
  await setBlocklist(newList);

  // Clean up any active unlock session for the removed domain
  await endSession(domain, trace_id, false);

  // Redirect any tabs stuck on the blocked page back to the original URL
  await unblockBlockedPageTabs(domain, trace_id);

  logger.info('domain_removed', { domain, trace_id });
}

/**
 * Returns the current blocklist.
 *
 * @returns Ordered list of blocked hostnames.
 */
export async function getBlocklistDomains(): Promise<Blocklist> {
  return getBlocklist();
}
