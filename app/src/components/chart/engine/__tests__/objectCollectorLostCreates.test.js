// app/src/components/chart/engine/__tests__/objectCollectorLostCreates.test.js
//
// ─── ⭐⭐ A FAMILY THE COLLECTOR CUT WHILE CREATES OF IT WERE LOST IS WITHHELD ──
//
// C13 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`, step 13).
// Pine's collector cuts a drawing family by COUNT (`objectRuntime.js`,
// `collect`, measured in C7). A create the converter lost still counts on
// TradingView's side, so once the collector runs the two sides cut at different
// moments and hold DIFFERENT objects — TradingView removed ones this chart
// would keep. Measured on NYSE:RDDT 1D: `sector-rotation` held 50/50 lines by
// count, but TradingView's are two per bar over the last 25 bars and ours one
// per bar over the last 50.
//
// The converter carries the lost families on the program (`lostCreates`); the
// runtime withholds a family only when its collector actually cut it.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'

const LF = String.fromCharCode(10)
const src = (head, ...lines) => ['//@version=5', head, ...lines].join(LF)
const host = (s) => translatePine(s, { strict: true })

/** Run a program over synthetic bars; only the tree shapes these fixtures
 *  produce are evaluated (anything else is NaN, visibly). */
function run(program, bars) {
  const trees = program.trees
  const ev = (n, bar) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'str') return n.value
    if (n.type === 'series') {
      if (n.name === 'barindex') return bar
      if (n.name === 'high') return 101 + bar
      if (n.name === 'low') return 99 + bar
      return NaN
    }
    return NaN
  }
  return evaluateObjects(program, {
    barCount: bars,
    readNode: (i, bar) => ev(trees[i], bar),
    readTime: (i) => i,
  })
}

// One label per bar that converts, one whose text this door cannot read (an
// object getter in the text — refused by name at the value door).
const LOSES_A_LABEL = src('indicator("t", overlay=true, max_labels_count=5)',
  'var line ln = line.new(0, 1, 1, 1)',
  'label.new(bar_index, high, "kept")',
  'label.new(bar_index, low, str.tostring(line.get_y1(ln)))')
const CLEAN = src('indicator("t", overlay=true, max_labels_count=5)',
  'var line ln = line.new(0, 1, 1, 1)',
  'label.new(bar_index, high, "kept")')

describe('the converter names the families that lost a create', () => {
  it('⭐ a label create the door cannot read puts `label` on the program', () => {
    const t = host(LOSES_A_LABEL)
    expect(t.objectDiagnostics.dropReasons['create:label']).toBe(1)
    expect(t.objects.lostCreates).toEqual(['label'])
    expect(t.objectDiagnostics.lostCreates).toEqual(['label'])
  })

  it('⛔ CONTROL — a clean program carries no `lostCreates` at all (byte-identical to before)', () => {
    const t = host(CLEAN)
    expect(t.objects).toBeTruthy()
    expect('lostCreates' in t.objects).toBe(false)
    expect(t.objectDiagnostics.lostCreates).toBeUndefined()
  })

  it('⭐ a create lost to an unreadable GUARD names its family too', () => {
    const t = host(src('indicator("t", overlay=true)',
      'if line.get_y1(line.new(0, 1, 1, 1)) > 0',
      '    box.new(bar_index, high, bar_index + 1, low)',
      'label.new(bar_index, high, "kept")'))
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBeGreaterThan(0)
    expect(t.objects.lostCreates).toContain('box')
  })
})

describe('the runtime withholds a family only when its collector cut it', () => {
  it('⭐ lost label creates + the label collector ran ⇒ labels withheld, and said so', () => {
    const t = host(LOSES_A_LABEL)
    const r = run(t.objects, 40)
    expect(r.withheld && r.withheld.label, 'labels drawn although the vendor cut a different set').toBeGreaterThan(0)
    expect(r.live.filter((o) => o.family === 'label')).toEqual([])
    expect(r.counts.label).toBe(0)
    // the family nothing lost is untouched
    expect(r.live.filter((o) => o.family === 'line').length).toBe(1)
  })

  it('⛔ CONTROL — the same program without `lostCreates` holds its labels (the cut is what decided it)', () => {
    const t = host(LOSES_A_LABEL)
    const bare = { ...t.objects }
    delete bare.lostCreates
    const r = run(bare, 40)
    expect(r.withheld).toBeUndefined()
    const held = r.live.filter((o) => o.family === 'label').length
    expect(held).toBeGreaterThanOrEqual(5)
    expect(held).toBeLessThanOrEqual(10)
  })

  it('⛔ CONTROL — below the collector\'s trigger a lost create is only a MISSING object: drawn', () => {
    const t = host(LOSES_A_LABEL)
    // cap 5 collects past 10; 8 bars make 8 labels and never collect
    const r = run(t.objects, 8)
    expect(r.withheld).toBeUndefined()
    expect(r.live.filter((o) => o.family === 'label').length).toBe(8)
  })

  it('⛔ CONTROL — a lost create of ANOTHER family does not withhold this one', () => {
    const t = host(LOSES_A_LABEL)
    const r = run({ ...t.objects, lostCreates: ['box'] }, 40)
    expect(r.withheld).toBeUndefined()
    expect(r.live.filter((o) => o.family === 'label').length).toBeGreaterThanOrEqual(5)
  })

  it('⭐ `*` — a family the converter could not name — withholds every family the collector cut', () => {
    const t = host(LOSES_A_LABEL)
    const r = run({ ...t.objects, lostCreates: ['*'] }, 40)
    expect(r.withheld && r.withheld.label).toBeGreaterThan(0)
    // the var line was never collected, so it is still drawn
    expect(r.live.filter((o) => o.family === 'line').length).toBe(1)
  })
})
