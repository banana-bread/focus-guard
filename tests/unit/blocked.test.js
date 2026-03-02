import { setupChromeMock } from '../helpers/chrome-mock.js';

// Minimal HTML matching the element IDs blocked.js queries at module load time.
const BLOCKED_HTML = `
  <p class="domain" id="domain-display"></p>
  <button id="unlock-btn" disabled>Unlock with Security Key</button>
  <p id="status-msg" class="status"></p>
`;

const TEST_DOMAIN = 'reddit.com';

// Valid base64url value (decodes to 3 null bytes) — sufficient for mocked paths.
const FAKE_B64 = 'AAAA';

const FAKE_CREDENTIAL = {
  credentialId: FAKE_B64,
  publicKeySpki: FAKE_B64,
  signCount: 0,
  transports: ['usb'],
};

// A minimal mock assertion returned by navigator.credentials.get().
const MOCK_ASSERTION = {
  response: {
    clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
    authenticatorData: new Uint8Array([4, 5, 6]).buffer,
    signature: new Uint8Array([7, 8, 9]).buffer,
  },
};

let chromeMock;
// Track href assignments so we can assert on redirect without real navigation.
let lastHref = '';

beforeAll(async () => {
  // Intercept window.location before blocked.js reads .search at module load time.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      search: `?domain=${TEST_DOMAIN}`,
      get href() {
        return lastHref;
      },
      set href(val) {
        lastHref = val;
      },
    },
  });

  document.body.innerHTML = BLOCKED_HTML;
  chromeMock = setupChromeMock();

  // The module-level GET_STATE call uses a callback — respond synchronously.
  chromeMock.runtime.sendMessage.mockImplementation((msg, cb) => {
    if (cb) cb({ blocklist: [TEST_DOMAIN], credential: FAKE_CREDENTIAL, unlocks: {} });
  });

  await import('../../blocked.js');
  // Flush the microtask queue so the module-level GET_STATE callback completes.
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  lastHref = '';
  chromeMock = setupChromeMock();
  vi.clearAllMocks();

  // Default sendMessage implementation: handles all message types used by the click handler.
  chromeMock.runtime.sendMessage.mockImplementation((msg, cb) => {
    if (!cb) return;
    switch (msg.type) {
      case 'GET_STATE':
        cb({ blocklist: [TEST_DOMAIN], credential: FAKE_CREDENTIAL, unlocks: {} });
        break;
      case 'GET_CHALLENGE':
        cb({ challenge: FAKE_B64 });
        break;
      case 'UNLOCK_DOMAIN':
        cb({});
        break;
      default:
        cb({});
    }
  });

  // Provide a successful navigator.credentials.get mock.
  global.navigator.credentials = {
    get: vi.fn().mockResolvedValue(MOCK_ASSERTION),
  };

  // Reset DOM state to a clean baseline between tests.
  const unlockBtn = document.getElementById('unlock-btn');
  unlockBtn.disabled = false;
  unlockBtn.textContent = 'Unlock with Security Key';
  const statusMsg = document.getElementById('status-msg');
  statusMsg.textContent = '';
  statusMsg.className = 'status';
});

/** Flush the microtask/macrotask queue so async handlers complete. */
function flushAsync() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('blocked.js', () => {
  // ── Initial page load ──────────────────────────────────────────────────────

  describe('initial page load', () => {
    it('displays the domain name from the URL parameter', () => {
      expect(document.getElementById('domain-display').textContent).toBe(TEST_DOMAIN);
    });

    it('enables the unlock button when domain is in blocklist and credential is registered', async () => {
      // After beforeAll the module-level GET_STATE returned a valid state.
      // The button is enabled — re-run the check by observing the DOM state.
      expect(document.getElementById('unlock-btn').disabled).toBe(false);
    });
  });

  // ── Unlock button click — success path ────────────────────────────────────

  describe('unlock button click — success', () => {
    it('calls navigator.credentials.get when the unlock button is clicked', async () => {
      document.getElementById('unlock-btn').click();
      await flushAsync();

      expect(global.navigator.credentials.get).toHaveBeenCalledOnce();
    });

    it('sends UNLOCK_DOMAIN message with the assertion data on success', async () => {
      document.getElementById('unlock-btn').click();
      await flushAsync();

      const unlockCall = chromeMock.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'UNLOCK_DOMAIN'
      );
      expect(unlockCall).toBeDefined();
      expect(unlockCall[0].payload.domain).toBe(TEST_DOMAIN);
      expect(typeof unlockCall[0].payload.clientDataJSON).toBe('string');
      expect(typeof unlockCall[0].payload.authenticatorData).toBe('string');
      expect(typeof unlockCall[0].payload.signature).toBe('string');
    });

    it('redirects to the unlocked site after a successful unlock', async () => {
      document.getElementById('unlock-btn').click();
      await flushAsync();

      expect(lastHref).toBe(`https://${TEST_DOMAIN}`);
    });
  });

  // ── Unlock button click — failure paths ───────────────────────────────────

  describe('unlock button click — failure', () => {
    it('shows an error message when navigator.credentials.get rejects', async () => {
      global.navigator.credentials.get = vi.fn().mockRejectedValue(new Error('Hardware error'));
      document.getElementById('unlock-btn').click();
      await flushAsync();

      const statusMsg = document.getElementById('status-msg');
      expect(statusMsg.textContent).toContain('Hardware error');
      expect(statusMsg.className).toContain('error');
    });

    it('shows "Verification cancelled." for a NotAllowedError', async () => {
      const err = new Error('User cancelled');
      err.name = 'NotAllowedError';
      global.navigator.credentials.get = vi.fn().mockRejectedValue(err);
      document.getElementById('unlock-btn').click();
      await flushAsync();

      expect(document.getElementById('status-msg').textContent).toBe('Verification cancelled.');
    });

    it('re-enables the unlock button after a failed assertion', async () => {
      global.navigator.credentials.get = vi.fn().mockRejectedValue(new Error('Failed'));
      document.getElementById('unlock-btn').click();
      await flushAsync();

      expect(document.getElementById('unlock-btn').disabled).toBe(false);
      expect(document.getElementById('unlock-btn').textContent).toBe('Unlock with Security Key');
    });

    it('shows an error when the service worker returns an unlock error', async () => {
      chromeMock.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (!cb) return;
        if (msg.type === 'GET_STATE')
          cb({ blocklist: [TEST_DOMAIN], credential: FAKE_CREDENTIAL, unlocks: {} });
        else if (msg.type === 'GET_CHALLENGE') cb({ challenge: FAKE_B64 });
        else if (msg.type === 'UNLOCK_DOMAIN') cb({ error: 'Signature verification failed' });
      });

      document.getElementById('unlock-btn').click();
      await flushAsync();

      const statusMsg = document.getElementById('status-msg');
      expect(statusMsg.textContent).toContain('Signature verification failed');
      expect(statusMsg.className).toContain('error');
    });

    it('shows an error when GET_CHALLENGE returns an error', async () => {
      chromeMock.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (!cb) return;
        if (msg.type === 'GET_STATE')
          cb({ blocklist: [TEST_DOMAIN], credential: FAKE_CREDENTIAL, unlocks: {} });
        else if (msg.type === 'GET_CHALLENGE') cb({ error: 'Domain not blocked' });
      });

      document.getElementById('unlock-btn').click();
      await flushAsync();

      const statusMsg = document.getElementById('status-msg');
      expect(statusMsg.textContent).toContain('Domain not blocked');
    });

    it('shows an error when no credential is registered', async () => {
      chromeMock.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (!cb) return;
        if (msg.type === 'GET_STATE') cb({ blocklist: [TEST_DOMAIN], credential: null });
      });

      document.getElementById('unlock-btn').click();
      await flushAsync();

      const statusMsg = document.getElementById('status-msg');
      expect(statusMsg.textContent).toContain('No credential registered');
    });
  });
});
