// app/src/components/chart/engine/__tests__/objectForInLoops.test.js
//
// ─── ⭐⭐ C40 — `for … in` OVER A LIST THIS LANE HOLDS, AND THE CAP `while` ────
//
// C34 found the drawing steps of five corpus scripts inside loops the host object
// reader did not run: `for x in <list>` and `while array.size(a) > N`. Three of
// those are loops the object runtime can run exactly:
//
//     for b in fut_boxes                 a declared drawing list — each slot in
//         box.delete(b)                  index order, the element a copy of it
//     for [i, u] in ups                  a bounded numeric window (C32) — each
//         tbl.cell(0, i, str.tostring(u)) element is `array.get(ups, i)`
//     for v in line.all                  every line on the chart, oldest first
//         line.set_x2(v, bar_index)
//     while array.size(lbs) > N          the FIFO cap — the condition re-read
//         label.delete(array.shift(lbs)) before every pass, the oldest deleted
//
// ⛔ SERVED ONLY WHERE THE LOOP HAS ONE READING. A body that changes the list it
// walks, a loop variable that takes over another statement's name, a position in
// `line.all`, and `for … in line.all` deleting from two or more objects are all
// refused BY NAME — the capture that settles each is `vw-forin-collections`.
//
// Every expectation is Pine's own arrays run by hand over the same bars.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'
import { assertObjectProgram } from '../ast/objectProgram'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const HEAD = `//@version=5${LF}indicator(${Q}w${Q}, overlay=true, max_lines_count=500, max_boxes_count=500, max_labels_count=500)${LF}`
const tr = (lines, opts) => translatePine(`${HEAD}${lines.join(LF)}${LF}plot(close)${LF}`, opts)

const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 5) * 0.25, l: Math.min(o, c) - 1 - (i % 3) * 0.5, c, v: 1 }
})
const up = (i) => BARS[i].c > BARS[i].o
const run = (t, bars = BARS) => {
  const reader = t.objects ? objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false }) : null
  if (!reader) return { live: [], stats: {}, status: null }
  return evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const diag = (t) => t.objectDiagnostics || {}
const loops = (t) => {
  const out = []
  const walk = (list) => { for (const o of list || []) if (o.k === 'loop') { out.push(o); walk(o.body) } }
  walk(t.objects ? t.objects.ops : [])
  return out
}
const bornAt = (r, fam) => r.live.filter((o) => o.family === fam).map((o) => o.createdBar)
const near = (a, b) => Math.abs(a - b) < 1e-9

describe('⭐⭐ C40 — `for x in <drawing list>`: every slot, in index order', () => {
  it('the delete-all idiom: `for b in bs → box.delete(b)` then `array.clear(bs)`', () => {
    // One box a bar, pushed; every 10th bar the list is walked, every box
    // deleted, the list cleared — BEFORE that bar's own box is made.
    const t = tr([
      'var box[] bs = array.new_box()',
      'if bar_index % 10 == 0',
      '    for b in bs',
      '        box.delete(b)',
      '    array.clear(bs)',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
    ])
    expect(diag(t).droppedOps).toBe(0)
    expect(diag(t).loopBlockedCalls).toEqual([])
    expect(diag(t).forInRefused).toBeUndefined()
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    // Pine: the boxes of bars 50…59 (the walk at bar 50 deleted 40…49).
    expect(bornAt(r, 'box')).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59])
    expect(r.stats.deleted).toBe(50)
    // ⛔ NON-VACUITY: the legacy reader blocked the delete and left all 60.
  })

  it('`for [i, l] in ls`: the element AND its position, per pass', () => {
    const t = tr([
      'var line[] ls = array.new_line()',
      'if bar_index % 7 == 0',
      '    array.push(ls, line.new(bar_index, high, bar_index + 1, high))',
      'for [i, l] in ls',
      '    line.set_x2(l, bar_index)',
      '    l.set_y2(close + i)',
    ])
    expect(diag(t).droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    const lines = r.live.filter((o) => o.family === 'line')
    expect(lines.map((o) => o.createdBar)).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56])
    lines.forEach((o, i) => {
      expect(o.props.x2).toBe(N - 1)
      // slot i got `close + i` — the POSITION is Pine's index, 0 for the oldest
      expect(near(o.props.y2, BARS[N - 1].c + i)).toBe(true)
    })
  })

  it('a condition on the ELEMENT is read per pass (`if line.get_y1(l) > close`)', () => {
    // one line a bar at that bar's high; on the last bar every line whose y1 is
    // above the last close is deleted
    const t = tr([
      'var line[] ls = array.new_line()',
      'array.push(ls, line.new(bar_index, high, bar_index + 1, high))',
      'if barstate.islast',
      '    for l in ls',
      '        if line.get_y1(l) > close',
      '            line.delete(l)',
    ])
    expect(diag(t).droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    const want = BARS.map((b, i) => (b.h > BARS[N - 1].c ? null : i)).filter((x) => x !== null)
    expect(bornAt(r, 'line')).toEqual(want)
    // ⛔ NON-VACUITY: the condition really splits the list
    expect(want.length).toBeGreaterThan(0)
    expect(want.length).toBeLessThan(N)
  })

  it('⛔ an EMPTY list runs no pass — a `for … in` never counts down', () => {
    // `0 to size − 1` over an empty list is `0 to −1`, which Pine's COUNTED `for`
    // runs twice. The body here does not touch the element, so a pass is visible.
    const t = tr([
      'var line[] ls = array.new_line()',
      'if barstate.islast',
      '    for l in ls',
      `        label.new(bar_index, high, ${Q}pass${Q})`,
      `    label.new(bar_index, low, ${Q}control${Q})`,
    ])
    const r = run(t)
    expect(r.live.map((o) => o.props.text)).toEqual(['control'])
    const [loop] = loops(t)
    expect(loop.asc).toBe(true)
  })

  it('a body that draws nothing leaves no loop behind', () => {
    const t = tr([
      'var line[] ls = array.new_line()',
      'array.push(ls, line.new(bar_index, high, bar_index + 1, high))',
      'for l in ls',
      '    x = close + 1',
    ])
    expect(loops(t)).toEqual([])
    expect(diag(t).droppedOps).toBe(0)
  })

  it('inside a drawing helper, under the call\'s guard (elliot-wave `drawFibLevels`)', () => {
    const t = tr([
      'var line[] fibs = array.new_line()',
      'clearAll() =>',
      '    for ln in fibs',
      '        line.delete(ln)',
      '    array.clear(fibs)',
      'if bar_index % 9 == 0',
      '    clearAll()',
      'array.push(fibs, line.new(bar_index, high, bar_index + 1, high))',
    ])
    expect(diag(t).droppedOps).toBe(0)
    expect(diag(t).loopBlockedCalls).toEqual([])
    const r = run(t)
    expect(bornAt(r, 'line')).toEqual([54, 55, 56, 57, 58, 59])
  })

  it('two loops over lists of one family may reuse one loop variable', () => {
    const t = tr([
      'var a = array.new<box>()',
      'var b = array.new_box(0)',
      'if bar_index == 2',
      '    array.push(a, box.new(bar_index, high, bar_index + 2, low))',
      '    array.push(b, box.new(bar_index, high, bar_index + 1, low))',
      'if barstate.islast',
      '    for x in a',
      '        box.set_right(x, bar_index)',
      '    for x in b',
      '        box.set_right(x, bar_index + 5)',
    ])
    expect(diag(t).droppedOps).toBe(0)
    expect(diag(t).forInRefused).toBeUndefined()
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live.filter((o) => o.family === 'box').map((o) => o.props.right)).toEqual([N - 1, N + 4])
  })
})

describe('⛔ C40 (H14) — a drawing list created WITH SLOTS is not modelled: named, never run as an empty list', () => {
  // `var a = array.new_box(3)` holds three `na` slots in Pine. This runtime starts
  // every list empty, so `array.set(a, i, box.new(…))` wrote nothing and
  // `box.delete(array.get(a, i))` deleted nothing: the "replace my three boxes
  // every bar" idiom drew three more every bar and removed none — 180 boxes over
  // these 60 bars where Pine holds 3, with a clean ledger (measured at the base).
  const SRC = (ctor) => [
    `var a = ${ctor}`,
    'for i = 0 to 2',
    '    box.delete(array.get(a, i))',
    'for i = 0 to 2',
    '    array.set(a, i, box.new(bar_index, high + i, bar_index + 2, low))',
  ]
  for (const ctor of ['array.new_box(3)', 'array.new<box>(3)', 'array.new_box(3, na)']) {
    it(`\`${ctor}\`: the list is diverged from its creation, its deletes withheld and counted`, () => {
      const t = tr(SRC(ctor))
      expect(diag(t).collsDivergedWhy).toEqual(['a: coll:sized@3'])
      expect(diag(t).dropReasons['coll:diverged']).toBeGreaterThan(0)
      // the removal is a LOST removal — what the member door's partial-drawing rule refuses on
      expect((diag(t).lostRemovals || []).some((x) => x.via === 'coll:diverged' && x.family === 'box')).toBe(true)
    })
  }
  for (const ctor of ['array.new_box()', 'array.new_box(0)', 'array.new<box>()', 'array.new<box>(0)']) {
    it(`⛔ CONTROL — \`${ctor}\` is empty in Pine too and is modelled as before`, () => {
      const t = tr([
        `var a = ${ctor}`,
        'array.push(a, box.new(bar_index, high, bar_index + 2, low))',
        'if array.size(a) > 3',
        '    box.delete(array.shift(a))',
      ])
      expect(diag(t).collsDivergedWhy).toBeUndefined()
      expect(diag(t).droppedOps).toBe(0)
      expect(bornAt(run(t), 'box')).toEqual([57, 58, 59])
    })
  }

  it('a `for … in` over such a list is withheld with it, not run over nothing', () => {
    const t = tr([
      'var a = array.new<box>(50)',
      'for data in a',
      '    data.delete()',
      'for i = 0 to 2',
      '    a.set(i, box.new(bar_index, high + i, bar_index + 2, low))',
    ])
    expect(diag(t).collsDivergedWhy).toEqual(['a: coll:sized@3'])
    expect(loops(t).filter((o) => o.asc)).toEqual([])
    expect(diag(t).dropReasons['coll:diverged']).toBeGreaterThan(0)
  })
})

describe('⛔ C40 — a `for … in` with two readings is refused, by name', () => {
  it('a body that shortens the list it walks keeps the loop refusal (market-structure-break)', () => {
    const t = tr([
      'var box[] bs = array.new_box()',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'for b in bs',
      '    if close < open',
      '        box.delete(array.shift(bs))',
    ])
    expect(diag(t).forInRefused).toEqual(['the body changes `bs`, the list it walks@5'])
    expect(diag(t).loopBlockedCalls).toContain('box.delete')
    expect(loops(t)).toEqual([])
  })

  it('…so does one that only REPLACES a slot (`array.set`), and one that hands the list to a helper', () => {
    const set = tr([
      'var box[] bs = array.new_box()',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'for [i, b] in bs',
      '    array.set(bs, i, b)',
      '    box.set_right(b, bar_index)',
    ])
    expect(diag(set).forInRefused).toEqual(['the body changes `bs`, the list it walks@5'])
    expect(diag(set).loopBlockedCalls).toContain('box.set_right')
    const helper = tr([
      'var box[] bs = array.new_box()',
      'drop(arr) =>',
      '    box.delete(array.shift(arr))',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'for b in bs',
      '    if close < box.get_bottom(b)',
      '        drop(bs)',
    ])
    expect(diag(helper).forInRefused).toEqual(['the body changes `bs`, the list it walks@7'])
    expect(loops(helper)).toEqual([])
  })

  it('…and the method spelling (`bs.remove(0)`), and a body that reassigns the list itself', () => {
    for (const line of ['        bs.remove(0)', '        bs := other']) {
      const t = tr([
        'var box[] bs = array.new_box()',
        'var box[] other = array.new_box()',
        'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
        'for b in bs',
        '    box.set_right(b, bar_index)',
        '    if close < open',
        line,
      ])
      expect(diag(t).forInRefused, line).toEqual(['the body changes `bs`, the list it walks@6'])
      expect(loops(t)).toEqual([])
    }
  })

  it('⛔ inside a loop this reader does not run, a `for … in` is not run either', () => {
    const t = tr([
      'var box[] bs = array.new_box()',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'var int n = 0',
      'while n < 2',
      '    for b in bs',
      '        box.delete(b)',
      '    n += 1',
    ])
    expect(loops(t)).toEqual([])
    expect(diag(t).loopBlockedCalls).toContain('box.delete')
  })

  it('a loop variable that is also another statement\'s name is not taken over', () => {
    const t = tr([
      'var box[] bs = array.new_box()',
      'var box b = na',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'for b in bs',
      '    box.set_right(b, bar_index)',
    ])
    expect(diag(t).forInRefused).toEqual(['loop variable `b` is also declared outside the loop@6'])
    expect(diag(t).loopBlockedCalls).toContain('box.set_right')
  })

  it('⛔ CONTROL — a list of user-defined types is not this lane\'s: the legacy refusal, no note', () => {
    const t = tr([
      'type P',
      '    float y',
      'var ps = array.new<P>()',
      'for p in ps',
      `    label.new(bar_index, p.y, ${Q}x${Q})`,
    ])
    expect(diag(t).forInRefused).toBeUndefined()
    expect(diag(t).loopBlockedCalls).toContain('label.new')
  })
})

describe('⭐⭐ C40 — `for … in` over a bounded numeric window (C32) reads each element per pass', () => {
  const SRC = (order) => [
    'var int[] ups = array.new_int()',
    'if close > open',
    order === 'unshift' ? '    ups.unshift(bar_index)' : '    ups.push(bar_index)',
    'if ups.size() > 4',
    order === 'unshift' ? '    ups.pop()' : '    ups.shift()',
    'var tbl = table.new(position.top_right, 3, 10)',
    'if barstate.islast',
    '    for [i, u] in ups',
    '        tbl.cell(0, i, str.tostring(u))',
    `        tbl.cell(1, i, ${Q}#${Q} + str.tostring(i))`,
  ]
  const replay = (order) => {
    const ups = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) { if (order === 'unshift') ups.unshift(i); else ups.push(i) }
      if (ups.length > 4) { if (order === 'unshift') ups.pop(); else ups.shift() }
    }
    return ups
  }
  for (const order of ['push', 'unshift']) {
    it(`${order} window: one row per element, in Pine's index order`, () => {
      const t = tr(SRC(order))
      expect(diag(t).droppedOps).toBe(0)
      expect(diag(t).loopBlockedCalls).toEqual([])
      const r = run(t)
      expect(r.status).toBe(OBJECT_STATUS.OK)
      const tbl = r.live.find((o) => o.family === 'table')
      const col = (c) => tbl.cells.filter((x) => x.col === c).sort((a, b) => a.row - b.row).map((x) => x.props.text)
      const want = replay(order)
      expect(col(0)).toEqual(want.map(String))
      expect(col(1)).toEqual(want.map((_, i) => `#${i}`))
      expect(want).toHaveLength(4)
    })
  }

  it('⛔ a body that writes the window keeps the loop refusal', () => {
    const t = tr([
      'var int[] ups = array.new_int()',
      'if close > open',
      '    ups.push(bar_index)',
      'if ups.size() > 4',
      '    ups.shift()',
      'var tbl = table.new(position.top_right, 3, 10)',
      'if barstate.islast',
      '    for [i, u] in ups',
      '        tbl.cell(0, i, str.tostring(u))',
      '        array.set(ups, i, 0)',
    ])
    expect(loops(t)).toEqual([])
    expect(diag(t).loopBlockedCalls).toContain('table.cell')
  })
})

describe('⭐⭐ C40 — `for … in line.all` / `box.all` / `label.all`', () => {
  it('a body that only MOVES them is applied to every object of the family', () => {
    const t = tr([
      'line.new(bar_index, high, bar_index + 1, high)',
      'box.new(bar_index, high, bar_index + 1, low)',
      'if barstate.islast',
      '    for v in line.all',
      '        line.set_x2(v, bar_index + 3)',
    ])
    expect(diag(t).droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    const lines = r.live.filter((o) => o.family === 'line')
    expect(lines).toHaveLength(N)
    expect(lines.every((o) => o.props.x2 === N + 2)).toBe(true)
    // ⛔ only the lines: the boxes are another family's list
    expect(r.live.filter((o) => o.family === 'box').every((o) => o.props.right !== N + 2)).toBe(true)
  })

  it('a body that never touches the element still runs once per object', () => {
    const t = tr([
      'if bar_index < 3',
      '    line.new(bar_index, high, bar_index + 1, high)',
      'if barstate.islast',
      '    for v in line.all',
      `        label.new(bar_index, high, ${Q}one per line${Q})`,
    ])
    expect(diag(t).droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live.filter((o) => o.family === 'label')).toHaveLength(3)
  })

  it('the clear-all helper with nothing or one object to clear (trend-lines `f_clearAll`)', () => {
    // Everything is drawn on the last bar after the clear, so the walk meets an
    // empty chart — the shape the committed capture runs. ONE loop variable walks
    // three families: inside the helper each loop gets its own.
    const t = tr([
      'f_clearAll() =>',
      '    for [i, v] in line.all',
      '        line.delete(v)',
      '    for [i, v] in box.all',
      '        box.delete(v)',
      '    for [i, v] in label.all',
      '        label.delete(v)',
      'if barstate.islast',
      '    f_clearAll()',
      '    line.new(bar_index - 5, high, bar_index, high)',
      `    label.new(bar_index, high, ${Q}now${Q})`,
    ])
    expect(diag(t).droppedOps).toBe(0)
    expect(diag(t).loopBlockedCalls).toEqual([])
    expect(diag(t).forInRefused).toBeUndefined()
    expect(loops(t).map((o) => o.over.all)).toEqual(['line', 'box', 'label'])
    expect(new Set(loops(t).map((o) => o.elem)).size).toBe(3)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live.map((o) => o.family)).toEqual(['line', 'label'])
    // one object: both readings delete it
    const one = tr([
      'if bar_index == 3',
      '    line.new(bar_index, high, bar_index + 1, high)',
      'if barstate.islast',
      '    for v in line.all',
      '        line.delete(v)',
      `    label.new(bar_index, high, ${Q}after${Q})`,
    ])
    const r1 = run(one)
    expect(r1.status).toBe(OBJECT_STATUS.OK)
    expect(r1.live.map((o) => o.family)).toEqual(['label'])
    expect(r1.stats.deleted).toBe(1)
  })

  it('⛔ at the TOP level one loop variable across two families is refused by name', () => {
    const t = tr([
      'if barstate.islast',
      '    for v in line.all',
      '        line.delete(v)',
      '    for v in label.all',
      '        label.delete(v)',
      '    line.new(bar_index - 5, high, bar_index, high)',
    ])
    expect(diag(t).forInRefused).toEqual(['loop variable `v` already holds a line@6'])
    expect(diag(t).loopBlockedCalls).toEqual(['label.delete'])
  })

  it('⛔ UNWITNESSED: deleting from two or more is not run — the chart draws nothing, and says why', () => {
    const t = tr([
      'line.new(bar_index, high, bar_index + 1, high)',
      'if bar_index % 5 == 0',
      '    for v in line.all',
      '        line.delete(v)',
    ])
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.UNWITNESSED)
    expect(r.reason).toContain('for … in line.all')
    expect(r.reason).toContain('vw-forin-collections')
    expect(r.live).toEqual([])
  })

  it('⛔ a POSITION in `line.all` is never read', () => {
    const t = tr([
      'line.new(bar_index, high, bar_index + 1, high)',
      'for [i, v] in line.all',
      '    line.set_y2(v, close + i)',
    ])
    expect(diag(t).forInRefused).toEqual(['a position in `line.all` is read@4'])
    expect(diag(t).loopBlockedCalls).toContain('line.set_y2')
  })
})

describe('⭐⭐ C40 — the cap `while`: the oldest drawing is deleted until the list fits', () => {
  // Pine, by hand: one label per up bar pushed; while more than 3, shift + delete.
  const kept = (cap) => {
    const a = []
    for (let i = 0; i < N; i += 1) { if (up(i)) a.push(i); while (a.length > cap) a.shift() }
    return a
  }
  const SPELLINGS = {
    'label.delete(array.shift(a))': '    label.delete(array.shift(lbs))',
    'array.shift(a).delete()': '    array.shift(lbs).delete()',
    '(array.shift(a)).delete()': '    (array.shift(lbs)).delete()',
    'a.shift().delete()': '    lbs.shift().delete()',
  }
  for (const [name, body] of Object.entries(SPELLINGS)) {
    it(`\`while array.size(a) > 3\` → \`${name}\``, () => {
      const t = tr([
        'var label[] lbs = array.new_label()',
        'if close > open',
        '    array.push(lbs, label.new(bar_index, high, str.tostring(bar_index)))',
        'while array.size(lbs) > 3',
        body,
      ])
      expect(diag(t).droppedOps).toBe(0)
      expect(diag(t).loopBlockedCalls).toEqual([])
      const r = run(t)
      expect(r.status).toBe(OBJECT_STATUS.OK)
      expect(bornAt(r, 'label')).toEqual(kept(3))
      expect(r.live.map((o) => o.props.text)).toEqual(kept(3).map(String))
    })
  }

  it('⭐ it is a LOOP: a burst of four in one bar is trimmed in that bar (an `if` removes one)', () => {
    const SRC = (kw) => [
      'var line[] ls = array.new_line()',
      'if bar_index % 10 == 0',
      '    for k = 0 to 3',
      '        array.push(ls, line.new(bar_index, high + k, bar_index + 1, high + k))',
      `${kw} array.size(ls) > 2`,
      '    line.delete(array.shift(ls))',
    ]
    const whileRun = run(tr(SRC('while')))
    const ifRun = run(tr(SRC('if')))
    expect(whileRun.status).toBe(OBJECT_STATUS.OK)
    // Pine `while`: bar 50 pushed four, trimmed to the newest two at once.
    expect(whileRun.live.map((o) => [o.createdBar, o.props.y1 - BARS[50].h])).toEqual([[50, 2], [50, 3]])
    // ⛔ CONTROL — the `if` form is a different program: one removal a bar.
    expect(ifRun.live.length).toBe(2)
    expect(ifRun.stats.deleted).toBeLessThan(whileRun.stats.deleted + 1)
    expect(whileRun.stats.deleted).toBe(22)
  })

  it('`pop` from the back, a bound that is an expression, and a second list kept in step', () => {
    const t = tr([
      'var line[] ls = array.new_line()',
      'var label[] lb = array.new_label()',
      'var float[] ys = array.new_float()',
      'array.unshift(ls, line.new(bar_index, high, bar_index + 1, high))',
      'array.unshift(lb, label.new(bar_index, low, str.tostring(bar_index)))',
      'array.unshift(ys, high)',
      'while ls.size() > math.floor(11 / 2)',
      '    ls.pop().delete()',
      '    label.delete(array.pop(lb))',
      '    array.pop(ys)',
    ])
    expect(diag(t).droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(bornAt(r, 'line')).toEqual([55, 56, 57, 58, 59])
    expect(bornAt(r, 'label')).toEqual([55, 56, 57, 58, 59])
  })

  it('⛔ a body that does anything else is not a cap: the `while` refusal stands', () => {
    const t = tr([
      'var line[] ls = array.new_line()',
      'array.push(ls, line.new(bar_index, high, bar_index + 1, high))',
      'while array.size(ls) > 5',
      '    line.delete(array.shift(ls))',
      '    line.new(bar_index, low, bar_index + 1, low)',
    ])
    expect(loops(t)).toEqual([])
    expect(diag(t).loopBlockedCalls).toEqual(['line.delete', 'line.new'])
    // …nor is a bound that reads a length, nor two removals of the list per pass
    for (const body of [
      ['while array.size(ls) > array.size(ls) - 1', '    line.delete(array.shift(ls))'],
      ['while array.size(ls) > 5', '    line.delete(array.shift(ls))', '    line.delete(array.shift(ls))'],
      // …nor a loop that never shortens the list it measures
      ['while array.size(ls) > 5', '    line.delete(array.shift(other))'],
    ]) {
      const u = tr(['var line[] ls = array.new_line()', 'var line[] other = array.new_line()',
        'array.push(ls, line.new(bar_index, high, bar_index + 1, high))',
        'array.push(other, line.new(bar_index, low, bar_index + 1, low))', ...body])
      expect(loops(u)).toEqual([])
      expect(diag(u).loopBlockedCalls).toContain('line.delete')
    }
  })
})

describe('⛔ C40 — the cap `while`: what is not a cap, and what a cap cannot read', () => {
  const HEAD_LS = ['var line[] ls = array.new_line()', 'array.push(ls, line.new(bar_index, high, bar_index + 1, high))']

  it('a nested block in the body is not a cap (smart-money-volume-activity)', () => {
    const t = tr([
      ...HEAD_LS,
      'var line[] glow = array.new_line()',
      'array.push(glow, line.new(bar_index, low, bar_index + 1, low))',
      'while array.size(ls) > 5',
      '    array.shift(ls).delete()',
      '    if array.size(glow) > 5',
      '        array.shift(glow).delete()',
    ])
    expect(loops(t)).toEqual([])
    expect(diag(t).loopBlockedCalls).toContain('line.delete')
  })

  it('a bound this reader cannot compute drops the loop by name, with its removal counted', () => {
    // `lim` is reassigned in a loop the value walk does not fold, so it is not a value here
    const t = tr([
      ...HEAD_LS,
      'var int lim = 3',
      'for k = 0 to 1',
      '    lim := lim + k',
      'while array.size(ls) > lim',
      '    line.delete(array.shift(ls))',
    ])
    expect(diag(t).dropReasons['loop:bounds']).toBe(1)
    expect(diag(t).loopBoundsWhy.join(' ')).toContain('a `while` over the length of `ls`')
    expect((diag(t).lostRemovals || []).some((x) => x.via === 'loop:bounds' && x.family === 'line')).toBe(true)
    expect(diag(t).collsDivergedWhy).toEqual(['ls: loop:bounds@9'])
  })

  it('a bound that reads an UNMEASURED window reduction withholds the loop on that bar (C11c)', () => {
    // `array.max(w)` over an empty window is unmeasured; the cap may not run off it
    const t = tr([
      'var int[] w = array.new_int()',
      'if bar_index > 5 and close > open',
      '    w.push(2)',
      'if w.size() > 3',
      '    w.shift()',
      'var label[] lbs = array.new_label()',
      'array.push(lbs, label.new(bar_index, high, str.tostring(bar_index)))',
      'while array.size(lbs) > array.max(w)',
      '    label.delete(array.shift(lbs))',
    ])
    expect(diag(t).windowAmbiguousSteps).toBeGreaterThan(0)
    const [loop] = loops(t)
    expect(loop.cond).toBeTruthy()
    expect(loop.withhold).toBeTruthy()
    const r = run(t)
    expect(r.stats.withheldUnknown).toBeGreaterThan(0)
    // ⛔ nothing is drawn off a list whose length this run cannot know
    expect(r.live).toEqual([])
  })
})

describe('⛔ C40 — the program door and the runtime hold the new loop forms to their shape', () => {
  const P = (over) => ({ programVersion: 1, regs: [], colls: [], ops: [], ...over })
  const size = { v: 'size', coll: 'c' }
  const coll = [{ id: 'c', family: 'line', cap: 500 }]
  const drop = { k: 'collremove', coll: 'c', index: { v: 'const', value: 0 }, when: null }
  const create = { k: 'create', family: 'line', site: 's1', into: null, when: null, props: { x1: { v: 'bar' }, y1: { v: 'const', value: 1 }, x2: { v: 'bar' }, y2: { v: 'const', value: 1 } } }
  const push = { k: 'push', coll: 'c', value: { r: 'site', id: 's1' }, when: null }
  const cap = (body, cond = { v: 'cmp', op: '>', args: [size, { v: 'const', value: 2 }] }) => ({ k: 'loop', id: 'w', cond, body, when: null })

  it('a cap loop is ONE comparison over a list\'s length, and its body shortens that list', () => {
    expect(() => assertObjectProgram(P({ colls: coll, ops: [create, push, cap([drop])] }))).not.toThrow()
    expect(() => assertObjectProgram(P({ colls: coll, ops: [create, push, cap([{ k: 'collclear', coll: 'c', when: null }])] })))
      .toThrow(/must remove an element of a list its condition measures/)
    expect(() => assertObjectProgram(P({
      colls: coll,
      ops: [create, push, cap([drop], { v: 'bool', op: 'not', args: [{ v: 'cmp', op: '>', args: [size, { v: 'const', value: 2 }] }] })],
    }))).toThrow(/one comparison that reads a list's length/)
    expect(() => assertObjectProgram(P({
      colls: coll, ops: [create, push, { ...cap([drop]), from: { v: 'const', value: 0 }, to: { v: 'const', value: 1 } }],
    }))).toThrow(/exactly one/)
  })

  it('a walk names a family that has an `.all` and a register of that family', () => {
    const regs = [{ id: 'r', family: 'line' }, { id: 'b', family: 'box' }]
    const body = [{ k: 'delete', target: { r: 'reg', id: 'r' }, when: null }]
    const walk = (over, elem) => P({ regs, ops: [create, { k: 'loop', id: 'i', over, elem, body, when: null }] })
    expect(() => assertObjectProgram(walk({ all: 'line' }, 'r'))).not.toThrow()
    expect(() => assertObjectProgram(walk({ all: 'table' }, 'r'))).toThrow(/a walk is over/)
    expect(() => assertObjectProgram(walk({ all: 'line' }, 'b'))).toThrow(/declared line register/)
    expect(() => assertObjectProgram(P({
      regs, ops: [create, { k: 'loop', id: 'i', from: { v: 'const', value: 0 }, to: { v: 'const', value: 1 }, asc: false, body, when: null }],
    }))).toThrow(/asc is a flag/)
  })

  it('⛔ a cap pass that leaves the list as long as it was stops the run, by name', () => {
    // the removal is there (the door is satisfied) but its index is out of range
    const stuck = { k: 'collremove', coll: 'c', index: { v: 'const', value: 99 }, when: null }
    const r = evaluateObjects(P({ colls: coll, ops: [create, push, cap([stuck])] }), {
      barCount: 6, readNode: () => NaN, readTime: (i) => i,
    })
    expect(r.status).toBe(OBJECT_STATUS.LIMIT_EXCEEDED)
    expect(r.reason).toContain('did not shorten the list')
    // ⛔ CONTROL — the same program with the real removal runs clean and keeps two
    const ok = evaluateObjects(P({ colls: coll, ops: [create, push, cap([{ k: 'delete', target: { r: 'coll', id: 'c', index: { v: 'const', value: 0 } }, when: null }, drop])] }), {
      barCount: 6, readNode: () => NaN, readTime: (i) => i,
    })
    expect(ok.status).toBe(OBJECT_STATUS.OK)
    expect(ok.live.map((o) => o.createdBar)).toEqual([4, 5])
  })

  it('⛔ C17 — a cap whose list a withheld push may have changed is withheld, and marks the list', () => {
    // node 0 is unknown on bars 0–2 (the curtain): the push there is withheld,
    // so the length is unknown and the cap may not run off it.
    const guarded = { ...create, when: { v: 'graph', node: 0 } }
    const guardedPush = { ...push, when: { v: 'graph', node: 0 } }
    const prog = P({ colls: coll, ops: [guarded, guardedPush, cap([{ k: 'delete', target: { r: 'coll', id: 'c', index: { v: 'const', value: 0 } }, when: null }, drop])] })
    const ctx = (unknown) => ({ barCount: 8, readNode: () => 1, readTime: (i) => i, ...(unknown ? { readUnknown: (n, bar) => bar < 3 } : {}) })
    const r = evaluateObjects(prog, ctx(true))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.stats.withheldTainted).toBeGreaterThan(0)
    expect(r.live).toEqual([])
    // ⛔ CONTROL — with no curtain the same program caps the list at two
    expect(evaluateObjects(prog, ctx(false)).live.map((o) => o.createdBar)).toEqual([6, 7])
  })

  it('⛔ C17 — a cap whose bound is unknown deletes nothing from a list that is itself known', () => {
    // `c` gains two lines a bar and is cut back to the length of `d`; `d`'s push
    // is withheld on bars 0–2, so its length — the bound — is unknown from there.
    const colls = [...coll, { id: 'd', family: 'line', cap: 500 }]
    const mk = (site, y) => ({ ...create, site, props: { ...create.props, y1: { v: 'const', value: y }, y2: { v: 'const', value: y } } })
    const pushTo = (c, site) => ({ k: 'push', coll: c, value: { r: 'site', id: site }, when: null })
    const bound = { v: 'cmp', op: '>', args: [size, { v: 'size', coll: 'd' }] }
    const prog = P({ colls, ops: [
      mk('s1', 1), pushTo('c', 's1'), mk('s2', 2), pushTo('c', 's2'),
      { ...mk('s3', 3), when: { v: 'graph', node: 0 } }, { ...pushTo('d', 's3'), when: { v: 'graph', node: 0 } },
      cap([{ k: 'delete', target: { r: 'coll', id: 'c', index: { v: 'const', value: 0 } }, when: null }, drop], bound),
    ] })
    const ctx = (unknown) => ({ barCount: 8, readNode: () => 1, readTime: (i) => i, ...(unknown ? { readUnknown: (n, bar) => bar < 3 } : {}) })
    const r = evaluateObjects(prog, ctx(true))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.stats.deleted).toBe(0)
    // …and nothing of `c` is drawn: only `d`'s own lines of the known bars are
    expect(r.live.map((o) => [o.createdBar, o.props.y1])).toEqual([[3, 3], [4, 3], [5, 3], [6, 3], [7, 3]])
    // ⛔ CONTROL — with no curtain `c` is cut to `d`'s length on every bar
    const ok = evaluateObjects(prog, ctx(false))
    expect(ok.stats.deleted).toBe(8)
    expect(ok.live.filter((o) => o.props.y1 !== 3)).toHaveLength(8)
  })

  it('⛔ C17 — `<family>.all` is unknown once a create of the family was withheld: the walk is withheld', () => {
    const regs = [{ id: 'r', family: 'line' }]
    const guarded = { ...create, when: { v: 'graph', node: 0 } }
    const walk = { k: 'loop', id: 'i', over: { all: 'line' }, elem: 'r', when: null, body: [{ k: 'update', target: { r: 'reg', id: 'r' }, when: null, props: { x2: { v: 'const', value: 99 } } }] }
    const prog = P({ regs, ops: [guarded, walk] })
    const ctx = (unknown) => ({ barCount: 6, readNode: () => 1, readTime: (i) => i, ...(unknown ? { readUnknown: (n, bar) => bar < 2 } : {}) })
    const r = evaluateObjects(prog, ctx(true))
    expect(r.stats.withheldTainted).toBeGreaterThan(0)
    expect(r.live).toEqual([])
    // ⛔ CONTROL — with no curtain every line is moved
    const ok = evaluateObjects(prog, ctx(false))
    expect(ok.live).toHaveLength(6)
    expect(ok.live.every((o) => o.props.x2 === 99)).toBe(true)
  })

  it('⛔ the runtime lane\'s own object pass (`iterTrees`) keeps the program it had: the loops stay refused there', () => {
    const src = [
      'var box[] bs = array.new_box()',
      'array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'if barstate.islast',
      '    for b in bs',
      '        box.delete(b)',
    ]
    expect(loops(tr(src))).toHaveLength(1)
    const rt = tr(src, { objectIterTrees: true })
    expect(loops(rt)).toEqual([])
  })
})
