/**
 * Focus Guard MV3 service worker entry point.
 *
 * Registers a typed `chrome.runtime.onMessage` listener and fans out to slice handlers.
 * All state mutations and security checks must happen here — UI contexts only send messages
 * and render responses.
 */

import { createLogger } from '@/core/logger';
import type { RequestMessage, ResponseMessage } from '@/core/messages';
import { errResponse } from '@/core/messages';

const logger = createLogger('service_worker');

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
  try {
    switch (msg.type) {
      // Slice handlers will be registered here in subsequent phases
      default: {
        logger.warn('message_unhandled', {
          type: msg.type,
          trace_id,
          fix_suggestion: 'Register a handler for this message type in service-worker.ts',
        });
        sendResponse(errResponse(`Unhandled message type: ${msg.type}`));
      }
    }
    logger.debug('message_handled', { type: msg.type, trace_id, duration_ms: Date.now() - start });
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
