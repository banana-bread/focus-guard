/**
 * Focus Guard popup UI — workflow handlers and boot sequence.
 *
 * Pure helpers, render functions, and timer logic live in popup.render.ts.
 * Messaging and WebAuthn ceremony helpers live in popup.messaging.ts.
 */

import { sendMessage, performAssertionCeremony } from './popup.messaging';
import {
  show,
  showError,
  clearError,
  renderBlocklist,
  setRegisteredState,
  setUnregisteredState,
  setDeviceName,
  renderSettings,
  attachTimers,
  startTimerInterval,
  type SessionResult,
} from './popup.render';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const statusDot = document.getElementById('status-dot');
const sectionRegister = document.getElementById('section-register');
const sectionKeyStatus = document.getElementById('section-key-status');
const sectionAddDomain = document.getElementById('section-add-domain');
const sectionBlocklist = document.getElementById('section-blocklist');
const btnRegister = document.getElementById('btn-register') as HTMLButtonElement | null;
const registerError = document.getElementById('register-error');
const inputDomain = document.getElementById('input-domain') as HTMLInputElement | null;
const btnAddDomain = document.getElementById('btn-add-domain') as HTMLButtonElement | null;
const addDomainError = document.getElementById('add-domain-error');
const domainList = document.getElementById('domain-list');
const emptyState = document.getElementById('empty-state');
const sectionSettings = document.getElementById('section-settings');
const selectDuration = document.getElementById('select-duration') as HTMLSelectElement | null;
const deviceNameEl = document.getElementById('device-name');

// ---------------------------------------------------------------------------
// Timer orchestration
// ---------------------------------------------------------------------------

let timerInterval: ReturnType<typeof setInterval> | null = null;

async function initTimers(domains: string[]): Promise<void> {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const sessionResults = await Promise.all(
    domains.map(async (domain): Promise<SessionResult | null> => {
      const trace_id = crypto.randomUUID();
      const resp = await sendMessage({ type: 'GET_UNLOCK_SESSION', domain, trace_id });
      if (resp.ok && resp.data !== null) {
        return { domain, expiresAt: (resp.data as { expiresAt: number }).expiresAt };
      }
      return null;
    }),
  );

  attachTimers(domainList, sessionResults);
  if (sessionResults.some((r) => r !== null)) {
    timerInterval = startTimerInterval(domainList);
  }
}

/** Fetches the blocklist, renders it, and starts timers. */
async function refreshBlocklist(trace_id: string): Promise<void> {
  const listResp = await sendMessage({ type: 'GET_BLOCKLIST', trace_id });
  if (listResp.ok) {
    const domains = listResp.data as string[];
    renderBlocklist(domainList, emptyState, domains);
    void initTimers(domains).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('initTimers_failed', { error: String(err) });
    });
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const trace_id = crypto.randomUUID();
  const statusResp = await sendMessage({ type: 'GET_CREDENTIAL_STATUS', trace_id });

  if (!statusResp.ok) {
    show(sectionRegister);
    showError(registerError, 'Could not connect to extension. Try reopening the popup.');
    return;
  }

  const { registered, deviceName } = statusResp.data as {
    registered: boolean;
    deviceName?: string;
  };

  if (registered) {
    setRegisteredState(
      statusDot,
      sectionRegister,
      sectionKeyStatus,
      sectionAddDomain,
      sectionBlocklist,
      sectionSettings,
    );
    if (deviceName !== undefined) {
      setDeviceName(deviceNameEl, deviceName);
    }

    const settingsResp = await sendMessage({ type: 'GET_SETTINGS', trace_id });
    if (settingsResp.ok) {
      const settings = settingsResp.data as { defaultUnlockDurationMs: number };
      renderSettings(selectDuration, settings.defaultUnlockDurationMs);
    }

    await refreshBlocklist(trace_id);
  } else {
    setUnregisteredState(
      statusDot,
      sectionRegister,
      sectionKeyStatus,
      sectionAddDomain,
      sectionBlocklist,
      sectionSettings,
    );
  }
}

// ---------------------------------------------------------------------------
// Register YubiKey
// ---------------------------------------------------------------------------

async function handleRegister(): Promise<void> {
  clearError(registerError);
  if (btnRegister) btnRegister.disabled = true;

  try {
    const trace_id = crypto.randomUUID();
    const challengeResp = await sendMessage({ type: 'GET_REGISTRATION_CHALLENGE', trace_id });

    if (!challengeResp.ok) {
      showError(registerError, challengeResp.error);
      return;
    }

    const { challenge } = challengeResp.data as { challenge: number[] };
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rp: { id: chrome.runtime.id, name: 'Focus Guard' },
        user: { id: userId, name: 'focus-guard-user', displayName: 'Focus Guard User' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'cross-platform',
          residentKey: 'discouraged',
          userVerification: 'discouraged',
        },
        attestation: 'direct',
        hints: ['security-key'],
      } as PublicKeyCredentialCreationOptions,
    });

    if (!credential) {
      showError(registerError, 'Registration cancelled.');
      return;
    }

    const pkc = credential as PublicKeyCredential;
    const response = pkc.response as AuthenticatorAttestationResponse;

    const registerResp = await sendMessage({
      type: 'REGISTER_CREDENTIAL',
      attestation: Array.from(new Uint8Array(response.attestationObject)),
      clientDataJSON: Array.from(new Uint8Array(response.clientDataJSON)),
      trace_id,
    });

    if (!registerResp.ok) {
      showError(registerError, registerResp.error);
      return;
    }

    setRegisteredState(
      statusDot,
      sectionRegister,
      sectionKeyStatus,
      sectionAddDomain,
      sectionBlocklist,
      sectionSettings,
    );
    renderBlocklist(domainList, emptyState, []);
  } catch (err) {
    showError(registerError, err instanceof Error ? err.message : 'Registration failed');
  } finally {
    if (btnRegister) btnRegister.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Add domain
// ---------------------------------------------------------------------------

async function handleAddDomain(): Promise<void> {
  clearError(addDomainError);
  const domain = inputDomain?.value.trim() ?? '';
  if (!domain) return;

  if (btnAddDomain) btnAddDomain.disabled = true;
  const trace_id = crypto.randomUUID();
  try {
    const resp = await sendMessage({ type: 'ADD_DOMAIN', domain, trace_id });
    if (!resp.ok) {
      showError(addDomainError, resp.error);
      return;
    }
    if (inputDomain) inputDomain.value = '';
    await refreshBlocklist(trace_id);
  } catch (err) {
    showError(addDomainError, err instanceof Error ? err.message : 'Failed to add domain');
  } finally {
    if (btnAddDomain) btnAddDomain.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Remove domain
// ---------------------------------------------------------------------------

async function handleRemoveDomain(domain: string): Promise<void> {
  try {
    const ceremony = await performAssertionCeremony('remove_domain', domain);
    if (ceremony === null) return;
    if ('error' in ceremony) {
      showError(addDomainError, ceremony.error);
      return;
    }

    const removeResp = await sendMessage({
      type: 'REMOVE_DOMAIN',
      domain,
      ...ceremony.result,
      trace_id: ceremony.trace_id,
    });

    if (!removeResp.ok) {
      showError(addDomainError, removeResp.error);
      return;
    }

    await refreshBlocklist(ceremony.trace_id);
  } catch (err) {
    showError(addDomainError, err instanceof Error ? err.message : 'Failed to remove domain');
  }
}

// ---------------------------------------------------------------------------
// Settings change
// ---------------------------------------------------------------------------

async function handleDurationChange(): Promise<void> {
  if (!selectDuration) return;
  const trace_id = crypto.randomUUID();
  await sendMessage({
    type: 'SET_SETTINGS',
    settings: { defaultUnlockDurationMs: Number(selectDuration.value) },
    trace_id,
  });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnRegister?.addEventListener('click', () => void handleRegister());
btnAddDomain?.addEventListener('click', () => void handleAddDomain());
inputDomain?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') void handleAddDomain();
});

domainList?.addEventListener('click', (e: MouseEvent) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.btn-delete');
  if (!btn?.dataset['domain']) return;
  btn.disabled = true;
  void handleRemoveDomain(btn.dataset['domain']).finally(() => {
    btn.disabled = false;
  });
});

selectDuration?.addEventListener('change', () => void handleDurationChange());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void init();
