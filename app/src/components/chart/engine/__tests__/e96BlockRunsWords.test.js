// app/src/components/chart/engine/__tests__/e96BlockRunsWords.test.js
//
// ─── ⭐⭐ e96 (2026-11-23) — THE ASSISTANT IS TOLD WHAT THE BLOCK GATE ADMITS, IN THE GATE'S OWN WORDS ─
//
// FOUND BY THE STUDIO: the assistant's instructions said it may write "a `ta.sma` / `ta.ema` call inside
// an `if` block at the top level of the script" (typed in `api/services/pine_authoring.py`). The engine
// refuses exactly that (`pine:block`) whenever the `if` skips a bar and runs again, and it is RIGHT to: a
// `ta.*` call keeps the history of the bars its block ran on, which the columnar lane does not keep.
// Probe 12 (`if close > close[1]` / `avgUp := ta.sma(volume, 10)`) is refused; probe 13 (`ta.*` in the
// arms of a `switch` over an `input.string`) runs.
//
// THE WORDS NOW LIVE BESIDE THE GATE (`blockRuns.js::BLOCK_RUNS_ADMITS`, `firstRunAfterSkip` in words),
// the reference generator copies them (`assistantPineReference.js::GATE_WORDS` → `capabilityWords`), and
// the server prints that copy (`pine_authoring.capability_words`; `tests/test_pine_authoring.py`). Held here:
//   1. the gate does what the sentence says, shape by shape;
//   2. the sentence is the reference's, byte for byte (a stale reference reds here, in seconds);
//   3. the studio's two probes, run on a chart, answer as the sentence says;
//   4. the worked example the assistant is shown for it is probe 13, as written.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { firstRunAfterSkip, BLOCK_RUNS_ADMITS, BLOCK_RUNS_GUARD } from '../blockRuns'
import { GATE_WORDS } from '../../supportLoop/assistantPineReference'
import REFERENCE from '../../supportLoop/assistantPineReference.json'
import EXAMPLE_INDEX from '../../supportLoop/assistantExamples/index.json'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as nativeRegistry from '../nativeRegistry'
import { recipeBars, recipeContext } from '../../supportLoop/assistantRecipes'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')

const LF = String.fromCharCode(10)
const FIX = path.resolve(process.cwd(), 'src/components/chart/engine/ast/__fixtures__/e96GetterArith')
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, LF)
const P12 = read(path.join(FIX, '12_conditional_ta_inside_an_if.pine'))
const P13 = read(path.join(FIX, '13_conditional_ta_inside_a_constant_switch.pine'))

describe('1 — the gate does what its sentence says (`firstRunAfterSkip`, shape by shape)', () => {
  it('ADMITTED: a block that runs on every bar, one that never runs, one that stops for good', () => {
    expect(firstRunAfterSkip([true, true, true, true])).toBeNull()      // the chosen arm of a switch over a setting
    expect(firstRunAfterSkip([false, false, false])).toBeNull()         // the arms not chosen
    expect(firstRunAfterSkip([1, 1, 1, 0, 0])).toBeNull()               // runs from the first bar, then stops for good
  })
  it('REFUSED: a block that skips a bar and runs again, the first bar included', () => {
    expect(firstRunAfterSkip([true, false, true])).toEqual({ skipped: 1, bar: 2 })
    expect(firstRunAfterSkip([0, 1, 1, 1])).toEqual({ skipped: 0, bar: 1 })   // probe 12's shape: bar 0 skipped
  })
  it('the sentence says those, names the guard by its constant, and teaches the switch', () => {
    expect(BLOCK_RUNS_ADMITS).toContain(`(\`${BLOCK_RUNS_GUARD}\`)`)
    expect(BLOCK_RUNS_ADMITS).toContain('runs on every bar from the chart\'s first bar until, at most, it stops for good')
    expect(BLOCK_RUNS_ADMITS).toContain('skips a bar and runs again later')
    expect(BLOCK_RUNS_ADMITS).toContain('`switch`')
    expect(BLOCK_RUNS_ADMITS).not.toContain('at the top level of the script')
  })
})

describe('2 — one authority: the reference carries the gate\'s sentence, byte for byte', () => {
  it('GATE_WORDS is the gate\'s, and the committed reference is GATE_WORDS', () => {
    expect(GATE_WORDS['conditional-ta']).toBe(BLOCK_RUNS_ADMITS)
    expect(REFERENCE.admitted).toContain('conditional-ta')
    expect(REFERENCE.capabilityWords).toEqual({ 'conditional-ta': BLOCK_RUNS_ADMITS })
  })
})

describe('3 — the studio\'s two probes, run on a chart, answer as the sentence says', () => {
  const BARS = recipeBars('daily')
  const CTX = recipeContext('daily', 'fromListing')
  const run = (source, id) => {
    const pane = memberPaneDefinition({ source, id, name: id })
    expect(pane.ok, `${id}: ${pane.reason}`).toBe(true)
    const cols = nativeRegistry.computeFor(pane.definition, BARS, undefined, CTX)
    const errors = nativeRegistry.columnErrors(cols) || {}
    const key = Object.keys(cols).find((k) => !k.startsWith('__'))
    return { errors, values: key ? Array.from(cols[key]).filter(Number.isFinite).length : 0 }
  }
  it('probe 12, `ta.sma` in an `if` on a price condition: refused by name', () => {
    const { errors, values } = run(P12, 'u_e96_p12')
    const all = Object.values(errors)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((e) => e.guard === BLOCK_RUNS_GUARD)).toBe(true)
    expect(all[0].message).toMatch(/skips bar \d+ and runs again on bar \d+/)
    expect(values).toBe(0)
  }, 120_000)
  it('probe 13, `ta.*` in the arms of a `switch` over a setting: runs', () => {
    const { errors, values } = run(P13, 'u_e96_p13')
    expect(errors).toEqual({})
    expect(values).toBeGreaterThan(BARS.length - 40)
  }, 120_000)
})

describe('4 — the worked example the assistant is shown is probe 13, as written, and it ran', () => {
  it('average-by-type', () => {
    expect(EXAMPLE_INDEX.examples.find((x) => x.id === 'average-by-type')).toMatchObject({ file: 'average-by-type.pine' })
    // (read from the generated reference, which ran it through the member's paste path)
    const e = REFERENCE.examples.find((x) => x.id === 'average-by-type')
    expect(e && e.source.replace(/\r\n/g, LF)).toBe(P13)
    expect(e.ok).toBe(true)
    expect(['runs', 'runs-with-notes']).toContain(e.state)
  })
})
