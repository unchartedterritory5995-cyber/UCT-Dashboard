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
// in its own `node`; a hang is a killed child and a RED test that says so. The
// correct matches are asserted too -- returning fast with the wrong answer is
// not a pass.
//
// ⛔⛔ THE TIME BOX STARTS WHEN THE SEARCH DOES, NOT WHEN THE CHILD DOES
// (re-review R2-N3). Node's startup and the prosemirror-model import happen
// before any search, and on a loaded box they alone can take seconds; a single
// box around the whole child read that as "it loops". So the child reports a
// `started` line (with its own startup time) immediately before it calls
// findMatchesInDoc, and the two budgets are separate:
//  - STARTUP_BOX_MS: generous. A child that never reaches its search inside it
//    is INCONCLUSIVE -- a slow box, never a verdict about the search;
//  - SEARCH_BOX_MS: armed on the `started` line. A kill after it is a loop.
// The search's own duration is timed INSIDE the child, too.
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '../../../..') // where node_modules resolves
const FIND_URL = pathToFileURL(path.join(HERE, 'noteFind.js')).href
const STARTUP_BOX_MS = 60000 // node + imports + building the doc, however slow the box
const SEARCH_BOX_MS = 5000 // from the `started` line: a search still running then loops
const SEARCH_BUDGET_MS = 500 // the search alone, timed in the child (it takes ~1 ms)
const TEST_TIMEOUT_MS = STARTUP_BOX_MS + SEARCH_BOX_MS + 10000

const CHILD = `
const bootedAt = performance.now()
const chunks = []
for await (const ch of process.stdin) chunks.push(ch)
const c = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const { Schema } = await import('prosemirror-model')
const { findMatchesInDoc } = await import(c.findUrl)
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
const doc = schema.node('doc', null, c.paragraphs.map((t) => schema.node('paragraph', null, t ? [schema.text(t)] : [])))
process.stdout.write(JSON.stringify({ started: true, startupMs: performance.now() - bootedAt }) + '\\n')
const t0 = performance.now()
const found = findMatchesInDoc(doc, c.term, { wholeWord: true })
const ms = performance.now() - t0
process.stdout.write(JSON.stringify({ ms, found: found.map((m) => [doc.textBetween(m.from, m.to), m.from]) }) + '\\n')
`

/** What one child did: `inconclusive`, `loops`, `failed`, or `returned` with its result. */
function runChild(paragraphs, term, { child = CHILD, startupBoxMs = STARTUP_BOX_MS, searchBoxMs = SEARCH_BOX_MS } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', child], { cwd: APP, windowsHide: true })
    const spawnedAt = Date.now()
    let out = ''
    let err = ''
    let started = null
    let searchTimer = null
    let settled = false
    const finish = (verdict) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      clearTimeout(searchTimer)
      proc.kill()
      resolve(verdict)
    }
    const startupTimer = setTimeout(() => finish({
      verdict: 'inconclusive',
      detail: `the child never reached its search within ${startupBoxMs} ms of spawning -- a slow start, not a loop`,
    }), startupBoxMs)
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      out += chunk
      const lines = out.split('\n')
      lines.pop() // the last piece is a line still being written (or '')
      for (let i = 0; i < lines.length; i++) lines[i] = JSON.parse(lines[i])
      if (!started && lines[0]?.started) {
        started = { ...lines[0], at: Date.now() }
        clearTimeout(startupTimer)
        searchTimer = setTimeout(() => finish({
          verdict: 'loops',
          startupMs: started.startupMs,
          detail: `the search for ${JSON.stringify(term)} started (after ${Math.round(started.startupMs)} ms of startup) and had not returned ${searchBoxMs} ms later: it loops`,
        }), searchBoxMs)
      }
      if (lines[1]) finish({ verdict: 'returned', startupMs: started?.startupMs, ...lines[1] })
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk) => { err += chunk })
    // 'close', not 'exit': 'exit' can fire before the last stdout data arrives.
    proc.on('close', (code) => {
      if (!settled) finish({ verdict: 'failed', detail: `the child exited ${code} after ${Date.now() - spawnedAt} ms: ${err}` })
    })
    proc.stdin.end(JSON.stringify({ findUrl: FIND_URL, paragraphs, term }))
  })
}

async function searchInAChild(paragraphs, term) {
  const r = await runChild(paragraphs, term)
  if (r.verdict !== 'returned') throw new Error(`${r.verdict.toUpperCase()}: ${r.detail}`)
  return r
}

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' // 👨‍👩‍👧, one emoji of five code points
const US = '\u{1F1FA}\u{1F1F8}' // two regional indicators: ONE flag
const GB = '\u{1F1EC}\u{1F1E7}'
const RI_U = '\u{1F1FA}'
const RI_S = '\u{1F1F8}'
const SG = '\u{1F1F8}\u{1F1EC}' // also the SEAM of US + GB, which is not a flag
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}' // black flag + tags
const BLACK_FLAG = '\u{1F3F4}'
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
  // flags (re-review R2-N2): a regional-indicator PAIR is one emoji
  ['half a flag is not a whole word: 🇺 inside 🇺🇸', [`${US} rally`], RI_U, []],
  ['the second half either: 🇸 inside 🇺🇸', [`${US} rally`], RI_S, []],
  ['a flag beside words is a whole word', [`NVDA ${US} rally`], US, [[US, 6]]],
  ['a flag glued to a ticker is not (the picker inserts exactly this)', [`NVDA${US} rally`], US, []],
  ['two flags in a row are two whole words', [`${US}${GB} and ${GB}`], GB, [[GB, 5], [GB, 14]]],
  ['...and the first of them too', [`${US}${GB}`], US, [[US, 1]]],
  ['the seam of two flags is not a third flag (🇸🇬 inside 🇺🇸🇬🇧)', [`${US}${GB} vs ${SG}`], SG, [[SG, 13]]],
  ['a lone indicator after a whole flag is its own', [`${US}${RI_U} x`], RI_U, [[RI_U, 5]]],
  ['5,000 flags stay linear and never split', [US.repeat(5000)], RI_U, []],
  // tag sequences (subdivision flags): the tags are part of the flag
  ['🏴 inside the England flag is not a whole word', [`${ENGLAND} win`], BLACK_FLAG, []],
  ['the England flag itself is', [`go ${ENGLAND} win`], ENGLAND, [[ENGLAND, 4]]],
  ['a bare 🏴 still matches', [`${BLACK_FLAG} ${ENGLAND}`], BLACK_FLAG, [[BLACK_FLAG, 1]]],
  ['a lone cancel tag is part of the flag before it', [`${ENGLAND} win`], '\u{E007F}', []],
  // control: an ordinary BMP search through the same child
  ['control: MU, a ticker, beside "much"', ['MU much MU'], 'MU', [['MU', 1], ['MU', 9]]],
]

describe('Whole-word find always returns, with the right matches (R1-B1)', () => {
  it.each(CASES)('%s', async (_label, paragraphs, term, expected) => {
    const { ms, found } = await searchInAChild(paragraphs, term)
    expect(ms, 'the search itself stays within its budget').toBeLessThan(SEARCH_BUDGET_MS)
    expect(found).toEqual(expected)
  }, TEST_TIMEOUT_MS)

  it('non-vacuity: the child really searched (a case with matches found them)', async () => {
    const { found } = await searchInAChild(['NVDA🚀 then 🚀 now'], '🚀')
    expect(found.length).toBe(1)
  }, TEST_TIMEOUT_MS)
})

// R2-N3: the harness itself tells a slow start from a loop. Each case feeds it a
// child that misbehaves in exactly one way.
describe('the harness names what it measured (R2-N3)', () => {
  // Starts slower than the search box is long, then spends 300 ms "searching":
  // a box armed at spawn kills it; a box armed at the search does not.
  const SLOW_START = CHILD
    .replace('const bootedAt', 'await new Promise((r) => setTimeout(r, 1500))\nconst bootedAt')
    .replace('const t0 = performance.now()', 'await new Promise((r) => setTimeout(r, 300))\nconst t0 = performance.now()')
  const LOOPS = CHILD.replace('const found = findMatchesInDoc', 'for (;;) {}\nconst found = findMatchesInDoc')

  it('a start slower than the search box is NOT a loop: the search box only starts with the search', async () => {
    expect(SLOW_START).not.toBe(CHILD) // the fixture really is slow
    const r = await runChild(['MU much MU'], 'MU', { child: SLOW_START, searchBoxMs: 1000 })
    expect(r.verdict).toBe('returned')
    expect(r.found).toEqual([['MU', 1], ['MU', 9]])
  }, TEST_TIMEOUT_MS)

  it('a child that never reaches its search is INCONCLUSIVE, never "it loops"', async () => {
    const r = await runChild(['MU much MU'], 'MU', { child: SLOW_START, startupBoxMs: 300 })
    expect(r.verdict).toBe('inconclusive')
    expect(r.detail).toMatch(/slow start, not a loop/)
  }, TEST_TIMEOUT_MS)

  it('a search that started and never returned IS a loop, and says how long startup took', async () => {
    expect(LOOPS).not.toBe(CHILD)
    const r = await runChild(['MU much MU'], 'MU', { child: LOOPS, searchBoxMs: 1000 })
    expect(r.verdict).toBe('loops')
    expect(r.startupMs).toBeGreaterThan(0)
    expect(r.detail).toMatch(/started .* and had not returned 1000 ms later: it loops/)
  }, TEST_TIMEOUT_MS)
})
