/**
 * User flow tests — end-to-end journeys through the JS modules.
 *
 * Chrome APIs are mocked via the shared helper.
 * navigator.credentials (WebAuthn) is stubbed per-test where needed.
 * verifyAssertionData is mocked so flows don't need real ECDSA crypto.
 * All lib/ implementations are real; service-worker.js is the real module.
 */

import { setupChromeMock } from '../helpers/chrome-mock.js';
import { AAGUID_ALLOWLIST } from 'lib/webauthn.js';

// Mock only verifyAssertionData; keep registerCredential and all other exports real.
vi.mock('lib/webauthn.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyAssertionData: vi.fn().mockResolvedValue({ newSignCount: 1 }),
  };
});

// Top-level await to capture the mock reference in ESM.
const { verifyAssertionData, registerCredential } = await import('lib/webauthn.js');

// ── Module-level constants ────────────────────────────────────────────────────

const VALID_AAGUID = AAGUID_ALLOWLIST[0]; // YubiKey 5 NFC
const FAKE_B64 = 'AAAA'; // base64url for 3 null bytes — sufficient for mocked paths

// ── Shared state ─────────────────────────────────────────────────────────────

let chromeMock;
let messageHandler;
let alarmHandler;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Chrome mock must exist BEFORE service-worker.js registers its listeners.
  chromeMock = setupChromeMock();
  await import('../../service-worker.js');
  messageHandler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
  alarmHandler = chromeMock.alarms.onAlarm.addListener.mock.calls[0][0];
});

beforeEach(() => {
  chromeMock = setupChromeMock();
  vi.clearAllMocks();
  // Restore default success behaviour after clearAllMocks.
  verifyAssertionData.mockResolvedValue({ newSignCount: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sends a message through the service-worker's onMessage handler. */
function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    messageHandler({ type, payload }, {}, resolve);
  });
}

/** Converts a UUID AAGUID string to a 16-byte Uint8Array. */
function aaguidToBytes(aaguidStr) {
  return new Uint8Array(
    aaguidStr.replace(/-/g, '').match(/.{2}/g).map((h) => parseInt(h, 16))
  );
}

/**
 * Builds a minimal CBOR-encoded attestation object containing a real AAGUID.
 * Layout: A1 68 "authData" 58 3A <58 bytes>
 * authData: rpIdHash(32) + flags(1) + signCount(4) + AAGUID(16) + padding(5)
 */
function buildAttestationObject(aaguid = VALID_AAGUID, signCount = 1) {
  const authData = new Uint8Array(58);
  authData[32] = 0x05; // UP + UV flags
  new DataView(authData.buffer).setUint32(33, signCount);
  authData.set(aaguidToBytes(aaguid), 37);

  // CBOR: map(1) { text("authData") => bytes(58) }
  const authDataKey = [0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61]; // "authData"
  return new Uint8Array([0xa1, 0x68, ...authDataKey, 0x58, 58, ...authData]).buffer;
}

/**
 * Builds a fake credential object suitable for navigator.credentials.create to return.
 * Generates a real ECDSA P-256 key pair so registerCredential can import the public key.
 */
async function buildMockCredential({ transports = ['usb'], aaguid = VALID_AAGUID, signCount = 1 } = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey)
  );

  const authData = new Uint8Array(58);
  authData[32] = 0x05;
  new DataView(authData.buffer).setUint32(33, signCount);
  authData.set(aaguidToBytes(aaguid), 37);

  return {
    rawId: new Uint8Array(32),
    response: {
      getTransports: () => transports,
      attestationObject: buildAttestationObject(aaguid, signCount),
      getPublicKey: () => publicKeyBytes.buffer,
      getAuthenticatorData: () => authData.buffer,
    },
  };
}

/**
 * Seeds storage with a domain in the blocklist, a credential, and settings.
 * Issues a GET_CHALLENGE for the domain and returns the challenge string.
 */
async function seedUnlockState(domain = 'reddit.com', settings = { unlockDurationMinutes: 30 }) {
  chromeMock.storage.local._storage.blocklist = [domain];
  chromeMock.storage.local._storage.credential = {
    credentialId: 'test-cred-id',
    publicKeySpki: 'test-key',
    signCount: 0,
    transports: ['usb'],
    aaguid: VALID_AAGUID,
    createdAt: new Date().toISOString(),
  };
  chromeMock.storage.local._storage.settings = settings;
  const { challenge } = await sendMessage('GET_CHALLENGE', { domain });
  return challenge;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1 — Register a security key
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 1 — Register a security key', () => {
  it('credential is saved to storage with correct shape and only hardware transports', async () => {
    const mockCredential = await buildMockCredential({ transports: ['usb'] });
    vi.stubGlobal('navigator', {
      credentials: { create: vi.fn().mockResolvedValue(mockCredential) },
    });

    const result = await registerCredential();

    // Returned object has the expected shape
    expect(result).toMatchObject({
      credentialId: expect.any(String),
      publicKeySpki: expect.any(String),
      transports: ['usb'],
      aaguid: VALID_AAGUID,
      createdAt: expect.any(String),
    });

    // Credential is persisted in storage
    const stored = chromeMock.storage.local._storage.credential;
    expect(stored).toMatchObject({
      credentialId: result.credentialId,
      publicKeySpki: result.publicKeySpki,
      transports: ['usb'],
      aaguid: VALID_AAGUID,
    });

    // No software-only transports in the stored credential
    expect(stored.transports).not.toContain('internal');
    expect(stored.transports).not.toContain('hybrid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2 — Add a domain to blocklist
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 2 — Add a domain to blocklist', () => {
  it('normalized domain appears in storage blocklist and block rule exists in declarativeNetRequest', async () => {
    const result = await sendMessage('ADD_DOMAIN', { domain: 'https://www.Reddit.com/r/funny' });

    // Normalized domain in the response
    expect(result.blocklist).toContain('reddit.com');

    // Persisted in storage
    expect(chromeMock.storage.local._storage.blocklist).toContain('reddit.com');

    // Block rule created in declarativeNetRequest
    expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
    const lastCall = chromeMock.declarativeNetRequest.updateDynamicRules.mock.calls.at(-1)[0];
    const urlFilters = lastCall.addRules.map((r) => r.condition.urlFilter);
    expect(urlFilters).toContain('||reddit.com/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 3 — Remove a domain from blocklist
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 3 — Remove a domain from blocklist', () => {
  it('domain absent from blocklist and block rule removed from declarativeNetRequest', async () => {
    chromeMock.storage.local._storage.blocklist = ['reddit.com', 'twitter.com'];
    chromeMock.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);

    const result = await sendMessage('REMOVE_DOMAIN', { domain: 'reddit.com' });

    // Domain removed from response and storage
    expect(result.blocklist).not.toContain('reddit.com');
    expect(result.blocklist).toContain('twitter.com');
    expect(chromeMock.storage.local._storage.blocklist).not.toContain('reddit.com');

    // Sync called; only twitter.com block rule should remain
    expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
    const lastCall = chromeMock.declarativeNetRequest.updateDynamicRules.mock.calls.at(-1)[0];
    const urlFilters = lastCall.addRules.map((r) => r.condition.urlFilter);
    expect(urlFilters).not.toContain('||reddit.com/');
    expect(urlFilters).toContain('||twitter.com/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 4 — Unlock a blocked site
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 4 — Unlock a blocked site', () => {
  it('allow rule created, unlock record written to storage, and alarm set on success', async () => {
    await seedUnlockState('reddit.com');
    const before = Date.now();

    const result = await sendMessage('UNLOCK_DOMAIN', {
      domain: 'reddit.com',
      clientDataJSON: FAKE_B64,
      authenticatorData: FAKE_B64,
      signature: FAKE_B64,
    });

    expect(result.success).toBe(true);
    expect(verifyAssertionData).toHaveBeenCalled();

    // Allow rule added for the domain (priority 2, action allow)
    const allCalls = chromeMock.declarativeNetRequest.updateDynamicRules.mock.calls;
    const allowRuleCall = allCalls.find(
      ([args]) => args.addRules?.some((r) => r.action?.type === 'allow')
    );
    expect(allowRuleCall).toBeDefined();
    const allowRule = allowRuleCall[0].addRules.find((r) => r.action?.type === 'allow');
    expect(allowRule.condition.urlFilter).toBe('||reddit.com/');
    expect(allowRule.priority).toBe(2);

    // Unlock record written to storage with unlockedAt and expiresAt
    const unlocks = chromeMock.storage.local._storage.unlocks;
    expect(unlocks?.['reddit.com']).toBeDefined();
    expect(unlocks['reddit.com'].unlockedAt).toBeGreaterThanOrEqual(before);
    expect(unlocks['reddit.com'].expiresAt).toBeGreaterThan(unlocks['reddit.com'].unlockedAt);

    // Relock alarm created
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      'relock:reddit.com',
      expect.objectContaining({ delayInMinutes: 30 })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 5 — Unlock expiry re-locks domain
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 5 — Unlock expiry re-locks domain', () => {
  it('allow rule removed and unlock record cleared from storage when relock alarm fires', async () => {
    // Simulate state after a successful unlock
    chromeMock.storage.local._storage.unlocks = {
      'reddit.com': {
        unlockedAt: Date.now() - 1000,
        expiresAt: Date.now() + 60_000,
      },
    };
    chromeMock.declarativeNetRequest.getDynamicRules.mockResolvedValue([
      {
        id: 10001,
        priority: 2,
        action: { type: 'allow' },
        condition: { urlFilter: '||reddit.com/', resourceTypes: ['main_frame'] },
      },
    ]);

    await alarmHandler({ name: 'relock:reddit.com' });

    // Allow rule removed
    expect(chromeMock.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [10001],
    });

    // Unlock record cleared from storage
    expect(chromeMock.storage.local._storage.unlocks?.['reddit.com']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 6 — Remove a registered security key
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 6 — Remove a registered security key', () => {
  it('credential cleared from storage and subsequent unlock attempts fail', async () => {
    // Seed storage with a registered credential
    chromeMock.storage.local._storage.credential = {
      credentialId: 'test-cred-id',
      publicKeySpki: 'test-key',
      signCount: 0,
      transports: ['usb'],
      aaguid: VALID_AAGUID,
      createdAt: new Date().toISOString(),
    };
    chromeMock.storage.local._storage.blocklist = ['reddit.com'];

    // User removes the key
    const clearResult = await sendMessage('CLEAR_CREDENTIAL');
    expect(clearResult.success).toBe(true);

    // Credential is gone from storage
    expect(chromeMock.storage.local._storage.credential).toBeUndefined();

    // Issue a challenge so pendingChallenges has an entry (required before UNLOCK_DOMAIN)
    await sendMessage('GET_CHALLENGE', { domain: 'reddit.com' });

    // Unlock attempt now fails — no credential registered
    const unlockResult = await sendMessage('UNLOCK_DOMAIN', {
      domain: 'reddit.com',
      clientDataJSON: FAKE_B64,
      authenticatorData: FAKE_B64,
      signature: FAKE_B64,
    });

    expect(unlockResult.error).toMatch(/No credential/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 7 — Configure unlock duration
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow 7 — Configure unlock duration', () => {
  it('next unlock uses the 60-minute expiry after settings are updated', async () => {
    // User configures 60-minute unlock duration
    const settingsResult = await sendMessage('UPDATE_SETTINGS', {
      unlockDurationMinutes: 60,
    });
    expect(settingsResult.settings.unlockDurationMinutes).toBe(60);

    // Set up domain and credential for the unlock flow.
    // Settings were already written to storage by UPDATE_SETTINGS above.
    chromeMock.storage.local._storage.blocklist = ['reddit.com'];
    chromeMock.storage.local._storage.credential = {
      credentialId: 'test-cred-id',
      publicKeySpki: 'test-key',
      signCount: 0,
      transports: ['usb'],
      aaguid: VALID_AAGUID,
      createdAt: new Date().toISOString(),
    };

    // Issue challenge
    await sendMessage('GET_CHALLENGE', { domain: 'reddit.com' });

    const before = Date.now();
    const result = await sendMessage('UNLOCK_DOMAIN', {
      domain: 'reddit.com',
      clientDataJSON: FAKE_B64,
      authenticatorData: FAKE_B64,
      signature: FAKE_B64,
    });

    expect(result.success).toBe(true);

    // Alarm uses the 60-minute delay
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      'relock:reddit.com',
      expect.objectContaining({ delayInMinutes: 60 })
    );

    // Expiry stored in unlock record is ~60 minutes from unlockedAt
    const unlock = chromeMock.storage.local._storage.unlocks?.['reddit.com'];
    expect(unlock).toBeDefined();
    const expectedDuration = 60 * 60 * 1000;
    expect(unlock.expiresAt - unlock.unlockedAt).toBeGreaterThanOrEqual(expectedDuration - 100);
    expect(unlock.expiresAt - unlock.unlockedAt).toBeLessThanOrEqual(expectedDuration + 1000);
  });
});
