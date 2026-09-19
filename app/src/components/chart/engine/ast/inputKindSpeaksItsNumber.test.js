// app/src/components/chart/engine/ast/inputKindSpeaksItsNumber.test.js
//
// ─── ⭐⭐ R16 — EACH RETIRED INPUT KIND SAYS ITS OWN NUMBER ──────────────────
//
// Item (b) retires by measurement (R15/R16). Retiring here means the member is told
// WHICH kind, HOW MANY uses it has, and WHERE it routes — never "not supported", and
// never one generic sentence for eight different situations.
//
// ⚰️⚰️ AND THE RULING'S OWN PREMISE WAS MEASURED WRONG BEFORE THIS WAS WRITTEN.
// R16 says "the retirement builds six sentences at the existing sites
// (7754/7758/7780/7793)" and that "all 277 refuse today under `pine:input-kind`".
// Measured through the shipped door, that is true of ONE kind:
//
//   kind                READ (consumed by an output)   UNREAD (the closing pass)
//   input.time          REFUSES pine:input-kind        note pine:input-kind
//   input.timeframe     translates, no refusal         note pine:input-kind
//   input.session       translates, no refusal         note pine:input-kind
//   input.string        translates, no refusal         note pine:input-kind
//   input.color         translates, no refusal         note pine:input-kind
//   input.symbol        translates, no refusal         note pine:input-kind
//   input (bare)        translates, no refusal         note pine:TEXT-VALUE
//   input.int (ts)      translates, no refusal         NOTHING — it is NUMERIC
//
// ⭐ SO THERE ARE NOT SIX REFUSAL SITES; THERE IS ONE, and it is the `NUMERIC` gate
// in `resolveInput`. It fires as a REFUSAL when an output reads the input, and as a
// NOTE when the closing pass (R13/`bdc1050ad`) resolves a binding nothing read —
// which is where Clouds' eight `pine:input-kind` lines come from. One site, both
// paths, so one per-kind sentence serves both. `input.int` as a timestamp needs no
// sentence at all: it already folds.
//
// ⛔ THE B.1 TABLE THAT SAID OTHERWISE READ ITS VERDICT OFF `NUMERIC` SET MEMBERSHIP
// INSTEAD OF MEASURING, and is corrected in place in `WAVE2-A-PLAN.md`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')

/** One NAMED corpus script per kind, from the census. */
const SPECIMEN = {
  timeframe: 'corpus/committed/3-level-zigzag-semafor__3078.pine',
  session: 'corpus/committed/asianrange-and-killzones__ef41eb5ad6.pine',
  time: 'corpus/committed/anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80.pine',
  string: 'corpus/committed/smart-money-concepts-by-welotrades__0bff41a2e5.pine',
}

/** The number and the routing each sentence must carry (R16). */
const MUST_SAY = {
  timeframe: ['input.timeframe', '158', '61', 'request.security', 'item (c)'],
  session: ['input.session', '70', '23', 'textop'],
  time: ['input.time', '20', '11', 'item (c)'],
  string: ['input.string', '14', '3'],
}

/** Every `pine:input-kind` line a script produces, notes AND refusals — the sentence
 *  reaches the member down either path and must read the same on both. */
function inputKindLines(src, opts = {}) {
  const t = translatePine(src, opts)
  const out = []
  for (const n of (t.notes || [])) {
    if ((n.code || n.guard) === 'pine:input-kind') out.push(String(n.message || ''))
  }
  for (const r of (t.refusals || [])) {
    if (r.guard === 'pine:input-kind') out.push(String(r.message || ''))
  }
  return out
}

function readSpecimen(kind) {
  return fs.readFileSync(path.join(REPO, SPECIMEN[kind]), 'utf8')
}

describe('R16 — each retired input kind speaks its own number', () => {
  // ── ⛔⛔ THE NON-VACUITY CONTROL, NAMED (standing rule 0.1, 2026-09-14).
  //    Without it every assertion below passes over an empty list, and an
  //    `it.fails` guarding an empty list PASSES — reporting the defect fixed.
  it('⛔⛔ NON-VACUITY CONTROL — each named specimen really produces input-kind lines', () => {
    for (const kind of Object.keys(SPECIMEN)) {
      const src = readSpecimen(kind)
      expect(fs.existsSync(path.join(REPO, SPECIMEN[kind])),
        `${SPECIMEN[kind]} is not on disk`).toBe(true)
      expect(src, `${kind}'s specimen does not contain input.${kind}`)
        .toContain(`input.${kind}`)
      const lines = inputKindLines(src)
      expect(lines.length,
        `${SPECIMEN[kind]} produced NO pine:input-kind line, so every assertion `
        + 'about its sentence would pass over an empty list').toBeGreaterThan(0)
    }
  })

  for (const kind of Object.keys(SPECIMEN)) {
    it(`⭐⭐ input.${kind}'s sentence carries its kind, number and routing`, () => {
      const lines = inputKindLines(readSpecimen(kind))
      const mine = lines.filter((m) => m.includes(`input.${kind}`))
      expect(mine.length, `no line names input.${kind}`).toBeGreaterThan(0)
      for (const token of MUST_SAY[kind]) {
        expect(mine.some((m) => m.includes(token)),
          `input.${kind}'s sentence never says ${JSON.stringify(token)} — `
          + `got: ${JSON.stringify(mine[0])}`).toBe(true)
      }
    })
  }

  it('⛔ input.session retires on GRAMMAR, and says so rather than a count', () => {
    // ⭐ The one row that is not a threshold call. Every other kind could be
    // reopened by a corpus that shifts; this sentence must stay true if it does.
    const lines = inputKindLines(readSpecimen('session'))
        .filter((m) => m.includes('input.session'))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((m) => /textop/.test(m) && /carrier|grammar/i.test(m)),
      'the session sentence must name the GRAMMAR reason, not just a number')
      .toBe(true)
  })

  // ── THE CONTROLS. R16 must not spend what already works.

  it('⭐ CONTROL — a HANDLED kind still folds to a number', () => {
    const t = translatePine(
      'indicator("x")\nn = input.int(14, "Len")\nplot(ta.sma(close, n))\n', {})
    expect(t.ok, 'input.int stopped folding').toBe(true)
    expect((t.refusals || []).length).toBe(0)
  })

  it('⛔⛔ CONTROL — input.timeframe in a TIMEFRAME POSITION still FOLDS, to `D`', () => {
    // ⚰️ This is the half R16 could most easily break. `timeframeLiteralOf` folds a
    // timeframe input where a timeframe position asks, and 97 of the 158 uses reach
    // the member that way. A retirement that made the KIND refuse everywhere would
    // take those 97 with it — retiring a working capability, which the threshold
    // gives no authority to do.
    //
    // ⛔ IT ASSERTS THE FOLD'S VALUE, NOT THE ABSENCE OF A REFUSAL. The first draft
    // of this control asserted "no input-kind line" against
    // `request.security(syminfo.tickerid, tf, close)` — which refuses `pine:request`
    // for its OWN reason, leaving `tf` unread, so the closing pass noted it and the
    // control failed while nothing was wrong with the fold. An absence proves
    // nothing here; the folded VALUE does.
    const src = 'indicator("x")\ntf = input.timeframe("D", "TF")\n'
      + 'plot(request.security("AAPL", tf, close))\n'
    const t = translatePine(src, {})
    const folded = (t.outputs || []).flatMap((o) => o.inputsFolded || [])
    expect(folded.length, 'nothing folded at all — the control cannot see a fold')
      .toBeGreaterThan(0)
    expect(folded.some((e) => String(e.call).includes('timeframe')
      && String(e.folded).includes('D')),
    `the timeframe input did not fold to 'D': ${JSON.stringify(folded)}`).toBe(true)
  })

  it('⭐ CONTROL — input.int as a timestamp needs no sentence: it already folds', () => {
    // Measured: no note, no refusal. R16 listed it as a sixth sentence; there is
    // nothing at this site to say about it.
    const t = translatePine(
      'indicator("x")\nq = input.int(60123456789, "Start")\nplot(close)\n', {})
    expect(inputKindLines(
      'indicator("x")\nq = input.int(60123456789, "Start")\nplot(close)\n')).toEqual([])
    expect(t.ok).toBe(true)
  })
})
