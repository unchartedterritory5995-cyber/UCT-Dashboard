// Wave 5 fix round 2 (re-review R1-B1) — Whole-word find ALWAYS returns.
//
// ⛔ The defect: a rejected candidate resumed one UTF-16 unit on. Under the `u`
// flag a `lastIndex` inside a surrogate pair is snapped back to the pair's
// start, so "NVDA🚀" searched for 🚀 re-found the same candidate forever -- on
// every keystroke in the find field, with the member's tab frozen.
//
// ⛔ WHY A CHILD PROCESS: a synchronous infinite loop cannot be interrupted by
// the test runner (its timeout only fires between turns of the event loop), so
// a rail that ran the search in-process would hang the whole suite instead of
// failing. Each case runs the REAL noteFind.js over a REAL ProseMirror document
// in its own `node`, under a hard time box; a hang is a killed child and a RED
// test that says so. The correct matches are asserted too -- returning fast
// with the wrong answer is not a pass.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '../../../..') // where node_modules resolves
const FIND_URL = pathToFileURL(path.join(HERE, 'noteFind.js')).href
const TIME_BOX_MS = 5000 // the whole child, startup included
const SEARCH_BUDGET_MS = 500 // the search alone (it takes ~1 ms)

const CHILD = `
const chunks = []
for await (const ch of process.stdin) chunks.push(ch)
const c = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const { Schema } = await import('prosemirror-model')
const { findMatchesInDoc } = await import(c.findUrl)
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
const doc = schema.node('doc', null, c.paragraphs.map((t) => schema.node('paragraph', null, t ? [schema.text(t)] : [])))
const t0 = performance.now()
const found = findMatchesInDoc(doc, c.term, { wholeWord: true })
const ms = performance.now() - t0
process.stdout.write(JSON.stringify({ ms, found: found.map((m) => [doc.textBetween(m.from, m.to), m.from]) }))
`

function searchInAChild(paragraphs, term) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: APP,
    input: JSON.stringify({ findUrl: FIND_URL, paragraphs, term }),
    encoding: 'utf8',
    timeout: TIME_BOX_MS,
    windowsHide: true,
  })
  const wall = Date.now() - t0
  if (r.error?.code === 'ETIMEDOUT' || r.signal) {
    throw new Error(`the search for ${JSON.stringify(term)} did not return within ${TIME_BOX_MS} ms (killed after ${wall} ms): it loops`)
  }
  if (r.status !== 0) throw new Error(`the child failed (exit ${r.status}): ${r.stderr}`)
  return JSON.parse(r.stdout)
}

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' // 👨‍👩‍👧, one emoji of five code points
const THUMBS_TONE = '\u{1F44D}\u{1F3FD}' // 👍🏽

// [label, paragraphs, term, expected [text, from] pairs]
// Positions: the first paragraph's text starts at 1.
const CASES = [
  // the re-review's three, each of which never returned
  ['🚀 glued to a ticker (the emoji picker inserts exactly this)', ['NVDA🚀 breakout'], '🚀', []],
  ['🛢 followed by the emoji presentation selector (U+FE0F is a mark)', ['oil 🛢\uFE0F up'], '🛢', []],
  ['a CJK Extension B character glued to another', ['𠀀𠀁 x'], '𠀀', []],
  // ...and the scan goes ON past the rejected astral candidate to a real one
  ['🚀 glued, then 🚀 alone', ['NVDA🚀 then 🚀 now'], '🚀', [['🚀', 13]]],
  ['🛢\uFE0F (with selector), then 🛢 alone', ['oil 🛢\uFE0F and 🛢 up'], '🛢', [['🛢', 13]]],
  ['𠀀 glued, then 𠀀 alone', ['𠀀𠀁 𠀀 x'], '𠀀', [['𠀀', 6]]],
  // a surrogate-pair TERM inside a longer word (math letters are letters)
  ['𝐀𝐁 inside a word, then alone', ['x𝐀𝐁y and 𝐀𝐁'], '𝐀𝐁', [['𝐀𝐁', 12]]],
  // a whole word that starts INSIDE a rejected astral candidate
  ['resume inside an astral candidate ("𝐁𝐀 𝐀 𝐀", "𝐀 𝐀")', ['𝐁𝐀 𝐀 𝐀'], '𝐀 𝐀', [['𝐀 𝐀', 6]]],
  // ZWJ sequences: never split, and never a hang
  ['a ZWJ family glued to a ticker', [`NVDA${FAMILY}`], FAMILY, []],
  ['a ZWJ family, alone twice', [`${FAMILY} x ${FAMILY}`], FAMILY, [[FAMILY, 1], [FAMILY, 12]]],
  ['one member of a ZWJ family is not a whole word', [`${FAMILY} x`], '\u{1F469}', []],
  ['the first member of a ZWJ family is not a whole word', [FAMILY], '\u{1F468}', []],
  ['the last member of a ZWJ family is not a whole word', [`${FAMILY} x`], '\u{1F467}', []],
  ['a thumb with a skin tone is not the bare thumb; the bare one later is', [`${THUMBS_TONE} ok \u{1F44D}`], '\u{1F44D}', [['\u{1F44D}', 9]]],
  // a term that STARTS with a joiner or modifier, or ENDS with a joiner
  ['a bare skin tone is part of the thumb before it', [THUMBS_TONE], '\u{1F3FD}', []],
  ['a bare skin tone after a space stands alone', ['x \u{1F3FD}'], '\u{1F3FD}', [['\u{1F3FD}', 3]]],
  ['a term ending in a joiner is glued to what follows', [FAMILY], '\u{1F468}\u200D', []],
  ['a term ending in a joiner, before a space, stands alone', ['\u{1F468}\u200D x'], '\u{1F468}\u200D', [['\u{1F468}\u200D', 1]]],
  // control: an ordinary BMP search through the same child
  ['control: MU, a ticker, beside "much"', ['MU much MU'], 'MU', [['MU', 1], ['MU', 9]]],
]

describe('Whole-word find always returns, with the right matches (R1-B1)', () => {
  it.each(CASES)('%s', (_label, paragraphs, term, expected) => {
    const { ms, found } = searchInAChild(paragraphs, term)
    expect(ms, 'the search itself stays within its budget').toBeLessThan(SEARCH_BUDGET_MS)
    expect(found).toEqual(expected)
  }, TIME_BOX_MS * 3)

  it('non-vacuity: the child really searched (a case with matches found them)', () => {
    const { found } = searchInAChild(['NVDA🚀 then 🚀 now'], '🚀')
    expect(found.length).toBe(1)
  }, TIME_BOX_MS * 3)
})
