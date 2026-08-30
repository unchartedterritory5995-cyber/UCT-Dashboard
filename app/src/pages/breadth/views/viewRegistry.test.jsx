import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
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
// The cursor contract the container hands every view: `canSeek` is asked before
// paint, `onSeek` on click, and here both answer for any date the fixture rows
// carry — so a view that gates an affordance on `canSeek` still renders it.
const rowDates = new Set(rows.map(r => r.date))
const propsFor = (style) => {
  const options = optionDefaults(style)
  const onSeek = (t) => (typeof t === 'number' ? true : rowDates.has(t))
  const canSeek = (t) => (typeof t === 'number' ? true : rowDates.has(t))
  if (VIEW_CONFIG[style].kind === 'lens') {
    return { rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0, onDrill: () => {},
             onSeek, canSeek, options }
  }
  return {
    currentRow: rows[0], prevRow: rows[3], recentRows: rows.slice(0, 30), rows, rowIdx: 0,
    metrics: METRICS, normalize: () => 62, onDrill: () => {}, onSeek, canSeek,
    signalKey: null, notableKey: null, options,
    pctileByKey: {}, visibleKeys: new Set(METRICS.map(m => m.key)),
  }
}

// ── reading the REAL bundle out of BreadthViews.jsx ──────────────────────────
//
// ⛔ AN AST, NOT A GREP (`lesson_probe_names_must_be_derived_not_typed`): a grep
// for `rowIdx` in that file matches the state hook, the keyboard handler and
// three memo deps before it reaches the bundle.
// `__dirname` does not exist in an ES module — this file is one, and the bare
// reference only ever resolved because vitest's transform happened to leave a
// CJS shim in scope. Derived from `import.meta.url`, which is the module's own
// authority on where it lives.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTAINER = path.join(HERE, '..', 'BreadthViews.jsx')

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

/**
 * 🔴 TWO VIEWS OWNED `marker-{key}`.
 *
 * `PercentileLadderView` and `MetersView` both drew one marker per metric and
 * both called it `marker-{key}`, so a query for `marker-vix` in any document
 * holding both — this rail's own, for one — silently matched whichever mounted
 * first. Every id a view owns is namespaced to that view now
 * (`{style}-{role}` / `{style}-{role}-{key}`), and the property that makes the
 * convention worth having is checked here rather than assumed: no test id is
 * rendered by two different styles.
 *
 * ⛔ DERIVED, NOT A TYPED ROSTER of "the views this feature touched" — a list
 * like that is exactly what goes stale, and it would have to grow an exemption
 * the day a ninth view lands.
 */
/**
 * ⏱️⭐ ONE RENDER MATRIX, READ BY FIVE SWEEPS — the same trick the palette suite
 * below already plays, applied to the structural ones.
 *
 * Five sweeps used to render all sixteen registered styles against the FULL
 * metric board, once EACH: eighty real view trees to ask five questions, and
 * this was the slowest file in the suite by a distance. The renders are the
 * expensive part and they are IDENTICAL between the sweeps — what differs is the
 * question, and a question is a string read.
 *
 * ⛔ THE MATRIX IS RENDERED TWICE PER STYLE, NOT ONCE, AND THAT IS NOT WASTE.
 * The two SWR lenses have a refusal branch and a served branch, and the sweeps
 * genuinely disagreed about which one they wanted: "renders without throwing"
 * and the keyboard rails ran against NO server (the refusal shape — which is
 * exactly the render most likely to divide by a missing number), while the NaN
 * and test-id sweeps ran against a served body. Collapsing to one pass would
 * have made this file faster by making it prove less, which is the one thing it
 * must not do. Every question below is now asked of the pass it was asked of
 * before — and the keyboard rails, which cost nothing extra here, are asked of
 * BOTH, so a button that only exists once the server answers is covered too.
 *
 * ⛔ AND THE PER-ELEMENT `expect` CALLS ARE GONE, replaced by the collect-then-
 * assert-once shape the rest of this file uses. Sixteen boards × ~forty drill
 * targets was ~1,300 assertions to answer one yes/no question, and a failing
 * one names its style and its element either way.
 *
 * ⛔ `cleanup()` INSIDE the loop: live view trees left in one document make
 * every later render slower, for no assertion's benefit.
 */
const NO_SERVER = new Map()
const SERVED_PASS = new Map()

function sweepInto(into) {
  for (const style of STYLES) {
    const Component = VIEW_COMPONENTS[style]
    const fired = []
    const props = { ...propsFor(style), onDrill: (m) => fired.push(m?.key ?? true) }
    const rec = { error: null, html: '', ids: [], buttons: [], fired: null }
    try {
      const { container } = render(<Component {...props} />)
      rec.html = container.innerHTML
      rec.ids = [...container.querySelectorAll('[data-testid]')]
        .map(el => el.getAttribute('data-testid'))
      rec.buttons = [...container.querySelectorAll('[role="button"]')].map(el => ({
        // ⛔ THE ATTRIBUTE'S PRESENCE IS RECORDED SEPARATELY FROM ITS VALUE.
        // `Number(getAttribute(...))` on a MISSING attribute is `Number(null)`
        // === 0, which sails past `>= 0` — this rail passed with every
        // `tabIndex` deleted until it asked the question that can be answered
        // "no".
        has: el.hasAttribute('tabindex'),
        value: Number(el.getAttribute('tabindex')),
      }))
      const btn = container.querySelector('[role="button"]')
      if (btn) {
        fireEvent.keyDown(btn, { key: 'Enter' })
        fireEvent.keyDown(btn, { key: ' ' })
        rec.fired = fired.length
      }
    } catch (err) {
      rec.error = err
    }
    cleanup()
    into.set(style, rec)
  }
}

describe('every registered style, rendered against both server states', () => {
  beforeAll(() => {
    swrState.data = null
    sweepInto(NO_SERVER)
    swrState.data = SERVED
    sweepInto(SERVED_PASS)
    swrState.data = null
  }, 60000)

  it('every style renders with the props bundle its kind receives', () => {
    const threw = []
    for (const [label, pass] of [['no server', NO_SERVER], ['served', SERVED_PASS]]) {
      for (const s of STYLES) {
        const err = pass.get(s)?.error
        if (err) threw.push(`${s} (${label}): ${err.message}`)
      }
    }
    expect(threw, 'these styles threw on render').toEqual([])
    expect(NO_SERVER.size, 'the matrix rendered nothing — this rail proves nothing')
      .toBe(STYLES.length)
  })

  /**
   * ⭐ THE CHEAPEST POSSIBLE STAND-IN FOR OPENING THE PAGE.
   *
   * These are hand-rolled SVG: a coordinate that comes out `NaN` (a null value
   * reaching a scale, a divide by a zero-length window) does not throw, does not
   * warn, and does not fail any assertion about testids or colours — the element
   * is simply not drawn. Every geometry change on this tab risks exactly that,
   * and a blank shape inside a correct-looking panel is the hardest defect here
   * to notice from a test suite.
   */
  it('draws no NaN coordinate into any view', () => {
    const bad = STYLES.filter(s => /\bNaN\b/.test(SERVED_PASS.get(s).html))
    expect(bad, 'these views put a NaN in their markup — something is not drawn').toEqual([])
  })

  /**
   * 🔴 NINE VIEWS DECLARED A BUTTON THAT NO KEYBOARD COULD REACH.
   *
   * Ten hand-written copies of `role="button"` + `aria-label` + `onClick`, and
   * not one carried `tabIndex` or a key handler — so every drill affordance on
   * this tab ANNOUNCED itself to assistive tech as a button and could not be
   * focused, let alone pressed. A `<div role="button">` with no tab stop is
   * worse than a plain div: it promises an action to exactly the users who
   * cannot take it, and there is no OTHER keyboard path to a drill list
   * anywhere on this tab.
   *
   * ⭐ DERIVED OVER EVERY REGISTERED STYLE, so the seventeenth view is covered
   * on the day it lands rather than on the day someone remembers to add it
   * here. `drillProps` in `breadthViewShared.js` is the one grammar; this
   * asserts the PROPERTY, not the helper, so a view that hand-rolls a correct
   * button still passes and one that hand-rolls the old broken shape does not.
   */
  it('gives every button a view declares a tab stop', () => {
    const offenders = []
    let seen = 0
    for (const [label, pass] of [['no server', NO_SERVER], ['served', SERVED_PASS]]) {
      for (const style of STYLES) {
        for (const b of pass.get(style).buttons) {
          seen++
          if (!b.has) offenders.push(`${style} (${label}): a role="button" with no tab stop`)
          else if (!(b.value >= 0)) offenders.push(`${style} (${label}): tabindex ${b.value} — out of the tab order`)
        }
      }
    }
    expect(offenders, 'announced to assistive tech, unreachable by keyboard').toEqual([])
    // ⛔ CONTROL: a sweep over zero buttons passes for the wrong reason.
    expect(seen, 'no view rendered a button — this rail proved nothing').toBeGreaterThan(0)
  })

  it('activates on Enter and on Space, the two keys it claims', () => {
    // ⛔ A TAB STOP ALONE IS HALF THE FIX: focusable and inert is still a
    // button that does nothing. Driven through the container's own drill
    // bridge, per style, so a view that added `tabIndex` and forgot the key
    // handler fails by name.
    const inert = []
    let activated = 0
    for (const [label, pass] of [['no server', NO_SERVER], ['served', SERVED_PASS]]) {
      for (const style of STYLES) {
        const { fired } = pass.get(style)
        if (fired == null) continue
        activated++
        if (fired !== 2) inert.push(`${style} (${label}): a focusable button that answered ${fired} of 2 keys`)
      }
    }
    expect(inert, 'these buttons take focus and do nothing').toEqual([])
    expect(activated, 'no style exercised the key path').toBeGreaterThan(0)
  })

  it('every rendered test id belongs to exactly one style', () => {
    const owners = new Map()
    const clashes = []
    for (const style of STYLES) {
      for (const id of SERVED_PASS.get(style).ids) {
        if (id === 'echart') continue          // the stub at the top of this file
        const prev = owners.get(id)
        if (prev && prev !== style) clashes.push(`${id}: "${prev}" and "${style}"`)
        else owners.set(id, style)
      }
    }
    expect(owners.size, 'no view rendered a test id — this rail proves nothing')
      .toBeGreaterThan(20)
    expect(clashes, 'these ids are ambiguous: a query matches whichever view '
      + 'mounted first').toEqual([])
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
 * ⛔ NO EXEMPTIONS. `NO_PALETTE_OUTPUT = new Set(['events'])` used to sit here,
 * parking the Event Ledger outside the loop below because its fired accent was
 * a hardcoded UT gold. The neutrality was right — a fired event is not a
 * bullish event — but hardcoding made `options.palette` INERT in that lens: the
 * control was on screen, offered four choices, and moved nothing.
 *
 * The accent is `colors.tier.a` now (the palette's own caution tone: neutral,
 * and still the palette's), so the ledger is covered by the same rail as the
 * other fourteen. `EventLedgerView.test.jsx` holds the other half of the
 * ruling — that the accent is never the bull or bear colour.
 */

const uniqueTo = (name) => {
  const others = new Set(Object.entries(PALETTES)
    .filter(([k]) => k !== name).flatMap(([, p]) => paletteColors(p)))
  return paletteColors(PALETTES[name]).filter(c => !others.has(c))
}

describe('every palette-honoring view paints with the palette it was given', () => {
  afterEach(() => { swrState.data = null })

  /**
   * ⏱️ ONE RENDER PASS, READ BY EVERY SWEEP BELOW.
   *
   * Each sweep here is `PALETTE_STYLES x PALETTES` real renders of real view
   * trees — sixty of them — and there are three questions to ask of that
   * matrix. Rendering it once PER QUESTION put this file at ~42s and pushed an
   * UNRELATED test in it past the 5s default timeout under a loaded fork pool:
   * green alone, red in company. The matrix is built once; the questions are
   * string reads.
   *
   * ⛔ `cleanup()` INSIDE the loop, not after it. Sixty live view trees left
   * in one document make every later render slower, which is the same failure by
   * a slower road.
   */
  const painted = new Map()
  const key = (style, palette) => `${style}@${palette}`
  beforeAll(() => {
    swrState.data = SERVED
    for (const palette of Object.keys(PALETTES)) {
      for (const style of PALETTE_STYLES) {
        const Component = VIEW_COMPONENTS[style]
        const { container } = render(
          <Component {...propsFor(style)} options={{ ...optionDefaults(style), palette }} />)
        painted.set(key(style, palette), container.innerHTML.toLowerCase())
        cleanup()
      }
    }
    swrState.data = null
  }, 60000)

  it('the ocean palette has colours no other palette can produce', () => {
    // Without this the loop below could pass on a colour every palette shares.
    expect(OCEAN_ONLY).toContain(PALETTES.ocean.bull.toLowerCase())   // #22d3ee
    expect(OCEAN_ONLY).toContain(PALETTES.ocean.tier.g3.toLowerCase())  // #0891b2
  })

  /**
   * 🔴 A BORROWED TONE IS INVISIBLE TO THE LOOP BELOW — AND TO THE USER.
   *
   * `ocean.tier.a` was `#fbbf24`, classic's amber, copied verbatim. For a view
   * that paints several tiers that is merely untidy; for the Event Ledger,
   * whose ONLY palette-sourced colour is the caution tone, it meant classic and
   * ocean rendered byte-identically. `OCEAN_ONLY` excludes any colour another
   * palette also produces, so the loop below would have reported the ledger
   * blind — correctly. The caution tone is per palette now.
   */
  it('no palette borrows another palette caution tone', () => {
    const seen = new Map()
    for (const [name, p] of Object.entries(PALETTES)) {
      const tone = p.tier.a.toLowerCase()
      expect(seen.has(tone), `"${name}" reuses "${seen.get(tone)}" caution tone ${tone} — `
        + 'the Event Ledger accent reads tier.a, so its palette control would be inert')
        .toBe(false)
      seen.set(tone, name)
    }
    expect(seen.size).toBe(Object.keys(PALETTES).length)
  })

  it('renders an OCEAN colour for every view that offers the palette option', () => {
    expect(PALETTE_STYLES.length).toBeGreaterThan(10)
    const blind = []
    for (const style of PALETTE_STYLES) {
      const html = painted.get(key(style, 'ocean'))
      expect(html, `no render captured for ${style}@ocean`).toBeTruthy()
      const hit = OCEAN_ONLY.some(c => html.includes(c) || html.includes(hexToRgb(c)))
      if (!hit) blind.push(style)
    }
    expect(blind, 'these views offer a palette option and ignore it — the '
      + 'Customize control moves nothing on screen').toEqual([])
  })

  /**
   * ⭐ AND THE SAME SWEEP OVER ALL FOUR PALETTES, NOT JUST THE CONVENIENT ONE.
   *
   * Ocean is the palette the loop above uses because it is easy to detect. But
   * the constraint is that a view survives EVERY palette — and `mono` is the one
   * that can catch a hardcoded green or red, because it has neither: its bull is
   * gold and its bear is grey. A visual change that reached for a literal tint
   * would still paint an ocean colour somewhere else on the same view and pass
   * the loop above.
   *
   * ⛔ DERIVED PER PALETTE. Each palette is looked for by the colours no other
   * palette can produce, so a hit can only have come from that palette reaching
   * the view — and a palette that shared everything would fail the guard rather
   * than quietly make its row of the sweep vacuous.
   */
  it('paints in every palette, mono — which has no green and no red — included', () => {
    const blind = []
    for (const palette of Object.keys(PALETTES)) {
      const own = uniqueTo(palette)
      expect(own.length, `"${palette}" shares every colour it has, so this sweep `
        + 'cannot tell whether a view read it').toBeGreaterThan(0)
      for (const style of PALETTE_STYLES) {
        const html = painted.get(key(style, palette))
        if (!own.some(c => html.includes(c) || html.includes(hexToRgb(c)))) blind.push(`${style} @ ${palette}`)
      }
    }
    expect(blind, 'these views render nothing this palette can produce — a hardcoded '
      + 'colour, or a control that moves nothing').toEqual([])
  })

  /**
   * ⭐ AND THE OTHER HALF: NOT PAINTING A COLOUR THE PALETTE CANNOT PRODUCE.
   *
   * 🔴 The sweep above asks whether the chosen palette REACHED the view. It
   * cannot see a view that reads the palette correctly in one place and paints a
   * literal somewhere else — which is exactly what two boards were doing. The
   * Meters track was a hardcoded `linear-gradient(90deg,#14532d,…,#7f1d1d)`, and
   * the Tug's Net Posture line was `#34d399` / `#f87171`: classic's bull and
   * bear, verbatim. Both rendered a green-and-red board under `mono`, a palette
   * with neither colour in it, and both passed the sweep above because their
   * OTHER elements did read the palette. Green alone, red in company.
   *
   * ⛔ THE FORBIDDEN SET IS DERIVED PER PALETTE, never typed: the colours that
   * belong to some OTHER palette and to no other — so a hit cannot be a shared
   * neutral (`tier['']` is `#475569` in all four and is therefore in nobody's
   * set) and cannot be this tab's own chrome.
   */
  it('paints no colour belonging to a palette it was not given', () => {
    const strays = []
    for (const palette of Object.keys(PALETTES)) {
      const foreign = Object.keys(PALETTES)
        .filter(p => p !== palette)
        .flatMap(p => uniqueTo(p).map(c => [p, c]))
      expect(foreign.length, `nothing is unique to a palette other than "${palette}" — vacuous`)
        .toBeGreaterThan(0)
      for (const style of PALETTE_STYLES) {
        const html = painted.get(key(style, palette))
        for (const [owner, c] of foreign) {
          if (html.includes(c) || html.includes(hexToRgb(c))) {
            strays.push(`${style} @ ${palette} painted ${c} (${owner}'s)`)
          }
        }
      }
    }
    expect(strays, 'these views painted a colour their palette does not own — a '
      + 'hardcoded tint that survives every "does the palette reach it" check').toEqual([])
  })

  /**
   * ⭐ THE GUARD WITH NO ROSTER AT ALL: under `mono`, NOTHING MAY BE GREEN OR RED.
   *
   * 🔴 The two sweeps above are both membership tests — "is this palette's
   * colour present", "is another palette's colour present" — and a hardcode that
   * belongs to NO palette sails through both. That is not hypothetical: the
   * Meters track was `linear-gradient(90deg,#14532d,#3f6212,#713f12,#7f1d1d)`, an
   * invented green-to-red ramp owned by nobody, and it painted a green-and-red
   * board under a gold-and-grey palette while every colour rail stayed green.
   * (Mutation-checked: restoring that gradient fails THIS test and no other.)
   *
   * ⛔ SO THE PROPERTY IS ABOUT HUE, NOT MEMBERSHIP. `mono` is the palette
   * defined by what it does not have, which makes it the one palette where the
   * absence of a colour FAMILY is checkable. Anything saturated, in the readable
   * middle of the lightness range, sitting in the green or red arc, was painted
   * by something that is not reading the palette — whatever hex it happens to be.
   *
   * The bounds are deliberately loose: near-black grounds, near-white ink and
   * this tab's desaturated slate chrome are all excluded by construction rather
   * than by being listed, and UT gold (hue ~45) is nowhere near either arc.
   */
  const parseColours = (html) => {
    const out = []
    for (const m of html.matchAll(/#([0-9a-f]{6})(?![0-9a-f]{1,2}[0-9a-f])/g)) {
      const h = m[1]
      out.push([m[0], parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)])
    }
    for (const m of html.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
      out.push([m[0], Number(m[1]), Number(m[2]), Number(m[3])])
    }
    return out
  }
  const hsl = (r, g, b) => {
    const R = r / 255, G = g / 255, B = b / 255
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
    const l = (max + min) / 2
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d !== 0) {
      if (max === R) h = 60 * (((G - B) / d) % 6)
      else if (max === G) h = 60 * ((B - R) / d + 2)
      else h = 60 * ((R - G) / d + 4)
    }
    return [(h + 360) % 360, sat, l]
  }
  const GREEN = (h) => h >= 75 && h <= 165
  const RED = (h) => h >= 335 || h <= 25

  it('paints nothing green and nothing red under mono, which has neither', () => {
    const offenders = []
    for (const style of PALETTE_STYLES) {
      const html = painted.get(key(style, 'mono'))
      for (const [text, r, g, b] of parseColours(html)) {
        const [h, sat, l] = hsl(r, g, b)
        if (sat > 0.25 && l > 0.12 && l < 0.85 && (GREEN(h) || RED(h))) {
          offenders.push(`${style}: ${text} (hue ${Math.round(h)})`)
        }
      }
    }
    expect(offenders, 'these views painted a green or a red under a palette that has '
      + 'neither \u2014 a hardcoded tint that belongs to no palette, so no membership '
      + 'check can see it').toEqual([])
  })

  // The loop above is a sweep; this pins that the ledger is genuinely IN it
  // rather than passing because some other element happened to carry a colour.
  it('covers the Event Ledger with no carve-out', () => {
    expect(PALETTE_STYLES).toContain('events')
    const events = rows.map((r, i) => ({ ...r, new_52w_lows: i === 0 ? 999 : 5 }))
    const draw = (palette) => render(<VIEW_COMPONENTS.events rows={events} currentRow={events[0]}
      prevRow={events[3]} rowIdx={0} onDrill={() => {}}
      options={{ ...optionDefaults('events'), palette }} />).container.innerHTML.toLowerCase()

    const has = (html, hex) => html.includes(hex.toLowerCase()) || html.includes(hexToRgb(hex))
    const ocean = draw('ocean')
    expect(has(ocean, PALETTES.ocean.tier.a)).toBe(true)
    expect(ocean).not.toBe(draw('classic'))
    // …and neutrality survives the change: no bull/bear tone in the output.
    for (const c of [PALETTES.ocean.bull, PALETTES.ocean.bear]) {
      expect(has(ocean, c), `the ledger painted ${c}, a directional tone`).toBe(false)
    }
  })
})
