/**
 * Manages declarativeNetRequest dynamic rules for blocking/unblocking domains.
 *
 * Block rules: IDs 1–9999, priority 1, redirect to blocked.html
 * Allow rules: IDs 10001–19999, priority 2, allow through
 */

const BLOCK_ID_BASE = 1;
const ALLOW_ID_BASE = 10001;

function blockRuleId(index) {
  return BLOCK_ID_BASE + index;
}

function allowRuleId(index) {
  return ALLOW_ID_BASE + index;
}

function makeBlockRule(id, domain) {
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        extensionPath: `/blocked.html?domain=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      urlFilter: `||${domain}/`,
      resourceTypes: ["main_frame"],
    },
  };
}

function makeAllowRule(id, domain) {
  return {
    id,
    priority: 2,
    action: { type: "allow" },
    condition: {
      urlFilter: `||${domain}/`,
      resourceTypes: ["main_frame"],
    },
  };
}

/**
 * Rebuilds all block redirect rules from the blocklist,
 * skipping currently unlocked domains.
 */
export async function syncBlockRules(blocklist, unlocks) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const blockIds = existing
    .filter((r) => r.id >= BLOCK_ID_BASE && r.id <= 9999)
    .map((r) => r.id);

  const unlockedDomains = new Set(Object.keys(unlocks));
  const addRules = blocklist
    .filter((domain) => !unlockedDomains.has(domain))
    .map((domain, i) => makeBlockRule(blockRuleId(i), domain));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: blockIds,
    addRules,
  });
}

/**
 * Adds a high-priority allow rule for a domain (unlocks it).
 */
export async function unlockDomain(domain) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const allowIds = existing
    .filter((r) => r.id >= ALLOW_ID_BASE && r.id <= 19999)
    .map((r) => r.id);

  const nextId = allowIds.length > 0 ? Math.max(...allowIds) + 1 : ALLOW_ID_BASE;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [makeAllowRule(nextId, domain)],
  });
}

/**
 * Removes the allow rule for a domain (re-locks it).
 */
export async function relockDomain(domain) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const ruleToRemove = existing.find(
    (r) =>
      r.id >= ALLOW_ID_BASE &&
      r.id <= 19999 &&
      r.condition.urlFilter === `||${domain}/`
  );

  if (ruleToRemove) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleToRemove.id],
    });
  }
}
