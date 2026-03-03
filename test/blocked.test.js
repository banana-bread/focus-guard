import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildChromeMock } from './mocks/chrome.js';

// Mock webauthn lib — blocked.js uses base64urlDecode and base64urlEncode
vi.mock('../lib/webauthn.js', () => ({
  base64urlDecode: vi.fn(() => new Uint8Array([1, 2, 3])),
  base64urlEncode: vi.fn(() => 'mock-b64url'),
}));

const DEFAULT_CREDENTIAL = {
  credentialId: 'dGVzdA',
  publicKeySpki: 'key',
  transports: ['usb'],
  signCount: 0,
};

let chromeMock;
let credentialsGet;

function setupDOM() {
  document.body.innerHTML = `
    <p id="domain-display"></p>
    <button id="unlock-btn" disabled>Unlock with Security Key</button>
    <p id="status-msg" class="status"></p>
  `;
}

function setLocation(search) {
  Object.defineProperty(window, 'location', {
    value: { search, href: '' },
    writable: true,
    configurable: true,
  });
}

// Configure chrome.runtime.sendMessage to respond to each message type.
// Falls back to default responses for unspecified types.
function configureSendMessage(overrides = {}) {
  const defaults = {
    GET_STATE: {
      blocklist: ['reddit.com'],
      credential: DEFAULT_CREDENTIAL,
      unlocks: {},
      settings: { unlockDurationMinutes: 30 },
    },
    GET_CHALLENGE: { challenge: 'bW9jaw' },
    UNLOCK_DOMAIN: { success: true },
  };
  chromeMock.runtime.sendMessage.mockImplementation((msg, cb) => {
    if (!cb) return;
    const response =
      overrides[msg.type] !== undefined ? overrides[msg.type] : defaults[msg.type];
    if (response !== undefined) {
      cb(typeof response === 'function' ? response(msg) : response);
    }
  });
}

// Clear module cache and import fresh blocked.js after location/mocks are configured.
async function loadBlocked() {
  vi.resetModules();
  await import('../blocked.js');
  // Flush microtasks so the GET_STATE callback updates the DOM
  await Promise.resolve();
}

// Flush all microtasks and pending macrotasks so async click handler completes.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  setupDOM();

  chromeMock = buildChromeMock();
  global.chrome = chromeMock;

  credentialsGet = vi.fn().mockResolvedValue({
    response: {
      clientDataJSON: new ArrayBuffer(8),
      authenticatorData: new ArrayBuffer(8),
      signature: new ArrayBuffer(8),
    },
  });
  // Replace navigator.credentials with our mock (jsdom may not implement it)
  Object.defineProperty(global.navigator, 'credentials', {
    value: { get: credentialsGet },
    writable: true,
    configurable: true,
  });

  // Default: sensible state with reddit.com blocked and credential registered
  configureSendMessage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Domain display
// ---------------------------------------------------------------------------

describe('Domain display', () => {
  it('shows domain from ?domain= query param', async () => {
    setLocation('?domain=reddit.com');
    await loadBlocked();

    expect(document.getElementById('domain-display').textContent).toBe('reddit.com');
  });

  it('shows "Unknown site" when no domain param', async () => {
    setLocation('');
    await loadBlocked();

    expect(document.getElementById('domain-display').textContent).toBe('Unknown site');
  });
});

// ---------------------------------------------------------------------------
// Open-redirect guard (GET_STATE callback)
// ---------------------------------------------------------------------------

describe('Open-redirect guard', () => {
  it('keeps unlock button visible when domain is in blocklist', async () => {
    setLocation('?domain=reddit.com');
    configureSendMessage({
      GET_STATE: { blocklist: ['reddit.com'], credential: DEFAULT_CREDENTIAL, unlocks: {}, settings: {} },
    });
    await loadBlocked();

    const unlockBtn = document.getElementById('unlock-btn');
    expect(unlockBtn.style.display).not.toBe('none');
  });

  it('hides unlock button and shows error when domain is absent from blocklist', async () => {
    setLocation('?domain=facebook.com');
    configureSendMessage({
      GET_STATE: { blocklist: ['reddit.com'], credential: null, unlocks: {}, settings: {} },
    });
    await loadBlocked();

    const unlockBtn = document.getElementById('unlock-btn');
    const statusMsg = document.getElementById('status-msg');
    expect(unlockBtn.style.display).toBe('none');
    expect(statusMsg.className).toContain('error');
    expect(statusMsg.textContent).toBeTruthy();
  });

  it('normalizes domain before blocklist check (?domain=Reddit.com → reddit.com)', async () => {
    setLocation('?domain=Reddit.com');
    configureSendMessage({
      GET_STATE: { blocklist: ['reddit.com'], credential: DEFAULT_CREDENTIAL, unlocks: {}, settings: {} },
    });
    await loadBlocked();

    // Normalization matched reddit.com, so button should remain visible
    const unlockBtn = document.getElementById('unlock-btn');
    expect(unlockBtn.style.display).not.toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Unlock button enabled state
// ---------------------------------------------------------------------------

describe('Unlock button enabled state', () => {
  it('enables button when credential is present', async () => {
    setLocation('?domain=reddit.com');
    configureSendMessage({
      GET_STATE: { blocklist: ['reddit.com'], credential: DEFAULT_CREDENTIAL, unlocks: {}, settings: {} },
    });
    await loadBlocked();

    expect(document.getElementById('unlock-btn').disabled).toBe(false);
  });

  it('keeps button disabled when credential is null', async () => {
    setLocation('?domain=reddit.com');
    configureSendMessage({
      GET_STATE: { blocklist: ['reddit.com'], credential: null, unlocks: {}, settings: {} },
    });
    await loadBlocked();

    expect(document.getElementById('unlock-btn').disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full unlock flow
// ---------------------------------------------------------------------------

describe('Full unlock flow', () => {
  it('sends GET_STATE, GET_CHALLENGE, calls credentials.get, sends UNLOCK_DOMAIN, sets location.href', async () => {
    setLocation('?domain=reddit.com');
    await loadBlocked();

    document.getElementById('unlock-btn').click();
    await flush();

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GET_STATE' }),
      expect.any(Function)
    );
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GET_CHALLENGE', payload: { domain: 'reddit.com' } }),
      expect.any(Function)
    );
    expect(credentialsGet).toHaveBeenCalled();
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UNLOCK_DOMAIN' }),
      expect.any(Function)
    );
    expect(window.location.href).toBe('https://reddit.com');
  });

  it('changes button label to "Verifying…" immediately on click', async () => {
    setLocation('?domain=reddit.com');
    await loadBlocked();

    const unlockBtn = document.getElementById('unlock-btn');
    unlockBtn.click(); // synchronous portion of the handler runs first

    expect(unlockBtn.textContent).toBe('Verifying…');
    expect(unlockBtn.disabled).toBe(true);

    await flush(); // let the rest of the flow complete
  });

  it('re-enables button with original label if an error occurs', async () => {
    setLocation('?domain=reddit.com');
    configureSendMessage({ GET_CHALLENGE: { error: 'Challenge failed' } });
    await loadBlocked();

    const unlockBtn = document.getElementById('unlock-btn');
    unlockBtn.click();
    await flush();

    expect(unlockBtn.disabled).toBe(false);
    expect(unlockBtn.textContent).toBe('Unlock with Security Key');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  it('shows error and re-enables button when GET_CHALLENGE returns an error', async () => {
    setLocation('?domain=reddit.com');
    configureSendMessage({ GET_CHALLENGE: { error: 'Domain is not in the blocklist.' } });
    await loadBlocked();

    const unlockBtn = document.getElementById('unlock-btn');
    const statusMsg = document.getElementById('status-msg');
    unlockBtn.click();
    await flush();

    expect(unlockBtn.disabled).toBe(false);
    expect(statusMsg.textContent).toContain('Domain is not in the blocklist.');
  });

  it('shows error and re-enables button when UNLOCK_DOMAIN returns an error', async () => {
    setLocation('?domain=reddit.com');
    configureSendMessage({ UNLOCK_DOMAIN: { error: 'Invalid signature' } });
    await loadBlocked();

    const unlockBtn = document.getElementById('unlock-btn');
    const statusMsg = document.getElementById('status-msg');
    unlockBtn.click();
    await flush();

    expect(unlockBtn.disabled).toBe(false);
    expect(statusMsg.textContent).toContain('Invalid signature');
  });

  it('shows "Verification cancelled." when credentials.get throws NotAllowedError', async () => {
    setLocation('?domain=reddit.com');
    await loadBlocked();

    const notAllowed = new DOMException('User cancelled', 'NotAllowedError');
    credentialsGet.mockRejectedValue(notAllowed);

    const unlockBtn = document.getElementById('unlock-btn');
    const statusMsg = document.getElementById('status-msg');
    unlockBtn.click();
    await flush();

    expect(unlockBtn.disabled).toBe(false);
    expect(statusMsg.textContent).toBe('Verification cancelled.');
  });

  it('shows "Error: <message>" for generic errors', async () => {
    setLocation('?domain=reddit.com');
    await loadBlocked();

    credentialsGet.mockRejectedValue(new Error('Hardware key disconnected'));

    const unlockBtn = document.getElementById('unlock-btn');
    const statusMsg = document.getElementById('status-msg');
    unlockBtn.click();
    await flush();

    expect(unlockBtn.disabled).toBe(false);
    expect(statusMsg.textContent).toBe('Error: Hardware key disconnected');
  });
});
