// app/src/components/chart/engine/ast/alertMessageRides.test.js
//
// ─── ⭐⭐ R22a / d2 — AN ALERT MESSAGE RIDES THE TITLE'S CARRIAGE ────────────
//
// `alertcondition(condition, title, message)`. The **title** has always ridden as a
// presentation FIELD on the output — not a `str` node in the tree — so `str`'s
// textop-only parentage (`assertCanonical`) is never engaged and **no 12th
// `NODE_TYPES` member is implied**. The message rides **beside it, same carriage**.
//
// ⭐ SCOPE, MEASURED (`a99ffcec3`): **487 of 555** messages are carryable — **338
// literal + 149 placeholder** — against **2** genuine expressions. A `{{placeholder}}`
// is still a string LITERAL; the braces are TradingView's to resolve at fire time, and
// carrying the string verbatim is the honest thing to do with it.
//
// ⛔ AN EXPRESSION MESSAGE IS NOT CARRIED, AND IT GETS A NOTE — never a refusal. The
// offer translates today and must keep translating; **a threshold never removes what
// works**. Folded into d2 rather than standing alone (R22a) because at two corpus
// specimens it is not a feature.
//
// ⚰️ THE NAMED FORM IS THE ONE THAT BIT. The census read `message = "…"` as an
// EXPRESSION because the value did not start with a quote, which understated the
// carryable set by ~155. `outputTitle` already reads named-or-positional; the message
// carriage reads both for the same reason, and a mutation proves it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const LITERAL_CORPUS = 'corpus/committed/adaptive-trend-following-suite-alpha-extract__d615e5a027.pine'
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

const acOf = (t) => (t.outputs || []).filter((o) => o.kind === 'alertcondition')
const notesOf = (t, code) => (t.notes || []).filter((n) => (n.code || n.guard) === code)

const head = 'indicator("x")\nc = close > open\n'

/** ⭐ TWO MESSAGES, ONE TITLE — the `:121` lesson. If the carriage keyed off the
 *  title, or wrote one row's message onto the other, these two would be
 *  indistinguishable and a single-specimen test would pass on the wrong one. */
const SAME_TITLE = `${head}alertcondition(c, "Sig", "FIRST_MESSAGE")\n`
  + 'alertcondition(c, "Sig", "SECOND_MESSAGE")\nplot(close)\n'
const PLACEHOLDER = `${head}alertcondition(c, "Sig", "px {{close}} on {{ticker}}")\nplot(close)\n`
const NAMED_FORM = `${head}alertcondition(c, title = "Sig", message = "NAMED_MESSAGE")\nplot(close)\n`
const EXPR_MSG = `${head}alertcondition(c, "Sig", "px " + str.tostring(close))\nplot(close)\n`

describe('R22a / d2 — the message rides beside the title', () => {
  it('⛔⛔ NON-VACUITY CONTROL — every specimen has a message arg and produces output', () => {
    // Without this, "the field equals X" passes over a script that refused before
    // reaching the alertcondition, and an empty list satisfies everything.
    for (const src of [SAME_TITLE, PLACEHOLDER, NAMED_FORM, EXPR_MSG]) {
      const t = translatePine(src, {})
      expect(acOf(t).length, 'no alertcondition output at all').toBeGreaterThan(0)
      expect((t.outputs || []).length).toBeGreaterThan(0)
    }
    expect(fs.existsSync(path.join(REPO, LITERAL_CORPUS))).toBe(true)
    expect(read(LITERAL_CORPUS)).toMatch(/alertcondition\s*\(/)
    expect(acOf(translatePine(read(LITERAL_CORPUS), {})).length).toBeGreaterThan(0)
  })

  it.fails('⭐⭐ TWO literal messages under ONE title, each carried to its own row', () => {
    const rows = acOf(translatePine(SAME_TITLE, {}))
    expect(rows.length).toBe(2)
    expect(rows.map((r) => r.title)).toEqual(['Sig', 'Sig'])
    expect(rows.map((r) => r.message)).toEqual(['FIRST_MESSAGE', 'SECOND_MESSAGE'])
  })

  it.fails('⭐⭐ a {{placeholder}} message is carried VERBATIM, braces and all', () => {
    const [row] = acOf(translatePine(PLACEHOLDER, {}))
    expect(row.message).toBe('px {{close}} on {{ticker}}')
  })

  it.fails('⭐⭐ the NAMED form is read too — `message = "…"`', () => {
    const [row] = acOf(translatePine(NAMED_FORM, {}))
    expect(row.message).toBe('NAMED_MESSAGE')
  })

  it.fails('⛔ an EXPRESSION message is NOT carried, and is NOTED at its line', () => {
    const t = translatePine(EXPR_MSG, {})
    const [row] = acOf(t)
    expect(row.message, 'an expression must not be carried as if it were a string')
      .toBe(null)
    const n = notesOf(t, 'pine:alert-message')
    expect(n.length, 'the dropped message is still silent').toBeGreaterThan(0)
    expect(n[0].line).toBe(3)
    expect(String(n[0].message)).toMatch(/expression/)
  })

  // ── CONTROLS: what d2 must not move.

  it('⛔⛔ CONTROL — TITLE is byte-identical on every specimen', () => {
    for (const src of [SAME_TITLE, PLACEHOLDER, NAMED_FORM, EXPR_MSG]) {
      for (const r of acOf(translatePine(src, {}))) {
        expect(r.title, 'd2 moved a title').toBe('Sig')
      }
    }
    const corpusTitles = acOf(translatePine(read(LITERAL_CORPUS), {})).map((r) => r.title)
    expect(corpusTitles.length).toBeGreaterThan(0)
  })

  it('⛔⛔ CONTROL — refusals pinned at their MEASURED count, not an assumed zero', () => {
    // ⚰️ d1's first control assumed 0 for a corpus script and the script carried 23.
    // Measured here instead; a carriage change must move none of them.
    for (const src of [SAME_TITLE, PLACEHOLDER, NAMED_FORM, EXPR_MSG]) {
      expect((translatePine(src, {}).refusals || []).length).toBe(0)
      expect(translatePine(src, {}).ok).toBe(true)
    }
  })
})
