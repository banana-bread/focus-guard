# Feature: Frontend Design Refresh — Shield Icon & UI Polish

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Replace the emoji shield (🛡) across popup and blocked page with a custom geometric/modern SVG shield using a light-to-dark blue gradient (#93c5fd → #1e40af). Create proper Chrome extension PNG icon files, update the manifest, and apply cohesive visual polish to both UI pages to match the refined aesthetic.

## User Story

As a Focus Guard user,
I want a polished, custom-designed extension with a proper geometric shield icon,
So that the extension looks professionally crafted and not like a prototype.

## Problem Statement

The extension shows a grey puzzle piece as its toolbar icon (no `icons` in manifest), and uses a font emoji (🛡) in the popup header and blocked page — emoji rendering is inconsistent across OS/browser, cannot be styled reliably, and looks unfinished.

## Solution Statement

Create a canonical shield SVG (geometric/modern, gradient #93c5fd → #1e40af), generate PNG icon files for Chrome, inline the SVG in HTML pages, and apply targeted CSS polish to the popup and blocked page — preserving the existing dark theme while tightening the visual language.

## Feature Metadata

**Feature Type**: Enhancement  
**Estimated Complexity**: Low-Medium  
**Primary Systems Affected**: popup, blocked page, manifest.json, vite.config.ts  
**Dependencies**: `@resvg/resvg-js` (dev, for SVG→PNG conversion)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — MUST READ BEFORE IMPLEMENTING

| File | Relevant Lines | Why |
|------|---------------|-----|
| `src/popup/popup.html` | 11 | `<span>🛡</span>` to replace with inline SVG |
| `src/blocked/blocked.html` | 11 | `<div class="shield-icon">🛡</div>` to replace |
| `src/popup/popup.css` | 1–50, 36–43 | CSS vars + `.header` rule to refine |
| `src/blocked/blocked.css` | 1–50, 41–44 | `.shield-icon` rule to update |
| `manifest.json` | all | No `icons` or `action.default_icon` — both need adding |
| `vite.config.ts` | all | `viteStaticCopy` targets — add icon PNG glob |
| `package.json` | scripts block | Add `generate-icons` script |

### New Files to Create

| File | Purpose |
|------|---------|
| `src/icons/icon.svg` | Canonical shield source; read by generate.mjs |
| `src/icons/generate.mjs` | One-shot script: SVG → 16, 32, 48, 128px PNGs |
| `src/icons/icon16.png` | Generated, committed, copied to `dist/icons/` |
| `src/icons/icon32.png` | Same |
| `src/icons/icon48.png` | Same |
| `src/icons/icon128.png` | Same |

### Relevant Documentation — SHOULD READ BEFORE IMPLEMENTING

- [@resvg/resvg-js npm](https://www.npmjs.com/package/@resvg/resvg-js)
  - Section: API usage — `new Resvg(svgStr, { fitTo: { mode: 'width', value: N } }).render().asPng()`
  - Why: Needed for SVG→PNG conversion without browser
- [Chrome MV3 manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons)
  - Why: Top-level `icons` must be PNG; recommended sizes are 16, 32, 48, 128

### Patterns to Follow

**SVG inline in HTML** — no `<img>` dependency, scales perfectly, fully styleable:
```html
<svg class="header-icon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#93c5fd"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <path d="M32 5 L52 14 L52 30 C52 46 32 60 32 60 C32 60 12 46 12 30 L12 14 Z" fill="url(#sg)"/>
</svg>
```

**viteStaticCopy pattern** — mirror existing popup/blocked entries in `vite.config.ts`:
```ts
{ src: 'src/icons/icon*.png', dest: 'icons' },
```

**Gradient ID scoping**: SVG file uses `id="g"` (file-local). Inline HTML SVGs use `id="sg"` to avoid any future ID collision on the same page.

---

## IMPLEMENTATION PLAN

### Phase 1: Icon Creation
Install dep, create canonical SVG, generate PNG files, add build script.

### Phase 2: Wiring
Update `vite.config.ts` (copy PNGs to dist) and `manifest.json` (icon fields).

### Phase 3: HTML Updates
Inline the SVG in `popup.html` and `blocked.html`, replacing emoji.

### Phase 4: CSS Polish
Refine `popup.css` and `blocked.css` — icon sizing, header gradient, glow effects.

---

## STEP-BY-STEP TASKS

Execute every task in order, top to bottom. Each task is atomic and independently testable.

---

### INSTALL `@resvg/resvg-js`

- **IMPLEMENT**: Add dev dependency for SVG→PNG rendering
- **COMMAND**: `pnpm add -D @resvg/resvg-js`
- **VALIDATE**: `node -e "import('@resvg/resvg-js').then(m => console.log('ok', Object.keys(m)))"`

---

### CREATE `src/icons/icon.svg`

- **IMPLEMENT**: Canonical geometric/modern shield. Gradient from #93c5fd (light blue) top-left to #1e40af (dark blue) bottom-right. 64×64 viewBox, no strokes, 7-point path.
- **FILE CONTENT**:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#93c5fd"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <path d="M32 5 L52 14 L52 30 C52 46 32 60 32 60 C32 60 12 46 12 30 L12 14 Z" fill="url(#g)"/>
</svg>
```
- **VALIDATE**: Open in browser — clean pentagon-like shield fading light-to-dark blue diagonally.

---

### CREATE `src/icons/generate.mjs`

- **IMPLEMENT**: Node ESM script rendering the SVG at 4 sizes to PNG files in the same directory.
- **FILE CONTENT**:
```js
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  writeFileSync(join(dir, `icon${size}.png`), resvg.render().asPng());
  console.log(`icon${size}.png ✓`);
}
```
- **VALIDATE**: `node src/icons/generate.mjs` → 4 ✓ lines, 4 PNG files created.

---

### ADD `generate-icons` to `package.json`

- **IMPLEMENT**: Add to the `scripts` object:
```json
"generate-icons": "node src/icons/generate.mjs"
```
- **VALIDATE**: `pnpm generate-icons` runs without errors.

---

### RUN icon generation

- **IMPLEMENT**: `pnpm generate-icons` — produces the 4 PNG files.
- **GOTCHA**: PNGs are committed to git (they're source assets, ~1–3 KB each). The build never needs to run this script again.
- **VALIDATE**: `ls src/icons/*.png` → 4 files; visually verify `icon16.png` and `icon128.png` in an image viewer.

---

### UPDATE `vite.config.ts`

- **IMPLEMENT**: Add a glob entry to `viteStaticCopy` targets so all icon PNGs land in `dist/icons/`. Place it alongside the existing popup/blocked copy entries.
```ts
{ src: 'src/icons/icon*.png', dest: 'icons' },
```
- **VALIDATE**: `pnpm build` → `dist/icons/` exists with 4 PNG files.

---

### UPDATE `manifest.json`

- **IMPLEMENT**: Add top-level `icons` and `action.default_icon`. Keep existing `default_popup`.
```json
"icons": {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
},
"action": {
  "default_popup": "popup/popup.html",
  "default_icon": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```
- **VALIDATE**: `pnpm build` completes; `dist/manifest.json` contains both `icons` and `action.default_icon`.

---

### UPDATE `src/popup/popup.html`

- **IMPLEMENT**: Replace `<span>🛡</span>` (line 11) with inline SVG. The `<svg>` is a direct flex child of `.header`, same position as the replaced `<span>`.
```html
<svg class="header-icon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#93c5fd"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <path d="M32 5 L52 14 L52 30 C52 46 32 60 32 60 C32 60 12 46 12 30 L12 14 Z" fill="url(#sg)"/>
</svg>
```
- **VALIDATE**: Popup shows gradient shield in header, correctly aligned with the title text.

---

### UPDATE `src/popup/popup.css`

- **IMPLEMENT**: Four targeted changes — do not touch layout or component structure.

1. Add gradient CSS vars to `:root`:
```css
--icon-gradient-start: #93c5fd;
--icon-gradient-end: #1e40af;
```

2. Size the header icon (new rule):
```css
.header-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
```

3. Update `.header` `background` property to add a subtle directional gradient:
```css
background: linear-gradient(135deg, #1e2d45 0%, var(--bg-surface) 100%);
```
(All other `.header` properties remain unchanged.)

4. Add glow ring to `.btn-primary:hover`:
```css
.btn-primary:hover {
  background: var(--accent-hover);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}
```
- **VALIDATE**: Reload popup — header has subtle blue tint, button hover shows a soft glow ring.

---

### UPDATE `src/blocked/blocked.html`

- **IMPLEMENT**: Replace `<div class="shield-icon">🛡</div>` with the same wrapper div containing an inline SVG. The `class="shield-icon"` div stays so existing CSS targeting it still applies.
```html
<div class="shield-icon">
  <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#93c5fd"/>
        <stop offset="100%" stop-color="#1e40af"/>
      </linearGradient>
    </defs>
    <path d="M32 5 L52 14 L52 30 C52 46 32 60 32 60 C32 60 12 46 12 30 L12 14 Z" fill="url(#sg)"/>
  </svg>
</div>
```
- **GOTCHA**: The SVG must have no `width`/`height` attributes — sizing is controlled by CSS on `.shield-icon`.
- **VALIDATE**: Blocked page shows the shield icon in the card center.

---

### UPDATE `src/blocked/blocked.css`

- **IMPLEMENT**: Four targeted changes.

1. Add gradient CSS vars to `:root`:
```css
--icon-gradient-start: #93c5fd;
--icon-gradient-end: #1e40af;
```

2. Replace the entire `.shield-icon` rule (was `font-size: 48px; margin-bottom: 16px`):
```css
.shield-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 20px;
}

.shield-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}
```

3. Add glow animation keyframe and apply to the SVG:
```css
@keyframes shield-glow {
  0%, 100% { filter: drop-shadow(0 4px 16px rgba(59, 130, 246, 0.35)); }
  50%       { filter: drop-shadow(0 4px 24px rgba(147, 197, 253, 0.55)); }
}

.shield-icon svg {
  animation: shield-glow 3s ease-in-out infinite;
}
```

4. Add a subtle blue accent top border to `.card` (add `border-top` alongside existing `border`):
```css
border-top: 2px solid rgba(59, 130, 246, 0.4);
```
- **VALIDATE**: Blocked page shows large shield with gentle pulsing glow; card has a blue accent at the top edge.

---

## TESTING STRATEGY

### Manual Validation (primary — visual changes have no unit tests)

| Check | Expected |
|-------|---------|
| `pnpm build` | Zero errors; `dist/icons/` has 4 PNGs |
| Load extension | Toolbar shows gradient shield (not grey puzzle piece) |
| Open popup | Header: gradient shield at ~18px, crisp, aligned |
| Extensions page | Tile: 128px shield with gradient |
| Navigate to blocked site | Large shield, glow animation, blue card border |
| Resize blocked page window | SVG scales perfectly, no blurring |

### Edge Cases

- Icon at 16px: gradient compresses to near-solid; shape reads clearly — acceptable
- Extension already forces dark theme; no OS dark mode interaction needed

---

## VALIDATION COMMANDS

Execute in pyramid order — each level gates the next.

### Level 1: Style

```bash
pnpm lint
pnpm format:check
```

### Level 2: Type Safety

```bash
pnpm typecheck
```

### Level 3: Unit Tests

```bash
pnpm test
```

### Level 4: Build

```bash
pnpm build
```
Confirm `dist/icons/icon16.png` and `dist/icons/icon128.png` exist.

### Level 5: Manual

1. Load unpacked extension from `dist/` in Brave/Chrome
2. Toolbar: confirm shield icon
3. Open popup: confirm header icon
4. Visit a blocked site: confirm large shield + glow

---

## ACCEPTANCE CRITERIA

- [ ] Toolbar shows gradient shield (not grey puzzle piece)
- [ ] Popup header: inline SVG shield, crisp at 18px, correctly aligned
- [ ] Blocked page: 72px shield with `shield-glow` animation and card blue border accent
- [ ] Extensions page tile: 128px shield
- [ ] `pnpm build` produces `dist/icons/` with 4 PNG files
- [ ] All validation commands pass with zero errors
- [ ] No regressions in popup or blocked page functionality

---

## COMPLETION CHECKLIST

- [ ] `@resvg/resvg-js` installed as dev dep
- [ ] `src/icons/icon.svg` created with correct path + gradient
- [ ] `src/icons/generate.mjs` created
- [ ] `pnpm generate-icons` ran; 4 PNG files created and committed
- [ ] `vite.config.ts` updated with icon PNG copy target
- [ ] `manifest.json` updated with `icons` and `action.default_icon`
- [ ] `popup.html` inline SVG, no emoji
- [ ] `popup.css` updated (icon rule, header gradient, button glow)
- [ ] `blocked.html` inline SVG, no emoji
- [ ] `blocked.css` updated (icon sizing, glow animation, card border)
- [ ] Manual validation checklist passed

---

## NOTES

**Why commit PNGs?** ~1–3 KB each; generated once from `icon.svg`. Keeps CI/build dependency-free.

**Gradient ID scoping**: `id="g"` in the SVG file is file-local. HTML inline SVGs use `id="sg"` to prevent future ID collisions on the same page.

**Design rationale**: Geometric path chosen for readability at 16px; diagonal gradient (#93c5fd → #1e40af) matches the mockup the user selected. Glow animation on the blocked page is design-only (3s loop, never interferes with interactions).

**Confidence score**: 9/10 for one-pass implementation success.
