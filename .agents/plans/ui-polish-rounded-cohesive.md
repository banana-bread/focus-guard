# Feature: UI Polish & Cohesive Design — Rounded Corners & Elevation

The following plan is complete. Validate CSS patterns and color hierarchy against existing theme before implementing.

## Feature Description

The popup and blocked pages now have a beautiful gradient shield icon, but the rest of the UI uses sharp 6px corners and flat styling that clashes with the elegant icon. This feature softens the entire interface through increased border-radius, subtle shadows/elevation, refined color accents, and improved visual hierarchy to create a cohesive, premium aesthetic.

## User Story

As a Focus Guard user,
I want a polished, cohesive UI that matches the beautiful custom icon,
So that the extension feels intentionally designed and premium, not utilitarian.

## Problem Statement

The shield icon redesign introduced a soft, gradient-based aesthetic. However, the popup and blocked pages still use tight corners (6px), flat surfaces, and minimal color/shadow details. This creates a visual disconnect: the icon is elegant and refined, but the surrounding UI feels sharp and incomplete.

## Solution Statement

Increase border-radius to 12–16px across all interactive elements and cards, add subtle box-shadow elevation (depth), refine color accents using the blue gradient palette, and improve spacing to create visual breathing room. All changes are CSS-only — no HTML or JS modifications.

## Feature Metadata

**Feature Type**: Enhancement / UI Polish  
**Estimated Complexity**: Low  
**Primary Systems Affected**: `src/popup/popup.css`, `src/blocked/blocked.css`  
**Dependencies**: None (pure CSS)

---

## CONTEXT REFERENCES

### Relevant Codebase Files

| File | Lines | Why |
|------|-------|-----|
| `src/popup/popup.css` | 1–120 | All CSS rules for popup UI — will refine border-radius, shadows, color accents |
| `src/blocked/blocked.css` | 1–70 | All CSS rules for blocked page — will refine card styling and shadows |
| `src/popup/popup.html` | 1–82 | HTML structure (no changes needed, CSS-only) |
| `src/blocked/blocked.html` | 1–45 | HTML structure (no changes needed, CSS-only) |

### New Files to Create

None — CSS-only refactoring.

### Relevant Documentation

- [MDN CSS border-radius](https://developer.mozilla.org/en-US/docs/Web/CSS/border-radius)
  - Why: Standard for rounded corners; 12–16px is modern design norm
- [MDN CSS box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow)
  - Why: Subtle elevation (0 1px 3px rgba(0,0,0,0.2)) creates depth without distraction
- [Material Design Elevation System](https://material.io/design/environment/elevation.html)
  - Why: Reference for shadow depths; we'll use 1–2 elevations for micro-interactions

### Patterns to Follow

**Shadow Elevation (from Design System):**

The extension uses a dark theme. Shadows are subtle and tuned for dark surfaces:
- **Neutral elevation** (cards, sections): `0 1px 3px rgba(0, 0, 0, 0.3)`
- **Hover elevation** (buttons, interactive): `0 4px 12px rgba(59, 130, 246, 0.15)` (blue-tinted, subtle)
- **Accent glow** (already in icon): Uses `drop-shadow` with accent color

**Color Hierarchy:**

- Primary interactive: `var(--accent)` (#3b82f6) with hover darkening
- Secondary surfaces: `var(--bg-elevated)` with subtle blue tint on hover
- Accents: Blue gradient (#93c5fd → #1e40af) reserved for icons/special states

**Spacing Consistency (existing):**

- Section padding: 16px (keep as-is)
- Button/input padding: 8–10px vertical, 12–16px horizontal
- Gap between sections: 1px border-bottom (keep as-is)

---

## IMPLEMENTATION PLAN

### Phase 1: CSS Variables & Foundations

Add shadow and elevation CSS variables to both files' `:root` blocks. This centralizes shadow definitions for consistency and future updates.

### Phase 2: Popup Polish

Update `popup.css` with:
- Increased border-radius (6px → 12px, 8px → 16px)
- Subtle shadows on sections and inputs
- Refined hover states with glow rings
- Better spacing/visual separation

### Phase 3: Blocked Page Polish

Update `blocked.css` with:
- Increased border-radius (8px → 16px)
- Enhanced card shadow and subtle tint
- Refined button hover states
- Improved visual hierarchy

### Phase 4: Manual Validation

Load extension and verify:
- Popup sections feel "card-like" with elevation
- Blocked page card has premium appearance
- Hover states are smooth and subtle
- All corners are rounded consistently
- No layout shifts or visual regressions

---

## STEP-BY-STEP TASKS

Execute every task in order. Each task is atomic and independently testable.

---

### UPDATE `src/popup/popup.css` — Root Variables

- **IMPLEMENT**: Add shadow/tint variables to `:root` (line 17, before closing brace).
```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
--shadow-md: 0 2px 4px rgba(0, 0, 0, 0.2);
--shadow-lg: 0 4px 12px rgba(59, 130, 246, 0.15);
--bg-hover-tint: rgba(59, 130, 246, 0.05);
```
- **VALIDATE**: File saves without errors; `:root` block is syntactically valid.

---

### UPDATE `src/popup/popup.css` — Section & Input Styling

- **IMPLEMENT**: Replace `.section` rule (lines 59–62) to add subtle shadow:
```css
.section {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  border-radius: 8px;
  margin: 8px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
```
- **VALIDATE**: Popup loads; sections appear as elevated, rounded cards.

---

### UPDATE `src/popup/popup.css` — Input Field Focus State

- **IMPLEMENT**: Update `.input` (lines 100–110) — increase border-radius to 12px, add focus shadow:
```css
.input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  margin-bottom: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
```
- **VALIDATE**: Click input field; focus ring appears as soft blue glow, no hard edge.

---

### UPDATE `src/popup/popup.css` — Button Styling

- **IMPLEMENT**: Update `.btn` (lines 73–84) — increase border-radius to 8px, smooth transition:
```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
}
```
- **VALIDATE**: Buttons render with rounded corners; no visual breakage.

---

### UPDATE `src/popup/popup.css` — Domain Item Styling

- **IMPLEMENT**: Update `.domain-item` (lines 127–133) — increase border-radius to 12px, add hover elevation:
```css
.domain-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border-radius: 12px;
  transition: background 0.15s, box-shadow 0.15s;
}

.domain-item:hover {
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
```
- **VALIDATE**: Hover over a blocked domain in the list; item lifts subtly with shadow.

---

### UPDATE `src/popup/popup.css` — Key Registered Badge

- **IMPLEMENT**: Update `.key-registered-badge` (lines 163–174) — increase border-radius to 12px for consistency:
```css
.key-registered-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid var(--success);
  border-radius: 12px;
  color: var(--success);
  font-size: 13px;
  font-weight: 500;
  transition: box-shadow 0.15s;
}

.key-registered-badge:hover {
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}
```
- **VALIDATE**: Badge renders with rounded corners and subtle hover glow.

---

### UPDATE `src/popup/popup.css` — Delete Button Styling

- **IMPLEMENT**: Update `.btn-delete` (lines 197–221) — increase border-radius to 8px:
```css
.btn-delete {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 8px;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
  margin-left: 8px;
  flex-shrink: 0;
}

.btn-delete:hover {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
}
```
- **VALIDATE**: Delete icons render with rounded background on hover.

---

### UPDATE `src/blocked/blocked.css` — Root Variables

- **IMPLEMENT**: Add shadow variables to `:root` (line 10, before closing brace):
```css
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.4);
```
- **VALIDATE**: File saves without errors.

---

### UPDATE `src/blocked/blocked.css` — Card Enhancement

- **IMPLEMENT**: Update `.card` (lines 33–42) — increase border-radius to 16px, add prominent shadow:
```css
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-top: 2px solid rgba(59, 130, 246, 0.4);
  border-radius: 16px;
  padding: 40px;
  max-width: 400px;
  width: 90%;
  text-align: center;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
  transition: box-shadow 0.15s;
}

.card:hover {
  box-shadow: 0 16px 32px rgba(59, 130, 246, 0.15);
}
```
- **VALIDATE**: Blocked page card displays with pronounced shadow and rounded corners.

---

### UPDATE `src/blocked/blocked.css` — Button Styling

- **IMPLEMENT**: Update `.btn-primary` (lines 97–108) — increase border-radius to 12px, add hover elevation:
```css
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```
- **VALIDATE**: Unlock button renders with rounded corners; hover shows blue glow.

---

### UPDATE `src/blocked/blocked.css` — Select & Input Styling

- **IMPLEMENT**: Update `select` rule (lines 116–123) — increase border-radius to 12px:
```css
select {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 14px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
```
- **VALIDATE**: Duration dropdown renders with rounded corners and blue focus ring.

---

### LOAD & MANUAL TEST

- **IMPLEMENT**: Run `pnpm build`, load unpacked extension from `dist/` in Brave/Chrome.
- **VALIDATE**:
  - Popup header icon crisp, sections feel elevated with subtle shadows
  - All input fields and buttons have 12–16px rounded corners
  - Hover states show smooth blue glow/shadow transitions
  - Blocked page card is prominent, centered, with rounded corners
  - Unlock button has glow effect on hover
  - No layout shifts, visual regressions, or broken spacing
  - Extension still loads without errors

---

## TESTING STRATEGY

### Manual Validation (Primary)

| Check | Expected | Status |
|-------|---------|--------|
| Popup loads | Sections appear as elevated cards | — |
| Input focus | Blue glow ring, no hard border | — |
| Button hover | Smooth shadow/background lift | — |
| Domain hover | Subtle lift and blue tint | — |
| Blocked page | Card shadow prominent, rounded corners | — |
| Unlock button | Glow effect on hover | — |
| Resize window | No layout shifts, responsive | — |

### Edge Cases

- Small popup (340px width): Rounded corners and shadows don't overflow
- High DPI displays: Shadows remain crisp, not fuzzy
- Dark theme only: No contrast issues with new shadows

---

## VALIDATION COMMANDS

### Level 1: Syntax

```bash
pnpm lint
pnpm format:check
```

### Level 2: Build

```bash
pnpm build
```

Confirm `dist/` contains bundled CSS without errors.

### Level 3: Manual

1. Load unpacked extension from `dist/` in Brave/Chrome
2. Open popup: verify header icon, section elevation, input glow
3. Add a domain to blocklist, hover over it: verify hover state
4. Navigate to a blocked site: verify card shadow and button glow
5. Resize browser window: verify no layout breaks

---

## ACCEPTANCE CRITERIA

- [ ] All `.section` elements render as elevated cards with shadow
- [ ] All input fields have 12px border-radius and blue focus glow
- [ ] All buttons have 8–12px border-radius and smooth hover transitions
- [ ] Popup domain items show hover lift with shadow
- [ ] Blocked page card has 16px border-radius and prominent shadow
- [ ] Unlock button shows blue glow on hover
- [ ] All CSS variables added (shadow-sm, shadow-md, shadow-lg, bg-hover-tint)
- [ ] No visual regressions in layout or typography
- [ ] `pnpm build` completes without errors
- [ ] `pnpm lint` and `pnpm format:check` pass

---

## COMPLETION CHECKLIST

- [ ] `src/popup/popup.css` updated (variables, sections, inputs, buttons, badges, delete)
- [ ] `src/blocked/blocked.css` updated (variables, card, button, select)
- [ ] `pnpm build` runs cleanly
- [ ] `pnpm lint` passes
- [ ] Manual testing completed (all checks marked)
- [ ] No regressions observed
- [ ] Popup and blocked page feel premium and cohesive

---

## NOTES

**Shadow Tuning**: Shadows are kept subtle (0.1–0.3 opacity) to match the dark theme. Increasing opacity would create a "floating" effect that clashes with a modern, flat aesthetic.

**Border-radius Progression**: 6px (tight, old) → 8–12px (modern) → 16px (card/large). This creates visual hierarchy: large elements (card) are most rounded, small elements (buttons/inputs) are moderately rounded.

**Color Accents**: The blue gradient (#93c5fd → #1e40af) is reserved for the icon and special states (focus glows, hover effects). Regular elements use the existing accent color (#3b82f6).

**No HTML Changes**: All modifications are CSS-only. The DOM structure remains unchanged, ensuring no regression risk.

**Confidence Score**: 10/10 — Pure CSS refinement with minimal complexity, zero behavior changes, straightforward visual improvements.
