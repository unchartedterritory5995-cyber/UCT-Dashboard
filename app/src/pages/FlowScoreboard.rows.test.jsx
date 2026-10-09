// FREC publishes its honest tape (completeness audit 2026-10-07, column g): each recent pick, in
// order, is a numbered row that loads its name (`$SYM`); its names are the board list. The strike
// in the contract line is formatted by the shared primitives (no hand-made "$").
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import { PanelListContext } from '../components/terminal'
import FlowScoreboard, { contractLine, fmtStrike } from './FlowScoreboard'

vi.mock('../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
  render(
    <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={api}><FlowScoreboard embedded /></PanelListContext.Provider>
    </SWRConfig></MemoryRouter>,
  )
  return api
}
const pick = (sym, strike) => ({ sym, strike, cp: 'C', exp: '2026-11-20', grade: 'A', dateSaved: '2026-10-01', entry: 2, max_gain_pct: 10, current_gain_pct: 5 })

describe('FREC rows', () => {
  it('the honest tape OI tick has an accessible name, not a bare icon (audit 2026-10-08)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({
      picks_tracked: 2, overall: {}, by_grade: [], recent_winners: [],
      recent_picks: [{ ...pick('NVDA', 150), oi_confirmed: true }, pick('AMD', 90)],
    }) })))
    mount()
    expect(await screen.findByRole('img', { name: 'OI confirmed' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Not OI-confirmed' })).toBeInTheDocument()
  })

  it('one `$SYM` row per tape row (repeats kept), the names de-duplicated as the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({
      picks_tracked: 3, overall: {}, by_grade: [], recent_winners: [],
      recent_picks: [pick('NVDA', 150), pick('AMD', 90), pick('NVDA', 155)],
    }) })))
    const api = mount()
    await screen.findByRole('table', { name: 'Recent picks' })
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD', '$NVDA']))
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['NVDA', 'AMD'], label: 'FREC picks' })
    expect(screen.getByTestId('frec-board-open')).toHaveTextContent('Open 2')
  })

  it('CONTROL: a failed read publishes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) })))
    const api = mount()
    await screen.findByTestId('scoreboard-error')
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})

// ── the strike, on the shared primitives ─────────────────────────────────────
// FROZEN ORACLE: the pre-migration bodies, verbatim.
const oldFmtStrike = (s) => {
  const n = Number(s)
  if (!Number.isFinite(n)) return String(s ?? '')
  return n % 1 === 0 ? n.toFixed(0) : String(n)
}
const oldContractLine = (p) => `$${oldFmtStrike(p.strike)}${p.cp === 'P' ? 'P' : 'C'} ${p.exp || ''}`.trim()

describe('FREC strike formatting: byte-identical on every strike a listed contract carries', () => {
  it('whole, half, quarter and penny strikes, to five figures', () => {
    const strikes = []
    for (let k = 0.5; k <= 12000; k += k < 10 ? 0.5 : k < 200 ? 2.5 : k < 1000 ? 5 : 50) strikes.push(k)
    for (const s of [0.01, 1.01, 2.33, 7.12, 12.375, 101.25, 999.5, '150', '42.5']) strikes.push(s)
    for (const s of strikes) {
      expect([s, fmtStrike(s)]).toEqual([s, oldFmtStrike(s)])
      for (const cp of ['C', 'P', undefined]) {
        const p = { strike: s, cp, exp: '2026-11-20' }
        expect([s, cp, contractLine(p)]).toEqual([s, cp, oldContractLine(p)])
      }
    }
  })

  it('the pinned edges (a change here is a decision)', () => {
    // a non-number strike keeps its own text, as before
    expect(fmtStrike(undefined)).toBe('')
    expect([fmtStrike(null), oldFmtStrike(null)]).toEqual(['0', '0'])
    expect(fmtStrike('n/a')).toBe('n/a')
    // ⚠️ a strike with more than three decimals (an adjusted contract) now caps at three
    expect(oldFmtStrike(12.3333)).toBe('12.3333')
    expect(fmtStrike(12.3333)).toBe('12.333')
    // ⚠️ the prefix is the shared currency prefix: a pick that ever carries a foreign currency
    // reads in it instead of a guessed "$"
    expect(contractLine({ strike: 50, cp: 'C', exp: 'x', currency: 'CAD' })).toBe('CAD 50C x')
  })
})

describe('FREC tickers load the linked panels (wave 3 #3)', () => {
  it('a tape ticker and a standout ticker each run `$SYM` through the panel', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({
      picks_tracked: 2, overall: {}, by_grade: [], recent_winners: [pick('TSLA', 300)],
      recent_picks: [pick('AMD', 90)],
    }) })))
    const api = { run: vi.fn(), publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4 }
    render(
      <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelListContext.Provider value={api}><FlowScoreboard embedded /></PanelListContext.Provider>
      </SWRConfig></MemoryRouter>,
    )
    ;(await screen.findByRole('button', { name: 'Load AMD' })).click()
    screen.getByRole('button', { name: 'Load TSLA' }).click()
    expect(api.run.mock.calls).toEqual([['$AMD'], ['$TSLA']])
  })
})
