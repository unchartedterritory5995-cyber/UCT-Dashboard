// Charts family (2026-11-17): a stock's leveraged / inverse single-stock ETFs — the chart's Leverage / Inverse control
// (LeverageInverseControl → onSelect → ChartWidget's symbol change) reached by the Agent, through the REAL panel on the
// fixture board, the model never called (the instant path) or scripted (no paid call).
//   • the funds are the control's OWN rows (GET /api/single-stock-etfs/{sym}, its one key + fetcher) — stubbed here;
//   • "switch / show / change" re-aims the TARGET chart (named / clicked / asked — the chart kind's rails) with exact Undo;
//   • "add / open a new chart" opens a NEW chart born on the fund and never changes an existing one;
//   • several funds and words that do not choose → asked, the real funds as the choices; none → refused, naming what exists.
// The fixture funds are made-up tickers; no market values anywhere.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, the real AgentPanel and planner.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { wordsSelect, groupOfAction } from './routing'
import { LEVERAGED_SWITCH, LEVERAGED_ADD, readLeveragedRequest, chooseFund, _resetLeveragedEtfCache } from './capabilities/leveragedEtf'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const FAMILIES = {
  NVDA: { underlying: 'NVDA', long: [{ ticker: 'NVUU', name: 'Fixture 2x Long NVDA', factor: 2 }, { ticker: 'NVU3', name: 'Fixture 3x Long NVDA', factor: 3 }],
    short: [{ ticker: 'NVDD', name: 'Fixture 2x Short NVDA', factor: 2 }], best_long: 'NVUU', best_short: 'NVDD' },
  AMD: { underlying: 'AMD', long: [{ ticker: 'AMUU', name: 'Fixture A 2x Long AMD', factor: 2 }, { ticker: 'AMUX', name: 'Fixture B 2x Long AMD', factor: 2 }],
    short: [], best_long: 'AMUX', best_short: null },
}
// the funds' own family answers for their member tickers too (the control reads its seat from them)
for (const f of Object.values(FAMILIES)) for (const r of [...f.long, ...f.short]) FAMILIES[r.ticker] = f
const EMPTY = { underlying: null, long: [], short: [], best_long: null, best_short: null }

let p
beforeEach(() => {
  _resetLeveragedEtfCache()
  p = setupPanel({ tickers: Object.keys(FAMILIES) })
  const base = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init) => {
    const m = /^\/api\/single-stock-etfs\/([^/?]+)/.exec(String(url))
    if (m) {
      p.st.calls.push(['GET', String(url), null])
      const f = FAMILIES[decodeURIComponent(m[1])] || EMPTY
      return new Response(JSON.stringify(f), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return base(url, init)
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// 1×2: c0 left (NVDA), c1 right (TSLA — no family), each on its own symbol
const cell = (id, x) => ({ id, type: 'chart', x, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const WIDGETS = [cell('c0', 0), cell('c1', 12)]
const SYMS = { 'N:c0': 'NVDA', 'N:c1': 'TSLA' }
const decorate = (s) => ({ ...s, label: `Chart (${s.ref})` })
function mountOn(clicked, syms = SYMS) {
  const m = p.mount(WIDGETS, syms, { decorate })
  if (clicked) p.select(clicked)
  return m
}
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const transcript = () => screen.getByTestId('agent-transcript').textContent
const settle = () => new Promise(r => setTimeout(r, 30))   // the warm-up's family reads land

// ── the words → (leverage, direction, add) ──
const SWITCH_VERBS = ['switch this chart to', 'show me', 'change this chart to', 'put this chart on', 'flip this chart to']
const LEV = [[2, ['2x', '2X', '2 x', 'double']], [3, ['3x', '3X', 'triple']]]
const DIR = [['bull', ['bull', 'long', 'bullish']], ['bear', ['bear', 'short', 'inverse']]]
const NOUN = ['ETF', 'etf', 'fund']

describe('the words: verbs × leverage × direction × noun (generated)', () => {
  const cases = []
  for (const v of SWITCH_VERBS) for (const [lev, lw] of LEV) for (const l of lw) for (const [dir, dw] of DIR) for (const d of dw) for (const n of NOUN)
    cases.push([`${v} the ${l} ${d} ${n} of NVDA`, lev, dir, false])
  for (const [lev, lw] of LEV) for (const l of lw) for (const [dir, dw] of DIR) for (const d of dw)
    cases.push([`add a new chart of the ${l} ${d} ETF of NVDA`, lev, dir, true], [`open a new chart with the ${l} ${d} etf for nvda`, lev, dir, true])
  it(`${cases.length} phrasings read the leverage, the direction, the stock and add vs switch`, () => {
    for (const [w, lev, dir, add] of cases) expect(readLeveragedRequest(w), w).toEqual({ leverage: lev, direction: dir, underlying: 'NVDA', add })
  })
  it('no leverage / no direction said: null (asked later when the family has several)', () => {
    expect(readLeveragedRequest('switch this chart to the inverse ETF')).toEqual({ leverage: null, direction: 'bear', underlying: null, add: false })
    expect(readLeveragedRequest('show me the leveraged ETF of NVDA')).toEqual({ leverage: null, direction: null, underlying: 'NVDA', add: false })
    expect(readLeveragedRequest('show me the 3x ETF of NVDA')).toEqual({ leverage: 3, direction: null, underlying: 'NVDA', add: false })
  })
  it.each(['what are the holdings of this ETF', 'show NVDA', 'switch to weekly', 'what is a leveraged ETF', 'screen for leveraged ETFs', 'show me the ETF holdings',
    'add an RSI', 'show me NVDA and AMD bull ETFs', 'the 20 ema'])('not a leveraged-ETF request: "%s"', (w) => {
    expect(readLeveragedRequest(w)).toBe(null)
  })
  it('chooseFund: one fits → it; several and the words do not choose → several; none → none (with what exists)', () => {
    const f = FAMILIES.NVDA
    expect(chooseFund(f, { leverage: 3, direction: 'bull' }).pick.ticker).toBe('NVU3')
    expect(chooseFund(f, { leverage: null, direction: 'bear' }).pick.ticker).toBe('NVDD')
    expect(chooseFund(f, { leverage: null, direction: 'bull' }).several.map(r => r.ticker)).toEqual(['NVUU', 'NVU3'])
    expect(chooseFund(f, { leverage: 2, direction: null }).several.map(r => r.ticker)).toEqual(['NVUU', 'NVDD'])
    expect(chooseFund(f, { leverage: 3, direction: 'bear' }).none).toBe(true)
    // the words chose both and two funds fit: the control's own ★ most-liquid default for that side
    expect(chooseFund(FAMILIES.AMD, { leverage: 2, direction: 'bull' }).pick.ticker).toBe('AMUX')
    expect(chooseFund(FAMILIES.AMD, { leverage: null, direction: 'bull' }).several.map(r => r.ticker)).toEqual(['AMUU', 'AMUX'])
  })
})

describe('switch: the target chart re-aimed through the chart rails, exact Undo, no model call', () => {
  const TARGETS = [
    ['the clicked chart ("this chart")', 'c0', 'switch this chart to the {l} {d} ETF'],
    ['the chart named by position', null, 'switch the left chart to the {l} {d} ETF'],
    ['the chart named by its symbol', null, 'switch the NVDA chart to the {l} {d} ETF'],
    ['the stock named, the clicked chart', 'c0', 'show me the {l} {d} ETF of NVDA'],
  ]
  const PICKS = [['3x', 'bull', 'NVU3'], ['2x', 'bear', 'NVDD'], ['triple', 'long', 'NVU3'], ['2x', 'inverse', 'NVDD']]
  for (const [shape, clicked, tpl] of TARGETS) for (const [l, d, want] of PICKS) {
    const words = tpl.replace('{l}', l).replace('{d}', d)
    it(`${shape}: "${words}" → ${want} on the left chart only; Undo puts NVDA back`, async () => {
      const { say, board: b } = mountOn(clicked)
      await settle()
      const out = await say(words)
      expect(out).toMatch(new RegExp(`Switched the chart from NVDA to ${want}`))
      expect(symOf(b, 'c0')).toBe(want)
      expect(symOf(b, 'c1')).toBe('TSLA')                       // the other chart untouched
      expect(p.turns()).toBe(0)
      await say('undo')
      expect(symOf(b, 'c0')).toBe('NVDA')
      expect(symOf(b, 'c1')).toBe('TSLA')
    }, 40000)
  }
  it('several charts and no chart named or clicked: asked which chart, nothing changes', async () => {
    const { say, board: b } = mountOn(null)
    await settle()
    await say('switch to the 3x bull ETF of NVDA')
    expect(transcript()).toMatch(/[Ww]hich chart/)
    expect(symOf(b, 'c0')).toBe('NVDA')
    expect(symOf(b, 'c1')).toBe('TSLA')
  }, 40000)
  it('several funds and the words do not choose (bull: 2x or 3x): asked with the REAL funds as choices; the pick switches', async () => {
    const { say, board: b } = mountOn('c0')
    await settle()
    await say('show me the bull ETF of NVDA')
    const choices = screen.getAllByRole('button').map(x => x.textContent).filter(t => /NVU/.test(t))
    expect(choices.some(t => /NVUU/.test(t)) && choices.some(t => /NVU3/.test(t))).toBe(true)
    expect(choices.some(t => /NVDD/.test(t))).toBe(false)         // the bear fund is not a bull choice
    expect(symOf(b, 'c0')).toBe('NVDA')                            // nothing changed yet
    fireEvent.click(screen.getAllByRole('button').find(x => /NVU3/.test(x.textContent)))
    await p.idle(); await settle(); await p.idle()
    expect(symOf(b, 'c0')).toBe('NVU3')
    expect(symOf(b, 'c1')).toBe('TSLA')
  }, 40000)
  it('the chart\'s OWN stock when none is named ("switch this chart to the inverse ETF"): its family decides', async () => {
    const { say, board: b } = mountOn('c0')
    await settle()
    expect(await say('switch this chart to the inverse ETF')).toMatch(/to NVDD/)
    expect(symOf(b, 'c0')).toBe('NVDD')
  }, 40000)
  it('no such fund: refused, naming what the family has; nothing changes', async () => {
    const { say, board: b } = mountOn('c0')
    await settle()
    await say('switch this chart to the 3x bear ETF of NVDA')
    expect(transcript()).toMatch(/NVDA has no 3X bear ETF — UCT has NVUU \(2X bull\), NVU3 \(3X bull\) or NVDD \(2X bear\)/)
    expect(symOf(b, 'c0')).toBe('NVDA')
  }, 40000)
  it('a stock with no family (TSLA): refused honestly, nothing changes', async () => {
    const { say, board: b } = mountOn('c1')
    await settle()
    await say('switch this chart to the 2x bull ETF')
    expect(transcript()).toMatch(/UCT has no leveraged or inverse ETF of TSLA/)
    expect(symOf(b, 'c1')).toBe('TSLA')
    expect(symOf(b, 'c0')).toBe('NVDA')
  }, 40000)
  it('wrong-target control: a request about the RIGHT chart never re-aims the left one', async () => {
    const { say, board: b } = mountOn('c0')
    await settle()
    await say('switch the right chart to the 2x bull ETF of NVDA')
    expect(symOf(b, 'c1')).toBe('NVUU')
    expect(symOf(b, 'c0')).toBe('NVDA')
  }, 40000)
})

describe('add: a NEW chart born on the fund — never an existing chart replaced', () => {
  const ADDS = [['add a new chart of the 3x bull ETF of NVDA', 'NVU3'], ['open a new chart with the 2x inverse etf for nvda', 'NVDD'],
    ['add a new chart of the triple long ETF of NVDA', 'NVU3'], ['open a new chart of the 2x bear fund of NVDA', 'NVDD']]
  for (const [words, want] of ADDS) for (const clicked of ['c0', null]) {
    it(`"${words}" (${clicked ? 'a chart clicked' : 'none clicked'}): one new chart on ${want}; both existing charts unchanged; Undo closes it`, async () => {
      const { say, board: b } = mountOn(clicked)
      await settle()
      const n0 = b.state.widgets.length
      const out = await say(words)
      expect(out).toMatch(new RegExp(`Opened a new chart of ${want}`))
      expect(b.state.widgets.length).toBe(n0 + 1)
      const fresh = b.state.widgets.find(w => !['c0', 'c1'].includes(w.id))
      expect(fresh.color).toBe('N')                                   // not linked
      expect(symOf(b, fresh.id)).toBe(want)
      expect(symOf(b, 'c0')).toBe('NVDA')
      expect(symOf(b, 'c1')).toBe('TSLA')
      expect(p.turns()).toBe(0)
      await say('undo')
      expect(b.state.widgets.length).toBe(n0)
      expect(symOf(b, 'c0')).toBe('NVDA')
    }, 40000)
  }
  it('add with several funds that fit: asked with the real funds; nothing created until picked', async () => {
    const { say, board: b } = mountOn('c0')
    await settle()
    const n0 = b.state.widgets.length
    await say('add a new chart of the bull ETF of NVDA')
    expect(screen.getAllByRole('button').some(x => /NVU3/.test(x.textContent))).toBe(true)
    expect(b.state.widgets.length).toBe(n0)
    expect(symOf(b, 'c0')).toBe('NVDA')
  }, 40000)
})

describe('contract and routing', () => {
  it('both capabilities: the chart kind (switch) and the workspace (add); words-only group of their own', () => {
    expect(getCapability(LEVERAGED_SWITCH).target).toBe('chart')
    expect(getCapability(LEVERAGED_ADD).target).toBe('workspace')
    expect(groupOfAction(LEVERAGED_SWITCH)).toBe('leveragedEtf')
    for (const w of ['switch this chart to the inverse ETF', 'show me the 3x bull ETF of NVDA', 'open a leveraged fund of AMD on a new chart'])
      expect(wordsSelect('leveragedEtf', w), w).toBe(true)
    for (const w of ['what are the ETF holdings', 'screen for leveraged ETFs', 'switch to weekly', 'add an RSI'])
      expect(wordsSelect('leveragedEtf', w), w).toBe(false)
  })
  it('the funds come from the control\'s own endpoint and no other (no new symbol endpoint)', async () => {
    const { say } = mountOn('c0')
    await settle()
    await say('switch this chart to the 3x bull ETF')
    const urls = p.st.calls.map(c => c[1]).filter(u => !/^\/api\/agent\//.test(u))
    expect(urls.filter(u => /etf/i.test(u)).every(u => /^\/api\/single-stock-etfs\/[A-Z0-9.]+$/.test(u))).toBe(true)
  }, 40000)
})
