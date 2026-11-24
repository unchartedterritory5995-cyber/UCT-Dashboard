// ⭐ P0.2 (INV1 C, assessment 2026-11-23): a ticker the MODEL took from an ordinary lowercase word in a verb / command position is
// ASKED, never applied ("fix that" → chart.setSymbol FIX was applied 4 of 4 times). Generated from classes, through the REAL panel
// (routing v2, as production) with a scripted model that proposes chart.setSymbol on the word:
//   words  = common English words that ARE symbols in the universe /api/ticker-search serves (api/data/cap_universe.json, read here)
//   frames = command frames × positions (clause head, after a filler, after a modal / "please" / "let me" / "want to", second clause)
//   cases  = lowercase · Title case · the whole message in capitals
// Controls: the explicit forms (capitals, "$", "… stock", "the … chart", a word after a chart verb, a non-English ticker) still apply.
// No market value is read: the universe file is symbols only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { cleanup } from '@testing-library/react'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { registerBuiltins } from './builtins'
import { _resetAgentConfig } from './agentClient'
import { routingV2Active } from './nlm1/flag'

registerBuiltins()
const here = dirname(fileURLToPath(import.meta.url))
const UNIVERSE = new Set(JSON.parse(readFileSync(resolve(here, '../../../api/data/cap_universe.json'), 'utf8')).map(s => String(s).toUpperCase()))
// common English words; the ones the universe lists are the class under test (INV1 D: 28 of 82 pass the instant reader alone)
const ENGLISH = ('fix run edit go play real safe open ship fly eat talk pay flex cash rock sky sun car fun man pen ice hum mod path tech am ' +
  'fox hog wash tap dash nice pump shop snap spot step swim team boot cake care chef coin fast fate five form four gain glad gold good grab ' +
  'hood hope iron keys land life line lion luck next pack pool post rare road root site snow task tree trip unit well west wing wolf').split(' ')
export const WORDS = ENGLISH.filter(w => UNIVERSE.has(w.toUpperCase()))

export const ASK_FRAMES = [
  w => `${w} that`, w => `${w} it`, w => `${w} it again`, w => `${w} the chart`, w => `please ${w} that`, w => `can you ${w} it`,
  w => `could you ${w} this for me`, w => `ok, ${w} that`, w => `switch to weekly and ${w} it`, w => `i want to ${w} that`,
  w => `let me ${w} it`, w => `now ${w} them`,
]
export const CASES = [['lower', s => s], ['title', s => s[0].toUpperCase() + s.slice(1)], ['shouted', s => s.toUpperCase()]]
export const EXPLICIT = [
  ['capitals', w => `switch to ${w.toUpperCase()}`], ['capitals at the head', w => `${w.toUpperCase()} please`], ['dollar', w => `$${w}`],
  ['dollar in a command', w => `can you load $${w}`], ['… stock', w => `show me ${w} stock`], ['ticker …', w => `switch to the ticker ${w}`],
  ['the … chart', w => `put up the ${w} chart`], ['after a chart verb', w => `pull up ${w}`],
]

let p
beforeEach(() => { p = setupPanel({ tickers: [...WORDS.map(w => w.toUpperCase()), 'PLTR'] }) })
afterEach(() => { cleanup(); localStorage.clear(); _resetAgentConfig() })

const setSymbolModel = (sym) => (body) => p.env('apply', [{ action: 'chart.setSymbol', target: body.context.charts[0].ref, args: { symbol: sym } }], '')

async function run(text, sym, { model = true } = {}) {
  const { say, click, board } = p.mount(...ONE())
  const t0 = p.turns()
  p.st.envelopes.push(setSymbolModel(sym))
  const reply = await say(text)
  expect(routingV2Active()).toBe(true)
  if (model) expect(p.turns() - t0).toBe(1)                        // the model was asked (the scripted plan is what is checked)
  return { reply, now: board.state.groupSyms['N:c'], board, click }
}

describe('a ticker taken from a lowercase verb-position word is asked, never applied', () => {
  it('the universe is the real one, and the class is large', () => {
    expect(UNIVERSE.size).toBeGreaterThan(1000)
    expect(WORDS.length).toBeGreaterThanOrEqual(60)
    expect(WORDS).toContain('fix')
  })
  // every word at least twice, and every frame × case cell (the cells cycle with period frames × cases)
  const cells = []
  for (let j = 0; j < Math.max(WORDS.length * 2, ASK_FRAMES.length * CASES.length); j++) {
    const w = WORDS[j % WORDS.length]
    const [cn, c] = CASES[Math.floor(j / ASK_FRAMES.length) % CASES.length]
    cells.push([w, cn, c(ASK_FRAMES[j % ASK_FRAMES.length](w))])
  }
  it('covers every frame and every case', () => {
    for (const f of ASK_FRAMES) for (const [, c] of CASES) expect(cells.some(([w, , t]) => t === c(f(w)))).toBe(true)
  })
  it.each(cells)('%s (%s): "%s" → asked; the chart keeps its symbol', async (w, c, text) => {
    const T = w.toUpperCase()
    // a message typed all in capitals may be answered before the model (or refused by another rail): never applied either way
    const { reply, now } = await run(text, T, { model: c !== 'shouted' })
    expect(now).toBe('QQQ')
    expect(reply).not.toContain(`Changed symbol to ${T}`)
    if (c !== 'shouted') {
      expect(reply).toContain(`Did you mean the ticker ${T}?`)
      expect(p.proposals().length).toBe(1)
    }
  }, 30000)
  it('the owner\'s case: "fix that" → asked; Apply on the card is what changes it', async () => {
    const { reply, now, board, click } = await run('fix that', 'FIX')
    expect(now).toBe('QQQ')
    expect(reply).toContain('Did you mean the ticker FIX?')
    await click('Apply')
    expect(board.state.groupSyms['N:c']).toBe('FIX')
  }, 30000)
})

describe('controls: an explicit ticker reference still applies', () => {
  const ctl = []
  WORDS.forEach((w, i) => { const [name, f] = EXPLICIT[i % EXPLICIT.length]; ctl.push([w, name, f(w)]) })
  it.each(ctl)('%s (%s): "%s" → applied', async (w, _n, text) => {
    const T = w.toUpperCase()
    const { reply, now } = await run(text, T, { model: false })
    expect(reply).not.toContain('Did you mean the ticker')
    expect(now).toBe(T)
  }, 30000)
  it.each([['pltr'], ['pull up pltr'], ['can you show me pltr'], ['pltr please']])('a non-English ticker typed lowercase: "%s" → applied', async (text) => {
    const { reply, now } = await run(text, "PLTR", { model: false })
    expect(reply).not.toContain('Did you mean the ticker')
    expect(now).toBe('PLTR')
  }, 30000)
  it('a company name the model grounded (the symbol is never spelled) is not this rule\'s business', async () => {
    const { now } = await run("switch to nvidia", "NVDA", { model: false })
    expect(now).toBe('NVDA')
  }, 30000)
})

// ── (b) the other direction (e2eBench e2-t11, PL 11-23): the same word in a correction / command role names no TARGET ticker ──
// The plan changes the RIGHT chart, which the words name ("the right one"); the LEFT chart shows the word's ticker. Before the fix
// the target rail asked "You named NOW, but … shows …" although the words name the chart. Ordinary words (now, on, it, all, so,
// go, be) in any case; every other word typed lowercase in a strong role (a pronoun object, a particle, after a modal).
// ("it" is left out: as a pronoun it is the anaphora rail's — see the report)
const ORDINARY_WORDS = ['now', 'on', 'go', 'so', 'be', 'all'].filter(w => UNIVERSE.has(w.toUpperCase()))
// (objects "that" / "this": a bare "it" with a place, "do it on the right one", is asked by the anaphora rail whatever the words —
// a separate family, see the report)
const B_FRAMES = [
  w => `${w} that on the right one`, w => `no wait, ${w} that on the right one`, w => `can you ${w} that on the right chart`,
  w => `ok ${w} this on the right one`, w => `please ${w} that on the right one instead`,
]
const B_ORD_FRAMES = [w => `${w} the right one too`, w => `${w}, the right one instead`, ...B_FRAMES]
const tfModel = (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => /\(QQQ\)/.test(c.label)).ref, args: { timeframe: 'W' } }], '')
async function runB(text, left) {
  const { say, board } = p.mount(...TWO(left, 'QQQ'))
  p.st.envelopes.length = 0
  p.st.envelopes.push(tfModel)
  const reply = await say(text)
  expect(routingV2Active()).toBe(true)
  const tf = (id) => board.state.widgets.find(x => x.id === id).opts.tf
  return { reply, leftTf: tf('cl'), rightTf: tf('cr'), syms: board.state.groupSyms }
}
describe('(b) an ordinary word in a correction / command role names no target ticker', () => {
  const cells = []
  ORDINARY_WORDS.forEach((w, i) => B_ORD_FRAMES.forEach((f, k) => cells.push([w, (i + k) % 2 ? 'capitals' : 'lower', ((i + k) % 2 ? f(w.toUpperCase()) : f(w))])))
  WORDS.filter(w => !ORDINARY_WORDS.includes(w)).forEach((w, i) => cells.push([w, i % 2 ? 'title' : 'lower', ((s) => (i % 2 ? s[0].toUpperCase() + s.slice(1) : s))(B_FRAMES[i % B_FRAMES.length](w))]))
  it('the class is large', () => { expect(ORDINARY_WORDS.length).toBeGreaterThanOrEqual(4); expect(cells.length).toBeGreaterThanOrEqual(90) })
  it.each(cells)('%s (%s): "%s" → the right chart changes, no "You named"', async (w, _c, text) => {
    const { reply, rightTf, syms } = await runB(text, w.toUpperCase())
    expect(reply).not.toContain('You named')
    expect(reply).not.toContain('Which chart do you mean')
    expect(rightTf).toBe('W')
    expect(syms['N:cl']).toBe(w.toUpperCase())
  }, 30000)
  it('the e2e case e2-t11: "NOW the right one too, and keep ON on the weekly" (a board showing ON and NOW)', async () => {
    const { say, board } = p.mount(...TWO('ON', 'NOW'))
    p.st.envelopes.length = 0
    p.st.envelopes.push((body) => p.env('apply', body.context.charts.map(c => ({ action: 'chart.setTimeframe', target: c.ref, args: { timeframe: 'W' } })), ''))
    const reply = await say('NOW the right one too, and keep ON on the weekly')
    expect(reply).not.toContain('You named NOW')
    expect(board.state.widgets.map(x => x.opts.tf)).toEqual(['W', 'W'])
  }, 30000)
  // controls: a REAL reference to the left chart's ticker ("$fix", "FIX", "the fix chart") still names that target — the model's plan
  // on the RIGHT chart is asked ("You named …"), never applied
  const ctl = []
  WORDS.filter(w => !ORDINARY_WORDS.includes(w)).forEach((w, i) => ctl.push([w, [(x) => `$${x}, the weekly view if you can manage it`,
    (x) => `${x.toUpperCase()}, the weekly view if you can manage it`, (x) => `the ${x} chart, the weekly view if you can manage it`][i % 3](w)]))
  let asked = 0
  it.each(ctl)('%s: "%s" → the plan on the other chart is asked', async (w, text) => {
    const t0 = p.turns()
    const { reply, rightTf } = await runB(text, w.toUpperCase())
    expect(rightTf).not.toBe('W')
    // asked — by the target rail ("You named FIX, but …"), the deictic one ("Did you mean Chart (FIX)?") or the unnamed-chart one
    // ("Which chart do you mean?") — never applied
    if (p.turns() > t0) { expect(reply).toMatch(new RegExp(`You named ${w.toUpperCase()}|Did you mean Chart \\(${w.toUpperCase()}\\)|Which chart do you mean`)); asked++ }
  }, 30000)
  it('the controls reached the model (non-vacuous)', () => { expect(asked).toBeGreaterThanOrEqual(Math.floor(ctl.length / 2)) })
})

// ── AUDIT NO-GO F2 (11-23): a ticker that is NO English word is never asked, whatever its position ────────────────────────────
// Two charts SPY / QQQ, the model plans setSymbol on the right chart. f4c64d59e1 asked "Did you mean the ticker NVDA?" for 12 of
// AUDIT's 14; master applied 14 of 14. Real tickers: AUDIT's names plus no-vowel symbols generated from the universe.
const NONWORD = [...new Set(['NVDA', 'AMD', 'TSLA', 'PLTR', 'MSFT', ...[...UNIVERSE].filter(t => /^[B-DF-HJ-NP-TV-Z]{3,4}$/.test(t)).slice(0, 12)])]
  .filter(t => UNIVERSE.has(t) && !ENGLISH.includes(t.toLowerCase()))
const F2_FRAMES = [w => `${w} the right one`, w => `${w} back on the right chart`, w => `${w} up on the right`, w => `${w} again on the right one`,
  w => `ok now ${w} the right one`, w => `${w} all day on the right one`]
describe('F2: a real ticker (no English word) at a clause head is applied, never asked', () => {
  const rows = []
  NONWORD.forEach((T, i) => {
    const frames = i < 5 ? F2_FRAMES : [F2_FRAMES[i % F2_FRAMES.length], F2_FRAMES[(i + 3) % F2_FRAMES.length]]
    for (const f of frames) rows.push([T, f(T.toLowerCase())])
  })
  it('the class: real, no English word, every frame used', () => {
    expect(NONWORD.length).toBeGreaterThanOrEqual(12)
    expect(rows.length).toBeGreaterThanOrEqual(40)
  })
  it.each(rows)('%s: "%s" → the right chart shows it', async (T, text) => {
    p = setupPanel({ tickers: [T, 'SPY', 'QQQ'] })
    const { say, board } = p.mount(...TWO('SPY', 'QQQ'))
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: body.context.charts.find(c => /\(QQQ\)/.test(c.label)).ref, args: { symbol: T } }], ''))
    const reply = await say(text)
    expect(routingV2Active()).toBe(true)
    expect(reply).not.toContain('Did you mean the ticker')
    expect(board.state.groupSyms['N:cr']).toBe(T)
  }, 30000)
})
