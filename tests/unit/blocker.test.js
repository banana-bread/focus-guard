import { setupChromeMock } from '../helpers/chrome-mock.js';
import { syncBlockRules, unlockDomain, relockDomain } from 'lib/blocker.js';

const BLOCK_ID_BASE = 1;
const ALLOW_ID_BASE = 10001;

function makeBlockRule(id, domain) {
  return {
    id,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: `/blocked.html?domain=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      urlFilter: `||${domain}/`,
      resourceTypes: ['main_frame'],
    },
  };
}

function makeAllowRule(id, domain) {
  return {
    id,
    priority: 2,
    action: { type: 'allow' },
    condition: {
      urlFilter: `||${domain}/`,
      resourceTypes: ['main_frame'],
    },
  };
}

describe('blocker.js', () => {
  let chrome;

  beforeEach(() => {
    chrome = setupChromeMock();
  });

  describe('syncBlockRules', () => {
    it('creates block rules for each domain in the blocklist', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

      await syncBlockRules(['reddit.com', 'twitter.com'], {});

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [],
        addRules: [
          makeBlockRule(BLOCK_ID_BASE, 'reddit.com'),
          makeBlockRule(BLOCK_ID_BASE + 1, 'twitter.com'),
        ],
      });
    });

    it('removes existing block rules before adding new ones', async () => {
      const existingRules = [
        makeBlockRule(1, 'old.com'),
        makeBlockRule(2, 'older.com'),
      ];
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue(existingRules);

      await syncBlockRules(['reddit.com'], {});

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call.removeRuleIds).toContain(1);
      expect(call.removeRuleIds).toContain(2);
    });

    it('skips unlocked domains when creating block rules', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

      await syncBlockRules(
        ['reddit.com', 'twitter.com'],
        { 'reddit.com': { unlockedAt: Date.now(), expiresAt: Date.now() + 60000 } }
      );

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      const domains = call.addRules.map((r) => r.condition.urlFilter);
      expect(domains).not.toContain('||reddit.com/');
      expect(domains).toContain('||twitter.com/');
    });

    it('creates no add rules when blocklist is empty', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

      await syncBlockRules([], {});

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [],
        addRules: [],
      });
    });

    it('does not remove allow rules (IDs >= 10001)', async () => {
      const existingRules = [
        makeBlockRule(1, 'blocked.com'),
        makeAllowRule(10001, 'allowed.com'),
      ];
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue(existingRules);

      await syncBlockRules(['blocked.com'], {});

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call.removeRuleIds).toContain(1);
      expect(call.removeRuleIds).not.toContain(10001);
    });
  });

  describe('unlockDomain', () => {
    it('adds an allow rule for a domain with the correct shape', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

      await unlockDomain('reddit.com');

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        addRules: [makeAllowRule(ALLOW_ID_BASE, 'reddit.com')],
      });
    });

    it('uses the next available ID when allow rules already exist', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([
        makeAllowRule(ALLOW_ID_BASE, 'twitter.com'),
        makeAllowRule(ALLOW_ID_BASE + 1, 'facebook.com'),
      ]);

      await unlockDomain('reddit.com');

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call.addRules[0].id).toBe(ALLOW_ID_BASE + 2);
    });

    it('allow rule has priority 2 and action type "allow"', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

      await unlockDomain('example.com');

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      const rule = call.addRules[0];
      expect(rule.priority).toBe(2);
      expect(rule.action.type).toBe('allow');
      expect(rule.condition.urlFilter).toBe('||example.com/');
      expect(rule.condition.resourceTypes).toEqual(['main_frame']);
    });

    it('serialises concurrent unlock calls to avoid duplicate IDs', async () => {
      let callCount = 0;
      chrome.declarativeNetRequest.getDynamicRules.mockImplementation(async () => {
        // Return rules that increase with each call to simulate state
        return callCount++ === 0 ? [] : [makeAllowRule(ALLOW_ID_BASE, 'twitter.com')];
      });

      await Promise.all([unlockDomain('twitter.com'), unlockDomain('reddit.com')]);

      const ids = chrome.declarativeNetRequest.updateDynamicRules.mock.calls.map(
        (call) => call[0].addRules[0].id
      );
      expect(new Set(ids).size).toBe(2); // Both IDs must be unique
    });
  });

  describe('relockDomain', () => {
    it('removes the allow rule for the given domain', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([
        makeAllowRule(ALLOW_ID_BASE, 'reddit.com'),
        makeAllowRule(ALLOW_ID_BASE + 1, 'twitter.com'),
      ]);

      await relockDomain('reddit.com');

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [ALLOW_ID_BASE],
      });
    });

    it('does not call updateDynamicRules if no allow rule exists for the domain', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

      await relockDomain('reddit.com');

      expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    });

    it('only removes the rule for the target domain, not others', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([
        makeAllowRule(ALLOW_ID_BASE, 'twitter.com'),
        makeAllowRule(ALLOW_ID_BASE + 1, 'reddit.com'),
      ]);

      await relockDomain('reddit.com');

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call.removeRuleIds).toEqual([ALLOW_ID_BASE + 1]);
    });
  });

  describe('getDynamicRules (listing existing rules)', () => {
    it('returns the mocked rule set via getDynamicRules', async () => {
      const rules = [makeBlockRule(1, 'reddit.com'), makeAllowRule(ALLOW_ID_BASE, 'twitter.com')];
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue(rules);

      const result = await chrome.declarativeNetRequest.getDynamicRules();

      expect(result).toEqual(rules);
      expect(result).toHaveLength(2);
    });
  });
});
