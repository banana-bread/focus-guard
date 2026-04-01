# Focus Guard — Vibe Planning Prompt

**Project:** Rebuild "Focus Guard" — a Chrome/Brave (Chromium MV3) extension that blocks distracting websites and requires a physical hardware security key (YubiKey/FIDO2/WebAuthn) to temporarily unlock them.

**Branch:** `rewrite/vsa-typescript` (new branch off `main` in the existing `focus-guard` repo — start from scratch, do not migrate existing files)

**Why rebuild:** The existing vanilla JS version works but has a critical security bug (domains can be removed without key verification), god-file tendencies as complexity grows, and no type safety. The goal is a clean, TypeScript-first rewrite with a proper build pipeline.

**Core concept:** Friction-based self-discipline. Making impulsive access require a deliberate physical action (touching a YubiKey). Client-side only — no server, no accounts.

**Tech stack:**
- TypeScript (strict mode)
- Vite for bundling (zero runtime deps preferred, but build-time tooling is fine)
- Chromium MV3 (target: Brave, Chrome)
- No frameworks — vanilla TS for UI

**Architecture to preserve:**
- Service worker as the central trust boundary — all state mutations and security checks happen here
- `declarativeNetRequest` for blocking (block rules + temporary allow rules)
- `chrome.alarms` for re-lock timers (survives browser restarts)
- `chrome.storage.local` for all persistence
- Three contexts: service worker, popup, blocked page

**Key bugs to fix in the rewrite:**
- Removing a domain from the blocklist currently requires NO authentication — anyone can open the popup and click × to unblock any site. This must require WebAuthn verification.
- Clearing/removing the registered credential also requires no verification — same problem.

**Security model to preserve:**
- WebAuthn hardware-only enforcement: `cross-platform` attachment, transport filtering (no `internal`/`hybrid`), AAGUID allowlist, attestation verification
- Challenge-response flow lives in service worker (not the page) — challenges are single-use, 2-minute TTL, keyed by domain
- Sign counter monotonicity check (clone detection)
- Origin and rpIdHash verification

**Code quality goals:**
- Any file over ~300 lines is a refactor candidate — split by responsibility
- Typed message protocol (discriminated unions for all `chrome.runtime.sendMessage` types)
- No implicit `any`
- Clear separation between: crypto logic, storage, blocking rules, UI

**Additional features for the rewrite:**

- **Per-domain unlock timers:** Each domain has its own independent unlock session with its own expiry. Unlocking reddit.com should not affect youtube.com's lock state. The storage schema should key unlocks by domain (already partially done), but the UI and alarm system must fully treat each as independent.

- **Countdown timer on the blocked page:** When a domain is currently unlocked, the blocked page (or ideally the popup) should show a live countdown of how much time remains before it re-locks. Timer should update every second. When it hits zero, the UI should reflect the locked state without requiring a page reload.

- **Unlock duration is also per-domain:** When unlocking, the user should be able to choose the duration for that specific domain (e.g. "unlock for 15 min"), rather than only having a global default. The global setting acts as the default, but it can be overridden at unlock time.

**Out of scope for now:** multi-device sync, Firefox support, network-level (DNS) blocking
