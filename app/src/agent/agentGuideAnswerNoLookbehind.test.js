// RAIL: guide/words.js `answer` lost its lookbehind piece (iOS 16 floor: agentNoLookbehindStrings.test.js) and the
// concept hits did not move. OLD = the answer concept as it was compiled before (the lookbehind piece kept verbatim here,
// a test file is outside the product scans); NEW = conceptsOf today. Over the answer-words corpus (agentGuideAnswerWords:
// the 6 IN phrasings and the OUT look-alikes) plus phrasings built around "ai" and "respons", both say the same thing.
// The walkthrough-level check (no held-out case reaches a different target) is evidence:
// docs/agent/program/evidence/teach-givens/lookbehind/. LOCAL.
import { describe, it, expect } from 'vitest'
import { conceptsOf } from './guide/words'

// the answer pieces before the change, compiled by words.js's own pieceRe rule (a piece with ? or * is `\b<piece>\w*`)
const OLD_PIECES = ['\\banswer\\w*', '\\breply\\w*', '\\brespons\\w*(?=.*\\bai\\b)\\w*', '\\b(?<=\\bai\\b.*)respons\\w*',
  '\\bwhat\\s+(?:the\\s+)?(?:ai(?:\\s+search)?|it|search)\\s+(?:said|wrote|told\\s+me|gave\\s+me|came\\s+back\\s+with)\\w*']
const OLD = new RegExp(OLD_PIECES.join('|'), 'i')
const oldHit = (q) => OLD.test(` ${q.toLowerCase().replace(/[’']/g, "'")} `)

const IN = [
  'show me how to copy what the AI search said',
  'how do I copy the AI search response',
  'show me how to save the response I got from AI search',
  'how do I copy what it wrote in AI search',
  'how do I save what the AI told me',
  'how do I copy what AI search came back with',
]
const OUT = [
  'how do I copy a layout', 'what did the AI say about NVDA', 'how do I save my notes',
  'how do I see what the chart said at the close', 'how do I check the response time', 'how do I see the API response',
  'how do I make a responsive layout', "the chart isn't responding", 'how do I fix the chart not responding',
]
const BUILT = [
  'ai response', 'the ai search response', 'the ai responses', 'responses from the ai', 'response ai', 'ai responsive',
  "the AI's response", 'AI: response', 'ai-generated responses', 'the aim response', 'the air response', 'said response',
  'response', 'ai', 'ai said', 'copy the AI reply', 'airesponse', 'ai\nresponse', 'responding ai', 'ai is responding',
  'how do I copy the response from the AI', 'how do I save AI search’s response', 'what is the response of ai search',
  'response time of the ai', 'the ai answer', 'ai ai response response', 'raid response', 'ai, then the response',
]

describe('words.js answer: the lookahead piece hits exactly where the lookbehind did', () => {
  it.each([...IN, ...OUT, ...BUILT])('"%s"', (q) => {
    expect(conceptsOf(q).has('answer')).toBe(oldHit(q))
  })
  it('the corpus still splits as the answer-words rail says', () => {
    expect(IN.filter((q) => !conceptsOf(q).has('answer'))).toEqual([])
    expect(OUT.filter((q) => conceptsOf(q).has('answer'))).toEqual([])
  })
})
