# Research Redesign P1-Frontend-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design-token layer (score / heat / glass / focus / display + `.t-num`) and the seven non-chart primitives of `app/src/components/research-kit/` — GlassCard, EyebrowLabel (+InfoTip), StatTile, VerdictChip, RangeSlider, EmptyState, ConsensusBar, RatingChangeList — plus the `SkeletonBlock` size contract, each with tests, so P1-Frontend-B (charts + shell) and P2 (launch modal) have a finished vocabulary to compose.

**Architecture:** Tokens are appended to the existing `app/src/styles/tokens.css` (dark `:root` + `[data-theme="oled"]` only — light-theme glass is a deliberate deferral per spec §3.2) and asserted by a Node-side regex test that also cross-checks the heat ladder against its Breadth source of truth. Every component is a plain-SVG/CSS React function component with a co-located CSS module, tokens only, no inline layout styles, and phone/tablet rules in-module. All positional math lives in exported pure functions (`positionPct`, `consensusSegments`, `actionTone`) so it is unit-testable without a DOM — the house `Sparkline.jsx` / `sparkPaths` pattern.

**Tech Stack:** React 19.2, Vite 7, CSS Modules, vitest 4 + @testing-library/react + jsdom. **Zero new dependencies** (`tippy.js` is in `package.json` but has ZERO usage anywhere in `app/src` — there is no house tippy idiom to copy, so the ⓘ affordance is hand-rolled; see Global Constraints).

## Global Constraints

Read every bullet before Task 1. These are verbatim, already-verified facts — do not re-derive them.

**Where / how to work**

- Worktree: `C:\Users\Patrick\uct-worktrees\research-redesign` (branch `feat/research-calendar-redesign`, currently clean). Spec: `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md` §2–§3.
- **PREREQUISITE (one-time, before Task 1):** this worktree has **no `app/node_modules`**. Every other worktree uses a junction to the main checkout. Run once, from any directory:
  ```
  cmd /c mklink /J "C:\Users\Patrick\uct-worktrees\research-redesign\app\node_modules" "C:\Users\Patrick\uct-dashboard\app\node_modules"
  ```
  `node_modules` is gitignored (`app/.gitignore`). **Never delete this junction.** Without it `npx vitest` fails with `Cannot find package 'vite'`.
- **Test command (verified against `app/package.json` and 58+ prior plans):** `cd app && npx vitest run <path>`. `npm test` maps to `vitest run` (whole suite). If a single file OOMs the fork pool, the house fallback is `cd app && npx vitest run --pool=threads <path>`.
- **Build command:** `cd app && npm run build` (`vite build`). Required in Task 1 and Task 6.
- Commit after every task. **Never `git add -A`** — this is a shared worktree; `git add` only the files the task names. **Do not push.** Public surfaces ship only on explicit owner approval and inside the deploy window (§9 of the spec).
- Do not touch partner-owned files: `app/src/pages/OptionsFlow.jsx`, `app/src/pages/OptionsFlow_admin.jsx`, `api/routers/schwab_router.py`, `api/routers/live_massive_router.py`, `api/massive_ws_worker.py`, `api/services/massive_processor.py`.

**Design law (spec §3)**

- **Breakpoints — only 640 and 1024 exist.** Copy these exact strings; never invent a literal (no 768/900/720/480):
  - PHONE `@media (max-width: 640px)`
  - TABLET `@media (min-width: 641px) and (max-width: 1024px)`
  - TOUCH `@media (max-width: 1024px)`
  - DESKTOP `@media (min-width: 1025px)`
- **CSS modules + tokens only. No inline layout styles.** The only permitted inline styles in this plan are *computed geometry* that cannot be a token: `style={{ left: '42%' }}` / `style={{ width: '18%' }}` on RangeSlider and ConsensusBar, and the pre-existing `style={{ width, height }}` in `Skeleton.jsx`. Everything else (padding, gap, font-size, color, radius) is a class in a `.module.css` reading `var(--…)`.
- **No emoji.** Iconography is `app/src/components/ui/UIcon.jsx` (`<UIcon name="…" size={n} />`, ~65 glyphs, gold-embossed by default, `gold={false}` for currentColor). If a glyph is missing, ADD it to the registry — Task 2 adds exactly one (`info`). Geometric text markers `▲ ▼ ◆ ★ — → ✓` are explicitly sanctioned by CLAUDE.md and are NOT emoji.
- **`.t-num` on every numeric that can change or be compared.** It is a *global* plain class (defined in `tokens.css`, which `index.css` imports) — apply it as a literal string alongside the module class: ``className={`${styles.value} t-num`}``. Verified idiom: `CommunityPage.jsx:79` uses `className="t-page-title"`.
- **Hue is never the sole channel (§3.3 normative).** Every green/red encoding also differs by position, shape, or fill: `VerdictChip` carries a per-tone glyph, `ConsensusBar` carries visible counts + 2px dividers + width, `RangeSlider` carries marker position.
- **Contrast floor (§3.2):** text <18px must read ≥4.5:1 on its *composited* background. `--text-muted` (`#8c8674`) is the dimmest ink permitted on glass. Never go dimmer.
- **Gold restraint (§3.1 normative):** `--glass-border-accent` (gold) appears only on the banner, the ONE hero widget per canvas, and the active rail item. Max one gold data-highlight per canvas; max one glow component per view. No gradient text, no text-shadow, no glowing marks on data elements. This rule must appear verbatim in `GlassCard`'s JSDoc.
- **No `backdrop-filter` in the kit.** §3.1 limits it to the modal backdrop (perf). GlassCard does not use it.
- **"Verdict" never appears in user-facing copy (§12).** The component is named `VerdictChip`; its rendered strings are supplied by callers and its JSDoc carries the ban.

**Token / prop vocabulary (fixed — later tasks depend on exact spelling)**

- New tokens (Task 1): `--score-elite|-strong|-neutral|-weak|-poor`, `--grade-a|-b|-c|-d|-f`, `--heat-g3|-g2|-g1|-a|-r1|-r2|-r3`, `--glass-surface`, `--glass-elevated`, `--glass-border-neutral`, `--glass-border-accent`, `--glass-chrome`, `--glass-inner-glow`, `--focus-ring`, `--text-display`.
- **Two tone vocabularies exist and must not be blended:**
  - `SCORE_TONES = ['elite','strong','neutral','weak','poor']` — consumed by **StatTile only**.
  - `VERDICT_TONES = ['positive','negative','caution','neutral','gold']` — the tone values accepted by **VerdictChip** and **RangeSlider**, and the return type of **RatingChangeList**'s `actionTone()`.
  Both arrays live in `app/src/components/research-kit/tones.js` (created in Task 3). Components own their own `TONE_CLASS` lookup map (so CSS-module class resolution stays local) and import from `tones.js` only what they actually need — `VerdictChip` imports `toneGlyph`; `RangeSlider` and `ConsensusBar` import nothing from it. Every consumer must fall back to its own `neutral` on an unknown value rather than throw — each task's tests assert that.
- Existing tokens you will reuse (all confirmed present in `tokens.css`): `--text-xs` 10px (11px on phone via the comfort scale — that bump is intentional), `--ls-label` 1.5px, `--space-xs/sm/md/lg/xl` 4/8/12/16/24, `--radius-sm/md/lg/xl` 4/6/8/12, `--text-muted`, `--text-bright`, `--text-heading`, `--gain/-bg/-border`, `--loss/-bg/-border`, `--warn/-bg/-border`, `--ut-gold`, `--ut-gold-dim`, `--shadow-popover`, `--z-dropdown`, `--tap-min` 44px, `--duration-fast`, `--ease-out`.

**Resolved unknowns (do not re-investigate)**

- **tippy.js has NO house idiom.** The only match for "tippy" in all of `app/src` is a comment in `pages/community/lib/tickerMention.js:2` that says *"vanilla-DOM dropdown, no tippy"*. There is no wrapper, no CSS import, no theme. The ⓘ affordance is therefore a self-contained `InfoTip` component (Task 2): a `<button>` + click-toggled `role="tooltip"` popover. **Click-toggle, not hover** — the house already learned that on touch the `mouseenter→click` ordering cancels hover tooltips (the `of-tip` `data-pin` workaround in `OptionsFlow.mobile.css`).
- **`SkeletonBlock` already has a size API:** `SkeletonBlock({ width = '100%', height = 80 })` at `app/src/components/Skeleton.jsx:7`. Task 5 **adds** an optional `size={{width, height}}` object (the §3.4 "size contract" shape) and must NOT rename or remove `width`/`height` — five live consumers pass them positionally by name (`DeskSectionSkeleton.jsx:14`, `BrokerAccountHero.jsx:297`, `TodaySurface.jsx:127-128`, `HoldingsListSkeleton.jsx:23`, and `SkeletonChart` at `Skeleton.jsx:48`).
- **The `.t-*` utilities live in `app/src/styles/tokens.css`** (lines ~289–335, `.t-page-title` … `.t-mono`), NOT in `index.css`. `.t-num` goes there, beside `.t-mono`.
- **Vitest include is the default glob** (`app/vite.config.js` `test` block sets no `include`), so `app/src/styles/tokens.test.js` is picked up automatically. Environment is `jsdom` with `globals: true`; Node APIs (`node:fs`, `node:url`) are available inside tests.
- **The 5 score hexes** currently copy-pasted in `RatingsTab.jsx:17-32` and `FundamentalSnapshot.jsx`: `#3cb868 / #7fb84e / #c9a84c / #e08a3c / #e74c3c`.
- **The heat ladder** lives at `app/src/pages/Breadth.module.css:194-200` (`.bgG3 … .bgR3`). Task 1's test parses that file and asserts the tokens match it — so a future Breadth retune fails the test instead of silently forking.

## File Structure

- `app/src/styles/tokens.css` — MODIFY: new custom properties in `:root`, glass overrides in `[data-theme="oled"]`, a deferral comment in `[data-theme="light"]`, `.t-num` utility.
- `app/src/styles/tokens.test.js` — CREATE.
- `app/src/components/ui/UIcon.jsx` — MODIFY: one added glyph (`info`).
- `app/src/components/research-kit/` — CREATE: `InfoTip.jsx(+.module.css)`, `EyebrowLabel.jsx(+.module.css)`, `GlassCard.jsx(+.module.css)`, `tones.js`, `StatTile.jsx(+.module.css)`, `VerdictChip.jsx(+.module.css)`, `RangeSlider.jsx(+.module.css)`, `EmptyState.jsx(+.module.css)`, `ConsensusBar.jsx(+.module.css)`, `RatingChangeList.jsx(+.module.css)`, `index.js`.
- `app/src/components/Skeleton.jsx` — MODIFY: `SkeletonBlock` gains `size`.
- `app/src/components/Skeleton.test.jsx` — MODIFY: add SkeletonBlock cases.
- Tests: `app/src/components/research-kit/{InfoTip,EyebrowLabel,GlassCard,StatTile,VerdictChip,RangeSlider,EmptyState,ConsensusBar,RatingChangeList}.test.jsx`.

---

### Task 1: Design tokens + `.t-num` utility

**Files:**
- Modify: `app/src/styles/tokens.css`
- Test: `app/src/styles/tokens.test.js` (create)

**Interfaces:**
- Consumes: the existing `:root`, `[data-theme="oled"]`, `[data-theme="light"]` blocks and the `.t-*` utility section in `tokens.css`; the `.bgG3….bgR3` ladder in `app/src/pages/Breadth.module.css` (read-only, as the cross-file oracle).
- Produces: CSS custom properties `--score-elite|-strong|-neutral|-weak|-poor`, `--grade-a|-b|-c|-d|-f`, `--heat-g3|-g2|-g1|-a|-r1|-r2|-r3`, `--glass-surface`, `--glass-elevated`, `--glass-border-neutral`, `--glass-border-accent`, `--glass-chrome`, `--glass-inner-glow`, `--focus-ring`, `--text-display`; global class `.t-num`. Tasks 2–6 consume all of these.

- [ ] **Step 1: Write the failing test**

Create `app/src/styles/tokens.test.js`:

```js
// app/src/styles/tokens.test.js
//
// Tokens are CSS, not JS — so this is a source-text contract test, not a render
// test. It reads the real tokens.css off disk and asserts the research-kit
// token layer (spec §3.1/§3.2) exists with the exact values the kit components
// are built against.
//
// The heat ladder is deliberately checked CROSS-FILE against its source of
// truth (Breadth.module.css .bgG3….bgR3). If someone retunes Breadth, this
// fails instead of the two silently forking.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    // Strip comments so a brace or a `--token:` mentioned in prose can never
    // be mistaken for a declaration.
    .replace(/\/\*[\s\S]*?\*\//g, '')

const TOKENS = read('./tokens.css')
const BREADTH = read('../pages/Breadth.module.css')

/** Body text of the first block whose selector matches, by brace matching. */
function block(css, selector) {
  const i = css.indexOf(selector)
  if (i === -1) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, j)
    }
  }
  throw new Error(`unterminated block: ${selector}`)
}

/** Declared value of a property inside a block body, or null. */
function decl(body, prop) {
  const re = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`)
  const m = re.exec(body)
  return m ? m[1].trim() : null
}

const squash = (s) => (s == null ? null : s.replace(/\s+/g, ''))

const ROOT = block(TOKENS, ':root')
const OLED = block(TOKENS, '[data-theme="oled"]')
const LIGHT = block(TOKENS, '[data-theme="light"]')

describe('tokens.css — research-kit score ramp (§3.1)', () => {
  it('defines the 5 score tokens with the hexes scoreColor() hardcodes today', () => {
    expect(decl(ROOT, '--score-elite')).toBe('#3cb868')
    expect(decl(ROOT, '--score-strong')).toBe('#7fb84e')
    expect(decl(ROOT, '--score-neutral')).toBe('#c9a84c')
    expect(decl(ROOT, '--score-weak')).toBe('#e08a3c')
    expect(decl(ROOT, '--score-poor')).toBe('#e74c3c')
  })

  it('aliases letter grades onto the score ramp (never a second hex ladder)', () => {
    expect(decl(ROOT, '--grade-a')).toBe('var(--score-elite)')
    expect(decl(ROOT, '--grade-b')).toBe('var(--score-strong)')
    expect(decl(ROOT, '--grade-c')).toBe('var(--score-neutral)')
    expect(decl(ROOT, '--grade-d')).toBe('var(--score-weak)')
    expect(decl(ROOT, '--grade-f')).toBe('var(--score-poor)')
  })
})

describe('tokens.css — heat tiers match the Breadth ladder (§3.1)', () => {
  const PAIRS = [
    ['--heat-g3', '.bgG3'],
    ['--heat-g2', '.bgG2'],
    ['--heat-g1', '.bgG1'],
    ['--heat-a', '.bgA'],
    ['--heat-r1', '.bgR1'],
    ['--heat-r2', '.bgR2'],
    ['--heat-r3', '.bgR3'],
  ]

  it.each(PAIRS)('%s equals Breadth %s background', (token, cls) => {
    const tokenValue = squash(decl(ROOT, token))
    const breadthValue = squash(decl(block(BREADTH, cls), 'background'))
    expect(tokenValue).not.toBeNull()
    expect(breadthValue).not.toBeNull()
    expect(tokenValue).toBe(breadthValue)
  })
})

describe('tokens.css — glass surfaces (§3.1)', () => {
  it('defines the glass surface set on the dark default', () => {
    expect(decl(ROOT, '--glass-surface')).toBe('rgba(34, 37, 30, 0.55)')
    expect(decl(ROOT, '--glass-elevated')).toBe('rgba(42, 45, 36, 0.72)')
    expect(decl(ROOT, '--glass-border-neutral')).toBe('rgba(224, 218, 200, 0.10)')
    expect(decl(ROOT, '--glass-border-accent')).toBe('rgba(201, 168, 76, 0.42)')
    expect(decl(ROOT, '--glass-inner-glow')).not.toBeNull()
  })

  it('--glass-chrome is near-opaque so pinned text never sits on translucency', () => {
    const chrome = decl(ROOT, '--glass-chrome')
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(chrome)?.[1])
    expect(Number.isFinite(alpha)).toBe(true)
    expect(alpha).toBeGreaterThanOrEqual(0.92)
  })

  it('re-states the glass surfaces for the oled theme', () => {
    expect(decl(OLED, '--glass-surface')).not.toBeNull()
    expect(decl(OLED, '--glass-elevated')).not.toBeNull()
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(decl(OLED, '--glass-chrome'))?.[1])
    expect(alpha).toBeGreaterThanOrEqual(0.92)
  })

  it('does NOT define glass on the light theme — §3.2 defers it, deliberately', () => {
    // When the post-launch app-wide token sweep (§10) adapts glass to light,
    // DELETE this test in the same commit. Until then it keeps the deferral a
    // recorded decision instead of an accidental half-migration.
    expect(/--glass-[a-z-]+\s*:/.test(LIGHT)).toBe(false)
  })
})

describe('tokens.css — focus ring + display size (§3.1/§3.2)', () => {
  it('defines --focus-ring', () => {
    expect(decl(ROOT, '--focus-ring')).not.toBeNull()
  })

  it('defines --text-display at ~40px (the 24px scale cap is insufficient)', () => {
    expect(decl(ROOT, '--text-display')).toBe('40px')
  })
})

describe('tokens.css — .t-num utility (§3.2)', () => {
  it('exists as a global class and sets tabular-nums', () => {
    const body = block(TOKENS, '.t-num')
    expect(/font-variant-numeric\s*:\s*tabular-nums/.test(body)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd app && npx vitest run src/styles/tokens.test.js
```

Expected: the file loads, then every `describe` fails. The first failures read `expected null to be '#3cb868'` (from `decl(ROOT, '--score-elite')`), and the `.t-num` case throws `selector not found: .t-num`. **Do not proceed until you see real assertion failures** — if the run errors with `Cannot find package 'vite'`, the `node_modules` junction from Global Constraints was not created.

- [ ] **Step 3: Implement**

**3a.** In `app/src/styles/tokens.css`, inside the `:root { … }` block, insert the following immediately **after** the `--tap-min: 44px;` line and **before** the closing `}` of `:root`:

```css

  /* ════════════════════════════════════════════════════════════════════════
     RESEARCH KIT (spec 2026-08-03 §3.1/§3.2) — consumed by
     components/research-kit/*. Dark + oled only; see the light-theme note.
     ════════════════════════════════════════════════════════════════════════ */

  /* Score ramp — the 5 hexes scoreColor()/letterColor() copy-pasted into
     RatingsTab.jsx and FundamentalSnapshot.jsx. One ladder, one home. */
  --score-elite: #3cb868;
  --score-strong: #7fb84e;
  --score-neutral: #c9a84c;
  --score-weak: #e08a3c;
  --score-poor: #e74c3c;

  /* Letter-grade aliases. Aliases, never a parallel hex ladder — a grade and a
     score of the same standing must be the same ink. */
  --grade-a: var(--score-elite);
  --grade-b: var(--score-strong);
  --grade-c: var(--score-neutral);
  --grade-d: var(--score-weak);
  --grade-f: var(--score-poor);

  /* Heat-grid tiers — promoted verbatim from Breadth.module.css .bgG3….bgR3.
     Dark ink = extreme, light tint = mild; the cell text stays uniform so the
     signed number always reads (§3.3). styles/tokens.test.js asserts these
     stay byte-equal to the Breadth ladder. */
  --heat-g3: rgba(10, 50, 22, 0.97);
  --heat-g2: rgba(22, 100, 48, 0.80);
  --heat-g1: rgba(74, 222, 128, 0.16);
  --heat-a: rgba(180, 130, 20, 0.32);
  --heat-r1: rgba(248, 113, 113, 0.16);
  --heat-r2: rgba(160, 25, 25, 0.80);
  --heat-r3: rgba(55, 6, 6, 0.97);

  /* Glass surfaces. --glass-border-neutral is the DEFAULT card border;
     --glass-border-accent (gold) is restricted to the banner, the ONE hero
     widget per canvas, and the active rail item (§3.1 restraint rules).
     --glass-chrome is >= .92 alpha so pinned banner/footer/rail text always
     sits on near-opaque ink. NOTE: backdrop-filter is limited to the modal
     backdrop for perf — kit components must not use it. */
  --glass-surface: rgba(34, 37, 30, 0.55);
  --glass-elevated: rgba(42, 45, 36, 0.72);
  --glass-border-neutral: rgba(224, 218, 200, 0.10);
  --glass-border-accent: rgba(201, 168, 76, 0.42);
  --glass-chrome: rgba(20, 22, 18, 0.94);
  --glass-inner-glow: inset 0 1px 0 rgba(224, 218, 200, 0.06);

  /* Focus ring for interactive elements sitting on glass — the global
     :focus-visible outline disappears against a translucent border. */
  --focus-ring: 0 0 0 2px rgba(201, 168, 76, 0.75);

  /* The composite crown needs more than the scale's 24px cap. */
  --text-display: 40px;
```

**3b.** Extend the `[data-theme="oled"]` block. Replace it entirely with:

```css
/* ── OLED Black theme ── */
[data-theme="oled"] {
  --bg: #000000;
  --bg-surface: #0a0a0a;
  --bg-elevated: #111111;
  --bg-hover: #1a1a1a;
  --border: #1e1e1e;
  --border-accent: #2a2a2a;

  /* Research-kit glass on true black: the olive tint of the dark theme reads
     as a smudge over #000, so the surfaces go neutral and slightly denser. */
  --glass-surface: rgba(17, 17, 17, 0.62);
  --glass-elevated: rgba(26, 26, 26, 0.78);
  --glass-border-neutral: rgba(255, 255, 255, 0.09);
  --glass-chrome: rgba(0, 0, 0, 0.94);
}
```

**3c.** Inside the `[data-theme="light"]` block, insert this comment immediately **after** the opening `{` line's first declaration group — concretely, place it directly **before** the `/* Neutral soft shadows for a clean white canvas (no blue cast). */` comment:

```css
  /* NO --glass-* HERE, ON PURPOSE. Spec §3.2: light-theme adaptation of the
     glass surfaces is deferred to the post-launch app-wide token sweep (§10).
     This is a recorded decision, not an omission — styles/tokens.test.js
     asserts the absence. If you are doing that sweep, add the values here AND
     delete the corresponding test in the same commit. */

```

**3d.** In the "Typography utilities" section, insert `.t-num` immediately **after** the `.t-mono { … }` rule:

```css
/* Every numeric cell/column (spec §3.2). Without it a polling dashboard
   jitters as digit widths change — the single most common tell of amateur
   fintech UI. Global (plain class name, not CSS-module) so CSS-module
   components apply it as a literal: className={`${styles.value} t-num`}. */
.t-num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/styles/tokens.test.js
```
Expected: `Test Files 1 passed`, `Tests 16 passed` (2 score + 7 heat `it.each` + 4 glass + 2 focus/display + 1 `.t-num`). The gate is **0 failed** — treat the count as a cross-check, not the pass criterion.

```
cd app && npx vitest run src/pages/Breadth.test.jsx src/components/tiles/MarketBreadth.test.jsx
```
Expected: both pass — proof the tokens.css edit did not disturb existing consumers. (If `src/pages/Breadth.test.jsx` does not exist, run `cd app && npx vitest run src/pages/breadth/` instead and expect all green.)

```
cd app && npm run build
```
Expected: `✓ built in …`, exit 0, no CSS parse errors. A stray brace in the `:root` insert shows up here, not in vitest.

- [ ] **Step 5: Commit**

```
git add app/src/styles/tokens.css app/src/styles/tokens.test.js
git commit -m "$(cat <<'EOF'
Add research-kit design tokens + .t-num utility

Spec 2026-08-03 §3.1/§3.2. Score ramp (the 5 hexes scoreColor() copy-pastes),
letter-grade aliases, the Breadth heat ladder promoted to --heat-*, glass
surfaces (dark + oled only), --focus-ring and --text-display, plus the .t-num
tabular-numerals utility beside the other .t-* globals.

tokens.test.js asserts the values as source text and cross-checks the heat
ladder against Breadth.module.css so the two can never silently fork. Light
theme deliberately gets no glass values (§3.2 deferral) and the test asserts
that absence.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: research-kit scaffold — UIcon `info` glyph, InfoTip, EyebrowLabel, GlassCard

**Files:**
- Modify: `app/src/components/ui/UIcon.jsx` (add one glyph)
- Create: `app/src/components/research-kit/InfoTip.jsx`, `InfoTip.module.css`, `EyebrowLabel.jsx`, `EyebrowLabel.module.css`, `GlassCard.jsx`, `GlassCard.module.css`, `index.js`
- Test: `app/src/components/research-kit/InfoTip.test.jsx`, `EyebrowLabel.test.jsx`, `GlassCard.test.jsx` (create)

**Interfaces:**
- Consumes: Task 1 tokens (`--glass-surface`, `--glass-elevated`, `--glass-border-neutral`, `--glass-border-accent`, `--glass-chrome`, `--glass-inner-glow`, `--focus-ring`); `UIcon` default export.
- Produces:
  - `InfoTip({ label?, text, href?, hrefLabel?='How this is computed →', className? })` — renders nothing when `text` is falsy.
  - `EyebrowLabel({ children, info?, as?='div', id?, className? })` where `info` is either a string (the plain-English line) or `{ text, href, hrefLabel }`.
  - `GlassCard({ children, accent?=false, elevated?=false, as?='section', ariaLabel?, className?, ...rest })`.
  - `app/src/components/research-kit/index.js` barrel re-exporting every kit symbol.
  - Tasks 3, 4, 6 import `EyebrowLabel` and `InfoTip`; Tasks 3–6 all extend the barrel.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/InfoTip.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InfoTip from './InfoTip'

describe('InfoTip', () => {
  it('renders nothing without text', () => {
    const { container } = render(<InfoTip label="About X" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a UIcon svg trigger, not an emoji character', () => {
    const { container } = render(<InfoTip label="About Setup Grade" text="Explains it." />)
    const btn = screen.getByRole('button', { name: 'About Setup Grade' })
    expect(btn.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2139\u24D8]/u)
  })

  it('is closed at rest and opens on click', () => {
    render(<InfoTip label="About X" text="Priced through Fri Aug 8." />)
    const btn = screen.getByRole('button', { name: 'About X' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Priced through Fri Aug 8.')
  })

  it('describes the trigger while open', () => {
    render(<InfoTip label="About X" text="Body copy." />)
    const btn = screen.getByRole('button', { name: 'About X' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })

  it('renders the methodology link only when href is given', () => {
    const { rerender } = render(<InfoTip label="A" text="Body." />)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()

    // Same component at the same position, so React preserves the open state —
    // do NOT click again here or the tip toggles shut.
    rerender(<InfoTip label="A" text="Body." href="/methodology#setup-grade" />)
    const link = screen.getByRole('link', { name: 'How this is computed →' })
    expect(link.getAttribute('href')).toBe('/methodology#setup-grade')
  })

  it('closes on Escape and on an outside click', () => {
    render(
      <div>
        <InfoTip label="A" text="Body." />
        <button type="button">elsewhere</button>
      </div>,
    )
    const btn = screen.getByRole('button', { name: 'A' })

    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(btn)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
```

Create `app/src/components/research-kit/EyebrowLabel.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EyebrowLabel from './EyebrowLabel'

describe('EyebrowLabel', () => {
  it('renders its text with the eyebrow class', () => {
    const { container } = render(<EyebrowLabel>Expected move</EyebrowLabel>)
    expect(screen.getByText('Expected move')).toBeInTheDocument()
    expect(container.firstChild.className).toMatch(/eyebrow/)
  })

  it('renders no ⓘ affordance by default', () => {
    render(<EyebrowLabel>Expected move</EyebrowLabel>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('accepts info as a plain string', () => {
    render(<EyebrowLabel info="The options-implied move through the report.">Expected move</EyebrowLabel>)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('The options-implied move through the report.')
  })

  it('accepts info as an object with a methodology href', () => {
    render(
      <EyebrowLabel info={{ text: 'Plain English.', href: '/methodology#move' }}>
        Expected move
      </EyebrowLabel>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('link').getAttribute('href')).toBe('/methodology#move')
  })

  it('labels the ⓘ trigger from the eyebrow text', () => {
    render(<EyebrowLabel info="x">Expected move</EyebrowLabel>)
    expect(screen.getByRole('button', { name: 'About Expected move' })).toBeInTheDocument()
  })

  it('honours the `as` element and forwards id + className', () => {
    const { container } = render(
      <EyebrowLabel as="h3" id="em-label" className="extra">Expected move</EyebrowLabel>,
    )
    const el = container.firstChild
    expect(el.tagName).toBe('H3')
    expect(el.id).toBe('em-label')
    expect(el.className).toMatch(/extra/)
  })
})
```

Create `app/src/components/research-kit/GlassCard.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GlassCard from './GlassCard'

describe('GlassCard', () => {
  it('renders children inside a <section> by default', () => {
    const { container } = render(<GlassCard><p>body</p></GlassCard>)
    expect(container.firstChild.tagName).toBe('SECTION')
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('wears the neutral border by default — never gold', () => {
    const { container } = render(<GlassCard>x</GlassCard>)
    expect(container.firstChild.className).toMatch(/card/)
    expect(container.firstChild.className).not.toMatch(/accent/)
  })

  it('adds the accent class only when accent is set', () => {
    const { container } = render(<GlassCard accent>x</GlassCard>)
    expect(container.firstChild.className).toMatch(/accent/)
  })

  it('adds the elevated class only when elevated is set', () => {
    const { container, rerender } = render(<GlassCard>x</GlassCard>)
    expect(container.firstChild.className).not.toMatch(/elevated/)
    rerender(<GlassCard elevated>x</GlassCard>)
    expect(container.firstChild.className).toMatch(/elevated/)
  })

  it('honours `as`, ariaLabel, className and extra DOM props', () => {
    const { container } = render(
      <GlassCard as="article" ariaLabel="Setup" className="extra" data-testid="gc">x</GlassCard>,
    )
    const el = container.firstChild
    expect(el.tagName).toBe('ARTICLE')
    expect(el.getAttribute('aria-label')).toBe('Setup')
    expect(el.className).toMatch(/extra/)
    expect(el.getAttribute('data-testid')).toBe('gc')
  })

  it('carries no inline layout styles (CSS modules only)', () => {
    const { container } = render(<GlassCard accent elevated>x</GlassCard>)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: three files fail to collect with `Failed to resolve import "./InfoTip"` / `"./EyebrowLabel"` / `"./GlassCard"` — the modules do not exist yet.

- [ ] **Step 3: Implement**

**3a.** In `app/src/components/ui/UIcon.jsx`, insert the `info` glyph immediately after the `warning` entry. Find:

```jsx
  warning: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.2M12 17.4v.2" />
    </>
  ),
```

and insert directly below it:

```jsx
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v5.4" />
      <path d="M12 7.6v.5" />
    </>
  ),
```

**3b.** Create `app/src/components/research-kit/InfoTip.jsx`:

```jsx
// app/src/components/research-kit/InfoTip.jsx
import { useEffect, useId, useRef, useState } from 'react'
import UIcon from '../ui/UIcon'
import styles from './InfoTip.module.css'

/**
 * The kit's ONE learnability affordance (spec §3.4). `EyebrowLabel` and
 * `VerdictChip` accept an optional ⓘ that opens a one-line plain-English
 * explanation plus a "How this is computed →" link to the methodology page
 * (§12). Both surfaces inherit it from here — no per-surface tooltip forks.
 *
 * CLICK-TOGGLED, NOT HOVER. On touch, the mouseenter→click ordering cancels a
 * hover-opened tip (the house already hit this in OptionsFlow's `of-tip`, which
 * needed a `data-pin` flag to survive). One interaction model, both pointers.
 *
 * NOT tippy.js: tippy is in package.json but has zero usage anywhere in
 * app/src — there is no house idiom, theme or CSS import to inherit, so this
 * is a self-contained popover. Zero new dependencies (§3.4).
 *
 * The popover paints on --glass-chrome (>= .92 alpha) so its text never sits on
 * translucency (§3.2 contrast floor).
 */
export default function InfoTip({
  label,
  text,
  href,
  hrefLabel = 'How this is computed →',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const tipId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!text) return null

  return (
    <span className={`${styles.wrap} ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label || 'What is this?'}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <UIcon name="info" size={12} gold={false} />
      </button>
      {open && (
        <span className={styles.pop} role="tooltip" id={tipId}>
          <span className={styles.popText}>{text}</span>
          {href && (
            <a className={styles.popLink} href={href} target="_blank" rel="noopener noreferrer">
              {hrefLabel}
            </a>
          )}
        </span>
      )}
    </span>
  )
}
```

**3c.** Create `app/src/components/research-kit/InfoTip.module.css`:

```css
.wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: var(--space-xs);
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.trigger:hover {
  color: var(--text-bright);
}
.trigger:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: max-content;
  max-width: 260px;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--glass-border-neutral);
  border-radius: var(--radius-lg);
  /* Near-opaque ink: tooltip copy must never sit on a translucent surface. */
  background: var(--glass-chrome);
  box-shadow: var(--shadow-popover);
  text-transform: none;
  letter-spacing: var(--ls-normal);
}

.popText {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: var(--lh-snug);
  color: var(--text-bright);
}

.popLink {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--info);
  text-decoration: none;
}
.popLink:hover {
  text-decoration: underline;
}

/* PHONE */
@media (max-width: 640px) {
  .trigger {
    width: var(--tap-min);
    height: var(--tap-min);
    margin-left: 0;
  }
  .pop {
    max-width: min(280px, calc(100vw - 32px));
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .trigger {
    width: 20px;
    height: 20px;
  }
}
```

**3d.** Create `app/src/components/research-kit/EyebrowLabel.jsx`:

```jsx
// app/src/components/research-kit/EyebrowLabel.jsx
import InfoTip from './InfoTip'
import styles from './EyebrowLabel.module.css'

/**
 * The single eyebrow idiom: 10px / 600 / --ls-label / uppercase (spec §3.2).
 * Uses --text-xs, so it lifts to 11px on phones via the token comfort scale —
 * that bump is intentional and helps the <18px contrast floor.
 *
 * Ink is --text-muted, which §3.2 declares the DIMMEST permitted on glass.
 * Never darken it further.
 *
 * `info` adds the optional ⓘ (§3.4): pass a string for a bare explanation, or
 * `{ text, href, hrefLabel }` to also link the methodology page (§12).
 */
export default function EyebrowLabel({
  children,
  info,
  as: Tag = 'div',
  id,
  className = '',
}) {
  const tip = typeof info === 'string' ? { text: info } : info || null
  const plain = typeof children === 'string' ? children : ''

  return (
    <Tag className={`${styles.eyebrow} ${className}`} id={id}>
      <span className={styles.text}>{children}</span>
      {tip?.text && (
        <InfoTip
          label={plain ? `About ${plain}` : 'What is this?'}
          text={tip.text}
          href={tip.href}
          hrefLabel={tip.hrefLabel}
        />
      )}
    </Tag>
  )
}
```

**3e.** Create `app/src/components/research-kit/EyebrowLabel.module.css`:

```css
.eyebrow {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--text-muted);
}

.text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* PHONE */
@media (max-width: 640px) {
  .text {
    white-space: normal;
  }
}
```

**3f.** Create `app/src/components/research-kit/GlassCard.jsx`:

```jsx
// app/src/components/research-kit/GlassCard.jsx
import styles from './GlassCard.module.css'

/**
 * The kit's surface primitive — the Glass Premium register (spec §2.1/§3.1).
 *
 * RESTRAINT RULES (§3.1, NORMATIVE — this is what protects "simple and clean"
 * from decoration creep):
 *   • `accent` (the gold border) appears ONLY on: the pinned banner, the ONE
 *     hero widget per canvas, and the active rail item. Nothing else.
 *   • Maximum ONE gold data-highlight per canvas.
 *   • Maximum ONE glow component per view.
 *   • No gradient text, no text-shadow, no glowing marks on data elements.
 *   • One ticking element per banner (the countdown); prices update without
 *     animation.
 * If you are about to pass `accent` to a second card in the same canvas, the
 * answer is that one of them is not the hero.
 *
 * NO backdrop-filter: §3.1 limits it to the modal backdrop (perf). The modal
 * shell itself is opaque; at most ONE translucency level inside it.
 *
 * NO `overflow: hidden` on this card — InfoTip popovers and future rail
 * flyouts are absolutely positioned children and must be able to escape.
 */
export default function GlassCard({
  children,
  accent = false,
  elevated = false,
  as: Tag = 'section',
  ariaLabel,
  className = '',
  ...rest
}) {
  const cls = [
    styles.card,
    elevated ? styles.elevated : '',
    accent ? styles.accent : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag className={cls} aria-label={ariaLabel} {...rest}>
      {children}
    </Tag>
  )
}
```

**3g.** Create `app/src/components/research-kit/GlassCard.module.css`:

```css
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 0;
  padding: var(--space-lg);
  border: 1px solid var(--glass-border-neutral);
  border-radius: var(--radius-xl);
  background: var(--glass-surface);
  box-shadow: var(--glass-inner-glow);
  /* Deliberately NOT overflow:hidden — see the component JSDoc. */
}

.elevated {
  background: var(--glass-elevated);
}

.accent {
  border-color: var(--glass-border-accent);
}

/* PHONE */
@media (max-width: 640px) {
  .card {
    gap: var(--space-sm);
    padding: var(--space-md);
    border-radius: var(--radius-lg);
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .card {
    padding: var(--space-md);
  }
}
```

**3h.** Create `app/src/components/research-kit/index.js`:

```js
// app/src/components/research-kit/index.js
//
// The research-kit barrel (spec §3.4). Both redesigned surfaces — the earnings
// modal and /research/:sym — import their vocabulary from here so "the modal is
// the page in miniature" is enforced by construction rather than by discipline.
//
// LOADING IDIOM: there is no Skeleton in this kit. Use the EXISTING
// components/Skeleton.jsx `SkeletonBlock` with its `size` contract — a second
// identically-named component is explicitly banned (§3.4).
export { default as InfoTip } from './InfoTip'
export { default as EyebrowLabel } from './EyebrowLabel'
export { default as GlassCard } from './GlassCard'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: `Test Files 3 passed`, `Tests 18 passed` (6 per file).

```
cd app && npx vitest run src/components/ui
```
Expected: green (no UIcon regressions). If that path reports "No test files found", run `cd app && npx vitest run src/components/brand/UTMark.test.jsx src/components/TileCard.test.jsx` instead and expect green.

- [ ] **Step 5: Commit**

```
git add app/src/components/ui/UIcon.jsx app/src/components/research-kit/InfoTip.jsx app/src/components/research-kit/InfoTip.module.css app/src/components/research-kit/InfoTip.test.jsx app/src/components/research-kit/EyebrowLabel.jsx app/src/components/research-kit/EyebrowLabel.module.css app/src/components/research-kit/EyebrowLabel.test.jsx app/src/components/research-kit/GlassCard.jsx app/src/components/research-kit/GlassCard.module.css app/src/components/research-kit/GlassCard.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: scaffold + InfoTip, EyebrowLabel, GlassCard

Spec 2026-08-03 §3.1/§3.2/§3.4. GlassCard defaults to the NEUTRAL border and
carries the gold-restraint rules in its JSDoc; EyebrowLabel is the one 10px/600/
uppercase eyebrow; InfoTip is the one learnability affordance.

InfoTip is hand-rolled, not tippy: tippy.js is in package.json but has zero
usage in app/src, so there is no house idiom to copy. Click-toggled rather than
hover because on touch the mouseenter->click ordering cancels hover tips. Adds
one `info` glyph to the UIcon registry (no emoji).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: tones vocabulary + StatTile + VerdictChip

**Files:**
- Create: `app/src/components/research-kit/tones.js`, `StatTile.jsx`, `StatTile.module.css`, `VerdictChip.jsx`, `VerdictChip.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/StatTile.test.jsx`, `VerdictChip.test.jsx` (create)

**Interfaces:**
- Consumes: `EyebrowLabel` (Task 2), the `.t-num` global class and the score tokens (Task 1).
- Produces:
  - `tones.js` — `SCORE_TONES`, `VERDICT_TONES`, `VERDICT_GLYPHS`, `toneGlyph(tone)`.
  - `StatTile({ label, value, sub?, tone?, info?, align?='left', className? })` — `tone` ∈ `SCORE_TONES`.
  - `VerdictChip({ label, tone?='neutral', size?='md', glyph?, info?, className? })` — `tone` ∈ `VERDICT_TONES`.
  - Tasks 4 and 6 import `VERDICT_TONES` from `tones.js`; Task 6 renders `VerdictChip size="sm"`.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/VerdictChip.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VerdictChip from './VerdictChip'
import { VERDICT_TONES, toneGlyph } from './tones'

const TONE_TABLE = [
  ['positive', 'tonePositive', '▲'],
  ['negative', 'toneNegative', '▼'],
  ['caution', 'toneCaution', '◆'],
  ['neutral', 'toneNeutral', '—'],
  ['gold', 'toneGold', '★'],
]

describe('tones vocabulary', () => {
  it('exports the five verdict tones in a fixed order', () => {
    expect(VERDICT_TONES).toEqual(['positive', 'negative', 'caution', 'neutral', 'gold'])
  })

  it('falls back to the neutral glyph for anything unknown', () => {
    expect(toneGlyph('bogus')).toBe('—')
    expect(toneGlyph(undefined)).toBe('—')
  })
})

describe('VerdictChip tone mapping', () => {
  it.each(TONE_TABLE)('tone %s applies %s and the %s glyph', (tone, cls, glyph) => {
    const { container } = render(<VerdictChip tone={tone} label="PREMIUM RICH" />)
    const chip = container.firstChild
    expect(chip.className).toMatch(new RegExp(cls))
    expect(screen.getByText('PREMIUM RICH')).toBeInTheDocument()
    expect(chip.textContent).toContain(glyph)
  })

  it('is never hue-only: every tone renders a shape glyph (§3.3)', () => {
    for (const tone of VERDICT_TONES) {
      const { container, unmount } = render(<VerdictChip tone={tone} label="X" />)
      expect(container.querySelector('[data-testid="rk-chip-glyph"]').textContent.trim()).not.toBe('')
      unmount()
    }
  })

  it('falls back to neutral on an unknown tone instead of throwing', () => {
    const { container } = render(<VerdictChip tone="chartreuse" label="X" />)
    expect(container.firstChild.className).toMatch(/toneNeutral/)
    expect(container.firstChild.textContent).toContain('—')
  })

  it('accepts a glyph override', () => {
    const { container } = render(<VerdictChip tone="positive" glyph="✓" label="BEAT" />)
    expect(container.querySelector('[data-testid="rk-chip-glyph"]').textContent).toBe('✓')
  })

  it('renders the md size by default and sm on request', () => {
    const { container, rerender } = render(<VerdictChip label="X" />)
    expect(container.firstChild.className).toMatch(/sizeMd/)
    rerender(<VerdictChip label="X" size="sm" />)
    expect(container.firstChild.className).toMatch(/sizeSm/)
  })

  it('exposes the optional ⓘ', () => {
    render(<VerdictChip label="B+ · 3 of 4 inputs" info={{ text: 'One input is unavailable.' }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('One input is unavailable.')
  })

  it('renders nothing without a label', () => {
    const { container } = render(<VerdictChip tone="positive" />)
    expect(container.firstChild).toBeNull()
  })
})
```

Create `app/src/components/research-kit/StatTile.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StatTile from './StatTile'
import { SCORE_TONES } from './tones'

describe('StatTile', () => {
  it('renders the eyebrow label and the value', () => {
    render(<StatTile label="Avg move" value="±6.2%" />)
    expect(screen.getByText('Avg move')).toBeInTheDocument()
    expect(screen.getByText('±6.2%')).toBeInTheDocument()
  })

  it('puts every value on tabular numerals (§3.2)', () => {
    const { container } = render(<StatTile label="Fwd P/E" value="34.1" />)
    expect(container.querySelector('[data-testid="rk-stat-value"]').className).toMatch(/\bt-num\b/)
  })

  it('renders the sub-line only when given', () => {
    const { rerender } = render(<StatTile label="Est" value="$0.94" />)
    expect(screen.queryByTestId('rk-stat-sub')).toBeNull()
    rerender(<StatTile label="Est" value="$0.94" sub="+4¢ / 30d" />)
    expect(screen.getByTestId('rk-stat-sub')).toHaveTextContent('+4¢ / 30d')
  })

  it.each(SCORE_TONES)('tone %s colors the value from the score ramp', (tone) => {
    const { container } = render(<StatTile label="EPS" value="90" tone={tone} />)
    const val = container.querySelector('[data-testid="rk-stat-value"]')
    expect(val.className).toMatch(new RegExp(`tone${tone[0].toUpperCase()}${tone.slice(1)}`))
  })

  it('has no tone class when tone is omitted', () => {
    const { container } = render(<StatTile label="EPS" value="90" />)
    // /tone[A-Z]/ not /tone/ — CSS-module hashes are lowercase alphanumerics,
    // so requiring the capital keeps a hash from accidentally matching.
    expect(container.querySelector('[data-testid="rk-stat-value"]').className).not.toMatch(/tone[A-Z]/)
  })

  it('falls back safely on an unknown tone', () => {
    const { container } = render(<StatTile label="EPS" value="90" tone="positive" />)
    // 'positive' belongs to VERDICT_TONES, not SCORE_TONES — must not crash and
    // must not silently pick a colour.
    expect(container.querySelector('[data-testid="rk-stat-value"]').className).not.toMatch(/tone[A-Z]/)
  })

  it('exposes the optional ⓘ through the eyebrow', () => {
    render(<StatTile label="Beta" value="1.24" info="Volatility vs the S&P 500." />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Volatility vs the S&P 500.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd app && npx vitest run src/components/research-kit/StatTile.test.jsx src/components/research-kit/VerdictChip.test.jsx
```
Expected: both files fail to collect — `Failed to resolve import "./tones"` / `"./StatTile"` / `"./VerdictChip"`.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/tones.js`:

```js
// app/src/components/research-kit/tones.js
//
// TWO tone vocabularies. They are NOT interchangeable and must never be
// blended — a StatTile is grading a SCORE, a VerdictChip is stating a SEMANTIC
// outcome. Every consumer falls back to its own neutral on an unknown value
// rather than throwing.

/** Rating/score standing. Consumed by StatTile ONLY. Maps to --score-*. */
export const SCORE_TONES = ['elite', 'strong', 'neutral', 'weak', 'poor']

/** Semantic outcome. Consumed by VerdictChip, RangeSlider, ConsensusBar and
 *  RatingChangeList. Maps to --gain / --loss / --warn / --text-muted / gold. */
export const VERDICT_TONES = ['positive', 'negative', 'caution', 'neutral', 'gold']

/**
 * Shape channel for the verdict tones. Spec §3.3 is normative: hue is NEVER
 * the only channel, so every chip carries a glyph as the redundant encoding.
 * These are geometric text markers, not emoji (CLAUDE.md sanctions ▲▼◆★ as
 * text markers; UIcon covers actual iconography).
 */
export const VERDICT_GLYPHS = {
  positive: '▲',
  negative: '▼',
  caution: '◆',
  neutral: '—',
  gold: '★',
}

/** Default glyph for a tone; unknown tones get the neutral marker. */
export function toneGlyph(tone) {
  return VERDICT_GLYPHS[tone] ?? VERDICT_GLYPHS.neutral
}
```

**3b.** Create `app/src/components/research-kit/VerdictChip.jsx`:

```jsx
// app/src/components/research-kit/VerdictChip.jsx
import InfoTip from './InfoTip'
import { VERDICT_GLYPHS, toneGlyph } from './tones'
import styles from './VerdictChip.module.css'

const TONE_CLASS = {
  positive: 'tonePositive',
  negative: 'toneNegative',
  caution: 'toneCaution',
  neutral: 'toneNeutral',
  gold: 'toneGold',
}

const SIZE_CLASS = { sm: 'sizeSm', md: 'sizeMd' }

/**
 * A short, source-labelled statement about one thing (spec §3.3/§3.4).
 *
 * ⚠️ §12, NORMATIVE: the word "verdict" must NEVER appear in user-facing copy —
 * it is advice-flavoured. The INTERNAL component name keeps `VerdictChip`; the
 * strings you pass in say "Setup Grade", "Earnings Profile", "PREMIUM RICH",
 * "RAISED", "Upgrade". Never "verdict".
 *
 * SHAPE-CODED, NOT HUE-ONLY (§3.3): each tone renders a leading glyph
 * (▲ ▼ ◆ — ★) so the meaning survives colour-blindness, greyscale print and a
 * badly calibrated monitor. Override with `glyph` when the caller has a better
 * marker (e.g. ✓ for a beat); pass `glyph={null}` only if some other channel in
 * the same row already carries the shape.
 *
 * `info` adds the optional ⓘ (§3.4) — used for the partial-basis case
 * ("B+ · 3 of 4 inputs") and to link the methodology page (§12).
 */
export default function VerdictChip({
  label,
  tone = 'neutral',
  size = 'md',
  glyph,
  info,
  className = '',
}) {
  if (label == null || label === '') return null

  const toneCls = styles[TONE_CLASS[tone] || TONE_CLASS.neutral]
  const sizeCls = styles[SIZE_CLASS[size] || SIZE_CLASS.md]
  const mark = glyph === undefined ? toneGlyph(TONE_CLASS[tone] ? tone : 'neutral') : glyph
  const tip = typeof info === 'string' ? { text: info } : info || null

  return (
    <span className={`${styles.chip} ${toneCls} ${sizeCls} ${className}`}>
      {mark != null && mark !== '' && (
        <span className={styles.glyph} data-testid="rk-chip-glyph" aria-hidden="true">
          {mark}
        </span>
      )}
      <span className={styles.label}>{label}</span>
      {tip?.text && (
        <InfoTip
          label={`About ${typeof label === 'string' ? label : 'this'}`}
          text={tip.text}
          href={tip.href}
          hrefLabel={tip.hrefLabel}
        />
      )}
    </span>
  )
}

export { VERDICT_GLYPHS }
```

**3c.** Create `app/src/components/research-kit/VerdictChip.module.css`:

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  border: 1px solid transparent;
  border-radius: 999px;
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  white-space: nowrap;
}

.sizeSm {
  padding: 2px 7px;
  font-size: var(--text-xs);
}

.sizeMd {
  padding: 4px 10px;
  font-size: var(--text-sm);
}

.glyph {
  font-size: 0.92em;
  line-height: 1;
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tonePositive {
  color: var(--gain);
  background: var(--gain-bg);
  border-color: var(--gain-border);
}

.toneNegative {
  color: var(--loss);
  background: var(--loss-bg);
  border-color: var(--loss-border);
}

.toneCaution {
  color: var(--warn);
  background: var(--warn-bg);
  border-color: var(--warn-border);
}

.toneNeutral {
  /* --text-muted is the dimmest ink permitted on glass (§3.2). */
  color: var(--text-muted);
  background: transparent;
  border-color: var(--glass-border-neutral);
}

.toneGold {
  color: var(--ut-gold);
  background: var(--ut-gold-dim);
  border-color: var(--glass-border-accent);
}

/* PHONE — the token comfort scale already lifts --text-xs/--text-sm; only the
   tap geometry needs help so a chip carrying an ⓘ stays reachable. */
@media (max-width: 640px) {
  .sizeSm {
    padding: 3px 8px;
  }
  .sizeMd {
    padding: 5px 11px;
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .label {
    max-width: 22ch;
  }
}
```

**3d.** Create `app/src/components/research-kit/StatTile.jsx`:

```jsx
// app/src/components/research-kit/StatTile.jsx
import EyebrowLabel from './EyebrowLabel'
import styles from './StatTile.module.css'

const TONE_CLASS = {
  elite: 'toneElite',
  strong: 'toneStrong',
  neutral: 'toneNeutral',
  weak: 'toneWeak',
  poor: 'tonePoor',
}

/**
 * The kit's stat primitive: label → value → optional sub-line (spec §3.2, and
 * the dataviz "numbers get hierarchy from type scale, not decoration" rule).
 * No card-in-card border, no per-stat icon, no drop shadow on data.
 *
 * `tone` takes SCORE_TONES ('elite'|'strong'|'neutral'|'weak'|'poor') and
 * colours the value from the --score-* ramp. It is for GRADES AND SCORES only.
 * It is NOT the gain/loss channel — a red *number* reads as an error state; use
 * a VerdictChip beside the tile for a semantic delta. An unrecognised tone
 * (e.g. a VERDICT_TONES value passed by mistake) renders with no tone class at
 * all rather than guessing.
 *
 * The value always wears `.t-num` — a polling surface with proportional digits
 * jitters as the numbers change (§3.2).
 */
export default function StatTile({
  label,
  value,
  sub,
  tone,
  info,
  align = 'left',
  className = '',
}) {
  const toneCls = tone ? styles[TONE_CLASS[tone]] : undefined
  const alignCls = align === 'right' ? styles.alignRight : ''

  return (
    <div className={`${styles.tile} ${alignCls} ${className}`}>
      <EyebrowLabel info={info}>{label}</EyebrowLabel>
      <div
        className={`${styles.value} ${toneCls || ''} t-num`}
        data-testid="rk-stat-value"
      >
        {value == null || value === '' ? '—' : value}
      </div>
      {sub != null && sub !== '' && (
        <div className={`${styles.sub} t-num`} data-testid="rk-stat-sub">
          {sub}
        </div>
      )}
    </div>
  )
}
```

**3e.** Create `app/src/components/research-kit/StatTile.module.css`:

```css
.tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.alignRight {
  align-items: flex-end;
  text-align: right;
}

.value {
  font-family: var(--font-sans);
  font-size: var(--text-2xl);
  font-weight: 700;
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-tight);
  color: var(--text-bright);
}

.sub {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: var(--lh-snug);
  color: var(--text-muted);
}

.toneElite {
  color: var(--score-elite);
}
.toneStrong {
  color: var(--score-strong);
}
.toneNeutral {
  color: var(--score-neutral);
}
.toneWeak {
  color: var(--score-weak);
}
.tonePoor {
  color: var(--score-poor);
}

/* PHONE */
@media (max-width: 640px) {
  .value {
    font-size: var(--text-xl);
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .value {
    font-size: var(--text-xl);
  }
}
```

**3f.** Extend `app/src/components/research-kit/index.js` — append:

```js
export { default as StatTile } from './StatTile'
export { default as VerdictChip } from './VerdictChip'
export { SCORE_TONES, VERDICT_TONES, VERDICT_GLYPHS, toneGlyph } from './tones'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: `Test Files 5 passed`, `Tests 42 passed`.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/tones.js app/src/components/research-kit/StatTile.jsx app/src/components/research-kit/StatTile.module.css app/src/components/research-kit/StatTile.test.jsx app/src/components/research-kit/VerdictChip.jsx app/src/components/research-kit/VerdictChip.module.css app/src/components/research-kit/VerdictChip.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: tones vocabulary + StatTile + VerdictChip

Spec 2026-08-03 §3.2/§3.3/§3.4/§12. tones.js fixes the two vocabularies that
must never blend: SCORE_TONES (StatTile, --score-* ramp) and VERDICT_TONES
(VerdictChip and friends). Both fall back to neutral on an unknown value rather
than throwing.

VerdictChip is shape-coded, not hue-only -- every tone renders a leading
geometric glyph so meaning survives greyscale and colour-blindness. Its JSDoc
carries the §12 ban: "verdict" never appears in user-facing copy. StatTile puts
every value on .t-num.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: RangeSlider

**Files:**
- Create: `app/src/components/research-kit/RangeSlider.jsx`, `RangeSlider.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/RangeSlider.test.jsx` (create)

**Interfaces:**
- Consumes: `EyebrowLabel` (Task 2), `VERDICT_TONES` semantics from `tones.js` (Task 3), `.t-num` (Task 1).
- Produces:
  - `RangeSlider({ min, max, value, lo, hi, loLabel, hiLabel, valueLabel, tone?='neutral', label?, info?, ariaLabel?, className? })`.
  - Exported pure functions `positionPct(min, max, v)` → `number|null` (0–100, clamped) and `labelPct(pct)` → `number|null`, plus `LABEL_EDGE_CLAMP_PCT`.
- This is the ONE slider primitive: 52-week range (§4.3.1b), analyst price-target range (§5.3 Estimates), and the expected-move dollar break-even strip (§4.3.1a) all render it with different props. Do not fork it.

**Label-collision rule (normative for this component):** the floating value label lives on its **own row above the track**, and the `loLabel`/`hiLabel` pair lives on its **own row below** — so a cross-label overlap is structurally impossible, not merely unlikely. Within the top row the label's centre is clamped to `[LABEL_EDGE_CLAMP_PCT, 100 − LABEL_EDGE_CLAMP_PCT]` (12%) so it can never overflow the track edge; in the outer 12% the label therefore sits slightly inboard of its marker, which is the intended trade (a readable label beats a pixel-exact one).

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/RangeSlider.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RangeSlider, { positionPct, labelPct, LABEL_EDGE_CLAMP_PCT } from './RangeSlider'

describe('positionPct', () => {
  it('maps the range linearly onto 0..100', () => {
    expect(positionPct(0, 100, 0)).toBe(0)
    expect(positionPct(0, 100, 50)).toBe(50)
    expect(positionPct(0, 100, 100)).toBe(100)
    expect(positionPct(91, 199, 145)).toBeCloseTo(50, 5)
  })

  it('centres a degenerate range instead of dividing by zero', () => {
    expect(positionPct(50, 50, 50)).toBe(50)
    expect(positionPct(50, 50, 999)).toBe(50)
    expect(Number.isNaN(positionPct(50, 50, 50))).toBe(false)
  })

  it('clamps a value outside the range to the nearest edge', () => {
    expect(positionPct(10, 20, 5)).toBe(0)
    expect(positionPct(10, 20, 40)).toBe(100)
  })

  it('tolerates a reversed range', () => {
    expect(positionPct(100, 0, 25)).toBe(25)
  })

  it('returns null on any non-finite input', () => {
    expect(positionPct(0, 100, NaN)).toBeNull()
    expect(positionPct(null, 100, 50)).toBeNull()
    expect(positionPct(0, undefined, 50)).toBeNull()
    expect(positionPct(0, 100, Infinity)).toBeNull()
    expect(positionPct(0, 100, '')).toBeNull()
  })

  it('accepts numeric strings', () => {
    expect(positionPct('0', '100', '25')).toBe(25)
  })
})

describe('labelPct — the collision rule', () => {
  it('clamps the floating label away from both edges', () => {
    expect(labelPct(0)).toBe(LABEL_EDGE_CLAMP_PCT)
    expect(labelPct(100)).toBe(100 - LABEL_EDGE_CLAMP_PCT)
    expect(labelPct(50)).toBe(50)
  })

  it('passes null through', () => {
    expect(labelPct(null)).toBeNull()
  })
})

describe('RangeSlider', () => {
  const base = {
    min: 91,
    max: 199,
    value: 182,
    loLabel: '$91.00',
    hiLabel: '$199.00',
    valueLabel: '$182.00',
  }

  // Percent assertions parse the number instead of string-comparing: jsdom is
  // free to normalise a long float in a style value, and the contract is the
  // position, not its decimal formatting.
  it('positions the marker at the computed percentage', () => {
    const { container } = render(<RangeSlider {...base} />)
    const marker = container.querySelector('[data-testid="rk-range-marker"]')
    expect(parseFloat(marker.style.left)).toBeCloseTo(positionPct(91, 199, 182), 4)
  })

  it('renders the end labels and the value label on separate rows', () => {
    const { container } = render(<RangeSlider {...base} />)
    expect(screen.getByText('$91.00')).toBeInTheDocument()
    expect(screen.getByText('$199.00')).toBeInTheDocument()
    const valueRow = container.querySelector('[data-testid="rk-range-valuerow"]')
    const endRow = container.querySelector('[data-testid="rk-range-endrow"]')
    expect(valueRow).not.toBeNull()
    expect(endRow).not.toBeNull()
    expect(valueRow.contains(screen.getByText('$91.00'))).toBe(false)
    expect(endRow.contains(screen.getByText('$182.00'))).toBe(false)
  })

  it('clamps the value label away from the edge when the marker is pinned', () => {
    const { container } = render(<RangeSlider {...base} value={91} valueLabel="$91.00" />)
    const label = container.querySelector('[data-testid="rk-range-valuelabel"]')
    expect(parseFloat(label.style.left)).toBeCloseTo(LABEL_EDGE_CLAMP_PCT, 4)
  })

  it('puts every label on tabular numerals', () => {
    const { container } = render(<RangeSlider {...base} />)
    for (const sel of ['rk-range-valuelabel', 'rk-range-lolabel', 'rk-range-hilabel']) {
      expect(container.querySelector(`[data-testid="${sel}"]`).className).toMatch(/\bt-num\b/)
    }
  })

  it('draws the band only when lo and hi are both finite', () => {
    const { container, rerender } = render(<RangeSlider {...base} />)
    expect(container.querySelector('[data-testid="rk-range-band"]')).toBeNull()

    rerender(<RangeSlider {...base} lo={150} hi={190} />)
    const band = container.querySelector('[data-testid="rk-range-band"]')
    expect(parseFloat(band.style.left)).toBeCloseTo(positionPct(91, 199, 150), 4)
    expect(parseFloat(band.style.width)).toBeCloseTo(
      positionPct(91, 199, 190) - positionPct(91, 199, 150),
      4,
    )
  })

  it('survives a degenerate range without NaN in the DOM', () => {
    const { container } = render(
      <RangeSlider min={50} max={50} value={50} lo={50} hi={50} valueLabel="$50.00" loLabel="$50.00" hiLabel="$50.00" />,
    )
    expect(container.innerHTML).not.toMatch(/NaN/)
    expect(parseFloat(container.querySelector('[data-testid="rk-range-marker"]').style.left)).toBe(50)
  })

  it('renders the track but no marker when value is missing', () => {
    const { container } = render(<RangeSlider min={0} max={10} loLabel="0" hiLabel="10" />)
    expect(container.querySelector('[data-testid="rk-range-track"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rk-range-marker"]')).toBeNull()
  })

  it('applies the tone class and falls back to neutral', () => {
    const { container, rerender } = render(<RangeSlider {...base} tone="gold" />)
    expect(container.querySelector('[data-testid="rk-range-marker"]').className).toMatch(/toneGold/)
    rerender(<RangeSlider {...base} tone="chartreuse" />)
    expect(container.querySelector('[data-testid="rk-range-marker"]').className).toMatch(/toneNeutral/)
  })

  it('renders an optional eyebrow with an ⓘ', () => {
    render(<RangeSlider {...base} label="52-week range" info="Where price sits in its yearly range." />)
    expect(screen.getByText('52-week range')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About 52-week range' })).toBeInTheDocument()
  })

  it('gives the track an accessible description', () => {
    const { container } = render(<RangeSlider {...base} label="52-week range" />)
    const track = container.querySelector('[data-testid="rk-range-track"]')
    expect(track.getAttribute('role')).toBe('img')
    expect(track.getAttribute('aria-label')).toContain('$182.00')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd app && npx vitest run src/components/research-kit/RangeSlider.test.jsx
```
Expected: collection error `Failed to resolve import "./RangeSlider"`.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/RangeSlider.jsx`:

```jsx
// app/src/components/research-kit/RangeSlider.jsx
import EyebrowLabel from './EyebrowLabel'
import styles from './RangeSlider.module.css'

const TONE_CLASS = {
  positive: 'tonePositive',
  negative: 'toneNegative',
  caution: 'toneCaution',
  neutral: 'toneNeutral',
  gold: 'toneGold',
}

/** Minimum distance (%) the floating value label keeps from either track end. */
export const LABEL_EDGE_CLAMP_PCT = 12

/**
 * Position of `v` on the `min…max` track, as a percentage in [0, 100].
 *
 * Pure and DOM-free so the geometry is unit-testable (the house `sparkPaths`
 * pattern). Degenerate range (min === max) centres at 50 rather than producing
 * NaN; a value outside the range clamps to the nearest edge; a reversed range
 * (min > max) is normalised. Any non-finite input returns null, and the caller
 * renders no marker rather than a marker at a lie.
 */
export function positionPct(min, max, v) {
  const a = Number(min)
  const b = Number(max)
  const x = Number(v)
  if (min === '' || max === '' || v === '' || min == null || max == null || v == null) return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(x)) return null
  if (a === b) return 50
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const pct = ((x - lo) / (hi - lo)) * 100
  return Math.max(0, Math.min(100, pct))
}

/**
 * Centre position (%) for the floating value label.
 *
 * THE COLLISION RULE: the value label lives on its own row ABOVE the track and
 * the lo/hi labels on their own row BELOW, so cross-label overlap is
 * structurally impossible. Within its row the label centre is clamped
 * LABEL_EDGE_CLAMP_PCT in from each end so it can never overflow the track. In
 * the outer 12% the label therefore sits slightly inboard of its marker — a
 * readable label beats a pixel-exact one.
 */
export function labelPct(pct) {
  if (pct == null) return null
  return Math.max(LABEL_EDGE_CLAMP_PCT, Math.min(100 - LABEL_EDGE_CLAMP_PCT, pct))
}

/**
 * The ONE slider primitive (spec §3.4). Renders the 52-week range, the analyst
 * price-target range, and the expected-move dollar break-even strip. Do not
 * fork it — parameterise it.
 *
 * Pure CSS/SVG-free geometry: a track div plus absolutely-positioned band and
 * marker. The only inline styles are the computed `left`/`width` percentages,
 * which cannot be tokens; everything else is a module class.
 *
 * Props:
 *   min, max      — the track's numeric bounds (e.g. 52-week low/high)
 *   value         — the current-price marker
 *   lo, hi        — optional highlighted sub-range (e.g. PT low..high)
 *   loLabel, hiLabel, valueLabel — display strings; all get .t-num
 *   tone          — VERDICT_TONES; colours the band + marker
 */
export default function RangeSlider({
  min,
  max,
  value,
  lo,
  hi,
  loLabel,
  hiLabel,
  valueLabel,
  tone = 'neutral',
  label,
  info,
  ariaLabel,
  className = '',
}) {
  const valuePct = positionPct(min, max, value)
  const loPct = positionPct(min, max, lo)
  const hiPct = positionPct(min, max, hi)
  const hasBand = loPct != null && hiPct != null
  const bandLeft = hasBand ? Math.min(loPct, hiPct) : 0
  const bandWidth = hasBand ? Math.abs(hiPct - loPct) : 0
  const toneCls = styles[TONE_CLASS[tone] || TONE_CLASS.neutral]
  const labelLeft = labelPct(valuePct)

  const a11y =
    ariaLabel ||
    [
      label,
      loLabel ? `low ${loLabel}` : '',
      valueLabel ? `current ${valueLabel}` : '',
      hiLabel ? `high ${hiLabel}` : '',
    ]
      .filter(Boolean)
      .join(', ')

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <div className={styles.valueRow} data-testid="rk-range-valuerow">
        {valueLabel != null && valueLabel !== '' && labelLeft != null && (
          <span
            className={`${styles.valueLabel} t-num`}
            data-testid="rk-range-valuelabel"
            style={{ left: `${labelLeft}%` }}
          >
            {valueLabel}
          </span>
        )}
      </div>

      <div className={styles.track} data-testid="rk-range-track" role="img" aria-label={a11y}>
        {hasBand && (
          <span
            className={`${styles.band} ${toneCls}`}
            data-testid="rk-range-band"
            style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
          />
        )}
        {valuePct != null && (
          <span
            className={`${styles.marker} ${toneCls}`}
            data-testid="rk-range-marker"
            style={{ left: `${valuePct}%` }}
          />
        )}
      </div>

      <div className={styles.endRow} data-testid="rk-range-endrow">
        <span className={`${styles.endLabel} t-num`} data-testid="rk-range-lolabel">
          {loLabel ?? ''}
        </span>
        <span className={`${styles.endLabel} t-num`} data-testid="rk-range-hilabel">
          {hiLabel ?? ''}
        </span>
      </div>
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/RangeSlider.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* Row 1 — the floating value label. Its own row, so it can never collide with
   the fixed end labels (see labelPct's JSDoc). */
.valueRow {
  position: relative;
  height: 15px;
}

.valueLabel {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: var(--lh-tight);
  color: var(--text-bright);
}

/* Row 2 — the track. */
.track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: var(--glass-border-neutral);
}

.band {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 999px;
  opacity: 0.55;
}

.marker {
  position: absolute;
  top: 50%;
  width: 3px;
  height: 12px;
  border-radius: 2px;
  transform: translate(-50%, -50%);
}

/* Row 3 — the fixed end labels. */
.endRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
}

.endLabel {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 400;
  line-height: var(--lh-tight);
  color: var(--text-muted);
}

.tonePositive {
  background: var(--gain);
}
.toneNegative {
  background: var(--loss);
}
.toneCaution {
  background: var(--warn);
}
.toneNeutral {
  background: var(--text-bright);
}
.toneGold {
  background: var(--ut-gold);
}

/* Band tint is always softer than the marker so the marker stays the focal
   mark; re-stating opacity here keeps the two channels distinguishable. */
.band.toneNeutral {
  background: var(--text-muted);
  opacity: 0.35;
}

/* PHONE */
@media (max-width: 640px) {
  .track {
    height: 6px;
  }
  .marker {
    width: 3px;
    height: 16px;
  }
  .valueRow {
    height: 17px;
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .track {
    height: 5px;
  }
  .marker {
    height: 14px;
  }
}
```

**3c.** Extend `app/src/components/research-kit/index.js` — append:

```js
export { default as RangeSlider, positionPct, labelPct, LABEL_EDGE_CLAMP_PCT } from './RangeSlider'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: `Test Files 6 passed`, `Tests 60 passed`.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/RangeSlider.jsx app/src/components/research-kit/RangeSlider.module.css app/src/components/research-kit/RangeSlider.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: RangeSlider (52-week / PT / expected-move strip)

Spec 2026-08-03 §3.4/§4.3.1/§5.3. One parameterised slider for all three uses.
Geometry is the exported pure fn positionPct() -- unit-tested for the degenerate
min==max case (centres at 50, never NaN), out-of-range clamping, a reversed
range and non-finite input (returns null, so no marker rather than a marker at
a lie).

Label collision is solved structurally: the floating value label owns a row
above the track, the lo/hi pair owns a row below, and labelPct() clamps the
floating label 12% in from each end so it can never overflow. All labels wear
.t-num.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: EmptyState + the SkeletonBlock size contract

**Files:**
- Create: `app/src/components/research-kit/EmptyState.jsx`, `EmptyState.module.css`
- Modify: `app/src/components/Skeleton.jsx`, `app/src/components/Skeleton.test.jsx`, `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/EmptyState.test.jsx` (create)

**Interfaces:**
- Consumes: `UIcon` (existing), Task 1 tokens.
- Produces:
  - `EmptyState({ icon?='document', title, hint?, compact?=false, action?, className? })` — the ONE empty-state idiom (§3.4). Task 6 renders it for both empty ConsensusBar and empty RatingChangeList.
  - `SkeletonBlock({ width?, height?, size? })` — `size` is `{ width, height }`, the §3.4 size contract. `size` wins when present; `width`/`height` keep their existing defaults (`'100%'` / `80`) and their existing five call sites are unchanged.

**⚠️ Do NOT create a Skeleton in `research-kit/`.** §3.4 is explicit: promote and extend the EXISTING `components/Skeleton.jsx` `SkeletonBlock` (already consumed by Desk + Journal 2.0); a second identically-named component is banned.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/EmptyState.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No transcript yet" />)
    expect(screen.getByText('No transcript yet')).toBeInTheDocument()
  })

  it('renders the hint only when given', () => {
    const { rerender } = render(<EmptyState title="No transcript yet" />)
    expect(screen.queryByTestId('rk-empty-hint')).toBeNull()
    rerender(
      <EmptyState title="No transcript yet" hint="Typically posts within 2h of the call." />,
    )
    expect(screen.getByTestId('rk-empty-hint')).toHaveTextContent(
      'Typically posts within 2h of the call.',
    )
  })

  it('draws a UIcon svg and never an emoji', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('accepts an explicit UIcon name', () => {
    const { container } = render(<EmptyState icon="search" title="No matches" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('adds the compact class only when compact is set', () => {
    const { container, rerender } = render(<EmptyState title="x" />)
    expect(container.firstChild.className).not.toMatch(/compact/)
    rerender(<EmptyState title="x" compact />)
    expect(container.firstChild.className).toMatch(/compact/)
  })

  it('renders an action node when given (e.g. a retry link)', () => {
    render(
      <EmptyState
        title="Could not load estimates"
        action={<button type="button">Retry</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('forwards className and carries no inline styles', () => {
    const { container } = render(<EmptyState title="x" className="extra" />)
    expect(container.firstChild.className).toMatch(/extra/)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })
})
```

Replace the whole of `app/src/components/Skeleton.test.jsx` with:

```jsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SkeletonLine, SkeletonCircle, SkeletonPill, SkeletonBlock, SkeletonChart } from './Skeleton'

describe('Skeleton primitives', () => {
  it('SkeletonLine renders with the given size', () => {
    const { container } = render(<SkeletonLine width="120px" height={20} />)
    const el = container.firstChild
    expect(el.style.width).toBe('120px')
    expect(el.style.height).toBe('20px')
  })

  it('SkeletonCircle renders square with circle class', () => {
    const { container } = render(<SkeletonCircle size={40} />)
    const el = container.firstChild
    expect(el.style.width).toBe('40px')
    expect(el.style.height).toBe('40px')
    expect(el.className).toMatch(/circle/)
  })

  it('SkeletonPill renders with pill class', () => {
    const { container } = render(<SkeletonPill />)
    expect(container.firstChild.className).toMatch(/pill/)
  })
})

// ── SkeletonBlock size contract (spec §3.4) ────────────────────────────────
// §3.4: "each chart component exports its rendered dimensions; SkeletonBlock
// reserves exactly that box (no layout shift on load)". The `size` prop is that
// contract. The width/height props are LOAD-BEARING for five existing call
// sites and their behaviour must not move.
describe('SkeletonBlock — existing API (regression)', () => {
  it('keeps its defaults when called bare', () => {
    const { container } = render(<SkeletonBlock />)
    const el = container.firstChild
    expect(el.className).toMatch(/block/)
    expect(el.style.width).toBe('100%')
    expect(el.style.height).toBe('80px')
  })

  it('honours the DeskSectionSkeleton call pattern: width="100%" height={150}', () => {
    const { container } = render(<SkeletonBlock width="100%" height={150} />)
    expect(container.firstChild.style.width).toBe('100%')
    expect(container.firstChild.style.height).toBe('150px')
  })

  it('honours the HoldingsListSkeleton call pattern: width="96px" height={26}', () => {
    const { container } = render(<SkeletonBlock width="96px" height={26} />)
    expect(container.firstChild.style.width).toBe('96px')
    expect(container.firstChild.style.height).toBe('26px')
  })

  it('SkeletonChart still forwards its height', () => {
    const { container } = render(<SkeletonChart height={200} />)
    expect(container.firstChild.style.width).toBe('100%')
    expect(container.firstChild.style.height).toBe('200px')
  })
})

describe('SkeletonBlock — size contract', () => {
  it('reserves exactly the box a size contract declares', () => {
    const CHART_SIZE = { width: '100%', height: 220 }
    const { container } = render(<SkeletonBlock size={CHART_SIZE} />)
    expect(container.firstChild.style.width).toBe('100%')
    expect(container.firstChild.style.height).toBe('220px')
  })

  it('lets size win over width/height when both are passed', () => {
    const { container } = render(
      <SkeletonBlock width="10px" height={10} size={{ width: '300px', height: 90 }} />,
    )
    expect(container.firstChild.style.width).toBe('300px')
    expect(container.firstChild.style.height).toBe('90px')
  })

  it('falls back per-axis when a size contract is partial', () => {
    const { container } = render(<SkeletonBlock height={44} size={{ width: '250px' }} />)
    expect(container.firstChild.style.width).toBe('250px')
    expect(container.firstChild.style.height).toBe('44px')
  })

  it('ignores a null size', () => {
    const { container } = render(<SkeletonBlock size={null} width="70px" height={12} />)
    expect(container.firstChild.style.width).toBe('70px')
    expect(container.firstChild.style.height).toBe('12px')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd app && npx vitest run src/components/research-kit/EmptyState.test.jsx src/components/Skeleton.test.jsx
```
Expected: `EmptyState.test.jsx` fails to collect (`Failed to resolve import "./EmptyState"`). `Skeleton.test.jsx` collects but the four "size contract" cases fail — `expected '' to be '300px'` / `expected '80px' to be '220px'` — because `size` is not a recognised prop yet. The three "existing API (regression)" cases must ALREADY pass at this step; if they do not, the test itself is wrong, not the code.

- [ ] **Step 3: Implement**

**3a.** In `app/src/components/Skeleton.jsx`, replace lines 7–9 (the whole `SkeletonBlock` function) with:

```jsx
/**
 * Loading box. THE size-contract primitive (spec §3.4): chart components export
 * their rendered dimensions and hand them here as `size`, so the skeleton
 * reserves exactly that box and there is zero layout shift on load, e.g.
 *
 *   // LollipopChart.jsx
 *   export const SIZE = { width: '100%', height: 220 }
 *   // consumer
 *   {isLoading ? <SkeletonBlock size={LollipopChart.SIZE} /> : <LollipopChart … />}
 *
 * `width`/`height` are unchanged and still the primary API for the five
 * existing call sites (Desk, Journal 2.0, SkeletonChart); `size` simply wins
 * per-axis when it supplies that axis. Do NOT create a second SkeletonBlock in
 * research-kit — §3.4 promotes THIS one.
 */
export function SkeletonBlock({ width, height, size }) {
  const w = size?.width ?? width ?? '100%'
  const h = size?.height ?? height ?? 80
  return <div className={styles.block} style={{ width: w, height: h }} />
}
```

**3b.** Create `app/src/components/research-kit/EmptyState.jsx`:

```jsx
// app/src/components/research-kit/EmptyState.jsx
import UIcon from '../ui/UIcon'
import styles from './EmptyState.module.css'

/**
 * THE empty-state idiom (spec §3.4) — one component, both surfaces. The old
 * research page used five different idioms for "nothing here" (spinner box,
 * a 280px `.soon` block, `.fnote` text, skeleton rows, an ellipsis); this
 * replaces all of them.
 *
 * Copy rule (§4.4): the title says what is missing, the hint says WHEN it will
 * arrive or what to do — "No transcript yet" / "Typically posts within 2h of
 * the call." Never a bare "No data".
 *
 * `action` is for the fetch-failure case: §4.4 requires a failed section to
 * render with a retry link rather than a blank canvas.
 *
 * Iconography is UIcon — no emoji, ever (see the icon names in
 * components/ui/UIcon.jsx; 'document', 'search', 'clock', 'warning', 'chart'
 * and 'noEntry' are the useful ones here).
 */
export default function EmptyState({
  icon = 'document',
  title,
  hint,
  compact = false,
  action,
  className = '',
}) {
  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''} ${className}`}>
      <UIcon name={icon} size={compact ? 16 : 22} className={styles.icon} />
      <div className={styles.title} data-testid="rk-empty-title">
        {title}
      </div>
      {hint != null && hint !== '' && (
        <div className={styles.hint} data-testid="rk-empty-hint">
          {hint}
        </div>
      )}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
```

**3c.** Create `app/src/components/research-kit/EmptyState.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-xl) var(--space-lg);
  text-align: center;
}

.compact {
  gap: var(--space-xs);
  padding: var(--space-md) var(--space-sm);
}

.icon {
  opacity: 0.55;
}

.title {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  font-weight: 600;
  line-height: var(--lh-tight);
  color: var(--text-bright);
}

.compact .title {
  font-size: var(--text-base);
}

.hint {
  max-width: 42ch;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: var(--lh-snug);
  color: var(--text-muted);
}

.action {
  margin-top: var(--space-xs);
}

/* PHONE */
@media (max-width: 640px) {
  .wrap {
    padding: var(--space-lg) var(--space-md);
  }
  .hint {
    max-width: none;
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .wrap {
    padding: var(--space-lg) var(--space-md);
  }
}
```

**3d.** Extend `app/src/components/research-kit/index.js` — append:

```js
export { default as EmptyState } from './EmptyState'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/ src/components/Skeleton.test.jsx
```
Expected: `Test Files 8 passed`, `Tests 78 passed`.

```
cd app && npx vitest run src/pages/desk src/pages/journal-2-0/components
```
Expected: green — proof the `SkeletonBlock` change did not disturb its live consumers (`DeskSectionSkeleton`, `BrokerAccountHero`, `HoldingsListSkeleton`).

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/EmptyState.jsx app/src/components/research-kit/EmptyState.module.css app/src/components/research-kit/EmptyState.test.jsx app/src/components/Skeleton.jsx app/src/components/Skeleton.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: EmptyState + SkeletonBlock size contract

Spec 2026-08-03 §3.4/§4.4. EmptyState is the ONE empty-state idiom, replacing
the five the research page used; icon via UIcon (no emoji), optional hint and
retry action.

SkeletonBlock gains the §3.4 size contract as an optional size={{width,height}}
prop so a chart can hand over its own rendered box and load with zero layout
shift. width/height are untouched and the five existing call sites are pinned by
regression tests. Deliberately NOT a second SkeletonBlock in research-kit --
§3.4 promotes the existing one.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: ConsensusBar + RatingChangeList

**Files:**
- Create: `app/src/components/research-kit/ConsensusBar.jsx`, `ConsensusBar.module.css`, `RatingChangeList.jsx`, `RatingChangeList.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/ConsensusBar.test.jsx`, `RatingChangeList.test.jsx` (create)

**Interfaces:**
- Consumes: `EyebrowLabel` (Task 2), `VerdictChip` + `VERDICT_TONES` (Task 3), `EmptyState` (Task 5), `.t-num` (Task 1).
- Produces:
  - `ConsensusBar({ buy, hold, sell, compact?=false, label?, info?, className? })` + exported `consensusSegments(buy, hold, sell)` → `[{key, count, pct}] | null` and `LABEL_MIN_PCT`.
  - `RatingChangeList({ rows, cap?=5, label?, info?, className? })` where `rows` is `[{ date, firm, from, to, action, pt }]`, plus exported `actionTone(action)` → a `VERDICT_TONES` value.
- `RatingChangeList` is **the ONE rendering** that replaces today's three variants: `AnalystPanel.ActionRow`, `CallRecapSection.RatingChanges`, and `EstimatesTab.rcrow`. P2/P3 point all three at it; do not add a fourth.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/ConsensusBar.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConsensusBar, { consensusSegments, LABEL_MIN_PCT } from './ConsensusBar'

describe('consensusSegments', () => {
  it('returns width percentages that sum to 100', () => {
    const segs = consensusSegments(37, 8, 1)
    const total = segs.reduce((a, s) => a + s.pct, 0)
    expect(segs.map((s) => s.key)).toEqual(['buy', 'hold', 'sell'])
    expect(total).toBeCloseTo(100, 6)
    expect(segs[0].count).toBe(37)
    expect(segs[0].pct).toBeCloseTo((37 / 46) * 100, 6)
  })

  it('returns null when there is no coverage at all', () => {
    expect(consensusSegments(0, 0, 0)).toBeNull()
    expect(consensusSegments(null, undefined, '')).toBeNull()
  })

  it('coerces junk to zero rather than producing NaN', () => {
    const segs = consensusSegments('12', 'abc', -5)
    expect(segs.map((s) => s.count)).toEqual([12, 0, 0])
    expect(segs[0].pct).toBe(100)
  })

  it('handles a single-sided consensus', () => {
    const segs = consensusSegments(0, 0, 3)
    expect(segs[2].pct).toBe(100)
    expect(segs[0].pct).toBe(0)
  })
})

describe('ConsensusBar', () => {
  // Percent assertions parse the number rather than string-comparing a float.
  it('renders one segment per non-empty bucket, width-encoded', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    const buy = container.querySelector('[data-testid="rk-seg-buy"]')
    expect(parseFloat(buy.style.width)).toBeCloseTo((37 / 46) * 100, 4)
    expect(container.querySelector('[data-testid="rk-seg-hold"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rk-seg-sell"]')).not.toBeNull()
  })

  it('omits a zero-count segment entirely', () => {
    const { container } = render(<ConsensusBar buy={5} hold={0} sell={0} />)
    expect(container.querySelector('[data-testid="rk-seg-hold"]')).toBeNull()
    expect(parseFloat(container.querySelector('[data-testid="rk-seg-buy"]').style.width)).toBe(100)
  })

  it('is never hue-only: the counts are always visible in the legend (§3.3)', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    const legend = container.querySelector('[data-testid="rk-consensus-legend"]')
    expect(legend.textContent).toContain('37')
    expect(legend.textContent).toContain('8')
    expect(legend.textContent).toContain('1')
  })

  it('drops the in-segment count when the segment is too narrow to hold it', () => {
    // sell = 1 of 46 ≈ 2.2% — below LABEL_MIN_PCT, so no in-segment label.
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    expect(LABEL_MIN_PCT).toBe(12)
    expect(
      container.querySelector('[data-testid="rk-seg-sell"] [data-testid="rk-seg-count"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="rk-seg-buy"] [data-testid="rk-seg-count"]'),
    ).not.toBeNull()
  })

  it('puts the legend counts on tabular numerals', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    for (const el of container.querySelectorAll('[data-testid="rk-legend-count"]')) {
      expect(el.className).toMatch(/\bt-num\b/)
    }
  })

  it('describes the whole bar for assistive tech', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    const track = container.querySelector('[data-testid="rk-consensus-track"]')
    expect(track.getAttribute('role')).toBe('img')
    expect(track.getAttribute('aria-label')).toBe('Analyst consensus: 37 buy, 8 hold, 1 sell')
  })

  it('falls back to the kit EmptyState when there is no coverage', () => {
    render(<ConsensusBar buy={0} hold={0} sell={0} />)
    expect(screen.getByTestId('rk-empty-title')).toHaveTextContent('No analyst coverage')
  })

  it('adds the compact class only when compact is set', () => {
    const { container, rerender } = render(<ConsensusBar buy={1} hold={1} sell={1} />)
    expect(container.firstChild.className).not.toMatch(/compact/)
    rerender(<ConsensusBar buy={1} hold={1} sell={1} compact />)
    expect(container.firstChild.className).toMatch(/compact/)
  })

  it('renders an optional eyebrow', () => {
    render(<ConsensusBar buy={1} hold={1} sell={1} label="Analyst consensus" />)
    expect(screen.getByText('Analyst consensus')).toBeInTheDocument()
  })
})
```

Create `app/src/components/research-kit/RatingChangeList.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RatingChangeList, { actionTone } from './RatingChangeList'

const ROWS = [
  { date: '2026-07-31', firm: 'Morgan Stanley', from: 'Equal-Weight', to: 'Overweight', action: 'Upgrade', pt: '$260' },
  { date: '2026-07-28', firm: 'Barclays', from: 'Overweight', to: 'Equal-Weight', action: 'Downgrade', pt: '$210' },
  { date: '2026-07-22', firm: 'Wedbush', from: 'Outperform', to: 'Outperform', action: 'Maintained', pt: '$275' },
  { date: '2026-07-19', firm: 'Citi', from: '—', to: 'Buy', action: 'Initiated', pt: '$255' },
  { date: '2026-07-15', firm: 'BofA', from: 'Buy', to: 'Buy', action: 'PT Raised', pt: '$270' },
  { date: '2026-07-09', firm: 'UBS', from: 'Neutral', to: 'Neutral', action: 'PT Lowered', pt: '$200' },
]

describe('actionTone', () => {
  const TABLE = [
    ['Upgrade', 'positive'],
    ['PT Raised', 'positive'],
    ['raised', 'positive'],
    ['Downgrade', 'negative'],
    ['PT Lowered', 'negative'],
    ['Initiated', 'neutral'],
    ['Maintained', 'neutral'],
    ['Reiterated', 'neutral'],
    ['', 'neutral'],
    [undefined, 'neutral'],
    ['something odd', 'neutral'],
  ]

  it.each(TABLE)('%s maps to %s', (action, tone) => {
    expect(actionTone(action)).toBe(tone)
  })

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(actionTone('  UPGRADE  ')).toBe('positive')
    expect(actionTone('downgrade')).toBe('negative')
  })
})

describe('RatingChangeList', () => {
  it('renders one row per entry up to the cap', () => {
    const { container } = render(<RatingChangeList rows={ROWS} cap={3} />)
    expect(container.querySelectorAll('[data-testid="rk-rc-row"]').length).toBe(3)
  })

  it('reports the overflow rather than dropping it silently', () => {
    render(<RatingChangeList rows={ROWS} cap={3} />)
    expect(screen.getByTestId('rk-rc-more')).toHaveTextContent('+3 more')
  })

  it('shows no overflow line when everything fits', () => {
    render(<RatingChangeList rows={ROWS} cap={10} />)
    expect(screen.queryByTestId('rk-rc-more')).toBeNull()
  })

  it('renders date, firm, from→to and price target', () => {
    render(<RatingChangeList rows={[ROWS[0]]} />)
    expect(screen.getByText('2026-07-31')).toBeInTheDocument()
    expect(screen.getByText('Morgan Stanley')).toBeInTheDocument()
    expect(screen.getByText('Equal-Weight')).toBeInTheDocument()
    expect(screen.getByText('Overweight')).toBeInTheDocument()
    expect(screen.getByText('$260')).toBeInTheDocument()
  })

  it('renders the action as a small VerdictChip with the mapped tone', () => {
    const { container } = render(<RatingChangeList rows={[ROWS[0], ROWS[1]]} />)
    const chips = container.querySelectorAll('[data-testid="rk-chip-glyph"]')
    expect(chips[0].textContent).toBe('▲')
    expect(chips[1].textContent).toBe('▼')
    // getByText returns the chip's inner label span; its parent IS the chip.
    // (Do NOT use .closest('span') — closest() matches the element itself.)
    expect(screen.getByText('Upgrade').parentElement.className).toMatch(/sizeSm/)
  })

  it('puts date and price target on tabular numerals', () => {
    const { container } = render(<RatingChangeList rows={[ROWS[0]]} />)
    expect(container.querySelector('[data-testid="rk-rc-date"]').className).toMatch(/\bt-num\b/)
    expect(container.querySelector('[data-testid="rk-rc-pt"]').className).toMatch(/\bt-num\b/)
  })

  it('falls back to the kit EmptyState when there is nothing to show', () => {
    const { rerender } = render(<RatingChangeList rows={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toHaveTextContent('No rating changes')
    rerender(<RatingChangeList />)
    expect(screen.getByTestId('rk-empty-title')).toHaveTextContent('No rating changes')
  })

  it('renders em-dashes for missing fields instead of blanks or undefined', () => {
    const { container } = render(<RatingChangeList rows={[{ firm: 'Solo' }]} />)
    const row = container.querySelector('[data-testid="rk-rc-row"]')
    expect(row.textContent).not.toMatch(/undefined/)
    expect(container.querySelector('[data-testid="rk-rc-date"]').textContent).toBe('—')
  })

  it('renders an optional eyebrow', () => {
    render(<RatingChangeList rows={ROWS} label="Rating changes" />)
    expect(screen.getByText('Rating changes')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd app && npx vitest run src/components/research-kit/ConsensusBar.test.jsx src/components/research-kit/RatingChangeList.test.jsx
```
Expected: both fail to collect — `Failed to resolve import "./ConsensusBar"` / `"./RatingChangeList"`.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/ConsensusBar.jsx`:

```jsx
// app/src/components/research-kit/ConsensusBar.jsx
import EyebrowLabel from './EyebrowLabel'
import EmptyState from './EmptyState'
import styles from './ConsensusBar.module.css'

/** Minimum segment width (%) that can legibly hold its own count label. */
export const LABEL_MIN_PCT = 12

const SEG_CLASS = { buy: 'segBuy', hold: 'segHold', sell: 'segSell' }
const SEG_LABEL = { buy: 'Buy', hold: 'Hold', sell: 'Sell' }

/**
 * Buy/hold/sell distribution as width percentages.
 *
 * Pure and DOM-free so the geometry is unit-testable. Junk coerces to 0 rather
 * than producing NaN widths; zero total returns null so the caller can render
 * the kit EmptyState instead of an empty bar (an empty bar reads as "consensus
 * is nothing", which is a lie — there simply is no coverage).
 */
export function consensusSegments(buy, hold, sell) {
  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const b = num(buy)
  const h = num(hold)
  const s = num(sell)
  const total = b + h + s
  if (total <= 0) return null
  return [
    { key: 'buy', count: b, pct: (b / total) * 100 },
    { key: 'hold', count: h, pct: (h / total) * 100 },
    { key: 'sell', count: s, pct: (s / total) * 100 },
  ]
}

/**
 * Segmented analyst-consensus bar (spec §3.3/§5.3; dataviz pattern 17).
 *
 * NEVER HUE-ONLY (§3.3, normative). Four redundant channels carry the meaning:
 *   1. position — buy always left, sell always right
 *   2. width    — the share of coverage
 *   3. a 2px surface-coloured divider between segments (the `gap` on .track)
 *   4. VISIBLE COUNTS — always in the legend, and additionally inside any
 *      segment at least LABEL_MIN_PCT wide
 * "12 buys, 1 sell" is the message; "consensus: buy" in a cell is not.
 */
export default function ConsensusBar({
  buy,
  hold,
  sell,
  compact = false,
  label,
  info,
  className = '',
}) {
  const segments = consensusSegments(buy, hold, sell)

  if (!segments) {
    return (
      <EmptyState
        compact
        icon="document"
        title="No analyst coverage"
        hint="Ratings appear here once firms publish on this name."
        className={className}
      />
    )
  }

  const a11y = `Analyst consensus: ${segments[0].count} buy, ${segments[1].count} hold, ${segments[2].count} sell`

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <div className={styles.track} data-testid="rk-consensus-track" role="img" aria-label={a11y}>
        {segments.map((s) =>
          s.pct > 0 ? (
            <span
              key={s.key}
              className={`${styles.seg} ${styles[SEG_CLASS[s.key]]}`}
              data-testid={`rk-seg-${s.key}`}
              style={{ width: `${s.pct}%` }}
            >
              {s.pct >= LABEL_MIN_PCT && (
                <span className={`${styles.segCount} t-num`} data-testid="rk-seg-count">
                  {s.count}
                </span>
              )}
            </span>
          ) : null,
        )}
      </div>

      <div className={styles.legend} data-testid="rk-consensus-legend">
        {segments.map((s) => (
          <span key={s.key} className={styles.legendItem}>
            <span className={`${styles.dot} ${styles[SEG_CLASS[s.key]]}`} aria-hidden="true" />
            {SEG_LABEL[s.key]}{' '}
            <span className={`${styles.legendCount} t-num`} data-testid="rk-legend-count">
              {s.count}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/ConsensusBar.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
}

.compact {
  gap: var(--space-xs);
}

.track {
  display: flex;
  align-items: stretch;
  /* Channel 3: a 2px surface-coloured divider between segments, so adjacent
     fills never blur into one another on a dark canvas. */
  gap: 2px;
  width: 100%;
  height: 12px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.compact .track {
  height: 7px;
}

.seg {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  border-radius: 2px;
  overflow: hidden;
}

.segCount {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 700;
  line-height: 1;
  color: var(--bg);
}

.compact .segCount {
  display: none;
}

.segBuy {
  background: var(--gain);
}
.segHold {
  background: var(--text-muted);
}
.segSell {
  background: var(--loss);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: var(--lh-tight);
  color: var(--text-muted);
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

.legendCount {
  font-weight: 700;
  color: var(--text-bright);
}

/* PHONE */
@media (max-width: 640px) {
  .track {
    height: 14px;
  }
  .legend {
    gap: var(--space-sm);
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .legend {
    gap: var(--space-sm);
  }
}
```

**3c.** Create `app/src/components/research-kit/RatingChangeList.jsx`:

```jsx
// app/src/components/research-kit/RatingChangeList.jsx
import EyebrowLabel from './EyebrowLabel'
import EmptyState from './EmptyState'
import VerdictChip from './VerdictChip'
import styles from './RatingChangeList.module.css'

/* Longest-intent-first: every key is tested with `includes`, and no key is a
   substring of another ('downgrade'.includes('upgrade') === false). */
const ACTION_TONES = [
  ['upgrade', 'positive'],
  ['raised', 'positive'],
  ['downgrade', 'negative'],
  ['lowered', 'negative'],
  ['initiated', 'neutral'],
  ['reiterated', 'neutral'],
  ['maintained', 'neutral'],
]

/**
 * Analyst action → VERDICT_TONES. Pure, case-insensitive, whitespace-tolerant;
 * anything unrecognised is 'neutral' (never a guess dressed as a signal).
 */
export function actionTone(action) {
  const a = String(action ?? '').trim().toLowerCase()
  if (!a) return 'neutral'
  for (const [needle, tone] of ACTION_TONES) if (a.includes(needle)) return tone
  return 'neutral'
}

/**
 * THE shared rating-change rendering (spec §3.4/§5.3).
 *
 * This ONE component replaces the three variants that exist today:
 * AnalystPanel's ActionRow, CallRecapSection's RatingChanges, and EstimatesTab's
 * `.rcrow`. P2/P3 point all three at this; do not add a fourth.
 *
 * `rows`: [{ date, firm, from, to, action, pt }]. `cap` limits what renders and
 * the remainder is REPORTED ("+3 more"), never silently dropped — an audit
 * trail that quietly truncates is not an audit trail.
 */
export default function RatingChangeList({
  rows,
  cap = 5,
  label,
  info,
  className = '',
}) {
  const all = Array.isArray(rows) ? rows : []

  if (all.length === 0) {
    return (
      <EmptyState
        compact
        icon="document"
        title="No rating changes"
        hint="Analyst actions appear here as firms update coverage."
        className={className}
      />
    )
  }

  const shown = all.slice(0, Math.max(0, cap))
  const overflow = all.length - shown.length

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <ul className={styles.list}>
        {shown.map((r, i) => (
          <li key={`${r.date ?? ''}-${r.firm ?? ''}-${i}`} className={styles.row} data-testid="rk-rc-row">
            <span className={`${styles.date} t-num`} data-testid="rk-rc-date">
              {r.date || '—'}
            </span>
            <span className={styles.firm} title={typeof r.firm === 'string' ? r.firm : undefined}>
              {r.firm || '—'}
            </span>
            <span className={styles.grades}>
              <span className={styles.from}>{r.from || '—'}</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
              <span className={styles.to}>{r.to || '—'}</span>
            </span>
            <span className={styles.action}>
              <VerdictChip size="sm" tone={actionTone(r.action)} label={r.action || 'Update'} />
            </span>
            <span className={`${styles.pt} t-num`} data-testid="rk-rc-pt">
              {r.pt || ''}
            </span>
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <div className={styles.more} data-testid="rk-rc-more">
          +{overflow} more
        </div>
      )}
    </div>
  )
}
```

**3d.** Create `app/src/components/research-kit/RatingChangeList.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: var(--space-sm);
  padding: 5px 0;
  border-bottom: 1px solid var(--glass-border-neutral);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--lh-tight);
}

.row:last-child {
  border-bottom: none;
}

.date {
  color: var(--text-muted);
}

.firm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--text-bright);
}

.grades {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  color: var(--text);
}

.from {
  color: var(--text-muted);
}

.arrow {
  color: var(--text-muted);
}

.to {
  font-weight: 600;
  color: var(--text-bright);
}

/* An explicit wrapper for the VerdictChip so the phone grid-area assignment is
   a named class, not a fragile :nth-last-child() on a component's output. */
.action {
  display: inline-flex;
  min-width: 0;
}

.pt {
  justify-self: end;
  font-weight: 600;
  color: var(--text-bright);
}

.more {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* PHONE — the 5-column grid cannot survive 375px, so the row folds into two
   lines: date + firm, then grades + action + PT. */
@media (max-width: 640px) {
  .row {
    grid-template-columns: 88px minmax(0, 1fr);
    grid-template-areas:
      'date firm'
      'grades grades'
      'action pt';
    row-gap: 4px;
    padding: var(--space-sm) 0;
  }
  .date {
    grid-area: date;
  }
  .firm {
    grid-area: firm;
  }
  .grades {
    grid-area: grades;
    white-space: normal;
  }
  .action {
    grid-area: action;
    justify-self: start;
  }
  .pt {
    grid-area: pt;
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .row {
    grid-template-columns: 78px minmax(0, 1fr) auto auto auto;
    gap: var(--space-xs);
  }
}
```

**3e.** Extend `app/src/components/research-kit/index.js` — append:

```js
export { default as ConsensusBar, consensusSegments, LABEL_MIN_PCT } from './ConsensusBar'
export { default as RatingChangeList, actionTone } from './RatingChangeList'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: `Test Files 9 passed`, `Tests 101 passed`.

```
cd app && npx vitest run src/components/Skeleton.test.jsx src/styles/tokens.test.js
```
Expected: green (the whole P1F-A surface still holds together).

```
cd app && npm run build
```
Expected: `✓ built in …`, exit 0. No new chunk warnings — the kit is dependency-free, so `vendor-*` chunk sizes must be unchanged from Task 1's build.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/ConsensusBar.jsx app/src/components/research-kit/ConsensusBar.module.css app/src/components/research-kit/ConsensusBar.test.jsx app/src/components/research-kit/RatingChangeList.jsx app/src/components/research-kit/RatingChangeList.module.css app/src/components/research-kit/RatingChangeList.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: ConsensusBar + RatingChangeList

Spec 2026-08-03 §3.3/§3.4/§5.3. ConsensusBar carries four redundant channels
(position, width, 2px dividers, always-visible counts) so it is never hue-only;
segment math is the exported pure fn consensusSegments(), which returns null on
zero coverage so the bar renders the kit EmptyState rather than an empty bar
that reads like a real consensus.

RatingChangeList is THE shared rendering that replaces AnalystPanel.ActionRow,
CallRecapSection.RatingChanges and EstimatesTab.rcrow. Overflow past `cap` is
reported, never silently dropped. Action tone is the exported pure fn
actionTone(), table-driven and neutral on anything unrecognised.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Deferred to P1F-B (charts + shell)

Everything in spec §3.1–§3.4 that P1F-A does **not** land, so P1F-B's author starts from a complete list rather than a diff:

**§3.1 tokens**
- Fixing the broken references in `EarningsModal.module.css` (`var(--gold, …)` / `var(--text-dim, …)` at lines 255/271/275 → `--ut-gold` / `--text-muted`) and the hardcoded `background:#111612` at line 14. Those are modal-shell edits and belong with the P2 modal rebuild, not with token definition.
- `backdrop-filter` on the modal backdrop (the one place §3.1 permits it) — P2 shell.

**§3.2 typography**
- *Using* `--text-display` — it ships as a token here; the composite crown that consumes it (`RatingCrown`) is P1F-B.
- Collapsing the 13 ad-hoc font sizes on both surfaces onto the scale — P2 (modal) / P3 (page).
- The composited-contrast audit of glass surfaces against the 4.5:1 floor — §8 verification, P5.

**§3.3 color grammar**
- `ImpliedVsRealized` signed bars (down-closes descend below the baseline), shape-coded beat/miss dots (solid = beat, ring/✕ = miss), and `HeatGrid` always-visible signed numbers on the tokenized ladder. The tokens they read (`--heat-*`, `--score-*`) ship here; the components are P1F-B.
- Session-state colors on live prices — P2 banner.

**§3.4 component library**
- Charts: `LollipopChart`, `ReactionBars`, `RevisionColumns`, `ImpliedVsRealized`, `Histogram`, `MetricTrendChart`, `HeatGrid`, `RatingCrown`, `CheckupRow`.
- Shell: `IdentityBanner`, `SectionRail`, `PinnedFooter`; the `SentimentGauge` kit restyle (a restyle, never a fork).
- Chart rendering policy: `echarts/core` + `echarts-for-react/lib/core` tree-shaken imports for lollipop/columns/histogram; `lightweight-charts` for anything sharing the price axis. Zero new dependencies still holds. `manualChunks` stays object-form.
- The **exported** `SIZE` constants per chart component — the consuming API (`SkeletonBlock size={…}`) ships here in Task 5; each chart exports its own box in P1F-B.
- The one-time localStorage-gated coach-mark explaining the hollow-vs-solid grammar (the ⓘ affordance it sits beside ships here).
- The methodology page (§12) that every `InfoTip href` points at — P2.

---

## Verification summary

After Task 6 the following must all be true:

```
cd app && npx vitest run src/components/research-kit/ src/components/Skeleton.test.jsx src/styles/tokens.test.js
cd app && npm run build
git status --porcelain          # empty — six commits, nothing stray
```

- 11 test files green: 9 in `research-kit/`, plus `Skeleton.test.jsx` and `styles/tokens.test.js` (≈195 assertions). The gate is **0 failed**.
- `npm run build` exits 0 with unchanged vendor chunk sizes (the kit adds no dependency).
- `app/src/components/research-kit/index.js` exports: `InfoTip`, `EyebrowLabel`, `GlassCard`, `StatTile`, `VerdictChip`, `RangeSlider`, `EmptyState`, `ConsensusBar`, `RatingChangeList`, `SCORE_TONES`, `VERDICT_TONES`, `VERDICT_GLYPHS`, `toneGlyph`, `positionPct`, `labelPct`, `LABEL_EDGE_CLAMP_PCT`, `consensusSegments`, `LABEL_MIN_PCT`, `actionTone`.
- Nothing is pushed. P1F-B and P2 build on this branch.
