# Breadth Chart Presets v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose 12 already-collected breadth metrics, add 7 presets and revise 2, and make every preset readable — colour by polarity, reference lines, follow-through-day markers, and a value + percentile readout.

**Architecture:** All catalog, unit, tone, preset, and line logic stays in the pure module `app/src/pages/breadth/chartMetrics.js` so it is unit-testable without mounting ECharts — the reason `resolveAxes` already lives there. Two new pure helpers (`ftdMarkers`, `percentileOf`) and two new components (`PresetRow`, `MetricReadout`) keep `BreadthCharts.jsx` as a wiring layer. No backend changes.

**Tech Stack:** React 18, Vite, ECharts via `echarts-for-react`, Vitest + `@testing-library/react`, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-08-06-breadth-chart-presets-v2-design.md`

## Global Constraints

- Work only in the worktree `C:\Users\Patrick\uct-worktrees\breadth-presets-v2` on branch `feat/breadth-presets-v2`. Never `git add -A`; always `git commit -- <paths>`.
- Run tests from `app/`: `npm test` (vitest run). Single file: `npm test -- src/pages/breadth/chartMetrics.test.js`.
- No backend changes. Every metric used is already in the `/api/breadth-monitor` payload.
- These existing tests must keep passing unchanged: *"spans at most two unit families so nothing is crowded off an axis"* and *"never pairs the two index metrics, which share an axis but not a scale"*.
- Never add `naaim`, `new_ath`, `spy_dist_days`, `qqq_dist_days`, or `iwm_close` to any preset.
- Every preset spans at most two unit families.
- Measured metric ranges are in the spec's §1 table. Treat them as the source of truth for magnitude decisions; do not re-derive them.
- Style: the codebase writes comments that explain *why*, not *what*. Match it. No decorative comments.

---

### Task 1: Catalog additions and three unit families

**Files:**
- Modify: `app/src/pages/breadth/chartMetrics.js`
- Test: `app/src/pages/breadth/chartMetrics.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `UNIT.CUM`, `UNIT.NET`, `UNIT.SPREAD`; 12 new entries in `CHART_GROUPS` and `METRIC_UNITS`. Later tasks rely on the keys `adv_decline`, `adv_decline_cum`, `up_vol_ratio`, `hi_ratio`, `lo_ratio`, `near_52w_high`, `rsp_spy_ratio`, `iwm_qqq_ratio`, `vxn`, `avg_10d_vix`, `avg_10d_vxn`, `avg_10d_cpc`.

- [ ] **Step 1: Write the failing test**

Add to `chartMetrics.test.js`:

```js
describe('catalog v2 additions', () => {
  const NEW_KEYS = [
    'adv_decline', 'adv_decline_cum', 'up_vol_ratio',
    'hi_ratio', 'lo_ratio', 'near_52w_high',
    'rsp_spy_ratio', 'iwm_qqq_ratio',
    'vxn', 'avg_10d_vix', 'avg_10d_vxn', 'avg_10d_cpc',
  ]

  it('exposes every metric the collector already writes', () => {
    const known = new Set(ALL_METRICS.map(m => m.key))
    expect(NEW_KEYS.filter(k => !known.has(k))).toEqual([])
  })

  it('gives the high/low ratios the percent family, since they are % of universe', () => {
    expect(unitOf('hi_ratio')).toBe(UNIT.PCT)
    expect(unitOf('lo_ratio')).toBe(UNIT.PCT)
  })

  // Each of these exists because its range would flatten a neighbour inside an
  // existing family: 13,981 against a 234 count, a signed +/-2,000, and a
  // 0.028-wide spread against ratio_5day's 4.4.
  it('isolates the cumulative, signed, and spread metrics in their own families', () => {
    expect(unitOf('adv_decline_cum')).toBe(UNIT.CUM)
    expect(unitOf('adv_decline')).toBe(UNIT.NET)
    expect(unitOf('rsp_spy_ratio')).toBe(UNIT.SPREAD)
    expect(unitOf('iwm_qqq_ratio')).toBe(UNIT.SPREAD)
  })

  it('gives every new family an axis label', () => {
    for (const u of [UNIT.CUM, UNIT.NET, UNIT.SPREAD]) {
      expect(UNIT_LABEL[u], `${u} has no axis label`).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: FAIL — the new keys are absent from the catalog, so the first test reports all 12 missing.

- [ ] **Step 3: Write minimal implementation**

In `chartMetrics.js`, extend `UNIT` and `UNIT_LABEL`:

```js
export const UNIT = {
  PCT:    'pct',    // 0–150 bounded percentages and composite scores
  COUNT:  'count',  // number of stocks
  RATIO:  'ratio',  // unitless ~0–5
  INDEX:  'index',  // index / ETF price level
  VIX:    'vix',    // volatility points
  OSC:    'osc',    // oscillator, roughly -100..+100
  CUM:    'cum',    // running cumulative total, thousands
  NET:    'net',    // signed daily net, ±2,000
  SPREAD: 'spread', // intermarket price ratio, 0.27–0.44
}

export const UNIT_LABEL = {
  [UNIT.PCT]:    '%',
  [UNIT.COUNT]:  'stocks',
  [UNIT.RATIO]:  'ratio',
  [UNIT.INDEX]:  'index',
  [UNIT.VIX]:    'VIX',
  [UNIT.OSC]:    'osc',
  [UNIT.CUM]:    'A/D line',
  [UNIT.NET]:    'net',
  [UNIT.SPREAD]: 'spread',
}
```

Add to `CHART_GROUPS`. In the `Primary Breadth` group, append after `universe_count`:

```js
      { key: 'adv_decline',     label: 'Net Advancers' },
      { key: 'adv_decline_cum', label: 'A/D Line' },
      { key: 'up_vol_ratio',    label: 'Up/Down Volume' },
```

In the `Regime` group, append after `stage4_count`:

```js
      { key: 'rsp_spy_ratio', label: 'RSP/SPY (Equal-Wt)' },
      { key: 'iwm_qqq_ratio', label: 'IWM/QQQ (Small-Cap)' },
      { key: 'vxn',           label: 'VXN (Nasdaq)' },
      { key: 'avg_10d_vix',   label: 'VIX 10D Avg' },
      { key: 'avg_10d_vxn',   label: 'VXN 10D Avg' },
```

In the `Highs / Lows` group, append after `atr_ext_7`:

```js
      { key: 'hi_ratio',      label: '% at 52W Highs' },
      { key: 'lo_ratio',      label: '% at 52W Lows' },
      { key: 'near_52w_high', label: 'Within 5% of High' },
```

In the `Sentiment` group, append after `cboe_putcall`:

```js
      { key: 'avg_10d_cpc', label: 'P/C 10D Avg' },
```

Add to `METRIC_UNITS`, each beside its existing group block:

```js
  // Primary Breadth
  adv_decline:     UNIT.NET,
  adv_decline_cum: UNIT.CUM,
  up_vol_ratio:    UNIT.RATIO,

  // Regime
  rsp_spy_ratio: UNIT.SPREAD,
  iwm_qqq_ratio: UNIT.SPREAD,
  vxn:           UNIT.VIX,
  avg_10d_vix:   UNIT.VIX,
  avg_10d_vxn:   UNIT.VIX,

  // Highs / Lows — hi/lo_ratio are nh/uni*100 (breadth_monitor.py:169), so they
  // are percentages of the universe, not ratios, and the axis must read '%'.
  hi_ratio:      UNIT.PCT,
  lo_ratio:      UNIT.PCT,
  near_52w_high: UNIT.COUNT,

  // Sentiment
  avg_10d_cpc: UNIT.RATIO,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: PASS, including the pre-existing `unit coverage` tests, which now cover 56 metrics.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/chartMetrics.js app/src/pages/breadth/chartMetrics.test.js
git commit -m "Breadth charts: expose 12 collected metrics, add cum/net/spread families"
```

---

### Task 2: Per-family axis framing

**Files:**
- Modify: `app/src/pages/breadth/chartMetrics.js`
- Test: `app/src/pages/breadth/chartMetrics.test.js`

**Interfaces:**
- Consumes: `UNIT` from Task 1.
- Produces: `SCALED_UNITS` (a `Set`) and `scaleForUnit(unit) -> boolean`, returning `true` when the axis should frame its own data instead of anchoring at 0. Task 5 and Task 10 both use it.

- [ ] **Step 1: Write the failing test**

Add to `chartMetrics.test.js`, and extend the import at the top of the file to include `SCALED_UNITS, scaleForUnit`:

```js
describe('axis framing', () => {
  // A magnitude is read against zero; a level is read as a shape. Getting this
  // wrong is not cosmetic: rsp_spy_ratio spans 0.272-0.300, which on a
  // zero-anchored axis is a flat line at 93% height.
  it('anchors magnitudes at zero and frames levels to their own data', () => {
    expect(scaleForUnit(UNIT.PCT)).toBe(false)
    expect(scaleForUnit(UNIT.COUNT)).toBe(false)
    expect(scaleForUnit(UNIT.NET)).toBe(false)
    expect(scaleForUnit(UNIT.RATIO)).toBe(false)

    expect(scaleForUnit(UNIT.INDEX)).toBe(true)
    expect(scaleForUnit(UNIT.VIX)).toBe(true)
    expect(scaleForUnit(UNIT.OSC)).toBe(true)
    expect(scaleForUnit(UNIT.CUM)).toBe(true)
    expect(scaleForUnit(UNIT.SPREAD)).toBe(true)
  })

  // The gate: adding a family without deciding its framing must fail here
  // rather than silently inherit the zero anchor.
  it('has a decision on record for every declared family', () => {
    const undecided = Object.values(UNIT).filter(
      u => typeof scaleForUnit(u) !== 'boolean',
    )
    expect(undecided).toEqual([])
    expect(SCALED_UNITS.size + 4).toBe(Object.values(UNIT).length)
  })

  // EXTREMES_BAND forces min<=0 and max>=100 on whichever axis carries the
  // reference lines, which would undo auto-framing. Extremes are only offered
  // for MA Breadth (PCT, anchored), so the two rules must never meet.
  it('never offers an extremes group on an auto-framed family', () => {
    for (const preset of CHART_PRESETS) {
      for (const group of preset.extremes ?? []) {
        const keys = CHART_GROUPS.find(g => g.group === group).metrics.map(m => m.key)
        for (const k of keys) {
          expect(scaleForUnit(unitOf(k)), `${group}/${k} is auto-framed`).toBe(false)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: FAIL with `scaleForUnit is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `chartMetrics.js`, directly below `unitOf`:

```js
// Families whose axis frames its own data instead of including zero. The split
// is magnitude vs level: a count of stocks or a percent above a moving average
// is read against 0, but an index price, a VIX level, or a 0.03-wide
// intermarket spread is read as a shape and a zero anchor destroys it.
export const SCALED_UNITS = new Set([
  UNIT.INDEX, UNIT.VIX, UNIT.OSC, UNIT.CUM, UNIT.SPREAD,
])

/** True when the axis for this family should frame its data rather than anchor at 0. */
export function scaleForUnit(unit) {
  return SCALED_UNITS.has(unit)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/chartMetrics.js app/src/pages/breadth/chartMetrics.test.js
git commit -m "Breadth charts: frame level families to their data, anchor magnitudes at zero"
```

---

### Task 3: Series colour by metric polarity

**Files:**
- Modify: `app/src/pages/breadth/chartMetrics.js`
- Test: `app/src/pages/breadth/chartMetrics.test.js`

**Interfaces:**
- Consumes: `ALL_METRICS` from Task 1.
- Produces: `TONE` (`{BULL, BEAR, NEUTRAL}`), `METRIC_TONE`, `toneOf(key) -> string`, `TONE_RAMP`, and `resolveColors(selected) -> Record<string, string>` mapping each selected key to a hex colour. Task 9 and Task 10 consume `resolveColors`.

- [ ] **Step 1: Write the failing test**

Add to `chartMetrics.test.js`, extending the import to include `TONE, toneOf, resolveColors`:

```js
describe('series colour', () => {
  // Colour was PALETTE[i], so index 1 was always green. Every crossover preset
  // drew its deterioration line green: new_52w_lows, stage4_count,
  // down_4pct_today. These are the three that were wrong.
  const OPPOSED = [
    ['up_4pct_today', 'down_4pct_today'],
    ['up_20pct_5d', 'down_20pct_5d'],
    ['up_25pct_quarter', 'down_25pct_quarter'],
    ['up_25pct_month', 'down_25pct_month'],
    ['up_50pct_month', 'down_50pct_month'],
    ['magna_up', 'magna_down'],
    ['new_52w_highs', 'new_52w_lows'],
    ['new_20d_highs', 'new_20d_lows'],
    ['hi_ratio', 'lo_ratio'],
    ['stage2_count', 'stage4_count'],
    ['aaii_bulls', 'aaii_bears'],
  ]

  it('gives each half of an opposed pair the opposite tone', () => {
    for (const [up, down] of OPPOSED) {
      expect(toneOf(up), `${up} should read bullish`).toBe(TONE.BULL)
      expect(toneOf(down), `${down} should read bearish`).toBe(TONE.BEAR)
    }
  })

  // Tone is deliberately confined to opposed pairs. A "rising VIX is bearish"
  // rule would paint all three vol-complex series red and make them harder to
  // tell apart, and setup-supply would draw two greens.
  it('leaves unpaired metrics neutral so they stay distinguishable', () => {
    for (const k of ['vix', 'vxn', 'avg_10d_vix', 'near_52w_high',
                     'pct_above_50sma', 'up_vol_ratio', 'adv_decline']) {
      expect(toneOf(k), `${k} should be neutral`).toBe(TONE.NEUTRAL)
    }
  })

  it('assigns a tone to every metric in the catalog', () => {
    const bad = ALL_METRICS.map(m => m.key).filter(k => !Object.values(TONE).includes(toneOf(k)))
    expect(bad).toEqual([])
  })

  // The gate on the defect: no preset may draw two series the same colour.
  it('never repeats a colour inside a preset', () => {
    for (const preset of CHART_PRESETS) {
      const colors = Object.values(resolveColors(preset.metrics))
      expect(new Set(colors).size, `${preset.label} repeats a colour`).toBe(preset.metrics.length)
    }
  })

  it('draws the bearish half of every crossover preset in red', () => {
    const REDS = new Set(['#f87171', '#ef4444', '#b91c1c'])
    for (const [id, bear] of [['highs-lows', 'new_52w_lows'],
                              ['trend-regime', 'stage4_count'],
                              ['thrust', 'down_4pct_today']]) {
      const preset = CHART_PRESETS.find(p => p.id === id)
      expect(REDS, `${id}: ${bear} is not red`).toContain(resolveColors(preset.metrics)[bear])
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: FAIL with `toneOf is not a function`. This is the test that encodes the shipped defect — before writing the implementation, confirm the defect is real by running this one-liner, which prints the colour the current positional palette gives each crossover preset's bearish series:

```bash
cd app && node -e "
const P=['#60a5fa','#34d399','#f59e0b','#f87171','#a78bfa','#fb923c','#38bdf8','#4ade80','#e879f9','#fbbf24'];
for (const [id,m,i] of [['highs-lows','new_52w_lows',1],['trend-regime','stage4_count',1],['thrust','down_4pct_today',1]])
  console.log(id, m, '->', P[i]);
"
```
Expected output: all three print `#34d399` — green.

- [ ] **Step 3: Write minimal implementation**

In `chartMetrics.js`, below `scaleForUnit`:

```js
// ── Series colour ─────────────────────────────────────────────────────────────
// Colour used to be PALETTE[seriesIndex], so index 1 was always green and every
// crossover preset drew its deterioration line — new_52w_lows, stage4_count,
// down_4pct_today — in green.
//
// Tone is assigned ONLY to metrics that exist as an opposed pair. Extending it
// to "rising VIX is bearish" would paint all three vol-complex series red and
// make them harder to tell apart, and setup-supply would draw near_52w_high and
// new_52w_highs as two greens. On crossover charts semantics win; everywhere
// else distinguishability does.

export const TONE = { BULL: 'bull', BEAR: 'bear', NEUTRAL: 'neutral' }

export const METRIC_TONE = {
  up_4pct_today:      TONE.BULL,  down_4pct_today:    TONE.BEAR,
  up_20pct_5d:        TONE.BULL,  down_20pct_5d:      TONE.BEAR,
  up_25pct_quarter:   TONE.BULL,  down_25pct_quarter: TONE.BEAR,
  up_25pct_month:     TONE.BULL,  down_25pct_month:   TONE.BEAR,
  up_50pct_month:     TONE.BULL,  down_50pct_month:   TONE.BEAR,
  magna_up:           TONE.BULL,  magna_down:         TONE.BEAR,
  new_52w_highs:      TONE.BULL,  new_52w_lows:       TONE.BEAR,
  new_20d_highs:      TONE.BULL,  new_20d_lows:       TONE.BEAR,
  hi_ratio:           TONE.BULL,  lo_ratio:           TONE.BEAR,
  stage2_count:       TONE.BULL,  stage4_count:       TONE.BEAR,
  aaii_bulls:         TONE.BULL,  aaii_bears:         TONE.BEAR,
  new_ath:            TONE.BULL,
}

export function toneOf(key) {
  return METRIC_TONE[key] ?? TONE.NEUTRAL
}

// Six neutrals because the largest single-tone group in any preset is
// `participation` with four.
export const TONE_RAMP = {
  [TONE.BULL]:    ['#34d399', '#4ade80', '#15803d'],
  [TONE.BEAR]:    ['#f87171', '#ef4444', '#b91c1c'],
  [TONE.NEUTRAL]: ['#60a5fa', '#f59e0b', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9'],
}

/**
 * Colour for each selected metric: its tone's ramp, advanced per tone so two
 * bullish series never land on the same green.
 *
 * A hand-picked selection deeper than a ramp wraps and can repeat. Presets are
 * the guarded path and a test holds them collision-free.
 */
export function resolveColors(selected) {
  const used = { [TONE.BULL]: 0, [TONE.BEAR]: 0, [TONE.NEUTRAL]: 0 }
  const out = {}
  for (const key of selected ?? []) {
    const tone = toneOf(key)
    const ramp = TONE_RAMP[tone]
    out[key] = ramp[used[tone] % ramp.length]
    used[tone] += 1
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: PASS. Note the last test now proves the three crossover presets draw red where they drew green.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/chartMetrics.js app/src/pages/breadth/chartMetrics.test.js
git commit -m "Breadth charts: colour series by polarity, not by series index

Colour was PALETTE[i], so index 1 was always green and every crossover
preset drew its deterioration line green: new_52w_lows, stage4_count,
down_4pct_today."
```

---

### Task 4: Seven new presets, two revised, and preset grouping

**Files:**
- Modify: `app/src/pages/breadth/chartMetrics.js`
- Test: `app/src/pages/breadth/chartMetrics.test.js`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `CHART_PRESETS` grown to 16, each optionally carrying `group` (string), `lines` (array of `{unit, at, label}`), and `minWindowDays` (number). `PRESET_GROUP_ORDER` (array of strings) fixes popover section order for Task 8.

- [ ] **Step 1: Write the failing test**

Add to `chartMetrics.test.js`, extending the import to include `PRESET_GROUP_ORDER`:

```js
describe('preset set v2', () => {
  const byId = id => CHART_PRESETS.find(p => p.id === id)

  it('adds the seven new presets', () => {
    for (const id of ['ad-line', 'narrow-leadership', 'risk-appetite',
                      'volume-thrust', 'highs-lows-pct', 'vol-complex', 'setup-supply']) {
      expect(byId(id), `${id} is missing`).toBeTruthy()
    }
    expect(CHART_PRESETS).toHaveLength(16)
  })

  it('revises volatility and thrust', () => {
    // The daily put/call is noise across 39 distinct values in 151 sessions;
    // the 10-day average is the tradeable extreme, and they share a scale.
    expect(byId('volatility').metrics).toContain('avg_10d_cpc')
    // Counts and ratios with no volume cannot tell a thrust from a bounce.
    expect(byId('thrust').metrics).toContain('up_vol_ratio')
  })

  it('never references a metric that is excluded on purpose', () => {
    const banned = ['naaim', 'new_ath', 'spy_dist_days', 'qqq_dist_days', 'iwm_close']
    for (const preset of CHART_PRESETS) {
      for (const key of preset.metrics) {
        expect(banned, `${preset.label} uses ${key}`).not.toContain(key)
      }
    }
  })

  // new_ath is count_nd_highs(closes, min(252, len-1)) — a 252-day high, so it
  // duplicates new_52w_highs on 139 of 151 sessions. It is labelled "ATH Count"
  // in the picker, so a future author will reach for it. This is the sign.
  it('keeps new_ath out, because it is a 52-week high wearing another name', () => {
    for (const preset of CHART_PRESETS) {
      expect(preset.metrics).not.toContain('new_ath')
    }
  })

  // Round one's lesson as a gate: a shared family is necessary but not
  // sufficient, because a family can span an order of magnitude. Thresholded at
  // 6x, which every preset clears with froth closest at 4.8x, and which both
  // round-one defects fail: S&P 7737 vs QQQ 746 = 10.4x, and up_25pct_month 385
  // vs atr_ext_7 34 = 11.3x.
  const MAX_ABS = {
    breadth_score: 98.1, uct_exposure: 102, up_4pct_today: 956, down_4pct_today: 762,
    ratio_5day: 4.83, ratio_10day: 3.32, up_20pct_5d: 183, down_20pct_5d: 171,
    up_25pct_quarter: 1131, down_25pct_quarter: 505, up_25pct_month: 385,
    down_25pct_month: 274, up_50pct_month: 128, down_50pct_month: 15,
    magna_up: 1307, magna_down: 1103, universe_count: 3736,
    pct_above_5sma: 81.6, pct_above_10sma: 83.6, pct_above_20ema: 82.8,
    pct_above_40sma: 75.8, pct_above_50sma: 73.5, pct_above_100sma: 70.1,
    pct_above_200sma: 72.8, sp500_close: 7736.52, qqq_close: 746.16,
    vix: 31.05, mcclellan_osc: 223.9, stage2_count: 1244, stage4_count: 594,
    new_52w_highs: 555, new_52w_lows: 234, new_20d_highs: 1412, new_20d_lows: 1228,
    hvc_52w: 163, atr_ext_7: 34, cnn_fear_greed: 69.9, aaii_bulls: 49,
    aaii_neutral: 35, aaii_bears: 52, aaii_spread: 22, cboe_putcall: 1.12,
    adv_decline: 2142, adv_decline_cum: 13981, up_vol_ratio: 5.73,
    hi_ratio: 18.61, lo_ratio: 8.57, near_52w_high: 1177,
    rsp_spy_ratio: 0.2996, iwm_qqq_ratio: 0.4377, vxn: 33.54,
    avg_10d_vix: 26.87, avg_10d_vxn: 29.31, avg_10d_cpc: 1.01,
  }

  it('keeps same-family metrics within 6x so none is pinned to the floor', () => {
    for (const preset of CHART_PRESETS) {
      const byFamily = {}
      for (const key of preset.metrics) {
        expect(MAX_ABS[key], `${key} missing from the measured range table`).toBeGreaterThan(0)
        ;(byFamily[unitOf(key)] ??= []).push(key)
      }
      for (const [family, keys] of Object.entries(byFamily)) {
        if (keys.length < 2) continue
        const mags = keys.map(k => MAX_ABS[k])
        const ratio = Math.max(...mags) / Math.min(...mags)
        expect(ratio, `${preset.label}/${family} spans ${ratio.toFixed(1)}x`).toBeLessThanOrEqual(6)
      }
    }
  })

  it('would have failed on both round-one defects', () => {
    const spread = (a, b) => Math.max(MAX_ABS[a], MAX_ABS[b]) / Math.min(MAX_ABS[a], MAX_ABS[b])
    expect(spread('sp500_close', 'qqq_close')).toBeGreaterThan(6)
    expect(spread('up_25pct_month', 'atr_ext_7')).toBeGreaterThan(6)
  })

  it('partitions cleanly into core pills and grouped popover entries', () => {
    const core = CHART_PRESETS.filter(p => !p.group)
    const grouped = CHART_PRESETS.filter(p => p.group)
    expect(core).toHaveLength(7)
    expect(grouped).toHaveLength(9)
    for (const p of grouped) {
      expect(PRESET_GROUP_ORDER, `${p.label} has an unlisted group`).toContain(p.group)
    }
    for (const g of PRESET_GROUP_ORDER) {
      expect(grouped.some(p => p.group === g), `${g} has no presets`).toBe(true)
    }
  })

  it('declares a widening window only where the data needs it', () => {
    // adv_decline_cum keeps 55% of its travel at the 90-day default and the
    // April trough at -995 falls off-screen. iwm_qqq_ratio keeps 97% and
    // rsp_spy_ratio 86%, so their presets need nothing.
    expect(byId('ad-line').minWindowDays).toBe(365)
    for (const p of CHART_PRESETS.filter(p => p.id !== 'ad-line')) {
      expect(p.minWindowDays, `${p.label} should not move the window`).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: FAIL — `ad-line is missing`, and `CHART_PRESETS` has length 9.

- [ ] **Step 3: Write minimal implementation**

In `chartMetrics.js`, above `CHART_PRESETS`:

```js
// Popover section order. A preset without `group` is a core pill.
export const PRESET_GROUP_ORDER = ['Structure', 'Leadership', 'Momentum', 'Volatility & Sentiment']
```

Revise the two existing presets. Replace `volatility`'s metrics line with:

```js
    metrics: ['vix', 'cboe_putcall', 'avg_10d_cpc'],
    lines: [{ unit: UNIT.RATIO, at: 1.0, label: 'parity' }],
```

Replace `thrust`'s metrics line with:

```js
    metrics: ['up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day', 'up_vol_ratio'],
    lines: [
      { unit: UNIT.RATIO, at: 1.0, label: 'parity' },
      { unit: UNIT.RATIO, at: 2.0, label: 'thrust' },
    ],
```

Add `group` to the six existing presets that move into the popover — `highs-lows` and `trend-regime` get `group: 'Structure'`, `froth` gets `group: 'Momentum'`, `sentiment` gets `group: 'Volatility & Sentiment'`. Also give `sentiment`:

```js
    lines: [
      { unit: UNIT.PCT, at: 25, label: 'fear' },
      { unit: UNIT.PCT, at: 75, label: 'greed' },
    ],
```

Append the seven new presets to `CHART_PRESETS`:

```js
  {
    id: 'ad-line',
    label: 'A/D Line',
    hint: 'The cumulative advance-decline line against the index — price highs the line will not confirm.',
    metrics: ['adv_decline_cum', 'sp500_close'],
    lines: [{ unit: UNIT.CUM, at: 0, label: 'flat' }],
    // adv_decline_cum keeps only 55% of its travel in the default 90-day
    // window, climbing monotonically from 5,781 with the April trough at -995
    // off-screen — the divergence this preset exists to show is not in frame.
    minWindowDays: 365,
  },
  {
    id: 'narrow-leadership',
    label: 'Narrow Leadership',
    hint: 'Equal-weight against cap-weight, with the index — a falling ratio into a rising index is a mega-cap-only rally.',
    metrics: ['rsp_spy_ratio', 'sp500_close'],
  },
  {
    id: 'risk-appetite',
    label: 'Risk Appetite',
    group: 'Leadership',
    hint: 'Small-cap and equal-weight participation together — who is being bought beyond the megacaps.',
    metrics: ['iwm_qqq_ratio', 'rsp_spy_ratio'],
  },
  {
    id: 'volume-thrust',
    label: 'Volume Thrust',
    group: 'Momentum',
    hint: 'Up versus down volume against net advancers — conviction behind the advance, not just its width.',
    metrics: ['up_vol_ratio', 'adv_decline'],
    lines: [
      { unit: UNIT.RATIO, at: 1.0, label: 'parity' },
      { unit: UNIT.NET, at: 0, label: 'flat' },
    ],
  },
  {
    id: 'highs-lows-pct',
    label: 'Highs/Lows %',
    hint: 'The same crossover as New Highs vs Lows, as a share of the universe.',
    // universe_count swings 2,637 to 3,736 across the recorded history — a 42%
    // change — so raw high/low counts are not comparable across the window and
    // the percentage is. Both presets exist because the raw crossover is what a
    // reader recognises and this one is what is actually true.
    metrics: ['hi_ratio', 'lo_ratio'],
  },
  {
    id: 'vol-complex',
    label: 'Vol Complex',
    group: 'Volatility & Sentiment',
    hint: 'Nasdaq against broad volatility, with the 10-day trend.',
    metrics: ['vix', 'vxn', 'avg_10d_vix'],
    lines: [{ unit: UNIT.VIX, at: 20, label: '20' }],
  },
  {
    id: 'setup-supply',
    label: 'Setup Supply',
    group: 'Structure',
    hint: 'Stocks coiled within 5% of a 52-week high against those actually breaking out.',
    metrics: ['near_52w_high', 'new_52w_highs'],
  },
```

- [ ] **Step 4: Run the whole suite**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: PASS, including the pre-existing `covers every preset` axis-layout test — extend its expectation table with the seven new presets, asserting for each the intended left family: `ad-line` left `cum`, `narrow-leadership` left `spread`, `risk-appetite` left `spread` with no right axis, `volume-thrust` left `ratio`, `highs-lows-pct` left `pct` with no right axis, `vol-complex` left `vix` with no right axis, `setup-supply` left `count` with no right axis.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/chartMetrics.js app/src/pages/breadth/chartMetrics.test.js
git commit -m "Breadth charts: seven new presets, revise volatility and thrust"
```

---

### Task 5: Reference-line resolution

**Files:**
- Modify: `app/src/pages/breadth/chartMetrics.js`
- Test: `app/src/pages/breadth/chartMetrics.test.js`

**Interfaces:**
- Consumes: `resolveAxes`, `axisForUnit`, `scaleForUnit`, `unitOf`.
- Produces: `resolveLines(selected, lines, extentOf) -> Array<{unit, at, label, axis}>`, where `extentOf(unit)` returns `[min, max]` of visible data for that family or `null`. Task 10 supplies `extentOf` from the rows on screen.

- [ ] **Step 1: Write the failing test**

Add to `chartMetrics.test.js`, extending the import to include `resolveLines`:

```js
describe('resolveLines', () => {
  const never = () => null
  const always = () => [-1e9, 1e9]

  it('drops a line whose family has no series on the chart', () => {
    const lines = [{ unit: UNIT.RATIO, at: 1, label: 'parity' }]
    expect(resolveLines(['up_4pct_today'], lines, always)).toEqual([])
  })

  it('puts the line on the axis its family resolved to', () => {
    // two counts, one ratio: counts take the left axis, ratio goes right
    const out = resolveLines(
      ['up_4pct_today', 'down_4pct_today', 'ratio_5day'],
      [{ unit: UNIT.RATIO, at: 1, label: 'parity' }],
      always,
    )
    expect(out).toHaveLength(1)
    expect(out[0].axis).toBe(1)
  })

  // An anchored axis already includes 0, so letting a line extend it is
  // harmless and wanted: sentiment's greed line at 75 must stay visible while
  // Fear/Greed sits at 8.7, because the distance to it is the information.
  it('always draws on an anchored family, even outside the data', () => {
    const out = resolveLines(
      ['cnn_fear_greed'],
      [{ unit: UNIT.PCT, at: 75, label: 'greed' }],
      () => [8.7, 12.0],
    )
    expect(out).toHaveLength(1)
  })

  // ECharts expands an axis to contain a markLine, so a zero line on a window
  // starting at 5,781 would drag the auto-framed CUM axis back to 0-13,981 and
  // restore exactly the wasted plot the framing rule removes.
  it('suppresses a line that would expand an auto-framed axis', () => {
    const lines = [{ unit: UNIT.CUM, at: 0, label: 'flat' }]
    expect(resolveLines(['adv_decline_cum'], lines, () => [5781, 13981])).toEqual([])
    expect(resolveLines(['adv_decline_cum'], lines, () => [-995, 13981])).toHaveLength(1)
  })

  it('suppresses when the extent is unknown rather than guessing', () => {
    expect(resolveLines(['adv_decline_cum'], [{ unit: UNIT.CUM, at: 0, label: 'flat' }], never)).toEqual([])
  })

  it('every declared line has a series to sit beside', () => {
    for (const preset of CHART_PRESETS) {
      for (const line of preset.lines ?? []) {
        const present = preset.metrics.some(k => unitOf(k) === line.unit)
        expect(present, `${preset.label}: no ${line.unit} series for its ${line.at} line`).toBe(true)
      }
    }
  })

  it('never declares a line and an extremes group for the same family', () => {
    for (const preset of CHART_PRESETS) {
      const lineUnits = new Set((preset.lines ?? []).map(l => l.unit))
      for (const group of preset.extremes ?? []) {
        const units = new Set(
          CHART_GROUPS.find(g => g.group === group).metrics.map(m => unitOf(m.key)),
        )
        for (const u of units) {
          expect(lineUnits, `${preset.label} double-marks ${u}`).not.toContain(u)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: FAIL with `resolveLines is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `chartMetrics.js`, below `axisForUnit`:

```js
/**
 * Reference lines that should actually draw, with the axis each belongs to.
 *
 * Two things are filtered out. A line whose family has no series would sit on
 * an axis with nothing on it. And on an auto-framed family a line outside the
 * data would expand the axis to reach it — ECharts grows an axis to contain a
 * markLine — undoing the framing in scaleForUnit. Anchored families already
 * include zero, so there the line draws regardless and may extend the top,
 * which is what EXTREMES_BAND already does for MA Breadth.
 *
 * @param selected  metric keys currently plotted
 * @param lines     the preset's `lines`, or []
 * @param extentOf  (unit) => [min, max] over visible rows, or null when unknown
 */
export function resolveLines(selected, lines, extentOf) {
  if (!selected?.length || !lines?.length) return []
  const { axisByKey } = resolveAxes(selected)
  const out = []
  for (const line of lines) {
    if (!selected.some(k => unitOf(k) === line.unit)) continue
    if (scaleForUnit(line.unit)) {
      const extent = extentOf(line.unit)
      if (!extent || line.at < extent[0] || line.at > extent[1]) continue
    }
    out.push({ ...line, axis: axisForUnit(selected, line.unit, axisByKey) })
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/chartMetrics.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/chartMetrics.js app/src/pages/breadth/chartMetrics.test.js
git commit -m "Breadth charts: resolve reference lines without expanding a framed axis"
```

---

### Task 6: Follow-through-day marker thinning

**Files:**
- Create: `app/src/pages/breadth/ftdMarkers.js`
- Test: `app/src/pages/breadth/ftdMarkers.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `ftdMarkers(rows, opts?) -> Array<{date: string, label: boolean}>`, one entry per row where `is_ftd === true`, in row order. `opts.gap` defaults to 5. Task 10 consumes it.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/ftdMarkers.test.js`:

```js
// app/src/pages/breadth/ftdMarkers.test.js
import { describe, it, expect } from 'vitest'
import { ftdMarkers } from './ftdMarkers'

/** rows with is_ftd true at the given indices, dates d000..dNNN */
const build = (n, hits) =>
  Array.from({ length: n }, (_, i) => ({
    date: `d${String(i).padStart(3, '0')}`,
    is_ftd: hits.includes(i),
  }))

describe('ftdMarkers', () => {
  it('returns nothing when no session is a follow-through day', () => {
    expect(ftdMarkers(build(10, []))).toEqual([])
  })

  it('marks every hit but labels only the first of a cluster', () => {
    const out = ftdMarkers(build(10, [2, 3, 4]))
    expect(out.map(m => m.date)).toEqual(['d002', 'd003', 'd004'])
    expect(out.map(m => m.label)).toEqual([true, false, false])
  })

  it('reopens labelling after a gap of five sessions', () => {
    expect(ftdMarkers(build(20, [2, 7])).map(m => m.label)).toEqual([true, true])
    expect(ftdMarkers(build(20, [2, 6])).map(m => m.label)).toEqual([true, false])
  })

  // The real series: seven hits dating the April bottom, one on 2026-08-04.
  // Unthinned this stacks seven labels into mush inside three weeks.
  it('thins the measured April cluster to two labels', () => {
    const out = ftdMarkers(build(151, [66, 69, 70, 71, 73, 76, 78, 148]))
    expect(out).toHaveLength(8)
    expect(out.filter(m => m.label).map(m => m.date)).toEqual(['d066', 'd148'])
  })

  it('ignores rows where the flag is absent or falsy rather than true', () => {
    const rows = [{ date: 'a' }, { date: 'b', is_ftd: false }, { date: 'c', is_ftd: 1 }]
    expect(ftdMarkers(rows)).toEqual([])
  })

  it('tolerates an empty or missing row list', () => {
    expect(ftdMarkers([])).toEqual([])
    expect(ftdMarkers(undefined)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/ftdMarkers.test.js`
Expected: FAIL — cannot resolve `./ftdMarkers`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/pages/breadth/ftdMarkers.js`:

```js
/**
 * Follow-through days to mark on the chart, thinned for labelling.
 *
 * is_ftd clusters hard — the recorded history has seven hits between
 * 2026-04-08 and 2026-04-24 dating the April bottom, which would stack seven
 * labels inside three weeks. Every hit still draws a line; only the first of a
 * cluster carries a label, and a gap of `gap` sessions starts a new cluster.
 *
 * @param rows  visible rows in date order
 * @returns {Array<{date: string, label: boolean}>}
 */
export function ftdMarkers(rows, { gap = 5 } = {}) {
  const out = []
  let previous = -Infinity
  ;(rows ?? []).forEach((row, i) => {
    if (row?.is_ftd !== true) return
    out.push({ date: row.date, label: i - previous >= gap })
    previous = i
  })
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/ftdMarkers.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/ftdMarkers.js app/src/pages/breadth/ftdMarkers.test.js
git commit -m "Breadth charts: follow-through-day markers with cluster label thinning"
```

---

### Task 7: Percentile helper

**Files:**
- Create: `app/src/pages/breadth/percentile.js`
- Test: `app/src/pages/breadth/percentile.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `percentileOf(values, value) -> number|null` (0–100, rounded) and `latestValue(rows, key) -> number|null`. Task 9 consumes both.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/percentile.test.js`:

```js
// app/src/pages/breadth/percentile.test.js
import { describe, it, expect } from 'vitest'
import { percentileOf, latestValue } from './percentile'

describe('percentileOf', () => {
  it('reports the share of observations at or below the value', () => {
    expect(percentileOf([1, 2, 3, 4], 3)).toBe(75)
    expect(percentileOf([1, 2, 3, 4], 4)).toBe(100)
    expect(percentileOf([1, 2, 3, 4], 1)).toBe(25)
  })

  it('ignores nulls and non-numbers rather than counting them as zero', () => {
    expect(percentileOf([1, null, 2, undefined, 3, 'x', 4], 3)).toBe(75)
  })

  // A percentile from one point is not a percentile. Showing 100 would read as
  // an extreme when it only means there is nothing to compare against.
  it('refuses to invent a percentile from too few points', () => {
    expect(percentileOf([5], 5)).toBeNull()
    expect(percentileOf([], 1)).toBeNull()
    expect(percentileOf(undefined, 1)).toBeNull()
    expect(percentileOf([1, 2], null)).toBeNull()
  })
})

describe('latestValue', () => {
  const rows = [
    { date: 'a', vix: 15 },
    { date: 'b', vix: 16 },
    { date: 'c', vix: null },
  ]

  it('takes the last non-null value, not the last row', () => {
    expect(latestValue(rows, 'vix')).toBe(16)
  })

  it('returns null when the metric is absent everywhere', () => {
    expect(latestValue(rows, 'nope')).toBeNull()
    expect(latestValue([], 'vix')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/percentile.test.js`
Expected: FAIL — cannot resolve `./percentile`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/pages/breadth/percentile.js`:

```js
const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * Where `value` sits in `values`, as the percentage of observations at or below
 * it. Null when there are fewer than two comparable points — a percentile drawn
 * from one observation would read as an extreme when it only means there is
 * nothing to compare against.
 */
export function percentileOf(values, value) {
  if (!isNum(value)) return null
  const nums = (values ?? []).filter(isNum)
  if (nums.length < 2) return null
  return Math.round((nums.filter(v => v <= value).length / nums.length) * 100)
}

/** Last non-null value of `key`, so a metric that lags a day still reports. */
export function latestValue(rows, key) {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    if (isNum(rows[i]?.[key])) return rows[i][key]
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/percentile.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/percentile.js app/src/pages/breadth/percentile.test.js
git commit -m "Breadth charts: percentile helper for the metric readout"
```

---

### Task 8: PresetRow — core pills plus grouped popover

**Files:**
- Create: `app/src/pages/breadth/PresetRow.jsx`
- Create: `app/src/pages/breadth/PresetRow.module.css`
- Test: `app/src/pages/breadth/PresetRow.test.jsx`

**Interfaces:**
- Consumes: `CHART_PRESETS`, `PRESET_GROUP_ORDER` from Task 4.
- Produces: `<PresetRow presets activePreset onApply />` where `activePreset` is a preset id or null and `onApply` receives the whole preset object. Task 10 mounts it.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/PresetRow.test.jsx`:

```jsx
// app/src/pages/breadth/PresetRow.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PresetRow from './PresetRow'

const PRESETS = [
  { id: 'health', label: 'Market Health', hint: 'the daily read', metrics: ['a'] },
  { id: 'thrust', label: 'Breadth Thrust', hint: 'ignition', metrics: ['b'] },
  { id: 'froth', label: 'Froth', group: 'Momentum', hint: 'late-move heat', metrics: ['c'] },
  { id: 'risk', label: 'Risk Appetite', group: 'Leadership', hint: 'who is bought', metrics: ['d'] },
]
const ORDER = ['Leadership', 'Momentum']

const setup = (props = {}) =>
  render(<PresetRow presets={PRESETS} groupOrder={ORDER} activePreset={null} onApply={() => {}} {...props} />)

describe('PresetRow', () => {
  it('shows ungrouped presets as pills and hides grouped ones behind More', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Market Health' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Breadth Thrust' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Froth/ })).toBeNull()
  })

  it('applies a preset from a pill', () => {
    const onApply = vi.fn()
    setup({ onApply })
    fireEvent.click(screen.getByRole('button', { name: 'Market Health' }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[0])
  })

  it('opens the popover in declared group order and applies from it', () => {
    const onApply = vi.fn()
    setup({ onApply })
    const trigger = screen.getByRole('button', { name: /More/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const headings = screen.getAllByRole('presentation').map(n => n.textContent)
    expect(headings).toEqual(['Leadership', 'Momentum'])

    fireEvent.click(screen.getByRole('option', { name: /Risk Appetite/ }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[3])
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows each hint so the popover explains what it is offering', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.getByText('who is bought')).toBeTruthy()
  })

  it('closes on Escape and on an outside click', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /More/ })

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // The band must never look like nothing is selected just because the active
  // preset lives behind More.
  it('names the active preset on the trigger when it lives in the popover', () => {
    setup({ activePreset: 'risk' })
    expect(screen.getByRole('button', { name: 'More: Risk Appetite' })).toBeTruthy()
  })

  it('marks the active pill and leaves the trigger plain', () => {
    setup({ activePreset: 'health' })
    expect(screen.getByRole('button', { name: 'Market Health' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/PresetRow.test.jsx`
Expected: FAIL — cannot resolve `./PresetRow`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/pages/breadth/PresetRow.module.css`:

```css
/* No flex-wrap: sixteen presets must not silently become a second chrome band.
   Overflow has to fail visibly instead. */
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.label {
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-right: 4px;
}

.btn {
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}

.btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-accent);
  color: var(--text-bright);
}

.btnActive {
  background: var(--ut-gold);
  border-color: var(--ut-gold);
  color: #000;
  font-weight: 600;
  box-shadow: 0 0 8px var(--ut-gold-glow);
}

/* .btn:hover is (0,2,0) — this needs the same weight to win. */
.btnActive:hover {
  background: var(--ut-gold);
  border-color: var(--ut-gold);
  color: #000;
}

.more {
  position: relative;
  margin-left: auto;
}

.panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 30;
  min-width: 280px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  list-style: none;
  margin: 0;
}

.group {
  padding: 8px 10px 4px;
  font-family: var(--font-sans);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-sans);
}

.item:hover { background: var(--bg-hover); }

.itemLabel { display: block; font-size: 12px; color: var(--text-bright); }
.itemHint  { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.itemActive .itemLabel { color: var(--ut-gold); font-weight: 600; }
```

Create `app/src/pages/breadth/PresetRow.jsx`:

```jsx
import { useState, useRef, useEffect } from 'react'
import UIcon from '../../components/ui/UIcon'
import styles from './PresetRow.module.css'

/**
 * Sixteen presets in one chrome band: one-click pills for the presets without a
 * `group`, and everything else behind a More popover grouped by `groupOrder`.
 * Promoting a preset between the two tiers is adding or removing its `group`.
 */
export default function PresetRow({ presets, groupOrder, activePreset, onApply }) {
  const [open, setOpen] = useState(false)
  const moreRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const onDown = e => { if (!moreRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const core = presets.filter(p => !p.group)
  const grouped = presets.filter(p => p.group)
  const activeInMore = grouped.find(p => p.id === activePreset)

  function apply(preset) {
    onApply(preset)
    setOpen(false)
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>Presets</span>

      {core.map(p => (
        <button
          key={p.id}
          type="button"
          title={p.hint}
          aria-pressed={activePreset === p.id}
          className={`${styles.btn} ${activePreset === p.id ? styles.btnActive : ''}`}
          onClick={() => apply(p)}
        >
          {p.label}
        </button>
      ))}

      {grouped.length > 0 && (
        <div className={styles.more} ref={moreRef}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className={`${styles.btn} ${activeInMore ? styles.btnActive : ''}`}
            onClick={() => setOpen(o => !o)}
          >
            {activeInMore ? `More: ${activeInMore.label}` : 'More'}
            <UIcon name="chevron-down" size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />
          </button>

          {open && (
            <ul className={styles.panel} role="listbox">
              {groupOrder
                .filter(g => grouped.some(p => p.group === g))
                .map(g => (
                  <li key={g}>
                    <div className={styles.group} role="presentation">{g}</div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {grouped.filter(p => p.group === g).map(p => (
                        <li key={p.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={activePreset === p.id}
                            className={`${styles.item} ${activePreset === p.id ? styles.itemActive : ''}`}
                            onClick={() => apply(p)}
                          >
                            <span className={styles.itemLabel}>{p.label}</span>
                            <span className={styles.itemHint}>{p.hint}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/PresetRow.test.jsx`
Expected: PASS, 7 tests. If `UIcon` has no `chevron-down`, check the available names in `app/src/components/ui/UIcon.jsx` and use the nearest existing one rather than adding an icon — the house rule is UIcon only, never a generic emoji or inline glyph.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/PresetRow.jsx app/src/pages/breadth/PresetRow.module.css app/src/pages/breadth/PresetRow.test.jsx
git commit -m "Breadth charts: preset row with core pills and a grouped More popover"
```

---

### Task 9: MetricReadout — value and percentile

**Files:**
- Create: `app/src/pages/breadth/MetricReadout.jsx`
- Create: `app/src/pages/breadth/MetricReadout.module.css`
- Test: `app/src/pages/breadth/MetricReadout.test.jsx`

**Interfaces:**
- Consumes: `percentileOf`, `latestValue` (Task 7), `resolveColors`, `LABEL_MAP` (Tasks 1 and 3).
- Produces: `<MetricReadout rows selected hidden onToggle />` where `rows` are the visible rows in date order, `hidden` is a `Set` of hidden metric keys, and `onToggle(key)` fires on a row click. Task 10 mounts it.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/MetricReadout.test.jsx`:

```jsx
// app/src/pages/breadth/MetricReadout.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MetricReadout from './MetricReadout'

const rows = [
  { date: '2026-08-01', vix: 14, pct_above_50sma: 30 },
  { date: '2026-08-02', vix: 18, pct_above_50sma: 40 },
  { date: '2026-08-03', vix: 22, pct_above_50sma: 50 },
  { date: '2026-08-04', vix: 20, pct_above_50sma: 60 },
]

const setup = (props = {}) =>
  render(<MetricReadout rows={rows} selected={['vix']} hidden={new Set()} onToggle={() => {}} {...props} />)

describe('MetricReadout', () => {
  it('shows the label, the latest value, and its percentile in the window', () => {
    setup()
    expect(screen.getByText('VIX')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('75th')).toBeTruthy()
  })

  // The window is the point: a value extreme over a year can be ordinary this
  // month, and the readout must describe what is on screen.
  it('computes the percentile from the visible rows only', () => {
    render(<MetricReadout rows={rows.slice(2)} selected={['vix']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('50th')).toBeTruthy()
  })

  it('shows a dash rather than inventing a percentile it cannot compute', () => {
    render(<MetricReadout rows={[rows[0]]} selected={['vix']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('handles a metric with no data at all', () => {
    render(<MetricReadout rows={rows} selected={['naaim']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('toggles a series when its row is clicked', () => {
    const onToggle = vi.fn()
    setup({ onToggle })
    fireEvent.click(screen.getByRole('button', { name: /VIX/ }))
    expect(onToggle).toHaveBeenCalledWith('vix')
  })

  it('marks a hidden series so the row reflects the chart', () => {
    setup({ hidden: new Set(['vix']) })
    expect(screen.getByRole('button', { name: /VIX/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('gives each series the same colour the chart uses', () => {
    render(<MetricReadout rows={rows} selected={['pct_above_50sma', 'vix']} hidden={new Set()} onToggle={() => {}} />)
    const swatches = document.querySelectorAll('[data-swatch]')
    expect(swatches).toHaveLength(2)
    expect(swatches[0].getAttribute('data-swatch')).not.toBe(swatches[1].getAttribute('data-swatch'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/breadth/MetricReadout.test.jsx`
Expected: FAIL — cannot resolve `./MetricReadout`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/pages/breadth/MetricReadout.module.css`:

```css
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 2px 0 10px;
}

.item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  border: 0;
  background: none;
  padding: 2px 0;
  cursor: pointer;
  font-family: var(--font-sans);
}

.hidden { opacity: 0.4; }

.swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  align-self: center;
}

.name  { font-size: 12px; color: var(--text); }
.value { font-size: 12px; color: var(--text-bright); font-weight: 600; }
.pct   { font-size: 11px; color: var(--text-muted); }
```

Create `app/src/pages/breadth/MetricReadout.jsx`:

```jsx
import { useMemo } from 'react'
import { LABEL_MAP, resolveColors } from './chartMetrics'
import { percentileOf, latestValue } from './percentile'
import styles from './MetricReadout.module.css'

const ORDINAL = n => {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const format = v => (v == null ? '—' : v % 1 === 0 ? String(v) : v.toFixed(2))

/**
 * Replaces the ECharts legend: the same swatch and label, plus the latest value
 * and where it sits in the visible window. A line's shape says what happened;
 * the percentile says whether it is unusual, which is the question the chart is
 * being asked.
 */
export default function MetricReadout({ rows, selected, hidden, onToggle }) {
  const colors = useMemo(() => resolveColors(selected), [selected])

  const items = useMemo(() => selected.map(key => {
    const value = latestValue(rows, key)
    return {
      key,
      label: LABEL_MAP[key] ?? key,
      value,
      pct: percentileOf(rows.map(r => r[key]), value),
    }
  }), [rows, selected])

  return (
    <div className={styles.strip}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          aria-pressed={!hidden.has(item.key)}
          className={`${styles.item} ${hidden.has(item.key) ? styles.hidden : ''}`}
          onClick={() => onToggle(item.key)}
        >
          <span
            className={styles.swatch}
            data-swatch={colors[item.key]}
            style={{ background: colors[item.key] }}
          />
          <span className={styles.name}>{item.label}</span>
          <span className={styles.value}>{format(item.value)}</span>
          <span className={styles.pct}>{item.pct == null ? '—' : ORDINAL(item.pct)}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/breadth/MetricReadout.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/MetricReadout.jsx app/src/pages/breadth/MetricReadout.module.css app/src/pages/breadth/MetricReadout.test.jsx
git commit -m "Breadth charts: metric readout with value and window percentile"
```

---

### Task 10: Wire everything into BreadthCharts

**Files:**
- Modify: `app/src/pages/BreadthCharts.jsx`
- Modify: `app/src/pages/BreadthCharts.module.css`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: the assembled page. No new exports.

- [ ] **Step 1: Replace the preset row with `PresetRow`**

Import `PresetRow` and `PRESET_GROUP_ORDER`. Replace the `<div className={styles.presetRow}>…</div>` block at `BreadthCharts.jsx:319` with:

```jsx
        <PresetRow
          presets={CHART_PRESETS}
          groupOrder={PRESET_GROUP_ORDER}
          activePreset={activePreset}
          onApply={applyPreset}
        />
```

Delete `.presetRow`, `.presetLabel`, `.presetBtn`, `.presetBtnActive`, and `.presetBtnActive:hover` from `BreadthCharts.module.css` — they now live in `PresetRow.module.css`.

- [ ] **Step 2: Apply the widening window in `applyPreset`**

Extend `applyPreset` so a preset can only ever widen the window:

```jsx
  function applyPreset(preset) {
    setSelectedOverride(preset.metrics)
    setExtremesOverride(
      Object.fromEntries((preset.extremes ?? []).map(g => [g, true])),
    )
    // Only ever widens, and never touches `toDate` — a preset must not narrow
    // what the reader framed.
    if (preset.minWindowDays) {
      const earliest = offsetDate(-preset.minWindowDays)
      setFromDate(prev => (earliest < prev ? earliest : prev))
    }
  }
```

`offsetDate` computes from today rather than from `toDate`; that matches how the initial range is built at `BreadthCharts.jsx:59-60` and keeps the change to one line.

- [ ] **Step 3: Colour, scale, lines, and FTD markers in the chart option**

Replace the positional colour at `BreadthCharts.jsx:156`. Above the `series` map add:

```jsx
    const colors = resolveColors(selected)
```

and change `itemStyle` to:

```jsx
      itemStyle: { color: colors[key] },
```

Delete the now-unused `PALETTE` constant.

Add the visible extent per family, then the reference lines, after the `series` map:

```jsx
    // resolveLines suppresses a line that would expand an auto-framed axis, so
    // it needs the extent of what is actually on screen.
    const extentOf = unit => {
      const values = selected
        .filter(k => unitOf(k) === unit)
        .flatMap(k => rows.map(r => r[k]))
        .filter(v => typeof v === 'number' && Number.isFinite(v))
      return values.length ? [Math.min(...values), Math.max(...values)] : null
    }

    const refLines = resolveLines(selected, preset?.lines, extentOf)
    if (refLines.length) {
      series.push({
        name: '__ref_lines__',
        type: 'line',
        data: [],
        yAxisIndex: refLines[0].axis,
        silent: true,
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          label: { formatter: p => p.data.label, color: '#706b5e', fontSize: 10, position: 'insideEndTop' },
          lineStyle: { color: '#4a4d3f', type: 'dashed', width: 1 },
          data: refLines.map(l => ({ yAxis: l.at, label: l.label })),
        },
      })
    }
```

`preset` is the active preset object: add `const preset = CHART_PRESETS.find(p => p.id === activePreset)` beside `activePreset`.

> Reference lines all sit on `refLines[0].axis`. Every preset in Task 4 declares lines for a single family, so this holds; the Task 5 test that every line has a series of its family is what keeps it true. If a future preset declares lines across two families, split this into one series per axis.

Add FTD markers, gated on a toggle:

```jsx
    if (showFtd) {
      const marks = ftdMarkers(rows)
      if (marks.length) {
        series.push({
          name: '__ftd__',
          type: 'line',
          data: [],
          yAxisIndex: 0,
          silent: true,
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            lineStyle: { color: '#a78bfa', type: 'dotted', width: 1, opacity: 0.7 },
            label: {
              formatter: p => (p.data.showLabel ? 'FTD' : ''),
              color: '#a78bfa',
              fontSize: 10,
              rotate: 0,
              position: 'insideEndTop',
            },
            data: marks.map(m => ({ xAxis: m.date, showLabel: m.label })),
          },
        })
      }
    }
```

- [ ] **Step 4: Per-family axis framing**

Replace the two `yAxis` entries at `BreadthCharts.jsx:276-297` so each carries its family's framing:

```jsx
      yAxis: [
        {
          type: 'value',
          name: leftUnit ? UNIT_LABEL[leftUnit] : '',
          nameTextStyle: axisNameStyle,
          scale: scaleForUnit(leftUnit),
          ...(extremesAxis === 0 ? EXTREMES_BAND : {}),
          axisLine: { lineStyle: { color: '#2e3127' } },
          axisTick: { show: false },
          axisLabel: { color: '#706b5e', fontSize: 11 },
          splitLine: { lineStyle: { color: '#22251e' } },
        },
        {
          type: 'value',
          show: hasRight,
          name: rightUnits.map(u => UNIT_LABEL[u]).join(' / '),
          nameTextStyle: axisNameStyle,
          scale: rightUnits.length === 1 && scaleForUnit(rightUnits[0]),
          ...(extremesAxis === 1 ? EXTREMES_BAND : {}),
          axisLine: { lineStyle: { color: '#2e3127' } },
          axisTick: { show: false },
          axisLabel: { color: '#706b5e', fontSize: 11 },
          splitLine: { show: false },
        },
      ],
```

The right axis only auto-frames when a single family is on it. Two families already share a compromised axis, and framing to their union would not help either.

- [ ] **Step 5: Swap the legend for the readout**

Change the `legend` block at `BreadthCharts.jsx:234` to `show: false`, keeping `data` so the component and its selection state survive:

```jsx
      legend: {
        show: false,
        data: selected.map(key => LABEL_MAP[key] ?? key),
      },
```

Change `grid` to reclaim the strip: `grid: { left: 64, right: hasRight ? 64 : 24, top: 24, bottom: 56 }`.

Add state and a ref for the chart instance, and mount the readout directly above `<ReactECharts>`:

```jsx
  const chartRef = useRef(null)
  const [hidden, setHidden] = useState(() => new Set())

  function toggleSeries(key) {
    const name = LABEL_MAP[key] ?? key
    chartRef.current?.getEchartsInstance().dispatchAction({ type: 'legendToggleSelect', name })
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
```

```jsx
        <MetricReadout rows={rows} selected={selected} hidden={hidden} onToggle={toggleSeries} />
```

Pass `ref={chartRef}` to `<ReactECharts>`.

- [ ] **Step 6: Add the FTD toggle**

Beside the existing extremes controls, add a checkbox bound to `showFtd`, which is derived from prefs the same way `selected` and `notableExtremes` are — read from `stored`, overridden by local state, and written back through the same 600 ms debounce. Default off. Extend the `stored` memo to carry it:

```jsx
      ftd: saved.ftd === true,
```

and the persisted payload to `{ selected, extremes: notableExtremes, ftd: showFtd }`.

- [ ] **Step 7: Run the whole front-end suite**

Run: `cd app && npm test`
Expected: PASS. Then `cd app && npm run lint` — expected: clean. Watch specifically for `react-hooks/set-state-in-effect`; the stored-vs-override pattern already in this file exists to avoid it, so follow it rather than adding an effect.

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/BreadthCharts.jsx app/src/pages/BreadthCharts.module.css
git commit -m "Breadth charts: wire presets v2 into the page"
```

---

### Task 11: Live-surface verification

**Files:** none committed. A temporary preview entry is created and deleted.

Both round-one defects passed 45 green tests and were only visible in a browser. This task is not optional.

- [ ] **Step 1: Capture real rows**

```bash
curl -s "https://uctintelligence.com/api/breadth-monitor?days=400" -o /tmp/breadth.json
```

- [ ] **Step 2: Serve them from a stub API on :8000**

A local backend is a dead end here: `C:\data` exists on this box, so `breadth_monitor._db_path()` resolves to a 0-row `/data/breadth_monitor.db`, and writing to `C:\data` is blocked by the permission classifier. Serve the captured JSON instead on port 8000, which `vite.config.js` already proxies `/api` to, so no config edit is needed. The stub must also answer the preferences endpoints from memory.

- [ ] **Step 3: Mount the component without auth**

Create a temporary `app/preview-breadth.html` plus `app/src/preview-breadth.jsx` that render `<BreadthCharts />` directly, skipping `AuthGuard`. Run `npm run dev`.

**Read the actual port from the vite log.** Another vite instance commonly holds `:5173`, so this one may come up on `:5174`; curling the wrong port hits someone else's server.

- [ ] **Step 4: Check the five things the tests cannot see**

Wait about 20 seconds after each preset click before judging — ECharts line animation takes 15–20 s in a throttled tab, and a screenshot taken immediately shows ~5 % of the line drawn and looks exactly like a data bug.

1. `setup-supply` — is `new_52w_highs` readable against `near_52w_high`, or pinned to the floor? This is the tightest same-family pair at 2.1×.
2. `risk-appetite` — do both spread series show their own shape on the auto-framed axis?
3. `highs-lows`, `trend-regime`, `thrust` — is the deterioration line now red?
4. FTD markers with `from` set before 2026-04-08 — is the April cluster one label rather than seven?
5. `ad-line` — does applying it widen the window to 365 days, and does the zero line appear? Then narrow to 90 days and confirm the zero line disappears rather than dragging the axis back to zero.

- [ ] **Step 5: Delete the preview scaffold**

```bash
rm app/preview-breadth.html app/src/preview-breadth.jsx
git status --short   # must show nothing but intended changes
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/breadth-presets-v2
```

Do **not** push to master. Shipping is a separate, explicitly approved step, and the dashboard's deploy window is ≥4:20 PM ET or <9:15 AM ET.

---

## Self-Review

**Spec coverage.** §1 catalog → Task 1. §2 families → Task 1. §3 framing → Tasks 2 and 10.4. §4 presets → Task 4. §5 preset row → Tasks 8 and 10.1. §6 colour → Tasks 3 and 10.3. §7 lines → Tasks 5 and 10.3. §8 FTD → Tasks 6 and 10.3/10.6. §9 window → Tasks 4 and 10.2. §10 readout → Tasks 7, 9, and 10.5. §11 tests 1–9 → Tasks 1–5; tests 10–11 → Task 3; test 12 → Task 5; test 13 → Task 6; test 14 → Task 4 and Task 10; test 15 → Task 7. Live-surface pass → Task 11.

**Placeholders.** None: every code step carries the code, every test step the assertions.

**Type consistency.** `scaleForUnit` (Task 2) is used verbatim in Tasks 5 and 10. `resolveColors` (Task 3) in Tasks 9 and 10. `resolveLines(selected, lines, extentOf)` (Task 5) matches the Task 10 call. `ftdMarkers(rows)` (Task 6) returns `{date, label}`, consumed as `m.date`/`m.label` in Task 10. `percentileOf`/`latestValue` (Task 7) match their Task 9 use. `PresetRow` props match Task 10's mount. `MetricReadout` props match Task 10's mount.

**Known gap, deliberate.** Test 14's window assertion is split: the preset-declaration half is Task 4, the never-narrows behaviour is exercised in Task 10 Step 2 and confirmed in Task 11 Step 4.5 rather than by a unit test, because it lives in `applyPreset` inside the page component. If Task 10 grows a component test, move it there.
