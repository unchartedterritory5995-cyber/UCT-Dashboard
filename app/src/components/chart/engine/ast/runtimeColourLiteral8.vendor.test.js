// app/src/components/chart/engine/ast/runtimeColourLiteral8.vendor.test.js
//
// ─── ⭐⭐ R1 — AN EIGHT-DIGIT COLOUR LITERAL IN THE RUNTIME LANE — SPY 1D ─────
//
// `#RRGGBBAA`'s last byte is the OPACITY. The host lane reads it through
// `objectHexToPacked` (C48, witnessed by this capture's K rows); the runtime
// lane handed every colour literal to `hexToPacked`, which reads six digits
// only, so three corpus scripts refused as "not a colour this engine can read"
// (`correlation-matrix`, `ict-institutional-order-flow-fadi`,
// `volume-spikes-growing-volume-signals-with-alerts-scanner`).
//
// ⭐ HOW THE RUNTIME LANE IS MADE TO ANSWER. The probe's own `color.r(k1)` rows
// are folded by the COLUMNAR lane (a literal binding is pure), so lifting them
// verbatim would never reach the code R1 changed — measured: such a file stayed
// green with the fix reverted. Here the literals are bound with `var` (a
// constant `var` is that constant on every bar, so the vendor's numbers still
// apply), which makes them runtime slots, and painted with `bgcolor`, the
// runtime lane's colour output. The packed colour it emits is unpacked and held
// against the vendor's `color.r/g/b/t` rows K02..K07.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { unpackColor } from '../colorInt.js'
import { byteTransparency } from '../runtime/colours.js'

const REPO = path.resolve(process.cwd(), '..')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'vw-colour-components-spy-1d-2026-10-01.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
const LINES = cap.source.text.split('\n')
const pick = (re) => LINES.filter((l) => re.test(l))
const LITERALS = pick(/^k[12] = #/)
const SOURCE = [
  ...pick(/^\/\/@version=/), ...pick(/^indicator\(/),
  ...LITERALS.map((l) => `var ${l}`),
  'bgcolor(k1)',
  'bgcolor(k2)',
].join('\n')
const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
/** The vendor's column for plot row K0n (`plot_n`). */
const vendor = (n) => cap.plotValues.rows.map((r) => r[1 + n])

const run = () => {
  const built = buildRuntimeIr(SOURCE, { bars, inputs: {}, tf: 'D', ...runtimeClockOpts(false) })
  expect(built.ok, built.ok ? '' : JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  return program.outputs.map((o, k) => ({ call: o.call, col: Array.from(res.outputs[k]) }))
}
const channel = (col, ch) => col.map((v) => {
  const u = unpackColor(v)
  return ch === 't' ? byteTransparency(u.transparencyByte) : u[ch]
})
const disagreements = (ours, theirs) => ours.reduce((n, v, i) => n + (v === theirs[i] ? 0 : 1), 0)

describe('⭐⭐ `#RRGGBBAA` in the runtime lane — vw-colour-components, SPY 1D', () => {
  it('the lifted literals are what this file says they are', () => {
    expect(cap.symbol.pro_name).toBe('AMEX:SPY')
    expect(LITERALS).toEqual(['k1 = #0064C84D', 'k2 = #FF323280'])
    expect(cap.source.text).toMatch(/^plot\(color\.r\(k1\), "K02_lit8_0064C84D_r"\)$/m)
  })

  it('⭐⭐ the packed colour this lane paints holds the vendor\'s r/g/b/t on every bar', () => {
    const outs = run()
    expect(outs.map((o) => o.call)).toEqual(['bgcolor', 'bgcolor'])
    const [k1, k2] = outs.map((o) => o.col)
    expect(disagreements(channel(k1, 'r'), vendor(2))).toBe(0) // K02
    expect(disagreements(channel(k1, 'g'), vendor(3))).toBe(0) // K03
    expect(disagreements(channel(k1, 'b'), vendor(4))).toBe(0) // K04
    expect(disagreements(channel(k1, 't'), vendor(5))).toBe(0) // K05
    expect(disagreements(channel(k2, 't'), vendor(6))).toBe(0) // K06
    expect(disagreements(channel(k2, 'r'), vendor(7))).toBe(0) // K07
    // ⛔ NON-VACUITY: the transparencies are neither 0 nor 100 — the alpha byte
    // was READ, not dropped (an opaque or a clear colour would read 0 or 100).
    expect(vendor(5)[0]).toBe(70)
    expect(vendor(6)[0]).toBe(50)
  })
})
