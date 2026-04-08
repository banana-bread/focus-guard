# Focus Guard

A Chrome/Brave (Chromium MV3) extension that blocks distracting websites and requires a physical hardware security key (YubiKey/FIDO2/WebAuthn) to temporarily unlock them. Friction-based self-discipline — no server, no accounts, client-side only.

## Architecture

Vertical Slice Architecture (VSA). See `.agents/reference/vsa-patterns.md` for the full pattern reference.

- `core/` — universal infrastructure (storage abstraction, message types, config)
- `shared/` — utilities used by 3+ slices (crypto helpers, domain normalization)
- Feature slices (each self-contained):
  - `blocklist/` — add/remove domains, sync declarativeNetRequest rules
  - `unlock/` — WebAuthn challenge/assertion flow, per-domain unlock sessions
  - `settings/` — unlock duration defaults
  - `popup/` — popup UI
  - `blocked/` — blocked page UI + countdown timer

## Tech Stack

- TypeScript (strict mode, no implicit `any`)
- Vite for bundling
- No runtime dependencies
- Chromium MV3 (target: Brave, Chrome)
- Vanilla TS for UI — no frameworks

## Key Rules

- **Service worker is the trust boundary.** All state mutations and security checks happen in the service worker. UI contexts only send messages and render responses.
- **All `chrome.runtime.sendMessage` calls must use typed discriminated unions.** Define the full message protocol in `core/messages.ts`.
- **File size limit: ~300 lines.** If a file exceeds this, it's a refactor candidate — split by responsibility.
- **Removing a domain or clearing a credential requires WebAuthn verification.** No exceptions.
- **Challenges are single-use, 2-minute TTL, keyed by domain**, stored in service worker memory (not storage).

## Chrome API Patterns

**`chrome.storage.local.get` callback must be explicitly typed:**

```typescript
chrome.storage.local.get(key, (result: Record<string, unknown>) => {
  resolve(result[key] as T | undefined);
});
```

The callback parameter cannot be inferred in strict mode (`noImplicitAny`). Always annotate as `Record<string, unknown>`.

**Prefer top-level `import type` over inline `import()` type references:**

```typescript
// ✅ Correct
import type { Settings } from '@/core/storage';

// ❌ Avoid — looks like a dynamic import
| { settings: Partial<import('@/core/storage').Settings> }
```

## Security Model

- WebAuthn hardware-only: `cross-platform` attachment, transport filter (reject `internal`/`hybrid`), AAGUID allowlist, attestation verification
- Sign counter monotonicity enforced (clone detection)
- Origin and rpIdHash verified on every assertion

## Core Principles

1. **TYPE SAFETY IS NON-NEGOTIABLE** — strict mode, no implicit `any`. All functions and variables must have explicit type annotations.
2. **KISS** — prefer simple, readable solutions over clever abstractions.
3. **YAGNI** — don't build features until they're actually needed.

## Documentation Style

Use JSDoc for all exported functions, classes, and modules:

```typescript
/**
 * Verifies a WebAuthn assertion for a given domain.
 *
 * @param domain - The domain being unlocked.
 * @param assertion - The raw assertion response from the authenticator.
 * @returns Verified credential data if assertion is valid.
 * @throws {VerificationError} If rpIdHash, origin, or sign counter check fails.
 */
```

## Logging Rules

**Philosophy:** Logs are optimized for AI consumption. Include enough context for an LLM to understand and fix issues without human intervention.

### Setup

Use the shared logger from `core/logger.ts` in every file:

```typescript
import { logger } from '@/core/logger';
```

The logger wraps `console` with structured JSON output and auto-injects `context` (e.g., `service_worker`, `popup`, `blocked_page`).

### Log Levels

| Level | When to use |
|-------|-------------|
| `error` | Security failures, unrecoverable errors |
| `warn` | Recoverable problems (retry, fallback) |
| `info` | Business events, state transitions |
| `debug` | Entry/exit of complex operations, variable states |

### Required Rules (MUST)

1. **Use structured objects, never string interpolation:**

   ```typescript
   logger.info('domain_unlocked', { domain, duration_ms: 3600000, method: 'webauthn' }); // ✅
   logger.info(`Unlocked ${domain}`); // ❌
   ```

2. **Event names are `snake_case` and answer "what happened?"**
   - Good: `challenge_created`, `credential_verified`, `domain_blocked`, `unlock_session_expired`
   - Bad: `done`, `success`, `error`, `update`

3. **Always include a `trace_id`** when logging across message-passing boundaries (popup → service worker → content script). Pass it through `chrome.runtime.sendMessage` payloads.

4. **Log errors with full context:**

   ```typescript
   try {
     await verifyAssertion(assertion);
   } catch (err) {
     logger.error('assertion_verification_failed', {
       domain,
       trace_id,
       error: err instanceof Error ? err.message : String(err),
       fix_suggestion: 'Check rpIdHash and origin match; verify sign counter is monotonically increasing',
     });
     throw err;
   }
   ```

5. **Include `fix_suggestion`** on error/warn logs where the cause is diagnosable — makes logs actionable for AI debugging.

### Recommended (SHOULD)

- Log entry/exit for security-critical paths (WebAuthn flows, storage mutations)
- Log state transitions with `old_state` and `new_state`
- Log full message round-trips (request sent → received → response sent) with shared `trace_id`
- Log performance for slow operations: `duration_ms`

### Chrome Extension Context Rules

- **Always include `context`**: one of `service_worker | popup | blocked_page | content_script`
- **Always include `tab_id`** for per-tab operations (blocking, unlocking)
- **Service worker logs are ephemeral** — the SW can be killed after 30s idle. For logs that must survive restarts, persist them to `chrome.storage.local`
- **Content script logs** appear only in the page's DevTools inspector, not the extension background — pass critical events via messaging if they need to reach the service worker

### DO NOT

- **DO NOT log sensitive data:** No WebAuthn private keys, raw assertions, credentials, or tokens
- **DO NOT use string formatting:** Always use structured kwargs
- **DO NOT silently catch exceptions:** Always log with context or re-raise
- **DO NOT use vague event names**

### Common Patterns

**Message handling in service worker:**

```typescript
logger.debug('message_received', { type: msg.type, trace_id, tab_id });
// ... handle ...
logger.info('message_handled', { type: msg.type, trace_id, duration_ms });
```

**WebAuthn flow:**

```typescript
logger.info('webauthn_challenge_created', { domain, trace_id, ttl_ms: 120_000 });
// assertion step
logger.info('webauthn_assertion_verified', { domain, trace_id, sign_counter });
```

## Dev Workflow

No automated test runner configured. To test:
1. Run `vite build` (or `vite build --watch` for dev)
2. Open `brave://extensions` or `chrome://extensions`
3. Enable Developer mode → Load unpacked → select `dist/`
4. After changes, click the reload icon on the extension card
