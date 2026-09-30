// app/src/components/chart/engine/__tests__/objectInterner.test.js
//
// ─── ⭐ C12r — ONE OBJECT PER DISTINCT SUBTREE ACROSS AN OBJECT PASS ─────────
//
// `interpret`'s cross-column memo is keyed on the node OBJECT, and every op's
// tree is resolved on its own, so two object trees reading one `var` held two
// copies of its accumulator and ran it twice (three times each with the
// warm-up probes). `makeInterner` gives the pass one object per shape.
import { describe, it, expect, vi } from 'vitest'

const sink = { real: 0 }
vi.mock('../ast/interpret', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    interpret: (tree, bars, inputs, budget, scalars, opts) => {
      const steps = []
      const out = mod.interpret(tree, bars, inputs, budget, scalars, { ...(opts || {}), stepSink: steps })
      if (!(opts && typeof opts.prefixProbe === 'number')) sink.real += steps.length
      return out
    },
  }
})

const { translatePine } = await import('../ast/pine')
const { objectReaderFor, makeInterner } = await import('../objectColumns')

const HEAD = '//@version=5\nindicator("i", overlay=true)\n'
const bars = Array.from({ length: 300 }, (_, i) => ({
  t: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
  o: 100, h: 102, l: 98, c: (i * 7919) % 3 ? 101 : 99, v: 1,
}))

describe('C12r — makeInterner', () => {
  it('⭐ equal shapes become one object; different shapes stay apart; nothing is mutated', () => {
    const intern = makeInterner()
    const a = { type: 'op', name: '+', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }
    const b = { type: 'op', name: '+', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }
    const c = { type: 'op', name: '+', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 2 }] }
    const snapshot = JSON.stringify(b)
    const ia = intern(a)
    const ib = intern(b)
    const ic = intern(c)
    expect(ib).toBe(ia)
    expect(ic).not.toBe(ia)
    expect(ic.args[0]).toBe(ia.args[0])
    expect(JSON.stringify(b)).toBe(snapshot)
    expect(JSON.stringify(ic)).toBe(JSON.stringify(c))
  })

  it('⭐ two object trees reading one `var` run its accumulator ONCE in the real pass', () => {
    const t = translatePine(`${HEAD}var int st = 0
if st == 2 and close > open
    label.new(bar_index, high, "A")
if st == 1 and close < open
    label.new(bar_index, low, "B")
if close > open
    st := 1
if close < open
    st := 2
plot(close)
`)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    sink.real = 0
    objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false })
    expect(sink.real).toBe(1)
  })
})
