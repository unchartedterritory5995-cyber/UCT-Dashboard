// ⛔ NO-LOOKBEHIND EQUIVALENCE — the ORACLE half (the baseline half is agentNoLookbehindEquivalence.test.js).
// Each OLD lookbehind pattern, kept verbatim here (a test file is outside the product scans), is run against the
// product's NEW pattern over every string literal of the Agent's test files (the existing rails' phrase sets: routing,
// screener, scanHidden / W1.1 R-05, deixis / relation), the synthesised phrases, and a seeded fuzz corpus per site.
import { describe, it, expect } from 'vitest'
import { GROUPS } from './routing'
import { RELATIVE } from './deixis'
import { HIDDEN_PHRASES } from './capabilities/scanHidden'
import { fieldNotes } from './capabilities/screener'
import { testFileLiterals, synthesised, fuzz } from './__fixtures__/noLookbehind/corpus'

const m2j = (m) => (m ? { i: m.index, t: m[0], g: [...m].slice(1).map((x) => (x === undefined ? null : x)) } : null)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const OLD = {
  theme: /\b(?<!(?:light|dark|app|uct|site) )themes?\b/,
  study: /\b(?<!case )stud(?:y|ies)\b|\boscillators\b|\bmas\b/,
  composite: '\\buct[\\s-]?composites?\\b|\\bcomposite[\\s-](?:score|scores|rating|ratings|rank|ranks|ranking)\\b|(?<!nasdaq )(?<!nyse )\\bcomposite\\s*(?:>=?|<=?|=|over|above|under|below|at least|at most|more than|less than|of at least)\\s*\\d',
  relFrag: '(?![\\s-]+[a-z]+\\b(?<!\\b(?:to|on|in|and|then|please|for|with|as|into|onto|now|weekly|daily|monthly|hourly|intraday|instead|too|also|here)))',
  token: (s) => new RegExp(`(?<![0-9A-Za-z_.])${esc(s)}(?![0-9A-Za-z_]|\\.\\d)`),
  sentencesOf: (t) => String(t).split(/(?<=[.:])\s+/).filter(Boolean),
}
const NEW_REL_FRAG = '(?![\\s-]+(?!(?:to|on|in|and|then|please|for|with|as|into|onto|now|weekly|daily|monthly|hourly|intraday|instead|too|also|here)\\b)[a-z]+\\b)'
const NEW_TOKEN = (s) => new RegExp(`(?:^|[^0-9A-Za-z_.])${esc(s)}(?![0-9A-Za-z_]|\\.\\d)`)

/** fieldNotes as it was on master 96230b5598, verbatim (its splitter is the old lookbehind one). */
function oldFieldNotes(fields) {
  const sentencesOf = OLD.sentencesOf
  const seen = new Map()
  for (const f of fields) for (const s of new Set(sentencesOf(f.description || ''))) seen.set(s, (seen.get(s) || 0) + 1)
  const key = {}
  const mark = new Map()
  for (const [s, n] of seen) {
    if (n < 2 || s.length < 24) continue
    const id = mark.size < 26 ? String.fromCharCode(97 + mark.size) : `z${mark.size}`
    mark.set(s, id)
    key[id] = s
  }
  const notes = {}
  for (const f of fields) {
    if (!f.description) continue
    notes[f.key] = sentencesOf(f.description).map(s => (mark.has(s) ? `[${mark.get(s)}]` : s)).join(' ')
  }
  return Object.keys(notes).length ? { notes, key } : null
}

describe('no-lookbehind ORACLE: old pattern vs new over the test literals + synthesised + fuzz', () => {
  const { literals } = testFileLiterals()
  const syn = synthesised()
  const both = (xs) => [...new Set([...xs, ...xs.map((s) => s.toLowerCase())])]
  const corpora = {
    theme: both([...literals, ...syn.theme, ...fuzz(['light', 'dark', 'app', 'uct', 'site', ' ', '  ', 'theme', 'themes', 's', 'x', '-', '.', 'de', 'a', '\n', 'Theme', 'l', 'ight', 'ark', 'pp'], 60000, 1)]),
    study: both([...literals, ...syn.study, ...fuzz(['case', ' ', 'stud', 'study', 'studies', 'y', 'ies', 's', 'show', 'x', '-', '.', 'c', 'ase', 'oscillators', 'mas', 'Case'], 60000, 2)]),
    composite: both([...literals, ...syn.composite, ...fuzz(['nasdaq', 'nyse', ' ', 'composite', 'over', '>=', '85', '8', 'a', 'n', 'yse', 'sdaq', '-', 'x', 'uct', 'score', '\t', 'at least', '.', 'ny', 'se'], 60000, 3)]),
    relation: [...new Set([...literals, ...syn.relation, ...fuzz(['this', 'that', 'it', ' ', '-', 'to', 'on', 'in', 'here', 'toy', 'above', 'below', 'left', 'of', 'right', 'next', 'the', 'one', 'chart', 'nvda', '5', 'into', 'onto', 'x', 'THIS', ' the selected', 'To', '_', 'é', 'please', 'weekly'], 60000, 4)])],
    sentences: [...new Set([...literals, ...syn.sentences, ...fuzz(['a', '.', ':', ' ', '\n', '\t', 'b', '..', 'x y', '.:', '  ', 'Sentence long enough to share here.'], 30000, 5)])],
    sentinel: [...new Set([...literals, ...syn.sentinel, ...fuzz(['13579.2468', '987.654321', 'ISO-SENTINEL-7y3', ' ', 'a', '1', '.', '_', '-', 'x', '5', ':'], 30000, 6)])],
  }
  const newTheme = GROUPS.find((g) => g.id === 'charts').words.find((re) => /themes\?/.test(re.source))
  const newStudy = GROUPS.find((g) => g.id === 'indicators').words.find((re) => /stud\(\?:y\|ies\)/.test(re.source))
  const newComposite = new RegExp(HIDDEN_PHRASES.find(([p]) => /nasdaq/.test(p))[0])
  const oldComposite = new RegExp(OLD.composite)
  const oldRelative = new RegExp(RELATIVE.source.split(NEW_REL_FRAG).join(OLD.relFrag), 'i')

  it('the corpora are large and the new patterns are the product’s own (non-vacuity)', () => {
    expect(literals.length).toBeGreaterThan(10000)
    for (const [k, c] of Object.entries(corpora)) expect(c.length, k).toBeGreaterThan(30000)
    expect(newTheme).toBeTruthy()
    expect(newStudy).toBeTruthy()
    expect(RELATIVE.source.split(NEW_REL_FRAG).length).toBe(2) // the new fragment is in RELATIVE exactly once
    expect(oldRelative.source).not.toBe(RELATIVE.source)
  })
  const same = (name, corpus, f, g, needNo = true) => it(`${name}: identical on every input`, () => {
    const diffs = []
    let yes = 0
    let no = 0
    for (const s of corpus) {
      const a = JSON.stringify(f(s)); const b = JSON.stringify(g(s))
      if (a !== b) diffs.push([s, a, b])
      else if (a === 'false' || a === 'null' || a === '[false,false]') no += 1
      else yes += 1
    }
    expect(diffs.slice(0, 20)).toEqual([])
    expect(yes, 'inputs where it matches').toBeGreaterThan(100)
    if (needNo) expect(no, 'inputs where it does not').toBeGreaterThan(100)
  })
  same('routing.js CG-25 theme (.test)', corpora.theme, (s) => OLD.theme.test(s), (s) => newTheme.test(s))
  same('routing.js CG-28 studies (.test)', corpora.study, (s) => OLD.study.test(s), (s) => newStudy.test(s))
  same('deixis.js RELATIVE (.exec: index, text, groups)', corpora.relation, (s) => m2j(oldRelative.exec(s)), (s) => m2j(RELATIVE.exec(s)))
  same('screener.js fieldNotes, one field', corpora.sentences, (s) => oldFieldNotes([{ key: 'k', description: s }]), (s) => fieldNotes([{ key: 'k', description: s }]), false) // never null: one described field always has notes
  same('sentinels.js token (.test, each numeric sentinel)', corpora.sentinel, (s) => ['13579.2468', '987.654321'].map((t) => OLD.token(t).test(s)), (s) => ['13579.2468', '987.654321'].map((t) => NEW_TOKEN(t).test(s)))
  it('screener.js fieldNotes, fields of three (shared sentences become keys)', () => {
    const c = corpora.sentences
    let keyed = 0
    for (let i = 0; i < c.length; i += 3) {
      const f = c.slice(i, i + 3).map((d, j) => ({ key: `f${j}`, description: d }))
      const want = oldFieldNotes(f)
      expect(fieldNotes(f)).toEqual(want)
      if (want && Object.keys(want.key).length) keyed += 1
    }
    expect(keyed).toBeGreaterThan(10)
  })
  // scanHidden: the new uct_composite pattern captures its words in a lookahead group, and hiddenPhraseIn returns the first
  // group that matched (else m[0]); so the comparison is old m[0] against the new pattern's phrase, by that same rule.
  const phraseOf = (m) => (m ? (m.slice(1).find((g) => g !== undefined) ?? m[0]) : null)
  same('scanHidden.js uct_composite pattern: the same words matched (or none)', corpora.composite, (s) => (oldComposite.exec(s) || [null])[0], (s) => phraseOf(newComposite.exec(s)))
  it('scanHidden.js: hiddenPhraseIn over every pattern equals master’s (old list, m[0]) on every composite input', async () => {
    const { hiddenPhraseIn } = await import('./capabilities/scanHidden')
    const OLD_RES = HIDDEN_PHRASES.map(([p, key]) => [new RegExp(/nasdaq/.test(p) ? OLD.composite : p), key])
    const oldHidden = (text) => {
      const low = String(text || '').toLowerCase().replace(/’/g, "'")
      for (const [rx, key] of OLD_RES) { const m = rx.exec(low); if (m) return { key, phrase: m[0] } }
      return null
    }
    const diffs = corpora.composite.filter((s) => JSON.stringify(oldHidden(s)) !== JSON.stringify(hiddenPhraseIn(s)))
    expect(diffs.slice(0, 20)).toEqual([])
    // every OTHER pattern captures nothing, so the "first group" rule leaves its phrase m[0]
    for (const [p] of HIDDEN_PHRASES.filter(([q]) => !/nasdaq/.test(q))) expect(new RegExp(`${p}|`).exec('').length, p).toBe(1)
  })
})
