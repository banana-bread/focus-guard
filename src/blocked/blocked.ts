/**
 * Blocked page script.
 * Reads ?domain= and ?url= query params, shows unlock UI, then redirects to original URL on success.
 * Communicates with service worker via chrome.runtime.sendMessage.
 */

import type { RequestMessage, ResponseMessage } from '@/core/messages';

// ---------------------------------------------------------------------------
// Helpers
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

function show(el: HTMLElement | null): void {
  el?.classList.remove('hidden');
}

function hide(el: HTMLElement | null): void {
  el?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const domain = params.get('domain') ?? 'Unknown site';

// Use indexOf to avoid URLSearchParams truncating at embedded & chars in the original URL
const search = window.location.search;
const urlMarker = '&url=';
const urlIdx = search.indexOf(urlMarker);
const originalUrl = urlIdx !== -1 ? search.slice(urlIdx + urlMarker.length) : null;

const domainEl = document.getElementById('domain');
const stateLocked = document.getElementById('state-locked');
const btnUnlock = document.getElementById('btn-unlock') as HTMLButtonElement | null;
const durationSelect = document.getElementById('duration-select') as HTMLSelectElement | null;
const unlockError = document.getElementById('unlock-error');

if (domainEl) {
  domainEl.textContent = domain;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

function showLockedState(): void {
  show(stateLocked);
  if (btnUnlock) {
    btnUnlock.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Unlock flow
// ---------------------------------------------------------------------------

async function handleUnlock(): Promise<void> {
  if (!btnUnlock) return;

  btnUnlock.disabled = true;
  if (unlockError) {
    unlockError.textContent = '';
    hide(unlockError);
  }

  const durationMs = durationSelect ? parseInt(durationSelect.value, 10) : 1800000;
  const trace_id = crypto.randomUUID();

  try {
    // Step 1: Get assertion challenge
    const challengeResp = await sendMessage({
      type: 'GET_ASSERTION_CHALLENGE',
      operation: 'unlock',
      domain,
      trace_id,
    });

    if (!challengeResp.ok) {
      throw new Error(challengeResp.error);
    }

    const challengeData = challengeResp.data as {
      challenge: number[];
      credentialId: number[];
    };

    const challengeBuffer = new Uint8Array(challengeData.challenge);
    const credentialIdBuffer = new Uint8Array(challengeData.credentialId).buffer;

    // Step 2: Invoke WebAuthn
    const pkc = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuffer,
        allowCredentials: [
          {
            type: 'public-key',
            id: credentialIdBuffer,
            transports: ['usb', 'nfc', 'ble'],
          },
        ],
        userVerification: 'discouraged',
      } as PublicKeyCredentialRequestOptions,
    });

    if (!pkc || pkc.type !== 'public-key') {
      throw new Error('No assertion returned from authenticator');
    }

    const assertionResponse = (pkc as PublicKeyCredential)
      .response as AuthenticatorAssertionResponse;
    const getTransports = (assertionResponse as unknown as { getTransports?: () => string[] })
      .getTransports;
    const transport = getTransports?.()[0];

    // Step 3: Verify assertion
    const verifyResp = await sendMessage({
      type: 'VERIFY_ASSERTION',
      authenticatorData: Array.from(new Uint8Array(assertionResponse.authenticatorData)),
      clientDataJSON: Array.from(new Uint8Array(assertionResponse.clientDataJSON)),
      signature: Array.from(new Uint8Array(assertionResponse.signature)),
      ...(transport !== undefined ? { transport } : {}),
      operation: 'unlock',
      domain,
      durationMs,
      trace_id,
    });

    if (!verifyResp.ok) {
      throw new Error(verifyResp.error);
    }

    // Step 4: Redirect to original URL
    const target = originalUrl ?? `https://${domain}`;
    window.location.replace(target);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unlock failed';
    if (unlockError) {
      unlockError.textContent = message;
      show(unlockError);
    }
    btnUnlock.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const trace_id = crypto.randomUUID();
  const sessionResp = await sendMessage({
    type: 'GET_UNLOCK_SESSION',
    domain,
    trace_id,
  });

  if (sessionResp.ok && sessionResp.data !== null) {
    // Domain already unlocked — redirect away from blocked page
    window.location.replace(originalUrl ?? `https://${domain}`);
    return;
  }

  // Load default unlock duration from settings
  const settingsResp = await sendMessage({ type: 'GET_SETTINGS', trace_id });
  if (settingsResp.ok && durationSelect) {
    const settings = settingsResp.data as { defaultUnlockDurationMs: number };
    durationSelect.value = String(settings.defaultUnlockDurationMs);
  }

  showLockedState();
}

btnUnlock?.addEventListener('click', () => {
  void handleUnlock();
});

void init();
