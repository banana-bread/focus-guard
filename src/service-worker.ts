/**
 * Focus Guard MV3 service worker entry point.
 *
 * Owns all message routing — maps each message type to its slice handler.
 * All state mutations and security checks happen here or in the handlers called from here.
 * UI contexts only send messages and render responses.
 */

import { createLogger } from '@/core/logger';
import type { RequestMessage, ResponseMessage } from '@/core/messages';
import { errResponse } from '@/core/messages';
import {
  handleGetRegistrationChallenge,
  handleRegisterCredential,
  handleGetCredentialStatus,
} from '@/credential/credential.handler';
import {
  handleAddDomain,
  handleRemoveDomain,
  handleGetBlocklist,
} from '@/blocklist/blocklist.handler';
import { handleSpaNavigation } from '@/blocklist/spa-navigation-guard';
import {
  handleGetAssertionChallenge,
  handleVerifyAssertion,
  handleGetUnlockSession,
} from '@/unlock/unlock.handler';
import { endSession } from '@/unlock/unlock.service';
import { handleGetSettings, handleSetSettings } from '@/settings/settings.handler';

const logger = createLogger('service_worker');

chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name.startsWith('relock:')) {
    const domain = alarm.name.slice('relock:'.length);
    void endSession(domain, crypto.randomUUID());
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void handleSpaNavigation(details);
});

chrome.runtime.onMessage.addListener(
  (msg: RequestMessage, _sender, sendResponse: (r: ResponseMessage) => void): true => {
    const { trace_id } = msg;

    logger.debug('message_received', { type: msg.type, trace_id });

    void handleMessage(msg, sendResponse, trace_id);

    // Return true to keep the message channel open for the async response
    return true;
  },
);

async function handleMessage(
  msg: RequestMessage,
  sendResponse: (r: ResponseMessage) => void,
  trace_id: string,
): Promise<void> {
  const start = Date.now();
  let handled = true;
  try {
    switch (msg.type) {
      case 'GET_REGISTRATION_CHALLENGE':
        sendResponse(handleGetRegistrationChallenge(trace_id));
        break;
      case 'REGISTER_CREDENTIAL':
        sendResponse(await handleRegisterCredential(msg, trace_id));
        break;
      case 'GET_CREDENTIAL_STATUS':
        sendResponse(await handleGetCredentialStatus(trace_id));
        break;
      case 'ADD_DOMAIN':
        sendResponse(await handleAddDomain(msg, trace_id));
        break;
      case 'GET_BLOCKLIST':
        sendResponse(await handleGetBlocklist(trace_id));
        break;
      case 'GET_ASSERTION_CHALLENGE':
        sendResponse(await handleGetAssertionChallenge(msg, trace_id));
        break;
      case 'VERIFY_ASSERTION':
        sendResponse(await handleVerifyAssertion(msg, trace_id));
        break;
      case 'GET_UNLOCK_SESSION':
        sendResponse(await handleGetUnlockSession(msg, trace_id));
        break;
      case 'REMOVE_DOMAIN':
        sendResponse(await handleRemoveDomain(msg, trace_id));
        break;
      case 'GET_SETTINGS':
        sendResponse(await handleGetSettings(trace_id));
        break;
      case 'SET_SETTINGS':
        sendResponse(await handleSetSettings(msg, trace_id));
        break;
      default: {
        const unhandled = msg as { type: string };
        handled = false;
        logger.warn('message_unhandled', {
          type: unhandled.type,
          trace_id,
          fix_suggestion: 'Add a case for this message type in service-worker.ts',
        });
        sendResponse(errResponse(`Unhandled message type: ${unhandled.type}`));
      }
    }
    if (handled) {
      logger.debug('message_handled', {
        type: msg.type,
        trace_id,
        duration_ms: Date.now() - start,
      });
    }
  } catch (err) {
    logger.error('message_handler_threw', {
      type: msg.type,
      trace_id,
      error: err instanceof Error ? err.message : String(err),
      fix_suggestion: 'Check the slice handler for this message type for unhandled exceptions',
    });
    sendResponse(errResponse('Internal error'));
  }
}
