// app/src/components/chart/engine/__tests__/objectRuntimeE55PartlyNamed.test.js
//
// ─── ⭐⭐ ENGINE 55 — A PARTLY DRAWN FAMILY WITH WITHHELD STEPS IS NAMED, PRECISELY ──
//
// ⚰️ OZ named a not-computable family only when NOTHING of it was drawn. A family the run
// drew PART of — a table whose last-bar cells read a value the run could not compute, labels
// whose early creates read the warm-up curtain — kept no word: the member read a short table
// as the script's whole table (K-clustering, graded DIVERGE). Engine 55 names it under
// `objects:not-computable` with HOW MANY, and only for what reaches the FINAL picture:
//   * a table: cells whose LATEST write was withheld (a later clean write clears the mark,
//     so a warm-up write that was overwritten is not counted);
//   * any other family: creates withheld for a reason other than the chart clock.
import { describe, it, expect } from 'vitest'
import { evaluateObjects } from '../objectRuntime'
import { partlyNotComputableSentence, NOT_SHOWN } from '../ast/objectLoss'

const P = (over) => ({ programVersion: 1, regs: [], colls: [], ops: [], ...over })
const onBars = (n, list) => Array.from({ length: n }, (_, i) => (list.includes(i) ? 1 : 0))
const ctxOf = (barCount, cols, unknown, extra = {}) => ({
  barCount,
  readNode: (node, bar) => (cols[node] ? cols[node][bar] : NaN),
  readTime: (bar) => 1_700_000_000 + bar * 86400,
  readUnknown: (node, bar) => !!(unknown[node] && unknown[node][bar]),
  ...extra,
})
const NC = NOT_SHOWN.NOT_COMPUTABLE

const TABLE = (cellNode) => P({
  regs: [{ id: 't', family: 'table' }],
  ops: [
    { k: 'create', family: 'table', site: 'a', into: 't', when: { v: 'graph', node: 0 },
      props: { position: { v: 'const', value: 'top_right' }, columns: { v: 'const', value: 2 }, rows: { v: 'const', value: 2 } } },
    { k: 'cell', target: { r: 'reg', id: 't' }, when: null, col: { v: 'const', value: 0 }, row: { v: 'const', value: 0 },
      props: { text: { v: 'const', value: 'head' } } },
    { k: 'cell', target: { r: 'reg', id: 't' }, when: null, col: { v: 'const', value: 1 }, row: { v: 'const', value: 1 },
      props: { text: { v: 'graph', node: cellNode } } },
  ],
})

describe('⭐⭐ a TABLE: only cells whose LATEST write was withheld are counted', () => {
  it('the last-bar value is unknown → the table is drawn (its header) AND named, with 1 cell', () => {
    const n = 5
    const r = evaluateObjects(TABLE(1), ctxOf(n, { 0: onBars(n, [0]), 1: [1, 2, 3, 4, 5] }, { 1: onBars(n, [4]) }))
    expect(r.live.some((o) => o.family === 'table')).toBe(true)
    expect(r.withheldBy && r.withheldBy[NC]).toEqual(['table'])
    expect(r.stats.withheldUnknownPartial).toEqual({ table: 1 })
    expect(r.withheldWhy.table).toBe(partlyNotComputableSentence('table', 1))
  })

  it('⛔ a warm-up write that a later CLEAN write overwrote is NOT counted — nothing is named', () => {
    const n = 5
    const r = evaluateObjects(TABLE(1), ctxOf(n, { 0: onBars(n, [0]), 1: [1, 2, 3, 4, 5] }, { 1: onBars(n, [1]) }))
    expect(r.withheldBy && r.withheldBy[NC]).toBeUndefined()
    expect((r.stats.withheldUnknown || 0) > 0).toBe(true)          // it WAS withheld on bar 1 …
    expect(r.stats.withheldUnknownPartial).toBeUndefined()         // … and the final table is whole
  })

  it('⛔ a last-bar cell withheld ONLY by the chart clock is the clock note’s to name, not this one', () => {
    const n = 5
    const r = evaluateObjects(TABLE(1), ctxOf(n, { 0: onBars(n, [0]), 1: [1, 2, 3, 4, 5] }, { 1: onBars(n, [4]) },
      { readUnknownOther: () => false }))
    expect(r.withheldBy && r.withheldBy[NC]).toBeUndefined()
  })

  it('the control: nothing unknown, nothing named', () => {
    const n = 5
    const r = evaluateObjects(TABLE(1), ctxOf(n, { 0: onBars(n, [0]), 1: [1, 2, 3, 4, 5] }, {}))
    expect(r.withheldBy).toBeUndefined()
  })
})

describe('⭐⭐ another family: creates withheld for a non-clock reason are counted', () => {
  const LABELS = P({ ops: [{ k: 'create', family: 'label', site: 'l', into: null, when: { v: 'graph', node: 0 },
    props: { x: { v: 'bar' }, y: { v: 'const', value: 1 } } }] })

  it('two early creates read an unknown guard → labels are drawn (the later ones) AND named, with 2', () => {
    const n = 6
    const r = evaluateObjects(LABELS, ctxOf(n, { 0: onBars(n, [0, 1, 3, 5]) }, { 0: onBars(n, [0, 1]) }))
    expect(r.live.filter((o) => o.family === 'label').map((o) => o.props.x)).toEqual([3, 5])
    expect(r.withheldBy && r.withheldBy[NC]).toEqual(['label'])
    expect(r.stats.withheldUnknownPartial).toEqual({ label: 2 })
    expect(r.withheldWhy.label).toBe(partlyNotComputableSentence('label', 2))
  })

  it('⛔ withheld ONLY by the chart clock: the clock note names it, not this one', () => {
    const n = 6
    const r = evaluateObjects(LABELS, ctxOf(n, { 0: onBars(n, [0, 1, 3, 5]) }, { 0: onBars(n, [0, 1]) },
      { readUnknownOther: () => false }))
    expect(r.withheldBy && r.withheldBy[NC]).toBeUndefined()
  })

  it('a family NOTHING of which is drawn keeps OZ\'s whole sentence (unchanged)', () => {
    const n = 3
    const r = evaluateObjects(LABELS, ctxOf(n, { 0: onBars(n, [0, 1]) }, { 0: onBars(n, [0, 1]) }))
    expect(r.live.filter((o) => o.family === 'label')).toEqual([])
    expect(r.withheldBy[NC]).toEqual(['label'])
    expect(r.withheldWhy.label).toMatch(/^No label is shown on this chart/)
    expect(r.stats.withheldUnknownPartial).toBeUndefined()
  })
})
