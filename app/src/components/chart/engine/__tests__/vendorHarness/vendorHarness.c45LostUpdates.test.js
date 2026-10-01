// ─── ⭐⭐ C45 (C44's decision 2) — AN OBJECT ONE OF WHOSE MOVES WAS LOST IS WITHHELD ──
//
// C44's paired comparison found it: volume-profile keeps its 200
// `line.new(bar_index, close, bar_index, close)` and loses the setters of
// `draw()` (`line.set_xy1(bars.get(i), x1, y)` — a target this chart cannot read,
// `update:target`). So it HELD 200 lines at their creation coordinates — bar 0,
// the first close — where TradingView holds 203 lines at 203 other places. The
// count nearly agreed; a count-only grade said nothing was wrong.
//
// THE RULE, as implemented (`pine.js`, `lostUnaddressed` / `lostMoveOf`): an
// object whose create converts and one of whose later MOVES (a required
// coordinate) or CAPTIONS was lost is withheld — "its position is unknown"
// generalised to "an update of it was lost". Where the lost step names its
// object, C22's per-bar mark or the handle's ledger carries it (as before);
// where it names a LIST (`bars.get(i)`) every object of that list is withheld;
// where it names nothing, every object of the family. A lost DELETE was already
// the member door's to refuse (`objectLoss.js`, `removes`).
//
// ⛔ ONE COUNT. The withheld creates are dropped under C25's own key
// (`geometry:lost`; a caption under C8's `content:lost`), through `dropped()` —
// so `droppedOps`, the member's "N of M drawing elements" and what is drawn are
// one ledger, not two.
//
// Graded on the committed captures of the scripts it changes, and on fixtures
// that tell the rule's edges apart (a style setter, an object that can never be
// drawn, a setter that IS carried).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { parent } from './c38Joined'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { assessObjectLoss, objectLossNote } from '../../ast/objectLoss'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0)

/** The member door on a source, and what its drawing holds on the last bar. */
function through(source, bars) {
  const door = enterMemberDoor(source)
  try {
    const t = door.built && door.built.translation
    const d = (t && t.objectDiagnostics) || {}
    let live = []
    if (door.def && door.def.objects && (door.def.objects.ops || []).length) {
      const reader = objectReaderFor(door.def, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
      const out = evaluateObjects(reader.program, {
        barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t, readUnknown: reader.readUnknown,
      })
      live = out.live
    }
    const count = (fam) => live.filter((o) => o.family === fam).length
    return { ok: !!door.def, refusal: door.refusal, t, d, live, count, note: objectLossNote(assessObjectLoss(t)) }
  } finally {
    if (door.def) registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
const ofCapture = (id) => {
  const cap = parent(id)
  return { cap, ...through(cap.source.text, toProductBars(cap)) }
}
const familyOf = (verdict, fam) => verdict.objects.counts.find((c) => c.family === fam)

describe('C45 — volume-profile: 200 lines held at bar 0 are withheld, by the one count', () => {
  const ID = 'volume-profile-rddt-1d-2026-09-28'

  it('⚰️ what was drawn before is not what TradingView holds: no vendor line sits at the creation coordinates', () => {
    const cap = parent(ID)
    const lines = cap.objects.records.lines
    expect(lines.length).toBe(203)
    // every `line.new(bar_index, close, bar_index, close)` is made on the first
    // bar: y = the first close, and x1 = x2 = that bar
    const firstClose = cap.bars.rows[0][4]
    expect(firstClose).toBe(50.44)
    expect(lines.filter((l) => l.y1 === firstClose || l.y2 === firstClose)).toEqual([])
    // …and TradingView's profile bars are not zero-length: 200 of 203 span bars
    expect(lines.filter((l) => l.x2 > l.x1).length).toBeGreaterThanOrEqual(200)
  })

  it('⭐ the lost setters name the LIST their target read, and every line of it is withheld', () => {
    const r = ofCapture(ID)
    expect(r.ok, r.refusal).toBe(true)
    expect(r.d.unaddressedUpdates).toEqual([
      'update:target@203 line.x1,y1 → list c0 moved',
      'update:target@204 line.x2,y2 → list c0 moved',
    ])
    expect(r.d.dropReasons['update:target']).toBe(3)             // the third is a colour: it withholds nothing
    expect(r.d.dropReasons['geometry:lost']).toBe(1)             // the one create site, in its loop
    expect(r.count('line')).toBe(0)
    // ⛔ ONE COUNT: every drop is in `droppedOps`, and the member's sentence is built from it
    expect(r.d.droppedOps).toBe(sum(r.d.dropReasons))
    expect(r.d.droppedOps).toBeLessThanOrEqual(r.d.attemptedOps)
    expect(r.note.note.startsWith(`${r.d.droppedOps} of ${r.d.attemptedOps} drawing elements in this script aren't supported yet`)).toBe(true)
  })

  it('graded: lines 203 / 0 — a DIVERGE that says so, where 203 / 200 hid 200 wrong positions', () => {
    const { verdict } = gradeCapture(parent(ID))
    expect(familyOf(verdict, 'lines')).toMatchObject({ vendor: 203, ours: 0, agree: false })
    expect(verdict.objects.verdict).toBe('DIVERGE')
  })
})

describe('C45 — atr-support-and-resistance: zones the lost loop extends are withheld (a count-only MATCH before)', () => {
  const ID = 'atr-support-and-resistance-rddt-1d-2026-09-28'

  it('⚰️ TradingView extends every box (`activeBox.set_right(bar_index)`); ours were made zero-width and never moved', () => {
    const cap = parent(ID)
    const { boxes, lines } = cap.objects.records
    expect(boxes.length).toBe(20)
    expect(lines.length).toBe(20)
    // the vendor's x is a dense rank of bars: right of left on EVERY box
    expect(boxes.filter((b) => b.x2 > b.x1).length).toBe(20)
    expect(lines.filter((l) => l.x2 > l.x1).length).toBe(16)
    // …and the script creates them with left == right (`upLeft` / `upRight` are both `bar_index`)
    expect(cap.source.text).toMatch(/upLeft = impUp \? bar_index : na/)
    expect(cap.source.text).toMatch(/upRight = impUp \? bar_index : na/)
    expect(cap.source.text).toMatch(/activeBox\.set_right\(bar_index\)/)
  })

  it('⭐ the four lists whose extending loop was lost hold nothing drawn', () => {
    const r = ofCapture(ID)
    expect(r.ok, r.refusal).toBe(true)
    expect(r.d.dropReasons['guard:loop']).toBe(4)                // the four extending loops, dropped whole
    expect(r.d.dropReasons['geometry:lost']).toBe(4)             // the four creates they would have moved
    expect(r.d.geometryWithheld).toMatchObject({ sites: 4, colls: 4 })
    expect(r.count('box')).toBe(0)
    expect(r.count('line')).toBe(0)
    expect(r.d.droppedOps).toBe(sum(r.d.dropReasons))
    expect(r.note.note.startsWith(`${r.d.droppedOps} of ${r.d.attemptedOps} drawing elements`)).toBe(true)
  })

  it('graded: boxes 20 / 0 and lines 20 / 0 — DIVERGE, where 20 / 20 was a count of zero-width zones', () => {
    const { verdict } = gradeCapture(parent(ID))
    expect(familyOf(verdict, 'boxes')).toMatchObject({ vendor: 20, ours: 0 })
    expect(familyOf(verdict, 'lines')).toMatchObject({ vendor: 20, ours: 0 })
    expect(verdict.objects.verdict).toBe('DIVERGE')
  })
})

describe('C45 — poor-man\'s-volume-profile: the two lines `line.set_xloc` moves are withheld', () => {
  const ID = 'poor-man039s-volume-profile-rddt-1d-2026-09-28'

  it('a setter the reader never carried is a lost move of every line it could reach', () => {
    const cap = parent(ID)
    // TradingView's two block lines span bars; the script makes them zero-length
    expect(cap.objects.records.lines.map((l) => l.x2 > l.x1)).toEqual([true, true])
    expect(cap.source.text).toMatch(/var line block_high_line = line\.new\(bar_index, high, bar_index, high/)
    const r = ofCapture(ID)
    expect(r.d.unaddressedUpdates).toEqual([
      'reader:unsupported@? line.set_xloc → every line moved',
      'reader:unsupported@? line.set_xloc → every line moved',
    ])
    expect(r.d.dropReasons).toEqual({ 'geometry:lost': 2 })
    expect(r.count('line')).toBe(0)
    expect(r.note.note).toMatch(/^2 of 246 drawing elements/)
    expect(r.note.note).toContain('It also uses `line.set_xloc`, which this chart doesn\'t draw yet.')
  })
})

describe('C45 — an object that can never be drawn is left alone', () => {
  const ID = 'multi-timeframe-supply-demand-zones-rddt-1d-2026-09-28'

  it('multi-timeframe-supply-demand-zones: 504 `box.new(na, na, na, na)` whose setters were lost with their loop — unchanged', () => {
    const r = ofCapture(ID)
    expect(r.ok, r.refusal).toBe(true)
    expect(r.d.geometryNeverDrawable).toBeGreaterThan(0)
    expect(r.d.dropReasons).toEqual({ 'loop:bounds': 4 })        // exactly what it lost before C45
    expect(r.d.geometryWithheld).toBeUndefined()
    expect(r.count('box')).toBe(504)
    // held, and not one of them drawable: a coordinate is `na` on every box
    expect(r.live.filter((o) => o.family === 'box').every((o) => ['left', 'top', 'right', 'bottom'].some((k) => !Number.isFinite(o.props[k])))).toBe(true)
    const { verdict } = gradeCapture(parent(ID))
    expect(familyOf(verdict, 'boxes')).toMatchObject({ vendor: 504, ours: 504, agree: true })
    expect(verdict.objects.verdict).toBe('MATCH')
  })
})

// ─── THE RULE'S EDGES, ON FIXTURES ───────────────────────────────────────────
const L = (...lines) => lines.join('\n')
const HEAD = ['//@version=5', 'indicator("c45", overlay=true, max_lines_count=100, max_labels_count=100, max_boxes_count=100)']
const PICK = 'pick(x) => x > 0 ? a : b'            // a handle this chart cannot name

describe('C45 — the rule\'s edges', () => {
  const bars = () => toProductBars(parent('vw-offset-na-spy-1d-2026-09-30'))
  const last = () => bars().length - 1

  it('CONTROL — a move this chart CARRIES is served exact: the line sits where the script put it', () => {
    const r = through(L(...HEAD,
      'var line l = line.new(bar_index, close, bar_index, close)',
      'if barstate.islast',
      '    line.set_xy1(l, bar_index - 10, close)',
      '    line.set_xy2(l, bar_index, close)',
      'plot(close)'), bars())
    expect(r.d.droppedOps).toBe(0)
    expect(r.d.unaddressedUpdates).toBeUndefined()
    expect(r.count('line')).toBe(1)
    const line = r.live[0]
    expect([line.props.x1, line.props.x2]).toEqual([last() - 10, last()])
    expect(line.props.y1).toBe(bars()[last()].c)
  })

  it('a move through a list slot the chart cannot read withholds the LIST (the volume-profile shape)', () => {
    const r = through(L(...HEAD,
      'var line[] rows = array.new_line()',
      'if barstate.isfirst',
      '    for i = 0 to 9',
      '        rows.push(line.new(bar_index, close, bar_index, close))',
      'var line other = line.new(bar_index, low, bar_index + 5, low)',
      'if barstate.islast',
      '    for i = 0 to 9',
      '        line.set_xy1(rows.get(i), bar_index - 10, close + i)',
      '        line.set_xy2(rows.get(i), bar_index, close + i)',
      'plot(close)'), bars())
    expect(r.d.unaddressedUpdates).toEqual([
      'update:target@10 line.x1,y1 → list c0 moved',
      'update:target@11 line.x2,y2 → list c0 moved',
    ])
    // the ten of the list are withheld; the line nothing lost a move of is drawn
    expect(r.count('line')).toBe(1)
    expect(r.live[0].props.x2 - r.live[0].props.x1).toBe(5)
    expect(r.d.dropReasons['geometry:lost']).toBe(1)
  })

  it('a move whose target names nothing withholds every object of the FAMILY, and no other family', () => {
    const r = through(L(...HEAD,
      'var line a = line.new(bar_index, close, bar_index, close)',
      'var line b = line.new(bar_index, open, bar_index, open)',
      'var label keep = label.new(bar_index, high, "kept")',
      PICK,
      'line.set_xy2(pick(close - open), bar_index, close)',
      'plot(close)'), bars())
    expect(r.d.unaddressedUpdates).toEqual(['update:target@7 line.x2,y2 → every line moved'])
    expect(r.count('line')).toBe(0)
    expect(r.count('label')).toBe(1)
    expect(r.d.dropReasons).toEqual({ 'update:target': 1, 'geometry:lost': 2 })
  })

  it('⛔ a lost STYLE setter withholds nothing: a colour Pine defaults is still Pine\'s', () => {
    const r = through(L(...HEAD,
      'var line a = line.new(bar_index, close, bar_index, close)',
      'var line b = line.new(bar_index, open, bar_index, open)',
      PICK,
      'line.set_color(pick(close - open), color.red)',
      'plot(close)'), bars())
    expect(r.d.dropReasons).toEqual({ 'update:target': 1 })
    expect(r.d.unaddressedUpdates).toBeUndefined()
    expect(r.count('line')).toBe(2)
  })

  it('a lost CAPTION through an unreadable target withholds every label (never drawn with its creation text)', () => {
    const r = through(L(...HEAD,
      'var label a = label.new(bar_index, close, "a")',
      'var label b = label.new(bar_index, open, "b")',
      'var line keep = line.new(bar_index, low, bar_index + 5, low)',
      PICK,
      'label.set_text(pick(close - open), "now")',
      'plot(close)'), bars())
    expect(r.d.unaddressedUpdates).toEqual(['update:target@7 label.text → every label captioned'])
    expect(r.count('label')).toBe(0)
    expect(r.count('line')).toBe(1)
    expect(r.d.dropReasons).toEqual({ 'update:target': 1, 'content:lost': 2 })
  })

  it('a setter the reader does not carry (`line.set_xloc`) withholds the lines, not the label beside them', () => {
    const r = through(L(...HEAD,
      'var line l = line.new(bar_index, close, bar_index + 1, close)',
      'var label m = label.new(bar_index, high, "kept")',
      'line.set_xloc(l, time, time + 1, xloc.bar_time)',
      'plot(close)'), bars())
    expect(r.d.unaddressedUpdates).toEqual(['reader:unsupported@? line.set_xloc → every line moved'])
    expect(r.count('line')).toBe(0)
    expect(r.count('label')).toBe(1)
  })

  it('placeholders nothing can ever fill are kept, undrawable, and the program is as it was', () => {
    const r = through(L(...HEAD,
      'var box[] zs = array.new_box()',
      'if barstate.isfirst',
      '    for i = 0 to 4',
      '        zs.push(box.new(na, na, na, na))',
      'pick(x) => x > 0 ? zs.get(0) : zs.get(1)',
      'box.set_top(pick(close - open), high)',
      'plot(close)'), bars())
    expect(r.d.unaddressedUpdates).toEqual(['update:target@8 box.top → every box moved'])
    expect(r.d.geometryNeverDrawable).toBe(1)
    expect(r.d.dropReasons['geometry:lost']).toBeUndefined()
    expect(r.count('box')).toBe(5)
    expect(r.live.every((o) => !Number.isFinite(o.props.top))).toBe(true)
  })
})

describe('C45 — across the committed corpus', () => {
  it('the scripts that lose an update with no readable target, by name', () => {
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBe(266)
    const named = []
    for (const f of files) {
      const door = enterMemberDoor(fs.readFileSync(path.join(CORPUS, f), 'utf8'))
      try {
        const d = (door.built && door.built.translation && door.built.translation.objectDiagnostics) || {}
        if (d.unaddressedUpdates) named.push(`${f.replace(/__.*$/, '')}: ${d.unaddressedUpdates.length}${door.def ? '' : ' (not attached)'}`)
      } finally {
        if (door.def) registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
    }
    // ⭐ MEASURED 2026-10-01, objects pane on: 16 of 266. THREE attach today —
    // and of those, ict-killzones' three lost captions reach a list of labels its
    // drawing does not show (its creates sit behind guards this chart cannot
    // read; its table is what is drawn, and is unchanged), so the two scripts a
    // member sees change are poor-man's-volume-profile and volume-profile. The
    // other thirteen are refused at the door for other reasons: the rule is
    // already in their translation the day they attach.
    // (atr-support-and-resistance is not in this list: its lost moves NAME their
    // lists — `activeBox = array.get(upBox, i)` in a loop dropped whole — and are
    // withheld by handle, above.)
    expect(named).toEqual([
      'correlation-matrix: 55 (not attached)',
      'fx-market-sessions: 12 (not attached)',
      'ict-institutional-order-flow-fadi: 28 (not attached)',
      'ict-killzones-pivots-tfo: 3',
      'market-structure-break-order-block: 4 (not attached)',
      'poor-man039s-volume-profile: 2',
      'previous-day-high-and-low-separators-dailyweekly: 3 (not attached)',
      'session-tpo-profile: 1 (not attached)',
      'smart-money-breakout-channels-algoalpha: 8 (not attached)',
      'smc-structures-and-multi-timeframe-fvg-ma-py: 8 (not attached)',
      'smt-divergence-ict-killzones: 1 (not attached)',
      'tehthomas-aligned-timeframe-fair-value-gaps: 7 (not attached)',
      'volume-delta-oi-delta-kioseff-trading: 22 (not attached)',
      'volume-profile-auto-line-v2: 4 (not attached)',
      'volume-profile-bar-magnified-order-blocks-jacobmagleby: 3 (not attached)',
      'volume-profile: 2',
    ])
  }, 240000)
})
