// app/src/components/chart/engine/__tests__/colourChainB4.test.js
//
// ─── LEGACY SEMANTICS (B4) — A NESTED `iff` OF NAMED COLOURS, AND A SUBJECT-LESS `switch` OF COLOURS ─
//
// The two shapes of the s245 report's G2 (repros written here; the scripts that use them,
// squeeze-momentum (LazyBear) and bbtrend, are licence-held and their captures stay in the run store,
// where `zzB4…` local measurement grades them: squeeze's histogram colour 628 of 628 bars, bbtrend's
// 617 of 617, both 0 before):
//   no pragma:  plot(close, color = iff(close > open, iff(close > close[1], lime, green), red))
//   v6:         c = switch / close > open => color.new(#089981, 25) / => color.new(#F23645, 50)
// Master drew the pane's gold; engine 58 withheld both (`pine:colour-unread`). TradingView's palette
// (study.palettes) is the leaves in reading order, and the per-bar colorer index picks one.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine.js'
import { interpret } from '../ast/interpret.js'

const bars = Array.from({ length: 60 }, (_, i) => {
  const c = 100 + 6 * Math.sin(i / 3) + (i % 4)
  const o = 100 + 6 * Math.sin((i - 1) / 3) + ((i + 2) % 4)
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 }
})
const outOf = (src) => {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal || null)).toBe(true)
  return t.outputs.filter((o) => o.kind !== 'alertcondition')
}
const presentationOf = (o) => o.presentation || {}
const paletteOf = (o) => presentationOf(o).palette || presentationOf(o).colorPalette || null

describe('⭐⭐ B4 — nested `iff` of named colours (v1, no pragma)', () => {
  const SRC = 'study("b4 iff")\nplot(close, color = iff(close > open, iff(close > close[1], lime, green), red))\n'
  it('carries a three-colour palette in reading order, nothing withheld', () => {
    const [o] = outOf(SRC)
    const p = presentationOf(o)
    expect(p.colorDynamic, JSON.stringify(p)).toBeFalsy()
    expect(JSON.stringify(o.refusal || null)).not.toMatch(/colour-unread/)
    expect(JSON.stringify(p)).toMatch(/#00FF00/i) // v1 lime (the v3 table)
    expect(JSON.stringify(p)).toMatch(/#008000/i) // green
    expect(JSON.stringify(p)).toMatch(/#FF0000/i) // red
  })
  it('the palette is the leaves in reading order and the per-bar index is the iff chain', () => {
    const [o] = outOf(SRC)
    const p = presentationOf(o)
    expect(p.colorPalette).toEqual(['#00FF00', '#008000', '#FF0000'])
    const col = interpret(p.colorIndex.ast, bars, undefined, undefined, undefined, { tf: 'D' })
    bars.forEach((b, i) => {
      if (i === 0) return
      const want = b.c > b.o ? (b.c > bars[i - 1].c ? 0 : 1) : 2
      expect(col[i], `bar ${i}`).toBe(want)
    })
  })
  it('⛔ a script\'s OWN `iff` is not Pine\'s: its own body decides (here it swaps the arms)', () => {
    const own = 'study("b4 iff own")\niff(c, a, b) => c ? b : a\nplot(close, color = iff(close > open, lime, red))\n'
    const [o] = outOf(own)
    const p = presentationOf(o)
    expect(p.colorUp).toBe('#FF0000')
    expect(p.colorDown).toBe('#00FF00')
  })
})

describe('⭐⭐ B4 — a subject-less `switch` of `color.new` names (v6)', () => {
  const SRC = [
    '//@version=6',
    'indicator("b4 switch")',
    'pos = color.new(#089981, 25)',
    'neg = color.new(#F23645, 50)',
    'c = switch',
    '    close > open => pos',
    '    => neg',
    'plot(close, color = c)',
  ].join('\n') + '\n'
  it('carries both colours with their own alphas, nothing withheld', () => {
    const [o] = outOf(SRC)
    const p = presentationOf(o)
    expect(p.colorDynamic, JSON.stringify(p)).toBeFalsy()
    const s = JSON.stringify(p).toLowerCase()
    expect(s).toMatch(/089981/)
    expect(s).toMatch(/f23645/)
  })
  it('⛔ the value lane is unchanged: a subject-less switch VALUE is still refused by name', () => {
    const v = ['//@version=6', 'indicator("b4 switch value")', 'x = switch', '    close > open => 1.0', '    => 2.0', 'plot(x)'].join('\n') + '\n'
    const t = translatePine(v, { strict: true, basePeriod: 'D' })
    expect(JSON.stringify(t.refusal || (t.outputs || []).map((o) => o.refusal))).toMatch(/pine:block/)
  })
  it('the bars the switch picks: the index column follows `close > open`', () => {
    const [o] = outOf(SRC)
    const p = presentationOf(o)
    // two leaves: TradingView's two palette entries, each at its own alpha (bbtrend's palette:
    // rgba(8,153,129,0.75), rgba(242,54,69,0.5)), picked by the first arm's condition
    expect(p.colorUp).toBe('#089981BF')
    expect(p.colorDown).toBe('#F2364580')
    const col = interpret(p.colorCondition.ast, bars, undefined, undefined, undefined, { tf: 'D' })
    bars.forEach((b, i) => expect(!!col[i], `bar ${i}`).toBe(b.c > b.o))
  })
})
