// #988 AUDIT HOLD (L1): #988 adds NO regex lookbehind (iOS 16.0–16.3 throw on one — noRegexLookbehind.test.js). Its two
// (deixis.js N_WORD, the walk count; spatialCheck.js EXCEPT, "everything but …") were rewritten BEHAVIOUR-EQUIVALENTLY. This
// rail holds them to the OLD forms (copied verbatim below; a test runs in Node, so a lookbehind is allowed here):
//   1. every string literal of every agent rail (src/agent/**/*.test.*) — the rails' own phrases — new === old, match by match;
//   2. a generated corpus around each lookbehind's edge (the word before the count; "but" after a scope word, "butter", "but
//      not") — new === old, and the outputs RECORDED (inline below, from the lookbehind code) so a later edit to either side shows.
// LOCAL: unit, no board.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { _walkExec } from './deixis'
import { exceptMatches } from './spatialCheck'

// ── the OLD forms, verbatim from 08fb7314ba ──
const N_WORD = '((?<=\\b(?:chart|charts|one|cell|cells|pane|panel|graph|neighbou?r|up|down|it|just|only|exactly|by|is|sits?)\\s)(?:a|an|one)|(?<![-\\w])(?:two|three|four|[1-4]))'
const WALK_FROM = `(?:\\s+(?:(?:away\\s+)?(?:from|of|to|than|as)\\s+)?(?:this|that|here|it|the\\s+(?:selected|clicked|current|highlighted|active|focused)(?:\\s+(?:chart|one))?|the\\s+one\\s+(?:that\\s+)?(?:i|you)(?:'ve|\\s+have|\\s+just)?\\s*(?:clicked|selected|picked|chose|chosen|highlighted|tapped)(?:\\s+on)?)(?:\\s+(?:chart|one|cell|pane|panel))?\\b)?`
const GRID_UNIT = '(?:columns?|charts?|cells?|spots?|places?|positions?|slots?|spaces?)'
const OLD_WALK = {
  V1: new RegExp(`\\b${N_WORD}\\s+rows?\\s+(up|down|higher|lower|above|below)\\b${WALK_FROM}`, 'i'),
  V2: new RegExp(`\\b(up|down)\\s+${N_WORD}\\s+rows?\\b${WALK_FROM}`, 'i'),
  H1: new RegExp(`\\b${N_WORD}\\s+(?:${GRID_UNIT}\\s+)?(?:over\\s+)?(?:(?:to|on)\\s+the\\s+)?(left|right)\\b(?!\\s+(?:above|below|under|over|beneath)\\b)${WALK_FROM}`, 'i'),
  H2: new RegExp(`\\b${N_WORD}\\s+(?:${GRID_UNIT}\\s+)?over\\b${WALK_FROM}`, 'i'),
}
const OLD_EXCEPT = /\b(?:except(?:\s+for)?|but\s+not|other\s+than|apart\s+from|excluding|save\s+for|minus|(?<=\b(?:everything|all|charts|ones|them|these|row|column|board))\s+but(?!\s+not\b))\s+((?:the\s+)?(?:top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(?:row|column)|(?:the\s+)?(?:(?:two|three|four|pair|2|3|4)\s+)?(?:(?:charts?|ones?)\s+)?(?:on|at|along)\s+the\s+(?:left|right|top|bottom)(?:\s+(?:side|edge|row|column))?|(?:the\s+)?[A-Za-z0-9 -]{1,30}?)(?=\s+(?:on|to|in|onto|at|for|from|please|thanks|weekly|daily|monthly|hourly)\b|\s*[,.;!?]|\s*$)/gi
const oldExceptForm = (t) => String(t || '').replace(/\b(everything|all|charts|ones|them|these|row|column|board|(?:every|each)\s+chart)\s+but\b(?!\s+not\b)/gi, '$1 except')

const shape = (m) => (m ? [m.index, ...m] : null)
const oldWalk = (k, s) => shape(OLD_WALK[k].exec(s))
const newWalk = (k, s) => shape(_walkExec(k, s))
const oldExcept = (s) => [...oldExceptForm(s).matchAll(OLD_EXCEPT)].map(shape)
const newExcept = (s) => exceptMatches(s).map(shape)
const KINDS = ['V1', 'V2', 'H1', 'H2']

function railPhrases() {
  const out = new Set()
  const walkDir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walkDir(p) } else if (/\.test\.jsx?$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8')
        for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){2,240})'|"((?:[^"\\\n]|\\.){2,240})"|`([^`$\\\n]{2,240})`/g)) out.add((m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"'))
      }
    }
  }
  walkDir(path.resolve(__dirname))
  return [...out]
}

const PRE = ['', 'the chart ', 'the charts ', 'the one ', 'move it ', 'move it up ', 'go down ', 'the top one ', 'the next-but-', 'x-', 'chart  ', 'it ', 'just ', 'only ', 'is ', 'sits ', 'sit ', 'neighbour ', 'neighbor ', 'by ', 'exactly ', 'graph ', 'cell ', 'pane ', 'Chart ', 'IT ', 'a ', 'the ', 'log on ']
const N = ['a', 'an', 'one', 'two', 'three', 'four', '1', '2', '3', '4', '5', 'One', 'A']
const TAIL = [' row up', ' rows down from this one', ' row higher than the clicked chart', ' over', ' chart over', ' to the left', ' columns over to the right of this', ' cell left', ' right above', ' left', ' spaces over from here']
const V2 = ['up a row', 'down two rows', 'up  a row', 'down an row', 'down one row from the selected one', 'move it up 1 row', 'up-a row', 'go down three rows from that chart', 'UP A ROW']
const WALK_CORPUS = [...PRE.flatMap(p => N.flatMap(n => TAIL.map(t => `${p}${n}${t}`))), ...V2]
const SCOPE = ['everything', 'all', 'charts', 'ones', 'them', 'these', 'row', 'column', 'board', 'every chart', 'each chart', 'the rest', 'anything', 'Everything', 'ALL']
const JOIN = [' but ', ' but not ', '  but ', ' butter ', ' except ', ' except for ', ' other than ', ' apart from ', ' excluding ', ' save for ', ' minus ', ' But ']
const WHAT = ['the TSLA one', 'SPY', 'the top row', 'the two on the left', 'the charts on the right side', 'this one', 'it', 'QQQ on log', 'NVDA, please', 'AMD weekly']
const EXCEPT_CORPUS = [...SCOPE.flatMap(s => JOIN.flatMap(j => WHAT.map(w => `log on ${s}${j}${w}`))), 'everything but', 'all but.', 'these but not SPY', 'log on all butter', 'all except SPY but QQQ', 'row but row but SPY']

describe('#988 L1: the rewritten walk count and exclusion match the lookbehind forms', () => {
  const phrases = railPhrases()
  it('the rails\' own phrases (every agent rail\'s string literals): new === old, every walk kind and every exclusion', () => {
    expect(phrases.length).toBeGreaterThan(5000)                      // non-vacuity: the rails were read
    let walks = 0, excepts = 0
    for (const s of phrases) {
      for (const k of KINDS) { const o = oldWalk(k, s); expect(newWalk(k, s), `${k} "${s}"`).toEqual(o); if (o) walks++ }
      const o = oldExcept(s); expect(newExcept(s), `except "${s}"`).toEqual(o); excepts += o.length
    }
    expect(walks).toBeGreaterThan(30)                               // 44 on 08fb7314ba
    expect(excepts).toBeGreaterThan(30)                             // 46 on 08fb7314ba
  })
  it('the generated edge corpus: new === old', () => {
    let rejectedCount = 0
    for (const s of WALK_CORPUS) for (const k of KINDS) {
      const o = oldWalk(k, s)
      expect(newWalk(k, s), `${k} "${s}"`).toEqual(o)
      // a phrase whose count the lookbehind REJECTED ("the top one over") — the edge is exercised, not only the happy path
      if (!o && new RegExp(OLD_WALK[k].source.replace(N_WORD, '(a|an|one|two|three|four|[1-4])'), 'i').exec(s)) rejectedCount++
    }
    expect(rejectedCount).toBeGreaterThan(100)
    for (const s of EXCEPT_CORPUS) expect(newExcept(s), `except "${s}"`).toEqual(oldExcept(s))
  })
  it('recorded outputs (from the lookbehind code, 08fb7314ba)', () => {
    const rec = (s) => [s, Object.fromEntries(KINDS.map(k => [k, newWalk(k, s)]).filter(([, v]) => v))]
    expect([
      'the chart one over', 'the top one over', 'move it up one row', 'up a row', 'up  a row', 'the next-but-one chart over',
      'x-2 over', 'two to the left', 'it one row down from this one', 'the one one over', 'is a row up', 'sit a row up',
    ].map(rec)).toMatchInlineSnapshot(`
      [
        [
          "the chart one over",
          {
            "H2": [
              10,
              "one over",
              "one",
            ],
          },
        ],
        [
          "the top one over",
          {},
        ],
        [
          "move it up one row",
          {
            "V2": [
              8,
              "up one row",
              "up",
              "one",
            ],
          },
        ],
        [
          "up a row",
          {
            "V2": [
              0,
              "up a row",
              "up",
              "a",
            ],
          },
        ],
        [
          "up  a row",
          {},
        ],
        [
          "the next-but-one chart over",
          {},
        ],
        [
          "x-2 over",
          {},
        ],
        [
          "two to the left",
          {
            "H1": [
              0,
              "two to the left",
              "two",
              "left",
            ],
          },
        ],
        [
          "it one row down from this one",
          {
            "V1": [
              3,
              "one row down from this one",
              "one",
              "down",
            ],
          },
        ],
        [
          "the one one over",
          {
            "H2": [
              8,
              "one over",
              "one",
            ],
          },
        ],
        [
          "is a row up",
          {
            "V1": [
              3,
              "a row up",
              "a",
              "up",
            ],
          },
        ],
        [
          "sit a row up",
          {
            "V1": [
              4,
              "a row up",
              "a",
              "up",
            ],
          },
        ],
      ]
    `)
    const exc = (s) => [s, newExcept(s).map(m => m[1])]
    expect([
      'log on everything but the TSLA one', 'log on all but not SPY', 'log on all butter', 'log on the rest but SPY', 'log on these  but SPY',
      'log on every chart but the top row', 'log on this row except the TSLA one', 'log on everything but.',
    ].map(exc)).toMatchInlineSnapshot(`
      [
        [
          "log on everything but the TSLA one",
          [
            "except the TSLA one",
          ],
        ],
        [
          "log on all but not SPY",
          [
            "but not SPY",
          ],
        ],
        [
          "log on all butter",
          [],
        ],
        [
          "log on the rest but SPY",
          [],
        ],
        [
          "log on these  but SPY",
          [
            "except SPY",
          ],
        ],
        [
          "log on every chart but the top row",
          [
            "except the top row",
          ],
        ],
        [
          "log on this row except the TSLA one",
          [
            "except the TSLA one",
          ],
        ],
        [
          "log on everything but.",
          [],
        ],
      ]
    `)
  })
})
