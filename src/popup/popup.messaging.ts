/**
 * Messaging helpers for the popup UI.
 *
 * Wraps chrome.runtime.sendMessage with typed request/response and provides
 * a reusable WebAuthn assertion ceremony helper.
 */

import type { RequestMessage, ResponseMessage, AssertionOperation } from '@/core/messages';

/**
 * Sends a typed message to the service worker and returns the response.
 *
 * @param msg - The request message.
 * @returns The response from the service worker.
 */
export function sendMessage(msg: RequestMessage): Promise<ResponseMessage> {
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

/** Result of a successful WebAuthn assertion ceremony. */
export interface AssertionResult {
  authenticatorData: number[];
  clientDataJSON: number[];
  signature: number[];
  transport?: string;
}

/**
 * Runs a WebAuthn assertion ceremony: fetches a challenge from the service worker,
 * prompts the user, and returns the assertion data.
 *
 * @param operation - The assertion operation type.
 * @param domain - The domain the assertion is for.
 * @returns The assertion data, or `null` if cancelled or failed.
 */
export async function performAssertionCeremony(
  operation: AssertionOperation,
  domain: string,
): Promise<{ result: AssertionResult; trace_id: string } | { error: string } | null> {
  const trace_id = crypto.randomUUID();

  const challengeResp = await sendMessage({
    type: 'GET_ASSERTION_CHALLENGE',
    operation,
    domain,
    trace_id,
  });
  if (!challengeResp.ok) {
    return { error: challengeResp.error };
  }

  const { challenge, credentialId } = challengeResp.data as {
    challenge: number[];
    credentialId: number[];
  };

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: new Uint8Array(challenge),
      allowCredentials: [
        {
          type: 'public-key',
          id: new Uint8Array(credentialId).buffer,
          transports: ['usb', 'nfc', 'ble'],
        },
      ],
      userVerification: 'discouraged',
    } as PublicKeyCredentialRequestOptions,
  });

  if (!credential) return null;

  const pkc = credential as PublicKeyCredential;
  const response = pkc.response as AuthenticatorAssertionResponse;
  const transport = (
    response as unknown as { getTransports?: () => string[] }
  ).getTransports?.()[0];

  return {
    result: {
      authenticatorData: Array.from(new Uint8Array(response.authenticatorData)),
      clientDataJSON: Array.from(new Uint8Array(response.clientDataJSON)),
      signature: Array.from(new Uint8Array(response.signature)),
      ...(transport !== undefined ? { transport } : {}),
    },
    trace_id,
  };
}
