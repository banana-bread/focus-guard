/**
 * Blocked page script.
 * Reads ?domain= and renders either the unlock UI or the countdown timer.
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

/**
 * Formats milliseconds as MM:SS.
 */
function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const domain = params.get('domain') ?? 'Unknown site';

const domainEl = document.getElementById('domain');
const stateLocked = document.getElementById('state-locked');
const stateUnlocked = document.getElementById('state-unlocked');
const btnUnlock = document.getElementById('btn-unlock') as HTMLButtonElement | null;
const durationSelect = document.getElementById('duration-select') as HTMLSelectElement | null;
const unlockError = document.getElementById('unlock-error');
const timerEl = document.getElementById('timer');

if (domainEl) {
  domainEl.textContent = domain;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

let countdownInterval: ReturnType<typeof setInterval> | null = null;

function startCountdown(expiresAt: number): void {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
  }

  const tick = (): void => {
    const remaining = expiresAt - Date.now();
    if (timerEl) {
      timerEl.textContent = formatTime(remaining);
    }
    if (remaining <= 0) {
      if (countdownInterval !== null) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      showLockedState();
    }
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function showLockedState(): void {
  show(stateLocked);
  hide(stateUnlocked);
  if (btnUnlock) {
    btnUnlock.disabled = false;
  }
}

function showUnlockedState(expiresAt: number): void {
  hide(stateLocked);
  show(stateUnlocked);
  startCountdown(expiresAt);
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
    const getTransports = (assertionResponse as unknown as { getTransports?: () => string[] }).getTransports;
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

    // Step 4: Get exact expiresAt from service worker
    const sessionResp = await sendMessage({
      type: 'GET_UNLOCK_SESSION',
      domain,
      trace_id,
    });

    if (sessionResp.ok && sessionResp.data !== null) {
      const session = sessionResp.data as { expiresAt: number };
      showUnlockedState(session.expiresAt);
    } else {
      showUnlockedState(Date.now() + durationMs);
    }
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
    const session = sessionResp.data as { expiresAt: number };
    showUnlockedState(session.expiresAt);
  } else {
    showLockedState();
  }
}

btnUnlock?.addEventListener('click', () => {
  void handleUnlock();
});

void init();
