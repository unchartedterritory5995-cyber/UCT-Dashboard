// app/src/components/chart/engine/ast/pine.depth.test.js
//
// ─── R1.1(b) — THE HANG WAS A SWALLOWED STACK OVERFLOW ──────────────────────
//
// ⛔⛔ WHAT THE SAR FILE WAS ACTUALLY DOING. `corpus/committed/parabolic-sar…`
// did not loop and did not cycle. Resolution recursed 1,281 frames deep, blew
// the JavaScript stack, and a `catch` upstream swallowed the `RangeError` and
// tried a different expansion — 1,117,654 times in one translation. Measured,
// not inferred: the throw census counted them by message.
//
// ⛔⛔ AND THE TIME WAS THE LESSER HALF. While the overflow was being swallowed,
// THE ANSWER THIS DOOR GAVE DEPENDED ON THE HOST'S STACK SIZE — node version,
// `--stack-size`, how deep the caller already was — rather than on the member's
// script. The same file could translate on this machine and refuse on a
// colleague's, with nothing in either run to point at. A bound stated in the
// engine makes the reply a property of the script again, which is why this is
// filed as a correctness fix and not a performance one.
//
// ⭐ MEASURED EFFECT: 11.6s (refusing for the wrong reason) → 43ms, and 316 of
// the 317 corpus scripts answer BYTE-IDENTICALLY. The 317th is the SAR file
// itself — same guard, same three lines, and only the NAMED variable moves,
// because the depth bound names what it was expanding when it gave up.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, PINE_TRANSLATE_MAX_DEPTH } from './pine.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const REPO = path.resolve(HERE, '../../../../../..')
const NORMAL = path.join(REPO, 'tests/fixtures/pine/10-supertrend.pine')
const SAR = path.join(REPO, 'corpus/committed/parabolic-sar__xoeoPMOWGJ.pine')
const normal = fs.readFileSync(NORMAL, 'utf8')

const guardsOf = (r) => [...new Set((r.refusals || []).map((x) => x.guard))]
const timeoutsOf = (r) => (r.refusals || []).filter((x) => x.guard === 'pine:timeout')

describe('pine:timeout — the depth bound', () => {
  it('⛔ refuses by name when resolution nests past the bound', () => {
    const r = translatePine(normal, { strict: true, maxDepth: 3, sourcePath: NORMAL })
    expect(guardsOf(r)).toContain('pine:timeout')
    expect(timeoutsOf(r)[0].message).toMatch(/nested past 3 levels/)
  })

  it('⭐ THE CONTROL: the same script is clean at the shipped bound', () => {
    // Without this, "it refuses at 3" is satisfied by a guard that refuses
    // everything always — which would take the whole corpus with it.
    const r = translatePine(normal, { strict: true })
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })

  it('⭐ and it fires at every small bound, not just one lucky value', () => {
    for (const maxDepth of [1, 2, 5, 7]) {
      expect(guardsOf(translatePine(normal, { strict: true, maxDepth })), `maxDepth=${maxDepth}`)
        .toContain('pine:timeout')
    }
  })

  it('says it is a translator defect, not a limit on the member\'s script', () => {
    const r = translatePine(normal, { strict: true, maxDepth: 3 })
    expect(timeoutsOf(r)[0].message).toMatch(/translator defect, not a limit on the script/)
  })

  it('names the script, so a batch says WHICH file', () => {
    const r = translatePine(normal, { strict: true, maxDepth: 3, sourcePath: 'corpus/committed/x.pine' })
    expect(timeoutsOf(r)[0].message).toContain('corpus/committed/x.pine')
  })

  it('a bound of 0 disables the depth guard', () => {
    const r = translatePine(normal, { strict: true, maxDepth: 0 })
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })

  it('the bound is 20x the deepest legitimate script — measured, not guessed', () => {
    // Deepest resolution across the 51 published scripts in both corpora is 20
    // (`07-rsi`); everything else sits at 8-10. The SAR file reached 1,281
    // before the host stack broke, so 400 sits well clear of both.
    expect(PINE_TRANSLATE_MAX_DEPTH).toBe(400)
    expect(PINE_TRANSLATE_MAX_DEPTH / 20).toBeGreaterThanOrEqual(20)
    expect(PINE_TRANSLATE_MAX_DEPTH).toBeLessThan(1281)
  })
})

describe('the SAR file answers promptly instead of thrashing', () => {
  it('⭐⭐ refuses in well under a second, naming the file', () => {
    const src = fs.readFileSync(SAR, 'utf8')
    const t0 = Date.now()
    const r = translatePine(src, { strict: true, sourcePath: 'corpus/committed/parabolic-sar__xoeoPMOWGJ.pine' })
    const ms = Date.now() - t0
    expect(guardsOf(r)).toContain('pine:timeout')
    expect(timeoutsOf(r)[0].message).toContain('parabolic-sar__xoeoPMOWGJ.pine')
    // ⭐ THE REGRESSION CEILING. It measures 43ms; 1,000ms is the ceiling the
    // directive set, and a change that re-explodes resolution blows through it
    // as a NUMBER rather than as a hang somebody has to sit through.
    expect(ms).toBeLessThan(1000)
  })

  it('⛔ and the minimal recurrence still answers, unchanged', () => {
    // `x := nz(x[1]) + 1` never hung — it refuses `pine:state` because this
    // engine's accumulator re-seeds. Pinned so the depth bound cannot be
    // credited with "fixing" a script that was never broken.
    const r = translatePine(
      '//@version=5\nindicator("m")\nvar float x = 0.0\nx := nz(x[1]) + 1\nplot(x)\n',
      { strict: true })
    expect(guardsOf(r)).toContain('pine:state')
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })

  it('⛔ a four-variable nested-conditional recurrence refuses without thrashing', () => {
    // The synthetic the directive asked for: four mutually-referencing
    // accumulators under three levels of `if`. It reaches `pine:cycle` in ~1ms,
    // which is the shape SAR was mistaken for.
    const src = `//@version=5
indicator("synth", overlay=true)
var float a = 0.0
var float b = 0.0
var float c = 0.0
var float d = 0.0
if close > open
    a := nz(a[1]) + nz(b[1]) + 1
    if high > high[1]
        b := nz(b[1]) + nz(c[1]) + nz(a[1])
        if low < low[1]
            c := nz(c[1]) + nz(d[1]) + nz(b[1])
            d := nz(d[1]) + nz(a[1]) + nz(c[1])
        else
            d := nz(d[1]) + nz(b[1])
    else
        b := nz(b[1]) + nz(d[1])
else
    a := nz(a[1]) - nz(c[1])
    c := nz(c[1]) + nz(a[1]) + nz(d[1])
plot(a + b + c + d)
`
    const t0 = Date.now()
    const r = translatePine(src, { strict: true })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(guardsOf(r).length).toBeGreaterThan(0)
  })
})
