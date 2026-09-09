// @vitest-environment jsdom
/* The drawing schema — defaults, versioning, and the three things normalisation
 * is forbidden from doing.
 *
 * ⛔ THE FORBIDDEN-BEHAVIOUR TESTS ARE THE REASON THIS FILE EXISTS. A read-path
 * funnel is a small idea with three large ways to go wrong, and every one of
 * them is silent:
 *   1. touch `points` → `useBoundDrawingAlerts` sees a changed
 *      `geometrySignature` and PATCHes the server for every bound alert of every
 *      user, on page load;
 *   2. write on load → users' drawing libraries get rewritten by a refresh;
 *   3. materialise forward-looking defaults → "never set" becomes
 *      indistinguishable from "explicitly set to the default", permanently,
 *      which is precisely the distinction `sv` was introduced to preserve.
 * None of the three shows up on screen. All three are asserted here.
 */
import { describe, it, expect } from 'vitest'
import {
  SCHEMA_VERSION, DRAWING_DEFAULTS, isLegacyDrawing,
  drawingProp, withDefaults, normalizeDrawing, normalizeDrawings,
} from './drawingSchema'
import { anchorsForDrawing, geometrySignature } from './drawingAlertAnchors'

// A representative legacy (v1) library — one of every shape that carries data
// worth losing, written the way the shipped code writes them today.
const LEGACY = [
  { id: 'a', type: 'trendline', points: [{ time: '2026-01-02', price: 100 }, { time: '2026-02-02', price: 120 }], color: '#c9a84c', lineWidth: 1, lineStyle: 'solid' },
  { id: 'b', type: 'horizontal', points: [{ price: 55.25 }], color: '#1ae51a', lineWidth: 2 },
  { id: 'c', type: 'hray', points: [{ time: '2026-03-01', price: 55.25 }], color: '#60a5fa' },
  { id: 'd', type: 'rect', points: [{ time: '2026-01-02', price: 90 }, { time: '2026-02-02', price: 110 }] },
  { id: 'e', type: 'text', points: [{ time: '2026-01-02', price: 100 }], text: 'note', fontSize: 16, boxWidth: 220 },
  { id: 'f', type: 'measure', points: [{ time: '2026-01-02', price: 100, rawPrice: 100 }, { time: '2026-02-02', price: 118.9 }], barCount: 25 },
  { id: 'g', type: 'advance', points: [{ time: '2026-01-02', price: 100 }, { time: '2026-02-02', price: 130 }], advPct: 30, advHigh: 130, advLow: 95 },
  { id: 'h', type: 'position', points: [{ price: 100 }, { price: 95 }, { price: 115 }] },
  { id: 'i', type: 'fib', points: [{ time: '2026-01-02', price: 90 }, { time: '2026-02-02', price: 110 }] },
  { id: 'j', type: 'channel', points: [{ price: 90 }, { price: 110 }, { price: 95 }], hidden: true },
  { id: 'k', type: 'ray', points: [{ time: '2026-01-02', price: 100, futureBars: 12 }, { time: '2026-01-02', price: 110, futureBars: 30 }] },
  { id: 'l', type: 'trendline', points: [{ time: '2026-01-02', price: 100, paneRelY: 0.85 }, { time: '2026-02-02', price: 90, paneRelY: 0.9 }] },
]

describe('the version stamp', () => {
  it('is 2, and absent means v1', () => {
    expect(SCHEMA_VERSION).toBe(2)
    expect(isLegacyDrawing({ type: 'rect' })).toBe(true)
    expect(isLegacyDrawing({ type: 'rect', sv: 2 })).toBe(false)
  })

  it('is stamped on every normalised drawing', () => {
    for (const d of normalizeDrawings(LEGACY)) expect(d.sv).toBe(SCHEMA_VERSION)
  })

  it('is idempotent — normalising twice returns the SAME object', () => {
    // Not merely "equal". The store's snapshot identity is what React compares
    // to decide whether to re-render every chart on the symbol; a funnel that
    // cloned unconditionally would re-render all of them on every load.
    const once = normalizeDrawings(LEGACY)
    expect(normalizeDrawings(once)).toBe(once)
    expect(normalizeDrawing(once[0])).toBe(once[0])
  })
})

describe('⛔ RULE 1 — normalisation never touches points', () => {
  it('passes the points array through BY REFERENCE', () => {
    const d = LEGACY[0]
    expect(normalizeDrawing(d).points).toBe(d.points)
  })

  it('leaves every point object identical, futureBars and paneRelY included', () => {
    const before = JSON.stringify(LEGACY.map((d) => d.points))
    const after = JSON.stringify(normalizeDrawings(LEGACY).map((d) => d.points))
    expect(after).toBe(before)
  })

  it('⭐ leaves every alert geometrySignature byte-identical', () => {
    // THE assertion this whole module is written around. `anchorsForDrawing`
    // converts a drawing into the alert body the server holds, and
    // `geometrySignature` is the exact string `useBoundDrawingAlerts` diffs to
    // decide whether to PATCH. If normalisation moved a line by one float, every
    // bound alert in the product would resync on page load.
    const opts = { bars: [{ t: '2026-03-01' }], tf: 'D', etOffset: 0 }
    const sig = (d) => geometrySignature(anchorsForDrawing(d, opts))
    const normalised = normalizeDrawings(LEGACY)
    let carriedAlerts = 0
    LEGACY.forEach((d, i) => {
      const before = sig(d)
      expect(sig(normalised[i])).toBe(before)
      if (before) carriedAlerts += 1
    })
    // Guard the guard: if none of the fixtures could carry an alert, the loop
    // above would be comparing '' to '' and proving nothing.
    expect(carriedAlerts).toBeGreaterThan(0)
  })

  it('replaces a MISSING points array with [] and nothing else', () => {
    // News-widget callouts are created with no points and auto-placed later.
    const callout = { id: 'x', type: 'text', calloutRole: 'label', text: 'hi' }
    const n = normalizeDrawing(callout)
    expect(n.points).toEqual([])
    expect(n.text).toBe('hi')
    expect(n.calloutRole).toBe('label')
  })
})

describe('⛔ RULE 3 — forward-looking defaults are NOT materialised', () => {
  it('adds no key beyond sv (and points when it was missing)', () => {
    for (const d of LEGACY) {
      const added = Object.keys(normalizeDrawing(d)).filter((k) => !(k in d))
      expect(added).toEqual(['sv'])
    }
  })

  it('keeps "never set" distinguishable from "set to the default"', () => {
    // ⭐ THE WHOLE POINT OF sv. Phase 4 must be able to default the Horizontal
    // Line price label OFF for drawings that predate it and ON for new ones. If
    // normalisation wrote `showPriceLabel: false` onto legacy drawings, that
    // distinction would be destroyed the first time the user edited anything.
    const untouched = normalizeDrawing({ id: 'a', type: 'horizontal', points: [] })
    const chosen = normalizeDrawing({ id: 'b', type: 'horizontal', points: [], showPriceLabel: false })
    expect('showPriceLabel' in untouched).toBe(false)
    expect('showPriceLabel' in chosen).toBe(true)
    // …while both still RESOLVE to the same rendered value today.
    expect(drawingProp(untouched, 'showPriceLabel')).toBe(false)
    expect(drawingProp(chosen, 'showPriceLabel')).toBe(false)
  })

  it('does not pin a default we have not designed yet', () => {
    const rect = normalizeDrawing(LEGACY[3])
    for (const key of ['fillOpacity', 'fillColor', 'borderColor', 'levels', 'arrowSize', 'labelPos']) {
      expect(key in rect).toBe(false)
    }
  })
})

describe('the defaults table reproduces today’s rendered behaviour', () => {
  it('every default is the constant the shipped renderer already used', () => {
    // These numbers are literals inside drawingRenderers.js. Changing one here
    // changes the chart — which is the entire reason for having one home.
    expect(DRAWING_DEFAULTS.fillOpacity).toBe(0.08)   // renderRect / renderCircle
    expect(DRAWING_DEFAULTS.arrowSize).toBe(10)       // renderArrow → drawArrowhead
    expect(DRAWING_DEFAULTS.fontSize).toBe(13)        // renderText fallback
    expect(DRAWING_DEFAULTS.lineWidth).toBe(1)        // redraw's `d.lineWidth || 1`
    expect(DRAWING_DEFAULTS.lineStyle).toBe('solid')
  })

  it('nothing new is switched on: every show* flag is off except showBars', () => {
    // ⛔ PHASE 0 MUST NOT LIGHT ANYTHING UP. showBars is `true` because
    // renderMeasure already prints "N bars" whenever barCount is set — turning
    // it off would be the behaviour change, not leaving it on.
    expect(DRAWING_DEFAULTS.showPriceLabel).toBe(false)
    expect(DRAWING_DEFAULTS.showPercentChange).toBe(false)
    expect(DRAWING_DEFAULTS.showDollar).toBe(false)
    expect(DRAWING_DEFAULTS.showPercent).toBe(false)
    expect(DRAWING_DEFAULTS.showTime).toBe(false)
    expect(DRAWING_DEFAULTS.bold).toBe(false)
    expect(DRAWING_DEFAULTS.italic).toBe(false)
    expect(DRAWING_DEFAULTS.bgEnabled).toBe(false)
    expect(DRAWING_DEFAULTS.borderEnabled).toBe(false)
    expect(DRAWING_DEFAULTS.showBars).toBe(true)
  })

  it('"follow the parent" is null, not a duplicated colour', () => {
    expect(DRAWING_DEFAULTS.borderColor).toBeNull()
    expect(DRAWING_DEFAULTS.fillColor).toBeNull()
    expect(DRAWING_DEFAULTS.fontFamily).toBeNull()
    expect(DRAWING_DEFAULTS.levels).toBeNull()
    expect(DRAWING_DEFAULTS.pane).toBeNull()
  })

  it('the table is frozen — no caller can mutate the defaults for everyone', () => {
    expect(Object.isFrozen(DRAWING_DEFAULTS)).toBe(true)
  })
})

describe('drawingProp — resolving one value', () => {
  it('prefers the drawing’s own value', () => {
    expect(drawingProp({ fillOpacity: 0.5 }, 'fillOpacity')).toBe(0.5)
  })

  it('falls back to the table when the key is absent', () => {
    expect(drawingProp({}, 'fillOpacity')).toBe(0.08)
  })

  it('respects an explicit null — "follow the parent" is a real choice', () => {
    // A user who resets a border colour back to "same as the line" has chosen
    // something. Flattening null to the default would erase that.
    expect(drawingProp({ borderColor: null }, 'borderColor')).toBeNull()
  })

  it('respects an explicit false and an explicit 0', () => {
    expect(drawingProp({ showBars: false }, 'showBars')).toBe(false)
    expect(drawingProp({ fillOpacity: 0 }, 'fillOpacity')).toBe(0)
  })

  it('returns undefined for a key the schema does not know', () => {
    expect(drawingProp({}, 'notAThing')).toBeUndefined()
  })

  it('survives a null drawing', () => {
    expect(drawingProp(null, 'fillOpacity')).toBe(0.08)
  })
})

describe('withDefaults — the resolved view for renderers', () => {
  it('fills every table key without mutating the input', () => {
    const d = { id: 'a', type: 'rect' }
    const v = withDefaults(d)
    expect(v.fillOpacity).toBe(0.08)
    expect(v.id).toBe('a')
    expect(d.fillOpacity).toBeUndefined()
  })

  it('the drawing always wins over the table', () => {
    expect(withDefaults({ lineWidth: 3 }).lineWidth).toBe(3)
  })
})

describe('normalizeDrawings — the list form', () => {
  it('returns the SAME array when nothing needed changing', () => {
    const once = normalizeDrawings(LEGACY)
    expect(normalizeDrawings(once)).toBe(once)
  })

  it('returns a new array, with every element normalised, when anything did', () => {
    const out = normalizeDrawings(LEGACY)
    expect(out).not.toBe(LEGACY)
    expect(out).toHaveLength(LEGACY.length)
    expect(out.every((d) => d.sv === SCHEMA_VERSION)).toBe(true)
  })

  it('preserves order and identity of every field except sv', () => {
    const out = normalizeDrawings(LEGACY)
    out.forEach((d, i) => {
      const { sv, ...rest } = d
      expect(sv).toBe(SCHEMA_VERSION)
      expect(rest).toEqual(LEGACY[i])
    })
  })

  it('passes non-arrays straight through instead of throwing', () => {
    expect(normalizeDrawings(undefined)).toBeUndefined()
    expect(normalizeDrawings(null)).toBeNull()
    expect(normalizeDrawings([])).toEqual([])
  })

  it('survives junk entries without losing the good ones', () => {
    const out = normalizeDrawings([null, LEGACY[0], undefined, 42])
    expect(out[0]).toBeNull()
    expect(out[1].sv).toBe(SCHEMA_VERSION)
    expect(out[3]).toBe(42)
  })
})
