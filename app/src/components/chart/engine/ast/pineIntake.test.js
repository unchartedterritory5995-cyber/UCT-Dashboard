// ⭐ THE INTAKE BENCH — one command to diagnose a pasted TradingView script.
//
// Drop any number of `.pine` files into `tests/fixtures/pine-inbox/` (gitignored)
// and run this file. For each one it reports: does it translate, how many columns
// it offers, how many this engine can compute, and — for every output that
// refuses — the guard, the line, and the message a member would see.
//
// ⛔ IT IS NOT A CORPUS RAIL, AND MUST NEVER BECOME ONE. The committed corpus
// (`pine.corpus.test.js` + `__fixtures__/pineCorpus.json`) is the thing that
// holds coverage still; this is the bench you diagnose ON. Pinning inbox files
// here would pin whatever happened to be sitting in a scratch directory.
//
// ⚠️ AND IT SELF-VALIDATES, because an empty inbox would otherwise make this file
// report "all good" while measuring nothing — the vacuous green this repo keeps
// paying for. The two controls below run on EVERY invocation and assert that the
// diagnostic can still tell a translating script from a refusing one. If they
// ever fail, every inbox verdict this bench has ever printed is suspect.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

const INBOX = '../tests/fixtures/pine-inbox'

/** Everything worth knowing about one script, in one object. */
function diagnose(source) {
  let out
  try {
    out = translatePine(source)
  } catch (err) {
    return { threw: String((err && err.message) || err) }
  }
  const refusals = (out.outputs || [])
    .filter((o) => o.refusal)
    .map((o) => ({
      guard: o.refusal.guard,
      line: o.refusal.line,
      message: String(o.refusal.message || ''),
    }))
  const usable = (out.outputs || []).filter((o) => o.formula)
  const selected = out.selected >= 0 ? (out.outputs || [])[out.selected] : null

  // ⭐ THE COLUMN GOES THROUGH THE SHIPPED DOOR, not a copy of its rules — the
  // save gate is what decides whether a member can keep this, so asking anything
  // else here would report a verdict the product does not honour.
  let downstream = null
  if (selected && selected.formula) {
    const ev = evaluateFormula(selected.formula, BUILDER_INPUT_SCOPE)
    downstream = {
      ok: ev.ok,
      guard: ev.guard || null,
      repaint: ev.verdict ? ev.verdict.mode : null,
      lookback: ev.measured ? ev.measured.maxLookback : null,
      saveable: ev.ok ? canSaveFormula(ev, false) : false,
      readback: ev.readback || null,
    }
  }
  return {
    version: out.version,
    translates: !!out.ok,
    outputsOffered: (out.outputs || []).length,
    columnsComputable: usable.length,
    formula: selected ? selected.formula : null,
    downstream,
    refusals,
  }
}

describe('the Pine intake bench can tell translating from refusing', () => {
  const head = '//@version=5\nindicator("t")\n'

  it('a script this engine handles reports as translating, with a saveable column', () => {
    const d = diagnose(`${head}plot(ta.rsi(close, 14) < 30 ? 1 : 0)`)
    expect(d.translates, JSON.stringify(d.refusals)).toBe(true)
    expect(d.columnsComputable).toBeGreaterThan(0)
    expect(d.downstream.saveable).toBe(true)
    expect(d.downstream.repaint).toBe('non-repainting')
  })

  it('…and a script it cannot reports the GUARD and the LINE, not just "no"', () => {
    // ⛔ The half that matters. "It refused" is satisfiable by a bench that
    // refuses everything; naming `cum` at its line is what makes the next
    // build decision possible.
    const d = diagnose(`${head}plot(ta.cum(volume) > 0 ? 1 : 0)`)
    expect(d.translates).toBe(false)
    expect(d.refusals.length).toBeGreaterThan(0)
    expect(d.refusals[0].guard).toBe('pine:function')
    expect(d.refusals[0].message).toContain('cum')
    expect(typeof d.refusals[0].line).toBe('number')
  })
})

describe('the inbox', () => {
  const files = existsSync(INBOX)
    ? readdirSync(INBOX).filter((f) => f.endsWith('.pine')).sort()
    : []

  it(files.length ? `diagnoses ${files.length} pasted script(s)` : 'is empty — nothing pasted to diagnose', () => {
    if (!files.length) return
    const report = {}
    for (const f of files) report[f] = diagnose(readFileSync(`${INBOX}/${f}`, 'utf8'))
    // eslint-disable-next-line no-console
    console.log(`\n[pine intake]\n${JSON.stringify(report, null, 2)}`)
    // ⛔ NO ASSERTION ON THE VERDICTS. A pasted script is evidence, not a
    // requirement — asserting it translates would turn "we cannot read this
    // yet" into a red build, which is precisely the fact we want reported
    // calmly so it can be prioritised.
    expect(Object.keys(report)).toHaveLength(files.length)
  })
})
