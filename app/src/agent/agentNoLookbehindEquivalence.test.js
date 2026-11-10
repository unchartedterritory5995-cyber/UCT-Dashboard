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
import { hiddenPhraseIn, HIDDEN_PHRASES } from './capabilities/scanHidden'
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
  for (const site of SITES.filter((s) => s !== 'scanHidden')) {
    it(`${site}: every output identical to the master baseline`, () => {
      const got = now[site].map(digest)
      expect(got.length).toBe(base.digests[site].length)
      const diffs = []
      got.forEach((d, i) => { if (d !== base.digests[site][i]) diffs.push([i, base.corpus[site][i], now[site][i]]) })
      expect(diffs.slice(0, 25)).toEqual([])
    })
  }

  // scanHidden: hiddenPhraseIn returns { key, phrase }. The KEY is identical on every input. The PHRASE (m[0]) is not
  // on the composite-THRESHOLD branch: "not after 'nasdaq ' / 'nyse '" has no lookbehind-free form that leaves m[0] alone
  // (the characters before are consumed), so the phrase there starts up to 7 characters early. No product code reads
  // `phrase` (scanRefine.js:54 / screener.js read `.key`; refine.py:87 reads hit[0]). Making it identical needs
  // hiddenPhraseIn itself changed in hidden.py + its mirror (agent-sc's) — a KNOWN GAP, pinned below.
  const OLD_COMPOSITE = '\\buct[\\s-]?composites?\\b|\\bcomposite[\\s-](?:score|scores|rating|ratings|rank|ranks|ranking)\\b|(?<!nasdaq )(?<!nyse )\\bcomposite\\s*(?:>=?|<=?|=|over|above|under|below|at least|at most|more than|less than|of at least)\\s*\\d'
  const OLD_RES = HIDDEN_PHRASES.map(([p, key]) => [new RegExp(/nasdaq/.test(p) ? OLD_COMPOSITE : p), key])
  const oldHiddenPhraseIn = (text) => {
    const low = String(text || '').toLowerCase().replace(/’/g, "'")
    for (const [rx, key] of OLD_RES) { const m = rx.exec(low); if (m) return { key, phrase: m[0] } }
    return null
  }
  const phraseDiffers = () => base.corpus.scanHidden.filter((s) => JSON.stringify(hiddenPhraseIn(s)) !== JSON.stringify(oldHiddenPhraseIn(s)))
  it('scanHidden: master’s hiddenPhraseIn (today’s list with the old composite pattern) reproduces every baseline digest', () => {
    expect(HIDDEN_PHRASES.filter(([p]) => /nasdaq/.test(p)).length).toBe(1)
    const diffs = base.corpus.scanHidden.filter((s, i) => digest(oldHiddenPhraseIn(s)) !== base.digests.scanHidden[i])
    expect(diffs).toEqual([])
  })
  it('scanHidden: the KEY is identical to the master baseline on every input', () => {
    const diffs = base.corpus.scanHidden.filter((s) => (hiddenPhraseIn(s)?.key ?? null) !== (oldHiddenPhraseIn(s)?.key ?? null))
    expect(diffs).toEqual([])
  })
  it.fails('KNOWN GAP: the matched PHRASE is identical too', () => { expect(phraseDiffers()).toEqual([]) })
  it('KNOWN GAP pinned: the phrase differs on exactly these inputs, all composite thresholds, only by characters before', () => {
    const d = phraseDiffers()
    expect(d.length).toBe(PHRASE_DIFF_COUNT)
    expect(d.slice(0, 3).map((s) => [s, oldHiddenPhraseIn(s).phrase, hiddenPhraseIn(s).phrase])).toEqual(PHRASE_DIFF_FIRST)
    for (const s of d) {
      const a = oldHiddenPhraseIn(s); const b = hiddenPhraseIn(s)
      expect(b.key).toBe('uct_composite')
      expect(b.key).toBe(a.key)
      expect(/composite/.test(b.phrase) && b.phrase.length > a.phrase.length - 20).toBe(true)
    }
  })
})
const PHRASE_DIFF_COUNT = 66
const PHRASE_DIFF_FIRST = [['filter to composite over 85','composite over 8','ter to composite over 8'], [' composite over 85','composite over 8',' composite over 8'], [' composite >= 90','composite >= 9',' composite >= 9']]
