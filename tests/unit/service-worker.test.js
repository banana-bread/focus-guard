import { setupChromeMock } from '../helpers/chrome-mock.js';

// Mock verifyAssertionData so we don't need real WebAuthn crypto in these tests.
// base64urlDecode and base64urlEncode are kept as real implementations.
vi.mock('lib/webauthn.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyAssertionData: vi.fn().mockResolvedValue({ newSignCount: 1 }),
  };
});

// Import the mock so tests can configure it per-test.
const { verifyAssertionData } = await import('lib/webauthn.js');

let chromeMock;
let messageHandler;
let alarmHandler;

beforeAll(async () => {
  // Chrome mock must exist before service-worker registers its listeners.
  chromeMock = setupChromeMock();
  await import('../../service-worker.js');

  // Capture the handlers registered at module load time.
  messageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
  alarmHandler = chromeMock.alarms.onAlarm.addListener.mock.calls[0][0];
});

beforeEach(() => {
  // Fresh storage and fresh chrome API call counts for each test.
  chromeMock = setupChromeMock();
  // Clear call history on persistent mocks (preserves mockResolvedValue implementation).
  vi.clearAllMocks();
  // Restore the default success behaviour after clearAllMocks.
  verifyAssertionData.mockResolvedValue({ newSignCount: 1 });
});

/** Sends a message through the service worker's onMessage handler. */
function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    messageHandler({ type, payload }, {}, resolve);
  });
}

// A valid base64url string that decodes to 3 null bytes — enough for mocked paths.
const FAKE_B64 = 'AAAA';

/** Seeds storage with a domain in the blocklist and issues a pending challenge. */
async function setupUnlock(domain = 'reddit.com') {
  chromeMock.storage.local._storage.blocklist = [domain];
  chromeMock.storage.local._storage.credential = {
    credentialId: 'test-cred-id',
    publicKeySpki: 'test-key',
    signCount: 0,
    transports: ['usb'],
    aaguid: '2fc0579f-8113-47ea-b116-bb5a8db9202a',
    createdAt: new Date().toISOString(),
  };
  chromeMock.storage.local._storage.settings = { unlockDurationMinutes: 30 };

  // Issue a challenge so pendingChallenges has an entry for this domain.
  const challengeResult = await sendMessage('GET_CHALLENGE', { domain });
  return challengeResult.challenge;
}

describe('service-worker.js', () => {
  // ── ADD_DOMAIN ─────────────────────────────────────────────────────────────

  describe('ADD_DOMAIN message', () => {
    it('adds the domain to the blocklist and creates a block rule', async () => {
      const result = await sendMessage('ADD_DOMAIN', { domain: 'reddit.com' });

      expect(result.blocklist).toContain('reddit.com');
      expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
      const { addRules } = chromeMock.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      const urlFilters = addRules.map((r) => r.condition.urlFilter);
      expect(urlFilters).toContain('||reddit.com/');
    });

    it('normalizes the domain before adding', async () => {
      const result = await sendMessage('ADD_DOMAIN', { domain: 'https://www.Reddit.com/r/funny' });
      expect(result.blocklist).toContain('reddit.com');
    });

    it('returns an error for an invalid domain', async () => {
      const result = await sendMessage('ADD_DOMAIN', { domain: 'not a domain' });
      expect(result.error).toBeTruthy();
    });

    it('does not duplicate a domain already in the blocklist', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com'];
      const result = await sendMessage('ADD_DOMAIN', { domain: 'reddit.com' });
      expect(result.blocklist.filter((d) => d === 'reddit.com')).toHaveLength(1);
    });
  });

  // ── REMOVE_DOMAIN ──────────────────────────────────────────────────────────

  describe('REMOVE_DOMAIN message', () => {
    it('removes the domain from the blocklist and syncs rules', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com', 'twitter.com'];

      const result = await sendMessage('REMOVE_DOMAIN', { domain: 'reddit.com' });

      expect(result.blocklist).not.toContain('reddit.com');
      expect(result.blocklist).toContain('twitter.com');
      expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
    });

    it('returns an error for an invalid domain', async () => {
      const result = await sendMessage('REMOVE_DOMAIN', { domain: '' });
      expect(result.error).toBeTruthy();
    });

    it('returns an empty blocklist when the only domain is removed', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com'];
      const result = await sendMessage('REMOVE_DOMAIN', { domain: 'reddit.com' });
      expect(result.blocklist).toEqual([]);
    });
  });

  // ── UNLOCK_DOMAIN ──────────────────────────────────────────────────────────

  describe('UNLOCK_DOMAIN message', () => {
    it('verifies WebAuthn, adds allow rule, and sets alarm on success', async () => {
      await setupUnlock('reddit.com');

      const result = await sendMessage('UNLOCK_DOMAIN', {
        domain: 'reddit.com',
        clientDataJSON: FAKE_B64,
        authenticatorData: FAKE_B64,
        signature: FAKE_B64,
      });

      expect(result.success).toBe(true);
      expect(verifyAssertionData).toHaveBeenCalled();
      expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
      expect(chromeMock.alarms.create).toHaveBeenCalledWith(
        'relock:reddit.com',
        expect.objectContaining({ delayInMinutes: 30 })
      );
    });

    it('writes an unlock record with unlockedAt and expiresAt to storage', async () => {
      await setupUnlock('reddit.com');
      const before = Date.now();

      await sendMessage('UNLOCK_DOMAIN', {
        domain: 'reddit.com',
        clientDataJSON: FAKE_B64,
        authenticatorData: FAKE_B64,
        signature: FAKE_B64,
      });

      const unlocks = chromeMock.storage.local._storage.unlocks;
      expect(unlocks?.['reddit.com']).toBeDefined();
      expect(unlocks['reddit.com'].unlockedAt).toBeGreaterThanOrEqual(before);
      expect(unlocks['reddit.com'].expiresAt).toBeGreaterThan(unlocks['reddit.com'].unlockedAt);
    });

    it('returns error when no credential is registered', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com'];
      // No credential in storage — getCredential returns null.
      await sendMessage('GET_CHALLENGE', { domain: 'reddit.com' });

      const result = await sendMessage('UNLOCK_DOMAIN', {
        domain: 'reddit.com',
        clientDataJSON: FAKE_B64,
        authenticatorData: FAKE_B64,
        signature: FAKE_B64,
      });

      expect(result.error).toMatch(/No credential/i);
    });

    it('returns error when no pending challenge exists for the domain', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com'];
      chromeMock.storage.local._storage.credential = {
        credentialId: 'x',
        publicKeySpki: 'x',
        signCount: 0,
      };

      const result = await sendMessage('UNLOCK_DOMAIN', {
        domain: 'reddit.com',
        clientDataJSON: FAKE_B64,
        authenticatorData: FAKE_B64,
        signature: FAKE_B64,
      });

      expect(result.error).toMatch(/No pending challenge/i);
    });

    it('returns error when WebAuthn verification fails', async () => {
      verifyAssertionData.mockRejectedValueOnce(new Error('Signature verification failed'));
      await setupUnlock('reddit.com');

      const result = await sendMessage('UNLOCK_DOMAIN', {
        domain: 'reddit.com',
        clientDataJSON: FAKE_B64,
        authenticatorData: FAKE_B64,
        signature: FAKE_B64,
      });

      expect(result.error).toMatch(/Signature verification failed/i);
    });

    it('returns error when domain is not in the blocklist', async () => {
      // No blocklist entry → should fail before challenge lookup.
      chromeMock.storage.local._storage.blocklist = [];

      const result = await sendMessage('UNLOCK_DOMAIN', {
        domain: 'reddit.com',
        clientDataJSON: FAKE_B64,
        authenticatorData: FAKE_B64,
        signature: FAKE_B64,
      });

      expect(result.error).toBeTruthy();
    });
  });

  // ── Alarm handler ──────────────────────────────────────────────────────────

  describe('alarm handler (relock)', () => {
    it('removes the allow rule for the domain when the relock alarm fires', async () => {
      chromeMock.declarativeNetRequest.getDynamicRules.mockResolvedValue([
        {
          id: 10001,
          priority: 2,
          action: { type: 'allow' },
          condition: { urlFilter: '||reddit.com/', resourceTypes: ['main_frame'] },
        },
      ]);
      chromeMock.storage.local._storage.unlocks = {
        'reddit.com': { unlockedAt: Date.now(), expiresAt: Date.now() + 60_000 },
      };

      await alarmHandler({ name: 'relock:reddit.com' });

      expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [10001],
      });
    });

    it('removes the unlock record from storage when the relock alarm fires', async () => {
      chromeMock.declarativeNetRequest.getDynamicRules.mockResolvedValue([
        {
          id: 10001,
          priority: 2,
          action: { type: 'allow' },
          condition: { urlFilter: '||reddit.com/', resourceTypes: ['main_frame'] },
        },
      ]);
      chromeMock.storage.local._storage.unlocks = {
        'reddit.com': { unlockedAt: Date.now(), expiresAt: Date.now() + 60_000 },
      };

      await alarmHandler({ name: 'relock:reddit.com' });

      expect(chromeMock.storage.local._storage.unlocks?.['reddit.com']).toBeUndefined();
    });

    it('ignores alarms with names that do not start with "relock:"', async () => {
      await alarmHandler({ name: 'some-other-alarm' });

      expect(chromeMock.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    });

    it('only removes the allow rule for the alarmed domain, not others', async () => {
      chromeMock.declarativeNetRequest.getDynamicRules.mockResolvedValue([
        {
          id: 10001,
          priority: 2,
          action: { type: 'allow' },
          condition: { urlFilter: '||twitter.com/', resourceTypes: ['main_frame'] },
        },
        {
          id: 10002,
          priority: 2,
          action: { type: 'allow' },
          condition: { urlFilter: '||reddit.com/', resourceTypes: ['main_frame'] },
        },
      ]);
      chromeMock.storage.local._storage.unlocks = {
        'reddit.com': { unlockedAt: Date.now(), expiresAt: Date.now() + 60_000 },
        'twitter.com': { unlockedAt: Date.now(), expiresAt: Date.now() + 60_000 },
      };

      await alarmHandler({ name: 'relock:reddit.com' });

      const { removeRuleIds } = chromeMock.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(removeRuleIds).toContain(10002);
      expect(removeRuleIds).not.toContain(10001);
    });
  });

  // ── GET_STATE ──────────────────────────────────────────────────────────────

  describe('GET_STATE message', () => {
    it('returns blocklist, credential, unlocks, and settings', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com'];
      chromeMock.storage.local._storage.credential = {
        credentialId: 'cred-id',
        publicKeySpki: 'key',
        signCount: 5,
      };
      chromeMock.storage.local._storage.unlocks = {};
      chromeMock.storage.local._storage.settings = { unlockDurationMinutes: 30 };

      const result = await sendMessage('GET_STATE');

      expect(result.blocklist).toEqual(['reddit.com']);
      expect(result.credential).toMatchObject({ credentialId: 'cred-id', signCount: 5 });
      expect(result.unlocks).toEqual({});
      expect(result.settings).toMatchObject({ unlockDurationMinutes: 30 });
    });

    it('returns null credential when none is registered', async () => {
      const result = await sendMessage('GET_STATE');
      expect(result.credential).toBeNull();
    });

    it('returns an array for blocklist even when storage is empty', async () => {
      const result = await sendMessage('GET_STATE');
      expect(Array.isArray(result.blocklist)).toBe(true);
    });
  });
});
