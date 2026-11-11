// ⛔ NO-LOOKBEHIND EQUIVALENCE RAIL (iOS 16 floor; src/noRegexLookbehind.test.js + agentNoLookbehindStrings.test.js).
//
// Six Agent sites carried a regex lookbehind, which Safari < 16.4 cannot parse: production's AgentPanel chunk threw at
// module load. Each was rewritten without one. This rail proves the rewrite changed nothing a caller sees.
//   BASELINE: the public outputs of every rewritten site (selectGroups / wordsSelect, relationMatch / RELATIVE,
//   hiddenPhraseIn, fieldNotes, leaksOf) over a frozen phrase corpus were RECORDED ON MASTER 96230b5598, BEFORE the
//   rewrite, into __fixtures__/noLookbehind/baseline.json (the corpus, plus a 12-hex sha256 digest of each input's
//   output). Today's code must reproduce every digest; a mismatch prints the input and today's output.
//   The corpus is the existing rails' own phrase sets (every string literal in app/src/agent's test files, read from the
//   files, never retyped) filtered to each site's words, plus phrases synthesised around each site (corpus.js).
//   Re-record ONLY on a tree whose product code is the baseline's:
//     NLB_WRITE_BASELINE=1 NLB_BASELINE_SHA=<sha> npx vitest run src/agent/agentNoLookbehindEquivalence.test.js
//   The OLD-vs-NEW pattern oracle (each old pattern kept verbatim, run against its replacement) is the second describe.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { selectGroups, wordsSelect } from './routing'
import { relationMatch, RELATIVE } from './deixis'
import { hiddenPhraseIn } from './capabilities/scanHidden'
import { fieldNotes } from './capabilities/screener'
import { leaksOf } from './__fixtures__/program/sentinels'
import { testFileLiterals, synthesised } from './__fixtures__/noLookbehind/corpus'

const BASELINE = path.join(__dirname, '__fixtures__', 'noLookbehind', 'baseline.json')
const SITES = ['routing', 'deixis', 'scanHidden', 'screener', 'sentinel']
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12)
const m2j = (m) => (m ? { i: m.index, t: m[0], g: [...m].slice(1).map((x) => (x === undefined ? null : x)) } : null)

/** The corpus, per site (computed from the tree once, then frozen into the baseline). */
function buildCorpus() {
  const { files, literals } = testFileLiterals()
  const syn = synthesised()
  const pick = (re) => literals.filter((s) => re.test(s))
  const REL = /\b(?:above|over|below|under|underneath|beneath|left|right|next|beside|alongside|adjacent|near|nearest|closest)\b/i
  return {
    files,
    routing: [...new Set([...pick(/them|stud|oscillat|\bmas\b/i), ...syn.theme, ...syn.study])],
    deixis: [...new Set([...pick(/\b(?:this|that|it)\b/i).filter((s) => REL.test(s)), ...syn.relation])],
    scanHidden: [...new Set([...pick(/composite|nasdaq|nyse/i), ...syn.composite])],
    screener: [...new Set([...pick(/[.:]\s/), ...syn.sentences])],
    sentinel: [...new Set(syn.sentinel)],
  }
}

function outputs(c) {
  const triples = []
  for (let i = 0; i < c.screener.length; i += 3) triples.push(c.screener.slice(i, i + 3).map((d, j) => ({ key: `f${i + j}`, description: d })))
  return {
    routing: c.routing.map((s) => { const r = selectGroups(s); return [r.selected.join(','), r.priority.join(','), r.matched, r.soft.join(','), wordsSelect('charts', s), wordsSelect('indicators', s)] }),
    deixis: c.deixis.map((s) => [m2j(relationMatch(s)), m2j(RELATIVE.exec(s))]),
    scanHidden: c.scanHidden.map((s) => hiddenPhraseIn(s)),
    screener: [...triples.map((f) => fieldNotes(f)), ...c.screener.map((d) => fieldNotes([{ key: 'k', description: d }]))],
    sentinel: c.sentinel.map((s) => [leaksOf(s), leaksOf({ a: s }), leaksOf([`x ${s} y`])]),
  }
}

describe('no-lookbehind equivalence: the outputs recorded on master before the rewrite are reproduced', () => {
  if (process.env.NLB_WRITE_BASELINE === '1') {
    it('records the baseline (run only on the baseline product code)', () => {
      const corpus = buildCorpus()
      const digests = Object.fromEntries(Object.entries(outputs(corpus)).map(([k, v]) => [k, v.map(digest)]))
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
      fs.writeFileSync(BASELINE, JSON.stringify({ recordedOn: process.env.NLB_BASELINE_SHA || 'unknown', corpus, digests }) + '\n')
    })
    return
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const now = outputs(base.corpus)

  it('the corpus holds the existing rails’ phrases and exercises each site both ways (non-vacuity)', () => {
    expect(base.recordedOn).toBe('96230b5598')
    expect(base.corpus.files).toBeGreaterThan(300)
    for (const k of SITES) expect(base.corpus[k].length, k).toBeGreaterThan(100)
    // W1.1 R-05 / BLOCKING-2 (agentW11RepairB.test.js) phrases, read from that file
    for (const p of ['stocks above the nasdaq composite', 'filter to composite over 85', 'outperforming the nasdaq composite']) expect(base.corpus.scanHidden).toContain(p)
    expect(now.scanHidden.filter((h) => h?.key === 'uct_composite').length).toBeGreaterThan(50)
    expect(now.scanHidden.filter((h) => h === null).length).toBeGreaterThan(50)
    expect(now.deixis.filter(([a]) => a).length).toBeGreaterThan(100)
    expect(now.deixis.filter(([a, b]) => !a && !b).length).toBeGreaterThan(100)
    expect(now.routing.filter((r) => r[4]).length).toBeGreaterThan(100)
    expect(now.routing.filter((r) => !r[4]).length).toBeGreaterThan(100)
    expect(now.routing.filter((r) => r[5]).length).toBeGreaterThan(100)
    expect(now.routing.filter((r) => !r[5]).length).toBeGreaterThan(100)
    expect(now.screener.filter((n) => n && Object.keys(n.key).length).length).toBeGreaterThan(5)
    expect(now.sentinel.filter(([a]) => a.length).length).toBeGreaterThan(10)
    expect(now.sentinel.filter(([a]) => !a.length).length).toBeGreaterThan(10)
  })
  for (const site of SITES) {
    it(`${site}: every output identical to the master baseline`, () => {
      const got = now[site].map(digest)
      expect(got.length).toBe(base.digests[site].length)
      const diffs = []
      got.forEach((d, i) => { if (d !== base.digests[site][i]) diffs.push([i, base.corpus[site][i], now[site][i]]) })
      expect(diffs.slice(0, 25)).toEqual([])
    })
  }
})
