/**
 * SPA navigation guard — supplements declarativeNetRequest for History API navigations.
 *
 * DNR only matches real network requests, so single-page apps (YouTube, Twitter, etc.)
 * can route client-side past a re-armed block rule. This module listens for
 * `chrome.webNavigation` events on top-level frames and redirects to the blocked page
 * when the destination domain is blocklisted and has no active unlock session.
 */

import { createLogger } from '@/core/logger';
import { normalizeDomain } from '@/shared/domain';
import { getBlocklist } from '@/blocklist/blocklist.storage';
import { getUnlockSessions } from '@/unlock/unlock.storage';
import { STORAGE_KEYS } from '@/core/storage';
import type { UnlockSession, UnlockSessions, Blocklist } from '@/core/storage';

const logger = createLogger('service_worker');

let cachedBlocklist: Blocklist | undefined;
let cachedSessions: UnlockSessions | undefined;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (STORAGE_KEYS.BLOCKLIST in changes) {
    cachedBlocklist = undefined;
  }
  if (STORAGE_KEYS.UNLOCK_SESSIONS in changes) {
    cachedSessions = undefined;
  }
});

async function getBlocklistCached(): Promise<Blocklist> {
  if (cachedBlocklist === undefined) {
    cachedBlocklist = await getBlocklist();
  }
  return cachedBlocklist;
}

async function getUnlockSessionsCached(): Promise<UnlockSessions> {
  if (cachedSessions === undefined) {
    cachedSessions = await getUnlockSessions();
  }
  return cachedSessions;
}

/**
 * Pure decision function — determines whether a navigation to `url` should be blocked.
 *
 * @param url - Destination URL from the webNavigation event.
 * @param blocklist - Normalised blocklist entries.
 * @param sessions - Active unlock sessions map.
 * @returns `{ block: true, domain }` if the navigation should be redirected to the blocked page,
 *          otherwise `{ block: false }`.
 */
export function shouldBlockNavigation(
  url: string,
  blocklist: string[],
  sessions: Record<string, UnlockSession>,
): { block: false } | { block: true; domain: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { block: false };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { block: false };
  }

  const domain = normalizeDomain(parsed.hostname);

  const match = blocklist.find((entry) => domain === entry || domain.endsWith('.' + entry));
  if (match === undefined) {
    return { block: false };
  }

  const session = sessions[match];
  if (session !== undefined && session.expiresAt > Date.now()) {
    return { block: false };
  }

  return { block: true, domain: match };
}

/**
 * Async handler for a webNavigation event — fetches state, runs the decision function,
 * and redirects the tab on a block. Registered from `service-worker.ts`.
 *
 * @param details - Navigation event details from `chrome.webNavigation`.
 */
export async function handleSpaNavigation(details: {
  tabId: number;
  frameId: number;
  url: string;
}): Promise<void> {
  if (details.frameId !== 0) {
    return;
  }

  const trace_id = crypto.randomUUID();

  try {
    const blocklist = await getBlocklistCached();
    if (blocklist.length === 0) {
      return;
    }

    const sessions = await getUnlockSessionsCached();
    const decision = shouldBlockNavigation(details.url, blocklist, sessions);

    if (!decision.block) {
      return;
    }

    const domain = decision.domain;
    const blockedBase = chrome.runtime.getURL('/blocked/blocked.html');
    const target = `${blockedBase}?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(details.url)}`;

    await chrome.tabs.update(details.tabId, { url: target });

    logger.info('spa_navigation_blocked', {
      domain,
      tab_id: details.tabId,
      trace_id,
    });
  } catch (err) {
    logger.error('spa_navigation_handler_threw', {
      trace_id,
      tab_id: details.tabId,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion: 'Check spa-navigation-guard.ts — inspect tabs.update/webNavigation failure',
    });
  }
}
