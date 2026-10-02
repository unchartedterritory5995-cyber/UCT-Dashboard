// ─── ⭐⭐ C45 — A TREE THAT COULD NOT BE COMPUTED IS UNKNOWN, NEVER `na` ─────────
//
// An object program's values are trees, each evaluated to a column. A tree the
// evaluator REFUSES (most often `budget:nodes` — a condition a few nodes over the
// 128-node cap, which is never raised) has no column, and `readNode` answered
// `NaN` for it. Downstream a `NaN` is Pine's `na`: a `NaN` condition is false,
// so a conditional text or colour took its LAST arm and the object was DRAWN
// with it.
//
// ⚰️ REPRODUCED BELOW ON TRADINGVIEW'S OWN BARS (`vw-offset-na-spy-1d-2026-09-30`,
// 300 SPY sessions): a label whose text is `big ? "UP" : "DOWN"`, where `big` is
// sixty `close[i] > 0` terms — true on every bar by arithmetic, so Pine writes "UP" —
// measured over the cap, failed, and the label read "DOWN".
//
// C41 closed this for a tree holding an `ltf` only. The rule is general: a failed
// tree is unknown on EVERY bar, in BOTH document forms (`objectColumns.js::
// withholdFailed`), so the runtime's own rule withholds what reads it (C17).
// ⛔ No budget moves. The tree is still refused, by name; nothing is drawn off it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { objectReaderFor, computeObjectColumns } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { buildGraph } from '../../ast/graph'
import { DEFAULT_BUDGET } from '../../ast/budget'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: not a capture — ${loaded.reason}`)
  return loaded.capture
}
const SPY = load('vw-offset-na-spy-1d-2026-09-30')
const BARS = toProductBars(SPY)
const CTX = { tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false }

/** `n` terms, each TRUE on every bar of a positive price series. */
const allTrue = (n) => Array.from({ length: n }, (_, i) => `close[${i}] > 0`).join(' and ')
const script = (n, call) => `//@version=5
indicator("c45 failed tree", overlay=true)
big = ${allTrue(n)}
if barstate.islast
    ${call}
`
/** Terms enough to pass the 128-node cap (each `close[i] > 0` and its `and`). */
const OVER = 60
const TEXT = 'label.new(bar_index, high, big ? "UP" : "DOWN")'
const COLOUR = 'label.new(bar_index, high, "x", color = big ? color.green : color.red)'

/** The member door, the object reader and one run. `asBefore` reads a failed node
 *  the way every lane did before C45: not unknown, so its `NaN` is used. */
function run(source, { asBefore = false } = {}) {
  const door = enterMemberDoor(source)
  try {
    expect(door.def, door.refusal).toBeTruthy()
    const reader = objectReaderFor(door.def, BARS, CTX)
    const failed = new Set(reader.failed)
    const readUnknown = asBefore
      ? (node, bar) => (failed.has(node) ? false : reader.readUnknown(node, bar))
      : reader.readUnknown
    const out = evaluateObjects(reader.program, {
      barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown,
    })
    return { reader, out, labels: out.live.filter((o) => o.family === 'label') }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

describe('C45 — the defect: a failed tree read `NaN`, and a conditional text took its last arm', () => {
  it('control: under the cap the tree computes and the label says what Pine says — "UP"', () => {
    const { reader, labels } = run(script(20, TEXT))
    expect(reader.failed).toEqual([])
    expect(labels.map((l) => l.props.text)).toEqual(['UP'])
  }, 60000)

  it('⚰️ reproduced: sixty terms measure over the 128 cap, the tree fails — and, read the old way, the label says "DOWN"', () => {
    const { reader, labels } = run(script(OVER, TEXT), { asBefore: true })
    expect(reader.failed.length).toBe(1)
    expect(reader.refusals.map((r) => r.guard)).toEqual(['budget:nodes'])
    const measured = /measures (\d+) and the cap is 128/.exec(reader.refusals[0].message)
    expect(measured, reader.refusals[0].message).toBeTruthy()
    expect(Number(measured[1])).toBeGreaterThan(128)
    // the wrong value a member saw: the condition is true on every bar
    expect(labels.map((l) => l.props.text)).toEqual(['DOWN'])
  }, 60000)

  it('⭐ fixed: the failed tree is unknown on every bar, the label is WITHHELD, and the refusal keeps its name', () => {
    const { reader, out, labels } = run(script(OVER, TEXT))
    expect(reader.failed.length).toBe(1)
    const node = reader.failed[0]
    for (const bar of [0, 1, 150, BARS.length - 1]) expect(reader.readUnknown(node, bar), `bar ${bar}`).toBe(true)
    expect(labels).toEqual([])
    expect(out.stats.created).toBe(0)
    expect(out.stats.withheldUnknown).toBeGreaterThan(0)
    expect(reader.refusals.map((r) => r.guard)).toEqual(['budget:nodes'])
  }, 60000)

  it('⭐ a conditional COLOUR is the same defect and the same fix: red was drawn, nothing is', () => {
    const before = run(script(OVER, COLOUR), { asBefore: true })
    expect(before.reader.failed.length).toBe(1)
    expect(before.labels.length).toBe(1)
    const red = String(before.labels[0].props.color).toLowerCase()
    const control = run(script(20, COLOUR))
    const green = String(control.labels[0].props.color).toLowerCase()
    expect(control.reader.failed).toEqual([])
    expect(red).not.toBe(green)            // the old read drew the LAST arm's colour
    const after = run(script(OVER, COLOUR))
    expect(after.labels).toEqual([])
    expect(after.out.stats.withheldUnknown).toBeGreaterThan(0)
  }, 60000)

  it('a tree that computes is not touched: no mask for a healthy node beside a failed one', () => {
    const { reader } = run(script(OVER, 'label.new(bar_index, close * 2, big ? "UP" : "DOWN")'))
    const failed = new Set(reader.failed)
    expect(failed.size).toBe(1)
    const create = reader.program.ops.find((op) => op.k === 'create' && op.family === 'label')
    const y = create.props.y
    expect(y.v).toBe('graph')
    expect(failed.has(y.node)).toBe(false)
    const last = BARS.length - 1
    expect(reader.readNode(y.node, last)).toBe(BARS[last].c * 2)
    expect(reader.readUnknown(y.node, last)).toBe(false)
  }, 60000)
})

describe('C45 — the GRAPH form (a document over the byte budget) follows the same rule', () => {
  const close = { type: 'series', name: 'close' }
  const over = (() => {
    // a comparison chain one node at a time until it is over the cap
    let t = { type: 'op', name: '>', args: [close, { type: 'num', value: 0 }] }
    for (let i = 0; i < 60; i += 1) {
      t = { type: 'op', name: 'and', args: [t, { type: 'op', name: '>', args: [close, { type: 'num', value: i + 1 }] }] }
    }
    return t
  })()

  it('a node over the cap fails, is unknown on every bar, and is reported with its guard; a healthy node is not', () => {
    const graph = buildGraph({ big: over, ok: close })
    const program = { ops: [{ props: { y: { v: 'graph', node: graph.outputRoots.big }, x: { v: 'graph', node: graph.outputRoots.ok } } }] }
    const cols = computeObjectColumns(graph, program, BARS, { tf: 'D', inputs: {}, budget: DEFAULT_BUDGET })
    expect(cols.failed).toEqual([graph.outputRoots.big])
    expect(cols.refusals.map((r) => r.guard)).toEqual(['budget:nodes'])
    for (const bar of [0, 7, BARS.length - 1]) {
      expect(cols.readUnknown(graph.outputRoots.big, bar), `bar ${bar}`).toBe(true)
      expect(cols.readUnknown(graph.outputRoots.ok, bar), `bar ${bar}`).toBe(false)
    }
    expect(Number.isNaN(cols.readNode(graph.outputRoots.big, 5))).toBe(true)
    expect(cols.readNode(graph.outputRoots.ok, 5)).toBe(BARS[5].c)
  })
})

describe('C45 — the two corpus programs that hold a failed tree, on their committed captures', () => {
  const failedOf = (id) => {
    const cap = load(id)
    const door = enterMemberDoor(cap.source.text)
    try {
      expect(door.def, door.refusal).toBeTruthy()
      const bars = toProductBars(cap)
      const reader = objectReaderFor(door.def, bars, {
        tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
        historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
      })
      return { reader, bars }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  }

  it('vdubus-pattern-gen: ONE tree at 129 nodes (cap 128) — unknown on every bar, never read as `na`', () => {
    const { reader, bars } = failedOf('vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28')
    expect(reader.failed.length).toBe(1)
    expect(reader.refusals.map((r) => r.guard)).toEqual(['budget:nodes'])
    expect(reader.refusals[0].message).toMatch(/measures 129 and the cap is 128/)
    for (const bar of [0, 300, bars.length - 1]) expect(reader.readUnknown(reader.failed[0], bar)).toBe(true)
  }, 120000)

  it('k-clustering: 48 trees that hold a runtime-lane placeholder inside — each unknown on every bar', () => {
    const { reader, bars } = failedOf('k-clustering-rddt-1d-2026-09-28')
    expect(reader.failed.length).toBe(48)
    expect(new Set(reader.refusals.map((r) => r.guard))).toEqual(new Set(['resolve:function']))
    for (const node of reader.failed) expect(reader.readUnknown(node, bars.length - 1), `node ${node}`).toBe(true)
  }, 120000)
})
