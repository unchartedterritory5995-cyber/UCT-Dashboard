// app/src/components/chart/engine/__tests__/wscHostReadWindow.test.js
//
// ⭐⭐ engine 83 — WS-C: A DECLARED `max_bars_back` NEVER SHRINKS THE HOST'S PER-BAR READ WINDOW
// (coordinator ruling 2026-11-19).
//
// The host lanes size a per-bar read `x[e]` from ONE helper, `pine.js::historyReadBufferOf`: the plot lane's
// `barsAgo` window and the object lane's `{v:'at'}`. The buffer is max(declared, `AUTO_MAX_BARS_BACK`).
// ⚰️ Both took `declared.limit || AUTO_MAX_BARS_BACK`, so under `max_bars_back = 20` a read 25 back was withheld
// (and on the object lane, a runtime error) where TradingView draws it:
//   · M2, `close[25]` under `max_bars_back = 20` (`vw-w4-max-bars-back-m2`, AMEX:SPY 1D, committed; graded on
//     both lanes in `vendorHarness.wscAcceptance.test.js`);
//   · Q-MBB-1, `close[k]` and `ta.ema(close, 5)[k]`, k = `bar_index % 120`, under `max_bars_back = 50`
//     (`uctprobe-mbb-dyn` / `-late`, AMEX:SPY and NYSE:RDDT 1D: licence-held, graded locally, MATCH). Its
//     shape is railed here on SPY's own committed bars, with the values worked by hand.
// A read past the automatic buffer stays withheld (unwitnessed); a script that declares nothing, or declares at
// least the automatic buffer, is unchanged.
import { describe, it, expect, afterEach, vi } from 'vitest'
import path from 'node:path'
import { translatePine } from '../ast/pine.js'
import { interpret, historyReadMask } from '../ast/interpret.js'
import { AUTO_MAX_BARS_BACK, assertObjectProgram } from '../ast/objectProgram'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { loadCapture, HARNESS_DIR } from './vendorHarness/harness'

afterEach(() => { vi.unstubAllEnvs() })

// AMEX:SPY 1D from the listing, 8,510 bars (the M2 capture's own bars)
const M2 = loadCapture(path.join(HARNESS_DIR, 'vw-w4-max-bars-back-m2-spy-1d-2026-11-18.json')).capture
const BARS = M2.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const CLOSE = BARS.map((b) => b.c)
const LISTED = { historyFromListing: true }

const HEAD = (decl) => `//@version=5\nindicator("w", overlay = false${decl})\n`
const host = (src) => {
  const t = translatePine(src, { strict: true })
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t
}
const formula = (src) => { const t = host(src); return t.outputs[t.selected].formula }
/** each plot's values and root mask (1 = withheld), on SPY from the listing. `historyReadMask` answers `null`
 *  when no bar is withheld. */
const plotsOf = (src) => host(src).outputs.map((o) => {
  const mask = historyReadMask(o.ast, BARS, {}, undefined, undefined, LISTED)
  return {
    values: Array.from(interpret(o.ast, BARS, {}, undefined, undefined, LISTED)),
    mask: mask ? Array.from(mask) : BARS.map(() => 0),
  }
})
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

describe('the plot lane: `barsAgo`\'s window', () => {
  it('a declaration BELOW the automatic buffer does not shrink it; one above it is the buffer, as before', () => {
    const body = 'plot(close[bar_index % 900])\n'
    expect(formula(HEAD('') + body)).toBe(`barsAgo(close, mod(barindex, 900), ${AUTO_MAX_BARS_BACK})`)
    expect(formula(HEAD(', max_bars_back = 20') + body)).toBe(`barsAgo(close, mod(barindex, 900), ${AUTO_MAX_BARS_BACK})`)
    expect(formula(HEAD(', max_bars_back = 500') + body)).toBe('barsAgo(close, mod(barindex, 900), 500)')
  })

  it('Q-MBB-1\'s shape (`max_bars_back = 50`, k = bar_index % 120) on SPY: every `close[k]` is the bar k back', () => {
    const src = `${HEAD(', max_bars_back = 50')}k = bar_index % 120\ne = ta.ema(close, 5)\n`
      + 'plot(close[k], "close_k")\nplot(e[k], "ema_k")\n'
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const door = memberPaneDefinition({ source: src, id: 'u_wsc-host-window', name: 'w' })
    expect(door.ok, door.reason).toBe(true)
    expect(door.lane || 'host').toBe('host')
    const [closeK, emaK] = plotsOf(src)
    const hand = CLOSE.map((_, i) => CLOSE[i - (i % 120)])
    expect(same(closeK.values, hand)).toBe(true)
    expect(closeK.mask.every((m) => m === 0)).toBe(true)
    // reads past the declared 50 are among them, every 120 bars
    expect(BARS.filter((_, i) => i % 120 >= 50).length).toBeGreaterThan(4000)
    // `ema[k]` reads exactly what the script without a declaration reads (the measured automatic buffer)
    const [, twin] = plotsOf(src.replace(', max_bars_back = 50', ''))
    expect(same(emaK.values, twin.values)).toBe(true)
    expect(same(emaK.mask, twin.mask)).toBe(true)
    const servedPast50 = emaK.values.filter((v, i) => i % 120 >= 50 && !Number.isNaN(v) && emaK.mask[i] === 0)
    expect(servedPast50.length).toBeGreaterThan(4000)
  })

  it('⛔ a read past the automatic buffer stays WITHHELD (unwitnessed), as for a script that declares nothing', () => {
    const body = 'plot(close[bar_index % 450])\n'
    const [declared] = plotsOf(HEAD(', max_bars_back = 20') + body)
    const [undeclared] = plotsOf(HEAD('') + body)
    for (let i = 0; i < BARS.length; i += 1) {
      const k = i % 450
      if (k >= AUTO_MAX_BARS_BACK) {
        expect(declared.mask[i], `bar ${i}`).toBe(1)
      } else {
        expect(declared.mask[i], `bar ${i}`).toBe(0)
        expect(declared.values[i], `bar ${i}`).toBe(CLOSE[i - k])
      }
    }
    expect(declared.mask.filter((m) => m === 1).length).toBeGreaterThan(0)
    // the script that declares nothing is unchanged, and reads the same
    expect(same(declared.values, undeclared.values) && same(declared.mask, undeclared.mask)).toBe(true)
    // CONTROL: a declaration past the read (500) is the buffer, and every bar is read
    const [wide] = plotsOf(HEAD(', max_bars_back = 500') + body)
    expect(wide.mask.every((m) => m === 0)).toBe(true)
    expect(same(wide.values, CLOSE.map((_, i) => CLOSE[i - (i % 450)]))).toBe(true)
  })
})

describe('the object lane: `{v:\'at\'}`', () => {
  const atOf = (decl) => {
    const t = host(`${HEAD(decl)}label.new(bar_index, close[bar_index % 120])\n`)
    const found = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.v === 'at') { found.push(n); return }
      for (const v of Object.values(n)) walk(v)
    }
    walk(t.objects)
    expect(found).toHaveLength(1)
    return found[0]
  }

  it('the read carries the SAME buffer the plot lane writes', () => {
    expect([atOf('').limit, atOf('').auto]).toEqual([AUTO_MAX_BARS_BACK, true])
    expect([atOf(', max_bars_back = 20').limit, atOf(', max_bars_back = 20').auto]).toEqual([AUTO_MAX_BARS_BACK, true])
    expect([atOf(', max_bars_back = 500').limit, atOf(', max_bars_back = 500').auto]).toEqual([500, undefined])
  })

  it('under `max_bars_back = 20`, a label at `close[25]` is drawn; one past the automatic buffer is withheld, never a stop', () => {
    const at = atOf(', max_bars_back = 20')
    const n = 460
    const SRC = Array.from({ length: n }, (_, i) => 100 + i)
    const prog = (back) => ({ programVersion: 1, regs: [], colls: [], ops: [{ k: 'create', family: 'label', site: 's',
      into: null, when: { v: 'graph', node: 0 },
      props: { x: { v: 'bar' }, y: { ...at, args: [{ v: 'graph', node: 1 }, { v: 'graph', node: 2 }] },
        text: { v: 'const', value: 'L' } } }] })
    const ctx = (bar, back) => ({
      barCount: n,
      readNode: (node, b) => (node === 0 ? (b === bar ? 1 : 0) : node === 1 ? SRC[b] : back),
      readTime: (b) => 1_700_000_000 + b * 86400,
    })
    assertObjectProgram(prog())
    const read = evaluateObjects(prog(), ctx(100, 25))
    expect(read.status, read.reason).toBe(OBJECT_STATUS.OK)
    expect(read.live.map((o) => o.props.y)).toEqual([SRC[75]])
    const past = evaluateObjects(prog(), ctx(455, 450))
    expect(past.status, past.reason).toBe(OBJECT_STATUS.OK)
    expect(past.live).toEqual([])
  })
})
