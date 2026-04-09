/**
 * Focus Guard popup UI.
 *
 * Communicates with the service worker via chrome.runtime.sendMessage.
 * Uses plain console logging (not createLogger) — createLogger uses process.env.VITEST
 * which is not available in the browser context.
 */

import type { RequestMessage, ResponseMessage } from '@/core/messages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMessage(msg: RequestMessage): Promise<ResponseMessage> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: ResponseMessage) => {
      resolve(response);
    });
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function show(el: HTMLElement | null): void {
  el?.classList.remove('hidden');
}

function hide(el: HTMLElement | null): void {
  el?.classList.add('hidden');
}

function showError(el: HTMLElement | null, msg: string): void {
  if (!el) return;
  el.textContent = msg;
  show(el);
}

function clearError(el: HTMLElement | null): void {
  if (!el) return;
  el.textContent = '';
  hide(el);
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
// Render
// ---------------------------------------------------------------------------

function renderBlocklist(domains: string[]): void {
  if (!domainList) return;
  domainList.innerHTML = '';

  if (domains.length === 0) {
    show(emptyState);
    return;
  }

  hide(emptyState);
  for (const domain of domains) {
    const li = document.createElement('li');
    li.className = 'domain-item';
    li.innerHTML = `<span class="domain-name">${escapeHtml(domain)}</span>`;
    domainList.appendChild(li);
  }
}

function setRegisteredState(): void {
  statusDot?.classList.replace('unregistered', 'registered');
  hide(sectionRegister);
  show(sectionKeyStatus);
  show(sectionAddDomain);
  show(sectionBlocklist);
}

function setUnregisteredState(): void {
  statusDot?.classList.replace('registered', 'unregistered');
  show(sectionRegister);
  hide(sectionKeyStatus);
  hide(sectionAddDomain);
  hide(sectionBlocklist);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const trace_id = crypto.randomUUID();
  const statusResp = await sendMessage({ type: 'GET_CREDENTIAL_STATUS', trace_id });

  if (!statusResp.ok) {
    showError(registerError, 'Could not connect to extension. Try reopening the popup.');
    return;
  }

  const { registered } = statusResp.data as { registered: boolean };

  if (registered) {
    setRegisteredState();
    const listResp = await sendMessage({ type: 'GET_BLOCKLIST', trace_id: crypto.randomUUID() });
    if (listResp.ok) {
      renderBlocklist(listResp.data as string[]);
    }
  } else {
    setUnregisteredState();
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
        authenticatorSelection: { authenticatorAttachment: 'cross-platform' },
        attestation: 'direct',
      },
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
      trace_id: crypto.randomUUID(),
    });

    if (!registerResp.ok) {
      showError(registerError, registerResp.error);
      return;
    }

    setRegisteredState();
    renderBlocklist([]);
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

  try {
    const resp = await sendMessage({
      type: 'ADD_DOMAIN',
      domain,
      trace_id: crypto.randomUUID(),
    });

    if (!resp.ok) {
      showError(addDomainError, resp.error);
      return;
    }

    if (inputDomain) inputDomain.value = '';

    const listResp = await sendMessage({ type: 'GET_BLOCKLIST', trace_id: crypto.randomUUID() });
    if (listResp.ok) {
      renderBlocklist(listResp.data as string[]);
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
