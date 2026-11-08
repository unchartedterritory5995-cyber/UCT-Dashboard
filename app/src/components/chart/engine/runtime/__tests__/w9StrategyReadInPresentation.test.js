// W9-OQ-N2 (2026-11-07): a `strategy.*` read in an output's PRESENTATION, with the broker DARK.
// The W9-OQ-N1 review (`reviews/W9-OQ-N1.md`) left one case open: `plot(close, color =
// strategy.position_size > 0 ? ...)`. The runtime lane's colour channel already withheld that row
// naming the read (RT6 `colour.refused`), but the host lane let the colour fall soft to
// `colorDynamic` and the member door drew the row in ONE colour, the platform default, with no
// disclosure on the pane: a broker value nobody computes, served as "flat" on every bar.
// The host lane now refuses that row `pine:strategy-call` by name; a fill whose colour reads the
// broker is not drawn. Pinned here with the forms that were already refused, on v5 and v6.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const head = (v) => `//@version=${v}\nstrategy("t", overlay = true)\n`
const host = (src) => translatePine(src, { strict: true })
const rt = (src, plotColours = false) => buildRuntimeIr(src, { bars: [], inputs: {}, plotColours })
const PLOT_COLOUR = 'plot(close, color = strategy.position_size > 0 ? color.green : color.red)\n'

describe.each(['5', '6'])('W9-OQ-N2 v%s strategy() — a broker read in a colour is refused by name', (v) => {
  const H = head(v)

  it('host: `plot(close, color = strategy.position_size > 0 ? ...)` refuses pine:strategy-call', () => {
    const t = host(H + PLOT_COLOUR)
    expect(t.ok).toBe(false)
    expect(t.outputs[0].refusal.guard).toBe('pine:strategy-call')
    expect(t.outputs[0].refusal.message).toContain('`strategy.position_size`')
  })

  it('host: the read behind a variable, a function, or inside `color.new` refuses too', () => {
    for (const b of [
      'c = strategy.position_size > 0 ? color.green : color.red\nplot(close, color = c)\n',
      'f() => strategy.position_size > 0 ? color.green : color.red\nplot(close, color = f())\n',
      'plot(close, color = color.new(color.red, strategy.opentrades > 0 ? 0 : 90))\n',
      'plotchar(close > open, "c", "x", color = strategy.position_size > 0 ? color.green : color.red)\nplot(close)\n',
    ]) {
      const t = host(H + b)
      expect(t.outputs.find((o) => o.refusal)?.refusal.guard, b).toBe('pine:strategy-call')
    }
  })

  it('host: only the reading row is refused; its sibling plot is translated', () => {
    const t = host(`${H}plot(close, "a", color = strategy.position_size > 0 ? color.green : color.red)\nplot(open, "b")\n`)
    expect(t.outputs[0].refusal.guard).toBe('pine:strategy-call')
    expect(t.outputs[1].refusal).toBeNull()
    expect(t.outputs[1].formula).toBe('open')
  })

  it('host: a fill whose colour reads the broker is not drawn', () => {
    const t = host(`${H}p1 = plot(close, "a")\np2 = plot(open, "b")\n`
      + 'fill(p1, p2, color = strategy.position_size > 0 ? color.green : color.red)\n')
    expect(t.ok).toBe(true)
    expect(t.presentation.fills).toEqual([])
    const ctl = host(`${H}p1 = plot(close, "a")\np2 = plot(open, "b")\nfill(p1, p2, color = color.red)\n`)
    expect(ctl.presentation.fills.length).toBe(1)
  })

  it('control: a colour that reads no broker value is still carried', () => {
    const t = host(`${H}plot(close, color = close > open ? color.green : color.red)\n`)
    expect(t.ok).toBe(true)
    expect(t.outputs[0].presentation.colorCondition.formula).toBe('close > open')
  })

  it('control: a constant selector that folds the read away keeps the colour (no over-refusal)', () => {
    const t = host(`${H}useS = input.bool(false)\n`
      + 'plot(close, color = useS ? (strategy.position_size > 0 ? color.green : color.red) : color.blue)\n')
    expect(t.ok).toBe(true)
    expect(t.outputs[0].refusal).toBeNull()
    expect(t.outputs[0].presentation.colorDynamic).toBeUndefined()
  })

  it('already refused (pinned): a value read, a plotshape series, a label text, a paint', () => {
    expect(host(`${H}plot(strategy.equity)\n`).outputs[0].refusal.guard).toBe('pine:strategy-call')
    expect(host(`${H}plotshape(strategy.position_size > 0)\nplot(close)\n`).outputs[0].refusal.guard).toBe('pine:strategy-call')
    const lbl = host(`${H}label.new(bar_index, high, str.tostring(strategy.opentrades))\nplot(close)\n`)
    expect(lbl.objectDiagnostics.createDropWhy.join(' ')).toContain('pine:strategy-call')
    const bg = host(`${H}bgcolor(strategy.position_size > 0 ? color.green : na)\nplot(close)\n`)
    expect(bg.presentation.paints[0].withheld.code).toBe('paint:colour')
  })

  it('runtime: the plot colour is refused naming the read; value reads and paints refuse the build', () => {
    const built = rt(H + PLOT_COLOUR, true)
    expect(built.ok).toBe(true)
    expect(built.ir.outputs[0].colour.refused).toContain('`strategy.position_size`')
    expect(rt(`${H}plot(strategy.equity)\n`).refusal.guard).toBe('pine:strategy-call')
    expect(rt(`${H}bgcolor(strategy.position_size > 0 ? color.green : na)\nplot(close)\n`).refusal.guard)
      .toBe('pine:strategy-call')
  })
})
