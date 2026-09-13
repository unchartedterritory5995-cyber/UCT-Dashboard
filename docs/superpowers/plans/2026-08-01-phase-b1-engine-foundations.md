# Phase B1 — Engine Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every prerequisite the indicator engine needs — pinned renderer, settings passthrough, a JS design-token system, golden-fixture math verification, and a real screenshot-parity harness — with **zero user-visible change** and no engine code yet.

**Architecture:** Five independent foundations, each verifiable on its own: (1) LWC pinned to exact 5.2.0 with the two behavioral changes neutralized; (2) `settingsVersion` + `indicatorInstances` surviving both allow-lists before any writer exists; (3) chart design tokens as a **JS resolver** (canvas colors come from JS, not CSS) plus a genuinely new amber; (4) shared golden fixtures + compute-rounding removal across both language lanes; (5) a deterministic per-indicator screenshot-diff gate built on the existing `ChartRender.jsx` headless route.

**Tech Stack:** React 19 + Vite 7 + lightweight-charts 5.2.0; vitest 4 (jsdom, pool=forks); FastAPI + pytest; Playwright (existing install at `C:\Users\Patrick\uct-sweep`).

## Phase B decomposition (context — this plan is B1 only)

| Sub-phase | Scope | Own plan |
|---|---|---|
| **B1 (this plan)** | Renderer pin · settings passthrough · design tokens · golden fixtures + rounding removal · parity harness | now |
| B2 | Definition schema · registry · compute contract · binding layer · instance manager · placement adapter (renders into legacy bands) | after B1 |
| B3 | Two-flip migration: BB+RSI pilots → MACD → remaining 12 · `volumeProfile` carve-out | after B2 |
| B4 | Library dialog · auto-generated settings UI · legend chips · UX addendum (touch/states/form spec) | after B2 |
| B5 | Flip B: atomic real-panes cutover · four-preset QA · rollback flag | last |

## Global Constraints

- **Read ground truth ONLY from a worktree at `origin/master`.** `C:\Users\Patrick\uct-dashboard` is a stale dirty feature branch (`StockChart.jsx` differs by 5,126 lines; three chart files don't exist there). Never cite its line numbers.
- **⛔ NO PUSH TO MASTER.** Phase B ships after the Sep 5 launch freeze (owner/CEO ruling of record). Push the feature branch to origin for backup only: `git push -u origin <branch>` — never `<branch>:master`.
- **`app/node_modules` is an NTFS junction** shared with the stale main checkout and ~70 worktrees. Task 1 breaks the junction for this worktree (real install) so the renderer bump is worktree-local. Never `npm install` through a junction.
- Frontend tests: `cd app && npx vitest run <paths>` (never `npm test -- run` — it double-runs). Backend: `python -m pytest tests/... -q` from the worktree root. Known pre-existing failure: `test_calendar_paging::test_month_unknown_hour_lands_in_tbd`.
- Mutation-check every new gate; run with `PYTHONDONTWRITEBYTECODE=1` and purge `__pycache__` between iterations (same-size same-second mutations self-mask via stale `.pyc`).
- No Ravi-owned files: `OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`, `liveflow_router.py`.
- Stage files BY NAME. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Never touch `api/services/indicator_alert_evaluator.py` or `indicator_alert_service.py`** — that's the Phase C seam; B1 preserves it by construction. (Task 6 changes what `indicator_compute.py` returns; the evaluator's own logic stays untouched.)

---

### Task 0: Worktree + a real node_modules

**Files:** creates worktree `C:\Users\Patrick\uct-worktrees\phase-b1-foundations` (branch `feat/phase-b1-foundations` from `origin/master`).

**Interfaces:**
- Produces: the worktree every later task runs in, with a **real** `app/node_modules` (junction broken) so the renderer version is local to it.

- [ ] **Step 1: Create the worktree**

```bash
cd /c/Users/Patrick/uct-dashboard
git fetch origin
git worktree add -b feat/phase-b1-foundations /c/Users/Patrick/uct-worktrees/phase-b1-foundations origin/master
git -C /c/Users/Patrick/uct-worktrees/phase-b1-foundations log --oneline -1
```
Expected: HEAD at/after `5a6bf728`.

- [ ] **Step 2: Confirm the junction exists, then break it**

```bash
cmd //c "dir /AL C:\Users\Patrick\uct-worktrees\phase-b1-foundations\app"
```
If `node_modules` is listed as `<JUNCTION>`, remove the link (NOT its target) and do a real install:
```bash
cmd //c "rmdir C:\Users\Patrick\uct-worktrees\phase-b1-foundations\app\node_modules"
cd /c/Users/Patrick/uct-worktrees/phase-b1-foundations/app && npm ci
```
`rmdir` (no `/S`) on a junction deletes only the link. **Verify the shared target survived:**
```bash
ls /c/Users/Patrick/uct-dashboard/app/node_modules/lightweight-charts/package.json && echo TARGET_INTACT
```

- [ ] **Step 3: Baseline both suites**

Run: `cd app && npx vitest run src/components/chart/ src/hooks/` → expect 45 files / 466 tests pass.
Run: `python -m pytest tests/test_indicator_compute.py tests/test_signature_rules.py -q` from the worktree root → pass.
Record both counts in the report — they are the B1 baseline.

- [ ] **Step 4: Commit nothing; report the worktree path + baselines.** (No repo change in this task.)

---

### Task 1: Pin lightweight-charts 5.2.0 and neutralize its two behavior changes

**Files:**
- Modify: `app/package.json` (line ~30), `app/package-lock.json` (via npm)
- Modify: `app/src/components/StockChart.jsx` (chart options object at ~L2722 region — anchor by `autoSize` / `layout:` inside the `createChart` options)
- Test: `app/src/components/chart/rendererPin.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `lightweight-charts@5.2.0` exact (no caret) installed and pinned; chart options carry `hoveredSeriesOnTop: false`.

**Why (verified facts):** 5.2.0 is npm `latest`, published 2026-04-24, **zero breaking changes**, runtime exports byte-identical, pane API unchanged, app is pure JS so the four new required option fields cannot break us. It fixes issue #2057 (pane DOM element lingering after removing the last series). Two behavioral deltas: `hoveredSeriesOnTop` now defaults `true` (would silently reorder draw order on hover across our many pane-0 series — we disable it so the upgrade is behaviorally inert), and PR #2055 made `autoSize` paint synchronously inside the ResizeObserver (a fix, but our resize-coupled margin math is the regression target). The existing `^5.1.0` caret already floats to 5.2.0, so any stray install jumps versions — pinning exactly is what makes "one renderer under all parity baselines" enforceable.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/rendererPin.test.js
import { describe, it, expect } from 'vitest'
import pkg from '../../../package.json'
import lwcPkg from 'lightweight-charts/package.json'

describe('renderer pin', () => {
  it('declares an EXACT lightweight-charts version (no range)', () => {
    const v = pkg.dependencies['lightweight-charts']
    expect(v).toBe('5.2.0')
    expect(v).not.toMatch(/[\^~*x]/)   // a range makes parity baselines unenforceable
  })

  it('has 5.2.0 actually installed', () => {
    expect(lwcPkg.version).toBe('5.2.0')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails for the right reason**

Run: `cd app && npx vitest run src/components/chart/rendererPin.test.js`
Expected: FAIL — `expected '^5.1.0' to be '5.2.0'`.

- [ ] **Step 3: Install exact and disable hovered-on-top**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b1-foundations/app && npm i --save-exact lightweight-charts@5.2.0
```
Then in `StockChart.jsx`, inside the `createChart` options object (find it by the `autoSize: true` key), add the option with a comment explaining it:

```js
    // Pinned 5.2.0 default is `true`, which re-orders draw order within a pane on
    // hover. This chart stacks candles + MA overlays + VWAP + BB + Donchian + SAR
    // + comparison in pane 0, so hovering would silently restack them (and later,
    // float a band's constituent line above its own fill). Keep 5.1.0 rendering;
    // opt in deliberately if we ever want the hit-testing that comes with it.
    hoveredSeriesOnTop: false,
```

- [ ] **Step 4: Run the pin test + full chart suites**

Run: `npx vitest run src/components/chart/rendererPin.test.js` → PASS
Run: `npx vitest run src/components/chart/ src/hooks/` → all pass (baseline count from Task 0).
Run: `npm run build` → clean.

- [ ] **Step 5: Manual resize regression (the #2055 target) — REQUIRED, not optional**

Start dev (`npm run dev`) or use the built app against prod API per the repo's dev setup. Open `/charts` with a chart that has **the volume pane separate AND ≥2 oscillators enabled** (e.g. RSI + MACD via the toolbar), then:
1. Resize the browser window narrow→wide→narrow twice.
2. Confirm the oscillator bands keep their proportions (no drift, no collapsing price area, no overlapping axis labels).
3. Toggle an oscillator off and on; confirm the band layout returns to the same geometry.
Record what you observed in the report (this is the one thing the test suite cannot cover). If margins drift, STOP and report — do not paper over it.

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/src/components/StockChart.jsx app/src/components/chart/rendererPin.test.js
git commit -m "chore(chart): pin lightweight-charts 5.2.0 exactly, keep 5.1 hover z-order

5.2.0 is a no-op upgrade for us (no breaking changes, identical runtime exports,
unchanged pane API, pure-JS app) plus the #2057 fix for a pane element lingering
after its last series is removed. Two behavioral deltas are handled: the new
hoveredSeriesOnTop default is disabled so draw order stays stable on hover, and
the synchronous autoSize paint was resize-regression-checked against the
multi-pane layout. Pinned exactly because '^5.1.0' already floated to 5.2.0 --
parity baselines are only meaningful under one renderer version.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Settings passthrough — `settingsVersion` + `indicatorInstances`

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js` (`CHART_DEFAULTS` near :182 where `signature` lives; `mergeChartSettings` return object ends ~:394; `_OVERRIDE_SECTION_KEYS` ~:417)
- Test: `app/src/components/chart/chartDefaults.test.js` (append)

**Interfaces:**
- Produces: `CHART_DEFAULTS.settingsVersion = 1` and `CHART_DEFAULTS.indicatorInstances = []`; both survive a `mergeChartSettings` round-trip; `indicatorInstances` merges by `instanceId` (never positionally) under `mergeSettingsOverride`.
- Consumed by: B2's instance manager. **Nothing writes these in B1** — that's the point: the passthrough lands before any writer exists, so no engine data can ever be destroyed by an un-migrated surface.

**Why (verified facts):** `mergeChartSettings`'s return is an explicit 33-key object literal — any key not named there is **silently destroyed on every read-merge-write cycle**. `settingsVersion` and `indicatorInstances` appear nowhere in `app/src` or `api/` today, so this is green-field. `_OVERRIDE_SECTION_KEYS` is the second allow-list (per-cell grid overrides) and arrays there replace wholesale — an instance LIST must merge by id or a per-cell override wipes sibling instances. Note `overlays` merges **positionally** and pads to the defaults' length (new slots append, never insert) — the instance migrator in B2 must respect that when it folds overlays in.

- [ ] **Step 1: Write the failing tests** (append to the existing describe block)

```js
  it('settingsVersion and indicatorInstances survive a merge round-trip', () => {
    const merged = mergeChartSettings(JSON.stringify({
      settingsVersion: 2,
      indicatorInstances: [{ instanceId: 'a1', defId: 'rsi', inputs: { period: 7 } }],
    }))
    expect(merged.settingsVersion).toBe(2)
    expect(merged.indicatorInstances).toHaveLength(1)
    expect(merged.indicatorInstances[0]).toEqual({ instanceId: 'a1', defId: 'rsi', inputs: { period: 7 } })
  })

  it('defaults them when absent — engine state starts empty, not undefined', () => {
    const merged = mergeChartSettings(null)
    expect(merged.settingsVersion).toBe(1)
    expect(merged.indicatorInstances).toEqual([])
  })

  it('a non-array indicatorInstances is coerced, never trusted', () => {
    const merged = mergeChartSettings(JSON.stringify({ indicatorInstances: { nope: true } }))
    expect(merged.indicatorInstances).toEqual([])
  })
```

And in `mergeSettingsOverride.test.js`:

```js
  it('merges indicatorInstances by instanceId, never positionally', () => {
    const base = mergeChartSettings(JSON.stringify({
      indicatorInstances: [
        { instanceId: 'a1', defId: 'rsi', inputs: { period: 14 } },
        { instanceId: 'b2', defId: 'macd', inputs: {} },
      ],
    }))
    const out = mergeSettingsOverride(base, {
      indicatorInstances: [{ instanceId: 'b2', defId: 'macd', inputs: { fastPeriod: 8 } }],
    })
    // the override patches b2 and LEAVES a1 alone — a wholesale array replace
    // would silently delete the user's other indicators in that grid cell
    expect(out.indicatorInstances).toHaveLength(2)
    expect(out.indicatorInstances.find(i => i.instanceId === 'a1').inputs.period).toBe(14)
    expect(out.indicatorInstances.find(i => i.instanceId === 'b2').inputs.fastPeriod).toBe(8)
  })
```

- [ ] **Step 2: Run both, confirm right-reason failures**

Run: `cd app && npx vitest run src/components/chart/chartDefaults.test.js src/components/chart/mergeSettingsOverride.test.js`
Expected: FAIL — `expected undefined to be 1`, etc.

- [ ] **Step 3: Implement**

In `CHART_DEFAULTS` (beside `signature`):
```js
  // Engine state (Phase B). Nothing writes these yet -- they exist first so a
  // read-merge-write cycle from an un-migrated surface can never destroy engine
  // data. mergeChartSettings' return is an explicit allow-list: a key absent
  // from it is silently dropped on EVERY read.
  settingsVersion: 1,
  indicatorInstances: [],
```

In the `mergeChartSettings` return object:
```js
    settingsVersion: Number.isFinite(parsed.settingsVersion) ? parsed.settingsVersion : CHART_DEFAULTS.settingsVersion,
    indicatorInstances: Array.isArray(parsed.indicatorInstances) ? parsed.indicatorInstances : [],
```

In `mergeSettingsOverride`, add an id-keyed branch **before** the generic array-replace fall-through (mirror how `watermark`/`indicators` are special-cased above `_OVERRIDE_SECTION_KEYS`):
```js
    if (k === 'indicatorInstances') {
      // Merge by instanceId. The generic path replaces arrays wholesale, which in a
      // grid cell would delete every instance the override didn't happen to mention.
      const byId = new Map((out.indicatorInstances || []).map(i => [i.instanceId, i]))
      for (const patch of (Array.isArray(v) ? v : [])) {
        if (!patch?.instanceId) continue
        const prev = byId.get(patch.instanceId)
        byId.set(patch.instanceId, prev ? { ...prev, ...patch, inputs: { ...prev.inputs, ...patch.inputs } } : patch)
      }
      out.indicatorInstances = [...byId.values()]
      continue
    }
```
Also check `mergeSettingsOverride.test.js:54`'s "every object-valued CHART_DEFAULTS section merges one level" generic guard — `indicatorInstances` is array-valued; if that guard iterates all object-valued defaults it may need an explicit exemption. Read it and adapt honestly (exempt arrays, don't weaken the guard).

- [ ] **Step 4: Run to PASS + full chart suite green.**

- [ ] **Step 5: Mutation-check both gates**

Delete the `indicatorInstances:` line from the `mergeChartSettings` return → the round-trip test must fail. Replace the id-merge branch with the generic path → the by-id test must fail. Restore byte-identical (in-place copy; never `git stash`) and confirm `git status --short` is empty.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/chartDefaults.js app/src/components/chart/chartDefaults.test.js app/src/components/chart/mergeSettingsOverride.test.js
git commit -m "feat(chart): let engine settings survive the two allow-lists

mergeChartSettings' return is an explicit key list, so anything it does not name
is silently destroyed on every read-merge-write -- and the grid-cell override
merger replaces arrays wholesale. Landing settingsVersion + indicatorInstances
(id-merged) BEFORE any writer exists means no un-migrated surface can ever eat
engine data.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Chart design tokens — a JS resolver, and an amber that is not gold

**Files:**
- Create: `app/src/components/chart/designTokens.js`, `app/src/components/chart/designTokens.test.js`
- Modify: `app/src/styles/tokens.css` (add the new amber + the opacity ramp as CSS vars for DOM chrome)

**Interfaces:**
- Produces `designTokens.js` exports:
  - `IND_TOKENS` — semantic map, per chart preset: `{ classic: {...}, oled: {...}, tradingview: {...}, light: {...} }`, each with keys `bull, bear, neutral, warn, info, premium, ink, inkMuted, surface`.
  - `ALPHA = { 'fill-faint': 0.08, fill: 0.12, band: 0.16, emphasis: 0.24, glow: 0.35, solid: 1 }`
  - `resolveToken(ref, preset)` → CSS color string. `ref` is `'token:bull'` | `'token:bull@band'` | any raw color (returned unchanged). Unknown token → throws in dev-ish (return `null` and let the caller decide) — see test.
  - `MARKER_SHAPES` — frozen enum `['triangle-up','triangle-down','circle','diamond','square','cross']`; `MARKER_SIZES = { s: 8, m: 11, l: 14 }`
  - `ZONE_STATES = { forming: {...}, active: {...}, mitigated: {...}, invalidated: {...} }` (alpha-ramp step + border style per state)
  - `LINE_WIDTHS = [1, 1.5, 2]`
- Consumed by: B2's binding layer (plot `color: 'token:bull'` refs resolve here), B3's migrated definitions, B4's Style tab palette.

**Why (verified facts, two of which break the spec's assumptions):**
1. **`--warn` is literally aliased to `--ut-gold` (`#c9a84c`) in both dark (tokens.css:38) and light (:239).** The spec demands `ind.warn` be "a NEW amber, distinct from gold" and that "gold ≠ warning" — so mapping `warn → --warn` ships the exact conflation the spec forbids. A genuinely new value is required.
2. **Chart canvas colors come from JS, not CSS.** The four chart presets (`classic`/`oled`/`tradingview`/`light` in `chartDefaults.js:199-299`) set `background`/`textColor`/`grid.color` as JS values, and `lightThemePalette.js` + `StockChart.jsx:1064-1145` layer theme colors over `cs`. The CSS `[data-theme]` blocks are a *different* system (`tradingview` has no CSS counterpart; `dim` has no chart preset). **A CSS-only token system never reaches the canvas** — hence a JS resolver, with CSS vars added only for the DOM chrome (legend chips, dialogs).
3. Existing convention is 8-digit-hex alpha suffixes (`15`≈8%, `35`≈21%); there is no named ramp, so `ALPHA` collides with nothing.
4. `--font-sans: 'Instrument Sans'` carries an explicit in-file "do NOT repoint to a mono stack" warning, and `.t-mono` supplies `tabular-nums` — matching the spec's owner-locked typography rule. Record that in the module docstring so no future task reintroduces mono.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/designTokens.test.js
import { describe, it, expect } from 'vitest'
import { IND_TOKENS, ALPHA, resolveToken, MARKER_SHAPES, MARKER_SIZES, ZONE_STATES, LINE_WIDTHS } from './designTokens'

describe('chart design tokens', () => {
  it('covers all four chart presets', () => {
    expect(Object.keys(IND_TOKENS).sort()).toEqual(['classic', 'light', 'oled', 'tradingview'])
  })

  it('every preset defines every semantic role', () => {
    const roles = ['bull','bear','neutral','warn','info','premium','ink','inkMuted','surface']
    for (const [preset, map] of Object.entries(IND_TOKENS)) {
      for (const r of roles) expect(map[r], `${preset}.${r}`).toBeTruthy()
    }
  })

  it('warn is NOT gold in any preset — the spec forbids conflating them', () => {
    for (const [preset, map] of Object.entries(IND_TOKENS)) {
      expect(map.warn.toLowerCase(), preset).not.toBe(map.premium.toLowerCase())
    }
  })

  it('resolves a bare token to that preset colour', () => {
    expect(resolveToken('token:bull', 'classic')).toBe(IND_TOKENS.classic.bull)
  })

  it('resolves an @alpha suffix to rgba at the named ramp step', () => {
    const out = resolveToken('token:bull@band', 'classic')
    expect(out).toMatch(/^rgba\(/)
    expect(out).toContain('0.16')
  })

  it('passes raw colours through untouched', () => {
    expect(resolveToken('#ff0000', 'classic')).toBe('#ff0000')
    expect(resolveToken('rgba(1,2,3,0.5)', 'classic')).toBe('rgba(1,2,3,0.5)')
  })

  it('returns null for an unknown token rather than a wrong colour', () => {
    expect(resolveToken('token:nope', 'classic')).toBeNull()
    expect(resolveToken('token:bull@nope', 'classic')).toBeNull()
  })

  it('exposes the locked marker + zone + width vocabularies', () => {
    expect(MARKER_SHAPES).toHaveLength(6)
    expect(Object.isFrozen(MARKER_SHAPES)).toBe(true)
    expect(Object.keys(MARKER_SIZES)).toEqual(['s','m','l'])
    expect(Object.keys(ZONE_STATES)).toEqual(['forming','active','mitigated','invalidated'])
    expect(LINE_WIDTHS).toEqual([1, 1.5, 2])
  })

  it('ALPHA is the named ramp, ascending', () => {
    const vals = Object.values(ALPHA)
    expect(vals).toEqual([...vals].sort((a,b) => a-b))
    expect(ALPHA['fill-faint']).toBe(0.08)
    expect(ALPHA.solid).toBe(1)
  })
})
```

- [ ] **Step 2: Run, confirm module-not-found failure.**

- [ ] **Step 3: Implement `designTokens.js`**

Write the module with: the docstring recording *why it is JS* (canvas colors come from JS presets, not CSS `[data-theme]`) and the two locked rules (Instrument Sans only / never mono; warn ≠ gold). Values: start from the existing tokens (`--gain #3cb868`, `--loss #e74c3c`, `--info #6ba3be`, `--ut-gold #c9a84c` for `premium`), pick `neutral` as the spec's `#8a8574`, and introduce **`warn: '#d98324'`** (a true amber, clearly separable from `#c9a84c` gold) for dark presets with a darker variant for `light`. Per-preset `ink`/`inkMuted`/`surface` come from that preset's own `textColor`/`background` in `chartDefaults.js` — read them and keep the two files consistent. `resolveToken` splits on `@`, looks up the role then the ramp step, converts hex→rgba, returns `null` on any miss.

Also add to `tokens.css` (for DOM chrome only, NOT the canvas): `--ind-warn: #d98324;` plus the six `--ind-alpha-*` ramp values, with a comment pointing at `designTokens.js` as the source of truth for canvas colors.

- [ ] **Step 4: Run to PASS; run the whole chart suite green.**

- [ ] **Step 5: Mutation-check the load-bearing gate**

Set one preset's `warn` equal to its `premium` → the "warn is NOT gold" test must fail. Restore byte-identical.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/designTokens.js app/src/components/chart/designTokens.test.js app/src/styles/tokens.css
git commit -m "feat(chart): design tokens for indicators, resolved in JS

The chart canvas takes its colours from the JS presets (classic/oled/tradingview/
light), not from the CSS [data-theme] blocks -- a CSS-only token system would
never reach it. So the semantic map, the named opacity ramp, and the locked
marker/zone vocabularies live in JS, with CSS vars added only for DOM chrome.

Introduces a real amber: --warn is aliased to --ut-gold in tokens.css, so reusing
it would have conflated 'warning' with 'premium brand', which is exactly what the
design spec forbids. A test fails if any preset ever makes them equal again.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Golden-fixture infrastructure (bars in → expected columns out)

**Files:**
- Create: `tests/fixtures/indicators/_schema.md`, `tests/fixtures/indicators/_generate.py`, and generated `tests/fixtures/indicators/<case>.json` for the cases below
- Create: `tests/test_indicator_golden.py` (pytest side), `app/src/components/chart/goldenFixtures.test.js` (vitest side)

**Interfaces:**
- Produces the fixture contract, documented in `_schema.md`:
```jsonc
{
  "case": "rsi_ramp_14",
  "note": "why this case exists",
  "bars": [{ "t": 20260601, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1000 }],
  "expected": {                       // one array per output column, ALIGNED to bars
    "rsi": [null, null, 55.123456789] // null = not-yet-computable (NaN on the JS side)
  },
  "params": { "period": 14 },
  "relTol": 1e-9
}
```
- Produces `load_case(name)` (pytest) and `loadCase(name)` (vitest) helpers that read the same files. **Alignment rule of record:** expected columns are input-length, `null`-padded before the first computable bar (the Python convention; the JS lane currently trims and gets migrated in Task 5).
- Cases required in B1 (the ones the spec names plus the two session traps):
  `rsi_ramp_14`, `macd_default`, `bb_20_2`, `stoch_14_3`, `williams_r_14`, `cci_20`, `mfi_14` — i.e. **the 7 indicators that exist in BOTH lanes** (`indicator_compute.py` has rsi/macd/bb/stoch/williams_r/cci/mfi + sma/ema; vwap/atr/sar/ichimoku/obv/donchian/adx are JS-only today)
  plus `vwap_extended_hours_utc_midnight` and `vwap_dst_transition` (JS-only assertions, but they pin the session-boundary bug class: the JS `computeVWAP` buckets sessions by **UTC day**, so a post-market 8 PM ET bar falls into the next UTC day and splits a session wrongly).

**Why:** §9.1 of the spec requires shared fixtures run by both lanes at rel-tol 1e-9 — **none of this exists.** `tests/fixtures/` is the *pattern-detector* tree (87 dirs with indicator-sounding names like `rsi_bullish_divergence`, containing inputs only, no expected outputs). Its `_generate.py` + scenario-JSON convention is the right in-house template to copy, so this task extends a known pattern rather than inventing one.

- [ ] **Step 1: Write the schema doc + generator**

`_schema.md` states the contract above, the alignment rule, the tolerance rule, and the hard rule that **fixtures are generated once and committed** (never regenerated in CI — a regenerated fixture cannot fail). `_generate.py` builds deterministic bar series (`random.Random(seed)` plus explicit hand-shaped ramps), computes expected columns **from the Python lane**, and writes the JSON. For the two VWAP cases it emits bars only (no `expected`), plus the session-boundary assertions the tests encode.

- [ ] **Step 2: Write the failing pytest side**

```python
# tests/test_indicator_golden.py
import json, math, pathlib, pytest
from api.services import indicator_compute as ic

FIX = pathlib.Path(__file__).parent / "fixtures" / "indicators"
CASES = ["rsi_ramp_14","macd_default","bb_20_2","stoch_14_3","williams_r_14","cci_20","mfi_14"]

def load_case(name):
    return json.loads((FIX / f"{name}.json").read_text())

def _close(a, b, rel):
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=rel, abs_tol=rel)

@pytest.mark.parametrize("name", CASES)
def test_python_lane_matches_the_golden_columns(name):
    case = load_case(name)
    got = ic.compute_case(case["case"].split("_")[0], case["bars"], case["params"])  # see Step 4
    for col, exp in case["expected"].items():
        assert len(got[col]) == len(case["bars"]), f"{name}.{col} not aligned to bars"
        for i, (g, e) in enumerate(zip(got[col], exp)):
            assert _close(g, e, case["relTol"]), f"{name}.{col}[{i}]: {g!r} != {e!r}"
```

- [ ] **Step 3: Write the failing vitest side**

```js
// app/src/components/chart/goldenFixtures.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeRSI, computeMACD, computeBB, computeStochastic, computeMFI, computeCCI, computeWilliamsR, computeVWAP } from './indicators'

const FIX = join(process.cwd(), '..', 'tests', 'fixtures', 'indicators')
const loadCase = (n) => JSON.parse(readFileSync(join(FIX, `${n}.json`), 'utf8'))
const alignedClose = (got, exp, relTol) => {
  expect(got.length).toBe(exp.length)                 // JS must be NaN-padded, not trimmed
  got.forEach((g, i) => {
    if (exp[i] === null) { expect(Number.isNaN(g)).toBe(true); return }
    expect(Math.abs(g - exp[i]) <= relTol * Math.max(1, Math.abs(exp[i]))).toBe(true)
  })
}
// one test per shared case, mapping the case's columns onto the JS return shape,
// plus the two VWAP session cases asserting the boundary behaviour directly.
```
(Write the concrete per-case bodies out in full — no "similar to above".)

- [ ] **Step 4: Add the tiny dispatch both sides need**

In `api/services/indicator_compute.py`, add ONE small pure helper — `compute_case(kind, bars, params) -> dict[str, list]` — that maps a fixture `kind` to the existing functions and returns a `{column: aligned_list}` dict. Pure dispatch, no new math. (This is the only production change in Task 4.)

- [ ] **Step 5: Run both sides — expect the JS side to FAIL on alignment** (JS trims today; that's what Task 5 fixes) and the Python side to PASS. Record both outcomes; the JS failures are the Task 5 to-do list, so mark those tests `it.fails(...)`/skip with an explicit TODO comment naming Task 5, or land Task 5 in the same wave — the implementer's call, stated in the report.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/indicators/ tests/test_indicator_golden.py app/src/components/chart/goldenFixtures.test.js api/services/indicator_compute.py
git commit -m "test(indicators): shared golden fixtures both lanes read

bars in, expected columns out, null-padded to input length, rel-tol 1e-9 -- the
same JSON files read by pytest and vitest, so the two implementations of RSI (and
six friends) can no longer drift silently. Includes the two session traps that
unit tests never catch: an extended-hours day crossing UTC midnight and a DST
transition, which is where the JS VWAP's UTC-day bucketing goes wrong.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Remove rounding from compute — both lanes — and align the JS outputs

**Files:**
- Modify: `app/src/components/chart/indicators.js` (every `parseFloat(x.toFixed(n))`; trimmed → NaN-padded returns)
- Modify: `api/services/indicator_compute.py` (every `round(x, n)`)
- Modify: `app/src/components/StockChart.jsx` — `indicatorData` memo (~:3878-3965) and the per-indicator `_applyData` blocks: NaN-padded arrays must become LWC **whitespace** items (`{time}` with no `value`), never `value: NaN`
- Test: the Task 4 fixtures (now must pass on both sides), plus `app/src/components/chart/indicators.test.js` updates

**Interfaces:**
- Produces: every compute function returns **unrounded** values, **input-length, NaN-padded** (JS) / `None`-padded (Python, already correct). Precision becomes presentation-only.
- **Ichimoku/SAR/OBV shape notes** (verified): `computeIchimoku`'s `chikou` is back-shifted 26 bars and `spanA/spanB` are NOT forward-displaced (a real deviation from standard Ichimoku); `computeParabolicSAR` returns a third field `isUptrend` the consumer strips; `computeOBV` is already full-length and seeds `{value: 0}`. **B1 preserves all three behaviors exactly** — pixel parity now, deliberate correction later in B3 with the owner's sign-off. State that in the module docstring.

**⚠️ Live-behavior decision that MUST be recorded, not silently made:** `indicator_compute.py` feeds the **running** indicator-alert evaluator. Removing its rounding shifts alert values by <0.005, which can flip a threshold comparison at a boundary. **Ruling for this plan: round at DELIVERY, not in compute** — i.e. keep the evaluator's behavior stable by rounding where it formats/compares, so compute becomes precise without changing what already-armed alerts do. Implement that in `indicator_alert_evaluator.py`'s **read** of the computed value only if a zero-risk one-line rounding at the comparison site is possible; if it is NOT possible without touching evaluator logic, STOP and report — do not modify evaluator logic under this plan (it's the Phase C seam).

- [ ] **Step 1: Confirm the JS fixture tests fail exactly on alignment/rounding.** Run the Task 4 vitest file; record the failures.

- [ ] **Step 2: Strip rounding + pad, one indicator at a time, JS side**

For each of the 14 compute functions: delete `parseFloat(...toFixed(n))`, and change the return to input-length with `NaN` before the first computable bar. Multi-output dicts keep their keys but all columns become the same length (this fixes `computeStochastic`'s `k`/`d` length mismatch and `computeADX`'s adx-vs-DI mismatch by construction). **Delete the per-point `color` strings from `computeMACD`'s histogram** (`indicators.js:73`) — color becomes a render concern (`colorMode: 'sign'` in B2); the StockChart MACD block must derive the up/down color itself in the same commit so the histogram looks identical.

- [ ] **Step 3: Strip rounding, Python side.** Remove every `round(...)` from `indicator_compute.py`; padding is already correct.

- [ ] **Step 4: Make the renderer NaN-safe**

In `StockChart.jsx`: the `indicatorData` memo's `adjustTime` re-map pass and each `_applyData` call must convert a NaN point to a whitespace item `{ time }` (LWC rejects `value: NaN`). Keep `_noop`/`_incr` render-plan semantics intact (they are the 30s-full-repaint fix — regressing them is a perf regression).

- [ ] **Step 5: Both fixture suites PASS**

Run: `python -m pytest tests/test_indicator_golden.py -q` → pass.
Run: `cd app && npx vitest run src/components/chart/goldenFixtures.test.js src/components/chart/indicators.test.js` → pass.
Run: full `npx vitest run src/components/chart/ src/hooks/` → pass.
Run: `python -m pytest tests/ -q` → only the known calendar date-bomb fails.

- [ ] **Step 6: Live visual check — REQUIRED**

Open a chart with RSI + MACD + Bollinger + Stochastic enabled. Confirm: lines start where they always did (no leading zeros at the left edge, no gap), MACD histogram bars are still green above / red below, and the crosshair legend still shows values. Record observations. **A NaN leaking into the renderer shows up as a line dropping to zero or the pane autoscaling to include 0 — look specifically for that.**

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/indicators.js app/src/components/chart/indicators.test.js api/services/indicator_compute.py app/src/components/StockChart.jsx
git commit -m "refactor(indicators): compute stops rounding and stops trimming

Both lanes rounded inside compute with different tie-breaking (JS toFixed is
half-away, Python round is banker's), so the shared fixtures could never agree at
1e-9. Precision is presentation, so compute now returns raw values, input-length
and NaN/None-padded -- which also removes Stochastic's k-vs-d and ADX's adx-vs-DI
length mismatches by construction, and moves the MACD histogram's colour out of
the data and into the renderer.

Ichimoku's non-displaced spans, SAR's isUptrend field and OBV's zero seed are
preserved exactly as-is: pixel parity first, deliberate correction later with the
owner's sign-off.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Unit-test the four untested natives

**Files:** Modify `app/src/components/chart/indicators.test.js`

**Interfaces:** Produces first-ever coverage for `computeStochastic`, `computeATR`, `computeIchimoku`, `computeParabolicSAR` — the four of fifteen that enter migration with **zero tests** today (the existing file imports only 11 of 15).

**Why:** Flip A gates each migrated indicator on parity; four of them currently have nothing to be parity against. Match the file's existing style: hand-computed expected values plus invariants.

- [ ] **Step 1: Write the tests** — for each: a known-value case computed by hand, an alignment case (output length == input length, leading NaNs), and one invariant (`ATR > 0`; `0 <= stoch.k <= 100`; Ichimoku `tenkan/kijun/spanA/spanB` all input-length and `chikou` back-shifted 26 bars **as currently implemented**; SAR flips `isUptrend` on a trend reversal and its value stays on the correct side of price).
- [ ] **Step 2: Run — they must fail if the function is broken.** Mutation-check one per function (e.g. flip ATR's true-range `max` to `min`) and confirm a failure; restore byte-identical.
- [ ] **Step 3: Full chart suite green.**
- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/indicators.test.js
git commit -m "test(indicators): cover the four natives that had no tests

Stochastic, ATR, Ichimoku and Parabolic SAR were imported by nothing in the test
file, so four of the fifteen would have entered the migration with no parity
baseline at all. Ichimoku's tests pin its CURRENT (non-standard) span behaviour
deliberately -- correcting it is a separate, owner-visible decision.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: The parity gate — deterministic per-indicator screenshot diff

**Files:**
- Modify: `app/src/pages/ChartRender.jsx` (add an indicator-settings param + a fixed-bars mode)
- Create: `tools/chart_parity.py` (capture + diff driver), `tools/chart_parity_cases.json` (the case list)
- Create: `docs/runbooks/chart-parity-gate.md` (how to run it, how to read a diff)

**Interfaces:**
- `ChartRender.jsx` gains: `?indicators=<base64url JSON>` merged into its existing `settingsOverride` path, and `?fixedbars=<name>` which loads a committed bar fixture instead of live data (determinism — live bars make two runs differ). Keeps its existing `window.__chartReady` contract (set false, then true after settings land + settle).
- `tools/chart_parity.py`: `capture(case, out_png)` drives Playwright to the route, waits for `window.__chartReady === true`, and screenshots **the `#chart-export` element** (not the full page); `diff(a_png, b_png)` returns `(pct_pixels_changed, diff_png)`; `main()` runs every case in `chart_parity_cases.json` against two base URLs (legacy build vs engine build) and writes a report. Threshold: **0 changed pixels** for a Flip A migration (renders into the same legacy bands, so it must be pixel-identical), with an explicit `--tolerance` escape that must be justified per case in the report.
- Produces the runbook so B3 can invoke the gate as a one-liner per indicator.

**Why (verified facts):** §9.3's parity gate has **no existing tooling** — a repo-wide grep for `pixelmatch|toMatchImageSnapshot|percy|image.diff|visual.regression` returns zero hits, and `tools/mobile_audit.py` screenshots **full pages** after a 2.5s wall-clock settle with live streaming data (non-deterministic, and it never compares two images). But `ChartRender.jsx` is already a token-gated headless chart route with a `window.__chartReady` flag, a `#chart-export` element, and `settingsOverride` plumbing — 80% of the harness. Extending it is far cheaper and more honest than building from zero. Note `chartScreenshot.js` is the wrong tool here: it *re-draws* overlays rather than capturing them, so a baseline built on it tests the compositor, not the chart.

- [ ] **Step 1: Extend `ChartRender.jsx`**

Add the two params, merged into the existing settings path; keep `__chartReady` semantics (must still only go true after settings have landed). Add a short comment naming this route as the parity-gate surface so nobody "simplifies" the flag away.

- [ ] **Step 2: Write `tools/chart_parity.py`**

Playwright sync API (the repo's existing pattern — see `tools/mobile_audit.py` for the auth trick and viewport setup). Element-clipped screenshot via `page.locator('#chart-export').screenshot(path=...)`. Diff with Pillow (already a dependency): same-size assert, per-pixel compare, changed-pixel count + a red-highlight diff image. No new npm deps.

- [ ] **Step 3: Seed `tools/chart_parity_cases.json`** with the Flip A pilot cases: `bb_only`, `rsi_only`, `macd_only`, `bb_rsi_macd`, each pinned to a `fixedbars` fixture and one chart preset, plus one case per remaining native (names only — B3 fills them in).

- [ ] **Step 4: Prove the gate can FAIL**

Capture a baseline, then change one indicator's color by one hex digit via the `?indicators=` param and re-capture. The diff MUST report a non-zero changed-pixel count. Then re-capture with the identical param and confirm **0** changed pixels across two consecutive runs (determinism proof). **Both numbers go in the report** — a parity gate that hasn't been shown to fail, and to be stable, is not a gate.

- [ ] **Step 5: Write the runbook** — exact commands, what `__chartReady` waits on, what a nonzero diff means, and the rule that a tolerance > 0 must be justified in writing per case.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/ChartRender.jsx tools/chart_parity.py tools/chart_parity_cases.json docs/runbooks/chart-parity-gate.md
git commit -m "test(chart): a parity gate that can actually fail

The migration plan is gated on per-indicator screenshot diffs, and the repo had
no diffing at all -- mobile_audit screenshots whole pages after a wall-clock
settle against live bars, which cannot be compared run to run. This rides the
existing headless ChartRender route instead: token-gated, window.__chartReady,
#chart-export element, plus a fixed-bars mode so two runs are identical. Proven
both ways: zero changed pixels on a repeat run, nonzero on a one-hex-digit
colour change.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Verification + branch handoff (NO master push)

**Files:** none — verification only.

- [ ] **Step 1: Full backend suite** — `python -m pytest tests/ -q`. Expected: only the known `test_calendar_paging::test_month_unknown_hour_lands_in_tbd` failure. Any other failure is yours; fix or report.
- [ ] **Step 2: Full frontend chart+hooks suites** — `cd app && npx vitest run src/components/chart/ src/hooks/` → all pass. Also `npx vitest run src/` for the wider frontend and note any pre-existing flakes (`ModelBook.test.jsx` is a known one under full-suite load).
- [ ] **Step 3: `npm run build`** → clean. Confirm `dist/assets/*.css` contains the new `--ind-*` vars (CSS-modules hashing means verifying against source is not enough).
- [ ] **Step 4: Parity gate self-check** — re-run `tools/chart_parity.py` twice on the same build; confirm 0 changed pixels both times.
- [ ] **Step 5: Push the BRANCH only (backup, not deploy)**

```bash
git push -u origin feat/phase-b1-foundations
```
⛔ **Never `feat/phase-b1-foundations:master`.** Phase B ships after the Sep 5 launch freeze.

- [ ] **Step 6: Report** — the B1 exit state: renderer pinned, passthrough live, tokens locked, fixtures green on both lanes, four natives covered, parity gate proven. List anything deferred to B2/B3 with a reason. Note explicitly which B1 subsets could ship early if the owner asks (fixtures/tests are inert; the renderer pin and the NaN-padding change are NOT).

---

## Self-review notes

- **Spec coverage:** §5 safeguard #1 (passthrough) → T2 · §7 tokens → T3 · §9.1 fixtures + rounding ban → T4/T5 · §9.3 parity gate → T7 · plan step 0 (LWC bump) → T1. Engine/binding/instance-manager (§4, §5) are deliberately **B2** — this plan builds no engine.
- **Ground-truth drift handled:** stale-checkout trap (Global Constraints) · node_modules junction (T0) · `--warn`=gold (T3) · JS-not-CSS themes (T3) · fixtures don't exist (T4) · no diff tooling + `ChartRender.jsx` is the foundation (T7) · four untested natives (T6) · JS-trimmed vs Python-padded (T5) · caret floats to 5.2.0 (T1) · rounding shifts live alert values (T5, with an explicit stop-and-report rule).
- **Not in B1, deliberately:** `volumeProfile` carve-out (canvas overlay, no compute fn, no expressible plot style) → B3 · `indicatorRegistry.js` absorb-or-supersede decision → B2 (it's a half-built `inputs[]` layer; B2 must not duplicate it) · the 9 enumeration sites incl. hide-all-indicators (:8078) and the crosshair legend (:7552) → B2/B4 · Ichimoku/SAR input-coverage and math corrections → B3 with owner sign-off · `setPref` blind-whole-blob write (a live concurrency bug) → B2 with the instance-list write path.
- **Type consistency:** `resolveToken`/`ALPHA`/`IND_TOKENS` (T3) are what B2's plot `color: 'token:*'` refs consume; the fixture contract (T4) is what T5 satisfies and what B3's per-indicator gates extend; `compute_case` (T4) is pure dispatch and adds no math.
