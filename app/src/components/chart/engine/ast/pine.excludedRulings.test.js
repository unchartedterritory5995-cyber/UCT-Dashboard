// app/src/components/chart/engine/ast/pine.excludedRulings.test.js
//
// ─── ⚰️ THE TABLE HAD ALREADY RULED, AND THE REFUSAL NEVER ASKED ──────────────
//
// `closedTable.json::_functions_excluded` is keyed by name, carries the reason
// for every indicator a formula may not spell, and is already rendered to members
// on the formula reference page. The Pine function fallthrough never consulted
// it — so `ta.variance`, `ta.sar` and `ta.obv` were answered with an alphabetical
// dump of the 64 names the table DOES declare, which says nothing about the one
// that was asked for.
//
// ⭐ THE RULING IS THE MANIFEST'S SENTENCE, NOT ONE WRITTEN IN THE DOOR — the same
// arrangement `docBlockedTail` uses on the thinkScript side, so a refusal and its
// documentation cannot drift apart.
//
// ⛔ ONLY THE LEAD IS QUOTED. `_functions_excluded.obv` is 2,174 characters and
// belongs on the page that renders it; its first sentence is the actionable part.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { TABLE } from './parse.js'

const screen = (body) =>
  translatePine(`//@version=6\nindicator("s")\nplot(${body} ? 1 : 0)\n`)
const refusalFor = (body) => {
  const out = screen(body)
  expect(out.ok, `${body} unexpectedly translated`).toBe(false)
  return out.refusal
}
const flat = (t) => String(t).replace(/\s+/g, ' ').trim()

describe('a name this table has RULED on gets its ruling', () => {
  it('⭐⭐ the quoted lead really is the manifest’s own words', () => {
    // ⛔ DERIVED, NOT TYPED. The assertion is that the refusal quotes a PREFIX of
    // the entry in `closedTable.json` — so rewording the ruling there moves the
    // refusal with it, and rewording it here fails.
    for (const name of ['variance', 'sar', 'obv']) {
      const ruling = flat(TABLE._functions_excluded[name]).replace(/^[^A-Za-z`]+/, '')
      const msg = flat(refusalFor(`ta.${name}(close, 20) > 1`).message)
      const quoted = msg.slice(msg.indexOf('RULED on that name: ') + 'RULED on that name: '.length)
      expect(quoted.length, `${name}: nothing quoted`).toBeGreaterThan(20)
      expect(ruling.startsWith(quoted.replace(/\s+$/, '')),
        `${name}: the refusal quotes something the manifest does not say —\n  quoted: ${quoted}\n  ruling: ${ruling.slice(0, 120)}`).toBe(true)
      // ⛔⛔ IT MUST BE A WHOLE SENTENCE, NOT A SLICE. A blind 220-character cut
      // is ALSO a prefix, so `startsWith` alone cannot tell the two apart —
      // measured: mutating `rulingLead` to take a fixed slice left this file GREEN
      // until these two lines existed. `obv` is 2,174 characters, so a lead that
      // runs to the cap is a lead that never found its sentence.
      expect(quoted.trim().endsWith('.'), `${name}: the lead is cut mid-sentence`).toBe(true)
      expect(quoted.length, `${name}: the lead is not a lead`).toBeLessThan(200)
    }
  })

  it('⭐⭐ `ta.variance` names the spelling that WORKS — and it does work', () => {
    // ⚠️ A REFUSAL NAMING A WAY FORWARD IS A PROMISE ABOUT A RUN. The ruling says
    // variance is "ALREADY EXPRESSIBLE: `stdev(x, n) * stdev(x, n)`", so the rail
    // runs that spelling rather than trusting the sentence.
    const msg = refusalFor('ta.variance(close, 20) > 1').message
    expect(msg).toContain('ALREADY EXPRESSIBLE')
    expect(msg).toContain('stdev')
    const works = screen('ta.stdev(close, 20) * ta.stdev(close, 20) > 1')
    expect(works.ok, works.ok ? '' : works.refusal.message).toBe(true)
    expect(works.outputs[works.selected].formula)
      .toBe('stdev(close, 20) * stdev(close, 20) > 1 ? 1 : 0')
  })

  it('⛔ an UNRULED unknown name still gets the declared list', () => {
    // ⭐ NON-VACUITY. Without this, a change that quoted a ruling for everything
    // — or that dropped the list entirely — would pass the cases above.
    const msg = refusalFor('ta.frobnicate(close) > 0').message
    expect(msg).toContain('This table declares')
    expect(msg).not.toContain('RULED on that name')
  })

  it('⛔ `ta.cum` keeps the bespoke sentence it already had', () => {
    // ⚠️ `PINE_INEXPRESSIBLE` is consulted BEFORE this, and its `cum` entry is a
    // better sentence than the ruling lead would be. The new branch must not have
    // moved in front of it.
    const msg = refusalFor('ta.cum(volume) > 0').message
    expect(msg).toContain('names no anchor')
    expect(msg).not.toContain('RULED on that name')
  })
})
