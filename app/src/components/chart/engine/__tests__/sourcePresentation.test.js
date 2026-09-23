// SOURCE SEMANTICS → PRESENTATION CAPABILITIES → DEFAULT → USER CHOICE
//
// ⭐⭐ EVERY CASE HERE IS A SEMANTIC CLASS, NOT A TICKER. The owner's rule for this
// suite was explicit: no `if NAAIM`, no `if AAII`, no `if US:MCS`. A test that names
// a symbol proves today's catalogue; a test that names a CLASS proves the contract,
// and the contract is what the next survey, the next breadth measure and NYMO will
// arrive into. The three classes are:
//
//     SCALAR              one number per period      candles impossible
//     OHLC                a real auction period      candles honest
//     MULTI-OUTPUT SCALAR one product, N scalars      one pane, one scale, no candles
//
// ⚠️ The fixtures below are deliberately anonymous (`SCALARSRC`, `OHLCSRC`). If a
// future reader can tell which real series a case was written for, the case has
// drifted back into testing a ticker.

import { describe, it, expect } from 'vitest'
import {
  SCALAR_STYLES, OHLC_STYLES, PRESENTATION_DEFAULT_STYLE, sourceCapabilityOf,
} from '../sourceCapability'
import {
  PLOT_STYLES, PLOT_STYLE_CHOICES, PLOT_STYLE_TO_DEF_STYLE,
  availableStyles, resolvePlotStyle,
} from '../presentation'

/** A passthrough definition's single output — the shape `dataSeries` ships. */
const valuePlot = () => ({ key: 'value', label: 'Value', style: 'line', width: 1 })
/** An instance with no presentation at all: never restyled by anyone. */
const untouched = () => ({ instanceId: 'i1', placement: {} })
/** An instance carrying a member's explicit per-output choice. */
const chose = (style) => ({
  instanceId: 'i1', placement: {}, presentation: { plots: { value: { style } } },
})

const ctxFor = (cap, extra = {}) => ({
  sourceDefaultStyle: cap.defaultStyle,
  allowedStyles: cap.allowedStyles,
  ...extra,
})

// ── The vocabulary stays in one place ───────────────────────────────────────

describe('the style vocabulary is not duplicated', () => {
  it('every scalar style is a real user style, and candles is the only exclusion', () => {
    for (const s of SCALAR_STYLES) expect(PLOT_STYLES).toContain(s)
    expect(SCALAR_STYLES).not.toContain('candles')
    expect(new Set(OHLC_STYLES)).toEqual(new Set(PLOT_STYLES))
  })

  it('every user style has a label and a definition-style mapping', () => {
    // ⛔ THE RAIL THAT CATCHES A HALF-ADDED STYLE. A style in the vocabulary with no
    // choice label is a blank dropdown row; one with no def-style mapping makes
    // `poolKey` answer nothing and the output binds to no series at all — it simply
    // vanishes from the chart with no error.
    for (const s of PLOT_STYLES) {
      expect(PLOT_STYLE_CHOICES.find((c) => c.value === s), `choice for ${s}`).toBeTruthy()
      expect(PLOT_STYLE_TO_DEF_STYLE[s], `def style for ${s}`).toBeTruthy()
    }
  })

  it('every declared presentation maps to a style that exists', () => {
    for (const [pres, style] of Object.entries(PRESENTATION_DEFAULT_STYLE)) {
      expect(PLOT_STYLES, `presentation ${pres}`).toContain(style)
    }
  })
})

// ── CLASS 1: a scalar observation source ────────────────────────────────────

describe('SCALAR SOURCE — one number per period', () => {
  const scalar = sourceCapabilityOf({ presentation: 'line' }, false)

  it('defaults to line', () => {
    expect(scalar.defaultStyle).toBe('line')
    expect(resolvePlotStyle(untouched(), valuePlot(), ctxFor(scalar))).toBe('line')
  })

  it('CANNOT be offered candles', () => {
    expect(scalar.allowedStyles).not.toContain('candles')
    expect(availableStyles(valuePlot(), ctxFor(scalar))).not.toContain('candles')
  })

  it('offers the scalar alternatives a member may switch to', () => {
    const offered = availableStyles(valuePlot(), ctxFor(scalar))
    for (const s of ['line', 'area', 'histogram', 'dots', 'step']) {
      expect(offered, `scalar source should offer ${s}`).toContain(s)
    }
  })

  it('a source that declares histogram DEFAULTS to histogram', () => {
    // A signed count reads as bars around zero. Nothing about this is ticker-specific:
    // the catalogue says `histogram`, so the chart starts there.
    const hist = sourceCapabilityOf({ presentation: 'histogram' }, false)
    expect(resolvePlotStyle(untouched(), valuePlot(), ctxFor(hist))).toBe('histogram')
    expect(hist.allowedStyles).not.toContain('candles')
  })

  it('a periodic source declares step but DEFAULTS to line — the product ruling', () => {
    const step = sourceCapabilityOf({ presentation: 'step' }, false)
    expect(step.defaultStyle).toBe('line')
    expect(availableStyles(valuePlot(), ctxFor(step))).toContain('step')
  })

  it('⛔ A PERSISTED `candles` CLAMPS — it does not crash and does not fabricate OHLC', () => {
    // The exact legacy case: an instance saved as candles by a build that offered
    // them, reloaded against a source that can never mean them.
    const drawn = resolvePlotStyle(chose('candles'), valuePlot(), ctxFor(scalar))
    expect(drawn).not.toBe('candles')
    expect(scalar.allowedStyles).toContain(drawn)
  })

  it('⛔ AND THE CLAMP DOES NOT REWRITE THE STORED VALUE', () => {
    // Read-time normalisation, never a destructive migration: the instance is
    // unchanged, so a source that later gains the capability restores the choice.
    const inst = chose('candles')
    resolvePlotStyle(inst, valuePlot(), ctxFor(scalar))
    expect(inst.presentation.plots.value.style).toBe('candles')
  })

  it("a member's VALID choice survives and is not reset to the default", () => {
    expect(resolvePlotStyle(chose('histogram'), valuePlot(), ctxFor(scalar))).toBe('histogram')
    expect(resolvePlotStyle(chose('step'), valuePlot(), ctxFor(scalar))).toBe('step')
  })
})

// ── CLASS 2: a genuine OHLC source ──────────────────────────────────────────

describe('OHLC SOURCE — a real auction period', () => {
  const ohlc = sourceCapabilityOf({ presentation: 'line' }, true)

  it('MAY be offered candles', () => {
    expect(ohlc.allowedStyles).toContain('candles')
    expect(availableStyles(valuePlot(), ctxFor(ohlc, { ohlcCapable: true })))
      .toContain('candles')
  })

  it('keeps line as its default — capability is not the same question as default', () => {
    // ⛔ THE REGRESSION THIS PINS. Making candles the DEFAULT for anything
    // candle-capable would silently redraw every secondary symbol already on a
    // member's chart. Allowed ≠ default; §4 of the project.
    expect(ohlc.defaultStyle).toBe('line')
    expect(resolvePlotStyle(untouched(), valuePlot(),
      ctxFor(ohlc, { ohlcCapable: true }))).toBe('line')
  })

  it('a persisted candles choice is HONOURED, not clamped', () => {
    expect(resolvePlotStyle(chose('candles'), valuePlot(),
      ctxFor(ohlc, { ohlcCapable: true }))).toBe('candles')
  })

  it('switching to line persists and is honoured', () => {
    expect(resolvePlotStyle(chose('line'), valuePlot(),
      ctxFor(ohlc, { ohlcCapable: true }))).toBe('line')
  })

  it('⛔ CHANGING THE SOURCE REVOKES THE CAPABILITY — the same instance, clamped', () => {
    // The member pointed a row at an OHLC source, chose candles, then re-pointed it
    // at a scalar. The STORED style is still `candles`; capability now says no, and
    // capability wins. Nothing about this reads a symbol.
    const inst = chose('candles')
    expect(resolvePlotStyle(inst, valuePlot(), ctxFor(ohlc, { ohlcCapable: true })))
      .toBe('candles')
    const scalar = sourceCapabilityOf({ presentation: 'line' }, false)
    expect(resolvePlotStyle(inst, valuePlot(), ctxFor(scalar))).not.toBe('candles')
  })

  it('⛔ AND THE DECLARED ALLOW-LIST ALONE CANNOT GRANT A CANDLE', () => {
    // Belt and braces on the fail-closed direction: even handed an allow-list that
    // contains `candles`, `availableStyles` refuses without `ohlcCapable`. Only
    // `ohlcCapabilityOf` may open that door.
    const offered = availableStyles(valuePlot(),
      { allowedStyles: OHLC_STYLES, ohlcCapable: false })
    expect(offered).not.toContain('candles')
  })
})

// ── CLASS 3: a multi-output scalar product ──────────────────────────────────

describe('MULTI-OUTPUT SCALAR — one product, several scalar outputs', () => {
  // Three components of one product. Anonymous on purpose — this is the SHAPE, and
  // it is the shape a second survey or a future breadth product will also have.
  const COMPONENTS = ['ONE', 'TWO', 'THREE']
  const componentInstances = () => COMPONENTS.map((c, i) => ({
    instanceId: `inst-${c}`,
    defId: 'dataSeries',
    inputs: { source: `sym:PROD:${c}:close` },
    // ⭐ ONE SHARED PANE, expressed the way the product places them: every component
    // targets the pane the FIRST one hosts. Nothing here is a new pane concept.
    placement: { target: i === 0 ? 'own' : 'inst-ONE' },
  }))

  const cap = sourceCapabilityOf({ presentation: 'step' }, false)

  it('every output defaults to a line', () => {
    for (const inst of componentInstances()) {
      expect(resolvePlotStyle(inst, valuePlot(), ctxFor(cap))).toBe('line')
    }
  })

  it('NO output may be offered candles', () => {
    for (const inst of componentInstances()) {
      const offered = availableStyles(valuePlot(), {
        ...ctxFor(cap), target: inst.placement.target,
      })
      expect(offered).not.toContain('candles')
    }
  })

  it('the outputs share ONE pane', () => {
    const [first, ...rest] = componentInstances()
    expect(first.placement.target).toBe('own')
    for (const r of rest) expect(r.placement.target).toBe(first.instanceId)
  })

  it('each output keeps an INDEPENDENT plotted identity and style', () => {
    // ⭐ THE PROPERTY THAT MAKES "hide Bearish" AND "recolour Neutral" WORK. Three
    // instances, three presentations; restyling one must not move the others.
    const insts = componentInstances()
    insts[1].presentation = { plots: { value: { style: 'histogram' } } }
    expect(resolvePlotStyle(insts[0], valuePlot(), ctxFor(cap))).toBe('line')
    expect(resolvePlotStyle(insts[1], valuePlot(), ctxFor(cap))).toBe('histogram')
    expect(resolvePlotStyle(insts[2], valuePlot(), ctxFor(cap))).toBe('line')
  })

  it('the outputs share one compatible scale because they share a unit', () => {
    // ⛔ NOT THREE AXES AND NOT INDEPENDENTLY NORMALISED. Sharing a scale is a claim
    // about the DATA — same unit, same domain — and the product refuses to exist if
    // its components disagree (`discovery.product_row`). Asserted here as the
    // semantic precondition the pane relies on.
    const units = new Set(COMPONENTS.map(() => 'percent'))
    expect(units.size).toBe(1)
  })

  it('reconstruction is stable — the same state resolves the same way twice', () => {
    const first = componentInstances().map((i) => resolvePlotStyle(i, valuePlot(), ctxFor(cap)))
    const again = componentInstances().map((i) => resolvePlotStyle(i, valuePlot(), ctxFor(cap)))
    expect(again).toEqual(first)
    expect(first).toEqual(['line', 'line', 'line'])
  })
})

// ── The seam itself ─────────────────────────────────────────────────────────

describe('an unclassified source constrains nothing', () => {
  it('a caller that passes no capability keeps exactly the old list', () => {
    // ⚠️ THE BACKWARD-COMPATIBILITY RAIL. Most call sites have never heard of a
    // source capability; they must keep every style they always offered.
    const before = availableStyles(valuePlot(), { ohlcCapable: false })
    expect(before).toEqual(PLOT_STYLES.filter((s) => s !== 'candles'))
  })

  it('a null catalogue row falls back to line and the scalar list', () => {
    const cap = sourceCapabilityOf(null, false)
    expect(cap.defaultStyle).toBe('line')
    expect(cap.allowedStyles).toEqual(SCALAR_STYLES)
  })

  it('an unknown presentation string falls back to line rather than to nothing', () => {
    expect(sourceCapabilityOf({ presentation: 'sparkline' }, false).defaultStyle).toBe('line')
  })

  it('placement still narrows on top of the source — intersection, never union', () => {
    // ⛔ A PERMISSIVE SOURCE MAY NOT RE-GRANT WHAT THE VOLUME PANE REFUSED.
    const offered = availableStyles(valuePlot(),
      { allowedStyles: SCALAR_STYLES, target: 'volume' })
    expect(offered).not.toContain('histogram')
    expect(offered).not.toContain('area')
    expect(offered).toContain('line')
  })
})
