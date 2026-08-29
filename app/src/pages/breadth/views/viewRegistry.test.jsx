import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// echarts-for-react renders a canvas in jsdom; stub it (same shape as
// TreemapView.test.jsx — the one board view that actually uses it) so the
// rail's real-component renders stay pristine instead of logging ECharts'
// "can't get DOM width/height" warning for a 0×0 jsdom container.
vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-series={JSON.stringify(option?.series?.length ?? 0)} />,
}))

// ScoreAttributionView and AnalogueDeckView call useSWR; this rail renders
// every registered style with no server behind it. The default is the no-data
// shape (their refusal branches render fine, which is exactly the "renders
// without throwing" property this rail checks) — but the palette rail below
// has to get PAST the refusal to see a colour at all, so the body is settable.
const swrState = vi.hoisted(() => ({ data: null }))
vi.mock('swr', () => ({
  default: () => ({ data: swrState.data, isLoading: false, error: null }),
}))

// One body that satisfies both SWR views; the mock ignores the URL.
const SERVED = {
  ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
  components: [
    { key: 'vix', label: 'VIX (inverted)', weight: 10, points: 9, max_points: 10, present: true },
    { key: 'hi_ratio', label: 'High/low ratio', weight: 15, points: 3, max_points: 15, present: true },
  ],
  prev: { date: '2026-08-27', total: 70,
          components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 4,
                         max_points: 10, present: true }] },
  reference_date: '2026-08-28',
  analogues: [
    { date: '2025-03-11', similarity: 92.4, forward_returns: { fwd_20d: 4.5 } },
    { date: '2024-11-02', similarity: 88.1, forward_returns: { fwd_20d: -2.1 } },
  ],
}

import { STYLES, VIEW_CONFIG, optionDefaults, optionsSchema } from './viewMetricConfig'
import { VIEW_COMPONENTS, viewsByKind } from './viewRegistry'
import { PALETTES } from './breadthViewShared'
import { FIRED_ACCENT } from './EventLedgerView'
import { HM_METRICS } from '../heatmapMetrics'

const METRICS = HM_METRICS.filter(m => !m.isHeader)

// 60 synthetic sessions, newest first, with every numeric field the views read.
const mkRows = (n = 60) => Array.from({ length: n }, (_, i) => ({
  date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`,
  breadth_score: 50 + (i % 20), uct_exposure: 60, pct_above_5sma: 40 + (i % 30),
  pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_50sma: 40 + (i % 25),
  pct_above_100sma: 55, pct_above_200sma: 60, up_4pct_today: 30, down_4pct_today: 12,
  up_20pct_5d: 8, down_20pct_5d: 3, up_25pct_quarter: 40, down_25pct_quarter: 10,
  up_50pct_month: 5, down_50pct_month: 2, magna_up: 60, magna_down: 20,
  stage2_count: 300, stage4_count: 90, new_52w_highs: 40, new_52w_lows: 9,
  new_20d_highs: 120, new_20d_lows: 30, new_ath: 20, hvc_52w: 30, atr_ext_7: 12,
  advancing: 3000, declining: 1500, up_from_open: 2800, down_from_open: 1700,
  up_on_volume: 2000, down_on_volume: 1200, adv_decline: 1500, adv_decline_cum: 10000,
  up_vol_ratio: 1.8, ratio_5day: 1.4, ratio_10day: 1.2, hi_ratio: 1.2, lo_ratio: 0.3,
  sp500_close: 5000 + i * 3, qqq_close: 400 + i, spy_day_pct: 0.4, qqq_day_pct: 0.5,
  vix: 15 + (i % 6), vxn: 20, mcclellan_osc: 30 - i, cnn_fear_greed: 55,
  aaii_spread: 5, cboe_putcall: 0.8, universe_count: 5000, near_52w_high: 40,
  rsp_spy_ratio: 0.62, iwm_qqq_ratio: 0.55, is_ftd: 0,
  spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1,
  qqq_above_10sma: 1, qqq_above_20sma: 1, qqq_above_50sma: 1, qqq_above_200sma: 1,
}))

const rows = mkRows()

/**
 * ⚠️ THIS IS A SECOND COPY OF THE BUNDLE `BreadthViews.jsx` ACTUALLY PASSES,
 * and it must track that file. A rail that asserts against its own copy of the
 * contract is asserting nothing about the app: if `BreadthViews` started
 * handing lenses the RAW `rows` instead of `filledRows`, or dropped `rowIdx`,
 * every render below would still be green.
 *
 * ⭐ SO THE COPY IS PINNED TO THE ORIGINAL, by AST, in
 * `describe('the props bundle is the one BreadthViews passes')` below — an
 * added, removed or renamed prop on either side fails by name.
 */
const propsFor = (style) => {
  const options = optionDefaults(style)
  if (VIEW_CONFIG[style].kind === 'lens') {
    return { rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0, onDrill: () => {}, options }
  }
  return {
    currentRow: rows[0], prevRow: rows[3], recentRows: rows.slice(0, 30), rows, rowIdx: 0,
    metrics: METRICS, normalize: () => 62, onDrill: () => {},
    signalKey: null, notableKey: null, options,
    pctileByKey: {}, visibleKeys: new Set(METRICS.map(m => m.key)),
  }
}

// ── reading the REAL bundle out of BreadthViews.jsx ──────────────────────────
//
// ⛔ AN AST, NOT A GREP (`lesson_probe_names_must_be_derived_not_typed`): a grep
// for `rowIdx` in that file matches the state hook, the keyboard handler and
// three memo deps before it reaches the bundle.
const CONTAINER = path.join(__dirname, '..', 'BreadthViews.jsx')

function bundlesFromContainer() {
  const src = fs.readFileSync(CONTAINER, 'utf8').replace(/\r\n/g, '\n')
  const tree = Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  let node = null
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'viewProps') node = n
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c))
      else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(tree)
  if (!node) throw new Error('BreadthViews.jsx no longer declares `viewProps` — this rail cannot read the contract')
  if (node.init?.type !== 'ConditionalExpression') {
    throw new Error('`viewProps` is no longer a kind ternary — re-read it before trusting this rail')
  }
  const readObject = (obj) => {
    if (obj.type !== 'ObjectExpression') throw new Error('a `viewProps` branch is not an object literal')
    return Object.fromEntries(obj.properties.map(pr => [
      pr.key.name ?? pr.key.value,
      src.slice(pr.value.start, pr.value.end),
    ]))
  }
  return { lens: readObject(node.init.consequent), board: readObject(node.init.alternate) }
}

describe('view registry', () => {
  it('every registered style has a component', () => {
    for (const s of STYLES) expect(VIEW_COMPONENTS[s], `missing component for "${s}"`).toBeTruthy()
  })

  it('every registered style declares a kind', () => {
    for (const s of STYLES) expect(['board', 'lens']).toContain(VIEW_CONFIG[s].kind)
  })

  it('every style renders with the props bundle its kind receives', () => {
    for (const s of STYLES) {
      const Component = VIEW_COMPONENTS[s]
      expect(() => render(<Component {...propsFor(s)} />), `"${s}" threw on render`).not.toThrow()
    }
  })

  it('groups styles by kind, preserving STYLES order', () => {
    const { board, lens } = viewsByKind()
    expect(board.length + lens.length).toBe(STYLES.length)
    const order = [...board, ...lens].map(v => v.key)
    expect(new Set(order)).toEqual(new Set(STYLES))
    const boardOrder = board.map(v => v.key)
    expect(boardOrder).toEqual(STYLES.filter(s => VIEW_CONFIG[s].kind === 'board'))
  })

  it('carries a label for every style so the switcher never needs its own list', () => {
    for (const s of STYLES) expect(typeof VIEW_CONFIG[s].label).toBe('string')
  })
})

describe('the props bundle is the one BreadthViews passes', () => {
  const real = bundlesFromContainer()

  it('the lens bundle this rail builds carries exactly the container props', () => {
    expect(Object.keys(real.lens).length, 'the AST read an empty lens bundle').toBeGreaterThan(3)
    const built = propsFor(STYLES.find(s => VIEW_CONFIG[s].kind === 'lens'))
    expect(Object.keys(built).sort()).toEqual(Object.keys(real.lens).sort())
  })

  it('the board bundle this rail builds carries exactly the container props', () => {
    expect(Object.keys(real.board).length).toBeGreaterThan(6)
    const built = propsFor(STYLES.find(s => VIEW_CONFIG[s].kind === 'board'))
    expect(Object.keys(built).sort()).toEqual(Object.keys(real.board).sort())
  })

  // ⛔ THE SPEC IS EXPLICIT: a lens reads the FORWARD-FILLED window (`filledRows`),
  // "so the two kinds can never disagree about what a session's value was".
  // Handing it the raw `rows` prop instead is a one-word edit that no render
  // test on either side of this file could see.
  it('both kinds are fed the FORWARD-FILLED window, never the raw prop', () => {
    expect(real.lens.rows).toBe('filledRows')
    expect(real.board.rows).toBe('filledRows')
  })

  it('the board bundle is a SUPERSET of the lens bundle, as the spec says', () => {
    for (const k of Object.keys(real.lens)) {
      if (k === 'rows') continue
      expect(Object.keys(real.board), `board bundle lost "${k}"`).toContain(k)
    }
  })
})

// ── the palette rail the spec asked for ─────────────────────────────────────
//
// The spec's Testing section requires this registry rail to assert "every view
// honoring `options.palette` produces the palette's color". It did not, and the
// per-view `themingTierViews` / `themingAccentViews` tests name views ONE AT A
// TIME — so all eight new views shipped with zero theming coverage, which is
// the precise gap this rail was supposed to close.

const hexToRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`
const paletteColors = (p) => [p.bull, p.bear, ...Object.values(p.tier)].map(c => c.toLowerCase())

// Derived, not typed: the ocean colours that no other palette also uses, so a
// hit can only have come from `palette: 'ocean'` reaching the view.
const OCEAN_ONLY = (() => {
  const others = new Set(Object.entries(PALETTES)
    .filter(([k]) => k !== 'ocean').flatMap(([, p]) => paletteColors(p)))
  return paletteColors(PALETTES.ocean).filter(c => !others.has(c))
})()

const PALETTE_STYLES = STYLES.filter(s => optionsSchema(s).some(o => o.name === 'palette'))

/**
 * ⛔ ONE EXEMPTION, AND IT IS SELF-CLEANING. The Event Ledger's accent is
 * DELIBERATELY direction-neutral — it reports that a named thing happened and
 * does not grade it, so it has no bull/bear colour to paint (painting one drew
 * *90% Down Volume Day* green). The exemption is therefore paired with a
 * positive claim below: the ledger must render the neutral accent AND be
 * byte-identical across palettes. Wire the palette back into it and that test
 * fails, so the exemption cannot quietly outlive its reason.
 */
const NO_PALETTE_OUTPUT = new Set(['events'])

describe('every palette-honoring view paints with the palette it was given', () => {
  afterEach(() => { swrState.data = null })

  it('the ocean palette has colours no other palette can produce', () => {
    // Without this the loop below could pass on a colour every palette shares.
    expect(OCEAN_ONLY).toContain(PALETTES.ocean.bull.toLowerCase())   // #22d3ee
    expect(OCEAN_ONLY).toContain(PALETTES.ocean.tier.g3.toLowerCase())  // #0891b2
  })

  it('renders an OCEAN colour for every view that offers the palette option', () => {
    expect(PALETTE_STYLES.length).toBeGreaterThan(10)
    swrState.data = SERVED
    const blind = []
    for (const style of PALETTE_STYLES) {
      if (NO_PALETTE_OUTPUT.has(style)) continue
      const Component = VIEW_COMPONENTS[style]
      const { container } = render(
        <Component {...propsFor(style)} options={{ ...optionDefaults(style), palette: 'ocean' }} />)
      const html = container.innerHTML.toLowerCase()
      const hit = OCEAN_ONLY.some(c => html.includes(c) || html.includes(hexToRgb(c)))
      if (!hit) blind.push(style)
    }
    expect(blind, 'these views offer a palette option and ignore it — the '
      + 'Customize control moves nothing on screen').toEqual([])
  })

  it('THE EXEMPTION, PROVEN: the Event Ledger renders the same under any palette', () => {
    const events = rows.map((r, i) => ({ ...r, new_52w_lows: i === 0 ? 999 : 5 }))
    const draw = (palette) => render(<VIEW_COMPONENTS.events rows={events} currentRow={events[0]}
      prevRow={events[3]} rowIdx={0} onDrill={() => {}}
      options={{ ...optionDefaults('events'), palette }} />).container.innerHTML

    const classic = draw('classic')
    expect(classic, 'no event fired, so this fixture proves nothing about the accent')
      .toContain(FIRED_ACCENT)
    expect(draw('ocean')).toBe(classic)
    for (const c of OCEAN_ONLY) expect(classic.toLowerCase()).not.toContain(c)
  })
})
