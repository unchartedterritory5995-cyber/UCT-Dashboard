// app/src/components/chart/engine/ast/formulaDocs.test.js
//
// ─── 🔴 THE REFERENCE CANNOT GO STALE ────────────────────────────────────────
//
// Segment G6 asks for member-facing docs "generated from `closedTable.json` so
// it cannot go stale". This is the half that makes that true: the page is
// regenerated in memory on EVERY run and compared with what is committed, so a
// manifest edit that leaves the page behind fails here rather than shipping a
// reference that describes a function nobody has any more.
//
// ⭐ IT IS NOT A `toMatchSnapshot`. An auto-updating snapshot records what
// happened; this compares against a file a reviewer read and approved, and the
// diff is the thing they read. Same shape as `pineCorpus.json`'s regenerator,
// which this repo already trusts.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { renderFormulaDocs } from './formulaDocs.js'
import TABLE from './closedTable.json'

const DOC = path.resolve(process.cwd(), '../docs/formulas/GRAMMAR.md')

describe('the formula reference is derived, and it is current', () => {
  it('⭐⭐ regenerating changes nothing — the page matches the manifest', () => {
    const fresh = renderFormulaDocs()
    if (process.env.FORMULA_DOCS_WRITE) {
      fs.mkdirSync(path.dirname(DOC), { recursive: true })
      fs.writeFileSync(DOC, fresh)
    }
    expect(fs.existsSync(DOC),
      'docs/formulas/GRAMMAR.md is missing — regenerate with FORMULA_DOCS_WRITE=1').toBe(true)
    const onDisk = fs.readFileSync(DOC, 'utf8')
    // ⛔⛔ COMPARE CONTENT, NOT LINE ENDINGS. This read `onDisk === fresh` and
    // could NEVER pass on a Windows checkout: this box has `core.autocrlf=true`,
    // git stores the page LF and writes it out CRLF, and the generator emits
    // LF, so the two differed by exactly one carriage return per line
    // (22,461 vs 22,188 bytes, 273 lines) while the content was identical.
    // The failure it reported, 'no longer matches the manifest', was FALSE,
    // and the fix it prescribed - regenerate and commit - would have committed
    // a whitespace-only diff and re-broken on the next checkout. A rail whose
    // verdict depends on the reader's git config is not measuring the artifact.
    const eol = (t) => t.replace(/\r\n/g, '\n')
    expect(eol(onDisk) === eol(fresh),
      'the committed reference no longer matches the manifest. Regenerate with '
      + '`cd app && FORMULA_DOCS_WRITE=1 npx vitest run '
      + 'src/components/chart/engine/ast/formulaDocs.test.js` and read the diff.').toBe(true)
  })

  it('⛔ every function, scalar and clock name in the manifest appears on the page', () => {
    // ⚠️ THE COMPARISON ABOVE CANNOT CATCH A GENERATOR THAT SILENTLY DROPS A
    // SECTION — it would regenerate the same truncated page and agree with
    // itself. This asks the MANIFEST what should be there.
    const page = renderFormulaDocs()
    const missing = []
    for (const section of ['functions', 'scalars', 'clock', 'series', 'operators']) {
      for (const name of Object.keys(TABLE[section] || {})) {
        if (!page.includes(`\`${name}\``) && !page.includes(`\`${name}(`)) {
          missing.push(`${section}.${name}`)
        }
      }
    }
    expect(missing).toEqual([])
    // …and the page is not one enormous name list with no prose.
    expect(page).toMatch(/Why the list is closed/)
  })

  it('⭐ it renders a manifest it has never seen — so it is derived, not transcribed', () => {
    // ⛔⛔ THE NON-VACUITY THAT MATTERS. A generator with the real table's names
    // hard-coded would pass both cases above. This feeds it a table that shares
    // nothing with the shipped one and asserts the invented names come out.
    const fake = {
      tableVersion: 99,
      sessionMaxBars: 7,
      series: { zzprice: { field: 'z', doc: 'a planted series' } },
      clock: { zzclock: { sentence: 'a planted clock value' } },
      operators: { '%%': { arity: 2, yields: 'bool' } },
      functions: {
        zzfn: { args: ['series', 'int'], argRoles: ['source', 'period'],
          lookback: 'arg1', yields: 'num', sentence: 'a planted function of {0}' },
      },
      scalars: { zzscalar: { yields: 'num', cadence: 'nightly', sentence: 'a planted scalar' } },
    }
    const page = renderFormulaDocs(fake)
    expect(page).toContain('zzfn(source, period)')
    // ⭐ THE `{0}` SLOT IS FILLED FROM THE ARG ROLE, not printed raw. The
    // sentences are written for the READ-BACK, where `{0}` becomes the member's
    // actual argument; on a reference page there is no actual argument, and the
    // raw template shows a member the engine's internals. This case caught the
    // improvement going in — it asserted the raw form and had to move.
    expect(page).toContain('a planted function of `source`')
    expect(page).not.toContain('a planted function of {0}')
    expect(page).toContain('zzscalar')
    expect(page).toContain('zzclock')
    expect(page).toContain('%%')
    expect(page).toMatch(/version \*\*99\*\*/)
    // …and the lookback is DERIVED from the role, not printed raw.
    expect(page).toContain('whatever `period` asks for')
    // ⛔ and none of the REAL table leaked into a page built from the fake one.
    expect(page).not.toContain('rsi(')
    expect(page).not.toContain('market_cap')
  })

  it('⛔ a manifest entry with no sentence is rendered honestly, not invented', () => {
    // `series` and `operators` carry no `sentence` (measured: 0 of 5, 0 of 15).
    // The page must show what they DO declare rather than prose written in the
    // generator, which would be a second authority over what a name means.
    const page = renderFormulaDocs({
      tableVersion: 1, sessionMaxBars: 1,
      series: {}, clock: {}, functions: {}, scalars: {},
      operators: { '@@': { arity: 2, yields: 'num' } },
    })
    expect(page).toContain('`@@`')
    expect(page).toContain('a number')
  })
})
