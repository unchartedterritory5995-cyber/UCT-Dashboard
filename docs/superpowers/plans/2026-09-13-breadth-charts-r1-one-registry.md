# Breadth Data Charts — R1 "one registry" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metric names, drill-down keys and reporting cadence have one source of truth. `chartMetrics.js` is canonical;
`heatmapMetrics.js` builds `HM_METRICS` from it and adds only its own behaviour (tiers, formats, headers, order), and
`HM_METRICS` stays identical for Views, the `/charts` Breadth widget and every existing test.

**Architecture:** A golden serialisation of today's `HM_METRICS`, `TREEMAP_DEF`, `FFILL_KEYS` and `PCTILE_KEYS` is
committed first, green on the current code. `chartMetrics.js` gains `METRIC_META` (`short`, `drillKey`, `cadence`,
`chartable`) for every chart key and every heatmap key; the nine heatmap-only keys join it without joining the picker
(D-034). `heatmapMetrics.js` keeps its layout — group headers, order, `getTier`, `getFmt` — and reads label and drill key
from `METRIC_META`. `WEEKLY_METRICS` and `FFILL_KEYS` derive from `cadence`. The golden test holds the result.

**Tech Stack:** Vitest 4, plain ES modules.

**Spec:** `docs/breadth/01-audit.md` "Registry unification — is it a thin adapter?", A-34 (R); D-011, D-034.

## Global Constraints

- Member-invisible: no label, order, colour, drill key or picker entry changes on any surface.
- One authority per value: a label, drill key or cadence is written once, in `METRIC_META`; consumers derive.
- The Monitor's `COLS` in `Breadth.jsx` stays out of scope (audit).
- The golden file is test data built from code, never from member data (D-018).
- Tests first; own tool call before commit; named paths only; six-shard gate adds no failing test.

---

### Task 1: the golden — pin today's heatmap registry before touching it

**Files:** Create `app/src/pages/breadth/heatmapRegistry.golden.test.js`, `app/src/pages/breadth/heatmapRegistry.golden.json`

- [ ] **Step 1: write the serialiser and generate the golden from the CURRENT code**

```js
// app/src/pages/breadth/heatmapRegistry.golden.test.js
//
// R1 acceptance (audit "Registry unification"): HM_METRICS, TREEMAP_DEF, FFILL_KEYS and
// PCTILE_KEYS serialise identically before and after the registry moves under
// chartMetrics.js. Fields are serialised in a fixed order and functions by source, so
// an object built differently but equal in every field still compares equal.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HM_METRICS, TREEMAP_DEF, FFILL_KEYS, PCTILE_KEYS } from './heatmapMetrics'

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'heatmapRegistry.golden.json')
const FIELDS = ['key', 'label', 'group', 'isHeader', 'drillKey', 'polarity', 'pair', 'getTier', 'getFmt']

export function serialiseRegistry() {
  return {
    HM_METRICS: HM_METRICS.map(m => Object.fromEntries(FIELDS
      .filter(f => m[f] !== undefined)
      .map(f => [f, typeof m[f] === 'function' ? m[f].toString() : m[f]]))),
    TREEMAP_DEF,
    FFILL_KEYS: [...FFILL_KEYS],
    PCTILE_KEYS: [...PCTILE_KEYS].sort(),
  }
}

describe('the heatmap registry is unchanged by R1', () => {
  it('serialises exactly as the golden recorded before the move', () => {
    if (process.env.WRITE_HM_GOLDEN === '1') fs.writeFileSync(GOLDEN, JSON.stringify(serialiseRegistry(), null, 2) + '\n')
    expect(serialiseRegistry()).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')))
  })

  // CONTROL: the comparison sees a one-character label change.
  it('would notice a changed label', () => {
    const s = serialiseRegistry()
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    s.HM_METRICS[1].label += ' '
    expect(s).not.toEqual(golden)
  })
})
```

Generate once on the unchanged tree: `WRITE_HM_GOLDEN=1 npx vitest run src/pages/breadth/heatmapRegistry.golden.test.js`
(PowerShell: `$env:WRITE_HM_GOLDEN='1'`), then run again WITHOUT the variable → PASS.

- [ ] **Step 2:** commit both files — "Breadth registry: pin today's heatmap registry before unifying it (R1)"

---

### Task 2: `METRIC_META` in `chartMetrics.js`

**Produces:** `METRIC_META: Record<key, {short?, drillKey?, cadence?, chartable?}>` · `shortOf(key)` · `drillKeyOf(key)` ·
`cadenceOf(key) → 'daily' | 'weekly'` · `isChartable(key)`; `WEEKLY_METRICS` derived from `cadence`.

- [ ] **Step 1: failing test** `app/src/pages/breadth/chartMetrics.registry.test.js`

```js
// app/src/pages/breadth/chartMetrics.registry.test.js
import { describe, it, expect } from 'vitest'
import {
  ALL_METRICS, LABEL_MAP, METRIC_META, WEEKLY_METRICS,
  shortOf, drillKeyOf, cadenceOf, isChartable,
} from './chartMetrics'
import golden from './heatmapRegistry.golden.json'

const HEATMAP = golden.HM_METRICS.filter(m => !m.isHeader)

describe('METRIC_META is the one authority (R1, D-034)', () => {
  it('describes every chart metric and every heatmap metric', () => {
    const missing = [...new Set([...ALL_METRICS.map(m => m.key), ...HEATMAP.map(m => m.key)])]
      .filter(k => !(k in METRIC_META))
    expect(missing).toEqual([])
  })

  it('carries the heatmap label and drill key exactly as they ship today', () => {
    for (const m of HEATMAP) {
      expect(shortOf(m.key), m.key).toBe(m.label)
      expect(drillKeyOf(m.key), m.key).toBe(m.drillKey)
    }
  })

  it('falls back to the chart label where no heatmap tile exists', () => {
    expect(shortOf('universe_count')).toBe(LABEL_MAP.universe_count)
    expect(drillKeyOf('universe_count')).toBeUndefined()
  })

  it('derives the weekly set from cadence', () => {
    expect([...WEEKLY_METRICS].sort()).toEqual(['aaii_bears', 'aaii_bulls', 'aaii_neutral', 'aaii_spread', 'naaim'])
    expect(cadenceOf('cboe_putcall')).toBe('daily')
  })

  it('marks the composite tiles as not chartable', () => {
    for (const k of ['is_ftd', 'spy_ma_stack', 'qqq_ma_stack']) expect(isChartable(k), k).toBe(false)
    expect(isChartable('advancing')).toBe(true)
  })

  // D-034: joining the catalog is not joining the picker.
  it('adds nothing to the Data Charts picker', () => {
    for (const k of ['advancing', 'declining', 'up_on_volume', 'down_on_volume', 'up_from_open', 'down_from_open']) {
      expect(ALL_METRICS.some(m => m.key === k), k).toBe(false)
    }
  })
})
```

- [ ] **Step 2:** FAIL · **Step 3: implement** in `chartMetrics.js` after `unitOf`, replacing the literal `WEEKLY_METRICS` Set:

```js
// ── Registry (R1, D-011, D-034) ───────────────────────────────────────────────
// One authority for what every breadth metric is called on a compact surface
// (`short` — the heatmap / Views label), where its names drill to (`drillKey`), how
// often it reports (`cadence`) and whether a line can draw it (`chartable`). The
// heatmap builds its tiles from here; the Data Charts picker is CHART_GROUPS and is
// deliberately a separate, smaller list.
const W = 'weekly'
export const METRIC_META = {
  breadth_score: { short: 'Health' },
  uct_exposure: { short: 'UCT Exp' },
  up_4pct_today: { short: 'Up 4%+', drillKey: 'up_4pct_today_list' },
  down_4pct_today: { short: 'Dn 4%+', drillKey: 'down_4pct_today_list' },
  ratio_5day: { short: '5D Ratio' },
  ratio_10day: { short: '10D Ratio' },
  up_20pct_5d: { short: 'Up 20%/5d', drillKey: 'up_20pct_5d_list' },
  down_20pct_5d: { short: 'Dn 20%/5d', drillKey: 'down_20pct_5d_list' },
  up_25pct_quarter: { short: 'Up 25%/Qtr', drillKey: 'up_25pct_quarter_list' },
  down_25pct_quarter: { short: 'Dn 25%/Qtr', drillKey: 'down_25pct_quarter_list' },
  up_25pct_month: {},
  down_25pct_month: {},
  up_50pct_month: { short: 'Up 50%/Mo', drillKey: 'up_50pct_month_list' },
  down_50pct_month: { short: 'Dn 50%/Mo', drillKey: 'down_50pct_month_list' },
  magna_up: { short: 'Up 13%/34d', drillKey: 'magna_up_list' },
  magna_down: { short: 'Dn 13%/34d', drillKey: 'magna_down_list' },
  universe_count: {},
  adv_decline: {},
  adv_decline_cum: {},
  up_vol_ratio: {},
  is_ftd: { short: 'FTD', chartable: false },
  advancing: { short: 'Advancing' },
  declining: { short: 'Declining' },
  up_from_open: { short: 'Up from Open' },
  down_from_open: { short: 'Down from Open' },
  up_on_volume: { short: 'Up on Volume' },
  down_on_volume: { short: 'Down on Volume' },
  pct_above_5sma: { short: '>5 SMA' },
  pct_above_10sma: { short: '>10 SMA' },
  pct_above_20ema: { short: '>20 EMA' },
  pct_above_40sma: { short: '>40 SMA' },
  pct_above_50sma: { short: '>50 SMA' },
  pct_above_100sma: { short: '>100 SMA' },
  pct_above_200sma: { short: '>200 SMA' },
  spy_ma_stack: { short: 'SPY MA', chartable: false },
  qqq_ma_stack: { short: 'QQQ MA', chartable: false },
  sp500_close: { short: 'S&P 500' },
  qqq_close: { short: 'QQQ' },
  vix: { short: 'VIX' },
  mcclellan_osc: { short: 'McClellan' },
  stage2_count: { short: 'Stage 2 (MA Stack)' },
  stage4_count: { short: 'Stage 4 (MA Stack)' },
  rsp_spy_ratio: {},
  iwm_qqq_ratio: {},
  vxn: {},
  avg_10d_vix: {},
  avg_10d_vxn: {},
  new_52w_highs: { short: '52W Highs (Close)', drillKey: 'new_52w_highs_list' },
  new_52w_lows: { short: '52W Lows (Close)', drillKey: 'new_52w_lows_list' },
  new_20d_highs: { short: '20D Highs (Close)', drillKey: 'new_20d_highs_list' },
  new_20d_lows: { short: '20D Lows (Close)', drillKey: 'new_20d_lows_list' },
  new_ath: { short: 'ATH Count (Close)' },
  hvc_52w: { short: 'HVC (52W Vol Hi)', drillKey: 'hvc_52w_list' },
  atr_ext_7: { short: '>7× ATR Ext', drillKey: 'atr_ext_7_list' },
  hi_ratio: {},
  lo_ratio: {},
  near_52w_high: {},
  cnn_fear_greed: { short: 'CNN F/G' },
  aaii_bulls: { cadence: W },
  aaii_neutral: { cadence: W },
  aaii_bears: { cadence: W },
  aaii_spread: { short: 'B-B Spread', cadence: W },
  naaim: { cadence: W },
  cboe_putcall: { short: 'CBOE P/C' },
  avg_10d_cpc: {},
}

export const shortOf = key => METRIC_META[key]?.short ?? LABEL_MAP[key] ?? key
export const drillKeyOf = key => METRIC_META[key]?.drillKey
export const cadenceOf = key => METRIC_META[key]?.cadence ?? 'daily'
export const isChartable = key => METRIC_META[key]?.chartable !== false

export const WEEKLY_METRICS = new Set(Object.keys(METRIC_META).filter(k => cadenceOf(k) === 'weekly'))
```

- [ ] **Step 4:** `npx vitest run src/pages/breadth/chartMetrics.registry.test.js src/pages/breadth/chartMetrics.cadence.test.js src/pages/breadth/chartMetrics.test.js` → PASS
- [ ] **Step 5:** commit — "Breadth registry: one table of short labels, drill keys and cadence (R1)"

---

### Task 3: `heatmapMetrics.js` reads the registry

- [ ] **Step 1:** the golden test is the failing-test guard; add a rail to `heatmapRegistry.golden.test.js`:

```js
import source from './heatmapMetrics.js?raw'

  // One authority: the heatmap file no longer types a label or a drill key.
  it('writes no label or drill key of its own', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const typed = code.match(/\b(label|drillKey)\s*:\s*['"`]/g) ?? []
    // Headers keep their own uppercase captions; nothing else may.
    expect(typed.length).toBe(golden().HM_METRICS.filter(m => m.isHeader).length)
  })
```

(with `const golden = () => JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))`). Run → FAIL (the file types 46 labels and 15 drill keys).

- [ ] **Step 2: implement** — in `heatmapMetrics.js`, import `{ shortOf, drillKeyOf }` from `./chartMetrics`, add

```js
/** A tile: label and drill key from the registry (R1), behaviour from here. */
const tile = (key, group, getTier, getFmt) => {
  const drillKey = drillKeyOf(key)
  return { key, label: shortOf(key), group, ...(drillKey ? { drillKey } : {}), getTier, getFmt }
}
```

and rewrite each non-header entry as `tile('<key>', '<group>', <getTier>, <getFmt>)`, keeping every `getTier`/`getFmt`
arrow exactly as written today (the golden compares their source) and every comment in place. Headers stay literal.
`FFILL_KEYS` becomes `export const FFILL_KEYS = [...WEEKLY_METRICS]` imported from `./chartMetrics` (order checked by the
golden: aaii_bulls, aaii_neutral, aaii_bears, aaii_spread, naaim — `METRIC_META` declares them in that order).

- [ ] **Step 3:** `npx vitest run src/pages/breadth/heatmapRegistry.golden.test.js src/pages/breadth src/pages/charts/widgets/BreadthWidget* src/pages/Breadth*.test.jsx src/pages/InternalsRender*` → PASS
- [ ] **Step 4:** mutation proofs: change one `short` in `METRIC_META` → golden fails; drop one `drillKey` → golden and
  registry tests fail; type a label back into `heatmapMetrics.js` → the one-authority rail fails.
- [ ] **Step 5:** commit — "Breadth registry: the heatmap builds its tiles from the one registry (R1)"

---

### Task 4: gate, merge, verify

- [ ] Six-shard gate vs `gates.md`'s latest set; `reachable` and `pollingSites` names unchanged; record R1.
- [ ] Merge origin/master; overlap check (Views, BreadthWidget, Breadth.jsx are touched by other sessions — re-run the
  golden and Views suites if master changed any of them); watch coverage; guarded push; web SUCCESS.
- [ ] STATUS entry:

> **What members will see.** Nothing changes on screen. Data Charts, Views and the Charts workspace Breadth widget now
> read each metric's short name, drill-down list and reporting cadence from one registry, so a name fixed in one place
> is fixed everywhere.
