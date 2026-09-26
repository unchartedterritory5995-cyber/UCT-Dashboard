// app/src/components/chart/engine/runtime/__tests__/colours.test.js
//
// ─── ⭐⭐ A COLOUR IS A VALUE IN THIS LANE, AND IT IS AN INTEGER ─────────────
//
// `bgcolor` and `barcolor` refused for one reason: a colour was not something
// this lane could hold. The columnar lane refuses one by name at
// `pine:colour-value` — correctly, because you cannot SCREEN on a colour, and
// that lane exists to produce screenable columns. This lane computes values for
// DRAWING, where a colour is exactly as much a value as a price is.
//
// ⛔⛔ AND THE KIND IS THE WHOLE TYPE SYSTEM. At run time a colour IS a number —
// a packed `0xTTBBGGRR` integer — so nothing downstream could tell one from a
// price. Both directions of that confusion are refused here, because they are
// the same mistake pointing opposite ways: `plot(color.red)` would draw a line
// at y = 5,394,687, and `bgcolor(close)` would paint the background whatever
// shade a PRICE happens to pack to.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { colourHexByName } from '../../ast/pine.js'
import { hexToPacked, transparencyToByte, COLOUR_FNS } from '../colours.js'
import { unpackColor } from '../../colorInt.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// ⭐ open and close CROSS, so a conditional colour is not one colour repeated.
const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 103, v: 10 },   // close > open
  { t: 1700086400, o: 104, h: 106, l: 100, c: 101, v: 11 },  // close < open
  { t: 1700172800, o: 101, h: 108, l: 100, c: 107, v: 12 },  // close > open
]
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return {
    outputs: program.outputs.map((o) => o.call),
    series: res.outputs.map((o) => Array.from(o, (v) => v >>> 0)),
  }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

const RED = hexToPacked(colourHexByName('color.red'), 0)
const GREEN = hexToPacked(colourHexByName('color.green'), 0)

describe('the packing is the engine\'s own, not a second one', () => {
  it('⛔⛔ THE BYTE ORDER IS 0xTTBBGGRR, and it round-trips', () => {
    // ⚰️ `colorInt.js` records why this is the trap: `0x0D819908` read as RGB is
    // a perfectly reasonable olive that renders without complaint, and read
    // correctly is `color.teal`. The correct order lands on palette constants
    // and the wrong one lands on nothing — so the rail checks the CHANNELS, not
    // just that some integer came back.
    const c = unpackColor(RED)
    expect(c.hex).toBe(colourHexByName('color.red'))
    expect(c.transparencyByte).toBe(0)
  })

  it('⭐ two spellings of one colour pack identically', () => {
    // `color.rgb(255, 82, 82)` IS `color.red` (#FF5252). A packer with the bytes
    // reversed passes every "did I get an integer" check and fails this one.
    expect(run('bgcolor(color.rgb(255, 82, 82))\nplot(close)').series[0][0]).toBe(RED)
  })

  it('⚠️ transparency is the exact inverse of what the renderer unpacks', () => {
    // The repo already renders `(byte / 255) * 100`; this is that, inverted. The
    // half-step (50 → 127.5) is NOT a measured vendor fact and is recorded as
    // such in `colours.js` — it is rounded so the round trip closes.
    expect(transparencyToByte(0)).toBe(0)
    expect(transparencyToByte(100)).toBe(255)
    // ⚰ A FIRST VERSION ASSERTED `transparencyToByte(50)` AGAINST ITSELF — both
    // sides called the same function, so swapping `Math.round` for `Math.trunc`
    // left it green. The property that actually distinguishes them is the ROUND
    // TRIP: rounding is what keeps every transparency within half a step of
    // where it started, and truncation drifts past that bound for any value
    // whose byte lands above .5 (t = 21 → byte 53 → 20.78, an error of 0.216
    // against a half-step of 0.196).
    const HALF_STEP = (100 / 255) / 2
    for (let t0 = 0; t0 <= 100; t0 += 1) {
      const back = unpackColor(COLOUR_FNS['color.new'].fn([RED, t0])).transparency
      expect(Math.abs(back - t0), `transparency ${t0}`).toBeLessThanOrEqual(HALF_STEP + 1e-9)
    }
  })

  it('⛔ `color.new` keeps the three colour bytes and changes only transparency', () => {
    const faded = run('bgcolor(color.new(color.red, 50))\nplot(close)').series[0][0]
    expect(unpackColor(faded).hex).toBe(unpackColor(RED).hex)
    expect(unpackColor(faded).transparencyByte).not.toBe(0)
  })
})

describe('the colour consumers run', () => {
  it('⭐ a conditional colour VARIES bar to bar', () => {
    // ⛔ THE VARIATION IS THE RAIL. On bars where the condition never flips, a
    // build that emitted one constant colour is indistinguishable from one that
    // evaluated the ternary (`lesson_a_fixture_that_cannot_distinguish…`).
    const r = run('bgcolor(close > open ? color.green : color.red)\nplot(close)')
    expect(r.outputs).toEqual(['bgcolor', 'plot'])
    expect(r.series[0]).toEqual([GREEN, RED, GREEN])
  })

  it('barcolor emits the same way', () => {
    expect(run('barcolor(color.red)\nplot(close)').series[0]).toEqual([RED, RED, RED])
  })

  it('a colour held in a variable reaches the consumer', () => {
    expect(run('c = close > open ? color.green : color.red\nbgcolor(c)\nplot(close)').series[0])
      .toEqual([GREEN, RED, GREEN])
  })
})

describe('⛔⛔ a colour and a price are never confused', () => {
  it('`plot(color.red)` is refused — it would draw a line at 5,394,687', () => {
    expect(RED).toBeGreaterThan(1e6)   // the number it would have plotted
    expect(refusalOf('plot(color.red)').guard).toBe('runtime:colour')
  })

  it('`bgcolor(close)` is refused — a price is not a shade', () => {
    expect(refusalOf('bgcolor(close)\nplot(close)').guard).toBe('runtime:colour')
  })

  it('`color.new(close, 50)` is refused at its first argument', () => {
    expect(refusalOf('bgcolor(color.new(close, 50))\nplot(close)').guard).toBe('runtime:colour')
  })

  it('⛔ CONTROL: a mixed ternary is not a colour', () => {
    // `cond ? color.red : 0` is a colour on one arm and a number on the other.
    // Answering "colour" for it would send a price into a colour slot silently.
    expect(refusalOf('bgcolor(close > open ? color.red : 0)\nplot(close)').guard)
      .toBe('runtime:colour')
  })

  it('⛔ CONTROL: an ordinary plot of an ordinary price still works', () => {
    // Without this, "refuse colours in plots" is equally satisfied by refusing
    // every plot.
    expect(run('plot(close)').series[0]).toEqual(BARS.map((b) => b.c))
  })
})

describe('⛔ the unserved colour calls keep their refusal', () => {
  it('`color.from_gradient` is NOT served, and says so', () => {
    // ⭐ 21 corpus scripts use it. It interpolates a ramp rather than packing a
    // colour, and TradingView's curve has not been observed — a guess would put
    // a shade on screen close enough to look right and wrong enough to be a
    // different colour from the vendor's.
    // ⛔ AND IT IS NAMED, because "not a colour" would be FALSE about it — it IS
    // a colour, this engine just does not compute it. Telling a member the wrong
    // one sends them to rewrite a line that is already correct.
    const r = refusalOf('bgcolor(color.from_gradient(close, 0, 1, color.red, color.green))\nplot(close)')
    expect(r.guard).toBe('runtime:colour')
    expect(r.message).toContain('color.from_gradient')
    expect(r.message).toMatch(/does not compute/)
    expect(r.message).not.toMatch(/is not one/)
  })
})

// --------------------------------------------------------------------------- //
// `na` IN A COLOUR SLOT — "do not paint this bar"
// --------------------------------------------------------------------------- //

/** ⛔ THE RAW SERIES, NOT `run()`'s. `run` coerces with `v >>> 0`, which turns
 *  NaN into 0 — and 0 is a REAL packed colour (transparent black). A test that
 *  read through that coercion could not tell "this bar was not painted" from
 *  "this bar was painted black", which is the entire distinction below. */
function runRaw(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o))
}

describe('⭐⭐ `na` is a colour — it is how a member says "not on this bar"', () => {
  // ⚰️ MEASURED: all THREE scripts the colour guard refuses across
  // `corpus/committed` are this one shape, and none of them is doing anything
  // exotic —
  //   barcolor(isInsideBar() ? insideBarColor : na, title="Inside Bar")
  //   bgcolor(bbg and (t1 or t2) ? color.new(cbg, tbg) : na)
  //   barcolor(bull ? color.lime : bear ? color.purple : na, offset = -2)
  // `holdsColour` demanded BOTH ternary arms be colours. `na` is Pine's untyped
  // null: it belongs to every type, including `color`, and a conditional paint
  // is the ONLY way to write `barcolor`/`bgcolor` that depends on the bar.
  //
  // ⭐ THE OLD GUARD'S CONCERN IS UNTOUCHED, and that is why this is narrow:
  // it was written against `cond ? color.red : 0`, where the other arm is a
  // PRICE-shaped number that would paint a plausible shade computed from the
  // wrong thing. `na` is not a number. The control below holds that line.

  it('⭐⭐ `bgcolor(cond ? colour : na)` RUNS, and paints only where cond holds', () => {
    // bars: close>open, close<open, close>open
    const [bg] = runRaw('bgcolor(close > open ? color.green : na)\nplot(close)')
    expect(bg[0]).toBe(GREEN)
    expect(bg[2]).toBe(GREEN)
    expect(Number.isNaN(bg[1]), 'the unpainted bar must be na, not a colour').toBe(true)
  })

  it('⭐ the arms the other way round — `cond ? na : colour`', () => {
    const [bg] = runRaw('bgcolor(close > open ? na : color.red)\nplot(close)')
    expect(Number.isNaN(bg[0])).toBe(true)
    expect(bg[1]).toBe(RED)
    expect(Number.isNaN(bg[2])).toBe(true)
  })

  it('⭐ `barcolor` takes it too — the corpus spelling', () => {
    const [bc] = runRaw('barcolor(close > open ? color.red : na)\nplot(close)')
    expect(bc[0]).toBe(RED)
    expect(Number.isNaN(bc[1])).toBe(true)
  })

  it('⭐⭐ NESTED — `bull ? a : bear ? b : na`, which is the third corpus script', () => {
    // The `no` arm is itself a ternary, so this only works if the rule
    // recurses rather than pattern-matching one level.
    const [bc] = runRaw(
      'barcolor(close > open ? color.green : close < open ? color.red : na)\nplot(close)')
    expect(bc[0]).toBe(GREEN)
    expect(bc[1]).toBe(RED)
  })

  it('a colour-or-na held in a VARIABLE reaches the consumer', () => {
    const [bg] = runRaw('c = close > open ? color.green : na\nbgcolor(c)\nplot(close)')
    expect(bg[0]).toBe(GREEN)
    expect(Number.isNaN(bg[1])).toBe(true)
  })

  it('⛔⛔ CONTROL — `cond ? colour : 0` is STILL REFUSED', () => {
    // ⭐ THE LINE THIS CHANGE MUST NOT CROSS. `0` is a number, and a number in
    // a colour slot paints a shade computed from the wrong thing. If this ever
    // goes green, `na` was admitted by loosening the type rule instead of by
    // naming Pine's untyped null.
    expect(refusalOf('bgcolor(close > open ? color.red : 0)\nplot(close)').guard)
      .toBe('runtime:colour')
  })

  it('⛔⛔ CONTROL — `cond ? colour : close` is STILL REFUSED', () => {
    // The same line, with the shape that actually appears in a member's script:
    // a series, not a literal, so nothing folds it to a constant first.
    expect(refusalOf('bgcolor(close > open ? color.red : close)\nplot(close)').guard)
      .toBe('runtime:colour')
  })

  it('⛔ CONTROL — `plot(cond ? colour : na)` is STILL REFUSED, the other direction', () => {
    // A plot draws numbers. Admitting `na` into the colour rule must not make a
    // colour acceptable where a NUMBER is wanted — that is the opposite-facing
    // half of the same confusion, and it has its own message.
    const r = refusalOf('plot(close > open ? color.red : na)')
    expect(r.guard).toBe('runtime:colour')
    expect(r.message).toMatch(/draws numbers/)
  })

  it('⛔ CONTROL — `cond ? na : na` is not a colour', () => {
    // Both arms null says nothing about the type, and answering "colour" for it
    // would admit an expression on the strength of what it does NOT contain.
    expect(refusalOf('bgcolor(close > open ? na : na)\nplot(close)').guard)
      .toBe('runtime:colour')
  })
})
