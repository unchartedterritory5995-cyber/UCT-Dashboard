/* The Fibonacci level system.
 *
 * ⛔ THE MODEL IS THE THING UNDER TEST, not the pixels. A Fib's configuration
 * has to survive a level being added to the canonical table, a default colour
 * changing, a reload, an export/import round trip and an anchor drag — and a
 * sparse override map is the shape that does. Most of what follows is about
 * that: what a drawing stores, what it does NOT store, and that a drawing which
 * has never been configured is indistinguishable from the shipped tool.
 */
import { describe, it, expect } from 'vitest'
import {
  FIB_COLORS, FIB_EXT_COLORS, FIB_EXT_LEVELS, FIB_LEVELS, RESET_FIB_STYLE,
  bandKey, bandState, bandsFor, colorsFor, dashForLevel, defaultBandColor,
  fibLevelPrice, hasFibOverrides, isFib, levelKey, levelPriceOf, levelsFor,
  resolveBands, resolveLevels, withBand, withLevel,
} from './drawingFib'
import { alertKindFor, anchorsForDrawing, boundIdFor, parseBoundId } from './drawingAlertAnchors'

const fib = (extra = {}) => ({ type: 'fib', points: [{ price: 100 }, { price: 200 }], ...extra })
const ext = (extra = {}) => ({ type: 'fibext', points: [{ price: 100 }, { price: 200 }], ...extra })

// ═══════════════════════════════════════════════════════════════════════════
describe('keys — canonical, never a float comparison', () => {
  it('⛔ FLOAT NOISE RESOLVES TO THE SAME KEY', () => {
    // `0.1 + 0.2 !== 0.3`. A level looked up by float equality would silently
    // miss and read as "unconfigured", so the user's override would appear and
    // disappear depending on how the number was arrived at.
    expect(levelKey(0.5)).toBe('0.5')
    expect(levelKey(0.1 + 0.4)).toBe('0.5')
    expect(levelKey(0.30000000000000004)).toBe('0.3')
    expect(levelKey(0.6180000000001)).toBe('0.618')
  })

  it('writes whole numbers without decoration', () => {
    expect(levelKey(0)).toBe('0')
    expect(levelKey(1)).toBe('1')
    expect(levelKey(2)).toBe('2')
    expect(levelKey(1.272)).toBe('1.272')
  })

  it('refuses a non-number rather than inventing a key', () => {
    for (const bad of [null, undefined, NaN, 'x', {}]) expect(levelKey(bad)).toBe('')
  })

  it('⭐ A BAND KEY IS ORDER-FREE, so a caller cannot create two of the same band', () => {
    expect(bandKey(0.5, 0.618)).toBe('0.5>0.618')
    expect(bandKey(0.618, 0.5)).toBe('0.5>0.618')
    expect(bandKey(0, 0.236)).toBe('0>0.236')
  })

  it('the bands a tool offers are its ADJACENT canonical pairs', () => {
    expect(bandsFor('fib')).toHaveLength(FIB_LEVELS.length - 1)
    expect(bandsFor('fibext')).toHaveLength(FIB_EXT_LEVELS.length - 1)
    expect(bandsFor('fib')[0]).toEqual([0, 0.236])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⛔ A DRAWING WITH NO OVERRIDES IS THE SHIPPED TOOL', () => {
  it('resolves the canonical table, colours and dashes', () => {
    const rows = resolveLevels(fib())
    expect(rows.map((r) => r.level)).toEqual([...FIB_LEVELS])
    expect(rows.map((r) => r.color)).toEqual([...FIB_COLORS])
    expect(rows.every((r) => r.visible)).toBe(true)
  })

  it('…and the extension table for the extension tool', () => {
    const rows = resolveLevels(ext())
    expect(rows.map((r) => r.level)).toEqual([...FIB_EXT_LEVELS])
    expect(rows.map((r) => r.color)).toEqual([...FIB_EXT_COLORS])
  })

  it('⚰️ the dash ladder is the shipped one', () => {
    // Retracement: 0 and 1 solid, everything between dashed. Extension adds a
    // longer dash for anything past 1.
    expect(dashForLevel('fib', 0)).toEqual([])
    expect(dashForLevel('fib', 1)).toEqual([])
    expect(dashForLevel('fib', 0.618)).toEqual([4, 3])
    expect(dashForLevel('fibext', 1.618)).toEqual([6, 3])
    expect(dashForLevel('fibext', 0.618)).toEqual([4, 3])
  })

  it('⛔ AND IT PAINTS NO BANDS, because the shipped tool had none', () => {
    expect(resolveBands(fib())).toEqual([])
    expect(resolveBands(fib({ fills: {} }))).toEqual([])
    expect(hasFibOverrides(fib())).toBe(false)
  })

  it('an unknown fib-ish type still resolves the retracement table', () => {
    expect(resolveLevels({ type: 'fib' }).length).toBe(FIB_LEVELS.length)
    expect(levelsFor('anything')).toBe(FIB_LEVELS)
    expect(colorsFor('fibext')).toBe(FIB_EXT_COLORS)
    expect(isFib('fib')).toBe(true)
    expect(isFib('fibext')).toBe(true)
    expect(isFib('trendline')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('overrides — sparse, and they stay sparse', () => {
  it('hides one level and leaves the rest inheriting', () => {
    const levels = withLevel(fib(), 0.382, { visible: false })
    expect(levels).toEqual({ 0.382: { visible: false } })
    const rows = resolveLevels(fib({ levels }))
    expect(rows.find((r) => r.level === 0.382).visible).toBe(false)
    expect(rows.filter((r) => r.visible)).toHaveLength(FIB_LEVELS.length - 1)
    expect(rows.find((r) => r.level === 0.5).color).toBe(FIB_COLORS[3])
  })

  it('recolours one level and leaves the rest inheriting', () => {
    const levels = withLevel(fib(), 0.618, { color: '#ff5b5b' })
    const rows = resolveLevels(fib({ levels }))
    expect(rows.find((r) => r.level === 0.618).color).toBe('#ff5b5b')
    expect(rows.find((r) => r.level === 0.786).color).toBe(FIB_COLORS[5])
  })

  it('⭐ AN OVERRIDE EQUAL TO THE DEFAULT IS DROPPED, not stored', () => {
    // Otherwise clicking a switch twice would leave the object permanently
    // larger, saying nothing.
    const hidden = withLevel(fib(), 0.5, { visible: false })
    expect(hidden).toEqual({ 0.5: { visible: false } })
    const backOn = withLevel(fib({ levels: hidden }), 0.5, { visible: true })
    expect(backOn).toBeNull()
  })

  it('keeps a colour when visibility is restored, and vice versa', () => {
    let levels = withLevel(fib(), 0.5, { color: '#ff5b5b' })
    levels = withLevel(fib({ levels }), 0.5, { visible: false })
    expect(levels).toEqual({ 0.5: { color: '#ff5b5b', visible: false } })
    levels = withLevel(fib({ levels }), 0.5, { visible: true })
    expect(levels).toEqual({ 0.5: { color: '#ff5b5b' } })
  })

  it('does not mutate the drawing it was handed', () => {
    const d = fib({ levels: { 0.5: { visible: false } } })
    const before = JSON.stringify(d.levels)
    withLevel(d, 0.618, { color: '#fff' })
    expect(JSON.stringify(d.levels)).toBe(before)
  })

  it('⭐ ADDING A CANONICAL LEVEL LATER NEEDS NO MIGRATION', () => {
    // The point of the sparse model: a drawing that has never mentioned a level
    // inherits whatever the table says, including one that did not exist when it
    // was saved.
    const saved = fib({ levels: { 0.618: { color: '#ff5b5b' } } })
    const rows = resolveLevels(saved)
    expect(rows).toHaveLength(FIB_LEVELS.length)          // the CURRENT table
    expect(rows.find((r) => r.level === 0.618).color).toBe('#ff5b5b')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('bands — between two levels, independent of either line', () => {
  it('is painted only when enabled and coloured', () => {
    const fills = withBand(fib(), 0.5, 0.618, { enabled: true, color: '#3f7fe033' })
    expect(fills).toEqual({ '0.5>0.618': { enabled: true, color: '#3f7fe033' } })
    expect(resolveBands(fib({ fills }))).toEqual([
      { from: 0.5, to: 0.618, key: '0.5>0.618', color: '#3f7fe033' },
    ])
  })

  it('⛔ HIDING A BOUNDARY LINE DOES NOT DESTROY THE BAND', () => {
    // Line visibility and band visibility are separate facts about separate
    // things. Conflating them makes a styling click destructive.
    const fills = withBand(fib(), 0.5, 0.618, { enabled: true, color: '#3f7fe033' })
    const levels = withLevel(fib(), 0.618, { visible: false })
    const d = fib({ fills, levels })
    expect(resolveBands(d)).toHaveLength(1)
    expect(resolveLevels(d).find((r) => r.level === 0.618).visible).toBe(false)
  })

  it('disabling a band removes its entry rather than storing a false', () => {
    const on = withBand(fib(), 0.5, 0.618, { enabled: true, color: '#111' })
    expect(withBand(fib({ fills: on }), 0.5, 0.618, { enabled: false })).toBeNull()
  })

  it('bands render in table order, whatever order they were configured in', () => {
    let fills = withBand(fib(), 0.618, 0.786, { enabled: true, color: '#111' })
    fills = withBand(fib({ fills }), 0, 0.236, { enabled: true, color: '#222' })
    expect(resolveBands(fib({ fills })).map((b) => b.from)).toEqual([0, 0.618])
  })

  it('⭐ A NEW BAND IS BORN THE COLOUR OF ITS LOWER LEVEL, at a low alpha', () => {
    // A toggle whose effect waits on a second decision reads as broken.
    expect(defaultBandColor(fib(), 0.382)).toBe(`${FIB_COLORS[2]}26`)
    // …and it follows a recoloured level.
    const levels = withLevel(fib(), 0.382, { color: '#ff5b5b' })
    expect(defaultBandColor(fib({ levels }), 0.382)).toBe('#ff5b5b26')
  })

  it('bandState reports what the editor should show', () => {
    expect(bandState(fib(), 0.5, 0.618).enabled).toBe(false)
    const fills = withBand(fib(), 0.5, 0.618, { enabled: true, color: '#abcdef80' })
    expect(bandState(fib({ fills }), 0.618, 0.5)).toEqual({ enabled: true, color: '#abcdef80' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('prices — one function, three callers', () => {
  it('a retracement reads from the HIGH downward, whichever way it was drawn', () => {
    // So the numbers do not flip when somebody draws bottom-up.
    expect(fibLevelPrice('fib', 0, 100, 200)).toBe(200)
    expect(fibLevelPrice('fib', 1, 100, 200)).toBe(100)
    expect(fibLevelPrice('fib', 0.5, 100, 200)).toBe(150)
    expect(fibLevelPrice('fib', 0.5, 200, 100)).toBe(150)      // order-free
    expect(fibLevelPrice('fib', 0.618, 100, 200)).toBeCloseTo(138.2, 6)
  })

  it('an extension is DIRECTIONAL, because "162% of this move" needs a direction', () => {
    expect(fibLevelPrice('fibext', 0, 100, 200)).toBe(100)
    expect(fibLevelPrice('fibext', 1, 100, 200)).toBe(200)
    expect(fibLevelPrice('fibext', 1.618, 100, 200)).toBeCloseTo(261.8, 6)
    // Drawn downward, the extension projects downward.
    expect(fibLevelPrice('fibext', 1.618, 200, 100)).toBeCloseTo(38.2, 6)
  })

  it('refuses a degenerate or unresolvable swing', () => {
    expect(fibLevelPrice('fib', 0.5, 100, 100)).toBeNull()
    expect(fibLevelPrice('fibext', 0.5, 100, 100)).toBeNull()
    expect(fibLevelPrice('fib', 0.5, null, 200)).toBeNull()
    expect(levelPriceOf({ type: 'fib', points: [{ price: 1 }] }, 0.5)).toBeNull()
  })

  it('reads a level straight off a stored drawing', () => {
    expect(levelPriceOf(fib(), 0.5)).toBe(150)
    expect(levelPriceOf(ext(), 1.618)).toBeCloseTo(261.8, 6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('reset — removes overrides, materialises nothing', () => {
  it('returns the drawing to inheriting', () => {
    expect(RESET_FIB_STYLE).toEqual({ levels: null, fills: null })
    const d = fib({ ...RESET_FIB_STYLE })
    expect(resolveLevels(d).map((r) => r.color)).toEqual([...FIB_COLORS])
    expect(resolveBands(d)).toEqual([])
    expect(hasFibOverrides(d)).toBe(false)
  })

  it('⛔ IT DOES NOT WRITE THE TABLE ONTO THE DRAWING', () => {
    // "Resetting" into a frozen copy of today's palette is exactly the state
    // this model exists to avoid — the next palette change would leave it behind.
    expect(RESET_FIB_STYLE.levels).toBeNull()
    expect(Array.isArray(RESET_FIB_STYLE.levels)).toBe(false)
  })

  it('is offered only when there is something to reset', () => {
    expect(hasFibOverrides(fib())).toBe(false)
    expect(hasFibOverrides(fib({ levels: {} }))).toBe(false)
    expect(hasFibOverrides(fib({ levels: { 0.5: { visible: false } } }))).toBe(true)
    expect(hasFibOverrides(fib({ fills: { '0>0.236': { enabled: true, color: '#111' } } }))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ PHASE 8 — an alert on ONE level', () => {
  it('a Fib can carry an alert, and it is an ordinary price line', () => {
    // No new alert semantics: a Fibonacci level IS a horizontal price level, and
    // the server already knows how to evaluate one.
    expect(alertKindFor('fib')).toBe('line')
    expect(alertKindFor('fibext')).toBe('line')
    expect(alertKindFor('rect')).toBeNull()
  })

  it('⛔ THE LEVEL IS PART OF THE ALERT IDENTITY, and rides in the bound id', () => {
    expect(boundIdFor('abc-123', 0.618)).toBe('abc-123#0.618')
    expect(boundIdFor('abc-123', 0)).toBe('abc-123#0')
    // A non-level drawing binds by its id alone, exactly as before.
    expect(boundIdFor('abc-123', null)).toBe('abc-123')
  })

  it('parses back to the same drawing and level', () => {
    expect(parseBoundId('abc-123#0.618')).toEqual({ drawingId: 'abc-123', level: 0.618 })
    expect(parseBoundId('abc-123')).toEqual({ drawingId: 'abc-123', level: null })
    // A uuid containing no '#' is untouched; a trailing non-number is not a level.
    expect(parseBoundId('a-b-c#x')).toEqual({ drawingId: 'a-b-c#x', level: null })
    expect(parseBoundId('')).toEqual({ drawingId: '', level: null })
  })

  it('the alert price is DERIVED FROM GEOMETRY, never stored', () => {
    const geom = anchorsForDrawing(fib(), { level: 0.618 })
    expect(geom).toEqual({ alert_type: 'line', target_price: expect.closeTo(138.2, 6) })
  })

  it('⭐ MOVING AN ANCHOR MOVES THE ALERT', () => {
    // The whole of "the alert follows the drawing": the price is recomputed, the
    // signature changes, and the existing resync pushes it.
    const before = anchorsForDrawing(fib(), { level: 0.5 })
    const after = anchorsForDrawing(
      { type: 'fib', points: [{ price: 100 }, { price: 300 }] }, { level: 0.5 },
    )
    expect(before.target_price).toBe(150)
    expect(after.target_price).toBe(200)
  })

  it('an extension level resolves too', () => {
    expect(anchorsForDrawing(ext(), { level: 1.618 }).target_price).toBeCloseTo(261.8, 6)
  })

  it('⛔ STYLE CHANGES DO NOT MOVE THE ALERT', () => {
    // Hiding the level, recolouring it, filling a band around it and resetting
    // the whole style must all leave the price exactly where it was.
    const base = anchorsForDrawing(fib(), { level: 0.618 }).target_price
    const variants = [
      fib({ levels: { 0.618: { visible: false } } }),
      fib({ levels: { 0.618: { color: '#ff5b5b' } } }),
      fib({ fills: { '0.5>0.618': { enabled: true, color: '#111' } } }),
      fib({ ...RESET_FIB_STYLE }),
      fib({ color: '#1ae51a', lineWidth: 4, lineStyle: 'dotted' }),
    ]
    for (const d of variants) {
      expect(anchorsForDrawing(d, { level: 0.618 }).target_price).toBe(base)
    }
  })

  it('a Fib with no level named cannot describe an alert', () => {
    // Guards against a caller reaching the Fib branch through the generic path
    // and silently creating an alert at the first anchor's price.
    expect(anchorsForDrawing(fib(), {})).toBeNull()
    expect(anchorsForDrawing(fib(), { level: null })).toBeNull()
  })

  it('a degenerate Fib cannot describe one either', () => {
    expect(anchorsForDrawing({ type: 'fib', points: [{ price: 100 }, { price: 100 }] }, { level: 0.5 })).toBeNull()
  })

  it('⛔ AND EVERY OTHER TOOL IS UNAFFECTED BY THE LEVEL ARGUMENT', () => {
    const line = { type: 'horizontal', points: [{ price: 412.5 }] }
    expect(anchorsForDrawing(line, {})).toEqual({ alert_type: 'line', target_price: 412.5 })
    expect(anchorsForDrawing(line, { level: 0.618 })).toEqual({ alert_type: 'line', target_price: 412.5 })
  })
})
