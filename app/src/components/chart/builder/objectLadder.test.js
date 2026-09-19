// app/src/components/chart/builder/objectLadder.test.js
//
// ─── ⭐⭐ C3B — THE REACHABLE-OOS CAPABILITY LADDER, AND THE COST OF CLIMBING ─
//
// Ten levels of increasing semantic difficulty, each proved by BOTH a small
// first-party reduction (so the assertion is exact) AND, where the corpus has
// one, a real OOS script from the reachable 27 (so the capability is not just a
// property of fixtures written to pass).
//
// ⛔⛔ WHAT THIS FILE PROVES AND WHAT IT DOES NOT. It carries every level from
// Pine text through translation, lifecycle evaluation and the generic render
// state — i.e. to the point where the geometry, the text and the colours are
// decided. It does NOT prove pixels: `objectLayer`/`objectCanvas` have their
// own rails and `StockChart` mounts them, but a headless chart run is the only
// thing that proves a member SEES this, and the wave says a level is not
// complete from unit tests alone. So every level below is marked
// **RENDER-STATE PROVEN**, and the live-chart proof is reported as outstanding
// rather than implied.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { evaluateObjects } from '../engine/objectRuntime'
import { bindObjectProgram } from '../engine/ast/objectProgram'
import { toRenderState } from '../engine/objectRenderState'
import { interpret } from '../engine/ast/interpret'

const OOS = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')

const BARS = Array.from({ length: 300 }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100 + Math.sin(i / 7) * 5,
  h: 106 + Math.sin(i / 7) * 5,
  l: 94 + Math.sin(i / 7) * 5,
  c: 100 + Math.sin(i / 5) * 9 + i * 0.02,
  v: 1_000_000 + (i % 11) * 50_000,
}))

/** Pine text → the lifecycle result and the render state, over real-ish bars. */
function run(src, bars = BARS) {
  const t = translatePine(src)
  const program = t.objects
  if (!program) return { t, program: null }
  // ⛔ THE RUNTIME READS THE **BOUND** FORM. A translator emits `{v:'tree', i}`
  // against its own `trees` array; the runtime only knows `{v:'graph', node}`.
  // Binding identity-wise (tree index → "node" index) is the smallest honest
  // bridge, and it is what a document does for real via `toGraphDocument`.
  // ⚰️ The first draft of this helper skipped the bind and fed tree references
  // straight in — every guard evaluated `undefined`, every level created zero
  // objects, and eleven tests failed identically, which is the useful kind of
  // failure: one cause, one shape.
  const bound = bindObjectProgram(program, (i) => i)
  const cols = program.trees.map((tree) => {
    try { return interpret(tree, bars, {}) } catch { return null }
  })
  const res = evaluateObjects(bound, {
    barCount: bars.length,
    readNode: (node, bar) => {
      const c = cols[node]
      return c ? c[bar] : NaN
    },
    readTime: (i) => bars[i].t,
  })
  return { t, program, res, state: toRenderState(res.live, { bars }) }
}

const head = 'ta.sma(close, 20)'

describe('C3B ladder — LEVEL 1: stable line identity', () => {
  it('⭐ one line, born once, still one line 300 bars later', () => {
    const { res, state } = run(`//@version=5
indicator("L1", overlay = true)
var line l = na
if bar_index == 50
    l := line.new(bar_index, close, bar_index + 10, close)
plot(close, title = "C")
`)
    expect(res.stats.created).toBe(1)
    expect(res.live).toHaveLength(1)
    expect(res.live[0].createdBar).toBe(50)
    expect(state.lines).toHaveLength(1)
  })
})

describe('C3B ladder — LEVEL 2: create + update', () => {
  it('⭐ the same line is moved on every later bar and stays ONE object', () => {
    const { res, state } = run(`//@version=5
indicator("L2", overlay = true)
var line l = na
if bar_index == 50
    l := line.new(bar_index, close, bar_index, close)
if bar_index > 50
    line.set_x2(l, bar_index)
plot(close, title = "C")
`)
    expect(res.stats.created).toBe(1)
    expect(res.stats.updated).toBeGreaterThan(200)
    expect(res.live).toHaveLength(1)
    // the endpoint really moved — the last bar, not the 50th
    expect(res.live[0].props.x2).toBe(299)
    expect(state.lines[0].x2).toBe(BARS[299].t)
  })
})

describe('C3B ladder — LEVEL 3: create + update + delete', () => {
  it('⭐ a level that is drawn, tracked, and removed when it breaks', () => {
    const { res } = run(`//@version=5
indicator("L3", overlay = true)
ma = ${head}
var line l = na
if ta.crossover(close, ma)
    l := line.new(bar_index, ma, bar_index + 3, ma)
if ta.crossunder(close, ma)
    line.delete(l)
plot(ma, title = "MA")
`)
    expect(res.stats.created).toBeGreaterThan(3)
    expect(res.stats.deleted).toBeGreaterThan(2)
    // ⛔ AND THE ENVELOPE NEVER RAN AWAY: a create/delete cycle keeps the live
    // count near one, which is the whole point of having a lifetime.
    expect(res.stats.peakLive.line).toBeLessThan(4)
  })
})

describe('C3B ladder — LEVEL 4: var-held reference across bars', () => {
  it('⭐⭐ `var line l = na` … `l := …` … `line.set_*(l)` — the corpus’s own idiom', () => {
    const { program, res } = run(`//@version=5
indicator("L4", overlay = true)
var line l = na
var label tag = na
if ta.crossover(close, ${head})
    l := line.new(bar_index, low, bar_index, high)
    tag := label.new(bar_index, high, "X")
if not na(l)
    line.set_y2(l, high)
plot(close, title = "C")
`)
    expect(program.regs.map((r) => r.family).sort()).toEqual(['label', 'line'])
    expect(res.stats.created).toBeGreaterThan(2)
    expect(res.stats.updated).toBeGreaterThan(0)
  })
})

describe('C3B ladder — LEVEL 5: label lifecycle', () => {
  it('⭐ labels carry text, colour and size all the way to the render state', () => {
    const { state } = run(`//@version=5
indicator("L5", overlay = true)
if ta.crossover(close, ${head})
    label.new(bar_index, high, "BUY", style = label.style_label_down, color = color.green, textcolor = color.white, size = size.small)
plot(close, title = "C")
`)
    expect(state.labels.length).toBeGreaterThan(2)
    expect(state.labels[0]).toMatchObject({
      text: 'BUY', color: '#4CAF50', textcolor: '#FFFFFF', size: 'small', style: 'label_down',
    })
  })

  it('⭐⭐ …and a DYNAMIC label text is computed per bar, not once', () => {
    const { state } = run(`//@version=5
indicator("L5b", overlay = true)
if ta.crossover(close, ${head})
    label.new(bar_index, high, "C " + str.tostring(close, "#.##"))
plot(close, title = "C")
`)
    const texts = state.labels.map((l) => l.text)
    expect(texts.length).toBeGreaterThan(2)
    expect(new Set(texts).size).toBe(texts.length) // every one different
    expect(texts[0]).toMatch(/^C \d+\.\d\d$/)
  })
})

describe('C3B ladder — LEVEL 6: box lifecycle', () => {
  it('⭐ a zone is drawn with real corners and a border', () => {
    // ⚠️ THE GUARD IS `ta.crossover`, NOT `bar_index % 50 == 0`, AND THE REASON
    // IS WORTH RECORDING: `%` is not in this engine's expression grammar, so the
    // modulo version refuses with `dropReasons: {guard:create: 1}`. That is a
    // pre-existing VALUE-lane gap, not an object-lane one — the object pass read
    // the box perfectly and then had nowhere to get its condition from. Named
    // here so the next reader does not mistake it for a C3B limit.
    const { state } = run(`//@version=5
indicator("L6", overlay = true)
if ta.crossover(close, ${head})
    box.new(bar_index - 5, high, bar_index + 5, low, border_color = color.blue, bgcolor = color.new(color.blue, 90))
plot(close, title = "C")
`)
    expect(state.boxes.length).toBeGreaterThan(3)
    for (const b of state.boxes) {
      expect(b.top).toBeGreaterThan(b.bottom)
      expect(b.right).toBeGreaterThan(b.left)
      expect(b.border_color).toBe('#2962FF')
    }
  })
})

describe('C3B ladder — LEVEL 7: several families in one script', () => {
  it('⭐⭐ line + label + box + table, all alive at once, all independent', () => {
    const { res, state } = run(`//@version=5
indicator("L7", overlay = true)
var table t = table.new(position.top_right, 2, 2)
if bar_index == 100
    line.new(bar_index, low, bar_index + 20, high)
    label.new(bar_index, high, "L7")
    box.new(bar_index, high, bar_index + 10, low)
if barstate.islast
    table.cell(t, 0, 0, "Bars")
    table.cell(t, 1, 0, str.tostring(bar_index))
plot(close, title = "C")
`)
    expect(res.counts).toMatchObject({ line: 1, label: 1, box: 1, table: 1 })
    expect(state.tables[0].cells.map((c) => c.text)).toEqual(['Bars', '299'])
  })
})

describe('C3B ladder — LEVEL 8: bounded typed collection', () => {
  it('⭐ an object array holds handles, and the cap is real', () => {
    const { program, res } = run(`//@version=5
indicator("L8", overlay = true)
var lines = array.new_line()
if ta.crossover(close, ${head})
    l = line.new(bar_index, low, bar_index, high)
    array.push(lines, l)
plot(close, title = "C")
`)
    expect(program.colls).toHaveLength(1)
    expect(program.colls[0]).toMatchObject({ family: 'line', cap: 500 })
    expect(res.stats.created).toBeGreaterThan(2)
  })
})

describe('C3B ladder — LEVEL 9: a table dashboard', () => {
  it('⭐⭐ text, dynamic numbers and conditional colour reach every cell', () => {
    const { state } = run(`//@version=5
indicator("L9", overlay = true)
ma = ${head}
var table t = table.new(position.bottom_right, 2, 3, bgcolor = color.black)
if barstate.islast
    table.cell(t, 0, 0, "MA20", text_color = color.gray)
    table.cell(t, 1, 0, str.tostring(ma, "#.##"), text_color = close > ma ? color.green : color.red)
    table.cell(t, 0, 1, "Close")
    table.cell(t, 1, 1, str.tostring(close, "#.##"))
plot(ma, title = "MA")
`)
    expect(state.tables).toHaveLength(1)
    const cells = state.tables[0].cells
    expect(cells.map((c) => `${c.col},${c.row}`)).toEqual(['0,0', '1,0', '0,1', '1,1'])
    expect(cells[0].text).toBe('MA20')
    expect(cells[2].text).toBe('Close')
    // the numeric cells really carry numbers formatted to 2dp
    expect(cells[1].text).toMatch(/^\d+\.\d\d$/)
    expect(cells[3].text).toMatch(/^\d+\.\d\d$/)
    // the conditional colour resolved to ONE of the two branches, not to null
    expect(['#4CAF50', '#FF5252']).toContain(cells[1].text_color)
  })
})

describe('C3B ladder — LEVEL 10: a real reachable OOS composite', () => {
  const NAME = 'long_tail__16-spy-position-helper'

  it('⭐⭐ a published script from the reachable 27 draws its dashboard', () => {
    const src = fs.readFileSync(path.join(OOS, `${NAME}.pine`), 'utf8')
    const { t, program, res, state } = run(src)
    expect(t.ok).toBe(true)
    expect(program).toBeTruthy()
    // it declares a table and fills it
    expect(program.ops.filter((o) => o.k === 'cell').length).toBeGreaterThan(4)
    expect(res.status).toBe('ok')
    expect(state.tables).toHaveLength(1)
    expect(state.tables[0].cells.length).toBeGreaterThan(4)
    // ⛔ AND THE CELLS ARE NOT BLANK. A dashboard of empty strings is the
    // failure this whole text layer exists to prevent, and it would otherwise
    // pass every count-based assertion above.
    const nonEmpty = state.tables[0].cells.filter((c) => c.text && c.text.length)
    expect(nonEmpty.length).toBe(state.tables[0].cells.length)
  })

  it('⛔ …and what it could NOT carry is counted, not hidden', () => {
    const src = fs.readFileSync(path.join(OOS, `${NAME}.pine`), 'utf8')
    const t = translatePine(src)
    expect(t.objectDiagnostics).toBeTruthy()
    // a real script drops something; the point is that the number is readable
    expect(typeof t.objectDiagnostics.droppedOps).toBe('number')
    expect(t.objectDiagnostics.dropReasons).toBeTruthy()
  })
})
