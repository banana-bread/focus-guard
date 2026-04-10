/**
 * declarativeNetRequest rule management for the domain blocklist.
 *
 * Rule IDs are assigned as BLOCK_RULE_ID_BASE + index.
 * The full rule set is rebuilt on every change (O(n), fine for < 100 domains).
 *
 * GOTCHA: Do NOT call chrome.runtime.getURL() at module parse time.
 */

/** Base rule ID for block rules — avoids collisions with other rule sets. */
export const BLOCK_RULE_ID_BASE = 1000;

/** Base rule ID for temporary allow rules — must not collide with block rule IDs. */
export const ALLOW_RULE_ID_BASE = 2000;

/** Escapes a domain string for use in a RE2 regex. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a single declarativeNetRequest redirect rule for a domain.
 *
 * Uses regexFilter + regexSubstitution to capture the original URL and embed it
 * as a query param in the blocked page redirect.
 *
 * @param domain - Normalised hostname to block.
 * @param index - Position in the blocklist (determines rule ID).
 * @returns A declarativeNetRequest rule that redirects to the blocked page.
 */
export function buildBlockRule(domain: string, index: number): chrome.declarativeNetRequest.Rule {
  const escaped = escapeRegex(domain);
  // Matches https?:// + optional subdomains + domain + path/query/hash or end of string
  // The (?:[/?#].*)? anchor ensures reddit.com.evil.com does NOT match when blocking reddit.com
  const regexFilter = `^(https?://(?:[^/?#]*\\.)?${escaped}(?:[/?#].*)?$)`;
  const extensionBase = chrome.runtime.getURL('/blocked/blocked.html');
  return {
    id: BLOCK_RULE_ID_BASE + index,
    priority: 1,
    action: {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        regexSubstitution: `${extensionBase}?domain=${encodeURIComponent(domain)}&url=\\1`,
      },
    },
    condition: {
      regexFilter,
      resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
    },
  };
}

/**
 * Computes a deterministic allow rule ID for a domain via djb2 hash.
 *
 * @param domain - Normalised hostname.
 * @returns A rule ID in the range [ALLOW_RULE_ID_BASE, ALLOW_RULE_ID_BASE + 29999].
 */
function domainAllowRuleId(domain: string): number {
  let hash = 5381;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) + hash + domain.charCodeAt(i)) >>> 0;
  }
  return (hash % 30000) + ALLOW_RULE_ID_BASE;
}

/**
 * Adds a temporary allow rule for a domain at priority 10, overriding the block redirect.
 *
 * @param domain - Normalised hostname to allow.
 * @returns The rule ID added (needed to remove it later).
 */
export async function addAllowRule(domain: string): Promise<number> {
  const ruleId = domainAllowRuleId(domain);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [
      {
        id: ruleId,
        priority: 10,
        action: {
          type: 'allow' as chrome.declarativeNetRequest.RuleActionType,
        },
        condition: {
          urlFilter: '||' + domain,
          resourceTypes: [
            'main_frame' as chrome.declarativeNetRequest.ResourceType,
            'sub_frame' as chrome.declarativeNetRequest.ResourceType,
          ],
        },
      },
    ],
  });
  return ruleId;
}

/**
 * Removes a previously-added allow rule by its ID.
 *
 * @param ruleId - The ID returned by `addAllowRule`.
 */
export async function removeAllowRule(ruleId: number): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [],
  });
}

/**
 * Rebuilds all declarativeNetRequest block rules from scratch.
 *
 * Removes all rules corresponding to `oldList` and adds rules for `newList`.
 *
 * @param oldList - Previous blocklist (used to compute IDs to remove).
 * @param newList - New blocklist to install.
 */
export async function syncRules(_oldList: string[], newList: string[]): Promise<void> {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter(
      (r: chrome.declarativeNetRequest.Rule) =>
        r.id >= BLOCK_RULE_ID_BASE && r.id < ALLOW_RULE_ID_BASE,
    )
    .map((r: chrome.declarativeNetRequest.Rule) => r.id);
  const addRules = newList.map((domain, i) => buildBlockRule(domain, i));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}
