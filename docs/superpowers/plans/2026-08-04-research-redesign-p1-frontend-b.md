# Research Redesign P1-Frontend-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the chart half and the shell half of `app/src/components/research-kit/` — the shared `echarts/core` entry point plus `LollipopChart`, `ReactionBars`, `ImpliedVsRealized`, `RevisionColumns`, `Histogram`, `RatingCrown`, `CheckupRow`, `HeatGrid`, `MetricTrendChart`, and the shell trio `IdentityBanner` / `SectionRail` / `PinnedFooter` — each with tests, and clear the P1F-A review punch list. After this task list the §3.4 component library is complete and P2 (launch modal) and P3 (page rebuild) are pure composition.

**Architecture:** P1F-A shipped the eight non-chart primitives at `research-kit/` root. P1F-B adds two subdirectories: `research-kit/charts/` (every visualization) and `research-kit/shell/` (the three pinned chrome components). **One** module — `charts/echartsCore.js` — imports `echarts/core` + exactly the charts/components the kit draws, calls `echarts.use()` once, and exports a thin `EChart` wrapper over `echarts-for-react/lib/core`; no other file in the repo's new code may import `echarts` or `echarts-for-react`. Meters, rings, strips and paired bars are hand-drawn SVG/CSS (0 KB, the house `MarketBreadth` gauge / `FuturesStrip` spark precedent). Every chart's geometry or option construction lives in an **exported pure function** so it is unit-testable without a canvas.

**Tech Stack:** React 19.2, Vite 7, CSS Modules, vitest 4 + @testing-library/react + jsdom, `echarts@6.0.0` + `echarts-for-react@3.0.6` (both already installed). **Zero new dependencies.**

## Global Constraints

Read every bullet before Task 1. These are verbatim, already-verified facts — do not re-derive them.

**Where / how to work**

- Worktree: `C:\Users\Patrick\uct-worktrees\research-redesign` (branch `feat/research-calendar-redesign`, currently clean at `30ce4455`). Spec: `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md`. Predecessor plan: `docs/superpowers/plans/2026-08-03-research-redesign-p1-frontend-a.md`.
- **`app/node_modules` is a junction** to `C:\Users\Patrick\uct-dashboard\app\node_modules` (created during P1F-A). **Never delete it.** If `npx vitest` fails with `Cannot find package 'vite'`, recreate it:
  ```
  cmd /c mklink /J "C:\Users\Patrick\uct-worktrees\research-redesign\app\node_modules" "C:\Users\Patrick\uct-dashboard\app\node_modules"
  ```
- **Test command (verified):** `cd app && npx vitest run <path>`. If a single file OOMs the fork pool, the house fallback is `cd app && npx vitest run --pool=threads <path>`.
- **Build command:** `cd app && npm run build` (`vite build`). Required in Task 1 and Task 8.
- Commit after every task. **Never `git add -A`** — this is a shared worktree; `git add` only the files the task names. **Do not push.** Public surfaces ship only on explicit owner approval and inside the deploy window (§9).
- Do not touch partner-owned files: `app/src/pages/OptionsFlow.jsx`, `app/src/pages/OptionsFlow_admin.jsx`, `api/routers/schwab_router.py`, `api/routers/live_massive_router.py`, `api/massive_ws_worker.py`, `api/services/massive_processor.py`.
- Do not touch the 5 existing full-entry echarts imports (`pages/BreadthCharts.jsx`, `pages/breadth/views/TreemapView.jsx`, 3 Journal 2.0 files). Migrating them is **P5**, explicitly out of scope here.

**Design law (spec §3) — unchanged from P1F-A, re-stated because these tasks are executed context-free**

- **Breakpoints — only 640 and 1024 exist.** Copy these exact strings; never invent a literal:
  - PHONE `@media (max-width: 640px)`
  - TABLET `@media (min-width: 641px) and (max-width: 1024px)`
  - TOUCH `@media (max-width: 1024px)`
  - DESKTOP `@media (min-width: 1025px)`
- **CSS modules + tokens only. No inline layout styles.** Permitted computed-geometry exceptions in THIS plan (each one is a number that cannot be a token): SVG attribute values (`x`, `y`, `width`, `height`, `cx`, `cy`, `d`, `stroke-dasharray` — these are attributes, not styles), the `style={{ height }}` a chart wrapper sets from its exported `SIZE`, and `style={{ width: '…%' }}` on a heat cell's inner bar. Everything else is a class in a `.module.css` reading `var(--…)`.
- **No emoji.** Iconography is `app/src/components/ui/UIcon.jsx`. Confirmed glyph names used here: `check`, `x`, `chart`, `document`, `search`, `clock`, `warning`, `info`, `chevronRight`. Geometric text markers `▲ ▼ ◆ ★ — → ± ✓` are sanctioned by CLAUDE.md and are NOT emoji.
- **`.t-num` on every numeric that can change or be compared.** Global plain class from `tokens.css`; apply as a literal string beside the module class: ``className={`${styles.value} t-num`}``.
- **Hue is never the sole channel (§3.3, normative).** In this plan specifically: `ImpliedVsRealized` solid bars are **signed** (down-closes descend below the baseline) and expectation bars are **hollow**; beat/miss dots are **shape-coded** (beat = solid disc, miss = hollow ring); `HeatGrid` cells always show the **signed number in uniform ink**; `LollipopChart`'s estimate dot is always hollow and the next-quarter one is **dashed**.
- **Contrast floor (§3.2):** text <18px must read ≥4.5:1 on its *composited* background. `--text-muted` (`#8c8674`) is the dimmest ink permitted on glass. Never go dimmer. Chart labels use `--text-muted` or brighter.
- **Gold restraint (§3.1, normative):** `--glass-border-accent` (gold) appears only on the banner, the ONE hero widget per canvas, and the active rail item. **Maximum one gold data-highlight per canvas.** Max one glow component per view. No gradient text, no text-shadow, no glowing marks on data elements. Two components here draw in gold and they are deliberately on **different canvases**: `ReactionBars`' implied ± bracket (Earnings History canvas, §4.3.2) and `ImpliedVsRealized`' RICH/CHEAP `VerdictChip` (Setup canvas, §4.3.1a). `ImpliedVsRealized`'s current-quarter highlight is therefore **not** gold — it is a brighter stroke plus a `NOW` tick. Task 8 ships the test helper that enforces the one-accent rule.
- **No `backdrop-filter` in the kit.** §3.1 limits it to the modal backdrop (perf).
- **"Verdict" never appears in user-facing copy (§12).** `VerdictChip` is an internal name; rendered strings say "PREMIUM RICH", "Setup Grade", "UCT Rating".
- **One ticking element per banner (§3.1).** `IdentityBanner` renders a `countdown` **slot** and never owns a timer; prices update without animation.
- **Motion (Part C rule 8):** one mount animation per surface, ≤300 ms, reduced-motion-gated. `EChart` disables ECharts animation when `prefers-reduced-motion: reduce` matches; the `RatingCrown` ring sweep is gated by the CSS media query.

**The chart testing seam (NORMATIVE for this plan)**

jsdom has no canvas: `HTMLCanvasElement.getContext('2d')` returns `null`, so a real ECharts instance cannot render in a test. Therefore **every chart gets two kinds of test**:

1. **Pure data-transform tests** — the exported option-builder / geometry function is called directly and its *returned object* is asserted (series types, encoded data, axis domain, tier classes, bar rectangles). No React, no DOM, no mock. This is where chart correctness is actually proven.
2. **Mount smoke tests** — the component is rendered with `echarts-for-react/lib/core` mocked at the top of the file (the house idiom, verified at `app/src/pages/breadth/views/TreemapView.test.jsx:5`):
   ```jsx
   vi.mock('echarts-for-react/lib/core', () => ({ default: (props) => { captured = props.option; return <div data-testid="echart" /> } }))
   ```
   Mocking the *React wrapper* — not `echarts/core` — keeps `echartsCore.js`'s real `echarts.use([...])` registration in the code path, so a typo'd or missing registration still fails the test. These assert: renders without throwing, `role="img"` + built `aria-label`, EmptyState on empty data, and that the option handed to ECharts is the builder's output.

SVG components (`ReactionBars`, `ImpliedVsRealized`, `RatingCrown`) need no mock — jsdom renders SVG elements fine. They still split the same way: pure geometry function + render test.

**Vitest runs with `css: false`**, so a CSS-module import resolves each key to the **key string** (`styles.accent` → `'accent'`). Two consequences used deliberately: class assertions in render tests match the key name, and any test that must prove a CSS *rule* exists reads the `.module.css` off disk (the `toneClasses.test.js` / `tokens.test.js` technique).

**Token / prop vocabulary (fixed — later tasks depend on exact spelling)**

- Tokens already shipped by P1F-A Task 1 and consumed here (values verified in `app/src/styles/tokens.css`): `--score-elite #3cb868` / `-strong #7fb84e` / `-neutral #c9a84c` / `-weak #e08a3c` / `-poor #e74c3c`; `--grade-a…-f` (aliases of the ramp); `--heat-g3 rgba(10,50,22,0.97)` / `-g2 rgba(22,100,48,0.80)` / `-g1 rgba(74,222,128,0.16)` / `-a rgba(180,130,20,0.32)` / `-r1 rgba(248,113,113,0.16)` / `-r2 rgba(160,25,25,0.80)` / `-r3 rgba(55,6,6,0.97)`; `--glass-surface`, `--glass-elevated`, `--glass-border-neutral`, `--glass-border-accent`, `--glass-chrome`, `--glass-inner-glow`, `--focus-ring`, `--text-display 40px`.
- Existing tokens reused: `--gain #3cb868`, `--loss #e74c3c`, `--warn #c9a84c`, `--ut-gold #c9a84c`, `--info #6ba3be`, `--text #b6b09d`, `--text-muted #8c8674`, `--text-bright #e0dac8`, `--text-heading #f0ead8`, `--bg #0e0f0d`, `--text-xs/-sm/-base/-lg/-xl` 10/11/12/14/16, `--space-xs/sm/md/lg/xl` 4/8/12/16/24, `--radius-sm/md/lg/xl` 4/6/8/12, `--ls-label`, `--ls-normal`, `--lh-snug`, `--font-sans`, `--duration-fast`, `--ease-out`, `--shadow-popover`, `--z-dropdown`, `--tap-min 44px`.
- **Two tone vocabularies exist and must not be blended** (`research-kit/tones.js`): `SCORE_TONES = ['elite','strong','neutral','weak','poor']` (StatTile + RatingCrown chips) and `VERDICT_TONES = ['positive','negative','caution','neutral','gold']` (VerdictChip, RangeSlider). Every consumer falls back to its own `neutral` on an unknown value rather than throwing.
- **Prop names are consistent with the shipped P1F-A barrel:** `label`, `info`, `className`, `compact`, `tone`, `ariaLabel`, `onRetry`. New shared props introduced here: `height` (px, defaults to the component's `SIZE.height`), `ariaLabel` (overrides the built one).
- **Every chart exports `SIZE = { width, height }`** — the §3.4 skeleton size contract that `SkeletonBlock size={…}` consumes (`app/src/components/Skeleton.jsx:22` already documents this exact idiom with `LollipopChart` as its example).

**Resolved unknowns (do not re-investigate)**

- **`echarts/core` is real ESM** (`export * from './lib/export/core.js'`) and the package `exports` map publishes `./core`, `./charts`, `./components`, `./renderers`. Verified exports: `echarts/core` → `use`, `init`, `getInstanceByDom`; `echarts/charts` → `BarChart`, `CustomChart`, `LineChart`, `ScatterChart`, `PictorialBarChart`, …; `echarts/components` → `GridComponent`, `TooltipComponent`, `MarkLineComponent`, `AxisPointerComponent`, `LegendComponent`, `GraphicComponent`, …; `echarts/renderers` → `CanvasRenderer`, `SVGRenderer`.
- **`echarts-for-react/lib/core` exists and default-exports the class component** (`EChartsReactCore`, v3.0.6). Its peer range accepts `echarts ^6.0.0` and React `>=16`; it is a thin imperative wrapper, which is why it survives React 19.
- **The kit needs exactly these registrations:** `BarChart` (RevisionColumns, Histogram, MetricTrendChart), `CustomChart` (LollipopChart), `GridComponent`, `TooltipComponent`, `MarkLineComponent`, `AxisPointerComponent`, `CanvasRenderer`. **`LineChart`, `ScatterChart`, `LegendComponent` are deliberately NOT registered** — no kit chart draws a line series, the lollipop dots are drawn inside the custom series, and Part C rule 5 bans legends in favour of direct labels.
- **Bundle expectation, honest version (spec §3.4):** `vendor-echarts` currently contains **all** of echarts because 5 full-entry imports survive elsewhere. This plan therefore **cannot shrink** the chunk; the shrink lands in P5. What Task 1 must prove is the *no-growth* half: the tree-shaken imports resolve to modules already in the chunk, so the delta is a couple of KB of re-export shims, not a second copy of echarts. Anything larger means the core entry is not resolving and the task is wrong.
- **`manualChunks` stays object-form** (`app/vite.config.js`): `'vendor-echarts': ['echarts', 'echarts-for-react']`. Do not add `'echarts/core'` to it — function-form/entry-splitting regressions are a known outage class (`feedback_vite_manualchunks_object_form`).
- **Canvas cannot read CSS custom properties.** `app/src/utils/chartFont.js` already exists for exactly this reason (`CHART_FONT_FAMILY`); `echartsCore.js` adds `CHART_INK` in the same spirit and a cross-file test pins it to `tokens.css`.
- **Backend payload shapes the props are designed against** (P2 wires them with no adapter):
  - Expected move — `GET /api/research/expected-move/{sym}` (`api/routers/expected_move.py`) returns `{ live, history, history_since }`. `live` = `{ pct, dollar, expiry, strike, spot, iv_atm, horizon, source }` (`api/services/implied_move.py`). `history` rows = `{ sym, report_date, captured_at, pct, dollar, expiry }`, newest-first, ≤8 (`implied_store.get_implied_history`). `history_since` = `MIN(report_date)` or `null`.
  - Ratings — `GET /api/research/ratings/{sym}` returns `{ sym, composite, components: { eps, rs, growth, value, smr, accdis, sponsorship }, checkup: [{ label, status: 'pass'|'fail'|'neutral', value }], method, basis: 'absolute'|'percentile', universe_n, sector, group_rs, group_sector_n }` (`api/services/research/ratings.py`). `eps/rs/growth/value` are 0–99 numbers; `smr/accdis/sponsorship` are letters A–E.
  - Financials — `GET /api/research/financials/{sym}` returns `{ annual: rows, quarterly: rows, balance, metrics }` where each row is `{ period, revenue, net_income, eps, gross_margin, operating_margin, net_margin, revenue_yoy, eps_yoy }`, **newest-first**.
  - Earnings history — `GET /api/research/earnings-history/{sym}` **does not exist yet** (spec §6 row 3, built in P4; P2 composes it client-side in the interim). Its row shape is fixed HERE so both sides agree: `{ quarter, report_date, period_end, session: 'bmo'|'amc'|null, reported: bool, eps_estimate, eps_estimate_low, eps_estimate_high, eps_actual, surprise_pct, revenue_estimate, revenue_actual, revenue_surprise_pct, reaction_pct, gap_pct, drift_pct }`, **oldest-first**. `reaction_pct` is the next-stored-bar close-to-close move. Every field except `quarter` may be `null`.
  - Revisions — `GET /api/research/estimates/{sym}` today returns `revisions` bucketed by fiscal **period** (`{ period, current, ago30, ago90, up30, down30 }`), not by week. Spec §6 promises server-side **weekly** bucketing. `RevisionColumns` therefore takes a neutral `buckets: [{ label, up, down }]` array so the interim period buckets and the final weekly buckets both fit with no component change.

## File Structure

- `app/src/components/research-kit/charts/` — CREATE: `echartsCore.js(+.module.css)`, `LollipopChart.jsx(+.module.css)`, `ReactionBars.jsx(+.module.css)`, `ImpliedVsRealized.jsx(+.module.css)`, `RevisionColumns.jsx(+.module.css)`, `Histogram.jsx(+.module.css)`, `HeatGrid.jsx(+.module.css)`, `MetricTrendChart.jsx(+.module.css)`, plus a `.test.jsx` per component and `echartsCore.test.jsx`.
- `app/src/components/research-kit/RatingCrown.jsx(+.module.css+.test.jsx)`, `CheckupRow.jsx(+.module.css+.test.jsx)` — root, beside the P1F-A primitives (they are not charts).
- `app/src/components/research-kit/shell/` — CREATE: `IdentityBanner.jsx(+.module.css+.test.jsx)`, `SectionRail.jsx(+.module.css+.test.jsx)`, `PinnedFooter.jsx(+.module.css+.test.jsx)`.
- `app/src/components/research-kit/testing/restraint.js` + `restraint.test.jsx` — CREATE (test helper, never imported by runtime code).
- `app/src/components/research-kit/index.js` — MODIFY in every task (the barrel).
- `app/src/components/research-kit/toneClasses.test.js` — MODIFY (Task 8: live `TONE_CLASS` import).
- `app/src/components/research-kit/{StatTile,VerdictChip,RangeSlider}.jsx` — MODIFY (Task 8: export `TONE_CLASS`).
- `app/src/components/research-kit/{InfoTip,EyebrowLabel,VerdictChip,ConsensusBar}.jsx` + `InfoTip.module.css` + `InfoTip.test.jsx` + `ConsensusBar.test.jsx` — MODIFY (Task 8 punch list).
- `app/src/styles/tokens.test.js` — MODIFY (Task 8: `--text-bright` joins the contrast matrix).

---

### Task 1: `echartsCore` shared module + `LollipopChart`

**Files:**
- Create: `app/src/components/research-kit/charts/echartsCore.js`, `charts/echartsCore.module.css`, `charts/LollipopChart.jsx`, `charts/LollipopChart.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/charts/echartsCore.test.jsx`, `charts/LollipopChart.test.jsx` (create)

**Interfaces:**
- Consumes: `echarts/core`, `echarts/charts`, `echarts/components`, `echarts/renderers`, `echarts-for-react/lib/core`, `app/src/utils/chartFont.js` (`CHART_FONT_FAMILY`), `EmptyState` + `EyebrowLabel` (P1F-A).
- Produces:
  - `EChart` (default export of `echartsCore.js`) — `({ option, height, ariaLabel, className, onEvents, testId })`.
  - `echarts` (the registered core namespace), `CHART_INK`, `GRID_BASE`, `axisBase()`, `TOOLTIP_BASE`, `prefersReducedMotion()`.
  - `LollipopChart({ quarters, label, info, height, className, ariaLabel, valueFormatter })` + `SIZE`, `beatState()`, `yDomain()`, `horizonLabel()`, `renderLollipopItem()`, `buildLollipopOption()`.

**Design notes (read before writing code):**
- The lollipop is ONE `custom` series, not four stacked bar series. `renderItem` draws, per quarter: the analyst hi/lo whisker (muted, capped), the estimate→actual stem, the **always-hollow** estimate dot (dashed ring when the quarter has not reported — that is the §4.3.2 "dashed next-quarter estimate"), and the solid actual dot coloured by beat/miss. This keeps the registration to `CustomChart` only and, crucially, makes `renderLollipopItem` a **pure function of `(params, api)`** that a test can drive with a stub `api`.
- `horizonLabel()` derives "8 quarters · Q3 24 – Q2 26" **from the data**. Never hardcode "8 quarters".
- `<2` quarters → `EmptyState`. One dot is not a trend.

- [ ] **Step 0: Record the pre-change bundle baseline**

Before writing any code, capture the current `vendor-echarts` size. This is the control for the Step 4 assertion — without it the build check is unfalsifiable.

```
cd app && npm run build 2>&1 | grep -E "vendor-echarts|vendor-charts"
```

Bash alternative (reads the emitted files directly):
```
ls -l app/dist/assets/vendor-echarts-*.js app/dist/assets/vendor-charts-*.js
```
PowerShell equivalent:
```
Get-ChildItem app/dist/assets/vendor-echarts-*.js | Select-Object Name, Length
```

Write the two numbers (raw kB and gzip kB) into the Step 4 checklist below before continuing.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/charts/echartsCore.test.jsx`:

```jsx
// Two things are asserted here that nothing else can catch:
//   1. the registration list is EXACTLY the kit's needs (source-text oracle) —
//      the moment someone adds `import 'echarts'` or registers the whole
//      bundle, this fails instead of the bundle silently doubling;
//   2. CHART_INK matches tokens.css — canvas can't read CSS variables, so the
//      hexes are mirrored by hand and would otherwise fork silently.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => {
    captured = props
    return <div data-testid="echart-inner" />
  },
}))

import EChart, { CHART_INK, GRID_BASE, echarts, prefersReducedMotion } from './echartsCore'

// Strip BOTH comment forms: this file's own header quotes the banned
// `from 'echarts-for-react'` import in prose, and a source-text test that reads
// its own documentation is a false failure waiting to happen.
const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const SOURCE = read('./echartsCore.js')
const TOKENS = read('../../../styles/tokens.css')

/** Declared value of a custom property inside the first :root block. */
function rootDecl(prop) {
  const i = TOKENS.indexOf(':root')
  const open = TOKENS.indexOf('{', i)
  let depth = 0
  let body = ''
  for (let j = open; j < TOKENS.length; j++) {
    if (TOKENS[j] === '{') depth++
    else if (TOKENS[j] === '}') {
      depth--
      if (depth === 0) { body = TOKENS.slice(open + 1, j); break }
    }
  }
  const re = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`)
  const m = re.exec(body)
  return m ? m[1].trim() : null
}

describe('echartsCore — tree-shaken registration (§3.4)', () => {
  it('imports from echarts/core, never the full entry', () => {
    expect(SOURCE).toMatch(/from 'echarts\/core'/)
    expect(SOURCE).not.toMatch(/from 'echarts'/)
    expect(SOURCE).not.toMatch(/from "echarts"/)
    expect(SOURCE).toMatch(/from 'echarts-for-react\/lib\/core'/)
    // The full React wrapper entry pulls the full echarts entry with it.
    expect(SOURCE).not.toMatch(/from 'echarts-for-react'/)
  })

  it('registers exactly the modules the kit draws — no more', () => {
    const use = /echarts\.use\(\[([\s\S]*?)\]\)/.exec(SOURCE)
    expect(use).not.toBeNull()
    const registered = use[1].split(',').map((s) => s.trim()).filter(Boolean).sort()
    expect(registered).toEqual([
      'AxisPointerComponent',
      'BarChart',
      'CanvasRenderer',
      'CustomChart',
      'GridComponent',
      'MarkLineComponent',
      'TooltipComponent',
    ])
  })

  it('exposes the registered core namespace', () => {
    expect(typeof echarts.use).toBe('function')
    expect(typeof echarts.init).toBe('function')
  })
})

describe('echartsCore — CHART_INK mirrors tokens.css', () => {
  it.each([
    ['gain', '--gain'],
    ['loss', '--loss'],
    ['gold', '--ut-gold'],
    ['text', '--text'],
    ['muted', '--text-muted'],
    ['bright', '--text-bright'],
  ])('CHART_INK.%s === %s', (key, token) => {
    expect(CHART_INK[key]).toBe(rootDecl(token))
  })
})

describe('EChart wrapper', () => {
  const option = { series: [{ type: 'bar', data: [1, 2] }] }

  it('renders role=img with the given aria-label (canvas is otherwise mute)', () => {
    render(<EChart option={option} ariaLabel="Quarterly EPS" />)
    expect(screen.getByRole('img', { name: 'Quarterly EPS' })).toBeInTheDocument()
  })

  it('reserves the height it is given (the SIZE contract)', () => {
    render(<EChart option={option} ariaLabel="x" height={240} />)
    expect(screen.getByRole('img', { name: 'x' })).toHaveStyle({ height: '240px' })
  })

  it('hands the option straight through and asks for the canvas renderer', () => {
    render(<EChart option={option} ariaLabel="x" />)
    expect(captured.option.series).toEqual(option.series)
    expect(captured.opts).toEqual({ renderer: 'canvas' })
    expect(captured.notMerge).toBe(true)
  })

  it('animates by default and not under prefers-reduced-motion', () => {
    render(<EChart option={option} ariaLabel="x" />)
    expect(captured.option.animation).toBe(true)      // test-setup's matchMedia stub returns matches:false

    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} })
    expect(prefersReducedMotion()).toBe(true)
    render(<EChart option={option} ariaLabel="y" />)
    expect(captured.option.animation).toBe(false)
    spy.mockRestore()
  })
})
```

Create `app/src/components/research-kit/charts/LollipopChart.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import LollipopChart, {
  SIZE, beatState, yDomain, horizonLabel, renderLollipopItem, buildLollipopOption,
} from './LollipopChart'
import { CHART_INK } from './echartsCore'

/** Oldest-first, exactly the earnings-history row shape (§6 row 3). */
const Q = (over = {}) => ({
  quarter: 'Q1 26', report_date: '2026-02-04', period_end: '2025-12-31', session: 'amc',
  reported: true, eps_estimate: 1.0, eps_estimate_low: 0.9, eps_estimate_high: 1.1,
  eps_actual: 1.2, surprise_pct: 20, reaction_pct: 3.1, ...over,
})
const ROWS = [
  Q({ quarter: 'Q1 25', eps_estimate: 0.8, eps_actual: 0.9 }),
  Q({ quarter: 'Q2 25', eps_estimate: 0.9, eps_actual: 0.85 }),
  Q({ quarter: 'Q3 25', eps_estimate: 1.0, eps_actual: 1.0 }),
  Q({ quarter: 'Q4 25', eps_estimate: 1.1, eps_actual: 1.4 }),
  Q({ quarter: 'Q1 26', reported: false, eps_actual: null, surprise_pct: null }),
]

describe('beatState', () => {
  it('is beat above the estimate, miss below, inline on the number', () => {
    expect(beatState(Q({ eps_estimate: 1, eps_actual: 1.2 }))).toBe('beat')
    expect(beatState(Q({ eps_estimate: 1, eps_actual: 0.8 }))).toBe('miss')
    expect(beatState(Q({ eps_estimate: 1, eps_actual: 1 }))).toBe('inline')
  })

  it('is null for a quarter that has not reported, or with missing numbers', () => {
    expect(beatState(Q({ reported: false }))).toBeNull()
    expect(beatState(Q({ eps_actual: null }))).toBeNull()
    expect(beatState(Q({ eps_estimate: undefined }))).toBeNull()
    expect(beatState(null)).toBeNull()
  })
})

describe('yDomain', () => {
  it('spans every finite estimate, actual and whisker end with headroom', () => {
    const [min, max] = yDomain(ROWS)
    expect(min).toBeLessThan(0.8)
    expect(max).toBeGreaterThan(1.4)
  })

  it('never returns a degenerate domain', () => {
    const [min, max] = yDomain([Q({ eps_estimate: 1, eps_actual: 1, eps_estimate_low: 1, eps_estimate_high: 1 })])
    expect(max).toBeGreaterThan(min)
  })

  it('returns null when nothing is finite', () => {
    expect(yDomain([{ quarter: 'Q1', eps_estimate: null, eps_actual: null }])).toBeNull()
    expect(yDomain([])).toBeNull()
  })
})

describe('horizonLabel — the horizon comes from the data, never hardcoded', () => {
  it('names the count and both ends', () => {
    expect(horizonLabel(ROWS)).toBe('5 quarters · Q1 25 – Q1 26')
  })

  it('degrades gracefully on a single quarter', () => {
    expect(horizonLabel([Q({ quarter: 'Q4 25' })])).toBe('1 quarter · Q4 25')
  })
})

describe('renderLollipopItem — the drawing contract (pure, canvas-free)', () => {
  // Stub api: x = index*20, y = 200 - value*100.
  const apiFor = (row) => ({
    value: (i) => row[i],
    coord: ([x, y]) => [x * 20, 200 - y * 100],
  })
  // [index, estimate, actual, low, high, reported]
  const beat = [1, 1.0, 1.2, 0.9, 1.1, 1]
  const miss = [2, 1.0, 0.8, 0.9, 1.1, 1]
  const next = [3, 1.3, null, null, null, 0]

  const kinds = (g) => g.children.map((c) => c.type)

  it('draws whisker, stem, hollow estimate and solid actual for a reported beat', () => {
    const g = renderLollipopItem({}, apiFor(beat))
    expect(g.type).toBe('group')
    expect(kinds(g)).toEqual(['line', 'line', 'line', 'line', 'circle', 'circle'])
    const [estDot, actDot] = g.children.slice(-2)
    expect(estDot.style.fill).toBe('transparent')          // expectation is ALWAYS hollow (§3.3)
    expect(actDot.style.fill).toBe(CHART_INK.gain)          // realized beat is solid green
  })

  it('colours the actual dot red on a miss', () => {
    const g = renderLollipopItem({}, apiFor(miss))
    expect(g.children.at(-1).style.fill).toBe(CHART_INK.loss)
  })

  it('draws the not-yet-reported quarter as a DASHED hollow ring and no actual dot', () => {
    const g = renderLollipopItem({}, apiFor(next))
    expect(kinds(g)).toEqual(['circle'])
    const ring = g.children[0]
    expect(ring.style.fill).toBe('transparent')
    expect(ring.style.lineDash).toEqual([3, 3])
  })

  it('omits the whisker when the analyst hi/lo is missing', () => {
    const g = renderLollipopItem({}, apiFor([0, 1.0, 1.1, null, null, 1]))
    expect(kinds(g)).toEqual(['line', 'circle', 'circle'])   // stem + 2 dots, no whisker
  })

  it('draws nothing when even the estimate is missing', () => {
    expect(renderLollipopItem({}, apiFor([0, null, null, null, null, 0])).children).toEqual([])
  })
})

describe('buildLollipopOption', () => {
  it('builds ONE custom series over the encoded quarter rows', () => {
    const opt = buildLollipopOption(ROWS)
    expect(opt.series).toHaveLength(1)
    expect(opt.series[0].type).toBe('custom')
    expect(opt.series[0].renderItem).toBe(renderLollipopItem)
    expect(opt.series[0].data).toHaveLength(ROWS.length)
    expect(opt.series[0].data[0]).toEqual([0, 0.8, 0.9, 0.9, 1.1, 1])
    expect(opt.series[0].data[4][5]).toBe(0)                 // the unreported quarter
  })

  it('labels the x axis with the quarters, oldest first', () => {
    expect(buildLollipopOption(ROWS).xAxis.data).toEqual(['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26'])
  })

  it('pins the y domain from the data and hides the axis spine (Part C rule 5)', () => {
    const opt = buildLollipopOption(ROWS)
    expect(opt.yAxis.min).toBe(yDomain(ROWS)[0])
    expect(opt.yAxis.max).toBe(yDomain(ROWS)[1])
    expect(opt.yAxis.axisLine.show).toBe(false)
    expect(opt.xAxis.axisLine.show).toBe(false)
    expect(opt.yAxis.splitLine.lineStyle.color).toBe(CHART_INK.grid)
  })

  it('carries no legend — direct marks only', () => {
    expect(buildLollipopOption(ROWS).legend).toBeUndefined()
  })
})

describe('LollipopChart', () => {
  it('renders an EmptyState below two quarters', () => {
    render(<LollipopChart quarters={[Q()]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
    expect(screen.queryByTestId('echart-inner')).toBeNull()
  })

  it('renders an EmptyState on junk input', () => {
    render(<LollipopChart quarters={null} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('mounts the chart and hands ECharts the built option', () => {
    render(<LollipopChart quarters={ROWS} />)
    expect(screen.getByTestId('echart-inner')).toBeInTheDocument()
    expect(captured.option.series[0].type).toBe('custom')
  })

  it('builds an aria-label naming the horizon and the beat record', () => {
    render(<LollipopChart quarters={ROWS} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/5 quarters/)
    expect(label).toMatch(/Q1 25 – Q1 26/)
    expect(label).toMatch(/Beat 2 of 4/)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 240 })
  })

  it('shows the horizon caption under the chart', () => {
    render(<LollipopChart quarters={ROWS} />)
    expect(screen.getByTestId('rk-lollipop-horizon')).toHaveTextContent('5 quarters · Q1 25 – Q1 26')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd app && npx vitest run src/components/research-kit/charts/
```
Expected: both files fail to resolve `./echartsCore` / `./LollipopChart`.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/charts/echartsCore.js`:

```jsx
// app/src/components/research-kit/charts/echartsCore.js
//
// THE single ECharts entry point for research-kit (spec §3.4). Every kit chart
// imports `EChart` from here. No other new file may import 'echarts' or
// 'echarts-for-react' directly.
//
// WHY: the full entry (`import ReactECharts from 'echarts-for-react'`, which
// app/src/pages/BreadthCharts.jsx:3 still uses) drags ~1MB min / ~340KB gz of
// echarts in. This module imports 'echarts/core' plus exactly the charts and
// components the kit draws, and registers them once. Adding a chart type means
// adding it HERE, deliberately — echartsCore.test.jsx pins the list.
//
// HONEST BUNDLE NOTE (spec §3.4): while ANY full-entry import survives
// (BreadthCharts, breadth/views/TreemapView, 3 Journal 2.0 files) vendor-echarts
// still contains all of echarts, so this module cannot SHRINK the chunk — it
// must simply not grow it. The shrink lands in P5 when those 5 files migrate.
//
// Canvas cannot read CSS custom properties, so CHART_INK mirrors the token
// hexes as literals — the same reason app/src/utils/chartFont.js exists.
// echartsCore.test.jsx pins the mirror to tokens.css so a token retune fails
// the test instead of the two silently forking. The DARK values are mirrored:
// light-theme glass is a deliberate deferral (§3.2), and these surfaces are
// dark-only.
import { useMemo } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, CustomChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import EChartsReactCore from 'echarts-for-react/lib/core'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import styles from './echartsCore.module.css'

echarts.use([BarChart, CustomChart, GridComponent, TooltipComponent, MarkLineComponent, AxisPointerComponent, CanvasRenderer])

export { echarts }

/** Token hexes mirrored for canvas. Keep in sync with app/src/styles/tokens.css. */
export const CHART_INK = {
  gain: '#3cb868',
  loss: '#e74c3c',
  gold: '#c9a84c',
  text: '#b6b09d',
  muted: '#8c8674',
  bright: '#e0dac8',
  /** ~8% warm white — Part C rule 5: 3-4 hairline gridlines, no spine, no box. */
  grid: 'rgba(224, 218, 200, 0.08)',
  /** Tooltip surface: --glass-chrome's dark value, so tip text is never on translucency. */
  tooltipBg: 'rgba(20, 22, 18, 0.94)',
}

/** No axis spine, no ticks, muted 10px labels. Part C rule 5. */
export function axisBase(extra = {}) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: CHART_INK.muted, fontFamily: CHART_FONT_FAMILY, fontSize: 10 },
    splitLine: { show: false },
    ...extra,
  }
}

/** Tight grid — the kit's charts are card-resident, not page-resident. */
export const GRID_BASE = { left: 44, right: 14, top: 16, bottom: 24, containLabel: false }

export const TOOLTIP_BASE = {
  backgroundColor: CHART_INK.tooltipBg,
  borderWidth: 0,
  padding: [6, 10],
  textStyle: { color: CHART_INK.bright, fontFamily: CHART_FONT_FAMILY, fontSize: 11 },
}

/** True when the user asked for reduced motion. Canvas can't use a CSS media
 *  query, so ECharts animation is gated in JS instead (Part C rule 8). */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const FILL = { width: '100%', height: '100%' }

/**
 * The kit's ECharts host.
 *
 * A canvas is invisible to assistive tech, so the wrapper is `role="img"` with
 * a caller-built `aria-label` that states the chart's actual finding — never
 * "chart". `height` comes from the component's exported SIZE so SkeletonBlock
 * can reserve the identical box (§3.4 size contract); it is the one inline
 * style here, and it is computed geometry, not a token.
 */
export default function EChart({
  option,
  height = 220,
  ariaLabel,
  className = '',
  onEvents,
  testId = 'rk-echart',
}) {
  const resolved = useMemo(
    () => ({ animation: !prefersReducedMotion(), animationDuration: 300, ...option }),
    [option],
  )

  return (
    <div
      className={`${styles.wrap} ${className}`}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ height }}
    >
      <EChartsReactCore
        echarts={echarts}
        option={resolved}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        style={FILL}
        onEvents={onEvents}
      />
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/charts/echartsCore.module.css`:

```css
.wrap {
  position: relative;
  width: 100%;
  min-width: 0;
}
```

**3c.** Create `app/src/components/research-kit/charts/LollipopChart.jsx`:

```jsx
// app/src/components/research-kit/charts/LollipopChart.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import styles from './LollipopChart.module.css'

/** §3.4 skeleton size contract: `<SkeletonBlock size={LollipopChart.SIZE} />`. */
export const SIZE = { width: '100%', height: 240 }

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 'beat' | 'miss' | 'inline' | null for one earnings-history row.
 * null means "no realized outcome to state" — an unreported quarter or a row
 * missing either side of the comparison. Never guess.
 */
export function beatState(row) {
  if (!row || !row.reported) return null
  const est = num(row.eps_estimate)
  const act = num(row.eps_actual)
  if (est == null || act == null) return null
  if (act > est) return 'beat'
  if (act < est) return 'miss'
  return 'inline'
}

/**
 * [min, max] for the value axis, spanning every finite estimate, actual and
 * whisker end with 12% headroom. Returns null when nothing is plottable — the
 * caller then renders an EmptyState rather than an axis around nothing.
 */
export function yDomain(rows) {
  const vals = []
  for (const r of rows || []) {
    for (const k of ['eps_estimate', 'eps_actual', 'eps_estimate_low', 'eps_estimate_high']) {
      const v = num(r?.[k])
      if (v != null) vals.push(v)
    }
  }
  if (!vals.length) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  // A flat series would otherwise collapse to a zero-height axis.
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12
  return [lo - pad, hi + pad]
}

/** "8 quarters · Q3 24 – Q2 26" — the horizon is READ FROM THE DATA (§2.2:
 *  every chip carries its denominator). Never hardcode a quarter count. */
export function horizonLabel(rows) {
  const list = rows || []
  if (!list.length) return ''
  const first = list[0]?.quarter ?? ''
  const last = list[list.length - 1]?.quarter ?? ''
  const noun = list.length === 1 ? 'quarter' : 'quarters'
  return list.length === 1 ? `1 ${noun} · ${first}` : `${list.length} ${noun} · ${first} – ${last}`
}

/**
 * ECharts `custom` renderItem — the whole lollipop for ONE quarter.
 *
 * Encoded dimensions: [0]=category index, [1]=estimate, [2]=actual,
 * [3]=analyst low, [4]=analyst high, [5]=reported (1|0).
 *
 * Pure: everything it needs arrives through `api`, so a test drives it with a
 * stub `{ value, coord }` and asserts the shapes — the only way to prove chart
 * drawing under jsdom, which has no canvas.
 *
 * §3.3 grammar, normative here: the estimate dot is ALWAYS hollow (expectation)
 * and dashed when the quarter has not reported (that dashed ring IS the
 * "next-quarter estimate" of §4.3.2); the actual dot is ALWAYS solid (realized)
 * and green/red by beat — with the hollow-vs-solid fill carrying the meaning
 * alongside the hue.
 */
export function renderLollipopItem(params, api) {
  const children = []
  const idx = api.value(0)
  const est = num(api.value(1))
  const act = num(api.value(2))
  const lo = num(api.value(3))
  const hi = num(api.value(4))
  const reported = api.value(5) === 1
  if (est == null) return { type: 'group', children }

  const at = (v) => api.coord([idx, v])
  const [x, estY] = at(est)

  if (lo != null && hi != null) {
    const [, loY] = at(lo)
    const [, hiY] = at(hi)
    const stroke = { stroke: CHART_INK.muted, lineWidth: 1, opacity: 0.7 }
    children.push({ type: 'line', shape: { x1: x, y1: hiY, x2: x, y2: loY }, style: stroke })
    for (const capY of [hiY, loY]) {
      children.push({ type: 'line', shape: { x1: x - 3, y1: capY, x2: x + 3, y2: capY }, style: stroke })
    }
  }

  if (reported && act != null) {
    const [, actY] = at(act)
    children.push({
      type: 'line',
      shape: { x1: x, y1: estY, x2: x, y2: actY },
      style: { stroke: CHART_INK.muted, lineWidth: 1.5 },
    })
  }

  const ring = { fill: 'transparent', stroke: CHART_INK.muted, lineWidth: 1.5 }
  if (!reported) ring.lineDash = [3, 3]
  children.push({ type: 'circle', shape: { cx: x, cy: estY, r: 4 }, style: ring })

  if (reported && act != null) {
    const [, actY] = at(act)
    const fill = act > est ? CHART_INK.gain : act < est ? CHART_INK.loss : CHART_INK.bright
    children.push({ type: 'circle', shape: { cx: x, cy: actY, r: 4.5 }, style: { fill } })
  }

  return { type: 'group', children }
}

/** The ECharts option — pure, so the chart's contract is unit-testable. */
export function buildLollipopOption(rows, { valueFormatter } = {}) {
  const list = rows || []
  const domain = yDomain(list) || [0, 1]
  const fmt = valueFormatter || ((v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`))

  return {
    grid: { ...GRID_BASE },
    xAxis: {
      type: 'category',
      data: list.map((r) => r?.quarter ?? ''),
      ...axisBase(),
    },
    yAxis: {
      type: 'value',
      min: domain[0],
      max: domain[1],
      splitNumber: 3,
      ...axisBase({
        splitLine: { show: true, lineStyle: { color: CHART_INK.grid } },
        axisLabel: { color: CHART_INK.muted, fontSize: 10, formatter: (v) => fmt(v) },
      }),
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'item',
      formatter: (p) => {
        const r = list[p.dataIndex] || {}
        const state = beatState(r)
        const head = `${r.quarter ?? ''}${r.session ? ` · ${String(r.session).toUpperCase()}` : ''}`
        const estLine = `Est ${fmt(num(r.eps_estimate))}`
        if (!r.reported) return `${head}<br/>${estLine} · not reported yet`
        const surprise = num(r.surprise_pct)
        const tail = surprise == null ? '' : ` (${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%)`
        return `${head}<br/>${estLine}<br/>Act ${fmt(num(r.eps_actual))}${tail}${state ? ` · ${state}` : ''}`
      },
    },
    series: [{
      type: 'custom',
      name: 'EPS',
      renderItem: renderLollipopItem,
      encode: { x: 0, y: [1, 2, 3, 4] },
      clip: true,
      data: list.map((r, i) => [
        i,
        num(r?.eps_estimate),
        num(r?.eps_actual),
        num(r?.eps_estimate_low),
        num(r?.eps_estimate_high),
        r?.reported ? 1 : 0,
      ]),
    }],
  }
}

/**
 * Estimate vs reported EPS per quarter (spec §4.3.2; dataviz pattern 1).
 *
 * Reads the earnings-history payload (§6 row 3) DIRECTLY, oldest-first — P2
 * passes the endpoint rows with no adapter. Rows that have not reported keep
 * their place and render as the dashed next-quarter estimate; that is why the
 * backend accessor is required to keep the not-yet-reported row.
 *
 * Below two quarters this renders an EmptyState: one dot is not a habit.
 */
export default function LollipopChart({
  quarters,
  label = 'Estimate vs reported',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
  valueFormatter,
}) {
  const rows = Array.isArray(quarters) ? quarters : []

  if (rows.length < 2) {
    return (
      <EmptyState
        icon="chart"
        title="Not enough earnings history"
        hint="Two reported quarters are needed to show whether this company habitually beats."
        className={className}
      />
    )
  }

  const option = buildLollipopOption(rows, { valueFormatter })
  const states = rows.map(beatState).filter(Boolean)
  const beats = states.filter((s) => s === 'beat').length
  const horizon = horizonLabel(rows)
  const built = ariaLabel
    || `Estimate versus reported EPS, ${horizon}. Beat ${beats} of ${states.length} reported quarters.`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <EChart option={option} height={height} ariaLabel={built} testId="rk-lollipop" />
      <div className={`${styles.horizon} t-num`} data-testid="rk-lollipop-horizon">
        {horizon}
      </div>
    </div>
  )
}
```

**3d.** Create `app/src/components/research-kit/charts/LollipopChart.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.horizon {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  letter-spacing: var(--ls-normal);
  color: var(--text-muted);
}

/* PHONE */
@media (max-width: 640px) {
  .wrap {
    gap: 2px;
  }
}
```

**3e.** Extend `app/src/components/research-kit/index.js` — append:

```js
// Charts (P1F-B). Every one of these draws through charts/echartsCore.js or
// hand-written SVG — no component imports 'echarts' or 'echarts-for-react'.
export { default as EChart, CHART_INK, echarts } from './charts/echartsCore'
export {
  default as LollipopChart,
  SIZE as LOLLIPOP_SIZE,
  beatState,
  buildLollipopOption,
  horizonLabel,
} from './charts/LollipopChart'
```

- [ ] **Step 4: Run tests + the bundle gate**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 12 test files pass (the 10 from P1F-A plus `charts/echartsCore.test.jsx` and `charts/LollipopChart.test.jsx`). The gate is **0 failed**.

Then rebuild and compare against the Step 0 baseline:

```
cd app && npm run build 2>&1 | grep -E "vendor-echarts|vendor-charts"
```

- [ ] Record the new `vendor-echarts` raw kB / gzip kB beside the Step 0 numbers.
- [ ] **Assert:** the delta is under **+10 kB raw**. The tree-shaken entry resolves to modules already inside `vendor-echarts` (a full `echarts` import survives in BreadthCharts and 4 other files), so the only new bytes are re-export shims.
- [ ] **Assert:** no NEW chunk containing echarts appeared — `ls app/dist/assets/ | grep -i echarts` still lists exactly one `vendor-echarts-*.js`.
- [ ] **If the chunk grew by hundreds of kB**, `echartsCore.js` is pulling the full entry (a stray `from 'echarts'` or `from 'echarts-for-react'`). Fix the import, do not accept the size.
- [ ] Build exits 0.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/charts/echartsCore.js app/src/components/research-kit/charts/echartsCore.module.css app/src/components/research-kit/charts/echartsCore.test.jsx app/src/components/research-kit/charts/LollipopChart.jsx app/src/components/research-kit/charts/LollipopChart.module.css app/src/components/research-kit/charts/LollipopChart.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: echarts/core entry point + LollipopChart

Spec 2026-08-03 §3.4. ONE module owns ECharts for the kit: echarts/core +
echarts-for-react/lib/core, registering exactly BarChart, CustomChart, Grid,
Tooltip, MarkLine, AxisPointer, CanvasRenderer -- pinned by a source-text test
so a future full-entry import fails here instead of doubling the bundle. Bundle
claim is scoped honestly: 5 full-entry imports survive elsewhere, so this must
not GROW vendor-echarts; the shrink is P5.

LollipopChart draws estimate-vs-reported per quarter as ONE custom series --
hollow estimate dot (dashed for the not-yet-reported quarter), analyst hi/lo
whisker, solid actual dot green/red by beat. renderItem is a pure function
driven by a stub api in tests, which is the only way to prove chart drawing
under jsdom (no canvas). Horizon is read from the data; under two quarters it
renders the kit EmptyState.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: `ReactionBars`

**Files:**
- Create: `app/src/components/research-kit/charts/ReactionBars.jsx`, `charts/ReactionBars.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/charts/ReactionBars.test.jsx` (create)

**Interfaces:**
- Consumes: `EmptyState`, `EyebrowLabel` (P1F-A), the earnings-history row shape (§6 row 3), and the expected-move `live.pct` for the implied bracket.
- Produces: `ReactionBars({ quarters, impliedPct, impliedLabel, label, info, height, className, ariaLabel })` + `SIZE`, `VIEWBOX`, `reactionGeometry()`, `reactionStats()`, `outcomeOf()`.

**Design notes (read before writing code):**
- **Plain SVG, no library** (dataviz Part B: strips are library-instance-free). A fixed `viewBox` with `preserveAspectRatio="xMidYMid meet"` keeps dots circular at every container width — never `preserveAspectRatio="none"`, which would squash the beat/miss dots into ellipses and destroy the shape channel.
- **Signed bars, shape-coded dots (§3.3).** Bar direction encodes the sign of the next-day move; the dot at the bar's outer end encodes the EPS outcome — **solid disc = beat, hollow ring = miss** — so a colour-blind reader still separates "moved down" from "missed".
- **The star is the divergence mark.** A quarter that beat and still closed down gets a `★` above its dot: the single most useful pattern on this strip ("they beat and it sold off — again").
- **Gold appears once here**: the implied ± bracket, which is this canvas's ONE gold data-highlight (§3.1). Do not add another.
- **The caption row is composition, not this component.** `reactionStats()` is exported so P2's `StatTile` row (AVG MOVE · CLOSED UP n/8 · BEST · WORST) reads the same numbers this chart drew. Composition sketch lives in the JSDoc so P2 cannot invent a second computation.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/charts/ReactionBars.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReactionBars, {
  SIZE, VIEWBOX, reactionGeometry, reactionStats, outcomeOf,
} from './ReactionBars'

const Q = (quarter, reaction_pct, surprise_pct, over = {}) => ({
  quarter, reaction_pct, surprise_pct, reported: true, ...over,
})
const ROWS = [
  Q('Q1 25', 4.2, 12),
  Q('Q2 25', -6.1, 8),     // beat, sold off -> the divergence star
  Q('Q3 25', -2.0, -5),
  Q('Q4 25', 9.4, 30),
]

describe('outcomeOf', () => {
  it('reads beat/miss off the surprise sign', () => {
    expect(outcomeOf(Q('Q', 1, 5))).toBe('beat')
    expect(outcomeOf(Q('Q', 1, -5))).toBe('miss')
    expect(outcomeOf(Q('Q', 1, 0))).toBe('inline')
  })

  it('prefers an explicit eps pair over the surprise field', () => {
    expect(outcomeOf({ reported: true, eps_estimate: 1, eps_actual: 1.2, surprise_pct: null })).toBe('beat')
  })

  it('is null when the quarter has not reported or carries nothing to judge', () => {
    expect(outcomeOf({ reported: false, surprise_pct: 10 })).toBeNull()
    expect(outcomeOf({ reported: true })).toBeNull()
    expect(outcomeOf(null)).toBeNull()
  })
})

describe('reactionGeometry', () => {
  const geo = () => reactionGeometry(ROWS, { impliedPct: 7 })

  it('places one bar per quarter, evenly slotted', () => {
    const g = geo()
    expect(g.bars).toHaveLength(4)
    const gaps = g.bars.slice(1).map((b, i) => b.cx - g.bars[i].cx)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6)
  })

  it('draws up-moves above the baseline and down-moves below (SIGNED, §3.3)', () => {
    const g = geo()
    expect(g.bars[0].dir).toBe(1)
    expect(g.bars[0].y + g.bars[0].h).toBeCloseTo(g.baselineY, 6)   // grows upward
    expect(g.bars[1].dir).toBe(-1)
    expect(g.bars[1].y).toBeCloseTo(g.baselineY, 6)                  // grows downward
  })

  it('scales every bar against the largest magnitude on the strip', () => {
    const g = geo()
    const biggest = g.bars.find((b) => b.key === 'Q4 25')
    const smallest = g.bars.find((b) => b.key === 'Q3 25')
    expect(biggest.h).toBeGreaterThan(smallest.h)
    expect(biggest.h).toBeLessThanOrEqual((VIEWBOX.height - 28) / 2)
  })

  it('includes the implied magnitude in the scale so the bracket always fits', () => {
    const withBig = reactionGeometry([Q('Q1', 1, 5)], { impliedPct: 40 })
    expect(withBig.scaleMax).toBeGreaterThanOrEqual(40)
    expect(withBig.bracket.top).toBeGreaterThanOrEqual(0)
    expect(withBig.bracket.bottom).toBeLessThanOrEqual(VIEWBOX.height)
  })

  it('has no bracket when no implied move is supplied', () => {
    expect(reactionGeometry(ROWS, {}).bracket).toBeNull()
    expect(reactionGeometry(ROWS, { impliedPct: null }).bracket).toBeNull()
  })

  it('flags the beat-but-down quarter and only that one', () => {
    const g = geo()
    expect(g.bars.filter((b) => b.diverged).map((b) => b.key)).toEqual(['Q2 25'])
  })

  it('survives a quarter with no reaction number', () => {
    const g = reactionGeometry([Q('Q1', null, 5), Q('Q2', 3, 5)], {})
    expect(g.bars[0].value).toBeNull()
    expect(g.bars[0].h).toBe(0)
    expect(Number.isFinite(g.bars[0].cx)).toBe(true)
  })

  it('never divides by zero on an all-flat strip', () => {
    const g = reactionGeometry([Q('Q1', 0, 0)], {})
    expect(Number.isFinite(g.scaleMax)).toBe(true)
    expect(g.scaleMax).toBeGreaterThan(0)
  })
})

describe('reactionStats — the numbers P2 puts in the StatTile caption row', () => {
  it('computes average absolute move, up-count and the extremes', () => {
    const s = reactionStats(ROWS)
    expect(s.total).toBe(4)
    expect(s.upCount).toBe(2)
    expect(s.avgAbs).toBeCloseTo((4.2 + 6.1 + 2.0 + 9.4) / 4, 6)
    expect(s.best).toEqual({ quarter: 'Q4 25', pct: 9.4 })
    expect(s.worst).toEqual({ quarter: 'Q2 25', pct: -6.1 })
  })

  it('counts only quarters with a real reaction', () => {
    const s = reactionStats([Q('Q1', null, 5), Q('Q2', 3, 5)])
    expect(s.total).toBe(1)
    expect(s.upCount).toBe(1)
  })

  it('returns an empty shape rather than NaN when there is nothing', () => {
    const s = reactionStats([])
    expect(s).toEqual({ total: 0, upCount: 0, avgAbs: null, best: null, worst: null })
  })
})

describe('ReactionBars', () => {
  it('renders an EmptyState when no quarter has a reaction', () => {
    render(<ReactionBars quarters={[Q('Q1', null, 5)]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('renders one bar rect per quarter', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    expect(container.querySelectorAll('[data-testid="rk-reaction-bar"]')).toHaveLength(4)
  })

  it('shape-codes the outcome: solid disc on a beat, hollow ring on a miss', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const dots = container.querySelectorAll('[data-testid="rk-reaction-dot"]')
    expect(dots[0].getAttribute('fill')).not.toBe('none')     // Q1 beat
    expect(dots[2].getAttribute('fill')).toBe('none')         // Q3 missed
  })

  it('stars the beat-but-sold-off quarter', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const stars = container.querySelectorAll('[data-testid="rk-reaction-star"]')
    expect(stars).toHaveLength(1)
    expect(stars[0].textContent).toBe('★')
  })

  it('draws the implied bracket only when an implied move is given', () => {
    const { container, rerender } = render(<ReactionBars quarters={ROWS} />)
    expect(container.querySelector('[data-testid="rk-reaction-bracket"]')).toBeNull()
    rerender(<ReactionBars quarters={ROWS} impliedPct={7} impliedLabel="through Fri Aug 8" />)
    expect(container.querySelectorAll('[data-testid="rk-reaction-bracket"]')).toHaveLength(2)
  })

  it('keeps dots circular at any width (never preserveAspectRatio=none)', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`)
  })

  it('is one labelled image, and the label states the finding', () => {
    render(<ReactionBars quarters={ROWS} impliedPct={7} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/closed up 2 of 4/i)
    expect(label).toMatch(/average move 5\.4%/i)
    expect(label).toMatch(/implied ±7\.0%/i)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: VIEWBOX.height })
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd app && npx vitest run src/components/research-kit/charts/ReactionBars.test.jsx
```
Expected: cannot resolve `./ReactionBars`.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/charts/ReactionBars.jsx`:

```jsx
// app/src/components/research-kit/charts/ReactionBars.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import styles from './ReactionBars.module.css'

/** Internal SVG coordinate space. The element scales to its container with
 *  preserveAspectRatio="xMidYMid meet" so the dots stay CIRCLES — the shape
 *  channel that §3.3 requires would be destroyed by non-uniform scaling. */
export const VIEWBOX = { width: 320, height: 132 }

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: VIEWBOX.height }

const PAD_TOP = 10
const PAD_BOTTOM = 18   // room for the quarter labels
const DOT_GAP = 7

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 'beat' | 'miss' | 'inline' | null for one earnings-history row.
 * Prefers the eps pair when present, falls back to `surprise_pct`. null means
 * there is nothing to state — the dot is then omitted, never guessed.
 */
export function outcomeOf(row) {
  if (!row || row.reported === false) return null
  const est = num(row.eps_estimate)
  const act = num(row.eps_actual)
  if (est != null && act != null) return act > est ? 'beat' : act < est ? 'miss' : 'inline'
  const s = num(row.surprise_pct)
  if (s == null) return null
  return s > 0 ? 'beat' : s < 0 ? 'miss' : 'inline'
}

/**
 * All of the strip's geometry, in VIEWBOX units. Pure and DOM-free (the house
 * `sparkPaths` / `positionPct` pattern) so every rectangle is unit-testable.
 *
 * The scale spans the largest |reaction| AND the implied magnitude, so the gold
 * bracket can never fall outside the plot — a bracket clipped off the top would
 * read as "the market is pricing less than it ever moves", the exact opposite
 * of the truth.
 */
export function reactionGeometry(rows, { width = VIEWBOX.width, height = VIEWBOX.height, impliedPct = null } = {}) {
  const list = rows || []
  const implied = num(impliedPct)
  const magnitudes = list.map((r) => Math.abs(num(r?.reaction_pct) ?? 0))
  if (implied != null) magnitudes.push(Math.abs(implied))
  const peak = Math.max(0, ...magnitudes)
  const scaleMax = (peak > 0 ? peak : 1) * 1.15

  const plotH = height - PAD_TOP - PAD_BOTTOM
  const halfH = plotH / 2
  const baselineY = PAD_TOP + halfH
  const n = Math.max(list.length, 1)
  const slot = width / n
  const barW = Math.min(18, slot * 0.42)

  const bars = list.map((r, i) => {
    const cx = slot * (i + 0.5)
    const v = num(r?.reaction_pct)
    const outcome = outcomeOf(r)
    if (v == null) {
      return {
        key: r?.quarter ?? String(i), label: r?.quarter ?? '', value: null, outcome,
        dir: 0, cx, x: cx - barW / 2, w: barW, y: baselineY, h: 0, dotY: baselineY, diverged: false,
      }
    }
    const dir = v >= 0 ? 1 : -1
    const h = Math.min(halfH, (Math.abs(v) / scaleMax) * halfH)
    return {
      key: r?.quarter ?? String(i),
      label: r?.quarter ?? '',
      value: v,
      outcome,
      dir,
      cx,
      x: cx - barW / 2,
      w: barW,
      y: dir > 0 ? baselineY - h : baselineY,
      h,
      dotY: dir > 0 ? baselineY - h - DOT_GAP : baselineY + h + DOT_GAP,
      // The pattern this strip exists to surface: beat the number, sold off anyway.
      diverged: outcome === 'beat' && v < 0,
    }
  })

  const bracket = implied == null ? null : {
    top: baselineY - (Math.abs(implied) / scaleMax) * halfH,
    bottom: baselineY + (Math.abs(implied) / scaleMax) * halfH,
    pct: Math.abs(implied),
  }

  return { bars, baselineY, scaleMax, bracket, width, height, labelY: height - 5 }
}

/**
 * The four numbers of the §4.3.2 caption row. Exported so P2's StatTile row
 * reads exactly what the chart drew:
 *
 *   const s = reactionStats(quarters)
 *   <StatTile label="AVG MOVE"   value={`±${s.avgAbs.toFixed(1)}%`} />
 *   <StatTile label="CLOSED UP"  value={`${s.upCount} / ${s.total}`} />
 *   <StatTile label="BEST"  value={`+${s.best.pct.toFixed(1)}%`}  sub={s.best.quarter} />
 *   <StatTile label="WORST" value={`${s.worst.pct.toFixed(1)}%`}  sub={s.worst.quarter} />
 */
export function reactionStats(rows) {
  const vals = (rows || [])
    .map((r) => ({ quarter: r?.quarter ?? '', pct: num(r?.reaction_pct) }))
    .filter((r) => r.pct != null)
  if (!vals.length) return { total: 0, upCount: 0, avgAbs: null, best: null, worst: null }
  const avgAbs = vals.reduce((a, r) => a + Math.abs(r.pct), 0) / vals.length
  const best = vals.reduce((a, r) => (r.pct > a.pct ? r : a))
  const worst = vals.reduce((a, r) => (r.pct < a.pct ? r : a))
  return { total: vals.length, upCount: vals.filter((r) => r.pct > 0).length, avgAbs, best, worst }
}

/**
 * How this name TRADES after it reports (spec §4.3.2; dataviz pattern 6).
 *
 * Sits directly under `LollipopChart` on the SAME quarter axis: EPS story above,
 * price story below, one section. Pass the identical `quarters` array.
 *
 * ENCODINGS (§3.3 — hue is never alone):
 *   • bar direction  = sign of the next-day move (signed, not colour-coded)
 *   • dot fill       = EPS outcome, SOLID disc on a beat / HOLLOW ring on a miss
 *   • ★              = beat-but-closed-down, the divergence worth noticing
 *   • gold dashed pair = tonight's implied ±move. This is the ONE gold
 *     data-highlight on this canvas (§3.1) — do not add another.
 */
export default function ReactionBars({
  quarters,
  impliedPct = null,
  impliedLabel,
  label = 'Next-day move',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const rows = Array.isArray(quarters) ? quarters : []
  const stats = reactionStats(rows)

  if (!stats.total) {
    return (
      <EmptyState
        icon="chart"
        title="No post-earnings reactions yet"
        hint="Reactions appear once this name has reported with price history behind it."
        className={className}
      />
    )
  }

  const geo = reactionGeometry(rows, { impliedPct })
  const impliedText = geo.bracket ? ` Implied ±${geo.bracket.pct.toFixed(1)}%${impliedLabel ? ` ${impliedLabel}` : ''}.` : ''
  const built = ariaLabel
    || `Next-day move after each report: closed up ${stats.upCount} of ${stats.total}, average move ${stats.avgAbs.toFixed(1)}%.${impliedText}`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
        role="img"
        aria-label={built}
        data-testid="rk-reaction"
      >
        {geo.bracket && (
          <>
            <line
              className={styles.bracket}
              data-testid="rk-reaction-bracket"
              x1="0" y1={geo.bracket.top} x2={geo.width} y2={geo.bracket.top}
            />
            <line
              className={styles.bracket}
              data-testid="rk-reaction-bracket"
              x1="0" y1={geo.bracket.bottom} x2={geo.width} y2={geo.bracket.bottom}
            />
          </>
        )}

        <line className={styles.baseline} x1="0" y1={geo.baselineY} x2={geo.width} y2={geo.baselineY} />

        {geo.bars.map((b) => (
          <g key={b.key}>
            {b.h > 0 && (
              <rect
                className={b.dir > 0 ? styles.barUp : styles.barDown}
                data-testid="rk-reaction-bar"
                x={b.x} y={b.y} width={b.w} height={b.h} rx="1"
              />
            )}
            {b.outcome && b.value != null && (
              <circle
                className={b.outcome === 'beat' ? styles.dotBeat : styles.dotMiss}
                data-testid="rk-reaction-dot"
                fill={b.outcome === 'beat' ? 'currentColor' : 'none'}
                cx={b.cx} cy={b.dotY} r="3"
              />
            )}
            {b.diverged && (
              <text
                className={styles.star}
                data-testid="rk-reaction-star"
                x={b.cx} y={b.dotY - 6}
                textAnchor="middle"
              >
                ★
              </text>
            )}
            <text className={styles.qlabel} x={b.cx} y={geo.labelY} textAnchor="middle">
              {b.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/charts/ReactionBars.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.svg {
  width: 100%;
  overflow: visible;
}

.baseline {
  stroke: var(--text-muted);
  stroke-width: 1;
  opacity: 0.55;
}

/* Realized outcomes only (§3.3). Translucent fills, hairline strokes
   (dataviz Part C rule 2) — solid bright fills bloom on near-black. */
.barUp {
  fill: var(--gain);
  opacity: 0.85;
}
.barDown {
  fill: var(--loss);
  opacity: 0.85;
}

/* Shape channel: solid disc = beat, hollow ring = miss. `fill` is set as an
   attribute on the element so the ring truly has no fill; these rules own the
   stroke/colour half. */
.dotBeat {
  color: var(--text-bright);
  stroke: none;
}
.dotMiss {
  stroke: var(--text-bright);
  stroke-width: 1.2;
}

.star {
  /* CORRECTION 2 (re-review): --warn COLLIDES with --ut-gold (identical hex in
     every theme), so the first correction was a visual no-op. --score-weak
     (#e08a3c) is the caution-adjacent token actually distinct from gold; gold
     stays unique to the implied bracket (§3.1 one-gold rule). */
  fill: var(--score-weak);
  font-family: var(--font-sans);
  font-size: 9px;
}

/* The ONE gold data-highlight on this canvas: tonight's implied +/- (§3.1). */
.bracket {
  stroke: var(--ut-gold);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  opacity: 0.8;
}

.qlabel {
  fill: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 8px;
  letter-spacing: var(--ls-normal);
}

/* PHONE — fewer, larger marks read better than the same density shrunk. */
@media (max-width: 640px) {
  .wrap {
    gap: 2px;
  }
  .qlabel {
    font-size: 7px;
  }
}
```

**3c.** Extend `app/src/components/research-kit/index.js` — append:

```js
export {
  default as ReactionBars,
  SIZE as REACTION_BARS_SIZE,
  reactionGeometry,
  reactionStats,
  outcomeOf,
} from './charts/ReactionBars'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 13 test files pass, 0 failed.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/charts/ReactionBars.jsx app/src/components/research-kit/charts/ReactionBars.module.css app/src/components/research-kit/charts/ReactionBars.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: ReactionBars (post-earnings price behaviour)

Spec 2026-08-03 §4.3.2, dataviz pattern 6. Plain SVG, no chart instance --
signed next-day-move bars above/below a shared baseline, shape-coded outcome
dots (solid disc = beat, hollow ring = miss), a star on beat-but-sold-off, and
tonight's implied +/- as the canvas's ONE gold dashed bracket.

All geometry is the exported pure fn reactionGeometry(), unit-tested for even
slotting, signed direction, a missing reaction, an all-flat strip (no divide by
zero) and a bracket that always fits inside the plot. reactionStats() is
exported so P2's StatTile caption row reads exactly what the chart drew instead
of recomputing it.

preserveAspectRatio is xMidYMid meet, deliberately: 'none' would squash the
beat/miss dots into ellipses and destroy the shape channel §3.3 requires.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: `ImpliedVsRealized` (the Setup hero)

**Files:**
- Create: `app/src/components/research-kit/charts/ImpliedVsRealized.jsx`, `charts/ImpliedVsRealized.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/charts/ImpliedVsRealized.test.jsx` (create)

**Interfaces:**
- Consumes: `EmptyState`, `EyebrowLabel`, `VerdictChip` (P1F-A); the expected-move endpoint payload `{ live, history, history_since }` **as returned** (`api/routers/expected_move.py`); the earnings-history rows for the realized side.
- Produces: `ImpliedVsRealized({ quarters, impliedHistory, live, historySince, label, info, height, className, ariaLabel })` + `SIZE`, `VIEWBOX`, `pairQuarters()`, `coldStartState()`, `impliedVerdict()`, `pairGeometry()`.

**Design notes (read before writing code):**
- **The join is `report_date`.** `pairQuarters(quarters, impliedHistory, live)` pairs the earnings-history rows (realized) with the implied snapshots (expectation) on the first 10 characters of `report_date`, and fills the *current* quarter's implied from `live.pct`. P2 passes both payloads straight in — no adapter, which is the whole point of fixing the shapes here.
- **Signed realized, hollow implied (§3.3).** The solid realized bar is signed: a down-close descends below the baseline. Implied has no sign, so the hollow bar is drawn **on the same side as its realized outcome** — that is what makes "hollow taller than solid" legible as "the market overpaid". When the realized outcome is unknown (the current quarter), the hollow bar is drawn upward and its label carries `±`. This rule is normative for this component; document it in the JSDoc so no one "fixes" it later.
- **Cold start is a designed state, not a degradation (§4.3.1a).** Under 3 recorded implied quarters, the historical hollow bars are **suppressed** (a sparse pairing invites a false read) and the widget shows realized bars + the current implied bar + the caption `Implied tracking since 2026-08 · n/8 recorded`.
- **The RICH/CHEAP chip is the ONE gold element on this canvas.** The current-quarter highlight is therefore a brighter stroke plus a `NOW` tick, deliberately **not** gold (§3.1: max one gold data-highlight per canvas). Do not add a gold bracket here — `ReactionBars` owns the gold bracket, on the Earnings History canvas.
- The chip needs ≥3 fully-paired past quarters before it will state anything. Below that it returns `null` and nothing renders — never a verdict on two data points.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/charts/ImpliedVsRealized.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImpliedVsRealized, {
  SIZE, VIEWBOX, pairQuarters, coldStartState, impliedVerdict, pairGeometry,
} from './ImpliedVsRealized'

/** Earnings-history rows, oldest-first (§6 row 3). */
const QUARTERS = [
  { quarter: 'Q1 25', report_date: '2025-02-05', reported: true, reaction_pct: 3.0 },
  { quarter: 'Q2 25', report_date: '2025-05-07', reported: true, reaction_pct: -2.0 },
  { quarter: 'Q3 25', report_date: '2025-08-06', reported: true, reaction_pct: 4.0 },
  { quarter: 'Q4 25', report_date: '2025-11-05', reported: true, reaction_pct: -3.0 },
  { quarter: 'Q1 26', report_date: '2026-02-04', reported: false, reaction_pct: null },
]
/** Implied snapshots as `implied_store.get_implied_history` returns them: newest-first. */
const IMPLIED = [
  { sym: 'X', report_date: '2025-11-05', captured_at: '2025-11-04T21:00:00Z', pct: 7.5, dollar: 8.1, expiry: '2025-11-07' },
  { sym: 'X', report_date: '2025-08-06', captured_at: '2025-08-05T21:00:00Z', pct: 6.5, dollar: 7.0, expiry: '2025-08-08' },
  { sym: 'X', report_date: '2025-05-07', captured_at: '2025-05-06T21:00:00Z', pct: 6.0, dollar: 6.2, expiry: '2025-05-09' },
  { sym: 'X', report_date: '2025-02-05', captured_at: '2025-02-04T21:00:00Z', pct: 5.0, dollar: 5.4, expiry: '2025-02-07' },
]
const LIVE = { pct: 6.2, dollar: 6.8, expiry: '2026-02-06', horizon: 'through 2026-02-06', source: 'massive-chain' }

describe('pairQuarters — joins the two payloads on report_date', () => {
  it('pairs every quarter with its pre-report implied snapshot', () => {
    const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)
    expect(pairs.map((p) => p.quarter)).toEqual(['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26'])
    expect(pairs[0].impliedPct).toBe(5.0)
    expect(pairs[0].realizedPct).toBe(3.0)
    expect(pairs[3].impliedPct).toBe(7.5)
  })

  it('fills the current quarter from the LIVE read, and marks it current', () => {
    const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)
    expect(pairs[4].isCurrent).toBe(true)
    expect(pairs[4].impliedPct).toBe(6.2)
    expect(pairs[4].realizedPct).toBeNull()
  })

  it('tolerates a datetime report_date and ignores unmatched snapshots', () => {
    const pairs = pairQuarters(
      [{ quarter: 'Q1', report_date: '2025-02-05T00:00:00Z', reported: true, reaction_pct: 1 }],
      [{ report_date: '2025-02-05', pct: 4 }, { report_date: '2019-01-01', pct: 99 }],
      null,
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0].impliedPct).toBe(4)
  })

  it('never throws on null inputs', () => {
    expect(pairQuarters(null, null, null)).toEqual([])
    expect(pairQuarters(QUARTERS, null, null)[0].impliedPct).toBeNull()
  })
})

describe('coldStartState (§4.3.1a)', () => {
  it('is cold under three recorded implied quarters and captions honestly', () => {
    const pairs = pairQuarters(QUARTERS.slice(3), IMPLIED.slice(0, 1), LIVE)
    const cold = coldStartState(pairs, '2025-11-05')
    expect(cold.cold).toBe(true)
    expect(cold.recorded).toBe(2)      // Q4 25 snapshot + the live current quarter
    expect(cold.caption).toBe('Implied tracking since 2025-11 · 2/8 recorded')
  })

  it('is warm once three or more quarters are recorded', () => {
    const cold = coldStartState(pairQuarters(QUARTERS, IMPLIED, LIVE), '2025-02-05')
    expect(cold.cold).toBe(false)
    expect(cold.caption).toBeNull()
  })

  it('says em-dash rather than "undefined" when nothing has been recorded', () => {
    expect(coldStartState([], null).caption).toBe('Implied tracking since — · 0/8 recorded')
  })
})

describe('impliedVerdict', () => {
  it('calls the premium RICH when the name typically moves less than it is priced for', () => {
    const v = impliedVerdict(pairQuarters(QUARTERS, IMPLIED, LIVE), LIVE)
    expect(v.rich).toBe(true)
    expect(v.tone).toBe('gold')
    expect(v.glyph).toBe('▲')
    expect(v.label).toBe('PREMIUM RICH — priced ±6.2% through 2026-02-06, typically moves ±3.0%')
  })

  it('calls it CHEAP when realized routinely exceeds the priced move', () => {
    const big = QUARTERS.map((q) => (q.reaction_pct == null ? q : { ...q, reaction_pct: q.reaction_pct * 4 }))
    const v = impliedVerdict(pairQuarters(big, IMPLIED, LIVE), LIVE)
    expect(v.rich).toBe(false)
    expect(v.glyph).toBe('▼')
    expect(v.label).toMatch(/^PREMIUM CHEAP —/)
  })

  it('states NOTHING on fewer than three fully-paired past quarters', () => {
    expect(impliedVerdict(pairQuarters(QUARTERS.slice(3), IMPLIED.slice(0, 1), LIVE), LIVE)).toBeNull()
    expect(impliedVerdict([], LIVE)).toBeNull()
  })

  it('never uses the word "verdict" in its copy (§12)', () => {
    const v = impliedVerdict(pairQuarters(QUARTERS, IMPLIED, LIVE), LIVE)
    expect(v.label.toLowerCase()).not.toContain('verdict')
  })
})

describe('pairGeometry', () => {
  const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)

  it('draws the realized bar SIGNED — down-closes descend below the baseline', () => {
    const g = pairGeometry(pairs)
    const up = g.cols[0]      // +3.0%
    const down = g.cols[1]    // -2.0%
    expect(up.realized.y + up.realized.h).toBeCloseTo(g.baselineY, 6)
    expect(down.realized.y).toBeCloseTo(g.baselineY, 6)
  })

  it('draws the hollow implied bar on the SAME side as its realized outcome', () => {
    const g = pairGeometry(pairs)
    expect(g.cols[1].dir).toBe(-1)
    expect(g.cols[1].implied.y).toBeCloseTo(g.baselineY, 6)
  })

  it('draws the current quarter upward when there is no outcome yet', () => {
    const g = pairGeometry(pairs)
    const cur = g.cols[4]
    expect(cur.isCurrent).toBe(true)
    expect(cur.dir).toBe(1)
    expect(cur.realized).toBeNull()
    expect(cur.implied.h).toBeGreaterThan(0)
  })

  it('scales both series against one shared magnitude', () => {
    const g = pairGeometry(pairs)
    expect(g.scaleMax).toBeGreaterThanOrEqual(7.5)
    for (const c of g.cols) {
      if (c.implied) expect(c.implied.h).toBeLessThanOrEqual((VIEWBOX.height - 28) / 2)
    }
  })

  it('never divides by zero on an all-null strip', () => {
    const g = pairGeometry([{ key: 'a', quarter: 'a', impliedPct: null, realizedPct: null, isCurrent: false }])
    expect(Number.isFinite(g.scaleMax)).toBe(true)
    expect(g.cols[0].implied).toBeNull()
    expect(g.cols[0].realized).toBeNull()
  })
})

describe('ImpliedVsRealized', () => {
  const warm = { quarters: QUARTERS, impliedHistory: IMPLIED, live: LIVE, historySince: '2025-02-05' }

  it('renders an EmptyState when there is nothing on either axis', () => {
    render(<ImpliedVsRealized quarters={[]} impliedHistory={[]} live={null} historySince={null} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('draws a paired column per quarter when history is warm', () => {
    const { container } = render(<ImpliedVsRealized {...warm} />)
    expect(container.querySelectorAll('[data-testid="rk-ivr-implied"]')).toHaveLength(5)
    expect(container.querySelectorAll('[data-testid="rk-ivr-realized"]')).toHaveLength(4)
    expect(container.querySelector('[data-testid="rk-ivr-cold"]')).toBeNull()
  })

  it('renders the RICH/CHEAP chip once history supports it', () => {
    render(<ImpliedVsRealized {...warm} />)
    expect(screen.getByText(/PREMIUM RICH/)).toBeInTheDocument()
  })

  it('COLD START: suppresses the historical hollow bars, keeps the current one, captions it', () => {
    const { container } = render(
      <ImpliedVsRealized
        quarters={QUARTERS.slice(3)}
        impliedHistory={IMPLIED.slice(0, 1)}
        live={LIVE}
        historySince="2025-11-05"
      />,
    )
    expect(container.querySelectorAll('[data-testid="rk-ivr-implied"]')).toHaveLength(1)
    expect(screen.getByTestId('rk-ivr-cold')).toHaveTextContent('Implied tracking since 2025-11 · 2/8 recorded')
    expect(screen.queryByText(/PREMIUM/)).toBeNull()
  })

  it('marks the current quarter without spending the canvas gold (§3.1)', () => {
    const { container } = render(<ImpliedVsRealized {...warm} />)
    const now = container.querySelectorAll('[data-testid="rk-ivr-now"]')
    expect(now).toHaveLength(1)
    expect(now[0].textContent).toBe('NOW')
  })

  it('is one labelled image stating the comparison', () => {
    render(<ImpliedVsRealized {...warm} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/priced ±6\.2%/)
    expect(label).toMatch(/typically moves ±3\.0%/)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: VIEWBOX.height })
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd app && npx vitest run src/components/research-kit/charts/ImpliedVsRealized.test.jsx
```
Expected: cannot resolve `./ImpliedVsRealized`.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/charts/ImpliedVsRealized.jsx`:

```jsx
// app/src/components/research-kit/charts/ImpliedVsRealized.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import VerdictChip from '../VerdictChip'
import styles from './ImpliedVsRealized.module.css'

export const VIEWBOX = { width: 320, height: 140 }
/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: VIEWBOX.height }

const PAD_TOP = 12
const PAD_BOTTOM = 16
/** §4.3.1a: below this many recorded implied quarters the paired form is a lie. */
const MIN_PAIRED = 3
/** The store keeps 8 quarters (implied_store.get_implied_history limit=8). */
const TARGET_QUARTERS = 8

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const dayKey = (d) => {
  const s = typeof d === 'string' ? d.trim() : ''
  return s ? s.slice(0, 10) : null
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Pairs earnings-history rows (realized) with implied snapshots (expectation)
 * on `report_date`, oldest-first.
 *
 * Both payloads arrive exactly as their endpoints return them:
 *   quarters       — GET /api/research/earnings-history/{sym}, oldest-first
 *   impliedHistory — GET /api/research/expected-move/{sym} .history, newest-first
 *   live           — the same payload's .live (fills the CURRENT quarter, whose
 *                    snapshot is not in the store until tonight's capture)
 * There is no adapter between P2 and this function, by design.
 */
export function pairQuarters(quarters, impliedHistory, live) {
  const byDate = new Map()
  for (const row of impliedHistory || []) {
    const k = dayKey(row?.report_date)
    // First write wins: the store's own first-write-wins rule already makes the
    // earliest snapshot the honest pre-report one.
    if (k && !byDate.has(k)) byDate.set(k, num(row?.pct))
  }

  return (quarters || []).map((q, i) => {
    const k = dayKey(q?.report_date)
    const isCurrent = q?.reported === false
    let impliedPct = k && byDate.has(k) ? byDate.get(k) : null
    if (impliedPct == null && isCurrent) impliedPct = num(live?.pct)
    return {
      key: q?.quarter ?? String(i),
      quarter: q?.quarter ?? '',
      report_date: k,
      isCurrent,
      impliedPct,
      realizedPct: num(q?.reaction_pct),
    }
  })
}

/**
 * The §4.3.1a cold-start state — DESIGNED, not degraded-by-accident.
 *
 * The nightly store starts empty, so early on there is nothing to pair. Rather
 * than draw two bars where one is guesswork, the widget shows realized bars +
 * the current implied and says exactly how much history exists.
 */
export function coldStartState(pairs, historySince, { minPaired = MIN_PAIRED, total = TARGET_QUARTERS } = {}) {
  const recorded = (pairs || []).filter((p) => p.impliedPct != null).length
  const cold = recorded < minPaired
  const since = typeof historySince === 'string' && historySince.length >= 7 ? historySince.slice(0, 7) : null
  return {
    cold,
    recorded,
    total,
    since,
    caption: cold ? `Implied tracking since ${since ?? '—'} · ${recorded}/${total} recorded` : null,
  }
}

/**
 * "Is the options market overpaying for this print?" — the nameable
 * differentiator (§13.2). Returns null below MIN_PAIRED fully-paired PAST
 * quarters: a two-quarter sample is not an opinion.
 *
 * Copy follows §4.3.1a exactly and never contains the word "verdict" (§12).
 */
export function impliedVerdict(pairs, live) {
  const both = (pairs || []).filter((p) => !p.isCurrent && p.impliedPct != null && p.realizedPct != null)
  if (both.length < MIN_PAIRED) return null

  const avgImplied = mean(both.map((p) => Math.abs(p.impliedPct)))
  const avgRealized = mean(both.map((p) => Math.abs(p.realizedPct)))
  const livePct = num(live?.pct)
  // Judge tonight's price when we have it; fall back to the historical average.
  const reference = livePct ?? avgImplied
  const rich = avgRealized < reference

  const horizon = live?.horizon || (live?.expiry ? `through ${live.expiry}` : null)
  const priced = livePct == null ? '' : `priced ±${livePct.toFixed(1)}%${horizon ? ` ${horizon}` : ''}, `
  return {
    rich,
    tone: 'gold',
    glyph: rich ? '▲' : '▼',
    avgImplied,
    avgRealized,
    label: `PREMIUM ${rich ? 'RICH' : 'CHEAP'} — ${priced}typically moves ±${avgRealized.toFixed(1)}%`,
  }
}

/**
 * Bar rectangles in VIEWBOX units. Pure and DOM-free.
 *
 * NORMATIVE (§3.3): the SOLID realized bar is SIGNED — a down-close descends
 * below the baseline. The HOLLOW implied bar has no sign of its own, so it is
 * drawn on the SAME side as its realized outcome; that is what makes "hollow
 * taller than solid" read as "the market overpaid". When the outcome is not
 * known yet (the current quarter) the hollow bar points up and its label
 * carries ±. Do not "fix" this into an unsigned pair.
 */
export function pairGeometry(pairs, { width = VIEWBOX.width, height = VIEWBOX.height } = {}) {
  const list = pairs || []
  const mags = []
  for (const p of list) {
    if (p.impliedPct != null) mags.push(Math.abs(p.impliedPct))
    if (p.realizedPct != null) mags.push(Math.abs(p.realizedPct))
  }
  const peak = Math.max(0, ...mags)
  const scaleMax = (peak > 0 ? peak : 1) * 1.15

  const plotH = height - PAD_TOP - PAD_BOTTOM
  const halfH = plotH / 2
  const baselineY = PAD_TOP + halfH
  const n = Math.max(list.length, 1)
  const slot = width / n
  const barW = Math.min(9, slot * 0.28)
  const half = barW / 2 + 1

  const cols = list.map((p, i) => {
    const cx = slot * (i + 0.5)
    const dir = p.realizedPct != null ? (p.realizedPct >= 0 ? 1 : -1) : 1
    const bar = (v, offset) => {
      if (v == null) return null
      const h = Math.min(halfH, (Math.abs(v) / scaleMax) * halfH)
      return { x: cx + offset - barW / 2, w: barW, h, y: dir > 0 ? baselineY - h : baselineY }
    }
    return {
      key: p.key,
      label: p.quarter,
      isCurrent: !!p.isCurrent,
      dir,
      cx,
      implied: bar(p.impliedPct, -half),
      realized: bar(p.realizedPct, half),
    }
  })

  return { cols, baselineY, scaleMax, width, height, labelY: height - 4 }
}

/**
 * THE Setup hero (spec §4.3.1a): what the options market charged for each past
 * print versus what the stock actually did.
 *
 * GRAMMAR (§3.3): hollow = expectation, solid = realized, signed = direction.
 * GOLD BUDGET (§3.1): the RICH/CHEAP chip is the ONE gold element on this
 * canvas. The current quarter is marked with a brighter stroke and a NOW tick —
 * deliberately not gold. (The gold dashed bracket lives on ReactionBars, in the
 * Earnings History canvas.)
 */
export default function ImpliedVsRealized({
  quarters,
  impliedHistory,
  live,
  historySince,
  label = 'Implied vs realized move',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const paired = pairQuarters(quarters, impliedHistory, live)
  const cold = coldStartState(paired, historySince)

  const plotted = cold.cold
    // Cold start: a sparse hollow bar invites a false read, so only the current
    // quarter's implied survives. The caption states the real coverage.
    ? paired.map((p) => (p.isCurrent ? p : { ...p, impliedPct: null }))
    : paired

  const hasAnything = plotted.some((p) => p.impliedPct != null || p.realizedPct != null)
  if (!hasAnything) {
    return (
      <EmptyState
        icon="chart"
        title="No expected-move history yet"
        hint="Implied moves are captured the night before each report; realized moves need one reported quarter."
        className={className}
      />
    )
  }

  const geo = pairGeometry(plotted)
  const chip = cold.cold ? null : impliedVerdict(paired, live)
  const built = ariaLabel || (chip
    ? `Implied versus realized move by quarter. ${chip.label}.`
    : `Realized move by quarter. ${cold.caption ?? ''}`.trim())

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
        role="img"
        aria-label={built}
        data-testid="rk-ivr"
      >
        <line className={styles.baseline} x1="0" y1={geo.baselineY} x2={geo.width} y2={geo.baselineY} />

        {geo.cols.map((c) => (
          <g key={c.key}>
            {c.implied && (
              <rect
                className={c.isCurrent ? styles.impliedNow : styles.implied}
                data-testid="rk-ivr-implied"
                x={c.implied.x} y={c.implied.y} width={c.implied.w} height={c.implied.h} rx="1"
              />
            )}
            {c.realized && (
              <rect
                className={c.dir > 0 ? styles.realizedUp : styles.realizedDown}
                data-testid="rk-ivr-realized"
                x={c.realized.x} y={c.realized.y} width={c.realized.w} height={c.realized.h} rx="1"
              />
            )}
            {c.isCurrent && (
              <text
                className={styles.now}
                data-testid="rk-ivr-now"
                x={c.cx} y={PAD_TOP - 3}
                textAnchor="middle"
              >
                NOW
              </text>
            )}
            <text className={styles.qlabel} x={c.cx} y={geo.labelY} textAnchor="middle">
              {c.isCurrent ? `±${c.label}` : c.label}
            </text>
          </g>
        ))}
      </svg>

      {chip && (
        <VerdictChip label={chip.label} tone={chip.tone} glyph={chip.glyph} size="sm" info={info} />
      )}
      {cold.caption && (
        <div className={`${styles.cold} t-num`} data-testid="rk-ivr-cold">
          {cold.caption}
        </div>
      )}
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/charts/ImpliedVsRealized.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  min-width: 0;
}

.svg {
  width: 100%;
  overflow: visible;
}

.baseline {
  stroke: var(--text-muted);
  stroke-width: 1;
  opacity: 0.55;
}

/* EXPECTATION — hollow, always (§3.3). Never filled, never green/red. */
.implied {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1;
}

/* The current quarter reads brighter, NOT gold: the RICH/CHEAP chip is this
   canvas's single gold element (§3.1). */
.impliedNow {
  fill: none;
  stroke: var(--text-bright);
  stroke-width: 1.4;
}

/* REALIZED — solid and signed. */
.realizedUp {
  fill: var(--gain);
  opacity: 0.85;
}
.realizedDown {
  fill: var(--loss);
  opacity: 0.85;
}

.now {
  fill: var(--text-bright);
  font-family: var(--font-sans);
  font-size: 7px;
  font-weight: 600;
  letter-spacing: var(--ls-label);
}

.qlabel {
  fill: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 8px;
}

.cold {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* PHONE */
@media (max-width: 640px) {
  .wrap {
    gap: 2px;
  }
  .qlabel {
    font-size: 7px;
  }
}
```

**3c.** Extend `app/src/components/research-kit/index.js` — append:

```js
export {
  default as ImpliedVsRealized,
  SIZE as IMPLIED_VS_REALIZED_SIZE,
  pairQuarters,
  coldStartState,
  impliedVerdict,
} from './charts/ImpliedVsRealized'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 14 test files pass, 0 failed.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/charts/ImpliedVsRealized.jsx app/src/components/research-kit/charts/ImpliedVsRealized.module.css app/src/components/research-kit/charts/ImpliedVsRealized.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: ImpliedVsRealized -- the Setup hero

Spec 2026-08-03 §4.3.1a. Paired bars per quarter: hollow = implied at the time,
solid = realized and SIGNED (down-closes descend below the baseline, §3.3). The
hollow bar is drawn on the same side as its outcome so "hollow taller than
solid" is directly legible as "the market overpaid".

pairQuarters() joins the two endpoint payloads on report_date and fills the
current quarter from the live read, so P2 wires /api/research/expected-move and
the earnings-history rows with NO adapter. coldStartState() implements §4.3.1a
as a designed state: under 3 recorded quarters the historical hollow bars are
suppressed and the caption states "Implied tracking since YYYY-MM · n/8
recorded". impliedVerdict() states nothing below 3 fully-paired past quarters.

Gold budget: the RICH/CHEAP chip is the ONE gold element on this canvas, so the
current-quarter highlight is a brighter stroke + NOW tick, not gold.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: `RevisionColumns` + `Histogram`

**Files:**
- Create: `app/src/components/research-kit/charts/RevisionColumns.jsx`, `charts/RevisionColumns.module.css`, `charts/Histogram.jsx`, `charts/Histogram.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/charts/RevisionColumns.test.jsx`, `charts/Histogram.test.jsx` (create)

**Interfaces:**
- Consumes: `EChart`, `CHART_INK`, `GRID_BASE`, `TOOLTIP_BASE`, `axisBase` (Task 1); `EmptyState`, `EyebrowLabel`.
- Produces:
  - `RevisionColumns({ buckets, label, info, height, className, ariaLabel })` + `SIZE`, `revisionTotals()`, `buildRevisionOption()`.
  - `Histogram({ values, bins, marker, markerLabel, valueFormatter, label, info, height, className, ariaLabel })` + `SIZE`, `binValues()`, `buildHistogramOption()`.

**Design notes (read before writing code):**
- `RevisionColumns` takes a **neutral bucket array** `[{ label, up, down }]`. Spec §6 promises *weekly* server-side bucketing; `/api/research/estimates/{sym}` currently returns *fiscal-period* buckets (`{ period, up30, down30 }`). Both map onto `{ label, up, down }` with a one-line adapter at the call site, so the component never changes when the backend lands. Do NOT bake "week" into a prop name.
- Up counts render **above** the zero rule, down counts **below** it, at the same x (`barGap: '-100%'`) — the position channel carries the direction and the colour is redundant (§3.3). One slightly stronger rule at zero, per Part C rule 5.
- `Histogram` is **gated on a live probe** (§5.3): the PT distribution ships only if `GET /api/debug/earnings-sources/{sym}` shows `price-target-news` returning data. The component ships here regardless; whether the page mounts it is P3's decision. Say so in the JSDoc so nobody wires it blind.
- Both charts run through `EChart`, so `role="img"` + built `aria-label` come free — but each must still *supply* a label that states the finding.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/charts/RevisionColumns.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import RevisionColumns, { SIZE, revisionTotals, buildRevisionOption } from './RevisionColumns'
import { CHART_INK } from './echartsCore'

const BUCKETS = [
  { label: 'Jun 30', up: 1, down: 4 },
  { label: 'Jul 7', up: 3, down: 2 },
  { label: 'Jul 14', up: 6, down: 1 },
  { label: 'Jul 21', up: 5, down: 0 },
]

describe('revisionTotals', () => {
  it('sums both directions and the net', () => {
    expect(revisionTotals(BUCKETS)).toEqual({ up: 15, down: 7, net: 8, buckets: 4 })
  })

  it('treats missing counts as zero, never NaN', () => {
    expect(revisionTotals([{ label: 'a' }, { label: 'b', up: 2 }])).toEqual({ up: 2, down: 0, net: 2, buckets: 2 })
  })

  it('returns a zero shape on nothing', () => {
    expect(revisionTotals(null)).toEqual({ up: 0, down: 0, net: 0, buckets: 0 })
  })
})

describe('buildRevisionOption', () => {
  it('puts ups above zero and downs below, on the same x', () => {
    const opt = buildRevisionOption(BUCKETS)
    const [up, down] = opt.series
    expect(up.data).toEqual([1, 3, 6, 5])
    // Non-positive, and a zero count is PLAIN 0 -- not -0, which toEqual treats
    // as a different value from 0 and which would render a phantom mark.
    expect(down.data).toEqual([-4, -2, -1, 0])
    expect(down.barGap).toBe('-100%')
    expect(up.itemStyle.color).toBe(CHART_INK.gain)
    expect(down.itemStyle.color).toBe(CHART_INK.loss)
  })

  it('coerces a negative or junk down-count to a downward bar', () => {
    const opt = buildRevisionOption([{ label: 'a', up: '2', down: -3 }, { label: 'b', up: null, down: 'x' }])
    expect(opt.series[0].data).toEqual([2, 0])
    expect(opt.series[1].data).toEqual([-3, 0])
  })

  it('draws exactly one stronger rule, at zero (Part C rule 5)', () => {
    const opt = buildRevisionOption(BUCKETS)
    expect(opt.series[0].markLine.data).toEqual([{ yAxis: 0 }])
    expect(opt.series[0].markLine.silent).toBe(true)
    expect(opt.series[0].markLine.symbol).toBe('none')
  })

  it('labels the x axis with the bucket labels and carries no legend', () => {
    const opt = buildRevisionOption(BUCKETS)
    expect(opt.xAxis.data).toEqual(['Jun 30', 'Jul 7', 'Jul 14', 'Jul 21'])
    expect(opt.legend).toBeUndefined()
    expect(opt.yAxis.axisLine.show).toBe(false)
  })
})

describe('RevisionColumns', () => {
  it('renders an EmptyState with no buckets', () => {
    render(<RevisionColumns buckets={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('renders an EmptyState when every bucket is empty (an all-zero chart is a lie)', () => {
    render(<RevisionColumns buckets={[{ label: 'a', up: 0, down: 0 }]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('mounts and hands ECharts the built option', () => {
    render(<RevisionColumns buckets={BUCKETS} />)
    expect(screen.getByTestId('echart-inner')).toBeInTheDocument()
    expect(captured.option.series).toHaveLength(2)
  })

  it('builds an aria-label stating the direction of the crowd', () => {
    render(<RevisionColumns buckets={BUCKETS} />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Estimate revisions across 4 periods: 15 up, 7 down, net +8.')
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 180 })
  })
})
```

Create `app/src/components/research-kit/charts/Histogram.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import Histogram, { SIZE, binValues, buildHistogramOption } from './Histogram'

const PT = [180, 185, 190, 190, 195, 200, 205, 240]

describe('binValues', () => {
  it('splits the range into the requested number of bins', () => {
    const bins = binValues(PT, 4)
    expect(bins).toHaveLength(4)
    expect(bins[0].x0).toBe(180)
    expect(bins[3].x1).toBe(240)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(PT.length)
  })

  it('puts the maximum in the LAST bin, not off the end', () => {
    const bins = binValues(PT, 4)
    expect(bins[3].count).toBe(1)
  })

  it('drops non-finite values instead of poisoning the range', () => {
    const bins = binValues([1, 2, NaN, null, undefined, 'x', Infinity, 3], 2)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(3)
  })

  it('returns a single bin when every value is identical', () => {
    const bins = binValues([7, 7, 7], 5)
    expect(bins).toHaveLength(1)
    expect(bins[0]).toMatchObject({ x0: 7, x1: 7, count: 3 })
  })

  it('returns nothing when there is nothing finite', () => {
    expect(binValues([], 5)).toEqual([])
    expect(binValues(null, 5)).toEqual([])
    expect(binValues([NaN, 'x'], 5)).toEqual([])
  })
})

describe('buildHistogramOption', () => {
  it('draws one bar per bin with the counts', () => {
    const bins = binValues(PT, 4)
    const opt = buildHistogramOption(bins, {})
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data).toEqual(bins.map((b) => b.count))
    expect(opt.xAxis.data).toHaveLength(4)
  })

  it('marks the current value when one is given, and omits the mark otherwise', () => {
    const bins = binValues(PT, 4)
    const withMark = buildHistogramOption(bins, { marker: 195, markerLabel: 'Price $195' })
    expect(withMark.series[0].markLine.data[0].xAxis).toBe(1)     // the bin containing 195
    expect(withMark.series[0].markLine.data[0].name).toBe('Price $195')
    expect(buildHistogramOption(bins, {}).series[0].markLine).toBeUndefined()
  })

  it('does not mark a value outside the distribution', () => {
    const bins = binValues(PT, 4)
    expect(buildHistogramOption(bins, { marker: 5 }).series[0].markLine).toBeUndefined()
  })
})

describe('Histogram', () => {
  it('renders an EmptyState when the distribution is empty', () => {
    render(<Histogram values={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
    expect(screen.queryByTestId('echart-inner')).toBeNull()
  })

  it('mounts with the binned option', () => {
    render(<Histogram values={PT} bins={4} />)
    expect(captured.option.series[0].data).toEqual(binValues(PT, 4).map((b) => b.count))
  })

  it('builds an aria-label naming the sample size and range', () => {
    render(<Histogram values={PT} bins={4} valueFormatter={(v) => `$${v.toFixed(0)}`} />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Distribution of 8 values from $180 to $240.')
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 160 })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd app && npx vitest run src/components/research-kit/charts/RevisionColumns.test.jsx src/components/research-kit/charts/Histogram.test.jsx
```
Expected: both fail to resolve their module.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/charts/RevisionColumns.jsx`:

```jsx
// app/src/components/research-kit/charts/RevisionColumns.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import styles from './RevisionColumns.module.css'

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: 180 }

const count = (v) => {
  const n = Math.abs(Number(v))
  return Number.isFinite(n) ? n : 0
}

/** Totals for the caption + aria-label. Pure. */
export function revisionTotals(buckets) {
  const list = buckets || []
  const up = list.reduce((a, b) => a + count(b?.up), 0)
  const down = list.reduce((a, b) => a + count(b?.down), 0)
  return { up, down, net: up - down, buckets: list.length }
}

/**
 * Diverging up/down columns (dataviz pattern 3).
 *
 * Ups are positive, downs negative, drawn at the SAME x with barGap '-100%' —
 * the position channel carries the direction, so colour is redundant (§3.3).
 */
export function buildRevisionOption(buckets) {
  const list = buckets || []
  return {
    grid: { ...GRID_BASE, left: 34 },
    xAxis: { type: 'category', data: list.map((b) => b?.label ?? ''), ...axisBase() },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'axis',
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0
        const b = list[i] || {}
        return `${b.label ?? ''}<br/>▲ ${count(b.up)} up<br/>▼ ${count(b.down)} down`
      },
    },
    series: [
      {
        name: 'Up',
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { color: CHART_INK.gain },
        data: list.map((b) => count(b?.up)),
        // The zero rule is semantic in finance: above vs below. One rule, no box.
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: CHART_INK.muted, width: 1, type: 'solid', opacity: 0.7 },
          data: [{ yAxis: 0 }],
        },
      },
      {
        name: 'Down',
        type: 'bar',
        barMaxWidth: 14,
        barGap: '-100%',
        itemStyle: { color: CHART_INK.loss },
        // `-0` is a real value in JS and is NOT equal to 0 under Object.is —
        // return plain 0 for an empty bucket.
        data: list.map((b) => {
          const d = count(b?.down)
          return d === 0 ? 0 : -d
        }),
      },
    ],
  }
}

/**
 * Estimate-revision momentum (spec §5.3 Estimates hero; dataviz pattern 3).
 *
 * `buckets` is DELIBERATELY neutral: `[{ label, up, down }]`. Spec §6 promises
 * weekly server-side bucketing; `/api/research/estimates/{sym}` currently
 * returns fiscal-period buckets (`{ period, up30, down30 }`). Both map on with
 * a one-line adapter at the call site, e.g.
 *
 *   buckets={revisions.map(r => ({ label: r.period, up: r.up30, down: r.down30 }))}
 *
 * so this component does not change when the weekly endpoint lands.
 */
export default function RevisionColumns({
  buckets,
  label = 'Estimate revisions',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const list = Array.isArray(buckets) ? buckets : []
  const totals = revisionTotals(list)

  // An all-zero chart draws a flat nothing and reads as "no revisions data" —
  // say that in words instead.
  if (!list.length || (totals.up === 0 && totals.down === 0)) {
    return (
      <EmptyState
        icon="chart"
        title="No estimate revisions"
        hint="Analysts have not moved their numbers in this window."
        className={className}
      />
    )
  }

  const sign = totals.net > 0 ? '+' : ''
  const built = ariaLabel
    || `Estimate revisions across ${totals.buckets} periods: ${totals.up} up, ${totals.down} down, net ${sign}${totals.net}.`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <EChart
        option={buildRevisionOption(list)}
        height={height}
        ariaLabel={built}
        testId="rk-revisions"
      />
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/charts/RevisionColumns.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

/* PHONE */
@media (max-width: 640px) {
  .wrap {
    gap: 2px;
  }
}
```

**3c.** Create `app/src/components/research-kit/charts/Histogram.jsx`:

```jsx
// app/src/components/research-kit/charts/Histogram.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import styles from './Histogram.module.css'

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: 160 }

/**
 * Equal-width bins over the finite values. Pure.
 *
 * The maximum lands in the LAST bin (a naive floor() would push it into a
 * phantom bin N+1 and silently drop the highest price target — exactly the
 * value a reader looks for). Identical values collapse to one bin rather than
 * dividing by a zero-width range.
 */
export function binValues(values, bins = 8) {
  const nums = (values || []).map(Number).filter((v) => Number.isFinite(v))
  if (!nums.length) return []
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  if (hi === lo) return [{ x0: lo, x1: lo, count: nums.length }]

  const n = Math.max(1, Math.floor(bins))
  const w = (hi - lo) / n
  const out = Array.from({ length: n }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }))
  for (const v of nums) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)))
    out[i].count += 1
  }
  return out
}

/**
 * Index of the bin containing `v`, or -1 when it falls outside the
 * distribution. Pure.
 *
 * Uses the SAME floor rule as binValues — a `x <= bin.x1` scan would put a
 * boundary value (a target sitting exactly on a bin edge) one bin to the left
 * of where its own count was tallied, and the marker would point at the wrong
 * bar.
 */
function binIndexOf(bins, v) {
  const x = Number(v)
  if (!Number.isFinite(x) || !bins.length) return -1
  const lo = bins[0].x0
  const hi = bins[bins.length - 1].x1
  if (x < lo || x > hi) return -1
  const w = bins[0].x1 - bins[0].x0
  if (!(w > 0)) return 0
  return Math.min(bins.length - 1, Math.floor((x - lo) / w))
}

export function buildHistogramOption(bins, { marker, markerLabel, valueFormatter } = {}) {
  const fmt = valueFormatter || ((v) => (v == null ? '—' : Number(v).toFixed(0)))
  const markIdx = binIndexOf(bins, marker)

  const series = {
    type: 'bar',
    barCategoryGap: '18%',
    itemStyle: { color: CHART_INK.muted, borderRadius: [2, 2, 0, 0] },
    data: bins.map((b) => b.count),
  }
  if (markIdx >= 0) {
    series.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: CHART_INK.gold, width: 1, type: 'dashed' },
      label: { color: CHART_INK.bright, fontSize: 9, formatter: () => markerLabel || fmt(marker) },
      data: [{ xAxis: markIdx, name: markerLabel || fmt(marker) }],
    }
  }

  return {
    grid: { ...GRID_BASE, left: 30, bottom: 26 },
    xAxis: {
      type: 'category',
      data: bins.map((b) => (b.x0 === b.x1 ? fmt(b.x0) : `${fmt(b.x0)}–${fmt(b.x1)}`)),
      ...axisBase({ axisLabel: { color: CHART_INK.muted, fontSize: 9, interval: 0, rotate: bins.length > 5 ? 30 : 0 } }),
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitNumber: 2,
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip: { ...TOOLTIP_BASE, trigger: 'axis' },
    series: [series],
  }
}

/**
 * Simple distribution histogram (spec §5.3 Estimates; dataviz "distribution is
 * the message" — 12 buys and 1 sell is not "consensus: buy").
 *
 * GATED (§5.3/§6): the analyst price-target distribution ships **only after**
 * the FMP `price-target-news` probe passes via
 * `GET /api/debug/earnings-sources/{sym}`. If the probe fails, the page ships
 * the PT `RangeSlider` alone, permanently — do not mount this on unverified
 * data.
 */
export default function Histogram({
  values,
  bins = 8,
  marker,
  markerLabel,
  valueFormatter,
  label = 'Distribution',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const binned = binValues(values, bins)

  if (!binned.length) {
    return (
      <EmptyState
        icon="chart"
        title="No distribution to show"
        hint="This needs at least one published number from covering analysts."
        className={className}
      />
    )
  }

  const fmt = valueFormatter || ((v) => Number(v).toFixed(0))
  const total = binned.reduce((a, b) => a + b.count, 0)
  const built = ariaLabel
    || `Distribution of ${total} values from ${fmt(binned[0].x0)} to ${fmt(binned[binned.length - 1].x1)}.`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <EChart
        option={buildHistogramOption(binned, { marker, markerLabel, valueFormatter })}
        height={height}
        ariaLabel={built}
        testId="rk-histogram"
      />
    </div>
  )
}
```

**3d.** Create `app/src/components/research-kit/charts/Histogram.module.css` — identical body to `RevisionColumns.module.css` (`.wrap` flex column, `gap: var(--space-xs)`, `min-width: 0`, plus the PHONE `gap: 2px` rule).

**3e.** Extend `app/src/components/research-kit/index.js` — append:

```js
export {
  default as RevisionColumns,
  SIZE as REVISION_COLUMNS_SIZE,
  revisionTotals,
  buildRevisionOption,
} from './charts/RevisionColumns'
export {
  default as Histogram,
  SIZE as HISTOGRAM_SIZE,
  binValues,
  buildHistogramOption,
} from './charts/Histogram'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 16 test files pass, 0 failed.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/charts/RevisionColumns.jsx app/src/components/research-kit/charts/RevisionColumns.module.css app/src/components/research-kit/charts/RevisionColumns.test.jsx app/src/components/research-kit/charts/Histogram.jsx app/src/components/research-kit/charts/Histogram.module.css app/src/components/research-kit/charts/Histogram.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: RevisionColumns + Histogram

Spec 2026-08-03 §5.3, dataviz patterns 3 and 17. Both draw through
charts/echartsCore.js (tree-shaken BarChart), both split into an exported pure
option-builder plus a mount smoke test -- jsdom has no canvas, so the builder IS
the testable seam.

RevisionColumns takes a NEUTRAL bucket array [{label, up, down}] so the current
fiscal-period payload and the promised weekly buckets (§6) both fit with a
one-line adapter and the component never changes. Ups above zero, downs below,
same x -- position carries direction, colour is redundant (§3.3). An all-zero
window renders the EmptyState instead of a flat chart that reads as broken.

Histogram's binValues() puts the maximum in the LAST bin (a naive floor() drops
the highest price target, the exact number a reader looks for) and collapses an
all-identical sample to one bin instead of dividing by zero. Its JSDoc carries
the §5.3 probe gate: the PT distribution ships only after price-target-news
passes /api/debug/earnings-sources.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: `RatingCrown` + `CheckupRow`

**Files:**
- Create: `app/src/components/research-kit/RatingCrown.jsx`, `RatingCrown.module.css`, `CheckupRow.jsx`, `CheckupRow.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/RatingCrown.test.jsx`, `CheckupRow.test.jsx` (create)

**Interfaces:**
- Consumes: `EmptyState`, `EyebrowLabel`, `InfoTip` (P1F-A), `SCORE_TONES` semantics, `UIcon`; the ratings payload `{ composite, components, checkup, method, basis, universe_n }` (`api/services/research/ratings.py`).
- Produces: `RatingCrown({ score, components, basis, universeN, method, variant, label, info, className, ariaLabel })` + `scoreTier()`, `letterTier()`, `ringGeometry()`, `basisPill()`, `COMPONENT_ORDER`; `CheckupRow({ label, status, value, threshold, className })` + `normalizeStatus()`.

**Design notes (read before writing code):**
- **This is THE single ratings rendering (§5.3).** The page header's `RatingBadge` is the SAME component with `variant="compact"` — a smaller ring and the number, no chips, no basis pill. There is no second ring, no third number style. The old page rendered ratings three different ways; that is the bug being fixed.
- **Distinct identity from the Setup Grade (§4.2).** The stock's rating is a **ring**; the event's grade is a **chip**. `RatingCrown` therefore stamps `data-rk-identity="ring"` on its root so P2's required "the two never render with the same visual identity" assertion has a stable hook. `RatingCrown` must never render a `VerdictChip`.
- **`scoreTier` thresholds are the ones already shipping** in `app/src/pages/research/tabs/RatingsTab.jsx:17-23` (≥80 / ≥60 / ≥40 / ≥20). Reuse them exactly — the crown replaces that function, it does not re-calibrate it.
- **Basis pill in plain English (§5.3):** `absolute` → "Scored against fixed thresholds — not ranked vs other stocks"; `percentile` → "Ranked vs 3,685 stocks". The ⓘ warns that scores may shift at cutover. The crown is built to receive the percentile job **without redesign** — that means the pill is data-driven, never a hardcoded string.
- **Ring sweep is the one mount animation** and is gated by `@media (prefers-reduced-motion: reduce)` in CSS (Part C rule 8).
- `CheckupRow`'s third state is **`neutral`**, matching the backend (`_chk()` emits `'pass'|'fail'|'neutral'`). Accept `'na'` as an alias, normalize everything unknown to `neutral`, never throw.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/RatingCrown.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RatingCrown, {
  scoreTier, letterTier, ringGeometry, basisPill, COMPONENT_ORDER,
} from './RatingCrown'

/** The shipped /api/research/ratings/{sym} component shape. */
const COMPONENTS = { eps: 92, rs: 88, growth: 71, value: 34, smr: 'A', accdis: 'B', sponsorship: 'C' }

describe('scoreTier — the thresholds RatingsTab already ships', () => {
  it.each([[99, 'elite'], [80, 'elite'], [79, 'strong'], [60, 'strong'], [59, 'neutral'], [40, 'neutral'], [39, 'weak'], [20, 'weak'], [19, 'poor'], [0, 'poor']])(
    'scores %i as %s', (v, tier) => { expect(scoreTier(v)).toBe(tier) },
  )

  it('is null for a missing score rather than guessing "poor"', () => {
    expect(scoreTier(null)).toBeNull()
    expect(scoreTier(undefined)).toBeNull()
    expect(scoreTier('x')).toBeNull()
  })
})

describe('letterTier', () => {
  it.each([['A', 'elite'], ['B', 'strong'], ['C', 'neutral'], ['D', 'weak'], ['E', 'poor'], ['F', 'poor']])(
    'grades %s as %s', (l, tier) => { expect(letterTier(l)).toBe(tier) },
  )

  it('is case-insensitive and null on nothing', () => {
    expect(letterTier('a')).toBe('elite')
    expect(letterTier(null)).toBeNull()
    expect(letterTier('')).toBeNull()
  })
})

describe('ringGeometry', () => {
  it('sweeps the arc in proportion to the score over 99', () => {
    const g = ringGeometry(99, { diameter: 100, stroke: 10 })
    expect(g.dash).toBeCloseTo(g.circumference, 6)
    const half = ringGeometry(49.5, { diameter: 100, stroke: 10 })
    expect(half.dash).toBeCloseTo(half.circumference / 2, 6)
  })

  it('insets the radius by half the stroke so the ring never clips', () => {
    const g = ringGeometry(50, { diameter: 100, stroke: 10 })
    expect(g.r).toBe(45)
    expect(g.cx).toBe(50)
    expect(g.cy).toBe(50)
  })

  it('clamps out-of-range and non-finite scores', () => {
    expect(ringGeometry(150, { diameter: 100, stroke: 10 }).dash).toBeCloseTo(ringGeometry(99, { diameter: 100, stroke: 10 }).circumference, 6)
    expect(ringGeometry(-5, { diameter: 100, stroke: 10 }).dash).toBe(0)
    expect(ringGeometry(null, { diameter: 100, stroke: 10 }).dash).toBe(0)
  })
})

describe('basisPill (§5.3) — plain English, data-driven', () => {
  it('says what absolute scoring actually means', () => {
    const p = basisPill('absolute', null)
    expect(p.text).toBe('Scored against fixed thresholds — not ranked vs other stocks')
    expect(p.info).toMatch(/percentile/i)
  })

  it('names the universe size once percentile ranking lands', () => {
    expect(basisPill('percentile', 3685).text).toBe('Ranked vs 3,685 stocks')
  })

  it('falls back to the absolute wording when percentile has no universe count', () => {
    expect(basisPill('percentile', null).text).toBe('Scored against fixed thresholds — not ranked vs other stocks')
  })

  it('never throws on an unknown basis', () => {
    expect(basisPill('weird', 10).text).toBe('Scored against fixed thresholds — not ranked vs other stocks')
  })
})

describe('RatingCrown', () => {
  const base = { score: 87, components: COMPONENTS, basis: 'absolute', universeN: null, method: 'Threshold-calibrated v1' }

  it('renders an EmptyState when there is no rating at all', () => {
    render(<RatingCrown score={null} components={{}} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('shows the composite number on tabular numerals', () => {
    render(<RatingCrown {...base} />)
    const n = screen.getByTestId('rk-crown-score')
    expect(n).toHaveTextContent('87')
    expect(n.className).toMatch(/\bt-num\b/)
  })

  it('renders all seven component chips in a fixed order', () => {
    render(<RatingCrown {...base} />)
    const chips = screen.getAllByTestId('rk-crown-chip')
    expect(chips).toHaveLength(7)
    expect(chips.map((c) => c.getAttribute('data-key'))).toEqual(COMPONENT_ORDER.map((c) => c.key))
  })

  it('renders a meter only for the numeric components', () => {
    const { container } = render(<RatingCrown {...base} />)
    expect(container.querySelectorAll('[data-testid="rk-crown-meter"]')).toHaveLength(4)
  })

  it('renders an em-dash for a missing component instead of a zero meter', () => {
    render(<RatingCrown {...base} components={{ ...COMPONENTS, growth: null }} />)
    const chip = screen.getAllByTestId('rk-crown-chip').find((c) => c.getAttribute('data-key') === 'growth')
    expect(chip).toHaveTextContent('—')
    expect(chip.querySelector('[data-testid="rk-crown-meter"]')).toBeNull()
  })

  it('shows the basis pill', () => {
    render(<RatingCrown {...base} />)
    expect(screen.getByTestId('rk-crown-basis'))
      .toHaveTextContent('Scored against fixed thresholds — not ranked vs other stocks')
  })

  it('is a RING, never a chip — the identity that separates it from the Setup Grade (§4.2)', () => {
    const { container } = render(<RatingCrown {...base} />)
    expect(container.firstChild.getAttribute('data-rk-identity')).toBe('ring')
    expect(container.querySelector('svg circle')).not.toBeNull()
  })

  it('compact variant is the same component: ring + number, no chips, no pill', () => {
    render(<RatingCrown {...base} variant="compact" />)
    expect(screen.getByTestId('rk-crown-score')).toHaveTextContent('87')
    expect(screen.queryAllByTestId('rk-crown-chip')).toHaveLength(0)
    expect(screen.queryByTestId('rk-crown-basis')).toBeNull()
  })

  it('builds an aria-label carrying the score, its standing and the basis', () => {
    render(<RatingCrown {...base} />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('UCT Rating 87 of 99 — elite. Scored against fixed thresholds — not ranked vs other stocks.')
  })

  it('carries the method provenance when given', () => {
    render(<RatingCrown {...base} method="Percentile rank vs 3,685-stock universe" />)
    expect(screen.getByTestId('rk-crown-method')).toHaveTextContent('Percentile rank vs 3,685-stock universe')
  })
})
```

Create `app/src/components/research-kit/CheckupRow.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CheckupRow, { normalizeStatus } from './CheckupRow'

describe('normalizeStatus', () => {
  it('passes the backend vocabulary through', () => {
    expect(normalizeStatus('pass')).toBe('pass')
    expect(normalizeStatus('fail')).toBe('fail')
    expect(normalizeStatus('neutral')).toBe('neutral')
  })

  it('accepts na as an alias and neutralises anything unknown', () => {
    expect(normalizeStatus('na')).toBe('neutral')
    expect(normalizeStatus('PASS')).toBe('pass')
    expect(normalizeStatus(undefined)).toBe('neutral')
    expect(normalizeStatus(42)).toBe('neutral')
  })
})

describe('CheckupRow', () => {
  it('renders the requirement and the actual value', () => {
    render(<CheckupRow label="ROE ≥ 17%" status="pass" value="28%" />)
    expect(screen.getByText('ROE ≥ 17%')).toBeInTheDocument()
    expect(screen.getByTestId('rk-checkup-value')).toHaveTextContent('28%')
  })

  it('renders actual-vs-threshold when a threshold is supplied (§5.3)', () => {
    render(<CheckupRow label="ROE" status="pass" value="28.4%" threshold="17% req" />)
    expect(screen.getByTestId('rk-checkup-value')).toHaveTextContent('28.4%')
    expect(screen.getByTestId('rk-checkup-threshold')).toHaveTextContent('vs 17% req')
  })

  it('shape-codes the outcome with a UIcon, never colour alone (§3.3)', () => {
    const { container, rerender } = render(<CheckupRow label="x" status="pass" value="1" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.firstChild.getAttribute('data-status')).toBe('pass')
    rerender(<CheckupRow label="x" status="fail" value="1" />)
    expect(container.firstChild.getAttribute('data-status')).toBe('fail')
  })

  it('uses a text marker, not an icon, for the neutral state', () => {
    const { container } = render(<CheckupRow label="x" status="neutral" value="—" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByTestId('rk-checkup-glyph')).toHaveTextContent('—')
  })

  it('states the outcome in text for screen readers', () => {
    render(<CheckupRow label="ROE ≥ 17%" status="fail" value="9%" />)
    expect(screen.getByTestId('rk-checkup-sr')).toHaveTextContent('fail')
  })

  it('puts the value on tabular numerals and carries no inline styles', () => {
    const { container } = render(<CheckupRow label="x" status="pass" value="28%" />)
    expect(screen.getByTestId('rk-checkup-value').className).toMatch(/\bt-num\b/)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })

  it('renders an em-dash when there is no value', () => {
    render(<CheckupRow label="x" status="neutral" />)
    expect(screen.getByTestId('rk-checkup-value')).toHaveTextContent('—')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd app && npx vitest run src/components/research-kit/RatingCrown.test.jsx src/components/research-kit/CheckupRow.test.jsx
```

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/RatingCrown.jsx`:

```jsx
// app/src/components/research-kit/RatingCrown.jsx
import EmptyState from './EmptyState'
import EyebrowLabel from './EyebrowLabel'
import InfoTip from './InfoTip'
import styles from './RatingCrown.module.css'

/** §3.4 skeleton size contract (full variant). */
export const SIZE = { width: '100%', height: 300 }

const DIAMETER = { full: 132, compact: 44 }
const STROKE = { full: 10, compact: 4 }
/** The scale is 0-99 (IBD-style), not 0-100. */
const MAX = 99

/** The seven components, in ONE fixed order. `kind` decides the chip's form. */
export const COMPONENT_ORDER = [
  { key: 'eps', label: 'EPS Strength', kind: 'score' },
  { key: 'rs', label: 'Relative Strength', kind: 'score' },
  { key: 'growth', label: 'Growth', kind: 'score' },
  { key: 'value', label: 'Value', kind: 'score' },
  { key: 'smr', label: 'SMR', kind: 'letter' },
  { key: 'accdis', label: 'Acc / Dis', kind: 'letter' },
  { key: 'sponsorship', label: 'Sponsorship', kind: 'letter' },
]

const TONE_CLASS = {
  elite: 'toneElite',
  strong: 'toneStrong',
  neutral: 'toneNeutral',
  weak: 'toneWeak',
  poor: 'tonePoor',
}

/**
 * SCORE_TONES band for a 0-99 score. These are the thresholds already shipping
 * in pages/research/tabs/RatingsTab.jsx — the crown REPLACES that function, it
 * does not recalibrate it. null (not 'poor') for a missing score: absent is not
 * the same as bad.
 */
export function scoreTier(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n >= 80) return 'elite'
  if (n >= 60) return 'strong'
  if (n >= 40) return 'neutral'
  if (n >= 20) return 'weak'
  return 'poor'
}

/** SCORE_TONES band for an A-F letter component. */
export function letterTier(l) {
  const s = typeof l === 'string' ? l.trim().toUpperCase() : ''
  if (!s) return null
  if (s.startsWith('A')) return 'elite'
  if (s.startsWith('B')) return 'strong'
  if (s.startsWith('C')) return 'neutral'
  if (s.startsWith('D')) return 'weak'
  return 'poor'
}

/** Arc geometry for the ring. Pure — the dash length IS the score. */
export function ringGeometry(score, { diameter = DIAMETER.full, stroke = STROKE.full } = {}) {
  const r = (diameter - stroke) / 2
  const circumference = 2 * Math.PI * r
  const n = Number(score)
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(MAX, n)) / MAX : 0
  return { r, cx: diameter / 2, cy: diameter / 2, diameter, stroke, circumference, dash: circumference * pct }
}

/**
 * The §5.3 basis pill, in plain English and DATA-DRIVEN so the percentile job
 * can land without a redesign. Percentile wording requires a universe count —
 * "ranked vs an unknown number of stocks" is not an audit trail.
 */
export function basisPill(basis, universeN) {
  const n = Number(universeN)
  if (basis === 'percentile' && Number.isFinite(n) && n > 0) {
    return {
      text: `Ranked vs ${n.toLocaleString('en-US')} stocks`,
      info: 'Each component is a percentile rank across the covered universe, refreshed nightly.',
    }
  }
  return {
    text: 'Scored against fixed thresholds — not ranked vs other stocks',
    info: 'Scores compare this stock against fixed thresholds. When percentile ranking is switched on, scores may shift.',
  }
}

/**
 * THE ratings rendering (spec §5.3) — composite ring + the seven component
 * chips. The page header's badge is this same component with
 * `variant="compact"`; there is no second ring and no third number style.
 *
 * IDENTITY (§4.2): the stock's rating is a RING; the event's Earnings Setup
 * Grade is a CHIP. This component stamps data-rk-identity="ring" and must never
 * render a VerdictChip — P2 asserts the two identities stay distinct.
 */
export default function RatingCrown({
  score,
  components,
  basis = 'absolute',
  universeN = null,
  method,
  variant = 'full',
  label = 'UCT Rating',
  info,
  className = '',
  ariaLabel,
}) {
  const comp = components || {}
  const tier = scoreTier(score)
  const hasAny = tier != null || COMPONENT_ORDER.some((c) => comp[c.key] != null)

  if (!hasAny) {
    return (
      <EmptyState
        icon="warning"
        title="Ratings unavailable for this ticker"
        hint="A rating needs fundamentals and price history; both are missing here."
        className={className}
      />
    )
  }

  const compact = variant === 'compact'
  const geo = ringGeometry(score, {
    diameter: compact ? DIAMETER.compact : DIAMETER.full,
    stroke: compact ? STROKE.compact : STROKE.full,
  })
  const pill = basisPill(basis, universeN)
  const built = ariaLabel
    || `${label} ${score ?? '—'} of ${MAX}${tier ? ` — ${tier}` : ''}. ${pill.text}.`

  return (
    <div
      className={`${styles.wrap} ${compact ? styles.compact : ''} ${className}`}
      data-rk-identity="ring"
    >
      {!compact && label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <div className={styles.ringWrap} role="img" aria-label={built}>
        <svg className={styles.ring} viewBox={`0 0 ${geo.diameter} ${geo.diameter}`} width={geo.diameter} height={geo.diameter}>
          <circle
            className={styles.track}
            cx={geo.cx} cy={geo.cy} r={geo.r}
            strokeWidth={geo.stroke}
            fill="none"
          />
          <circle
            className={`${styles.arc} ${tier ? styles[TONE_CLASS[tier]] : ''}`}
            cx={geo.cx} cy={geo.cy} r={geo.r}
            strokeWidth={geo.stroke}
            fill="none"
            strokeDasharray={`${geo.dash} ${geo.circumference - geo.dash}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${geo.cx} ${geo.cy})`}
          />
        </svg>
        <div className={`${styles.score} ${tier ? styles[TONE_CLASS[tier]] : ''} t-num`} data-testid="rk-crown-score">
          {score == null ? '—' : score}
        </div>
      </div>

      {!compact && (
        <>
          <div className={styles.chips}>
            {COMPONENT_ORDER.map((c) => {
              const raw = comp[c.key]
              const isScore = c.kind === 'score'
              const n = Number(raw)
              const numeric = isScore && Number.isFinite(n)
              const t = isScore ? scoreTier(raw) : letterTier(raw)
              return (
                <div className={styles.chip} data-testid="rk-crown-chip" data-key={c.key} key={c.key}>
                  <div className={styles.chipLabel}>{c.label}</div>
                  <div className={`${styles.chipValue} ${t ? styles[TONE_CLASS[t]] : ''} t-num`}>
                    {raw == null || raw === '' ? '—' : raw}
                  </div>
                  {numeric && (
                    <div className={styles.meter} data-testid="rk-crown-meter">
                      <div
                        className={`${styles.meterFill} ${t ? styles[TONE_CLASS[t]] : ''}`}
                        style={{ width: `${Math.max(0, Math.min(MAX, n)) / MAX * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className={styles.basis} data-testid="rk-crown-basis">
            <span>{pill.text}</span>
            <InfoTip label="About this rating basis" text={pill.info} />
          </div>

          {method && (
            <div className={styles.method} data-testid="rk-crown-method">{method}</div>
          )}
        </>
      )}
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/RatingCrown.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  min-width: 0;
}

.compact {
  gap: 0;
}

.ringWrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.track {
  stroke: var(--glass-border-neutral);
}

.arc {
  stroke: var(--text-muted);
  /* The ONE mount animation on this surface (Part C rule 8). */
  transition: stroke-dasharray var(--duration-fast) var(--ease-out);
}

.score {
  position: absolute;
  font-family: var(--font-sans);
  font-size: var(--text-display);
  font-weight: 600;
  line-height: 1;
  color: var(--text-heading);
}

.compact .score {
  font-size: var(--text-base);
}

.chips {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-sm);
  width: 100%;
}

.chip {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: var(--space-sm);
  border: 1px solid var(--glass-border-neutral);
  border-radius: var(--radius-md);
  background: var(--glass-surface);
}

.chipLabel {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--text-muted);
}

.chipValue {
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-bright);
}

.meter {
  height: 3px;
  border-radius: var(--radius-sm);
  background: var(--glass-border-neutral);
  overflow: hidden;
}

.meterFill {
  height: 100%;
  background: var(--text-muted);
}

.basis {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-bright);
  text-align: center;
}

.method {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-align: center;
}

/* Score ramp — value ink and meter fill share the tone class. */
.toneElite { color: var(--score-elite); stroke: var(--score-elite); }
.toneStrong { color: var(--score-strong); stroke: var(--score-strong); }
.toneNeutral { color: var(--score-neutral); stroke: var(--score-neutral); }
.toneWeak { color: var(--score-weak); stroke: var(--score-weak); }
.tonePoor { color: var(--score-poor); stroke: var(--score-poor); }

.meterFill.toneElite { background: var(--score-elite); }
.meterFill.toneStrong { background: var(--score-strong); }
.meterFill.toneNeutral { background: var(--score-neutral); }
.meterFill.toneWeak { background: var(--score-weak); }
.meterFill.tonePoor { background: var(--score-poor); }

@media (prefers-reduced-motion: reduce) {
  .arc {
    transition: none;
  }
}

/* PHONE */
@media (max-width: 640px) {
  .chips {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .wrap {
    gap: var(--space-sm);
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .chips {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

**3c.** Create `app/src/components/research-kit/CheckupRow.jsx`:

```jsx
// app/src/components/research-kit/CheckupRow.jsx
import UIcon from '../ui/UIcon'
import styles from './CheckupRow.module.css'

const STATUSES = new Set(['pass', 'fail', 'neutral'])

/**
 * The backend's third state is `neutral` (api/services/research/ratings.py
 * `_chk`), not `na`. Accept `na` as an alias, normalise anything unknown to
 * neutral, never throw.
 */
export function normalizeStatus(status) {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (s === 'na' || s === 'n/a') return 'neutral'
  return STATUSES.has(s) ? s : 'neutral'
}

/**
 * One Stock Checkup line (spec §5.3): requirement, outcome, and the ACTUAL
 * number that produced it — "ROE 28.4% vs 17% req ✓". A pass/fail with no
 * number is an assertion; with the number it is an audit trail (§2.2).
 *
 * SHAPE, NOT COLOUR (§3.3): the outcome is a UIcon check/x — the tint is the
 * redundant channel. The neutral state is a text marker, because "no icon" is
 * itself the signal that nothing was measured.
 */
export default function CheckupRow({ label, status, value, threshold, className = '' }) {
  const s = normalizeStatus(status)

  return (
    <div className={`${styles.row} ${styles[s]} ${className}`} data-status={s} data-testid="rk-checkup">
      <span className={styles.glyph} data-testid="rk-checkup-glyph" aria-hidden="true">
        {s === 'pass' ? <UIcon name="check" size={13} gold={false} />
          : s === 'fail' ? <UIcon name="x" size={13} gold={false} />
            : '—'}
      </span>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} t-num`} data-testid="rk-checkup-value">
        {value == null || value === '' ? '—' : value}
      </span>
      {threshold != null && threshold !== '' && (
        <span className={`${styles.threshold} t-num`} data-testid="rk-checkup-threshold">
          vs {threshold}
        </span>
      )}
      <span className={styles.srOnly} data-testid="rk-checkup-sr">{s}</span>
    </div>
  )
}
```

**3d.** Create `app/src/components/research-kit/CheckupRow.module.css`:

```css
.row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--glass-border-neutral);
}
.row:last-child {
  border-bottom: none;
}

.glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.pass .glyph { color: var(--gain); }
.fail .glyph { color: var(--loss); }

.label {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-bright);
  min-width: 0;
}

.value {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-bright);
  text-align: right;
}

.threshold {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-align: right;
}

/* Visually hidden, still announced — the outcome must not be icon-only for a
   screen reader. */
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* PHONE — the threshold wraps under the value rather than squeezing the label. */
@media (max-width: 640px) {
  .row {
    grid-template-columns: 16px minmax(0, 1fr) auto;
  }
  .threshold {
    grid-column: 2 / -1;
  }
}
```

**3e.** Extend `app/src/components/research-kit/index.js` — append:

```js
export {
  default as RatingCrown,
  SIZE as RATING_CROWN_SIZE,
  scoreTier,
  letterTier,
  ringGeometry,
  basisPill,
  COMPONENT_ORDER,
} from './RatingCrown'
export { default as CheckupRow, normalizeStatus } from './CheckupRow'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 18 test files pass, 0 failed.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/RatingCrown.jsx app/src/components/research-kit/RatingCrown.module.css app/src/components/research-kit/RatingCrown.test.jsx app/src/components/research-kit/CheckupRow.jsx app/src/components/research-kit/CheckupRow.module.css app/src/components/research-kit/CheckupRow.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: RatingCrown + CheckupRow

Spec 2026-08-03 §5.3. RatingCrown is THE ratings rendering -- composite ring
(hand-drawn SVG, --text-display centre number, .t-num) plus the seven component
chips in one fixed order. The page header badge is the SAME component with
variant="compact"; the old page's three different ratings renderings collapse
to this one.

scoreTier() reuses the thresholds RatingsTab already ships (>=80/60/40/20) --
the crown replaces that function, it does not recalibrate it -- and returns null
rather than 'poor' for a missing score, because absent is not bad. basisPill()
is data-driven so the percentile job lands with no redesign, and its wording is
the §5.3 plain-English copy with an cutover warning behind the (i).

Identity guard (§4.2): the crown stamps data-rk-identity="ring" and never
renders a VerdictChip -- the stock's rating is a ring, the event's Setup Grade
is a chip.

CheckupRow shows actual-vs-threshold with a UIcon check/x shape channel and
normalises the backend's pass|fail|neutral vocabulary (na aliased, unknown
neutralised, never throws).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: `HeatGrid` + `MetricTrendChart`

**Files:**
- Create: `app/src/components/research-kit/charts/HeatGrid.jsx`, `charts/HeatGrid.module.css`, `charts/MetricTrendChart.jsx`, `charts/MetricTrendChart.module.css`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/charts/HeatGrid.test.jsx`, `charts/MetricTrendChart.test.jsx` (create)

**Interfaces:**
- Consumes: `EmptyState`, `EyebrowLabel`; `EChart` + friends (Task 1); the financials grid rows (`{ period, revenue, eps, revenue_yoy, … }`, newest-first).
- Produces: `HeatGrid({ columns, rows, onRowChart, activeRowKey, caption, label, info, className })` + `heatTier()`, `HEAT_TIERS`, `DEFAULT_HEAT_STOPS`, `formatSigned()`; `MetricTrendChart({ periods, values, label, valueFormatter, height, className, ariaLabel })` + `SIZE`, `buildTrendOption()`.

**Design notes (read before writing code):**
- **It is a real `<table>`** (dataviz Part B: "Never a chart-library heatmap for this — DOM cells get hover/click/a11y free"). `<th scope="col">` per period, `<th scope="row">` per metric, a `<caption>`.
- **The Breadth rule, inherited verbatim (§3.3):** the cell background carries intensity, **the text stays uniform ink and the signed number is always visible**. Dark saturated = extreme, light tint = mild — never a colour-only cell, never a cell you have to hover to read.
- **`heatTier` is a pure function with caller-supplied stops.** The default ladder is `[50, 20, 0]` on a diverging percent metric. A flat 0 gets **no** tier — an untinted cell reading `0.0%` is the honest rendering of "nothing happened". The amber tier `--heat-a` exists in `HEAT_TIERS` for metrics with a genuine caution band; the default diverging ladder does not use it.
- **The row-click affordance is a real `<button>`** in the row header, not a click handler on `<tr>` (a clickable row is invisible to the keyboard). When `onRowChart` is absent the label renders as plain text — no fake affordance.
- **Phone = frozen first column** (`position: sticky; left: 0`), the "dense comparison grid where per-cell heat matters" branch of the house `ResponsiveTable` guidance. Card mode would destroy the regional-perception property that makes a heat grid worth building.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/research-kit/charts/HeatGrid.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HeatGrid, { heatTier, HEAT_TIERS, DEFAULT_HEAT_STOPS, formatSigned } from './HeatGrid'

const COLUMNS = ['Q2 26', 'Q1 26', 'Q4 25', 'Q3 25']
const ROWS = [
  { key: 'revenue_yoy', label: 'Revenue YoY', values: [62, 24, 8, -3], unit: '%' },
  { key: 'eps_yoy', label: 'EPS YoY', values: [-55, -21, 0, null], unit: '%' },
]

describe('heatTier', () => {
  it('ramps the green side on the default stops', () => {
    expect(heatTier(80)).toBe('g3')
    expect(heatTier(50)).toBe('g3')
    expect(heatTier(21)).toBe('g2')
    expect(heatTier(20)).toBe('g2')
    expect(heatTier(0.5)).toBe('g1')
  })

  it('mirrors the red side', () => {
    expect(heatTier(-80)).toBe('r3')
    expect(heatTier(-50)).toBe('r3')
    expect(heatTier(-21)).toBe('r2')
    expect(heatTier(-0.5)).toBe('r1')
  })

  it('gives a flat zero NO tier — an untinted cell is the honest rendering', () => {
    expect(heatTier(0)).toBeNull()
  })

  it('is null for anything unmeasured, never a tier', () => {
    expect(heatTier(null)).toBeNull()
    expect(heatTier(undefined)).toBeNull()
    expect(heatTier('x')).toBeNull()
    expect(heatTier(NaN)).toBeNull()
  })

  it('accepts caller stops for a metric on a different scale', () => {
    expect(heatTier(3, [5, 2, 0])).toBe('g2')
    expect(heatTier(6, [5, 2, 0])).toBe('g3')
  })

  it('exposes the full tier vocabulary including the caution band', () => {
    expect(HEAT_TIERS).toEqual(['g3', 'g2', 'g1', 'a', 'r1', 'r2', 'r3'])
    expect(DEFAULT_HEAT_STOPS).toEqual([50, 20, 0])
  })
})

describe('formatSigned', () => {
  it('always shows the sign on a positive number (§3.3 always-visible)', () => {
    expect(formatSigned(12.35, { unit: '%' })).toBe('+12.4%')
    expect(formatSigned(-3, { unit: '%' })).toBe('-3.0%')
    expect(formatSigned(0, { unit: '%' })).toBe('0.0%')
  })

  it('renders an em-dash for nothing, never "NaN" or a blank', () => {
    expect(formatSigned(null)).toBe('—')
    expect(formatSigned('x')).toBe('—')
  })

  it('honours a decimals override', () => {
    expect(formatSigned(12.345, { unit: '%', decimals: 2 })).toBe('+12.35%')
  })
})

describe('HeatGrid', () => {
  it('renders an EmptyState with no rows or no columns', () => {
    const { rerender } = render(<HeatGrid columns={COLUMNS} rows={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
    rerender(<HeatGrid columns={[]} rows={ROWS} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('is a real table with column and row headers', () => {
    render(<HeatGrid columns={COLUMNS} rows={ROWS} caption="Quarterly growth" />)
    expect(screen.getByRole('table', { name: 'Quarterly growth' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(COLUMNS.length + 1)
    expect(screen.getAllByRole('rowheader')).toHaveLength(ROWS.length)
  })

  it('tints each cell by tier and ALWAYS shows the signed number', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    const cells = container.querySelectorAll('[data-testid="rk-heat-cell"]')
    expect(cells[0].className).toMatch(/\bg3\b/)
    expect(cells[0]).toHaveTextContent('+62.0%')
    expect(cells[3].className).toMatch(/\br1\b/)
    expect(cells[3]).toHaveTextContent('-3.0%')
  })

  it('leaves an unmeasured cell untinted and shows an em-dash', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    const last = container.querySelectorAll('[data-testid="rk-heat-cell"]')[7]
    expect(last).toHaveTextContent('—')
    expect(last.className).not.toMatch(/\b(g1|g2|g3|r1|r2|r3|a)\b/)
  })

  it('keeps cell text in ONE ink — the tint is the only per-cell colour (§3.3)', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    const classes = [...container.querySelectorAll('[data-testid="rk-heat-value"]')].map((n) => n.className)
    expect(new Set(classes).size).toBe(1)
  })

  it('pads a short row rather than shifting the columns', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={[{ key: 'x', label: 'X', values: [1] }]} />)
    expect(container.querySelectorAll('[data-testid="rk-heat-cell"]')).toHaveLength(COLUMNS.length)
  })

  it('exposes a keyboard-reachable chart button per row when onRowChart is given', async () => {
    const onRowChart = vi.fn()
    render(<HeatGrid columns={COLUMNS} rows={ROWS} onRowChart={onRowChart} />)
    const btn = screen.getByRole('button', { name: /Revenue YoY/ })
    await userEvent.click(btn)
    expect(onRowChart).toHaveBeenCalledWith('revenue_yoy')
  })

  it('renders NO button when there is nothing to open (no fake affordance)', () => {
    render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('marks the open row for the caller', () => {
    render(<HeatGrid columns={COLUMNS} rows={ROWS} onRowChart={() => {}} activeRowKey="eps_yoy" />)
    expect(screen.getByRole('button', { name: /EPS YoY/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Revenue YoY/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries no inline styles — every tint is a token class', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    for (const cell of container.querySelectorAll('[data-testid="rk-heat-cell"]')) {
      expect(cell.getAttribute('style')).toBeNull()
    }
  })
})
```

Create `app/src/components/research-kit/charts/MetricTrendChart.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return <div data-testid="echart-inner" /> },
}))

import MetricTrendChart, { SIZE, buildTrendOption } from './MetricTrendChart'
import { CHART_INK } from './echartsCore'

const PERIODS = ['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26']
const VALUES = [-3, 8, 24, 62]

describe('buildTrendOption', () => {
  it('draws one bar per period, oldest first, coloured by sign', () => {
    const opt = buildTrendOption(PERIODS, VALUES, {})
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data.map((d) => d.value)).toEqual(VALUES)
    expect(opt.series[0].data[0].itemStyle.color).toBe(CHART_INK.loss)
    expect(opt.series[0].data[3].itemStyle.color).toBe(CHART_INK.gain)
    expect(opt.xAxis.data).toEqual(PERIODS)
  })

  it('direct-labels ONLY the last value (Part C rule 5)', () => {
    const opt = buildTrendOption(PERIODS, VALUES, {})
    expect(opt.series[0].data[3].label.show).toBe(true)
    expect(opt.series[0].data[0].label.show).toBe(false)
  })

  it('keeps a null period in place instead of shifting the axis', () => {
    const opt = buildTrendOption(PERIODS, [1, null, 3, 4], {})
    expect(opt.series[0].data[1].value).toBeNull()
    expect(opt.series[0].data).toHaveLength(4)
  })

  it('rules the zero baseline once', () => {
    expect(buildTrendOption(PERIODS, VALUES, {}).series[0].markLine.data).toEqual([{ yAxis: 0 }])
  })
})

describe('MetricTrendChart', () => {
  it('renders an EmptyState when no value is finite', () => {
    render(<MetricTrendChart periods={PERIODS} values={[null, null, null, null]} label="Revenue YoY" />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('mounts with the built option', () => {
    render(<MetricTrendChart periods={PERIODS} values={VALUES} label="Revenue YoY" />)
    expect(screen.getByTestId('echart-inner')).toBeInTheDocument()
    expect(captured.option.series[0].data).toHaveLength(4)
  })

  it('names the metric and its span in the aria-label', () => {
    render(<MetricTrendChart periods={PERIODS} values={VALUES} label="Revenue YoY" />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('Revenue YoY by period, Q3 25 to Q2 26. Latest +62.0%.')
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: 140 })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd app && npx vitest run src/components/research-kit/charts/HeatGrid.test.jsx src/components/research-kit/charts/MetricTrendChart.test.jsx
```

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/charts/HeatGrid.jsx`:

```jsx
// app/src/components/research-kit/charts/HeatGrid.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import styles from './HeatGrid.module.css'

/** The tokenised Breadth ladder (§3.1). 'a' is available for metrics with a
 *  genuine caution band; the default diverging ladder does not use it. */
export const HEAT_TIERS = ['g3', 'g2', 'g1', 'a', 'r1', 'r2', 'r3']

/** [extreme, strong, flat] on a diverging percent metric. */
export const DEFAULT_HEAT_STOPS = [50, 20, 0]

/**
 * Heat tier for one value. Pure.
 *
 * A flat 0 returns null ON PURPOSE: an untinted cell reading "0.0%" is the
 * honest rendering of "nothing happened", and tinting it would put a colour on
 * a non-event. Anything unmeasured is also null — never a tier.
 */
export function heatTier(value, stops = DEFAULT_HEAT_STOPS) {
  const n = Number(value)
  if (!Number.isFinite(n) || value === null || value === '' || value === undefined) return null
  const [extreme, strong] = stops
  if (n >= extreme) return 'g3'
  if (n >= strong) return 'g2'
  if (n > 0) return 'g1'
  if (n === 0) return null
  if (n <= -extreme) return 'r3'
  if (n <= -strong) return 'r2'
  return 'r1'
}

/** "+12.4%" — the sign is ALWAYS visible (§3.3). Em-dash for nothing. */
export function formatSigned(value, { unit = '', decimals = 1 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n) || value === null || value === '' || value === undefined) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(decimals)}${unit}`
}

/**
 * Heat-shaded metric grid (spec §5.3 Financials; dataviz pattern 24) — a real
 * `<table>`, because DOM cells give hover, click and a11y for free and a
 * chart-library heatmap gives none of them.
 *
 * THE BREADTH RULE, INHERITED (§3.3): the cell BACKGROUND carries intensity and
 * the TEXT stays uniform ink with the signed number always visible. Dark
 * saturated = extreme, light tint = mild. Never colour-only, never hover-to-read.
 *
 * `rows`: `[{ key, label, values: [], unit?, decimals?, stops? }]` — `values`
 * is positional against `columns` and short rows are PADDED, never shifted.
 * `onRowChart(key)` turns the row header into a real button (§5.3: click any
 * row → inline MetricTrendChart); without it the label is plain text, because a
 * clickable-looking row that does nothing is worse than a static one.
 */
export default function HeatGrid({
  columns,
  rows,
  onRowChart,
  activeRowKey = null,
  caption,
  label,
  info,
  className = '',
}) {
  const cols = Array.isArray(columns) ? columns : []
  const list = Array.isArray(rows) ? rows : []

  if (!cols.length || !list.length) {
    return (
      <EmptyState
        icon="document"
        title="No financial history"
        hint="This grid fills in once quarterly statements are available for this ticker."
        className={className}
      />
    )
  }

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className={styles.caption}>{caption || label || 'Financial grid'}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>Metric</th>
              {cols.map((c) => (
                <th scope="col" className={`${styles.colHead} t-num`} key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const values = Array.isArray(row.values) ? row.values : []
              return (
                <tr key={row.key}>
                  <th scope="row" className={styles.rowHead}>
                    {onRowChart ? (
                      <button
                        type="button"
                        className={styles.rowButton}
                        aria-expanded={activeRowKey === row.key}
                        onClick={() => onRowChart(row.key)}
                      >
                        {row.label}
                        <span className={styles.rowButtonHint} aria-hidden="true">›</span>
                      </button>
                    ) : row.label}
                  </th>
                  {cols.map((c, i) => {
                    const v = values[i]
                    const tier = heatTier(v, row.stops || DEFAULT_HEAT_STOPS)
                    return (
                      <td
                        key={c}
                        className={`${styles.cell} ${tier ? styles[tier] : ''}`}
                        data-testid="rk-heat-cell"
                        data-tier={tier || ''}
                      >
                        <span className={`${styles.value} t-num`} data-testid="rk-heat-value">
                          {formatSigned(v, { unit: row.unit ?? '', decimals: row.decimals ?? 1 })}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

**3b.** Create `app/src/components/research-kit/charts/HeatGrid.module.css`:

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

/* The dense-grid branch of the house responsive guidance: horizontal scroll
   with a frozen first column, NOT card mode — card mode destroys the regional
   perception that makes a heat grid worth building. */
.scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
}

.caption {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: left;
  padding-bottom: var(--space-xs);
}

.corner,
.rowHead {
  position: sticky;
  left: 0;
  z-index: 1;
  text-align: left;
  padding: var(--space-xs) var(--space-sm);
  background: var(--glass-chrome);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-bright);
  white-space: nowrap;
}

.colHead {
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: right;
  white-space: nowrap;
}

.rowButton {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: var(--tap-min);
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.rowButton:hover .rowButtonHint {
  color: var(--text-bright);
}
.rowButton:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.rowButtonHint {
  color: var(--text-muted);
}

.cell {
  padding: var(--space-xs) var(--space-sm);
  text-align: right;
  border: 1px solid var(--glass-border-neutral);
}

/* UNIFORM INK (§3.3): every cell's number wears the same colour. The tint below
   is the only per-cell colour, and the number is always readable on it. */
.value {
  font-size: var(--text-base);
  color: var(--text-bright);
}

.g3 { background: var(--heat-g3); }
.g2 { background: var(--heat-g2); }
.g1 { background: var(--heat-g1); }
.a  { background: var(--heat-a); }
.r1 { background: var(--heat-r1); }
.r2 { background: var(--heat-r2); }
.r3 { background: var(--heat-r3); }

/* PHONE */
@media (max-width: 640px) {
  .corner,
  .rowHead,
  .cell {
    padding: var(--space-xs);
  }
  .value {
    font-size: var(--text-sm);
  }
}
```

**3c.** Create `app/src/components/research-kit/charts/MetricTrendChart.jsx`:

```jsx
// app/src/components/research-kit/charts/MetricTrendChart.jsx
import EmptyState from '../EmptyState'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import { formatSigned } from './HeatGrid'
import styles from './MetricTrendChart.module.css'

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: 140 }

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * One metric across periods as signed bars. Pure.
 *
 * Only the LAST value is direct-labelled (Part C rule 5: kill the grid, label
 * the terminal value instead of forcing an axis read). A null period keeps its
 * slot so the axis never silently shifts.
 */
export function buildTrendOption(periods, values, { valueFormatter } = {}) {
  const p = periods || []
  const fmt = valueFormatter || ((v) => formatSigned(v, { unit: '%' }))
  const last = p.length - 1

  return {
    grid: { ...GRID_BASE, left: 30, top: 20, bottom: 22 },
    xAxis: { type: 'category', data: p, ...axisBase() },
    yAxis: {
      type: 'value',
      splitNumber: 2,
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'axis',
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0
        return `${p[i] ?? ''}<br/>${fmt(num((values || [])[i]))}`
      },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 22,
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: CHART_INK.muted, width: 1, opacity: 0.7 },
        data: [{ yAxis: 0 }],
      },
      data: p.map((_, i) => {
        const v = num((values || [])[i])
        return {
          value: v,
          itemStyle: { color: v == null ? CHART_INK.muted : v >= 0 ? CHART_INK.gain : CHART_INK.loss },
          label: {
            show: i === last && v != null,
            position: v != null && v < 0 ? 'bottom' : 'top',
            color: CHART_INK.bright,
            fontSize: 10,
            formatter: () => fmt(v),
          },
        }
      }),
    }],
  }
}

/**
 * The inline trend a HeatGrid row opens (spec §5.3: click any row → 8q/5y
 * trend). Deliberately chrome-light — it is a detail view inside a table, not a
 * hero.
 */
export default function MetricTrendChart({
  periods,
  values,
  label,
  valueFormatter,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const p = Array.isArray(periods) ? periods : []
  const v = Array.isArray(values) ? values : []
  const finite = v.map(num).filter((x) => x != null)

  if (!p.length || !finite.length) {
    return (
      <EmptyState
        compact
        icon="chart"
        title="No trend for this metric"
        hint="This metric has no reported values in the available periods."
        className={className}
      />
    )
  }

  const fmt = valueFormatter || ((x) => formatSigned(x, { unit: '%' }))
  const latest = num(v[v.length - 1])
  const built = ariaLabel
    || `${label || 'Metric'} by period, ${p[0]} to ${p[p.length - 1]}.${latest == null ? '' : ` Latest ${fmt(latest)}.`}`

  return (
    <div className={`${styles.wrap} ${className}`}>
      <EChart
        option={buildTrendOption(p, v, { valueFormatter })}
        height={height}
        ariaLabel={built}
        testId="rk-metric-trend"
      />
    </div>
  )
}
```

**3d.** Create `app/src/components/research-kit/charts/MetricTrendChart.module.css`:

```css
.wrap {
  min-width: 0;
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--glass-border-neutral);
}
```

**3e.** Extend `app/src/components/research-kit/index.js` — append:

```js
export {
  default as HeatGrid,
  heatTier,
  HEAT_TIERS,
  DEFAULT_HEAT_STOPS,
  formatSigned,
} from './charts/HeatGrid'
export {
  default as MetricTrendChart,
  SIZE as METRIC_TREND_SIZE,
  buildTrendOption,
} from './charts/MetricTrendChart'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 20 test files pass, 0 failed.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/charts/HeatGrid.jsx app/src/components/research-kit/charts/HeatGrid.module.css app/src/components/research-kit/charts/HeatGrid.test.jsx app/src/components/research-kit/charts/MetricTrendChart.jsx app/src/components/research-kit/charts/MetricTrendChart.module.css app/src/components/research-kit/charts/MetricTrendChart.test.jsx app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: HeatGrid + MetricTrendChart

Spec 2026-08-03 §3.3/§5.3, dataviz pattern 24. HeatGrid is a real <table> on
the tokenised --heat-* ladder -- DOM cells give hover, click and a11y for free
where a chart-library heatmap gives none. The Breadth rule is inherited
verbatim: background carries intensity, TEXT STAYS UNIFORM INK and the signed
number is always visible.

heatTier() is pure with caller-supplied stops and gives a flat 0 NO tier -- an
untinted cell reading 0.0% is the honest rendering of "nothing happened".
Unmeasured cells are untinted em-dashes and short rows are padded, never
shifted.

The row affordance is a real <button> in the row header (a click handler on <tr>
is invisible to the keyboard) emitting onRowChart(key); with no handler the
label stays plain text -- no fake affordance. MetricTrendChart is what that
click opens: signed bars, zero ruled once, only the terminal value labelled.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 7: Shell — `IdentityBanner` + `SectionRail` + `PinnedFooter`

**Files:**
- Create: `app/src/components/research-kit/shell/IdentityBanner.jsx(+.module.css)`, `shell/SectionRail.jsx(+.module.css)`, `shell/PinnedFooter.jsx(+.module.css)`
- Modify: `app/src/components/research-kit/index.js`
- Test: `app/src/components/research-kit/shell/IdentityBanner.test.jsx`, `shell/SectionRail.test.jsx`, `shell/PinnedFooter.test.jsx` (create)

**Interfaces:**
- Consumes: `EyebrowLabel`, `UIcon`; `--glass-chrome`, `--glass-border-accent`, `--focus-ring`, `--tap-min`.
- Produces:
  - `IdentityBanner({ logo, sym, company, sector, lifecycle, timingText, resultText, countdown, price, grade, guidance, className })` + `LIFECYCLE_STATES`, `normalizeLifecycle()`, `timingVariant()`.
  - `SectionRail({ sections, links, active, onSelect, idPrefix, ariaLabel, className })` + `nextIndex()`.
  - `PinnedFooter({ children, ariaLabel, className })`.

**Design notes (read before writing code):**
- **The shell is what enforces "the modal is the page in miniature" (§3.4).** Both surfaces mount these three; neither forks them.
- **PURE DISPLAY. No data fetching, no timers, no polling.** `lifecycle` is a prop the caller computes from data timestamps (§4.5: "states are pure functions of data timestamps"). The countdown is a **slot** — the banner never owns an interval. One test asserts `fetch` is never called.
- **§4.5 line variants, enforced structurally:** PRE renders the timing line + countdown; IMMINENT renders `Awaiting numbers…` and **suppresses both the timing line and the countdown** so no stale "Reports tonight" copy survives past T0; PRINTED/CALL_LIVE/POST render the result line. The guidance chip renders **only in POST** — the state in which a source-labelled recap exists (§4.2: it is never inferred).
- **One ticking element per banner (§3.1):** the countdown slot renders in exactly one state. There is nowhere else for a second ticker to appear.
- **Rail = real tablist**, `role="tablist"` + `role="tab"` + `aria-selected` + roving `tabIndex`, arrow keys with wrap plus Home/End. **Arrow handling covers BOTH axes** (Up/Down and Left/Right) because the same list is a vertical rail on desktop and a horizontal chip row on phone — and reading the viewport in JS at first paint is the known stale trap (`useMediaQuery` seeds at mount). CSS does the layout switch; the semantics never change.
- **Link items are NOT tabs** (§4.3: "Analyst & Ownership" and "Filings" deep-open the /research section). They live in a sibling group as anchors, so a screen-reader user is never told "tab 6 of 7" about something that navigates away.

- [ ] **Step 1: Write the failing tests**

Create `app/src/components/research-kit/shell/IdentityBanner.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import IdentityBanner, { LIFECYCLE_STATES, normalizeLifecycle, timingVariant } from './IdentityBanner'

const base = {
  sym: 'NVDA',
  company: 'NVIDIA Corporation',
  sector: 'Technology',
  timingText: 'Reports tonight AMC · confirmed · call 5:00 PM ET',
  resultText: 'Beat $0.98 vs $0.94 · +4.2% AH',
  countdown: <span data-testid="countdown">4h 12m</span>,
  price: <span data-testid="price">$182.40</span>,
  grade: <span data-testid="grade">B+</span>,
  guidance: <span data-testid="guidance">RAISED · from the call recap</span>,
}

describe('lifecycle helpers (§4.5)', () => {
  it('publishes the five states', () => {
    expect(LIFECYCLE_STATES).toEqual(['PRE', 'IMMINENT', 'PRINTED', 'CALL_LIVE', 'POST'])
  })

  it('normalises case and falls back to PRE on anything unknown', () => {
    expect(normalizeLifecycle('post')).toBe('POST')
    expect(normalizeLifecycle('nonsense')).toBe('PRE')
    expect(normalizeLifecycle(null)).toBe('PRE')
  })

  it('maps each state to its line variant', () => {
    expect(timingVariant('PRE')).toBe('countdown')
    expect(timingVariant('IMMINENT')).toBe('awaiting')
    expect(timingVariant('PRINTED')).toBe('result')
    expect(timingVariant('CALL_LIVE')).toBe('result')
    expect(timingVariant('POST')).toBe('result')
  })
})

describe('IdentityBanner', () => {
  beforeEach(() => { global.fetch = vi.fn() })

  it('renders the identity block', () => {
    render(<IdentityBanner {...base} />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('NVIDIA Corporation')).toBeInTheDocument()
    expect(screen.getByText('Technology')).toBeInTheDocument()
  })

  it('PRE: timing line plus the countdown slot', () => {
    render(<IdentityBanner {...base} lifecycle="PRE" />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Reports tonight AMC')
    expect(screen.getByTestId('countdown')).toBeInTheDocument()
  })

  it('IMMINENT: no stale "Reports tonight" copy and no countdown survive past T0 (§4.5.2)', () => {
    render(<IdentityBanner {...base} lifecycle="IMMINENT" />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Awaiting numbers…')
    expect(screen.queryByText(/Reports tonight/)).toBeNull()
    expect(screen.queryByTestId('countdown')).toBeNull()
  })

  it('PRINTED: the line flips to the result — pure data (§4.2)', () => {
    render(<IdentityBanner {...base} lifecycle="PRINTED" />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Beat $0.98 vs $0.94 · +4.2% AH')
    expect(screen.queryByTestId('countdown')).toBeNull()
  })

  it('PRINTED with no result yet says "Reported", never an empty line', () => {
    render(<IdentityBanner {...base} lifecycle="PRINTED" resultText={null} />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Reported')
  })

  it('renders the guidance chip ONLY in POST (it is never inferred, §4.2)', () => {
    const { rerender } = render(<IdentityBanner {...base} lifecycle="PRINTED" />)
    expect(screen.queryByTestId('guidance')).toBeNull()
    rerender(<IdentityBanner {...base} lifecycle="POST" />)
    expect(screen.getByTestId('guidance')).toBeInTheDocument()
  })

  it('renders the price and grade slots in every state', () => {
    for (const state of LIFECYCLE_STATES) {
      const { unmount } = render(<IdentityBanner {...base} lifecycle={state} />)
      expect(screen.getByTestId('price')).toBeInTheDocument()
      expect(screen.getByTestId('grade')).toBeInTheDocument()
      unmount()
    }
  })

  it('has exactly ONE ticking element across the whole state machine (§3.1)', () => {
    const ticking = LIFECYCLE_STATES.filter((state) => {
      const { container, unmount } = render(<IdentityBanner {...base} lifecycle={state} />)
      const has = !!container.querySelector('[data-testid="countdown"]')
      unmount()
      return has
    })
    expect(ticking).toEqual(['PRE'])
  })

  it('fetches nothing — it is a display component (§4.5)', () => {
    render(<IdentityBanner {...base} lifecycle="POST" />)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('is a banner landmark on near-opaque chrome', () => {
    const { container } = render(<IdentityBanner {...base} />)
    expect(container.firstChild.tagName).toBe('HEADER')
    expect(container.firstChild.className).toMatch(/banner/)
  })
})
```

Create `app/src/components/research-kit/shell/SectionRail.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SectionRail, { nextIndex } from './SectionRail'

const SECTIONS = [
  { id: 'setup', label: 'Setup' },
  { id: 'history', label: 'Earnings History' },
  { id: 'brief', label: 'Brief' },
  { id: 'call', label: 'Call' },
]
const LINKS = [
  { id: 'analyst', label: 'Analyst & Ownership', href: '/research/NVDA?section=ownership' },
  { id: 'filings', label: 'Filings', href: '/research/NVDA?section=filings' },
]

describe('nextIndex — one handler for both axes', () => {
  it('moves forward on Down AND Right, wrapping', () => {
    expect(nextIndex(0, 'ArrowDown', 4)).toBe(1)
    expect(nextIndex(0, 'ArrowRight', 4)).toBe(1)
    expect(nextIndex(3, 'ArrowDown', 4)).toBe(0)
  })

  it('moves backward on Up AND Left, wrapping', () => {
    expect(nextIndex(1, 'ArrowUp', 4)).toBe(0)
    expect(nextIndex(0, 'ArrowLeft', 4)).toBe(3)
  })

  it('jumps to the ends on Home/End', () => {
    expect(nextIndex(2, 'Home', 4)).toBe(0)
    expect(nextIndex(2, 'End', 4)).toBe(3)
  })

  it('returns -1 for a key it does not own', () => {
    expect(nextIndex(0, 'a', 4)).toBe(-1)
    expect(nextIndex(0, 'Enter', 4)).toBe(-1)
  })

  it('never returns an index into an empty list', () => {
    expect(nextIndex(0, 'ArrowDown', 0)).toBe(-1)
  })
})

describe('SectionRail', () => {
  const setup = (over = {}) => {
    const onSelect = vi.fn()
    const utils = render(
      <SectionRail sections={SECTIONS} links={LINKS} active="setup" onSelect={onSelect} {...over} />,
    )
    return { onSelect, ...utils }
  }

  it('is a tablist of the sections only', () => {
    setup()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(SECTIONS.length)
  })

  it('marks the active tab and gives it the only reachable tabindex (roving)', () => {
    setup()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  it('points each tab at its panel', () => {
    setup({ idPrefix: 'modal' })
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-controls', 'modal-panel-setup')
  })

  it('selects on click', async () => {
    const { onSelect } = setup()
    await userEvent.click(screen.getByRole('tab', { name: 'Brief' }))
    expect(onSelect).toHaveBeenCalledWith('brief')
  })

  it('selects on arrow keys, wrapping, and moves focus with the selection', async () => {
    const { onSelect } = setup({ active: 'call' })
    screen.getByRole('tab', { name: 'Call' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onSelect).toHaveBeenCalledWith('setup')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Setup' }))
  })

  it('honours Home and End', async () => {
    const { onSelect } = setup({ active: 'brief' })
    screen.getByRole('tab', { name: 'Brief' }).focus()
    await userEvent.keyboard('{End}')
    expect(onSelect).toHaveBeenCalledWith('call')
    await userEvent.keyboard('{Home}')
    expect(onSelect).toHaveBeenCalledWith('setup')
  })

  it('ignores keys it does not own', async () => {
    const { onSelect } = setup()
    screen.getByRole('tab', { name: 'Setup' }).focus()
    await userEvent.keyboard('x')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders link items as links, NOT as tabs (§4.3)', () => {
    setup()
    const link = screen.getByRole('link', { name: /Analyst & Ownership/ })
    expect(link).toHaveAttribute('href', '/research/NVDA?section=ownership')
    expect(screen.queryByRole('tab', { name: /Analyst & Ownership/ })).toBeNull()
  })

  it('renders no link group when there are no links', () => {
    setup({ links: [] })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('is a labelled navigation region', () => {
    setup({ ariaLabel: 'Modal sections' })
    expect(screen.getByRole('tablist', { name: 'Modal sections' })).toBeInTheDocument()
  })
})
```

Create `app/src/components/research-kit/shell/PinnedFooter.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PinnedFooter from './PinnedFooter'

describe('PinnedFooter', () => {
  it('renders its actions in a labelled footer', () => {
    render(
      <PinnedFooter ariaLabel="Report actions">
        <button type="button">View Chart</button>
        <button type="button">Open full report →</button>
      </PinnedFooter>,
    )
    expect(screen.getByRole('contentinfo', { name: 'Report actions' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders nothing when it has no actions — an empty pinned bar is chrome for chrome', () => {
    const { container } = render(<PinnedFooter />)
    expect(container.firstChild).toBeNull()
  })

  it('forwards className and carries no inline styles', () => {
    const { container } = render(<PinnedFooter className="extra"><button type="button">x</button></PinnedFooter>)
    expect(container.firstChild.className).toMatch(/extra/)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd app && npx vitest run src/components/research-kit/shell/
```

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/shell/IdentityBanner.jsx`:

```jsx
// app/src/components/research-kit/shell/IdentityBanner.jsx
import styles from './IdentityBanner.module.css'

/** The §4.5 report-night state machine, in order. */
export const LIFECYCLE_STATES = ['PRE', 'IMMINENT', 'PRINTED', 'CALL_LIVE', 'POST']

const VARIANT = {
  PRE: 'countdown',
  IMMINENT: 'awaiting',
  PRINTED: 'result',
  CALL_LIVE: 'result',
  POST: 'result',
}

/** Unknown input falls back to PRE — the least-claiming state. */
export function normalizeLifecycle(state) {
  const s = typeof state === 'string' ? state.trim().toUpperCase() : ''
  return LIFECYCLE_STATES.includes(s) ? s : 'PRE'
}

/** 'countdown' | 'awaiting' | 'result' — which line the banner shows. */
export function timingVariant(state) {
  return VARIANT[normalizeLifecycle(state)]
}

/**
 * The pinned identity banner (spec §4.2) — shared by the modal and the research
 * page header so "the modal is the page in miniature" is structural.
 *
 * PURE DISPLAY. It fetches nothing, polls nothing and owns no timer. `lifecycle`
 * is computed by the caller from data timestamps (§4.5: "states are pure
 * functions of data timestamps — no scheduled UI timers beyond the polling
 * cadence"), and `countdown` / `price` / `grade` / `guidance` are SLOTS.
 *
 * §4.5 line variants, enforced structurally:
 *   PRE       → timing line + the countdown slot
 *   IMMINENT  → "Awaiting numbers…", and the timing line AND countdown are
 *               suppressed, so no stale "Reports tonight" copy survives past T0
 *   PRINTED / CALL_LIVE / POST → the result line, pure data
 *
 * The guidance chip renders ONLY in POST — the state in which a source-labelled
 * recap exists. It is never inferred (§4.2).
 *
 * ONE TICKING ELEMENT (§3.1): the countdown slot renders in exactly one state.
 * Prices update without animation — do not add a transition to the price slot.
 */
export default function IdentityBanner({
  logo,
  sym,
  company,
  sector,
  lifecycle = 'PRE',
  timingText,
  resultText,
  countdown,
  price,
  grade,
  guidance,
  className = '',
}) {
  const state = normalizeLifecycle(lifecycle)
  const variant = timingVariant(state)

  const line = variant === 'awaiting'
    ? 'Awaiting numbers…'
    : variant === 'result'
      ? (resultText || 'Reported')
      : timingText

  return (
    <header className={`${styles.banner} ${className}`} data-lifecycle={state}>
      {logo && <div className={styles.logo}>{logo}</div>}

      <div className={styles.identity}>
        <div className={styles.symRow}>
          <span className={styles.sym}>{sym}</span>
          {company && <span className={styles.company}>{company}</span>}
        </div>
        {sector && <div className={styles.sector}>{sector}</div>}
      </div>

      <div className={styles.timing}>
        {line && (
          <span
            className={`${styles.line} ${variant === 'result' ? styles.lineResult : ''}`}
            data-testid="rk-banner-line"
          >
            {line}
          </span>
        )}
        {variant === 'countdown' && countdown && (
          <span className={`${styles.countdown} t-num`}>{countdown}</span>
        )}
        {state === 'POST' && guidance && <span className={styles.guidance}>{guidance}</span>}
      </div>

      <div className={styles.right}>
        {price && <span className={`${styles.price} t-num`}>{price}</span>}
        {grade && <span className={styles.grade}>{grade}</span>}
      </div>
    </header>
  )
}
```

**3b.** Create `app/src/components/research-kit/shell/IdentityBanner.module.css`:

```css
/* --glass-chrome (>= .92 alpha): pinned text must never sit on translucency
   (§3.1/§3.2). --glass-border-accent is permitted HERE — the banner is one of
   the three sanctioned gold surfaces. */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-width: 0;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--glass-border-accent);
  background: var(--glass-chrome);
}

.logo {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.symRow {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  min-width: 0;
}

.sym {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--ut-gold);
}

.company {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sector {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--text-muted);
}

.timing {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.line {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-muted);
}

.lineResult {
  color: var(--text-bright);
  font-weight: 600;
}

.countdown {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-bright);
}

.guidance {
  display: inline-flex;
}

.right {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-left: auto;
}

/* No transition here on purpose: prices update WITHOUT animation (§3.1). */
.price {
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-heading);
}

.grade {
  display: inline-flex;
}

/* PHONE — identity + line stack, actions wrap to their own row. */
@media (max-width: 640px) {
  .banner {
    flex-wrap: wrap;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
  }
  .company {
    display: none;
  }
  .timing {
    flex-basis: 100%;
    order: 3;
  }
  .right {
    gap: var(--space-sm);
  }
}

/* TABLET */
@media (min-width: 641px) and (max-width: 1024px) {
  .banner {
    padding: var(--space-sm) var(--space-md);
  }
}
```

**3c.** Create `app/src/components/research-kit/shell/SectionRail.jsx`:

```jsx
// app/src/components/research-kit/shell/SectionRail.jsx
import { useRef } from 'react'
import UIcon from '../../ui/UIcon'
import styles from './SectionRail.module.css'

/**
 * Roving-tabindex target for a key press, or -1 when the key is not ours.
 *
 * Handles BOTH axes deliberately: the same list is a vertical rail on desktop
 * and a horizontal chip row on phone, and reading the viewport in JS at first
 * paint is the known stale trap (useMediaQuery seeds at mount). CSS switches the
 * layout; the semantics and the key handling never change.
 */
export function nextIndex(current, key, count) {
  if (!count || count <= 0) return -1
  const i = Number.isInteger(current) && current >= 0 ? current : 0
  if (key === 'ArrowDown' || key === 'ArrowRight') return (i + 1) % count
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (i - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return -1
}

/**
 * The section rail (spec §4.1/§5.1) — the shared navigator for the modal's left
 * pane and the research page.
 *
 * `sections` are TABS (they swap the canvas beside them). `links` are LINKS:
 * §4.3's "Analyst & Ownership" and "Filings" deep-open the /research section, so
 * they live in a sibling group and are never announced as "tab 6 of 7" for
 * something that navigates away.
 *
 * Tablist semantics with roving tabindex: exactly one tab is in the tab order,
 * arrows move selection AND focus, Home/End jump to the ends.
 */
export default function SectionRail({
  sections,
  links,
  active,
  onSelect,
  idPrefix = 'rk-rail',
  ariaLabel = 'Sections',
  className = '',
}) {
  const list = Array.isArray(sections) ? sections : []
  const linkList = Array.isArray(links) ? links : []
  const refs = useRef([])

  const activeIdx = Math.max(0, list.findIndex((s) => s.id === active))

  const onKeyDown = (e) => {
    const target = nextIndex(activeIdx, e.key, list.length)
    if (target < 0) return
    e.preventDefault()
    const nextId = list[target]?.id
    if (nextId && onSelect) onSelect(nextId)
    refs.current[target]?.focus()
  }

  return (
    <nav className={`${styles.rail} ${className}`}>
      <div className={styles.tabs} role="tablist" aria-label={ariaLabel} aria-orientation="vertical">
        {list.map((s, i) => {
          const isActive = s.id === active
          return (
            <button
              key={s.id}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${s.id}`}
              aria-controls={`${idPrefix}-panel-${s.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              onClick={() => onSelect && onSelect(s.id)}
              onKeyDown={onKeyDown}
            >
              {s.icon && <UIcon name={s.icon} size={14} gold={false} className={styles.icon} />}
              <span className={styles.itemLabel}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {linkList.length > 0 && (
        <div className={styles.links}>
          {linkList.map((l) => (
            <a key={l.id} className={`${styles.item} ${styles.linkItem}`} href={l.href}>
              {l.icon && <UIcon name={l.icon} size={14} gold={false} className={styles.icon} />}
              <span className={styles.itemLabel}>{l.label}</span>
              <UIcon name="chevronRight" size={12} gold={false} className={styles.linkChevron} />
            </a>
          ))}
        </div>
      )}
    </nav>
  )
}
```

**3d.** Create `app/src/components/research-kit/shell/SectionRail.module.css`:

```css
.rail {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 0;
  padding: var(--space-md);
  background: var(--glass-chrome);
}

.tabs,
.links {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.links {
  padding-top: var(--space-sm);
  border-top: 1px solid var(--glass-border-neutral);
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: var(--tap-min);
  min-width: 0;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-muted);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.item:hover {
  color: var(--text-bright);
}
.item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* The active rail item is one of the three sanctioned gold surfaces (§3.1). */
.itemActive {
  border-color: var(--glass-border-accent);
  background: var(--glass-elevated);
  color: var(--text-heading);
  font-weight: 600;
}

.itemLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linkChevron {
  margin-left: auto;
}

.icon {
  flex: 0 0 auto;
}

/* PHONE — the same list becomes a horizontal chip row with an edge fade. The
   SEMANTICS do not change; only the layout does. */
@media (max-width: 640px) {
  .rail {
    flex-direction: row;
    gap: var(--space-sm);
    padding: var(--space-sm);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  }
  .tabs,
  .links {
    flex-direction: row;
  }
  .links {
    padding-top: 0;
    padding-left: var(--space-sm);
    border-top: none;
    border-left: 1px solid var(--glass-border-neutral);
  }
  .item {
    white-space: nowrap;
  }
}

/* TABLET — narrower rail, per §4.4. */
@media (min-width: 641px) and (max-width: 1024px) {
  .rail {
    padding: var(--space-sm);
  }
  .item {
    font-size: var(--text-sm);
  }
}
```

**3e.** Create `app/src/components/research-kit/shell/PinnedFooter.jsx`:

```jsx
// app/src/components/research-kit/shell/PinnedFooter.jsx
import { Children } from 'react'
import styles from './PinnedFooter.module.css'

/**
 * The pinned action row (spec §4.4 footer: View Chart · Open full report → ·
 * flag-to-watchlist). Pure layout on --glass-chrome; the actions themselves are
 * the caller's, so the modal and the page can pin different verbs into the same
 * chrome.
 *
 * Renders NOTHING when it has no actions — an empty pinned bar is chrome for
 * chrome's sake, and it would still eat vertical space on a phone.
 */
export default function PinnedFooter({ children, ariaLabel = 'Actions', className = '' }) {
  const items = Children.toArray(children).filter(Boolean)
  if (!items.length) return null

  return (
    <footer className={`${styles.footer} ${className}`} aria-label={ariaLabel}>
      {items}
    </footer>
  )
}
```

**3f.** Create `app/src/components/research-kit/shell/PinnedFooter.module.css`:

```css
.footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  padding: var(--space-sm) var(--space-lg);
  border-top: 1px solid var(--glass-border-neutral);
  background: var(--glass-chrome);
}

/* Every direct interactive child clears the 44px tap floor on touch, without
   the caller having to remember. */
.footer > button,
.footer > a {
  min-height: var(--tap-min);
}

/* PHONE — respect the home indicator, keep actions reachable one-handed. */
@media (max-width: 640px) {
  .footer {
    flex-wrap: wrap;
    padding: var(--space-sm) var(--space-md);
    padding-bottom: calc(var(--space-sm) + env(safe-area-inset-bottom, 0px));
  }
}
```

**3g.** Extend `app/src/components/research-kit/index.js` — append:

```js
// Shell (P1F-B) — the three pinned pieces that make the modal the page in
// miniature (§3.4). All PURE DISPLAY: no fetching, no timers.
export {
  default as IdentityBanner,
  LIFECYCLE_STATES,
  normalizeLifecycle,
  timingVariant,
} from './shell/IdentityBanner'
export { default as SectionRail, nextIndex } from './shell/SectionRail'
export { default as PinnedFooter } from './shell/PinnedFooter'
```

- [ ] **Step 4: Run tests to verify pass**

```
cd app && npx vitest run src/components/research-kit/
```
Expected: 23 test files pass, 0 failed.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/shell/ app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: shell -- IdentityBanner, SectionRail, PinnedFooter

Spec 2026-08-03 §3.4/§4.1/§4.2/§4.5/§5.1. The three pinned pieces both surfaces
share, all on --glass-chrome so pinned text never sits on translucency.

IdentityBanner is PURE DISPLAY: no fetch, no poll, no timer (a test asserts
fetch is never called). `lifecycle` drives the §4.5 line variants structurally --
IMMINENT suppresses BOTH the timing line and the countdown so no stale "Reports
tonight" copy survives past T0, and the guidance chip renders only in POST
because it is never inferred. One ticking element per banner is enforced by the
countdown slot rendering in exactly one state; a test walks all five.

SectionRail is a real tablist with roving tabindex; arrows move selection AND
focus and cover BOTH axes deliberately -- the same list is a vertical rail on
desktop and a horizontal chip row on phone, and reading the viewport in JS at
first paint is the known stale trap. Link items are LINKS, not tabs, so nothing
that navigates away is announced as "tab 6 of 7".

PinnedFooter renders null with no actions -- an empty pinned bar is chrome for
chrome's sake.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 8: Punch-list sweep (from the P1F-A reviews) + final gates

**Files:**
- Create: `app/src/components/research-kit/testing/restraint.js`, `testing/restraint.test.jsx`
- Modify: `app/src/components/research-kit/StatTile.jsx`, `VerdictChip.jsx`, `RangeSlider.jsx` (export `TONE_CLASS`)
- Modify: `app/src/components/research-kit/toneClasses.test.js` (live import instead of a hand-copied list)
- Modify: `app/src/components/research-kit/InfoTip.jsx` (export `normalizeInfo`), `InfoTip.module.css` (tap-target expander), `InfoTip.test.jsx` (two cases + the jsdom note)
- Modify: `app/src/components/research-kit/EyebrowLabel.jsx`, `VerdictChip.jsx` (consume `normalizeInfo`)
- Modify: `app/src/components/research-kit/ConsensusBar.jsx` (respect `compact` in the empty branch), `ConsensusBar.test.jsx` (one case)
- Modify: `app/src/styles/tokens.test.js` (`--text-bright` joins the contrast matrix)
- Modify: `app/src/components/research-kit/index.js`

**The six items, and why each one is real:**

1. **Restraint-enforcement helper.** §3.1's "max one gold data-highlight per canvas" is currently prose. This ships a **test helper** (never runtime) so composition tests in P2/P3 can assert it mechanically. It must FAIL on a two-accent fixture — a helper that can only pass is not a check (`lesson_gate_that_cannot_fail`).
2. **Tone-guard on a live import.** `toneClasses.test.js` hand-copies each component's tone-class list, so adding a tone to `TONE_CLASS` without adding its CSS rule passes. Exporting `TONE_CLASS` and iterating `Object.values()` closes that hole.
3. **InfoTip tap target without the row jump.** The phone rule grows the trigger to 44×44, and the ⓘ is *inline inside a label row* — so every eyebrow row on a phone gets 28px taller. Replaced with an invisible `::after` expander: the tap area is 44px, the layout box stays 16px.
4. **Info-normaliser deduped.** `EyebrowLabel` and `VerdictChip` each carry `typeof info === 'string' ? { text: info } : info || null`. One copy in `InfoTip`, imported by both — a comment (or an expression) repeated at N call sites is one defect, not N.
5. **`--text-bright` joins the contrast matrix.** It is the shell's heading ink and now sits on `--glass-elevated` (rail active item) and `--glass-chrome` (banner/rail/footer). The matrix covered `--text` and `--text-muted` only.
6. **`ConsensusBar` honours `compact` in its empty branch.** It hardcodes `compact` on the EmptyState, so a full-size bar collapses to a compact empty state — a visible size jump exactly when data is missing.

- [ ] **Step 1: Write the failing tests**

Create `app/src/components/research-kit/testing/restraint.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GlassCard from '../GlassCard'
import { countAccentSurfaces, expectOneAccentPerCanvas } from './restraint'

describe('restraint helper (§3.1)', () => {
  it('counts zero when nothing is accented', () => {
    const { container } = render(<div><GlassCard>a</GlassCard><GlassCard>b</GlassCard></div>)
    expect(countAccentSurfaces(container)).toBe(0)
  })

  it('passes the ONE hero per canvas', () => {
    const { container } = render(<div><GlassCard accent>hero</GlassCard><GlassCard>support</GlassCard></div>)
    expect(countAccentSurfaces(container)).toBe(1)
    expect(() => expectOneAccentPerCanvas(container)).not.toThrow()
  })

  // The control case: a helper that cannot fail is not a check.
  it('FAILS on two accented surfaces in one canvas', () => {
    const { container } = render(<div><GlassCard accent>a</GlassCard><GlassCard accent>b</GlassCard></div>)
    expect(countAccentSurfaces(container)).toBe(2)
    expect(() => expectOneAccentPerCanvas(container)).toThrow(/Restraint violation/)
  })

  it('does not match a class that merely starts with "accent"', () => {
    const { container } = render(<div className="accentuate"><span className="accented" /></div>)
    expect(countAccentSurfaces(container)).toBe(0)
  })

  it('counts the passed element itself when IT is the accented surface', () => {
    const { container } = render(<GlassCard accent>solo</GlassCard>)
    expect(countAccentSurfaces(container.firstChild)).toBe(1)   // the card itself
    expect(countAccentSurfaces(container)).toBe(1)              // its wrapper
  })
})
```

Replace the three hardcoded `it.each` lists in `app/src/components/research-kit/toneClasses.test.js` with live imports. The header comment stays; the describe blocks become:

```js
import { TONE_CLASS as STAT_TILE_TONES } from './StatTile'
import { TONE_CLASS as VERDICT_CHIP_TONES } from './VerdictChip'
import { TONE_CLASS as RANGE_SLIDER_TONES } from './RangeSlider'

// … read()/hasSelector()/STAT_TILE/VERDICT_CHIP/RANGE_SLIDER unchanged …

describe.each([
  ['StatTile', STAT_TILE_TONES, STAT_TILE],
  ['VerdictChip', VERDICT_CHIP_TONES, VERDICT_CHIP],
  ['RangeSlider', RANGE_SLIDER_TONES, RANGE_SLIDER],
])('%s.module.css — every TONE_CLASS value is a real selector (M1 drift-guard)', (name, map, css) => {
  it('exports a non-empty TONE_CLASS map', () => {
    expect(Object.keys(map).length).toBeGreaterThan(0)
  })

  it.each(Object.values(map))('.%s is a real selector', (cls) => {
    expect(hasSelector(css, cls)).toBe(true)
  })
})
```

Append to `app/src/components/research-kit/InfoTip.test.jsx`:

```jsx
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeInfo } from './InfoTip'

describe('normalizeInfo — one copy of the shape rule (§3.4)', () => {
  it('lifts a bare string into { text }', () => {
    expect(normalizeInfo('what is this')).toEqual({ text: 'what is this' })
  })

  it('passes an object through untouched', () => {
    const o = { text: 'x', href: '/methodology', hrefLabel: 'How →' }
    expect(normalizeInfo(o)).toBe(o)
  })

  it('is null for anything without text', () => {
    expect(normalizeInfo('')).toBeNull()
    expect(normalizeInfo(null)).toBeNull()
    expect(normalizeInfo(undefined)).toBeNull()
    expect(normalizeInfo({})).toBeNull()
    expect(normalizeInfo({ href: '/x' })).toBeNull()
  })
})

// The 44px tap floor cannot be asserted by measurement here: jsdom does no
// layout, so clientWidth/getBoundingClientRect() are 0 for every element and a
// size assertion would pass whatever the CSS says. The contract is therefore
// checked against the stylesheet SOURCE — the same technique as
// toneClasses.test.js and styles/tokens.test.js.
describe('InfoTip.module.css — touch tap target without a row jump', () => {
  const CSS = readFileSync(fileURLToPath(new URL('./InfoTip.module.css', import.meta.url)), 'utf8')
  const touchBlock = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''

  it('meets the tap floor with an invisible expander, not by growing the button', () => {
    expect(touchBlock).toMatch(/\.trigger::after/)
    expect(touchBlock).toMatch(/width:\s*var\(--tap-min\)/)
    expect(touchBlock).toMatch(/height:\s*var\(--tap-min\)/)
  })

  it('never sizes the trigger BOX to --tap-min (that is what jumped the row)', () => {
    const triggerRule = /\.trigger\s*\{([^}]*)\}/g
    for (const m of CSS.matchAll(triggerRule)) {
      expect(m[1]).not.toMatch(/(width|height):\s*var\(--tap-min\)/)
    }
  })

  it('positions the trigger so the expander can centre on it', () => {
    expect(/\.trigger\s*\{[^}]*position:\s*relative/.test(CSS)).toBe(true)
  })
})
```

Append to `app/src/components/research-kit/ConsensusBar.test.jsx`:

```jsx
  it('respects the compact prop in the EMPTY branch too', () => {
    const { container, rerender } = render(<ConsensusBar buy={0} hold={0} sell={0} />)
    expect(container.firstChild.className).not.toMatch(/compact/)
    rerender(<ConsensusBar buy={0} hold={0} sell={0} compact />)
    expect(container.firstChild.className).toMatch(/compact/)
  })
```

In `app/src/styles/tokens.test.js`, extend the ink list of the computed contrast matrix:

```js
  // C1 (extended, P1F-B): --text-bright is the shell's heading ink and now sits
  // on --glass-elevated (the active rail item) and --glass-chrome (banner, rail,
  // footer), so it belongs in the matrix beside the body and dimmest inks.
  const INKS = ['--text-muted', '--text', '--text-bright']
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd app && npx vitest run src/components/research-kit/ src/styles/tokens.test.js
```
Expected failures: `testing/restraint.test.jsx` (module missing), `toneClasses.test.js` (no `TONE_CLASS` export), the new `InfoTip` cases (no `normalizeInfo`, no `::after` rule), the `ConsensusBar` compact case. `tokens.test.js` should already PASS with `--text-bright` added — record that it does; if it fails, the alpha values need revisiting, not the assertion.

- [ ] **Step 3: Implement**

**3a.** Create `app/src/components/research-kit/testing/restraint.js`:

```js
// app/src/components/research-kit/testing/restraint.js
//
// TEST HELPER — never import this from runtime code.
//
// §3.1's restraint rules are normative but were only prose: "gold borders
// appear only on the banner, the ONE hero widget per canvas, and the active
// rail item; maximum one gold data-highlight per canvas". This turns the
// per-canvas half into something a composition test can assert, so decoration
// creep fails a test instead of shipping.
//
// HOW IT WORKS: vitest runs with `css: false`, so a CSS-module import resolves
// each key to the KEY STRING — GlassCard's accent surface literally carries
// class="card accent" in a test DOM. That is the same property toneClasses.test.js
// relies on. It does NOT hold in a browser build, which is exactly why this is a
// test helper and not a runtime guard.

export const ACCENT_CLASS = 'accent'

const hasAccent = (el) =>
  String(el.getAttribute?.('class') || '').split(/\s+/).includes(ACCENT_CLASS)

/** How many accented surfaces are inside (or are) `container`. */
export function countAccentSurfaces(container) {
  if (!container) return 0
  let n = hasAccent(container) ? 1 : 0
  for (const el of container.querySelectorAll?.('[class]') ?? []) {
    if (hasAccent(el)) n += 1
  }
  return n
}

/**
 * Throws when a rendered canvas carries more than one accented surface.
 *
 * If you are about to accent a second card in the same canvas, one of them is
 * not the hero (§3.1).
 */
export function expectOneAccentPerCanvas(container) {
  const n = countAccentSurfaces(container)
  if (n > 1) {
    throw new Error(
      `Restraint violation (spec §3.1): ${n} accent surfaces in one canvas; at most 1 is permitted (the hero).`,
    )
  }
  return n
}
```

**3b.** In `StatTile.jsx`, `VerdictChip.jsx` and `RangeSlider.jsx`, change the existing module-level `const TONE_CLASS = {…}` to `export const TONE_CLASS = {…}`. **Do not change the maps' contents** — this is an export-only edit, so every existing render test keeps passing.

**3c.** In `InfoTip.jsx`, add the exported normaliser above the component:

```jsx
/**
 * The kit's ONE info-prop shape rule: components accept either a bare string or
 * `{ text, href, hrefLabel }`, and anything without text means "no tip".
 *
 * Lives here rather than being re-expressed in every consumer — an expression
 * repeated at N call sites is one defect, not N (EyebrowLabel and VerdictChip
 * both carried their own copy).
 */
export function normalizeInfo(info) {
  if (typeof info === 'string') return info ? { text: info } : null
  return info && info.text ? info : null
}
```

Then make the exact two-line edit in **both** `EyebrowLabel.jsx` and `VerdictChip.jsx`.

Change the import line — from:
```jsx
import InfoTip from './InfoTip'
```
to:
```jsx
import InfoTip, { normalizeInfo } from './InfoTip'
```

And change the normalisation line — from:
```jsx
  const tip = typeof info === 'string' ? { text: info } : info || null
```
to:
```jsx
  const tip = normalizeInfo(info)
```

Nothing else in either file changes; both already guard with `tip?.text`, and `normalizeInfo` returns `null` for the same inputs the old expression did, so every existing render test stays green.

**3d.** In `InfoTip.module.css`: add `position: relative;` to the `.trigger` rule, **delete** the `width`/`height` overrides from the PHONE block and the whole TABLET block, and add a TOUCH block:

```css
/* TOUCH — the 44px tap floor (--tap-min) is met by an invisible expander, NOT by
   growing the button. The ⓘ is INLINE inside a label row (EyebrowLabel,
   VerdictChip), so a 44px layout box re-flowed every eyebrow row on a phone.
   The hit area is 44px; the box stays 16px. */
@media (max-width: 1024px) {
  .trigger::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--tap-min);
    height: var(--tap-min);
    transform: translate(-50%, -50%);
  }
}

/* PHONE */
@media (max-width: 640px) {
  .pop {
    max-width: min(280px, calc(100vw - 32px));
  }
}
```

**3e.** In `ConsensusBar.jsx`, the empty branch passes the prop through:

```jsx
  if (!segments) {
    return (
      <EmptyState
        compact={compact}
        icon="document"
        title="No analyst coverage"
        hint="Ratings appear here once firms publish on this name."
        className={className}
      />
    )
  }
```

**3f.** Extend `app/src/components/research-kit/index.js` — append:

```js
export { normalizeInfo } from './InfoTip'
export { TONE_CLASS as STAT_TILE_TONE_CLASS } from './StatTile'
export { TONE_CLASS as VERDICT_CHIP_TONE_CLASS } from './VerdictChip'
export { TONE_CLASS as RANGE_SLIDER_TONE_CLASS } from './RangeSlider'
// NOTE: components/research-kit/testing/restraint.js is deliberately NOT
// exported here — it is a test helper and must never reach a runtime bundle.
```

- [ ] **Step 4: Run the full gate**

```
cd app && npx vitest run src/components/research-kit/ src/components/Skeleton.test.jsx src/styles/tokens.test.js
```
Expected: 25 test files pass (23 from Task 7, plus `testing/restraint.test.jsx`, plus `Skeleton.test.jsx` and `styles/tokens.test.js` from the wider path). **0 failed.**

Then the whole suite, to prove nothing else regressed (the `InfoTip`/`EyebrowLabel`/`VerdictChip`/`ConsensusBar` edits touch shipped components):

```
cd app && npx vitest run
```
Expected: 0 failed. If a single file OOMs the fork pool, re-run that file with `--pool=threads`.

Then the build gate:

```
cd app && npm run build 2>&1 | grep -E "vendor-echarts|vendor-charts"
```

- [ ] **Assert:** `vendor-echarts` is within +10 kB of the Task 1 Step 0 baseline. Seven chart components later, the only echarts entry point is still `charts/echartsCore.js`.
- [ ] **Assert:** build exits 0 and no new chunk contains echarts.

- [ ] **Step 5: Commit**

```
git add app/src/components/research-kit/testing/restraint.js app/src/components/research-kit/testing/restraint.test.jsx app/src/components/research-kit/toneClasses.test.js app/src/components/research-kit/StatTile.jsx app/src/components/research-kit/VerdictChip.jsx app/src/components/research-kit/RangeSlider.jsx app/src/components/research-kit/InfoTip.jsx app/src/components/research-kit/InfoTip.module.css app/src/components/research-kit/InfoTip.test.jsx app/src/components/research-kit/EyebrowLabel.jsx app/src/components/research-kit/ConsensusBar.jsx app/src/components/research-kit/ConsensusBar.test.jsx app/src/styles/tokens.test.js app/src/components/research-kit/index.js
git commit -m "$(cat <<'EOF'
research-kit: P1F-A review punch list

Six small fixes, each one a real hole:

1. testing/restraint.js -- §3.1's "one accent surface per canvas" was prose
   only. Now a TEST HELPER (never runtime) that composition tests can assert,
   with a control case proving it FAILS on a two-accent fixture.
2. toneClasses.test.js reads TONE_CLASS off the components instead of a
   hand-copied list, so adding a tone without its CSS rule now fails.
3. InfoTip's 44px tap floor is met by an invisible ::after expander instead of
   growing the button: the (i) is inline inside a label row, so a 44px layout
   box re-flowed every eyebrow row on a phone. The test reads the stylesheet
   source, because jsdom does no layout and every measured size is 0.
4. normalizeInfo() lives once in InfoTip; EyebrowLabel and VerdictChip both
   carried their own copy of the same expression.
5. --text-bright joins the computed contrast matrix -- it is the shell's
   heading ink and now sits on --glass-elevated and --glass-chrome.
6. ConsensusBar honours `compact` in its empty branch; it hardcoded compact, so
   a full-size bar shrank exactly when the data went missing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review: §4/§5 widget coverage after P1F-A + P1F-B

Every widget and shell piece named in spec §3.4 is now built:

| §3.4 name | Where | Phase |
|---|---|---|
| GlassCard · StatTile · VerdictChip · EyebrowLabel · ConsensusBar · RangeSlider · RatingChangeList · EmptyState · SkeletonBlock size contract | `research-kit/` | P1F-A |
| LollipopChart · ReactionBars · RevisionColumns · ImpliedVsRealized · Histogram · MetricTrendChart · HeatGrid | `research-kit/charts/` | **P1F-B** |
| RatingCrown · CheckupRow | `research-kit/` | **P1F-B** |
| IdentityBanner · SectionRail · PinnedFooter | `research-kit/shell/` | **P1F-B** |

**Section-by-section check against §4 and §5:**

- §4.2 banner — `IdentityBanner` + `VerdictChip` (grade) + a live-price node. ✅
- §4.3.1 Setup — `ImpliedVsRealized` hero + `VerdictChip` + `RangeSlider` (dollar break-even) + `StatTile` key stats. ✅
- §4.3.2 Earnings History — `LollipopChart` + `ReactionBars` + `StatTile` caption row. ✅
- §4.3.3 Brief / §4.3.4 Call — prose + audio; composition on `GlassCard`/`EmptyState`. ✅ (no primitive needed)
- §5.3 Overview / Ratings — `RatingCrown` (+ `variant="compact"` for the header badge), `CheckupRow`, `StatTile`, `ConsensusBar`. ✅
- §5.3 Financials — `HeatGrid` + `MetricTrendChart` + `StatTile`. ✅
- §5.3 Estimates — `RevisionColumns` + `RangeSlider` + `Histogram` + `RatingChangeList`. ✅

**Still needed by P2/P3 — and correctly NOT in this plan:**

1. **`SentimentGauge` kit restyle** (§3.4: "a kit restyle rather than a fork"). It is an existing component with existing consumers; restyling it is a P2 edit against the Call section, not a new primitive. **Called out so it is not forgotten — it is the one §3.4 line item neither P1F-A nor P1F-B touches.**
2. **The compact quarterly table** (ACT/EST · SURPRISE · REV · NEXT-DAY, §4.3.2) — a plain table beside the lollipop. `HeatGrid` is deliberately not it (that is the *financial* grid with a heat ladder); this is a normal table and is P2 composition on the existing `ResponsiveTable`.
3. **The hollow-vs-solid coach-mark** (§3.4, localStorage-gated, one-time). It needs a real surface to attach to and a storage key namespace — P2.
4. **The methodology page** (§12) every `InfoTip href` points at — P2.
5. **Expected-move band + earnings markers on the price chart** (§5.3 Overview) — `lightweight-charts` work inside `StockChart`, not a kit component; pooled-series rule #2049 applies. P2/P3.
6. **Ownership primitives** — the short-interest bullet (dataviz #15/16) and the institutional-ownership trend area (#25) have no kit component. Ownership is a **P3** section and the spec does not list either in §3.4, so this is a scoped deferral, not a gap in the launch slice.
7. **The Setup-Grade-vs-UCT-Rating distinct-identity test** (§8) needs both surfaces mounted — P2 writes it. P1F-B provides the hook (`data-rk-identity="ring"`).
8. **The `?earnings=SYM` URL hook, the §4.5 state machine's *computation*, arrow-key stepping, the bottom sheet** — all P2 behaviour. This plan ships `lifecycle` as a prop precisely so the computation lands there, tested there.

**Placeholder scan:** every task ships complete, runnable code — no `TODO`, no `…`, no "implement X here", no invented endpoints. The two payloads that do not exist yet (`/api/research/earnings-history/{sym}`, weekly revision buckets) are handled by **fixing the row shape in Global Constraints** and giving the consuming component a neutral prop, not by a placeholder.

**Prop-name consistency with the shipped P1F-A barrel:** every new component uses `label`, `info`, `className` in the same senses; `compact` keeps its P1F-A meaning; `ariaLabel` keeps its P1F-A meaning (an override for the built label); `tone` is untouched and still splits `SCORE_TONES` (StatTile, RatingCrown chips) from `VERDICT_TONES` (VerdictChip, RangeSlider). New shared names introduced here — `height`, `SIZE`, `quarters`, `buckets`, `columns`/`rows` — are used identically across every component that takes them.

---

## Verification summary

After Task 8 the following must all be true:

```
cd app && npx vitest run src/components/research-kit/ src/components/Skeleton.test.jsx src/styles/tokens.test.js
cd app && npx vitest run          # whole suite, 0 failed
cd app && npm run build           # exits 0
git status --porcelain            # empty — eight commits, nothing stray
```

- **25 test files green** under the research-kit path plus `Skeleton.test.jsx` and `styles/tokens.test.js`. The gate is **0 failed**.
- **`vendor-echarts` is within +10 kB of the pre-Task-1 baseline.** The chunk does not shrink in this phase and is not supposed to — five full-entry imports survive elsewhere until P5 (spec §3.4). What is proven here is that seven new charts added no second copy of echarts.
- **`app/src/components/research-kit/index.js`** exports, in addition to the P1F-A surface: `EChart`, `CHART_INK`, `echarts`, `LollipopChart` (+`LOLLIPOP_SIZE`, `beatState`, `buildLollipopOption`, `horizonLabel`), `ReactionBars` (+`REACTION_BARS_SIZE`, `reactionGeometry`, `reactionStats`, `outcomeOf`), `ImpliedVsRealized` (+`IMPLIED_VS_REALIZED_SIZE`, `pairQuarters`, `coldStartState`, `impliedVerdict`), `RevisionColumns` (+`REVISION_COLUMNS_SIZE`, `revisionTotals`, `buildRevisionOption`), `Histogram` (+`HISTOGRAM_SIZE`, `binValues`, `buildHistogramOption`), `HeatGrid` (+`heatTier`, `HEAT_TIERS`, `DEFAULT_HEAT_STOPS`, `formatSigned`), `MetricTrendChart` (+`METRIC_TREND_SIZE`, `buildTrendOption`), `RatingCrown` (+`RATING_CROWN_SIZE`, `scoreTier`, `letterTier`, `ringGeometry`, `basisPill`, `COMPONENT_ORDER`), `CheckupRow` (+`normalizeStatus`), `IdentityBanner` (+`LIFECYCLE_STATES`, `normalizeLifecycle`, `timingVariant`), `SectionRail` (+`nextIndex`), `PinnedFooter`, `normalizeInfo`, and the three `*_TONE_CLASS` maps. `testing/restraint.js` is **not** exported.
- **No file outside `app/src/components/research-kit/`, `app/src/styles/tokens.test.js` is modified.** No partner-owned file, no existing echarts consumer, no page.
- **Nothing is pushed.** P2 builds the launch modal on this branch.

