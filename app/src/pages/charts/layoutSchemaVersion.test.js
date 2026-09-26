// The workspace layout's SCHEMA VERSION, and the guesswork it retires.
//
// ⚰️ WHY THIS FILE EXISTS. `charts_workspace_layout` carried no version field, so
// `parseLayout` inferred a blob's shape from its geometry. One of those inferences is
// actively dangerous: if every widget sits in the top half of the 20-row grid, the
// `maxBottom` branch decides the board is a pre-viewport-lock legacy save and MULTIPLIES
// every height. D-06 §1.4 recorded it — *"will misfire on any legitimate future layout
// whose widgets all sit in the top half"* — and measured on production 2026-09-25,
// **17 of 29 accounts hold a board and 0 of 17 carried a version field**, so every live
// board was exposed to that guess. C5-03 §5 ruled the stamp in as the bridge before
// Terminal-Next touches this key.
//
// The contract these cases pin:
//   version absent  → legacy. Shape inference MAY run (it is the only way to read those).
//   version >= 1    → the writer stated the shape. Shape inference MUST NOT run.
//   every write     → carries the version, through ONE serializer, with no bypass.
import { describe, it, expect } from 'vitest'
import {
  parseLayout, serializeLayout, LAYOUT_SCHEMA_VERSION,
} from './ChartsWorkspace.jsx'

const FIXED_ROWS = 20
const GRID_COLS = 24

// A board that sits entirely in the top half — the exact shape the `maxBottom`
// heuristic mistakes for a legacy save. maxBottom = 8, which is <= FIXED_ROWS / 2.
const topHalf = (extra = {}) => ({
  widgets: [
    { id: 'w1', type: 'chart', x: 0, y: 0, w: 12, h: 8 },
    { id: 'w2', type: 'watchlist', x: 12, y: 0, w: 6, h: 8 },
  ],
  cols: GRID_COLS,
  ...extra,
})

describe('the version field retires the shape guesswork', () => {
  it('⛔ a VERSIONED top-half board is returned with its heights UNTOUCHED', () => {
    const out = parseLayout(JSON.stringify(topHalf({ version: LAYOUT_SCHEMA_VERSION })))
    expect(out.widgets.map(w => w.h)).toEqual([8, 8])
    expect(out.widgets.map(w => w.y)).toEqual([0, 0])
    // and the member's deliberate arrangement survives on the x axis too
    expect(out.widgets.map(w => [w.x, w.w])).toEqual([[0, 12], [12, 6]])
  })

  it('⭐ CONTROL — the SAME board UNVERSIONED is still auto-fitted, so the case above is not passing because migration is broken', () => {
    const out = parseLayout(JSON.stringify(topHalf()))
    // maxBottom 8 → scale floor(20/8) = 2 → heights double.
    expect(out.widgets.map(w => w.h)).toEqual([16, 16])
    expect(out.widgets[0].h).not.toBe(8)
  })

  it('⛔ a VERSIONED 12-col-looking board is NOT coordinate-doubled', () => {
    const out = parseLayout(JSON.stringify({
      widgets: [{ id: 'w1', type: 'chart', x: 3, y: 0, w: 6, h: 12 }],
      cols: 12, version: LAYOUT_SCHEMA_VERSION,
    }))
    expect(out.widgets[0].x).toBe(3)
    expect(out.widgets[0].w).toBe(6)
    expect(out.cols).toBe(GRID_COLS)
  })

  it('⭐ CONTROL — an UNVERSIONED 12-col board still migrates to 24 by doubling', () => {
    const out = parseLayout(JSON.stringify({
      widgets: [{ id: 'w1', type: 'chart', x: 3, y: 0, w: 6, h: 12 }],
      cols: 12,
    }))
    expect(out.widgets[0].x).toBe(6)
    expect(out.widgets[0].w).toBe(12)
    expect(out.cols).toBe(GRID_COLS)
  })
})

describe('the stamp is present on every read and every write', () => {
  it('parseLayout stamps the current version onto whatever it returns', () => {
    expect(parseLayout(JSON.stringify(topHalf())).version).toBe(LAYOUT_SCHEMA_VERSION)
    expect(parseLayout(JSON.stringify(topHalf({ version: 1 }))).version).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('serializeLayout stamps the version, and a stamped blob round-trips unchanged', () => {
    const once = serializeLayout(topHalf())
    expect(JSON.parse(once).version).toBe(LAYOUT_SCHEMA_VERSION)
    // The round trip is the property that matters: save → load → save is a fixed point,
    // so a board cannot drift by being opened.
    const back = parseLayout(once)
    expect(JSON.parse(serializeLayout(back)).widgets.map(w => w.h)).toEqual([8, 8])
  })

  it('serializeLayout overwrites a stale or hostile version rather than trusting input', () => {
    expect(JSON.parse(serializeLayout(topHalf({ version: 999 }))).version).toBe(LAYOUT_SCHEMA_VERSION)
    expect(JSON.parse(serializeLayout(topHalf({ version: 'nope' }))).version).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('a non-integer version in a STORED blob is treated as legacy, never as versioned', () => {
    // Otherwise `version: "1"` from some future writer would skip migration silently.
    const out = parseLayout(JSON.stringify(topHalf({ version: '1' })))
    expect(out.widgets.map(w => w.h)).toEqual([16, 16])
  })

  it('serializeLayout tolerates null/undefined without throwing on a save path', () => {
    expect(JSON.parse(serializeLayout(null)).version).toBe(LAYOUT_SCHEMA_VERSION)
    expect(JSON.parse(serializeLayout(undefined)).version).toBe(LAYOUT_SCHEMA_VERSION)
  })
})

describe('the version is bumped deliberately, and nothing bypasses the serializer', () => {
  it('LAYOUT_SCHEMA_VERSION is a positive integer', () => {
    expect(Number.isInteger(LAYOUT_SCHEMA_VERSION)).toBe(true)
    expect(LAYOUT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('⛔ NO WRITE SITE SERIALIZES THIS KEY BY HAND — one authority, so the guard is mutation-provable', async () => {
    // `lesson_a_guard_repeated_is_a_guard_unproved`: six call sites each stamping the
    // version would be six copies of one rule and killing one would leave five. The
    // rail is that every site goes through `serializeLayout`.
    const src = await import('./ChartsWorkspace.jsx?raw').then(m => m.default)
    // NON-VACUITY first: the scan must actually see the write sites it is judging.
    const routed = src.match(/setPref\('charts_workspace_layout', serializeLayout\(/g) || []
    expect(routed.length, 'the scan found no routed write sites — it is broken').toBeGreaterThanOrEqual(5)
    const bypass = src.match(/setPref\('charts_workspace_layout',\s*JSON\.stringify\(/g) || []
    expect(bypass, `a write site serializes the layout by hand and will not carry the version`).toEqual([])
  })

  it('⛔ DEFAULT_LAYOUT is born stamped, so a brand-new board is not read as a legacy blob', async () => {
    const src = await import('./ChartsWorkspace.jsx?raw').then(m => m.default)
    const block = src.slice(src.indexOf('const DEFAULT_LAYOUT = {'))
    const decl = block.slice(0, block.indexOf('}') + 1)
    expect(decl).toContain('version: LAYOUT_SCHEMA_VERSION')
  })

  it('⛔ the version constant is declared BEFORE its first use at module scope', async () => {
    // A `const` is in the temporal dead zone until its declaration runs, so
    // DEFAULT_LAYOUT referencing it from above would throw ReferenceError at import
    // and blank the whole /charts route. This caught exactly that during the change.
    const src = await import('./ChartsWorkspace.jsx?raw').then(m => m.default)
    expect(src.indexOf('export const LAYOUT_SCHEMA_VERSION'))
      .toBeLessThan(src.indexOf('const DEFAULT_LAYOUT = {'))
  })
})
