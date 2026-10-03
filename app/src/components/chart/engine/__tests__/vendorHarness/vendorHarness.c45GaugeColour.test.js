// ─── ⭐⭐ C45 — heat-map-seasons' gauge point: the one colour slot that was drawn wrong ──
//
// C37's colour column left ONE slot `carriedDiffers` across the 47 graded captures:
// heat-map-seasons' gauge point, `table.cell(…, "𖦹", bgcolor = color)` where
//
//     color = color_level > 0
//      ? color.from_gradient(color_level, 0, ta.highest(color_level, heat_sensative), color.yellow, color.red)
//      : color.from_gradient(color_level, ta.lowest(color_level, heat_sensative), 0, color.aqua, color.yellow)
//
// Two things were in the way, and they are different defects:
//
//  1. `color = …` — a variable NAMED `color` — was refused as `pine:statement`
//     (`boundName` answered null for any type word), so the name was never bound and
//     the cell's `bgcolor` was DROPPED: the cell kept the strip colour the loop wrote
//     underneath it (`#dde44f`) where TradingView draws `#f3e841`.
//     Fixed: a witnessed type word standing alone before `=` is the variable's name.
//
//  2. Bound, the colour is still not TradingView's (`#9fd974`): each arm's `ta.*` runs
//     only on the bars that arm is taken, so its window is the last 70 values of THOSE
//     bars. Measured below on the capture's own bar colours — that reading reproduces
//     every bar; the every-bar window this lane computes does not.
//     No tree says "the last N bars a condition held", so the colour is HELD, by name
//     (`{c:'held', why:'fn:conditional-history'}`), and the cell is not painted a guess.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import { censusOf } from './colourColumn'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { translatePine, boundName } from '../../ast/pine'
import { assertObjectProgram } from '../../ast/objectProgram'
import { evaluateObjects } from '../../objectRuntime'
import { fromGradient, hexToPacked } from '../../runtime/colours'
import { unpackColor } from '../../colorInt'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const ID = 'heat-map-seasons-rddt-1d-2026-09-28'
const CAP = (() => {
  const loaded = loadCapture(path.join(DIR, `${ID}.json`))
  if (!loaded.capture) throw new Error(`${ID}: not a capture — ${loaded.reason}`)
  return loaded.capture
})()
const build = (source) => memberPaneDefinition({ source, id: 'u_member-pane-c45gauge', name: 'c45' })
const HEAD = '//@version=5\nindicator("t", overlay=true)\n'

describe('C45 · 1 — a variable named `color` is a variable', () => {
  it('`boundName`: a witnessed type word ALONE before `=` is the name; with a type in front, or unwitnessed, it is not', () => {
    const id = (value) => ({ kind: 'ident', value })
    const eq = { kind: 'punct', value: '=' }
    expect(boundName([id('color'), eq], 1).value).toBe('color')
    // `color c = …` binds `c`; `color color = …` is not witnessed and binds nothing
    expect(boundName([id('color'), id('c'), eq], 2).value).toBe('c')
    expect(boundName([id('color'), id('color'), eq], 2)).toBeNull()
    // the other type words stay refused: no capture runs one as a variable
    for (const w of ['line', 'label', 'box', 'table', 'float', 'int', 'bool', 'string']) {
      expect(boundName([id(w), eq], 1), w).toBeNull()
    }
  })

  it('a plot coloured by it builds the document the same script builds with any other name', () => {
    const named = (n) => build(`${HEAD}${n} = close > open ? color.red : color.green\nplot(close, color = ${n})\n`)
    const a = named('color')
    const b = named('colr')
    expect(a.ok, a.reason).toBe(true)
    expect(JSON.stringify(a.definition.plots)).toBe(JSON.stringify(b.definition.plots))
    expect(a.definition.plots[0].colorUp).toBe('#FF5252')
    expect(a.definition.plots[0].colorDown).toBe('#4CAF50')
    // ⚰️ before: `pine:statement` on the declaration, and the plot's colour unread
    expect(translatePine(`${HEAD}color = close > open ? color.red : color.green\nplot(close, color = color)\n`).notes
      .filter((n) => n.code === 'pine:statement')).toEqual([])
  })

  it('a cell coloured by it carries the colour, as it does under any other name', () => {
    const cell = (n) => build(`${HEAD}${n} = close > open ? color.red : color.green\nvar tbl = table.new(position.top_right, 2, 2)\ntable.cell(tbl, 0, 0, "x", bgcolor = ${n})\n`)
    const a = cell('color')
    const b = cell('colr')
    expect(a.ok, a.reason).toBe(true)
    const bg = (d) => d.definition.objects.ops.find((o) => o.k === 'cell').props.bgcolor
    expect(bg(a)).toEqual(bg(b))
    expect(bg(a).node.c).toBe('if')
    expect(a.translation.objectDiagnostics.droppedPropNames || []).toEqual([])
  })

  it('`color.red` and `color(na)` still mean the namespace and the cast', () => {
    const d = build(`${HEAD}color = color.new(color.red, 0)\nc2 = color(na)\nplot(close, color = color)\nplot(open, color = c2)\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.inputs.find((i) => i.key === 'color').default).toBe('#FF5252')
  })
})

describe('C45 · 2 — what TradingView draws: each arm\'s `ta.*` sees only the bars that arm ran on', () => {
  // `color_level`, from the script itself through the member door (its own plot)
  const colourLevel = (() => {
    const src = CAP.source.text
    const cut = src.slice(0, src.indexOf('color = color_level > 0'))
    const door = enterMemberDoor(`${cut}\nplot(color_level, "cl")\n`)
    try {
      if (!door.def) throw new Error(door.refusal)
      const cols = registry.computeFor(door.def, toProductBars(CAP), undefined, {
        tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: CAP.newestBarIsForming ?? null,
        historyFromListing: !!(CAP.history && CAP.history.startsAtBar0 === true),
      })
      return Array.from(cols[door.built.rows[0].key])
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  })()
  const N = 70                                   // `heat_sensative = input.int(70, …)`
  const YELLOW = hexToPacked('#FFEB3B')
  const RED = hexToPacked('#FF5252')
  const AQUA = hexToPacked('#00BCD4')
  /** the vendor's `barcolor(color)` per bar: `0xAABBGGRR`, 0 where it drew none */
  const vendor = CAP.plotValues.rows.map((r) => r[CAP.plotValues.fields.indexOf('plot_0')])
  /** ⚠️ WITHIN ONE LEVEL PER BYTE, and the reason is measured, not assumed: the
   *  gradient truncates each channel, and where both ends hold the same byte
   *  (`0xFF` red in yellow→red, the opacity everywhere) `255·(1−w) + 255·w` lands
   *  on 255 or on 254.999… by the last bit of `w` — which rides on `color_level`,
   *  equal to the vendor's to 1e-12 and not to the bit. 26 of the 234 drawn bars
   *  differ by exactly that one level in one byte; a different WINDOW moves a
   *  channel by tens (the last bar: `#9fd974` against `#f3e841`). */
  const sameAsVendor = (packed, v) => {
    if (packed === null) return v === 0 || v === null
    if (!v) return false
    const u = unpackColor(packed)
    const near = (a, b) => Math.abs(a - b) <= 1
    return near(u.r, v & 0xff) && near(u.g, (v >>> 8) & 0xff) && near(u.b, (v >>> 16) & 0xff)
      && near(255 - u.transparencyByte, (v >>> 24) & 0xff)
  }
  const colourOf = (v, hi, lo) => (Number.isNaN(v) ? null
    : v > 0 ? fromGradient(v, 0, hi, YELLOW, RED) : fromGradient(v, lo, 0, AQUA, YELLOW))

  /** every arm's window over the last N BARS (non-`na` values) — what a tree computes */
  const everyBar = () => colourLevel.map((v, i) => {
    const win = colourLevel.slice(Math.max(0, i - N + 1), i + 1).filter((x) => !Number.isNaN(x))
    return colourOf(v, Math.max(...win), Math.min(...win))
  })
  /** each arm's window over the last N bars THAT ARM RAN ON */
  const perArm = () => {
    const pos = []
    const neg = []
    return colourLevel.map((v) => {
      if (Number.isNaN(v)) return null
      if (v > 0) { pos.push(v); return colourOf(v, Math.max(...pos.slice(-N)), NaN) }
      neg.push(v)
      return colourOf(v, NaN, Math.min(...neg.slice(-N)))
    })
  }
  const agreeing = (ours) => ours.filter((c, i) => sameAsVendor(c, vendor[i])).length

  it('the capture carries the vendor\'s colour on every bar: 632 rows, 234 of them drawn', () => {
    expect(colourLevel.length).toBe(632)
    expect(vendor.length).toBe(632)
    expect(vendor.filter((v) => v).length).toBe(234)
  })

  it('⭐ per-arm windows reproduce TradingView on EVERY bar — the gauge point\'s `#f3e841` among them', () => {
    const ours = perArm()
    expect(agreeing(ours)).toBe(632)
    const last = unpackColor(ours[ours.length - 1])
    expect([last.r, last.g, last.b]).toEqual([0xf3, 0xe8, 0x41])
  })

  it('⚰️ the every-bar window — what a tree computes — does NOT: it differs on the last bar', () => {
    const ours = everyBar()
    const n = agreeing(ours)
    expect(n).toBeLessThan(632)
    expect(n).toBeGreaterThan(550)               // right wherever one arm ran throughout its window
    expect(sameAsVendor(ours[ours.length - 1], vendor[vendor.length - 1])).toBe(false)
    const last = unpackColor(ours[ours.length - 1])
    expect([last.r, last.g, last.b]).toEqual([0x9f, 0xd9, 0x74])   // what the bound colour would have drawn
  })
})

describe('C45 · 2 — so the colour is HELD by name, and the cell is not painted a guess', () => {
  const d = build(CAP.source.text)
  const ops = (() => {
    const all = []
    const walk = (list) => { for (const o of list) { all.push(o); if (o.body) walk(o.body) } }
    walk(d.definition.objects.ops)
    return all
  })()

  it('the declaration is read (no `pine:statement`), and the gauge cell\'s colour is carried as `{c:\'held\'}`', () => {
    expect(d.ok, d.reason).toBe(true)
    expect((d.translation.notes || []).filter((n) => n.code === 'pine:statement' && n.line === 42)).toEqual([])
    const held = ops.filter((o) => o.k === 'cell' && o.props.bgcolor && o.props.bgcolor.node.c === 'held')
    expect(held.length).toBe(1)
    expect(held[0].props.bgcolor.node).toEqual({ c: 'held', why: 'fn:conditional-history' })
    expect(d.translation.objectDiagnostics.heldColours).toEqual(['fn:conditional-history `ta.highest`@43'])
    // nothing is DROPPED any more: the slot is known, and known to be unknown
    expect(d.translation.objectDiagnostics.droppedPropNames || []).toEqual([])
  })

  it('⭐ the colour column: no slot is carried-and-different (it was 1 — ours `#dde44f`, vendor `#f3e841`)', () => {
    const row = censusOf(CAP)
    const bad = row.objects.rows.filter((r) => r.state === 'carriedDiffers' || r.state === 'notCarried')
    expect(bad).toEqual([])
    expect(row.objects.tally['cell.bgcolor'].agree).toBe(29)
  }, 60000)

  it('the cell is held: 30 of TradingView\'s 31 cells are drawn, and the one missing is the gauge point', () => {
    const g = gradeCapture(CAP).verdict
    const cells = g.objects.counts.find((c) => c.family === 'tableCells')
    expect([cells.vendor, cells.ours]).toEqual([31, 30])
    const texts = g.objects.texts.find((t) => t.family === 'tableCells text')
    expect(texts.onlyVendor).toEqual(['𖦹'])
    expect(texts.onlyOurs).toEqual([])
  }, 60000)

  it('control: the SAME gradient with its `ta.*` bound above the ternary runs on every bar and is served', () => {
    const src = `${HEAD}lvl = close - ta.sma(close, 20)
hi = ta.highest(lvl, 70)
lo = ta.lowest(lvl, 70)
c = lvl > 0 ? color.from_gradient(lvl, 0, hi, color.yellow, color.red) : color.from_gradient(lvl, lo, 0, color.aqua, color.yellow)
var tbl = table.new(position.top_right, 2, 2)
table.cell(tbl, 0, 0, "x", bgcolor = c)
`
    const t = build(src)
    expect(t.ok, t.reason).toBe(true)
    const bg = t.definition.objects.ops.find((o) => o.k === 'cell').props.bgcolor.node
    expect(bg.c).toBe('if')
    expect([bg.then.c, bg.else.c]).toEqual(['grad', 'grad'])
    expect(t.translation.objectDiagnostics.heldColours).toBeUndefined()
  })

  it('control: a test that is the same on every bar runs ONE arm on every bar — not held', () => {
    const src = `${HEAD}useHi = input.bool(true, "hi")
lvl = close - ta.sma(close, 20)
c = useHi ? color.from_gradient(lvl, 0, ta.highest(lvl, 70), color.yellow, color.red) : color.red
var tbl = table.new(position.top_right, 2, 2)
table.cell(tbl, 0, 0, "x", bgcolor = c)
`
    const t = build(src)
    expect(t.ok, t.reason).toBe(true)
    expect(JSON.stringify(t.definition.objects)).not.toContain('"held"')
  })
})

describe('C45 · 2 — the object runtime: a held colour has no value, so what asked for it is held', () => {
  const HELD = { v: 'color', node: { c: 'held', why: 'fn:conditional-history' } }
  const program = (props) => ({
    programVersion: 1,
    regs: [],
    colls: [],
    ops: [{ k: 'create', family: 'label', site: 's1', when: null,
      props: { x: { v: 'bar' }, y: { v: 'const', value: 10 }, text: { v: 'text', node: { t: 'lit', s: 'x' } }, ...props } }],
  })

  it('the validator admits it with its reason and refuses one without', () => {
    expect(() => assertObjectProgram(program({ color: HELD }))).not.toThrow()
    expect(() => assertObjectProgram(program({ color: { v: 'color', node: { c: 'held' } } }))).toThrow(/names its reason/)
  })

  it('a label that asked for it is not drawn; the same label with a literal colour is', () => {
    const run = (props) => evaluateObjects(program(props), { barCount: 3, readNode: () => NaN })
    const held = run({ color: HELD })
    expect(held.live).toEqual([])
    expect(held.stats.created).toBe(3)
    expect(held.stats.objectsTainted).toBe(3)
    const lit = run({ color: { v: 'color', node: { c: 'lit', hex: '#FF5252' } } })
    expect(lit.live.length).toBe(3)
  })
})
