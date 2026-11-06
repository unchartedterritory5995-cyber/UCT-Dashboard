// UCT Agent AUTOTEST: the selection oracle's own tests. Free: no browser, no model, no network. SIMULATED evidence about the oracle
// only; what the Agent does is the browser run's (selectionRun.mjs).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grade, chartPrint } from './oracle.mjs'
import { landedRoles, roleOfRef, targetRecord, toldRole } from './selectionOracle.mjs'
import { buildCase, CAPS, FLOWS, generated, NEGATIVES, negativeRequests, selectionRequests, specs } from './selectionCases.mjs'
import { BOARDS } from './boards.mjs'
import { lint, normPhrase } from './lint.mjs'
import { resolveToken } from './plan.mjs'
import { MUTANTS } from './selectionMutants.mjs'
import { classify } from './classify.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const roles = BOARDS.FOUR.roles
const chart = (sym, tf = 'D') => ({ sym, tf, scale: 'linear', session: 'RTH', volume: true, chips: [], panes: 2, pixels: `px-${sym}-${tf}` })
const board = (over = {}) => ({ charts: { TL: chart('SPY'), TR: chart('QQQ'), BL: chart('NVDA'), BR: chart('TSLA'), ...over }, widgets: [], wl: {}, drawings: {}, alerts: [], ialerts: [], layouts: [], unreadable: [] })
const ev = (after, clicks, extra = {}) => ({ before: board(), beforeLast: board(), after, clicks, turns: [{ say: 'x', newReceipt: true, receiptText: 'done', last: 'done', modelCalls: 0 }], errors: [], ...extra })
const req = (target, extra = {}) => ({ id: 'r', board: 'FOUR', family: 'sel', kind: 'target', turns: [{ say: 'x', plan: { ops: [] } }], oracle: { outcome: 'change', expect: [], target }, ...extra })
const failed = (r) => r.checks.filter(c => c.pass === false).map(c => c.name)

describe('the record', () => {
  it('holds the clicked, intended and landed chart, each read from the evidence', () => {
    const e = ev(board({ BL: chart('NVDA', 'W') }), ['c-tl', 'c-bl'])
    expect(targetRecord({ intended: 'clicked' }, e, roles, chartPrint)).toMatchObject({ clicked: 'BL', intended: ['BL'], landed: ['BL'] })
  })
  it('names the board by role, whatever ref the Agent uses', () => {
    expect(roleOfRef('c-bl~tab2', roles)).toBe('BL')
    expect(roleOfRef('ixe:c-tr', roles)).toBe('TR')
    expect(roleOfRef('w-other', roles)).toBe(null)
  })
  it('a click on something that is no role is recorded, never dropped', () => {
    expect(targetRecord({ intended: 'clicked' }, ev(board(), ['w-floating']), roles, chartPrint).clicked).toBe('unknown:w-floating')
  })
  it('a drawing lands on the chart showing its symbol, an alert too', () => {
    const after = { ...board(), drawings: { NVDA: [{ id: 1 }] } }
    expect(landedRoles(board(), after, chartPrint)).toEqual(['BL'])
    expect(landedRoles(board(), { ...board(), alerts: [{ id: 1, sym: 'TSLA' }] }, chartPrint)).toEqual(['BR'])
  })
  it('the context\'s refs are per-request handles: told is matched by symbol, then position', () => {
    expect(toldRole({ charts: [{ ref: 'c1', symbol: 'SPY' }, { ref: 'c4', symbol: 'TSLA', selected: true }] }, roles)).toBe('BR')
    expect(toldRole({ charts: [{ ref: 'c1', symbol: 'SPY' }] }, roles)).toBe(null)
    expect(toldRole(null, roles)).toBe(undefined)
    expect(toldRole({ charts: [{ ref: 'c2', symbol: 'NVDA', position: 'bottom-left', selected: true }] }, BOARDS.TWIN.roles)).toBe('BL')
  })
})

describe('the oracle fails when they disagree', () => {
  const clicked = { intended: 'clicked', click: 'BL' }
  it('passes when clicked, intended and landed are the same chart', () => {
    expect(grade(req(clicked), ev(board({ BL: chart('NVDA', 'W') }), ['c-bl'])).pass).toBe(true)
  })
  it('NEGATIVE: the click said one chart, the change landed on another', () => {
    const r = grade(req(clicked), ev(board({ TR: chart('QQQ', 'W') }), ['c-bl']))
    expect(r.pass).toBe(false)
    expect(failed(r)).toEqual(['landed where intended (BL)'])
    expect(r.checks.find(c => c.pass === false).detail).toBe('clicked=BL intended=BL landed=TR')
  })
  it('NEGATIVE: the right chart moved, and another moved with it', () => {
    expect(failed(grade(req(clicked), ev(board({ BL: chart('NVDA', 'W'), TR: chart('QQQ', 'W') }), ['c-bl'])))).toEqual(['landed where intended (BL)'])
  })
  it('NEGATIVE: nothing moved, whatever the receipt says', () => {
    expect(failed(grade(req(clicked), ev(board(), ['c-bl'])))).toContain('landed where intended (BL)')
  })
  it('NEGATIVE: the rig clicked another chart from the one the case meant', () => {
    expect(failed(grade(req(clicked), ev(board({ TR: chart('QQQ', 'W') }), ['c-tr'])))).toEqual(['the real click was on BL'])
  })
  it('NEGATIVE: the click never happened', () => {
    expect(failed(grade(req(clicked), ev(board({ BL: chart('NVDA', 'W') }), [])))).toEqual(expect.arrayContaining(['the real click was on BL', 'the click decides, and no chart was clicked']))
  })
  it('NEGATIVE: the panel told the planner a chart other than the one clicked', () => {
    const e = ev(board({ BL: chart('NVDA', 'W') }), ['c-bl'])
    e.turns[0] = { ...e.turns[0], modelCalls: 1, context: { charts: [{ ref: 'c1', symbol: 'SPY', selected: true }] } }
    expect(failed(grade(req(clicked), e))).toEqual(['the panel told the planner the clicked chart'])
  })
  it('NEGATIVE: the words named a chart, and the click won', () => {
    const r = grade(req({ intended: ['TR'], click: 'BL' }), ev(board({ BL: chart('NVDA', 'W') }), ['c-bl']))
    expect(r.checks.find(c => c.pass === false).detail).toBe('clicked=BL intended=TR landed=BL')
  })
  it('NEGATIVE: the receipt names a chart that did not change', () => {
    const e = ev(board({ BL: chart('NVDA', 'W') }), ['c-bl'])
    e.turns[0].receiptText = 'Top-right chart (QQQ): Switched timeframe to Weekly'
    expect(failed(grade(req(clicked), e))).toEqual(['the receipt does not name TR, which did not change'])
  })
  it('nothing identified: a landing fails, and asking passes', () => {
    const ask = { outcome: 'clarify', target: { intended: 'ask', click: null } }
    const said = { turns: [{ say: 'x', newReceipt: false, last: 'Which chart do you mean?', modelCalls: 0 }] }
    expect(grade(req(null, { oracle: ask }), { ...ev(board(), []), ...said }).pass).toBe(true)
    const r = grade(req(null, { oracle: ask }), { ...ev(board({ TL: chart('SPY', 'W') }), []), ...said })
    expect(r.pass).toBe(false)
    expect(failed(r)).toContain('nothing landed: no chart was identified')
  })
  it('a bad guess may be stopped, and may never land elsewhere', () => {
    const g = { outcome: 'guarded', target: { intended: ['TR'], click: 'BL', guarded: true } }
    const asked = { turns: [{ say: 'x', newReceipt: false, last: 'Which chart do you mean?', modelCalls: 1, context: { charts: [{ symbol: 'NVDA', selected: true }] } }] }
    expect(grade(req(null, { oracle: g }), { ...ev(board(), ['c-bl']), ...asked }).pass).toBe(true)
    const r = grade(req(null, { oracle: g }), { ...ev(board({ BL: chart('NVDA', 'W') }), ['c-bl']), ...asked })
    expect(failed(r)).toEqual(['landed where intended (TR)'])
    // stopped silently is not stopped: it has to say so
    expect(grade(req(null, { oracle: g }), { ...ev(board(), ['c-bl']), turns: [{ say: 'x', last: 'ok', modelCalls: 0 }] }).pass).toBe(false)
  })
  it('a wrong landing classifies as the target layer', () => {
    const q = req({ intended: 'clicked', click: 'BL' })
    const e = ev(board({ TR: chart('QQQ', 'W') }), ['c-bl'])
    e.turns[0].modelCalls = 1
    expect(classify(q, e, grade(q, e)).layer).toBe('target')
  })
})

describe('the scripted planner reads the request, as a real one has to', () => {
  const body = { context: { charts: [{ ref: 'c1', symbol: 'SPY', position: 'top-left' }, { ref: 'c2', symbol: 'TSLA', position: 'bottom-right', selected: true }], indicatorEdits: [{ ref: 'ie1', symbol: 'SPY', position: 'top-left' }, { ref: 'ie2', symbol: 'TSLA', position: 'bottom-right' }] } }
  it('$chart:sel is the chart the context marks selected', () => { expect(resolveToken('$chart:sel', body, 'FOUR')).toBe('c2') })
  it('$ie:sel follows the same chart', () => { expect(resolveToken('$ie:sel', body, 'FOUR')).toBe('ie2') })
  it('$chart:notSel is a bad guess', () => { expect(resolveToken('$chart:notSel', body, 'FOUR')).toBe('c1') })
  it('no chart marked: the token fails where a planner would', () => {
    expect(resolveToken('$chart:sel', { context: { charts: [{ ref: 'c1', symbol: 'SPY' }] } }, 'FOUR')).toBe('missing:$chart:sel')
  })
  it('$sym:sel is that chart\'s symbol', () => { expect(resolveToken('$sym:sel', body, 'FOUR')).toBe('TSLA') })
})

describe('the generated set', () => {
  const all = selectionRequests()
  it('every capability, board and way of naming a chart is present', () => {
    const list = specs()
    expect(new Set(list.map(s => s.cap).filter(Boolean))).toEqual(new Set(Object.keys(CAPS)))
    expect(new Set(list.map(s => s.board))).toEqual(new Set(['TWO', 'THREE', 'FOUR', 'MC', 'TFMIX', 'TWIN', 'LINKED']))
    for (const k of ['deictic', 'bare', 'position', 'named', 'ordinal', 'noClickDeictic', 'noClickBare', 'all', 'badDeictic', 'badNamed', 'badBare']) expect(list.some(s => s.id.endsWith(`-${k}`))).toBe(true)
  })
  // the same sentence on another board is a different case: the board is what is under test
  it('passes the request lint', () => { expect(lint(all).filter(e => !e.includes('phrasing repeats'))).toEqual([]) })
  it('a click that decides is never on the first chart, so "the first chart" cannot pass by luck', () => {
    for (const s of generated().filter(x => x.intended === 'clicked')) expect(s.clicks.at(-1)).not.toBe(Object.keys(BOARDS[s.board].roles)[0])
  })
  it('the plan of a clicked case is read from the request, never named by the test', () => {
    const c = buildCase({ id: 'x', board: 'FOUR', cap: 'timeframe', clicks: ['BR'], say: 'make this chart weekly', intended: 'clicked' })
    expect(c.turns.at(-1).plan.ops[0].target).toBe('$chart:sel')
    expect(c.oracle.target).toEqual({ intended: 'clicked', click: 'BR' })
    expect(c.oracle.expect).toEqual([['BR.tf', 'eq', 'W']])
  })
  it('an adversary plan is not approved by the runner', () => {
    const c = buildCase({ id: 'x', board: 'FOUR', cap: 'timeframe', clicks: ['BR'], say: 'make the top-right chart weekly', intended: ['TR'], plan: 'adversary', bad: 'sel' })
    expect(c.turns.at(-1)).toMatchObject({ approve: false })
    expect(c.oracle).toMatchObject({ outcome: 'guarded', target: { guarded: true } })
  })
  it('every flow and negative has an id of its own', () => {
    const ids = [...specs(), ...NEGATIVES].map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(FLOWS.length).toBeGreaterThan(30)
  })
  it('generated sentences are not one sentence with a different noun for every board', () => {
    const said = new Set(generated().map(s => normPhrase(s.say)))
    expect(said.size).toBeGreaterThan(60)
  })
  it('a negative case names the check that must fail', () => {
    for (const n of negativeRequests()) expect(typeof n.negative).toBe('string')
  })
})

describe('the mutants still apply', () => {
  const root = join(here, '..', '..', '..', '..')
  it.each(Object.entries(MUTANTS))('%s: its source line is in the tree', (_n, m) => {
    const file = m.file.source.includes('host') ? 'src/agent/host.js' : 'src/pages/charts/ChartsWorkspace.jsx'
    expect(readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n')).toContain(m.from)
  })
})
