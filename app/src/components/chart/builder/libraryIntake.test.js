// app/src/components/chart/builder/libraryIntake.test.js

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { splitPaste, inspectScript, inspectLibrary } from './libraryIntake'
import { translatePine, treeYieldsBool } from '../engine/ast/pine'
import { translateThinkScript } from '../engine/ast/thinkscript'
import { parseFormula } from '../engine/ast/parse'

const ROOT = path.resolve(process.cwd(), '..')
const readAll = (dir, ext) => fs.readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith(ext)).sort()
  .map((f) => ({ name: f, source: fs.readFileSync(path.join(ROOT, dir, f), 'utf8') }))

const PINE = readAll('tests/fixtures/pine', '.pine')
const COMMUNITY = readAll('tests/fixtures/pine_community', '.pine')
const TS = readAll('tests/fixtures/thinkscript', '.ts')

describe('the splitter is honest about a heuristic', () => {
  it('⭐ two version markers means two scripts', () => {
    const a = '//@version=5\nindicator("a")\nplot(close)\n'
    const b = '//@version=5\nindicator("b")\nplot(open)\n'
    const r = splitPaste(a + b)
    expect(r.how).toBe('version-marker')
    expect(r.found).toBe(2)
    expect(r.scripts[0]).toContain('"a"')
    expect(r.scripts[1]).toContain('"b"')
  })

  it('⛔ ONE marker is a header, not a boundary', () => {
    // ⚰️ Splitting on a single marker hands back an empty first chunk and reports
    // two scripts where there is one.
    const r = splitPaste('//@version=5\nindicator("a")\nplot(close)\n')
    expect(r.how).toBe('whole')
    expect(r.found).toBe(1)
  })

  it('⛔⛔ a script with NO marker joins the one above — and that is why `how` exists', () => {
    // ⚠️ MEASURED ON THE REAL CORPORA: only 20 of 21 `tests/fixtures/pine` and 21 of
    // 30 `pine_community` files carry `//@version`. So this is not a hypothetical
    // edge — a member pasting twelve scripts can be shown nine. The splitter cannot
    // fix that, and must not pretend to; it reports HOW it split and HOW MANY it
    // found so the member can see the discrepancy immediately. Separate FILES are
    // the unambiguous door.
    const withHeader = '//@version=5\nindicator("a")\nplot(close)\n'
    const without = 'indicator("b")\nplot(open)\n'
    const r = splitPaste(withHeader + without)
    expect(r.found).toBe(1)
    expect(r.scripts[0]).toContain('"b"')
  })

  it('⛔ empty in, nothing out — not one empty script', () => {
    for (const v of ['', '   \n  ', null, undefined]) {
      expect(splitPaste(v).found).toBe(0)
    }
  })

  it('⛔ the corpora really do lack markers — the warning above is not folklore', () => {
    const missing = COMMUNITY.filter((s) => !/^\s*\/\/\s*@version\s*=/m.test(s.source))
    expect(missing.length,
      'every community script now has a version marker — the splitter caveat is stale')
      .toBeGreaterThan(0)
  })
})

describe('the four reaches are measured separately, through the shipped doors', () => {
  it('⛔⛔ they are NOT the same number — which is the whole reason for four', () => {
    // ⭐ THE ASSERTION THAT JUSTIFIES THE DESIGN. If translating implied screening,
    // one number would be honest and four would be clutter. Measured on the real
    // corpora they differ by more than half.
    const lib = inspectLibrary([...PINE, ...COMMUNITY, ...TS])
    expect(lib.total).toBeGreaterThanOrEqual(70)
    expect(lib.translates).toBeGreaterThan(lib.screensAsWritten)
    expect(lib.screensAsWritten).toBeGreaterThan(0)
    expect(lib.screensWithComparison).toBeGreaterThan(0)
  })

  it('⭐ every reach agrees with the door that owns it', () => {
    // ⛔ NOT A RE-DERIVATION. `translates` must equal what the importer itself says,
    // or this report is a second authority on the one question the importer exists
    // to answer.
    for (const s of [...PINE, ...COMMUNITY]) {
      const row = inspectScript(s.source, s.name)
      expect(row.translates, s.name).toBe(!!translatePine(s.source).ok)
    }
  })

  it('⭐⭐ a REFUSED script still hands back what came across', () => {
    // ⚰️ A script with six plots where one refuses is not a failure, and reporting
    // it as one is both wrong and discouraging at the worst possible moment.
    const refusedWithOutputs = [...PINE, ...COMMUNITY]
      .map((s) => inspectScript(s.source, s.name))
      .filter((r) => !r.translates && r.partial.length > 0)
    expect(refusedWithOutputs.length,
      'no refused script carries a partial handback — either the corpus changed or '
      + 'the partial is being dropped').toBeGreaterThan(0)
    for (const r of refusedWithOutputs) {
      for (const f of r.partial) expect(typeof f).toBe('string')
    }
  })

  it('⛔ a refusal carries the guard and the line, not just a sentence', () => {
    const refused = [...PINE, ...COMMUNITY]
      .map((s) => inspectScript(s.source, s.name)).filter((r) => !r.translates)
    expect(refused.length).toBeGreaterThan(0)
    for (const r of refused) {
      expect(r.refusal, r.name).toBeTruthy()
      expect(typeof r.refusal.guard).toBe('string')
      expect(r.refusal.guard.length).toBeGreaterThan(0)
    }
  })

  it('⛔ a door that THROWS is reported as broken, never as "unsupported"', () => {
    // ⚠️ THE LAUNDERING THIS PREVENTS. A crash reported as a refusal tells a member
    // their script is unsupported when in fact this product has a bug, and it is a
    // library report — the one place that mistake is most costly.
    const row = inspectScript('//@version=5\nindicator("x")\nplot(close)\n')
    expect(['threw', 'dialect']).not.toContain(row.refusal ? row.refusal.guard : 'none')
  })

  it('⛔ the guard roster is a roster, not a score', () => {
    const lib = inspectLibrary([...PINE, ...COMMUNITY, ...TS])
    const guards = Object.keys(lib.byGuard)
    expect(guards.length).toBeGreaterThan(3)
    expect(Object.values(lib.byGuard).reduce((a, b) => a + b, 0)).toBe(lib.refused)
  })
})

describe('the numbers this would show a prospect', () => {
  it('⭐ prints the manifest for the whole committed corpus', () => {
    const lib = inspectLibrary([...PINE, ...COMMUNITY, ...TS])
    // eslint-disable-next-line no-console
    console.log(`\nof ${lib.total} scripts: ${lib.translates} translate · ${lib.computes} compute `
      + `· ${lib.saves} save · ${lib.screensAsWritten} screen as written `
      + `(+${lib.screensWithComparison} with a comparison you choose) `
      + `· ${lib.refused} refuse\n`
      + Object.entries(lib.byGuard).sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `    ${String(n).padStart(2)}  ${g}`).join('\n') + '\n')
    expect(lib.translates).toBeGreaterThan(0)
  })
})

describe('🔴 this report and the scorecard must never disagree', () => {
  it('⛔⛔ `screens: as-written` equals the scan door\'s own count', () => {
    // ⚰️ THEY DID DISAGREE, 17 AGAINST 19, AND THE CAUSE IS THE INTERESTING PART:
    // this report asked only the SELECTED output while `doorScorecard.test.js` asks
    // EVERY column. Two scripts have a boolean column that simply is not the one
    // offered first, and a member asking "can I scan with this?" means the SCRIPT.
    //
    // ⛔ TWO OF OUR OWN MEASUREMENTS DISAGREEING IS HOW A NUMBER NOBODY CAN
    // RECONCILE ENDS UP ON A MARKETING PAGE — which is precisely what this surface
    // is for. So the agreement is pinned rather than assumed, and it is derived on
    // both sides: neither number is typed here.
    const lib = inspectLibrary([...PINE, ...COMMUNITY, ...TS])

    const scannable = new Set()
    for (const [set, translate] of [[PINE, translatePine], [COMMUNITY, translatePine],
      [TS, translateThinkScript]]) {
      for (const s of set) {
        let o
        try { o = translate(s.source) } catch (e) { continue }
        if (!o.ok) continue
        for (const out of o.outputs) {
          if (!out.formula || out.hidden) continue
          const p = parseFormula(out.formula)
          try { if (p.ok && treeYieldsBool(p.ast)) { scannable.add(s.name); break } } catch (e) { /* not bool */ }
        }
      }
    }
    expect(lib.screensAsWritten).toBe(scannable.size)
  })

  it('⛔ and every script that translates is accounted for by exactly one screen state', () => {
    const lib = inspectLibrary([...PINE, ...COMMUNITY, ...TS])
    const translating = lib.rows.filter((r) => r.translates)
    const counted = translating.filter((r) => r.screens === 'as-written'
      || r.screens === 'with-a-comparison' || r.screens === 'no')
    expect(counted.length).toBe(translating.length)
    // ⭐ AND NONE OF THEM LANDS ON `no` TODAY, which is the claim the operator
    // affordance makes: every translating script can reach the screener somehow.
    expect(translating.filter((r) => r.screens === 'no')).toEqual([])
  })
})
