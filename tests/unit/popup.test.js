import { setupChromeMock } from '../helpers/chrome-mock.js';

// Mock registerCredential so we don't need real WebAuthn hardware in these tests.
vi.mock('lib/webauthn.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    registerCredential: vi.fn(),
  };
});

const { registerCredential } = await import('lib/webauthn.js');

// Minimal popup HTML matching the element IDs that popup.js queries at module load.
const POPUP_HTML = `
  <input type="text" id="domain-input" />
  <button id="add-btn">Add</button>
  <div id="error-msg" class="error" hidden></div>
  <div id="success-msg" class="success" hidden></div>
  <ul id="blocklist"></ul>
  <div id="key-unregistered" hidden></div>
  <div id="key-registered" hidden></div>
  <div id="key-info" class="key-info"></div>
  <div id="key-error" class="error" hidden></div>
  <button id="register-btn">Register Security Key</button>
  <button id="remove-key-btn" class="btn-danger">Remove Key</button>
  <select id="unlock-duration">
    <option value="5">5 minutes</option>
    <option value="15">15 minutes</option>
    <option value="30" selected>30 minutes</option>
    <option value="60">60 minutes</option>
  </select>
`;

const FAKE_CREDENTIAL = {
  credentialId: 'test-cred-id',
  publicKeySpki: 'test-key-spki',
  signCount: 0,
  transports: ['usb'],
  aaguid: '2fc0579f-8113-47ea-b116-bb5a8db9202a',
  createdAt: new Date('2024-01-01').toISOString(),
};

const DEFAULT_STATE = {
  blocklist: [],
  credential: null,
  settings: { unlockDurationMinutes: 30 },
  unlocks: {},
};

let chromeMock;

beforeAll(async () => {
  // DOM must be ready before popup.js queries elements at module load time.
  document.body.innerHTML = POPUP_HTML;
  chromeMock = setupChromeMock();
  // loadState() is called at module load — return a valid default response.
  chromeMock.runtime.sendMessage.mockResolvedValue(DEFAULT_STATE);
  await import('../../popup.js');
  // Flush microtask queue so loadState() async operations complete.
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  chromeMock = setupChromeMock();
  vi.clearAllMocks();
  // Restore default mock implementations after clearAllMocks.
  registerCredential.mockResolvedValue(FAKE_CREDENTIAL);
  chromeMock.runtime.sendMessage.mockResolvedValue(DEFAULT_STATE);
  // Reset DOM to a clean baseline so tests don't bleed into each other.
  document.getElementById('domain-input').value = '';
  document.getElementById('blocklist').innerHTML = '';
  document.getElementById('error-msg').hidden = true;
  document.getElementById('success-msg').hidden = true;
  document.getElementById('key-error').hidden = true;
  document.getElementById('key-unregistered').hidden = false;
  document.getElementById('key-registered').hidden = true;
  document.getElementById('key-info').innerHTML = '';
});

/** Flush the microtask/macro-task queue so async popup handlers complete. */
function flushAsync() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('popup.js', () => {
  // ── Add domain form ─────────────────────────────────────────────────────────

  describe('add domain form', () => {
    it('sends ADD_DOMAIN with the normalized domain when add button is clicked', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ blocklist: ['reddit.com'] });
      document.getElementById('domain-input').value = 'https://www.reddit.com/r/funny';
      document.getElementById('add-btn').click();
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'ADD_DOMAIN',
        payload: { domain: 'reddit.com' },
      });
    });

    it('sends ADD_DOMAIN when Enter key is pressed in the input', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ blocklist: ['twitter.com'] });
      document.getElementById('domain-input').value = 'twitter.com';
      document.getElementById('domain-input').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'ADD_DOMAIN',
        payload: { domain: 'twitter.com' },
      });
    });

    it('does not send a message and shows an error for an invalid domain', async () => {
      document.getElementById('domain-input').value = 'not a domain';
      document.getElementById('add-btn').click();
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
      expect(document.getElementById('error-msg').hidden).toBe(false);
      expect(document.getElementById('error-msg').textContent).toMatch(/invalid domain/i);
    });

    it('clears the input after a successful add', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ blocklist: ['reddit.com'] });
      document.getElementById('domain-input').value = 'reddit.com';
      document.getElementById('add-btn').click();
      await flushAsync();

      expect(document.getElementById('domain-input').value).toBe('');
    });

    it('renders the returned blocklist after a successful add', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({
        blocklist: ['reddit.com', 'twitter.com'],
      });
      document.getElementById('domain-input').value = 'reddit.com';
      document.getElementById('add-btn').click();
      await flushAsync();

      const items = Array.from(document.querySelectorAll('#blocklist li span')).map(
        (el) => el.textContent
      );
      expect(items).toContain('reddit.com');
      expect(items).toContain('twitter.com');
    });
  });

  // ── Remove domain ──────────────────────────────────────────────────────────

  describe('remove domain', () => {
    it('sends REMOVE_DOMAIN when the remove button for a domain is clicked', async () => {
      // Render a list item by adding a domain first.
      chromeMock.runtime.sendMessage.mockResolvedValue({ blocklist: ['reddit.com'] });
      document.getElementById('domain-input').value = 'reddit.com';
      document.getElementById('add-btn').click();
      await flushAsync();

      // Click the remove (×) button for the rendered domain.
      chromeMock.runtime.sendMessage.mockResolvedValue({ blocklist: [] });
      const removeBtn = document.querySelector('#blocklist button');
      expect(removeBtn).not.toBeNull();
      removeBtn.click();
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'REMOVE_DOMAIN',
        payload: { domain: 'reddit.com' },
      });
    });

    it('updates the rendered list after removal', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({
        blocklist: ['reddit.com', 'twitter.com'],
      });
      document.getElementById('domain-input').value = 'reddit.com';
      document.getElementById('add-btn').click();
      await flushAsync();

      chromeMock.runtime.sendMessage.mockResolvedValue({ blocklist: ['twitter.com'] });
      document.querySelector('#blocklist button').click();
      await flushAsync();

      const items = Array.from(document.querySelectorAll('#blocklist li span')).map(
        (el) => el.textContent
      );
      expect(items).not.toContain('reddit.com');
      expect(items).toContain('twitter.com');
    });
  });

  // ── Register security key ──────────────────────────────────────────────────

  describe('register security key', () => {
    it('calls registerCredential when the register button is clicked', async () => {
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(registerCredential).toHaveBeenCalled();
    });

    it('shows the key-registered state after successful registration', async () => {
      registerCredential.mockResolvedValue(FAKE_CREDENTIAL);
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('key-registered').hidden).toBe(false);
      expect(document.getElementById('key-unregistered').hidden).toBe(true);
    });

    it('renders the AAGUID and date in key-info after successful registration', async () => {
      registerCredential.mockResolvedValue(FAKE_CREDENTIAL);
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('key-info').textContent).toContain(FAKE_CREDENTIAL.aaguid);
    });

    it('shows an error message when registration fails with a generic error', async () => {
      registerCredential.mockRejectedValue(new Error('Device not found'));
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('key-error').hidden).toBe(false);
      expect(document.getElementById('key-error').textContent).toContain('Device not found');
    });

    it('shows "Registration cancelled." for NotAllowedError', async () => {
      const err = new Error('User cancelled');
      err.name = 'NotAllowedError';
      registerCredential.mockRejectedValue(err);
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('key-error').textContent).toBe('Registration cancelled.');
    });

    it('re-enables the register button after registration completes', async () => {
      registerCredential.mockResolvedValue(FAKE_CREDENTIAL);
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('register-btn').disabled).toBe(false);
    });

    it('re-enables the register button even after a failed registration', async () => {
      registerCredential.mockRejectedValue(new Error('Failed'));
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('register-btn').disabled).toBe(false);
    });
  });

  // ── Remove security key ────────────────────────────────────────────────────

  describe('remove security key', () => {
    it('sends CLEAR_CREDENTIAL when remove key button is clicked and confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      document.getElementById('remove-key-btn').click();
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_CREDENTIAL' });
    });

    it('does not send any message when the user cancels the confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      document.getElementById('remove-key-btn').click();
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('switches to key-unregistered state after successful removal', async () => {
      // Start from a registered state.
      document.getElementById('key-registered').hidden = false;
      document.getElementById('key-unregistered').hidden = true;

      vi.spyOn(window, 'confirm').mockReturnValue(true);
      document.getElementById('remove-key-btn').click();
      await flushAsync();

      expect(document.getElementById('key-unregistered').hidden).toBe(false);
      expect(document.getElementById('key-registered').hidden).toBe(true);
    });
  });

  // ── Unlock duration setting ────────────────────────────────────────────────

  describe('unlock duration setting', () => {
    it('sends UPDATE_SETTINGS with the selected duration when the select changes', async () => {
      const select = document.getElementById('unlock-duration');
      select.value = '60';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'UPDATE_SETTINGS',
        payload: { unlockDurationMinutes: 60 },
      });
    });

    it('sends the duration as a number (not a string)', async () => {
      const select = document.getElementById('unlock-duration');
      select.value = '5';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();

      const call = chromeMock.runtime.sendMessage.mock.calls.find(
        ([msg]) => msg.type === 'UPDATE_SETTINGS'
      );
      expect(typeof call[0].payload.unlockDurationMinutes).toBe('number');
      expect(call[0].payload.unlockDurationMinutes).toBe(5);
    });

    it('sends the correct numeric value for each preset', async () => {
      const select = document.getElementById('unlock-duration');
      for (const value of ['5', '15', '30', '60']) {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await flushAsync();
      }

      const calls = chromeMock.runtime.sendMessage.mock.calls
        .filter(([msg]) => msg.type === 'UPDATE_SETTINGS')
        .map(([msg]) => msg.payload.unlockDurationMinutes);
      expect(calls).toEqual([5, 15, 30, 60]);
    });
  });

  // ── Initial state rendering (on load) ─────────────────────────────────────

  describe('initial state rendering', () => {
    it('renders blocklist items returned by GET_STATE', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({
        blocklist: ['facebook.com', 'tiktok.com'],
        credential: null,
        settings: { unlockDurationMinutes: 30 },
        unlocks: {},
      });
      // ADD_DOMAIN calls renderList with the response blocklist.
      document.getElementById('domain-input').value = 'example.com';
      document.getElementById('add-btn').click();
      await flushAsync();

      const items = Array.from(document.querySelectorAll('#blocklist li span')).map(
        (el) => el.textContent
      );
      expect(items).toContain('facebook.com');
      expect(items).toContain('tiktok.com');
    });

    it('shows key-registered with AAGUID and date when credential is present', async () => {
      registerCredential.mockResolvedValue(FAKE_CREDENTIAL);
      document.getElementById('register-btn').click();
      await flushAsync();

      expect(document.getElementById('key-registered').hidden).toBe(false);
      expect(document.getElementById('key-unregistered').hidden).toBe(true);
      expect(document.getElementById('key-info').textContent).toContain(FAKE_CREDENTIAL.aaguid);
    });

    it('shows key-unregistered when no credential is registered', async () => {
      // Confirm removal to go back to no-credential state.
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      document.getElementById('remove-key-btn').click();
      await flushAsync();

      expect(document.getElementById('key-unregistered').hidden).toBe(false);
    });
  });
});
