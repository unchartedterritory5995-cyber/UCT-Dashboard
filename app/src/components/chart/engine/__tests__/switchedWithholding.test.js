// app/src/components/chart/engine/__tests__/switchedWithholding.test.js
//
// ─── C12s — WHAT A SWITCHED RECURRENCE'S UNKNOWN BARS WITHHOLD, BOTH LANES ────
//
// A switched recurrence is exact where it is known and UNKNOWN elsewhere
// (`interpret.js::switchedVarSeed`). What reads it must be withheld wherever it
// could have read an unknown bar. Two mechanisms, and each rail below fails
// without its own:
//
//   the DEPENDENCY MASK (`switchedDependencyMask`) — read off the tree: every bar
//   within `maxLookback` reach of an unknown switched bar. It is what catches a
//   RANGE test and TWO unknowns probed at one value, which no probe can.
//
//   the PROBE — the tree re-run with the unknown bars filled; it is what catches
//   an INFINITE-memory reader (`ema` carries its state forever and declares only
//   its period as lookback), whose dependence outruns the declared reach.
//
// The reference everywhere is the SAME tree run from the listing (C12w): Pine's
// own value when bar 0 is the first bar. A withheld bar is never compared; a
// published one must equal it.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { interpret, switchedVarSeed, switchedDependencyMask } from '../ast/interpret'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'

afterEach(() => { vi.unstubAllEnvs() })

const barsOf = (closes) => closes.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }))
// up first: a rising run of ~11 bars, then falling — so a count that resets only
// on a FALLING bar is unknown on bars 0..10 behind the curtain
const UP_FIRST = barsOf(Array.from({ length: 300 }, (_, i) => 100 + 10 * Math.sin(i / 7)))
// down first: bar 1 falls
const DOWN_FIRST = barsOf(Array.from({ length: 300 }, (_, i) => 100 - 10 * Math.sin(i / 7)))

const close = { type: 'series', name: 'close' }
const self = { type: 'series', name: 'self' }
const num = (value) => ({ type: 'num', value })
const op = (name, ...args) => ({ type: 'op', name, args })
const down = op('<', close, { type: 'offset', value: 1, args: [close] })

describe('C12s — the plot lane', () => {
  // counts the non-falling bars; resets only on a falling one
  const counter = { type: 'call', name: 'accum', args: [switchedVarSeed(num(0)), op('?:', down, num(0), op('+', self, num(1))), num(250)] }
  const ema = { type: 'call', name: 'ema', args: [counter, num(3)] }

  it('⭐ an `ema` of a switched counter is withheld PAST its declared reach — the probe is what sees it', () => {
    const run = (o) => Array.from(interpret(ema, UP_FIRST, {}, undefined, undefined, o))
    const curtain = run()
    const raw = run({ switchedAgreement: false })
    const dep = switchedDependencyMask(ema, UP_FIRST, {}, undefined, undefined, {})
    const firstReset = UP_FIRST.findIndex((b, i) => i > 0 && b.c < UP_FIRST[i - 1].c)
    expect(firstReset).toBeGreaterThan(5)
    // the counter is unknown on bars 0..firstReset-1; `ema` declares 3 bars of
    // reach, so the dependency mask alone would publish from firstReset + 3 on —
    const i = firstReset + 4
    expect(dep[i]).toBe(0)
    expect(Number.isNaN(raw[i])).toBe(false)
    // — but `ema` carries those unknown bars forever, and the probe sees it
    expect(Number.isNaN(curtain[i])).toBe(true)
  })
})

describe('C12s — the object lane', () => {
  const pine = (lines) => ['//@version=5', 'indicator("c12s", overlay=true)', ...lines].join('\n')
  function objectsRun(src, bars, listing) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({ source: src, id: 'u_c12s_withhold', name: 'c12s' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, { tf: 'D', newestBarIsForming: false, ...(listing ? { historyFromListing: true } : {}) })
    return evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
  }

  it('⭐ a create guarded by a RANGE over TWO unknown counters is withheld, never skipped as known-false', () => {
    const src = pine([
      'up = close > close[1]',
      'dn = close < close[1]',
      'var int b = 0',
      'var int s = 0',
      'b := dn ? 0 : up ? b + 1 : b',
      's := up ? 0 : dn ? s + 1 : s',
      'if s > 0 and s < 2 and b < 1',
      '    label.new(bar_index, high, "S")',
      'plot(close)',
    ])
    const curtain = objectsRun(src, DOWN_FIRST, false)
    const listed = objectsRun(src, DOWN_FIRST, true)
    // Pine, from bar 0: bar 1 falls, so s = 1 and b = 0 — a label on bar 1
    expect(listed.live.some((o) => o.family === 'label' && o.props.x === 1)).toBe(true)
    // behind the curtain `s` has seen no reset on bar 1: the create is WITHHELD
    // (counted), not decided false — and nothing is drawn there
    expect(curtain.stats.withheldUnknown || 0).toBeGreaterThan(0)
    expect(curtain.live.some((o) => o.family === 'label' && o.props.x === 1)).toBe(false)
    // every label the curtain draws is one the listing run draws
    const at = new Set(listed.live.filter((o) => o.family === 'label').map((o) => `${o.props.x}@${o.props.y}`))
    for (const o of curtain.live.filter((x) => x.family === 'label')) expect(at.has(`${o.props.x}@${o.props.y}`)).toBe(true)
  })

  it('⭐ …and the object lane probes a switched tree over the WHOLE series, not only its declared reach', () => {
    // `ema(n, 200)` declares 450 bars of reach (250 + 200) but carries the unknown
    // bars 0..10 for thousands; a probe bounded to the reach would stop at ~453
    const bars = barsOf(Array.from({ length: 700 }, (_, i) => 100 + 10 * Math.sin(i / 7)))
    const src = pine([
      'dn = close < close[1]',
      'var int n = 0',
      'n := dn ? 0 : n + 1',
      'e = ta.ema(n, 200)',
      'if e > -1',
      '    label.new(bar_index, high, "E")',
      'plot(close)',
    ])
    const curtain = objectsRun(src, bars, false)
    expect(curtain.stats.withheldUnknown || 0).toBeGreaterThan(600)
  })

  it('⭐ a create guarded by an `ema` of a switched counter is withheld past the declared reach too', () => {
    const src = pine([
      'dn = close < close[1]',
      'var int n = 0',
      'n := dn ? 0 : n + 1',
      'e = ta.ema(n, 3)',
      'if e > 2.5 and e < 3.5',
      '    label.new(bar_index, high, "E")',
      'plot(close)',
    ])
    const curtain = objectsRun(src, UP_FIRST, false)
    const listed = objectsRun(src, UP_FIRST, true)
    const firstReset = UP_FIRST.findIndex((b, i) => i > 0 && b.c < UP_FIRST[i - 1].c)
    // withheld beyond `firstReset + 3`, where only the probe can see the dependence
    expect(curtain.stats.withheldUnknown || 0).toBeGreaterThan(firstReset + 3)
    const at = new Set(listed.live.filter((o) => o.family === 'label').map((o) => `${o.props.x}@${o.props.y}`))
    for (const o of curtain.live.filter((x) => x.family === 'label')) expect(at.has(`${o.props.x}@${o.props.y}`)).toBe(true)
  })
})
