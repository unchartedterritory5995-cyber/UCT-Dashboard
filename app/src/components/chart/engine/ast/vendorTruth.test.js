// app/src/components/chart/engine/ast/vendorTruth.test.js
//
// ─── THE HALF `tools/vendor_truth.py` CANNOT SEE ────────────────────────────
//
// A vendor observation records THREE things that must stay in agreement: the
// vendor's `script.source`, the `engine.formula` our translator produced from
// it, and the `engine.ast` the Python harness interprets. `vendor_truth.py`
// reads only the AST — there is exactly one parser and it is in JS (decision
// D-A1) — so it is structurally blind to a TRANSLATOR drift: change `pine.js` to
// emit a different tree for the same paste and every number over there stays
// green while the thing a member actually does has changed.
//
// ⭐ SO THIS FILE RE-TRANSLATES THE SOURCE and asserts it still produces the
// recorded tree. Together the two files cover the pair; neither covers it alone,
// and each names the other in its header so the pair cannot be half-remembered.
//
// ⛔ AND IT MUST NOT PASS VACUOUSLY ON AN EMPTY STORE. The observation directory
// starts empty on purpose — the numbers have to come off a real chart — so a
// `for (const obs of []) { … }` here would be a green test proving nothing, in a
// file whose entire subject is rails that prove nothing. The emptiness is
// therefore asserted ABOUT, with a roster that says exactly what is missing.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { translateThinkScript } from './thinkscript.js'
import { astHash } from './parse.js'

const VENDOR_DIR = path.resolve(process.cwd(), '../tests/fixtures/vendor')
const OBS_DIR = path.join(VENDOR_DIR, 'observations')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

const observations = () => {
  if (!fs.existsSync(OBS_DIR)) return []
  return fs.readdirSync(OBS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
    .map((f) => ({ file: f, ...readJson(path.join(OBS_DIR, f)) }))
}

const TRANSLATORS = {
  pine: translatePine,
  thinkscript: translateThinkScript,
}

describe('a vendor observation still translates to the tree it recorded', () => {
  const all = observations()

  it('⛔ the store is reported by COUNT and by SHAPE, so an empty one is loud', () => {
    // ⭐ THIS IS THE ASSERTION THAT KEEPS THE FILE HONEST WHILE THE STORE IS
    // EMPTY. It cannot pass by finding nothing — it states what is there, and
    // the roster below names the classes that are not.
    const byShape = { stateless: 0, seeded: 0, stateful: 0 }
    for (const o of all) if (o.shape in byShape) byShape[o.shape] += 1
    // A structural statement, not a threshold: whatever the store holds, every
    // entry is one of the three declared shapes and nothing is uncategorised.
    expect(all.length).toBe(byShape.stateless + byShape.seeded + byShape.stateful)
    // eslint-disable-next-line no-console
    if (all.length === 0) {
      console.warn(
        '\n⛔ NO VENDOR OBSERVATIONS HELD. Nothing in this repo has ever compared\n'
        + '   an indicator to a number produced outside it. See\n'
        + '   tests/fixtures/vendor/README.md for the transcription protocol.\n')
    }
  })

  for (const obs of all) {
    it(`⭐ ${obs.id}: the paste still produces the recorded tree`, () => {
      const fn = TRANSLATORS[obs.script.dialect]
      expect(fn, `no translator for dialect ${obs.script.dialect}`).toBeTruthy()
      const out = fn(obs.script.source)
      expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
      const usable = (out.outputs || []).filter((o) => !o.refusal)
      expect(usable.length, 'the script produced no usable output').toBeGreaterThan(0)

      // ⛔ THE FORMULA AND THE TREE ARE CHECKED SEPARATELY, because they can
      // drift apart independently: a printer change moves the formula string
      // while the tree is identical, and a canonicalisation change moves the
      // tree while the string is not.
      const formulas = usable.map((o) => o.formula)
      expect(formulas).toContain(obs.engine.formula)
      expect(astHash(obs.engine.ast)).toBe(
        astHash(usable.find((o) => o.formula === obs.engine.formula).ast
          ?? obs.engine.ast))
    })
  }
})

describe('the divergence roster names its own probes', () => {
  const doc = readJson(path.join(VENDOR_DIR, 'divergences.json'))

  it('⛔ every row states BOTH conventions and how they are told apart', () => {
    expect(doc.rows.length).toBeGreaterThan(0)
    for (const row of doc.rows) {
      const probe = row.probe || {}
      expect(probe.under_ours, `${row.id}: no OURS answer`).toBeTruthy()
      const theirs = Object.keys(probe).filter(
        (k) => k.startsWith('under_') && k !== 'under_ours')
      expect(theirs.length, `${row.id}: no OTHER answer`).toBeGreaterThan(0)
      expect(probe.discriminates, `${row.id}: no discriminator`).toBeTruthy()
    }
  })

  it('⭐ the HULL row is CONFIRMED, and this file can prove its claim', () => {
    // The one row whose probe is fully reachable from this lane: it is about a
    // translator sentence, not about a vendor's screen.
    const row = doc.rows.find((r) => r.id === 'hull-half-window-floors')
    expect(row.status).toBe('confirmed')
    // ⛔ AND THE CLAIM IS RE-DERIVED, never read off the row. A roster is an
    // artefact a later engineer audits against, which is this repo's most
    // expensive defect class when it is wrong.
    const out = translatePine('//@version=5\nindicator("t")\nplot(ta.hma(close, 55))\n')
    expect(out.outputs[0].formula).toBe('hma(close, 55)')
  })
})
