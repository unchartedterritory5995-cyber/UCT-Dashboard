// app/src/components/chart/engine/ast/candleBodyColours.test.js
//
// ─── ⭐⭐ e98 (candle bodies) — A CANDLE WHOSE COLOUR PICKS AMONG MORE THAN TWO COLOURS IS DRAWN ────────────────────
//
// The host door packed a candle colour only as one static colour or a two-colour rule (`pine.js::packedColourTreeOf`),
// so a body chosen from three colours was withheld ("picks among more than two colours"): institutional-smc's Heatmap
// Candles, two uptrick scripts. The plot path already carries such a chain as a palette and the index of the bar's
// entry (`colourIndexChain`); the candle now packs the same choice (`idx == 0 ? p0 : idx == 1 ? p1 : ... : na`), the
// one the binder makes for a line (`binder.pointColour`: no entry, no colour). A transparent (`na`) leaf is `na`.
// And a body colour passed BY POSITION (the sixth slot) is read as the wick and border are; it read "picks among more
// than two colours", a reason it did not have.
// ⛔ A colour still unreadable (a reassigned colour variable: volume-suite's CRV_COL) stays withheld by name.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { objectHexToPacked } from '../runtime/colours.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const v6 = (b) => `//@version=6\nindicator("e98 candle bodies", overlay = true)\n${b}`
const candleOf = (src) => translatePine(src, { strict: true }).outputs.find((o) => o && o.candle)
const IDX = '(close > open ? 0 : close < open ? 1 : 2)'
const chain = (p0, p1, p2) => `${IDX} == 0 ? ${p0} : ${IDX} == 1 ? ${p1} : ${IDX} == 2 ? ${p2} : 0 / 0`
const P = (hex) => objectHexToPacked(hex)

describe('e98 — a three-colour candle body is packed as the bar\'s palette entry', () => {
  it('each entry where the index names it, and no colour where it names none', () => {
    const c = candleOf(v6('c = close > open ? color.green : close < open ? color.red : color.gray\n'
      + 'plotcandle(open, high, low, close, "T", color = c, wickcolor = c, bordercolor = c)'))
    expect(c.presentation.colorPalette, 'non-vacuous: the plot reader made a palette').toEqual(['#4CAF50', '#F23645', '#787B86'])
    expect(c.candle.colours.color.formula).toBe(chain(P('#4CAF50'), P('#F23645'), P('#787B86')))
    // the wick and border are the same read
    expect(c.candle.colours.wickcolor).toBe(c.candle.colours.color)
  })

  it('a shared transparency rides each entry (the plot\'s opacity)', () => {
    const c = candleOf(v6('c = close > open ? color.new(color.green, 50) : close < open ? color.new(color.red, 50) : color.new(color.gray, 50)\n'
      + 'plotcandle(open, high, low, close, "T", color = c, wickcolor = c, bordercolor = c)'))
    expect(c.candle.colours.color.formula).toBe(chain(P('#4CAF5080'), P('#F2364580'), P('#787B8680')))
  })

  it('an `na` leaf is no colour (`na`), never a neighbour\'s', () => {
    const c = candleOf(v6('c = close > open ? color.green : close < open ? na : color.gray\n'
      + 'plotcandle(open, high, low, close, "T", color = c, wickcolor = c, bordercolor = c)'))
    expect(c.candle.colours.color.formula).toBe(chain(P('#4CAF50'), '0 / 0', P('#787B86')))
  })

  it('the door draws it as a candle with a body colour column', () => {
    const d = memberPaneDefinition({ source: v6('c = close > open ? color.green : close < open ? color.red : color.gray\n'
      + 'plotcandle(open, high, low, close, "T", color = c, wickcolor = c, bordercolor = c)') })
    expect(d.ok, d.reason).toBe(true)
    const candle = d.definition.plots.find((p) => p.style === 'candles')
    expect(candle && candle.ohlcColors && typeof candle.ohlcColors.body).toBe('string')
    expect('candlesNotDrawn' in d).toBe(false)
  }, 60000)
})

describe('e98 — a body colour passed by position is read', () => {
  const POSITIONAL = v6('plotcandle(open, high, low, close, "T", close > open ? color.green : color.red, '
    + 'close > open ? color.green : color.red, bordercolor = close > open ? color.green : color.red)')
  it('the sixth slot is the body: a two-colour rule, packed', () => {
    const c = candleOf(POSITIONAL)
    expect(c.candle.colours.color.formula).toBe(`close > open ? ${P('#4CAF50')} : ${P('#F23645')}`)
  })
  it('CONTROL: the same colour written by name packs the same tree', () => {
    const named = candleOf(v6('plotcandle(open, high, low, close, "T", color = close > open ? color.green : color.red, '
      + 'wickcolor = close > open ? color.green : color.red, bordercolor = close > open ? color.green : color.red)'))
    expect(candleOf(POSITIONAL).candle.colours.color.formula).toBe(named.candle.colours.color.formula)
  })
})

describe('e98 — a colour still unreadable stays withheld by name', () => {
  it('a colour variable reassigned in a block: withheld, "an expression this door cannot read yet"', () => {
    const src = v6('var color c = color.green\nif close > open\n    c := color.red\n'
      + 'plotcandle(open, high, low, close, "T", color = c, wickcolor = c, bordercolor = c)\nplot(close)')
    expect(candleOf(src).candle.colours.color).toEqual({ withheld: 'its colour is an expression this door cannot read yet' })
    const d = memberPaneDefinition({ source: src })
    expect(d.ok, d.reason).toBe(true)
    expect((d.candlesNotDrawn || [])[0], JSON.stringify(d.notes)).toMatchObject({ by: 'withheld', label: 'T' })
    expect(d.candlesNotDrawn[0].why).toMatch(/cannot read yet/)
  }, 60000)
})
