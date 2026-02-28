import { base64urlDecode, base64urlEncode } from './lib/webauthn.js';

const params = new URLSearchParams(window.location.search);
const domain = params.get('domain');
const domainDisplay = document.getElementById('domain-display');
const unlockBtn = document.getElementById('unlock-btn');
const statusMsg = document.getElementById('status-msg');

if (domain) {
  domainDisplay.textContent = domain;
  document.title = `${domain} — Blocked`;
} else {
  domainDisplay.textContent = 'Unknown site';
}

// Verify the domain is actually in the blocklist and a credential is registered.
// If not blocked, hide the unlock button and show an error — prevents the open-redirect
// attack where an attacker crafts a blocked.html?domain=evil.com URL.
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (!domain || !response || !response.blocklist || !response.blocklist.includes(domain)) {
    unlockBtn.style.display = 'none';
    statusMsg.className = 'status error';
    statusMsg.textContent = 'This domain is not blocked.';
    return;
  }
  if (response.credential) {
    unlockBtn.disabled = false;
  }
});

unlockBtn.addEventListener('click', async () => {
  if (!domain) return;

  unlockBtn.disabled = true;
  unlockBtn.textContent = 'Verifying…';
  statusMsg.textContent = '';

  try {
    // Fetch current state to get the registered credential
    const state = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve)
    );
    if (!state || !state.credential) {
      throw new Error('No credential registered');
    }

    // Request a single-use challenge from the service worker
    const challengeResponse = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'GET_CHALLENGE', payload: { domain } }, resolve)
    );
    if (challengeResponse && challengeResponse.error) {
      throw new Error(challengeResponse.error);
    }

    // Decode the challenge and credential ID for navigator.credentials.get()
    const challenge = base64urlDecode(challengeResponse.challenge);
    const credentialId = base64urlDecode(state.credential.credentialId);

    // Prompt the hardware key — this is the only place navigator.credentials is called
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialId,
          type: 'public-key',
          transports: state.credential.transports,
        }],
        userVerification: 'discouraged',
        timeout: 60000,
      },
    });

    const assertionResponse = assertion.response;

    // Forward the raw assertion bytes to the service worker for server-side verification
    const unlockResponse = await new Promise((resolve) =>
      chrome.runtime.sendMessage({
        type: 'UNLOCK_DOMAIN',
        payload: {
          domain,
          clientDataJSON: base64urlEncode(new Uint8Array(assertionResponse.clientDataJSON)),
          authenticatorData: base64urlEncode(new Uint8Array(assertionResponse.authenticatorData)),
          signature: base64urlEncode(new Uint8Array(assertionResponse.signature)),
        },
      }, resolve)
    );

    if (unlockResponse && unlockResponse.error) {
      throw new Error(unlockResponse.error);
    }

    // Redirect to the unlocked site
    window.location.href = `https://${domain}`;
  } catch (err) {
    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock with Security Key';
    statusMsg.className = 'status error';
    statusMsg.textContent = err.name === 'NotAllowedError'
      ? 'Verification cancelled.'
      : `Error: ${err.message}`;
  }
});
