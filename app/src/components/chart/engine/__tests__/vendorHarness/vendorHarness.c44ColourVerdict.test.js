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
//   undrawn                       not graded — held at an `na` coordinate on BOTH
//                                 sides, so no member sees it; counted, never dropped
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
//   6. the one committed capture whose verdict colour changes, by name and slot,
//      and the one whose held-but-undrawn boxes are counted without deciding it;
//   7. the pairing reads an `na` coordinate as `na` on both sides, files an object
//      NEITHER side draws as `undrawn`, and still grades one EITHER side draws.
//
// ⛔ SYNTHETIC VARIANTS of a capture are built HERE, in memory, and re-sealed
// (`sealCapture`) — never written under `tests/fixtures/` (that directory holds
// only what was read off the vendor's own screen).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, objectColourGraded } from './harness'
import { pairObjects, pairUndrawn, vendorColourReader } from './objectColours'
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

  it('⛔ an UNDRAWN slot is not graded — and stays counted, with the difference it holds named', () => {
    const rows = objectColourRows({ rows: [
      slot('box', 'undrawn', { slot: 'bgcolor', wouldBe: 'agree' }),
      slot('box', 'undrawn', { slot: 'bgcolor', wouldBe: 'notCarried', where: 'box #7' }),
      slot('box', 'undrawn', { slot: 'border_color', wouldBe: 'carriedDiffers', where: 'box #7' }),
      slot('line', 'agree'), slot('line', 'undrawn', { wouldBe: 'agreeByDefault' }),
    ] })
    expect(rows).toEqual([
      expect.objectContaining({ family: 'lines colour', agree: true, slots: 2, agreeing: 1, undrawn: 1, undrawnDiffering: 0, firstUndrawn: null }),
      // every slot of the family is undrawn: nothing graded, nothing claimed
      expect.objectContaining({ family: 'boxes colour', agree: null, slots: 3, agreeing: 0, differing: 0, undrawn: 3, undrawnDiffering: 2 }),
    ])
    expect(rows[1].firstUndrawn).toEqual({ slot: 'box.bgcolor', state: 'notCarried', vendor: '#111111ff', ours: '#222222ff', where: 'box #7' })
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

  it('undrawn slots that differ do not decide the verdict, and the reason says they exist', () => {
    const r = compareObjects(V, O, { rows: [
      slot('line', 'agree'),
      slot('box', 'undrawn', { wouldBe: 'notCarried' }), slot('box', 'undrawn', { wouldBe: 'agree' }),
    ], unpaired: { ours: 0, vendor: 0 } })
    expect(r).toMatchObject({ verdict: 'MATCH', verdictWithoutColour: 'MATCH' })
    expect(r.reason).toBe('object counts and texts agree; colours agree on 1 paired slots; 2 slots on objects neither side draws not graded (1 of them hold a colour that differs); coordinates are NOT compared by v1')
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

  it('⭐ heat-map-seasons — the one cell whose colour we could not carry is now WITHHELD, not drawn wrong', () => {
    // History: the gauge point, cell (13,1), `bgcolor = color` (a variable NAMED
    // `color`). C44 found it drawn #dde44f where TradingView drew #f3e841 - the one
    // carried-and-different slot in the 47. ⭐ Wave 12 (C45): the name binds, and its
    // colour is a `ta.*` read under a test that varies bar to bar - a call C48 showed
    // this engine cannot yet answer per bar - so the CELL is held by name instead of
    // drawn in a colour that is not TradingView's. Measured on the merged tree: 30 of
    // the vendor's 31 cells drawn, the missing one is the gauge glyph, and EVERY colour
    // we draw agrees (33 of 33 cell slots). A withheld cell is a count difference, so
    // the verdict is DIVERGE with or without colour - but nothing drawn is wrong.
    const cap = load(HEAT)
    const on = gradeCapture(cap).verdict
    expect(on.objects.verdict).toBe('DIVERGE')
    expect(on.objects.verdictWithoutColour).toBe('DIVERGE')
    const cells = colourRow(on, 'tableCells')
    expect(cells).toMatchObject({ agree: true, differing: 0 })
    expect(colourRow(on, 'tables').agree).toBe(true)
    const cellCount = on.objects.counts.find((r) => r.family === 'tableCells')
    expect(cellCount).toMatchObject({ vendor: 31, ours: 30 })
    const cellText = on.objects.texts.find((r) => r.family === 'tableCells text')
    expect(cellText.onlyOurs).toEqual([])
    expect(cellText.onlyVendor).toHaveLength(1)

    const off = gradeCapture(cap, { objectColour: false }).verdict
    expect(off.objects.verdict).toBe('DIVERGE')
    expect(off.objects).not.toHaveProperty('colours')
    expect(off.objects).not.toHaveProperty('verdictWithoutColour')
    expect(off).not.toHaveProperty('verdictWithoutColour')
    // what the option does NOT touch: every count, text and plot row
    expect(off.objects.counts).toEqual(on.objects.counts)
    expect(off.objects.texts).toEqual(on.objects.texts)
    expect(off.plots.map((p) => [p.id, p.verdict])).toEqual(on.plots.map((p) => [p.id, p.verdict]))
  }, 180000)

  it('⭐ multi-timeframe-supply-demand-zones — 504 boxes NOBODY draws: counted, not graded, MATCH', () => {
    // 504 boxes, every one created `box.new(na, na, na, na)` and — on this chart —
    // still at `na` on BOTH sides: neither platform draws one, a member sees
    // nothing. On eight of them TradingView ran `box.set_bgcolor` /
    // `box.set_border_color` inside a helper's loop; our program drops those
    // updates, so the eight HOLD the default where TradingView holds the script's
    // colour. Integrator ruling (2026-10-01): colour is graded only on objects
    // that are drawn, so this is not a verdict — and it is not hidden either:
    // the 16 differing slots are counted and the first is named.
    // ⛔ WHEN A ZONE GETS COORDINATES (another symbol, another day) these become
    // drawn objects and the dropped updates become a real DIVERGE.
    const v = gradeCapture(load('multi-timeframe-supply-demand-zones-rddt-1d-2026-09-28')).verdict
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(v.objects.verdictWithoutColour).toBe('MATCH')
    expect(v.verdict).toBe('MATCH')
    const boxes = colourRow(v, 'boxes')
    // ⛔ NON-VACUITY: all 504 boxes paired (two slots each), none skipped
    expect(boxes).toMatchObject({ agree: null, slots: 1008, agreeing: 0, differing: 0, undrawn: 1008, undrawnDiffering: 16 })
    expect(boxes.firstUndrawn).toMatchObject({ slot: 'box.border_color', state: 'notCarried', vendor: '#c6f89561' })
    expect(v.objects.colourUnpaired).toEqual({ ours: 0, vendor: 0 })
    expect(v.objects.reason).toBe('object counts and texts agree; no colour slot was paired, so no colour was graded; 1008 slots on objects neither side draws not graded (16 of them hold a colour that differs); coordinates are NOT compared by v1')
  }, 180000)

  it('a script with no drawing program is graded exactly as before — there is no colour to pair', () => {
    const v = gradeCapture(load('keltner-channels-bands-rddt-1d-2026-09-27')).verdict
    expect(v.verdict).toBe('MATCH')
    expect(v.objects).toEqual({ verdict: 'MATCH', reason: 'neither side draws an object' })
    expect(v).not.toHaveProperty('verdictWithoutColour')
  }, 120000)
})

describe('C44 — the pairing: `na` is `na` on both sides, and only an object NOBODY draws is exempt', () => {
  // The capture writes `na` as `null`; our runtime holds `NaN`. Packed colours
  // (no palette): 0xff0000ff is opaque red, 0xff00ff00 opaque green.
  const capture = (boxes, extra = {}) => ({ study: {}, objects: { records: { boxes, ...extra } } })
  const box = (id, top, bottom, colour, x = [3, 9]) => ({ id, family: 'box', props: { left: x[0], right: x[1], top, bottom, border_color: colour, bgcolor: colour } })
  const vbox = (id, y1, y2, x1 = 3, x2 = 9) => ({ id, x1, x2, y1, y2, c: 0xff0000ff, bc: 0xff0000ff })
  const states = (r) => r.rows.map((x) => [x.slot, x.state, x.wouldBe])

  it('⭐ a box both sides hold at `na` PAIRS — and is filed `undrawn`, with the state it would have had', () => {
    const cap = capture([vbox(1, null, null)])
    const same = pairObjects(cap, { held: [box(1, NaN, NaN, '#FF0000')] })
    expect(same.unpaired).toEqual({ ours: 0, vendor: 0 })
    expect(states(same)).toEqual([['border_color', 'undrawn', 'agree'], ['bgcolor', 'undrawn', 'agree']])
    // a wrong colour there is still SEEN and kept — it just does not decide a verdict
    const wrong = pairObjects(cap, { held: [box(1, NaN, NaN, '#00FF00')] })
    expect(states(wrong)).toEqual([['border_color', 'undrawn', 'carriedDiffers'], ['bgcolor', 'undrawn', 'carriedDiffers']])
    expect(wrong.rows[0]).toMatchObject({ vendor: '#ff0000ff', ours: '#00ff00ff' })
    // `undefined` (a coordinate never written) is the same `na`
    expect(pairObjects(cap, { held: [box(1, undefined, undefined, '#FF0000')] }).unpaired).toEqual({ ours: 0, vendor: 0 })
  })

  it('🔴 an object DRAWN ON EITHER SIDE is still graded — the exemption cannot hide a real difference', () => {
    // both sides draw it: graded
    const both = pairObjects(capture([vbox(1, 10, 5)]), { held: [box(1, 10, 5, '#00FF00')] })
    expect(states(both)).toEqual([['border_color', 'carriedDiffers', undefined], ['bgcolor', 'carriedDiffers', undefined]])
    // TradingView draws it (every coordinate held) and WE cannot place it (our
    // left edge is `na`): a member looking at TradingView sees a red box. Graded.
    const theirs = pairObjects(capture([vbox(1, 10, 5)]), { held: [box(1, 10, 5, '#00FF00', [NaN, 9])] })
    expect(theirs.rows.map((r) => r.state)).toEqual(['carriedDiffers', 'carriedDiffers'])
    // WE draw it and TradingView's record cannot be drawn (its x is `na`): graded.
    const ours = pairObjects(capture([vbox(1, 10, 5, null, 9)]), { held: [box(1, 10, 5, '#00FF00')] })
    expect(ours.rows.map((r) => r.state)).toEqual(['carriedDiffers', 'carriedDiffers'])
    // 🟢 CONTROL — the same wrong colour with BOTH sides undrawable is the exempt case
    const none = pairObjects(capture([vbox(1, 10, 5, null, 9)]), { held: [box(1, 10, 5, '#00FF00', [NaN, 9])] })
    expect(none.rows.map((r) => r.state)).toEqual(['undrawn', 'undrawn'])
  })

  it('the per-family test of "can it be drawn", on each side\'s own record', () => {
    const P = { x1: 1, y1: 2, x2: 3, y2: 4 }
    expect(pairUndrawn('line', P, P)).toBe(false)
    for (const k of ['x1', 'y1', 'x2', 'y2']) {
      expect(pairUndrawn('line', { ...P, [k]: NaN }, { ...P, [k]: null }), k).toBe(true)
      expect(pairUndrawn('line', { ...P, [k]: NaN }, P), `${k}: only ours`).toBe(false)
      expect(pairUndrawn('line', P, { ...P, [k]: null }), `${k}: only theirs`).toBe(false)
    }
    // a label placed BY PRICE needs its y; one placed off the bar does not
    expect(pairUndrawn('label', { x: 5, y: NaN }, { x: 5, y: null, yl: 'pr' })).toBe(true)
    expect(pairUndrawn('label', { x: 5, y: NaN, yloc: 'abovebar' }, { x: 5, y: null, yl: 'ab' })).toBe(false)
    expect(pairUndrawn('label', { x: 5, y: NaN, yloc: 'abovebar' }, { x: 5, y: null, yl: 'pr' })).toBe(false)
    expect(pairUndrawn('label', { x: NaN, y: 1 }, { x: null, y: 1, yl: 'pr' })).toBe(true)
    // a table and its cells are always drawn
    expect(pairUndrawn('table', {}, {})).toBe(false)
    expect(pairUndrawn('cell', {}, {})).toBe(false)
  })

  it('⛔ `na` pairs with `na` ONLY — never with a price', () => {
    const r = pairObjects(capture([vbox(1, 10, 5)]), { held: [box(1, NaN, NaN, '#FF0000')] })
    expect(r.rows).toEqual([])
    expect(r.unpaired).toEqual({ ours: 1, vendor: 1 })
    // and the other way round
    expect(pairObjects(capture([vbox(1, null, null)]), { held: [box(1, 10, 5, '#FF0000')] }).unpaired).toEqual({ ours: 1, vendor: 1 })
    // 🟢 CONTROL — two prices that agree still pair
    expect(pairObjects(capture([vbox(1, 10, 5)]), { held: [box(1, 10, 5, '#FF0000')] }).unpaired).toEqual({ ours: 0, vendor: 0 })
  })
})
