// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.objectsV2.test.js
//
// ─── OBJECTS v2 — EVERY PAIRED RECORD, FIELD BY FIELD ───────────────────────
//
// v1 (`compare.mjs::compareObjects`) grades drawings by counts, texts and the
// colours of objects paired by value; a drawing in the wrong place can grade
// MATCH. v2 (`objectRecords.js::pairRecords` + `compare.mjs::compareObjectsV2`)
// pairs by creation order and compares every field the capture holds. These
// rails pin what v2 must see, what it must NOT grade, and that it never passes
// a field it cannot read. Each rail is mutation-proved
// (docs/pine/evidence/2026-11-12-objects-v2/EVIDENCE.md).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { pairRecords } from './objectRecords'
import { HARNESS_DIR } from './harness'
import {
  compareObjectsV2, OBJECTS_V2_FIELDS, OBJECTS_V2_FAMILIES,
} from '../../../../../../../tools/vendor_harness/compare.mjs'

// #2962FF packed as TradingView records it: 0xAABBGGRR
const BLUE = 0xffff6229
const RED = 0xff4536f2 // #F23645
const capOf = (records) => ({ symbol: { pricescale: 100 }, study: {}, objects: { records } })
const vLine = (id, over = {}) => ({ id, x1: 0, y1: 10, x2: 1, y2: 12, ex: 'n', st: 'sol', ci: BLUE, w: 1, ...over })
const oLine = (id, over = {}) => ({ family: 'line', id, props: { x1: 500, y1: 10, x2: 501, y2: 12, color: '#2962FF', ...over } })
const objs = (held) => ({ ok: true, held, pineVersion: 6 })
const V1_MATCH = { verdict: 'MATCH', reason: 'object counts and texts agree' }
const v2 = (records, held, v1 = V1_MATCH) => compareObjectsV2(v1, pairRecords(capOf(records), objs(held)))
const fam = (r, f) => r.families.find((x) => x.family === f)

describe('objects v2 — a drawing in the wrong place is found', () => {
  it('identical records: MATCH, and the fields were really graded', () => {
    const r = v2({ lines: [vLine(1)] }, [oLine(1)])
    expect(r.verdict).toBe('MATCH')
    expect(fam(r, 'lines').graded).toBe(6)
    expect(fam(r, 'lines').agreeing).toBe(6)
  })

  it('a line at the wrong price: v1 MATCH becomes v2 DIVERGE, first field named', () => {
    const r = v2({ lines: [vLine(1)] }, [oLine(1, { y1: 11 })])
    expect(r.v1).toBe('MATCH')
    expect(r.verdict).toBe('DIVERGE')
    expect(r.first).toMatchObject({ family: 'lines', field: 'y1', vendor: 10, ours: 11 })
  })

  it('price tolerance is the comparator\'s: a millionth of the tick agrees, a tick does not', () => {
    expect(v2({ lines: [vLine(1)] }, [oLine(1, { y1: 10 + 1e-9 })]).verdict).toBe('MATCH')
    expect(v2({ lines: [vLine(1)] }, [oLine(1, { y1: 10.01 })]).verdict).toBe('DIVERGE')
  })

  it('style, extend, width and colour are each graded', () => {
    expect(v2({ lines: [vLine(1, { st: 'dsh' })] }, [oLine(1)]).first.field).toBe('style')
    expect(v2({ lines: [vLine(1, { ex: 'r' })] }, [oLine(1)]).first.field).toBe('extend')
    expect(v2({ lines: [vLine(1, { w: 2 })] }, [oLine(1)]).first.field).toBe('width')
    expect(v2({ lines: [vLine(1, { ci: RED })] }, [oLine(1)]).first.field).toBe('color')
  })

  it('an unset property is compared as Pine\'s default (width 1, solid, no extend)', () => {
    const r = v2({ lines: [vLine(1)] }, [oLine(1)])
    expect(fam(r, 'lines').byField.width.agree).toBe(1)
    expect(fam(r, 'lines').byField.style.agree).toBe(1)
    expect(fam(r, 'lines').byField.extend.agree).toBe(1)
  })

  it('a table position the script computes (unset on our side) is compared as the render default it is drawn at', () => {
    const t = (pos) => ({ tables: [{ id: 1, pos, rows: 1, cols: 1, bgc: null, frmc: 0, frmw: 0, brdc: 0, brdw: 0 }] })
    const held = [{ family: 'table', id: 1, props: { columns: 1, rows: 1 }, cells: [] }]
    expect(v2(t('top_right'), held).verdict).toBe('MATCH')
    expect(v2(t('bottom_left'), held).first).toMatchObject({ family: 'tables', field: 'position', vendor: 'bottom_left', ours: 'top_right' })
  })

  it('a label is graded at its price only when placed by price', () => {
    const lab = { id: 1, x: 3, y: 50, yl: 'ab', t: 'A', st: 'ldn', ci: BLUE, tci: 0xffffffff, sz: 'normal', ta: 'center', tt: '' }
    const ours = { family: 'label', id: 1, props: { x: 9, y: 77, yloc: 'abovebar', text: 'A', color: '#2962FF', textcolor: '#FFFFFF' } }
    const r = v2({ labels: [lab] }, [ours])
    expect(fam(r, 'labels').byField.y).toEqual({ agree: 0, differ: 0, notGraded: 1 })
    expect(r.verdict).toBe('MATCH')
    const atPrice = v2({ labels: [{ ...lab, yl: 'pr' }] }, [{ ...ours, props: { ...ours.props, yloc: 'price' } }])
    expect(atPrice.first).toMatchObject({ field: 'y', vendor: 50, ours: 77 })
  })
})

describe('objects v2 — what the capture does not hold is named, never passed', () => {
  it('x is not graded and is named in `ungraded`: a moved x leaves the grade unchanged', () => {
    const r = v2({ lines: [vLine(1)] }, [oLine(1, { x1: 9999 })])
    expect(r.verdict).toBe('MATCH')
    expect(r.ungraded.lines).toEqual(expect.arrayContaining(['x1', 'x2', 'xloc']))
    expect(r.ungraded.boxes).toEqual(expect.arrayContaining(['left', 'right']))
    expect(r.reason).toMatch(/not graded: x coordinates/)
  })

  it('a vendor code the table cannot decode is counted `undecoded`, neither agreeing nor differing', () => {
    const r = v2({ lines: [vLine(1, { st: 'zzz' })] }, [oLine(1)])
    const row = fam(r, 'lines')
    expect(row.byField.style).toEqual({ agree: 0, differ: 0, notGraded: 1 })
    expect(row.undecoded).toEqual({ 'style=zzz': 1 })
    expect(r.verdict).toBe('MATCH')
  })

  it('a field missing from the record is `undecoded` (absent), never read as the default', () => {
    const rec = vLine(1)
    delete rec.w
    const row = fam(v2({ lines: [rec] }, [oLine(1, { width: 3 })]), 'lines')
    expect(row.byField.width).toEqual({ agree: 0, differ: 0, notGraded: 1 })
    expect(row.undecoded).toEqual({ 'width=absent': 1 })
  })

  it('an unknown field state fails closed', () => {
    const pairing = { families: { lines: { unpairedVendor: 0, unpairedOurs: 0, pairs: [{ vendorId: 1, ourId: 1, where: 'x', fields: [{ field: 'y1', state: 'weird' }] }] } } }
    expect(() => compareObjectsV2(V1_MATCH, pairing)).toThrow(/unknown field state/)
  })

  it('every key a capture records is graded, used for pairing, or named as not graded', () => {
    const files = ['artemis-oscillator-pro-rddt-1d-2026-09-28.json', 'zero-lag-ma-trend-levels-rddt-1d-2026-09-27.json',
      'vw-object-gc-a-spy-1d-2026-09-28.json', 'k-clustering-rddt-1d-2026-09-28.json', 'all-chart-patterns-theeccentrictrader-spy-1d-2026-10-03.json']
    const seen = Object.fromEntries(OBJECTS_V2_FAMILIES.map((f) => [f, new Set()]))
    for (const f of files) {
      const R = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, f), 'utf8')).objects.records
      for (const family of OBJECTS_V2_FAMILIES) for (const rec of R[family] || []) for (const k of Object.keys(rec)) seen[family].add(k)
    }
    // ⛔ NON-VACUITY: the sample must hold every family
    for (const family of OBJECTS_V2_FAMILIES) expect(seen[family].size, family).toBeGreaterThan(1)
    for (const family of OBJECTS_V2_FAMILIES) {
      const spec = OBJECTS_V2_FIELDS[family]
      const known = new Set(['id', ...spec.fields.map((x) => x.vendor), ...spec.vendorKeysNotGraded, ...(spec.pairingKeys || [])])
      const silent = [...seen[family]].filter((k) => !known.has(k))
      expect(silent, `${family}: recorded but neither graded nor named`).toEqual([])
    }
  })
})

describe('objects v2 — pairing', () => {
  it('aligns at the NEWEST end; the rest are unpaired (a count difference), never graded field by field', () => {
    const r = v2({ lines: [vLine(1, { y1: 1 }), vLine(2), vLine(3)] }, [oLine(7), oLine(8)])
    const row = fam(r, 'lines')
    expect(row.paired).toBe(2)
    expect(row.unpairedVendor).toBe(1)
    expect(row.byField.y1).toEqual({ agree: 2, differ: 0, notGraded: 0 })
    expect(r.verdict).toBe('DIVERGE')
    expect(r.first).toMatchObject({ family: 'lines', field: 'count', vendor: 3, ours: 2 })
  })

  it('cells pair by table and address; a linefill pairs by its two lines (as the runtime holds them)', () => {
    const records = {
      lines: [vLine(1), vLine(2, { y1: 20, y2: 22 })],
      linefills: [{ id: 3, line1: 1, line2: 2, ci: BLUE }],
      tables: [{ id: 4, pos: 'top_right', rows: 1, cols: 2, bgc: null, frmc: 0, frmw: 0, brdc: 0, brdw: 0 }],
      tableCells: [
        { id: 5, tid: 4, col: 1, row: 0, t: 'B', w: null, h: null, tc: 0xff000000, tha: 'center', tva: 'center', ts: 'small', bgc: null, tt: '', colspan: 1, rowspan: 1 },
        { id: 6, tid: 4, col: 0, row: 0, t: 'A', w: null, h: null, tc: 0xff000000, tha: 'center', tva: 'center', ts: 'auto', bgc: null, tt: '', colspan: 1, rowspan: 1 },
      ],
    }
    const held = [
      oLine(1), oLine(2, { y1: 20, y2: 22 }),
      { family: 'linefill', id: 9, props: { line1: { __ref: 2 }, line2: { __ref: 1 }, color: '#2962FF' } },
      { family: 'table', id: 4, props: { position: 'top_right', columns: 2, rows: 1 },
        cells: [{ col: 0, row: 0, props: { text: 'A', text_color: '#000000' } }, { col: 1, row: 0, props: { text: 'B', text_color: '#000000', text_size: 'small' } }] },
    ]
    const r = v2(records, held)
    expect(r.verdict, r.reason).toBe('MATCH')
    expect(fam(r, 'tableCells').paired).toBe(2)
    expect(fam(r, 'linefills').paired).toBe(1)
    expect(fam(r, 'linefills').byField.color.agree).toBe(1)
    // the fill between the wrong lines is found
    const swapped = held.map((o) => (o.family === 'linefill' ? { ...o, props: { ...o.props, line2: { __ref: 2 } } } : o))
    expect(v2(records, swapped).first).toMatchObject({ family: 'linefills', field: 'count', vendor: 1, ours: 1 })
    expect(fam(v2(records, swapped), 'linefills').paired).toBe(0)
    // a cell's size in the wrong slot is found (the engine-51 class of defect)
    const wrongSize = held.map((o) => (o.family === 'table'
      ? { ...o, cells: o.cells.map((c) => (c.col === 1 ? { ...c, props: { ...c.props, text_size: 'large' } } : c)) } : o))
    expect(v2(records, wrongSize).first).toMatchObject({ family: 'tableCells', field: 'text_size', vendor: 'small', ours: 'large' })
  })

  it('a difference only in creation order is SAID (equal ids pair, every field agrees) and still diverges', () => {
    const lab = (id, t) => ({ id, x: 0, y: 5, yl: 'pr', t, st: 'ldn', ci: BLUE, tci: 0xffffffff, sz: 'normal', ta: 'center', tt: '' })
    const ours = (id, t) => ({ family: 'label', id, props: { x: 1, y: 5, text: t, color: '#2962FF', textcolor: '#FFFFFF' } })
    // TradingView re-created B later (id 9); ours kept it at id 2
    const r = v2({ labels: [lab(1, 'A'), lab(3, 'C'), lab(9, 'B')] }, [ours(1, 'A'), ours(2, 'B'), ours(3, 'C')])
    expect(r.verdict).toBe('DIVERGE')
    expect(r.differsOnlyByCreationOrder).toBe(true)
    expect(r.reason).toMatch(/ONLY in creation order/)
    // a real text difference is not excused by it
    const real = v2({ labels: [lab(1, 'A'), lab(2, 'X')] }, [ours(1, 'A'), ours(2, 'B')])
    expect(real.differsOnlyByCreationOrder).toBe(false)
  })

  it('an empty cell is not graded on its text placement (nothing is drawn to place)', () => {
    const records = {
      tables: [{ id: 1, pos: 'top_right', rows: 1, cols: 1, bgc: null, frmc: 0, frmw: 0, brdc: 0, brdw: 0 }],
      tableCells: [{ id: 2, tid: 1, col: 0, row: 0, t: '', w: null, h: null, tc: 0xff000000, tha: 'left', tva: 'center', ts: 'auto', bgc: null, tt: '', colspan: 1, rowspan: 1 }],
    }
    const held = [{ family: 'table', id: 1, props: { position: 'top_right', columns: 1, rows: 1 }, cells: [{ col: 0, row: 0, props: {} }] }]
    const r = v2(records, held)
    expect(r.verdict, r.reason).toBe('MATCH')
    expect(fam(r, 'tableCells').byField.text_halign).toEqual({ agree: 0, differ: 0, notGraded: 1 })
    // with text, the same placement is graded and differs
    const withText = { ...records, tableCells: [{ ...records.tableCells[0], t: 'x' }] }
    const heldText = [{ ...held[0], cells: [{ col: 0, row: 0, props: { text: 'x' } }] }]
    expect(v2(withText, heldText).first).toMatchObject({ family: 'tableCells', field: 'text_halign', vendor: 'left', ours: 'center' })
  })

  it('a family v1 found withheld by name is not paired again and its missing records are no difference', () => {
    const v1 = { verdict: 'MATCH', reason: 'r', counts: [{ family: 'lines', vendor: 2, ours: null, agree: null, withheld: true }] }
    const r = v2({ lines: [vLine(1), vLine(2)] }, [], v1)
    expect(fam(r, 'lines')).toMatchObject({ withheld: true, agree: null, paired: 0 })
    expect(r.verdict).toBe('MATCH')
    // a fill between withheld lines is withheld with them
    const withFill = v2({ lines: [vLine(1), vLine(2)], linefills: [{ id: 3, line1: 1, line2: 2, ci: BLUE }] }, [], v1)
    expect(fam(withFill, 'linefills')).toMatchObject({ withheld: true, agree: null })
    expect(withFill.verdict).toBe('MATCH')
    // control: the same capture with the family NOT withheld is a count difference
    expect(v2({ lines: [vLine(1), vLine(2)] }, []).first).toMatchObject({ family: 'lines', field: 'count' })
  })

  it('never makes a v1 DIVERGE or INCONCLUSIVE better', () => {
    expect(v2({ lines: [vLine(1)] }, [oLine(1)], { verdict: 'DIVERGE', reason: 'counts' }).verdict).toBe('DIVERGE')
    expect(v2({ lines: [vLine(1)] }, [oLine(1)], { verdict: 'INCONCLUSIVE', reason: 'withheld' }).verdict).toBe('INCONCLUSIVE')
    expect(compareObjectsV2({ verdict: 'MATCH', reason: 'r' }, null).verdict).toBe('MATCH')
  })
})

// ── review #1150 — rails for the rules a mutant survived, and the three notes ──
describe('objects v2 — review #1150 rails', () => {
  const vBox = (id, over = {}) => ({ id, x1: 0, y1: 20, x2: 1, y2: 10, c: BLUE, bc: BLUE, ts: 'auto', tc: 0xffffffff, tva: 'center', tha: 'center', tw: 'none', t: '', ...over })
  const oBox = (id, over = {}) => ({ family: 'box', id, props: { left: 5, top: 20, right: 6, bottom: 10, border_color: '#2962FF', bgcolor: '#2962FF', ...over } })
  const lab = (id, over = {}) => ({ id, x: 0, y: 5, yl: 'pr', t: 'A', st: 'ldn', ci: BLUE, tci: 0xffffffff, sz: 'normal', ta: 'center', tt: '', ...over })
  const oLab = (id, over = {}) => ({ family: 'label', id, props: { x: 1, y: 5, text: 'A', color: '#2962FF', textcolor: '#FFFFFF', ...over } })

  it('note 1: an ABSENT vendor colour key is undecoded, never read as the na colour', () => {
    const rec = vBox(1)
    delete rec.bc
    const row = fam(v2({ boxes: [rec] }, [oBox(1, { bgcolor: 'transparent' })]), 'boxes')
    expect(row.byField.bgcolor).toEqual({ agree: 0, differ: 0, notGraded: 1 })
    expect(row.undecoded['bgcolor=absent']).toBe(1)
  })

  it('note 2: "only in creation order" is never said while a record is unpaired', () => {
    const r = v2({ labels: [lab(0, { t: 'Z' }), lab(1, { t: 'A' }), lab(3, { t: 'C' }), lab(9, { t: 'B' })] },
      [oLab(1, { text: 'A' }), oLab(2, { text: 'B' }), oLab(3, { text: 'C' })])
    expect(r.verdict).toBe('DIVERGE')
    expect(fam(r, 'labels').unpairedVendor).toBe(1)
    expect(fam(r, 'labels').differsOnlyByCreationOrder).toBe(false)
    expect(r.differsOnlyByCreationOrder).toBe(false)
    expect(r.reason).not.toMatch(/ONLY in creation order/)
  })

  it('note 3: fills are withheld only by OUR side\'s own list, never inferred from withheld lines', () => {
    const v1Lines = { verdict: 'MATCH', reason: 'r', counts: [{ family: 'lines', withheld: true }] }
    const fill = { family: 'linefill', id: 9, props: { line1: { __ref: 1 }, line2: { __ref: 2 }, color: '#2962FF' } }
    const pairing = pairRecords(capOf({ lines: [], linefills: [] }), objs([fill]))
    expect(compareObjectsV2(v1Lines, pairing).verdict).toBe('DIVERGE')
    const withheld = compareObjectsV2(v1Lines, pairing, ['line', 'linefill'])
    expect(withheld.verdict).toBe('MATCH')
    expect(fam(withheld, 'linefills').withheld).toBe(true)
  })

  it('note 6: a v2 that paired nothing says so', () => {
    expect(compareObjectsV2({ verdict: 'MATCH', reason: 'r' }, null).pairedNothing).toBe(true)
    expect(v2({ lines: [vLine(1)] }, [oLine(1)]).pairedNothing).toBe(false)
  })

  it('M4: a pair undrawn on BOTH sides is still graded on its prices', () => {
    const r = v2({ lines: [vLine(1, { y1: null, y2: 12 })] }, [oLine(1, { y1: NaN, y2: 13 })])
    expect(r.verdict).toBe('DIVERGE')
    expect(r.first).toMatchObject({ family: 'lines', field: 'y2' })
  })

  it('M5: text placement is graded when ONE side has text and the other has none', () => {
    const row = fam(v2({ boxes: [vBox(1, { t: '', tc: 0xffffffff })] }, [oBox(1, { text: 'X', text_color: '#F23645' })]), 'boxes')
    expect(row.byField.text_color.differ).toBe(1)
  })

  it('M10: an absent or null vendor text is never read as ours', () => {
    const rec = lab(1, { t: null })
    expect(fam(v2({ labels: [rec] }, [oLab(1, { text: 'A' })]), 'labels').byField.text.differ).toBe(1)
  })
})
