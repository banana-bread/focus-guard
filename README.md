# Focus Guard

A Chromium MV3 extension that blocks distracting websites and requires a **physical security key** (YubiKey / FIDO2) to temporarily unlock them. Friction-based self-discipline — no server, no accounts, no runtime dependencies.

## How It Works

1. Register a hardware security key (WebAuthn, cross-platform attachment only)
2. Add domains to your blocklist — they're instantly blocked via `declarativeNetRequest`
3. To visit a blocked site, tap your security key to start a timed unlock session
4. When the timer expires, the site is re-blocked automatically

Removing domains or replacing your credential also requires a key tap.

## Dev Setup

```sh
pnpm install
pnpm build          # one-shot build
pnpm build:watch    # rebuild on change
```

## Load in Browser

1. Navigate to `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` directory
4. After rebuilds, click the reload icon on the extension card

## Validate

```sh
pnpm typecheck      # strict TypeScript check
pnpm lint           # ESLint
pnpm format:check   # Prettier
pnpm test           # Vitest unit tests
```

## Tech Stack

- TypeScript (strict mode) — zero runtime dependencies
- Vite for bundling
- Vitest for testing
- Chromium Manifest V3 APIs
- Vanilla TS for UI — no frameworks
