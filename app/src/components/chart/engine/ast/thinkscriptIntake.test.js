// ⭐ THE thinkScript INTAKE BENCH + THE CORPUS FIXTURE WRITER.
//
// `npx vitest run src/components/chart/engine/ast/thinkscriptIntake.test.js`
// diagnoses every file in `tests/fixtures/thinkscript-inbox/` (gitignored) and
// prints one object per script. With `TS_CORPUS_WRITE=1` it ALSO regenerates
// `__fixtures__/thinkscriptCorpus.json` from a MEASUREMENT of the committed
// corpus — the only sanctioned way that file is ever written.
//
// ⛔ IT IS NOT A CORPUS RAIL AND MUST NEVER BECOME ONE. `thinkscript.corpus.test.js`
// holds coverage still; this is the bench you diagnose on and the tool that
// writes what that rail then compares. ⚠️ AND IT SELF-VALIDATES: the controls
// below run on EVERY invocation, so an inbox verdict is never reported by a
// bench that has stopped being able to tell one answer from another.
//
// ✅ AND THE TWO CONTROLS W3.2 DEFERRED ARE IN. That task's header said they
// "are the W3.5 replacement — swap them in the moment the first script
// translates", and it was WRONG ABOUT THE TIMING IN BOTH DIRECTIONS: the
// function-level refusal it expected at W3.4 fires at W3.3 (every unmapped call
// refuses at its name), and a hand-written paste already translates all the way
// to a SAVEABLE column, so the bench can discriminate all three answers now.
// ⏳ WHAT IS STILL NOT TRUE: no file in the committed CORPUS translates — every
// one of the 24 needs a thinkorswim function this task maps none of. That number
// lives in `thinkscript.corpus.test.js`, which is where coverage is held still.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { translateThinkScript } from './thinkscript.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

const INBOX = '../tests/fixtures/thinkscript-inbox'
const CORPUS = path.resolve(process.cwd(), '../tests/fixtures/thinkscript')
const FIXTURE = path.resolve(process.cwd(), 'src/components/chart/engine/ast/__fixtures__/thinkscriptCorpus.json')

/** The `_`-prefixed roll-ups the generator writes beside the per-script entries.
 *  Declared HERE, where they are produced, so the corpus rail can split them off
 *  by prefix without a second copy of the list. */
const ROLLUP_KEYS = ['_atLineOne', '_blocked', '_columns', '_guardsFired', '_saveable', '_translating']

export function diagnose(source) {
  let out
  try { out = translateThinkScript(source) } catch (err) { return { threw: String((err && err.message) || err) } }
  const selected = out.selected >= 0 ? out.outputs[out.selected] : null
  let downstream = null
  if (selected && selected.formula) {
    const ev = evaluateFormula(selected.formula, BUILDER_INPUT_SCOPE)
    downstream = {
      ok: ev.ok,
      guard: ev.guard || null,
      repaint: ev.verdict ? ev.verdict.mode : null,
      lookback: ev.measured ? ev.measured.maxLookback : null,
      saveable: ev.ok ? canSaveFormula(ev, false) : false,
    }
  }
  const perOutputRefusals = {}
  for (const o of out.outputs) {
    if (o.refusal) perOutputRefusals[o.refusal.guard] = (perOutputRefusals[o.refusal.guard] || 0) + 1
  }
  return {
    translates: !!out.ok,
    outputs: out.outputs.length,
    usable: out.outputs.filter((o) => o.formula && !o.hidden).length,
    selectedFormula: selected ? selected.formula : null,
    ignoredLines: out.ignored.map((n) => n.line),
    folded: out.folded.map((x) => `${x.name}=${x.folded}`),
    perOutputRefusals,
    refusal: out.refusal
      ? { guard: out.refusal.guard, line: out.refusal.line, column: out.refusal.column, token: out.refusal.token }
      : null,
    downstream,
  }
}

describe('the thinkScript intake bench can tell one answer from another', () => {
  it('⭐ a script this engine handles reports as TRANSLATING, with a saveable column', () => {
    // ⛔ THE CONTROL THAT MAKES THE OTHERS MEAN SOMETHING. Without a paste that
    // gets all the way through, "it refused" is the only verdict the bench has
    // ever produced and nobody can tell a working bench from a stuck one.
    const d = diagnose('input len = 20;\ndef hi = Highest(high, 3);\nplot scan = close > open;\n')
    expect(d.threw, 'the bench must never report a throw').toBe(undefined)
    expect(d.translates).toBe(true)
    expect(d.selectedFormula).toBe('close > open')
    expect(d.folded).toEqual(['len=20'])
    expect(d.downstream.ok).toBe(true)
    expect(d.downstream.saveable).toBe(true)
    expect(d.refusal).toBe(null)
  })

  it('a paste it cannot read reports the GUARD, the LINE and the TOKEN, not just "no"', () => {
    // ⛔ The half that matters. "It refused" is satisfiable by a bench that
    // refuses everything at line 1 with no token; naming the token AT its column
    // is what makes the next build decision possible.
    // ⚠️ THE PROBE MOVED IN W3.4 AND HAD TO. It was `Average(close, 50)`, which
    // that task MAPS — so this control would have gone on passing while
    // measuring a wall that no longer exists. `TTM_Squeeze` is proprietary and
    // thinkorswim publishes no formula for it, so it is a wall the function map
    // will not move either.
    const d = diagnose('def a = TTM_Squeeze(close, 20);\nplot scan = close > a;\n')
    expect(d.threw, 'the bench must never report a throw').toBe(undefined)
    expect(d.translates).toBe(false)
    expect(d.refusal.guard).toBe('thinkscript:function')
    expect(typeof d.refusal.line).toBe('number')
    expect(d.refusal.token).toBe('TTM_Squeeze')
    expect(d.refusal.column).toBe(9)
  })

  it('…and an empty paste is a DIFFERENT named answer, so the bench is not one-note', () => {
    // ⛔ Without this the control above passes for a bench that has collapsed to
    // a single verdict — the vacuous green this repo keeps paying for.
    const d = diagnose('   \n')
    expect(d.translates).toBe(false)
    expect(d.refusal.guard).toBe('thinkscript:empty')
    expect(d.refusal.line).toBe(null)
    expect(d.refusal.token).toBe(null)
  })

  it('the report shape is complete even with nothing to report', () => {
    const d = diagnose('plot x = TTM_Squeeze(close, 20);')
    for (const k of ['translates', 'outputs', 'usable', 'selectedFormula', 'ignoredLines',
      'folded', 'perOutputRefusals', 'refusal', 'downstream']) {
      expect(Object.prototype.hasOwnProperty.call(d, k), k).toBe(true)
    }
    expect(d.downstream, 'no column selected, so no downstream verdict to report').toBe(null)
    expect(d.perOutputRefusals).toEqual({ 'thinkscript:function': 1 })
  })
})

describe('the committed corpus', () => {
  it(process.env.TS_CORPUS_WRITE ? 'REGENERATES the fixture from a measurement' : 'is measured and printed', () => {
    const files = readdirSync(CORPUS).filter((f) => f.endsWith('.ts')).sort()
    expect(files.length, 'a measurement of nothing is not a measurement').toBeGreaterThanOrEqual(24)
    const out = {}
    for (const f of files) out[f] = diagnose(readFileSync(path.join(CORPUS, f), 'utf8'))
    const fired = new Set()
    for (const f of files) {
      for (const r of translateThinkScript(readFileSync(path.join(CORPUS, f), 'utf8')).refusals) fired.add(r.guard)
    }
    out._translating = files.filter((f) => out[f].translates).length
    out._columns = files.reduce((n, f) => n + out[f].usable, 0)
    out._saveable = files.filter((f) => out[f].downstream && out[f].downstream.ok).length
    out._blocked = files.filter((f) => out[f].translates && !(out[f].downstream && out[f].downstream.ok))
    // ⭐ WHICH SCRIPTS STILL REFUSE AT THE VERY TOP. W3.2 had all 24 here; the
    // corpus rail compares this against a LIVE RUN, so a hand-edited fixture and
    // a regressed reader fail differently.
    out._atLineOne = files.filter((f) => out[f].refusal && out[f].refusal.line === 1 && out[f].refusal.column === 1)
    out._guardsFired = [...fired].sort()
    // eslint-disable-next-line no-console
    console.log(`\n[thinkscript corpus] ${out._translating}/${files.length} translate, ${out._columns} columns, ${out._saveable} saveable`)
    if (process.env.TS_CORPUS_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`, 'utf8')

    // ⛔ THE ROLL-UPS ARE ASSERTED BY NAME, NOT BY COUNT. `files.length + 5`
    // is satisfied by writing five keys of any name, and the corpus rail splits
    // this file by the `_` prefix — so the names are the contract between the
    // two, and this is where they are decided.
    expect(Object.keys(out).filter((k) => k.startsWith('_')).sort()).toEqual(ROLLUP_KEYS)
    expect(Object.keys(out).length).toBe(files.length + ROLLUP_KEYS.length)
  })

  it(existsSync(path.resolve(process.cwd(), INBOX)) ? 'diagnoses pasted scripts' : 'inbox is empty — nothing pasted', () => {
    const dir = path.resolve(process.cwd(), INBOX)
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()
    if (!files.length) return
    const report = {}
    for (const f of files) report[f] = diagnose(readFileSync(path.join(dir, f), 'utf8'))
    // eslint-disable-next-line no-console
    console.log(`\n[thinkscript intake]\n${JSON.stringify(report, null, 2)}`)
    // ⛔ NO ASSERTION ON THE VERDICTS. A pasted script is evidence, not a
    // requirement — asserting it translates would turn "we cannot read this yet"
    // into a red build, which is precisely the fact we want reported calmly.
    expect(Object.keys(report)).toHaveLength(files.length)
  })
})
