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

/**
 * Builds a single declarativeNetRequest redirect rule for a domain.
 *
 * @param domain - Normalised hostname to block.
 * @param index - Position in the blocklist (determines rule ID).
 * @returns A declarativeNetRequest rule that redirects to the blocked page.
 */
export function buildBlockRule(domain: string, index: number): chrome.declarativeNetRequest.Rule {
  return {
    id: BLOCK_RULE_ID_BASE + index,
    priority: 1,
    action: {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        extensionPath: '/blocked/blocked.html?domain=' + encodeURIComponent(domain),
      },
    },
    condition: {
      urlFilter: '||' + domain,
      resourceTypes: [
        'main_frame' as chrome.declarativeNetRequest.ResourceType,
        'sub_frame' as chrome.declarativeNetRequest.ResourceType,
      ],
    },
  };
}

/**
 * Rebuilds all declarativeNetRequest block rules from scratch.
 *
 * Removes all rules corresponding to `oldList` and adds rules for `newList`.
 *
 * @param oldList - Previous blocklist (used to compute IDs to remove).
 * @param newList - New blocklist to install.
 */
export async function syncRules(oldList: string[], newList: string[]): Promise<void> {
  const removeRuleIds = oldList.map((_, i) => BLOCK_RULE_ID_BASE + i);
  const addRules = newList.map((domain, i) => buildBlockRule(domain, i));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}
