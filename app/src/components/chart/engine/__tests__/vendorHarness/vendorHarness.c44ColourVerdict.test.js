// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c44ColourVerdict.test.js
//
// ─── ⭐⭐ C44 — AN OBJECT'S COLOUR IS PART OF THE HARNESS VERDICT ───────────────
//
// Until C44 `compareObjects` graded an object family on its COUNT and its TEXT.
// A drawing in the wrong colour graded MATCH; C37 counted the colours beside the
// verdict (`colourColumn.js`, a census) and left the question to the integrator.
// The ruling (2026-10-01): colour JOINS the verdict. An object family grades
// MATCH only when the colours of its paired objects agree too.
//
// THE RULE, stated once in `tools/vendor_harness/compare.mjs::objectColourRows`:
//   agree / agreeByDefault        agrees
//   themeRelative                 agrees — `chart.fg_color` / `chart.bg_color` are
//                                 OUR chart's colours, never TradingView's (§ C37)
//   carriedDiffers / notCarried   DIFFERS
//   vendorUndecodable             not graded (the capture's encoding)
//
// WHAT THIS FILE HOLDS:
//   1. the rule itself, state by state, fail-closed on a state it does not name;
//   2. on committed captures: a MATCH is a MATCH that GRADED colours (non-vacuity);
//   3. 🔴 a moved colour turns MATCH into DIVERGE — and the verdict as it was
//      before colour (`verdictWithoutColour`) still says MATCH, so the change is
//      attributable to colour and nothing else;
//   4. 🟢 a theme-relative slot does not: TradingView's theme colour may be any
//      colour at all and the verdict holds — while the SAME move on a slot the
//      script colours itself diverges (the control);
//   5. the option: colour off reproduces the old verdict and the old sentence
//      byte for byte;
//   6. the two committed captures whose verdict colour changes, by name and slot;
//   7. the pairing reads an `na` coordinate as `na` on both sides (a held object
//      nobody can draw still pairs, so its colour is graded and not skipped).
//
// ⛔ SYNTHETIC VARIANTS of a capture are built HERE, in memory, and re-sealed
// (`sealCapture`) — never written under `tests/fixtures/` (that directory holds
// only what was read off the vendor's own screen).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, objectColourGraded } from './harness'
import { pairObjects, vendorColourReader } from './objectColours'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { compareObjects, objectColourRows } from '../../../../../../../tools/vendor_harness/compare.mjs'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: not a capture — ${loaded.reason}`)
  return loaded.capture
}
const clone = (c) => JSON.parse(JSON.stringify(c))

/** A raw vendor colour value that DECODES TO A DIFFERENT COLOUR than `raw`, in
 *  the capture's own encoding (a palette index where the study's colours are
 *  enumerated, a packed 0xAABBGGRR otherwise) — so the moved record is still a
 *  colour the capture can decode, and the move is a colour move and nothing else. */
function otherRawColour(capture, raw) {
  const reader = vendorColourReader(capture)
  const was = reader.read(raw)
  if (!reader.indexed) {
    const cand = [0xff0000ff, 0xff00ff00] // opaque red, opaque green (0xAABBGGRR)
    return cand.find((n) => reader.read(n) !== was)
  }
  const st = capture.study
  const meta = st.palettes && st.palettes.palette_common
  const state = st.paletteState && st.paletteState.palette_common
  const keys = meta && meta.valToIndex ? Object.keys(meta.valToIndex) : Object.keys((state && state.colors) || (meta && meta.colors) || {})
  const hit = keys.map(Number).find((n) => { const c = reader.read(n); return c !== null && c !== was })
  if (hit === undefined) throw new Error('the palette holds no second colour to move to')
  return hit
}
const colourRow = (v, family) => (v.objects.colours || []).find((r) => r.family === `${family} colour`)

describe('C44 — the rule: what each slot state means for the verdict', () => {
  const slot = (kind, state, extra = {}) => ({ kind, slot: 'color', state, vendor: '#111111ff', ours: '#222222ff', where: `${kind} #1`, ...extra })

  it('agree, agreeByDefault and themeRelative agree; carriedDiffers and notCarried differ', () => {
    const rows = objectColourRows({ rows: [
      slot('line', 'agree'), slot('line', 'agreeByDefault'), slot('line', 'themeRelative'),
      slot('label', 'agree'), slot('label', 'carriedDiffers'),
      slot('box', 'notCarried', { slot: 'bgcolor' }),
    ] })
    expect(rows.map((r) => [r.family, r.agree, r.slots, r.agreeing, r.themeRelative, r.differing])).toEqual([
      ['lines colour', true, 3, 3, 1, 0],
      ['labels colour', false, 2, 1, 0, 1],
      ['boxes colour', false, 1, 0, 0, 1],
    ])
    // a differing family NAMES its first slot, both readings and the state
    expect(rows[1].first).toEqual({ slot: 'label.color', state: 'carriedDiffers', vendor: '#111111ff', ours: '#222222ff', where: 'label #1' })
    expect(rows[2].first).toMatchObject({ slot: 'box.bgcolor', state: 'notCarried' })
  })

  it('⛔ a slot the capture cannot decode is NOT graded — and a family with nothing graded claims nothing', () => {
    const rows = objectColourRows({ rows: [slot('cell', 'vendorUndecodable'), slot('table', 'agree'), slot('table', 'vendorUndecodable')] })
    expect(rows).toEqual([
      expect.objectContaining({ family: 'tables colour', agree: true, slots: 2, agreeing: 1, undecodable: 1 }),
      expect.objectContaining({ family: 'tableCells colour', agree: null, slots: 1, agreeing: 0, undecodable: 1 }),
    ])
    expect(objectColourRows({ rows: [] })).toEqual([])
    expect(objectColourRows(null)).toEqual([])
  })

  it('⛔ FAIL CLOSED — a state or a kind this table does not name is never read as agreeing', () => {
    expect(() => objectColourRows({ rows: [slot('line', 'probablyFine')] })).toThrow(/unknown slot state "probablyFine"/)
    expect(() => objectColourRows({ rows: [slot('polyline', 'agree')] })).toThrow(/unknown object kind "polyline"/)
  })

  const V = { counts: { lines: 2, labels: 0, boxes: 0, tables: 0, tableCells: 0 }, texts: { labels: [], tableCells: [] } }
  const O = { ok: true, counts: { ...V.counts }, texts: { labels: [], tableCells: [] } }

  it('counts and texts agree and a colour differs → DIVERGE; the verdict before colour is kept beside it', () => {
    const r = compareObjects(V, O, { rows: [slot('line', 'agree'), slot('line', 'carriedDiffers')], unpaired: { ours: 0, vendor: 0 } })
    expect(r.verdict).toBe('DIVERGE')
    expect(r.verdictWithoutColour).toBe('MATCH')
    expect(r.reason).toBe('object counts and texts agree; 1 object family differs in COLOUR (first: line.color of line #1 — vendor #111111ff, ours #222222ff, carriedDiffers); coordinates are NOT compared by v1')
    // the count / text rows are exactly what they were
    expect(r.counts.filter((c) => c.agree === false)).toEqual([])
  })

  it('every colour agrees → MATCH, and the reason says how many slots were graded', () => {
    const r = compareObjects(V, O, { rows: [slot('line', 'agree'), slot('line', 'themeRelative')], unpaired: { ours: 0, vendor: 0 } })
    expect(r).toMatchObject({ verdict: 'MATCH', verdictWithoutColour: 'MATCH' })
    expect(r.reason).toBe('object counts and texts agree; colours agree on 2 paired slots (1 theme-relative); coordinates are NOT compared by v1')
  })

  it('a count that differs still diverges on its own, colour or no colour', () => {
    const r = compareObjects(V, { ...O, counts: { ...O.counts, lines: 1 } }, { rows: [slot('line', 'agree')], unpaired: { ours: 0, vendor: 1 } })
    expect(r).toMatchObject({ verdict: 'DIVERGE', verdictWithoutColour: 'DIVERGE' })
  })

  it('⛔ NON-VACUITY in the sentence: nothing paired is said, never passed off as agreement', () => {
    const r = compareObjects(V, O, { rows: [], unpaired: { ours: 2, vendor: 2 } })
    expect(r.verdict).toBe('MATCH')
    expect(r.reason).toMatch(/no colour slot was paired, so no colour was graded/)
    expect(r.colourUnpaired).toEqual({ ours: 2, vendor: 2 })
  })

  it('a caller that pairs nothing gets the verdict and the sentence it always got', () => {
    const r = compareObjects(V, O)
    expect(r).toEqual({
      verdict: 'MATCH',
      reason: 'object counts and texts agree; coordinates are NOT compared by v1',
      counts: expect.any(Array),
      texts: expect.any(Array),
    })
  })
})

describe('C44 — on committed captures, a MATCH graded the colours', () => {
  it('⭐ liquidity-pools: 182 lines and 91 labels, every paired colour TradingView\'s', () => {
    const v = gradeCapture(load('liquidity-pools-rddt-1d-2026-09-28')).verdict
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(v.objects.verdictWithoutColour).toBe('MATCH')
    expect(v.verdict).toBe('MATCH')
    expect(v.verdictWithoutColour).toBe('MATCH')
    const lines = colourRow(v, 'lines')
    const labels = colourRow(v, 'labels')
    // ⛔ NON-VACUITY: one slot per line, a colour and a text colour per label
    expect(lines).toMatchObject({ agree: true, slots: 182, agreeing: 182, differing: 0 })
    expect(labels).toMatchObject({ agree: true, slots: 182, differing: 0 })
    expect(v.objects.colourUnpaired).toEqual({ ours: 0, vendor: 0 })
    expect(v.objects.reason).toBe('object counts and texts agree; colours agree on 364 paired slots; coordinates are NOT compared by v1')
  }, 120000)

  it('⭐ vw-object-gc-b: colours the script never names are graded too — the version\'s defaults (C37)', () => {
    const v = gradeCapture(load('vw-object-gc-b-spy-1d-2026-09-28')).verdict
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    const slots = v.objects.colours.reduce((n, r) => n + r.slots, 0)
    expect(slots).toBe(326)
    expect(v.objects.colours.every((r) => r.agree === true)).toBe(true)
  }, 120000)
})

describe('C44 — 🔴 a moved colour turns MATCH into DIVERGE', () => {
  it('one line of liquidity-pools in another colour: the capture diverges, and only because of colour', () => {
    const c = clone(load('liquidity-pools-rddt-1d-2026-09-28'))
    const rec = c.objects.records.lines[0]
    rec.ci = otherRawColour(c, rec.ci)
    const moved = sealCapture(c)
    const { verdict: v, integrity } = gradeCapture(moved)
    expect(integrity.ok, integrity.errors.join('; ')).toBe(true)
    expect(v.objects.verdict).toBe('DIVERGE')
    expect(v.objects.verdictWithoutColour).toBe('MATCH')
    expect(v.verdict).toBe('DIVERGE')
    expect(v.verdictWithoutColour).toBe('MATCH')
    const lines = colourRow(v, 'lines')
    expect(lines).toMatchObject({ agree: false, slots: 182, agreeing: 181, differing: 1 })
    expect(lines.first).toMatchObject({ slot: 'line.color', state: 'carriedDiffers' })
    // the other family is untouched, and so is every count and text
    expect(colourRow(v, 'labels').agree).toBe(true)
    expect(v.objects.counts.every((r) => r.agree !== false)).toBe(true)
    expect(v.objects.texts.every((r) => r.agree)).toBe(true)
    expect(v.objects.reason).toMatch(/^object counts and texts agree; 1 object family differs in COLOUR \(first: line\.color of line #\d+ — vendor #[0-9a-f]{8}, ours #[0-9a-f]{8}, carriedDiffers\)/)
  }, 120000)

  it('🟢 CONTROL — the unmoved capture, graded the same way, is MATCH (the move is what diverged)', () => {
    const c = sealCapture(clone(load('liquidity-pools-rddt-1d-2026-09-28')))
    expect(gradeCapture(c).verdict.objects.verdict).toBe('MATCH')
  }, 120000)
})

describe('C44 — 🟢 a theme-relative slot does not', () => {
  // market-structure: 22 labels; 16 take their text colour from `chart.fg_color`
  // (TradingView drew its light theme's #0f0f0f there), 6 from the script's own
  // colours. The capture is from the listing: every object agrees id for id.
  const ID = 'market-structure-by-leviathan-rddt-1d-2026-09-28'
  const paired = (c) => {
    const { ours } = gradeCapture(c)
    return pairObjects(c, ours.objects).rows.filter((r) => r.kind === 'label' && r.slot === 'textcolor')
  }
  const idOf = (row) => Number(/^label #(\d+)/.exec(row.where)[1])

  it('⭐ as captured: MATCH, 16 theme-relative text colours counted as agreeing', () => {
    const v = gradeCapture(load(ID)).verdict
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(colourRow(v, 'labels')).toMatchObject({ agree: true, themeRelative: 16, differing: 0 })
  }, 120000)

  it('TradingView\'s colour on every theme slot moved to another colour: still MATCH', () => {
    const base = load(ID)
    const theme = paired(base).filter((r) => r.state === 'themeRelative').map(idOf)
    expect(theme.length).toBe(16)
    const c = clone(base)
    let moved = 0
    for (const rec of c.objects.records.labels) {
      if (!theme.includes(rec.id)) continue
      rec.tci = otherRawColour(c, rec.tci)
      moved += 1
    }
    expect(moved).toBe(16)
    const { verdict: v, integrity } = gradeCapture(sealCapture(c))
    expect(integrity.ok, integrity.errors.join('; ')).toBe(true)
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(colourRow(v, 'labels')).toMatchObject({ agree: true, themeRelative: 16, differing: 0 })
    expect(v.verdict).toBe('MATCH')
  }, 180000)

  it('🔴 CONTROL — the same move on a text colour the SCRIPT chose diverges', () => {
    const base = load(ID)
    const own = paired(base).filter((r) => r.state === 'agree').map(idOf)
    expect(own.length).toBe(6)
    const c = clone(base)
    const rec = c.objects.records.labels.find((r) => r.id === own[0])
    rec.tci = otherRawColour(c, rec.tci)
    const v = gradeCapture(sealCapture(c)).verdict
    expect(v.objects.verdict).toBe('DIVERGE')
    expect(v.objects.verdictWithoutColour).toBe('MATCH')
    expect(colourRow(v, 'labels')).toMatchObject({ agree: false, themeRelative: 16, differing: 1 })
    expect(colourRow(v, 'labels').first).toMatchObject({ slot: 'label.textcolor', state: 'carriedDiffers' })
  }, 180000)
})

describe('C44 — the option: colour off is the verdict as it was', () => {
  const HEAT = 'heat-map-seasons-rddt-1d-2026-09-28'

  it('ON by default; an explicit option wins over the environment; `VENDOR_HARNESS_OBJECT_COLOUR=0` turns a run off', () => {
    expect(objectColourGraded()).toBe(true)
    expect(objectColourGraded({ objectColour: false })).toBe(false)
    vi.stubEnv('VENDOR_HARNESS_OBJECT_COLOUR', '0')
    try {
      expect(objectColourGraded()).toBe(false)
      expect(objectColourGraded({ objectColour: true })).toBe(true)
    } finally {
      vi.stubEnv('VENDOR_HARNESS_OBJECT_COLOUR', '')
    }
    expect(objectColourGraded()).toBe(true)
  })

  it('⭐ heat-map-seasons — the one committed capture colour moves: MATCH before, DIVERGE now, on ONE cell', () => {
    // The gauge point: `bgcolor = color`, a variable NAMED `color` (§ C37, "still
    // not carried"). We draw #dde44f where TradingView drew #f3e841. Every count
    // and every text agrees, which is why it graded MATCH until colour joined.
    // ⛔ WHEN THIS GOES RED BECAUSE THE CELL IS FIXED, that is the progress this
    // pin exists to notice: re-pin to MATCH / MATCH and say so in the triage doc.
    const cap = load(HEAT)
    const on = gradeCapture(cap).verdict
    expect(on.objects.verdictWithoutColour).toBe('MATCH')
    expect(on.objects.verdict).toBe('DIVERGE')
    expect(on.verdictWithoutColour).toBe('MATCH')
    expect(on.verdict).toBe('DIVERGE')
    const cells = colourRow(on, 'tableCells')
    expect(cells).toMatchObject({ agree: false, differing: 1 })
    expect(cells.first).toMatchObject({ slot: 'cell.bgcolor', state: 'carriedDiffers', vendor: '#f3e841ff', ours: '#dde44fff' })
    expect(cells.first.where).toMatch(/^cell \(13,1\)/)
    expect(colourRow(on, 'tables').agree).toBe(true)

    const off = gradeCapture(cap, { objectColour: false }).verdict
    expect(off.objects.verdict).toBe('MATCH')
    expect(off.verdict).toBe('MATCH')
    expect(off.objects.reason).toBe('object counts and texts agree; coordinates are NOT compared by v1')
    expect(off.objects).not.toHaveProperty('colours')
    expect(off.objects).not.toHaveProperty('verdictWithoutColour')
    expect(off).not.toHaveProperty('verdictWithoutColour')
    // what the option does NOT touch: every count, text and plot row
    expect(off.objects.counts).toEqual(on.objects.counts)
    expect(off.objects.texts).toEqual(on.objects.texts)
    expect(off.plots.map((p) => [p.id, p.verdict])).toEqual(on.plots.map((p) => [p.id, p.verdict]))
  }, 180000)

  it('⭐ multi-timeframe-supply-demand-zones — the other one: 8 held boxes whose colours a loop sets', () => {
    // 504 boxes, every one created `box.new(na, na, na, na)` and — on this chart —
    // still at `na` on BOTH sides (nothing is drawn by either platform). On eight
    // of them TradingView ran `box.set_bgcolor` / `box.set_border_color` inside a
    // helper's loop; our program drops those updates, so the eight hold the
    // default where TradingView holds the script's colour. Held state differs,
    // and it would be DRAWN differently the day a zone gets its coordinates.
    // ⚰️ Invisible until C44 twice over: a count cannot see a colour, and the
    // pairing skipped every object at an `na` price (`objectColours.js::isNa`).
    const v = gradeCapture(load('multi-timeframe-supply-demand-zones-rddt-1d-2026-09-28')).verdict
    expect(v.objects.verdictWithoutColour).toBe('MATCH')
    expect(v.objects.verdict).toBe('DIVERGE')
    expect(v.verdictWithoutColour).toBe('MATCH')
    expect(v.verdict).toBe('DIVERGE')
    const boxes = colourRow(v, 'boxes')
    // ⛔ NON-VACUITY: all 504 boxes paired (two slots each), none skipped
    expect(boxes).toMatchObject({ agree: false, slots: 1008, agreeing: 992, differing: 16 })
    expect(boxes.first).toMatchObject({ slot: 'box.border_color', state: 'notCarried', vendor: '#c6f89561' })
    expect(v.objects.colourUnpaired).toEqual({ ours: 0, vendor: 0 })
  }, 180000)

  it('a script with no drawing program is graded exactly as before — there is no colour to pair', () => {
    const v = gradeCapture(load('keltner-channels-bands-rddt-1d-2026-09-27')).verdict
    expect(v.verdict).toBe('MATCH')
    expect(v.objects).toEqual({ verdict: 'MATCH', reason: 'neither side draws an object' })
    expect(v).not.toHaveProperty('verdictWithoutColour')
  }, 120000)
})

describe('C44 — the pairing: an `na` coordinate is `na` on both sides', () => {
  // The capture writes `na` as `null`; our runtime holds `NaN`. Packed colours
  // (no palette): 0xff0000ff is opaque red, 0xff00ff00 opaque green.
  const capture = (boxes) => ({ study: {}, objects: { records: { boxes } } })
  const box = (id, top, bottom, colour) => ({ id, family: 'box', props: { top, bottom, border_color: colour, bgcolor: colour } })

  it('⭐ a box both sides hold at `na` pairs, and its colours are graded', () => {
    const cap = capture([{ id: 1, y1: null, y2: null, c: 0xff0000ff, bc: 0xff0000ff }])
    const same = pairObjects(cap, { held: [box(1, NaN, NaN, '#FF0000')] })
    expect(same.unpaired).toEqual({ ours: 0, vendor: 0 })
    expect(same.rows.map((r) => [r.slot, r.state])).toEqual([['border_color', 'agree'], ['bgcolor', 'agree']])
    // …so a wrong colour there is SEEN (it was skipped before: nothing paired)
    const wrong = pairObjects(cap, { held: [box(1, NaN, NaN, '#00FF00')] })
    expect(wrong.rows.map((r) => r.state)).toEqual(['carriedDiffers', 'carriedDiffers'])
    // `undefined` (a coordinate never written) is the same `na`
    expect(pairObjects(cap, { held: [box(1, undefined, undefined, '#FF0000')] }).unpaired).toEqual({ ours: 0, vendor: 0 })
  })

  it('⛔ `na` pairs with `na` ONLY — never with a price', () => {
    const cap = capture([{ id: 1, y1: 10, y2: 5, c: 0xff0000ff, bc: 0xff0000ff }])
    const r = pairObjects(cap, { held: [box(1, NaN, NaN, '#FF0000')] })
    expect(r.rows).toEqual([])
    expect(r.unpaired).toEqual({ ours: 1, vendor: 1 })
    // and the other way round
    const cap2 = capture([{ id: 1, y1: null, y2: null, c: 0xff0000ff, bc: 0xff0000ff }])
    expect(pairObjects(cap2, { held: [box(1, 10, 5, '#FF0000')] }).unpaired).toEqual({ ours: 1, vendor: 1 })
    // 🟢 CONTROL — two prices that agree still pair
    expect(pairObjects(cap, { held: [box(1, 10, 5, '#FF0000')] }).unpaired).toEqual({ ours: 0, vendor: 0 })
  })
})
