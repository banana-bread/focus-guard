/**
 * Focus Guard popup UI — workflow handlers and boot sequence.
 *
 * Pure helpers, render functions, and timer logic live in popup.render.ts.
 * Communicates with the service worker via chrome.runtime.sendMessage.
 */

import type { RequestMessage, ResponseMessage } from '@/core/messages';
import {
  show,
  showError,
  clearError,
  renderBlocklist,
  setRegisteredState,
  setUnregisteredState,
  attachTimers,
  startTimerInterval,
  type SessionResult,
} from './popup.render';

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function sendMessage(msg: RequestMessage): Promise<ResponseMessage> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: ResponseMessage | undefined) => {
      if (chrome.runtime.lastError !== undefined || response === undefined) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError?.message ?? 'No response from extension',
        });
        return;
      }
      resolve(response);
    });
  });
}

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

  const hasActive = sessionResults.some((r) => r !== null);
  if (!hasActive) return;

  timerInterval = startTimerInterval(domainList);
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

  const { registered } = statusResp.data as { registered: boolean };

  if (registered) {
    setRegisteredState(
      statusDot,
      sectionRegister,
      sectionKeyStatus,
      sectionAddDomain,
      sectionBlocklist,
    );
    const listResp = await sendMessage({ type: 'GET_BLOCKLIST', trace_id });
    if (listResp.ok) {
      const domains = listResp.data as string[];
      renderBlocklist(domainList, emptyState, domains);
      void initTimers(domains).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('initTimers_failed', { error: String(err) });
      });
    }
  } else {
    setUnregisteredState(
      statusDot,
      sectionRegister,
      sectionKeyStatus,
      sectionAddDomain,
      sectionBlocklist,
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
    const challengeBytes = new Uint8Array(challenge);

    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: challengeBytes,
        rp: { id: chrome.runtime.id, name: 'Focus Guard' },
        user: {
          id: userId,
          name: 'focus-guard-user',
          displayName: 'Focus Guard User',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'cross-platform',
          residentKey: 'discouraged',
          userVerification: 'discouraged',
        },
        attestation: 'direct',
        // WebAuthn L3: suppress hybrid/QR prompt, show only USB security key UI
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
    const resp = await sendMessage({
      type: 'ADD_DOMAIN',
      domain,
      trace_id,
    });

    if (!resp.ok) {
      showError(addDomainError, resp.error);
      return;
    }

    if (inputDomain) inputDomain.value = '';

    const listResp = await sendMessage({ type: 'GET_BLOCKLIST', trace_id });
    if (listResp.ok) {
      const domains = listResp.data as string[];
      renderBlocklist(domainList, emptyState, domains);
      void initTimers(domains).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('initTimers_failed', { error: String(err) });
      });
    }
  } catch (err) {
    showError(addDomainError, err instanceof Error ? err.message : 'Failed to add domain');
  } finally {
    if (btnAddDomain) btnAddDomain.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnRegister?.addEventListener('click', () => {
  void handleRegister();
});

btnAddDomain?.addEventListener('click', () => {
  void handleAddDomain();
});

inputDomain?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') void handleAddDomain();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void init();
