// RAIL: guide/listRefs.js's "my <name> list" regex lost its lookbehind (iOS 16 floor: noRegexLookbehind +
// agentNoLookbehindStrings); replaceNamed tests the character before the name instead, and nothing a caller sees moved.
// OLD = withListRefs as it was, kept verbatim here (a test file is outside the product scans); NEW = withListRefs today.
// Over every string literal in app/src/agent's test files that says "list" (or a list name used below), plus phrasings
// built around the name boundary, read with several sets of list names, both return the same words. The walkthrough-level
// check is evidence: docs/agent/program/evidence/teach-wl-widget/lookbehind/. LOCAL.
import { describe, it, expect } from 'vitest'
import { withListRefs } from './guide/listRefs'
import { testFileLiterals } from './__fixtures__/noLookbehind/corpus'

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function OLD(text, names) {
  let q = String(text || '')
  if (!names?.length || !q) return q
  for (const name of names) {
    const n = esc(name).replace(/\s+/g, '\\s+')
    const after = new RegExp(`\\b(to|from|in|into|on|onto|of|out of)\\s+(?:(?:my|the|this|our)\\s+)?${n}(?:\\s+(?:watch ?)?list)?(?=$|[^a-z0-9])`, 'gi')
    const named = new RegExp(`(?:\\b(?:my|the|this|our)\\s+)?(?<![a-z0-9])${n}\\s+(?:watch ?)?list\\b`, 'gi')
    q = q.replace(after, (_m, prep) => `${prep} my watchlist`).replace(named, 'my watchlist')
  }
  return q
}

const NAME_SETS = [
  ['Swing Ideas 2', 'Swing Ideas', 'Q4 Leaders', 'Momentum', 'Flagged'],
  ['AI', 'Tech', 'A1', 'my picks', 'Leaders', 'C++ (beta)', 'a.b'],
  ['ab', 'aa'], ['list'], ['Momentum'],
]
const BUILT = [
  'how do I rename my Momentum list', 'BigMomentum list', 'xMomentum list', '_Momentum list', '1Momentum list', 'Momentum list',
  'the Momentum watchlist', 'the Momentum watch list', 'myMomentum list', 'my  Momentum list', 'my Swing Ideas 2 list',
  'my Swing Ideas list and the Q4 Leaders list', 'aab list', 'aaab list', 'ab ab list', 'abab list', 'xab list then ab list',
  'MOMENTUM LIST', 'add NVDA to Momentum', 'from my Swing Ideas', 'out of Momentum list', 'the AI list', 'TheAI list',
  'my picks list', 'mymy picks list', 'C++ (beta) list', 'xa.b list', 'a.b list', 'Ä1 list', 'éMomentum list', 'list list',
  'the Tech list and Fintech list', 'tech list', 'ATech list', 'my A1 watchlist', 'the Leaders list', 'Q4 Leaders list',
]
const CORPUS = [...new Set([
  ...testFileLiterals().literals.filter((s) => /list|swing|momentum|leaders|flagged/i.test(s) && s.length < 300), ...BUILT,
])]

describe('listRefs: replaceNamed reads exactly what the lookbehind did', () => {
  it('the corpus is the rails\' own phrasings, not only the built ones', () => {
    expect(CORPUS.length).toBeGreaterThan(BUILT.length + 100)
  })
  it.each(NAME_SETS.map((s) => [s.join(' | '), s]))('names %s: old and new give the same words', (_label, names) => {
    const differ = CORPUS.filter((q) => withListRefs(q, names) !== OLD(q, names)).map((q) => [q, OLD(q, names), withListRefs(q, names)])
    expect(differ).toEqual([])
  })
  it.each([['BigMomentum list', 'BigMomentum list'], ['the Momentum list', 'my watchlist'], ['xMomentum list', 'xMomentum list'], ['_Momentum list', '_my watchlist']])('"%s" → "%s"', (q, want) => {
    expect(withListRefs(q, ['Momentum'])).toBe(want)
  })
})
