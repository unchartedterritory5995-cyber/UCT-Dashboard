// app/src/components/chart/engine/ast/pine.w19h2TwoSeriesRsi.test.js
//
// ─── W19-H2 — Pine v4's two-series `rsi(x, y)`, in the one shape its manual equates ─
//
// The v4 reference (extracted 2026-10-05, quoted in
// `docs/pine/capture-queue-2026-10-05-w19-h2.md`): "If x is a series and y is a
// series then x and y are considered to be 2 calculated MAs for upward and downward
// changes", and its `mfi` example returns `rsi(upper, lower)` over
// `sum(volume * (change(src) <= 0 ? 0 : src), length)` / the same with `>= 0` — "the
// same on pine" as `mfi(src, length)`. With `src = hlc3` that is `mfiPine` (Pine's
// `ta.mfi(hlc3, n)`, measured to the last bit — `PINE_CALL_SHAPES.mfi`). Camarilla
// writes exactly those lines. ⛔ Every other two-series call keeps its refusal: the
// zero / `na` cases are unmeasured (Q-W19H2-c).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const REPO = path.resolve(process.cwd(), '..')
const v4 = (body) => `//@version=4\nstudy("x")\n${body}\n`
const UPPER = 'upper_s = sum(volume * (change(hlc3) <= 0 ? 0 : hlc3), 14)'
const LOWER = 'lower_s = sum(volume * (change(hlc3) >= 0 ? 0 : hlc3), 14)'
const tr = (src) => translatePine(src, { strict: true })

describe('⭐ W19-H2 — `rsi(upper, lower)` over the manual\'s money-flow sums is `mfi(hlc3, n)`', () => {
  it('the manual\'s shape translates to `mfiPine`; an ordinary `rsi(src, n)` beside it is untouched', () => {
    const t = tr(v4(`${UPPER}\n${LOWER}\nplot(rsi(upper_s, lower_s))\nplot(rsi(close, 14))`))
    expect(t.refusal).toBeFalsy()
    expect(t.outputs[0].formula).toBe('mfiPine(high, low, close, volume, 14)')
    expect(t.outputs[1].formula).toBe('rsi(close, 14)')
  })

  it('written inline (no bindings) it is the same identity', () => {
    const t = tr(v4('plot(rsi(sum(volume * (change(hlc3) <= 0 ? 0 : hlc3), 9), sum(volume * (change(hlc3) >= 0 ? 0 : hlc3), 9)))'))
    expect(t.outputs[0].formula).toBe('mfiPine(high, low, close, volume, 9)')
  })

  it('⛔ a general pair of series keeps the `pine:window` refusal', () => {
    expect(tr(v4(`${UPPER}\nplot(rsi(upper_s, close))`)).refusal.guard).toBe('pine:window')
  })

  it('⛔ the sums swapped, another source, or two lengths are NOT the identity', () => {
    expect(tr(v4(`${UPPER}\n${LOWER}\nplot(rsi(lower_s, upper_s))`)).refusal).toBeTruthy()
    const close = (c) => c.replace(/hlc3/g, 'close')
    expect(tr(v4(`${close(UPPER)}\n${close(LOWER)}\nplot(rsi(upper_s, lower_s))`)).refusal).toBeTruthy()
    expect(tr(v4(`${UPPER}\n${LOWER.replace('14', '15')}\nplot(rsi(upper_s, lower_s))`)).refusal).toBeTruthy()
  })

  it('⛔ only v4: v5 `ta.rsi` takes a length, and the shape there still refuses', () => {
    const v5 = `//@version=5\nindicator("x")\nu = math.sum(volume * (ta.change(hlc3) <= 0 ? 0 : hlc3), 14)\nd = math.sum(volume * (ta.change(hlc3) >= 0 ? 0 : hlc3), 14)\nplot(ta.rsi(u, d))\n`
    expect(tr(v5).refusal).toBeTruthy()
  })

  it('camarilla (corpus) translates on the host lane (its wall was this `rsi`)', () => {
    const src = fs.readFileSync(path.join(REPO, 'corpus/committed/camarilla__jw9faob08r.pine'), 'utf8')
    const t = tr(src)
    expect(t.refusal).toBeFalsy()
    // Its TKE line (which reads `mfi`) is drawn only under `showTKEdots`, off by default,
    // so the default chart carries no `mfiPine` output; the wall that stopped it is gone.
    // Control: the same script with a GENERAL pair there refuses at that line.
    const general = tr(src.replace('mfi= rsi(upper_s, lower_s)', 'mfi= rsi(upper_s, close)'))
    expect(general.refusal && general.refusal.guard).toBe('pine:window')
    expect(general.refusal.line).toBe(353)
  })

  it('the identity on real bars: `mfiPine` IS `100 - 100 / (1 + upper / lower)` wherever lower is not 0', () => {
    const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/vw-nvi-pvi-spy-1d-full-2026-09-27.json'), 'utf8'))
    const bars = cap.bars.rows.slice(0, 600).map(([t, o, h, l, c, v]) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), o, h, l, c, v }))
    const run = (f) => Array.from(interpret(parseFormula(f).ast, bars, {}, undefined, undefined, { tf: 'D' }))
    const ours = run('mfiPine(high, low, close, volume, 14)')
    const hlc3 = '((high + low + close) / 3)'
    const up = run(`sum(volume * (change(${hlc3}) <= 0 ? 0 : ${hlc3}), 14)`)
    const dn = run(`sum(volume * (change(${hlc3}) >= 0 ? 0 : ${hlc3}), 14)`)
    let compared = 0
    for (let i = 14; i < bars.length; i++) {
      if (!(dn[i] !== 0) || !Number.isFinite(up[i]) || !Number.isFinite(dn[i])) continue
      compared += 1
      expect(ours[i]).toBeCloseTo(100 - 100 / (1 + up[i] / dn[i]), 9)
    }
    expect(compared).toBeGreaterThan(500)
  })
})
