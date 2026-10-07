// Wave 13 lane 13I-2 — the visual playbook grid: the filters build the server's query (setup,
// a family expanded through the ONE alias map, outcome, timeframe, fingerprint ranges), the
// slice stats wear the R3 wording (too few = behind a reveal; thin = a range), the regime filter
// is a labelled placeholder, and a failed read is an error -- never "no charts".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import VisualPlaybook, { VisualPlaybookBody, buildPlaybookQuery } from './VisualPlaybook'
import { tagsInFamily } from '../../lib/setupTagMap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

const card = (over = {}) => ({
  noteId: 'n1', noteTitle: 'NVDA plan', embedKey: 'e1', symbol: 'NVDA', timeframe: 'D', asOf: '2026-09-30',
  setupTag: 'VCP', fingerprintSource: 'note', fingerprintAsOf: '2026-09-30',
  values: { rs_rank: 95, base_depth_pct: 12.4, adr_pct: 5.1, pole_pct: 60 },
  image: { url: '/img/e1.png', w: 800, h: 400 }, outcome: 'win',
  trades: [{ tradeId: 't1', tradeRef: 'id:t1', rMultiple: 2.5, outcome: 'win' }], ...over,
})
const stats = (over = {}) => ({ charts: 1, trades: 1, unlinkedCharts: 0, n: 1, band: 'too_few', wording: 'too few to judge',
  wins: 1, losses: 0, breakeven: 0, winRate: 1, avgR: 2.5, winRateRange: null, avgRRange: null, ...over })
const payload = (over = {}) => ({
  cards: [card()], count: 1, stats: stats(), excludedMissing: {}, pending: 0,
  facets: { setups: { VCP: 2, 'Bull Flag': 1 }, timeframes: { D: 2, W: 1 } },
  regime: { available: false, reason: 'Filtering by market regime needs the entry context lane (13E), which is not built yet.' },
  ...over,
})

function renderBody(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <VisualPlaybookBody {...props} />
    </SWRConfig>,
  )
}

describe('buildPlaybookQuery', () => {
  it('a tag, an outcome, a timeframe and both kinds of range', () => {
    const q = buildPlaybookQuery({ setupChoice: 'tag:VCP', outcome: 'win', timeframe: 'D',
      ranges: { rs_rank: '90', base_depth_pct: '15', adr_pct: '', pole_pct: 'x' } })
    const p = new URLSearchParams(q.slice(1))
    expect(p.getAll('setup')).toEqual(['VCP'])
    expect(p.get('outcome')).toBe('win')
    expect(p.get('timeframe')).toBe('D')
    expect(p.getAll('range')).toEqual(['rs_rank:90:', 'base_depth_pct::15'])   // blank and junk dropped
  })

  it('a family expands through the alias map, and nothing set is no query', () => {
    const p = new URLSearchParams(buildPlaybookQuery({ setupChoice: 'family:Bases & Breakouts' }).slice(1))
    expect(p.getAll('setup')).toEqual(tagsInFamily('Bases & Breakouts'))
    expect(p.getAll('setup')).toContain('VCP')
    expect(buildPlaybookQuery({})).toBe('')
  })
})

describe('VisualPlaybookBody', () => {
  beforeEach(() => latchNotebookFlags({ notebook_visual_playbook_enabled: true }))
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  it('shows the card: frozen chart, fingerprint, outcome in R, and the note link', async () => {
    global.fetch = vi.fn(() => respond(200, payload()))
    renderBody()
    const c = await screen.findByTestId('playbook-card')
    expect(c.querySelector('img').getAttribute('src')).toBe('/img/e1.png')
    expect(c.textContent).toContain('RS rank 95')
    expect(c.textContent).toContain('Base depth 12.4%')
    expect(c.textContent).toContain('Win · +2.50R')
    expect(c.querySelector('a').getAttribute('href')).toBe('/journal?j2tab=notebook&note=n1')
  })

  it('filters by setup and RS: the query reaches the server', async () => {
    global.fetch = vi.fn(() => respond(200, payload()))
    renderBody()
    await screen.findByTestId('playbook-card')
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: 'tag:VCP' } })
    fireEvent.change(screen.getByLabelText('RS rank at least'), { target: { value: '90' } })
    await waitFor(() => {
      const last = String(global.fetch.mock.calls.at(-1)[0])
      expect(last).toBe('/api/j2/notebook-visual-playbook/cards?setup=VCP&range=rs_rank%3A90%3A')
    }, { timeout: 2000 })
  })

  it('too few to judge: the numbers sit behind a reveal', async () => {
    global.fetch = vi.fn(() => respond(200, payload()))
    renderBody()
    const s = await screen.findByTestId('slice-stats')
    expect(s.textContent).toContain('too few to judge')
    expect(s.textContent).not.toContain('Win rate')
    fireEvent.click(screen.getByRole('button', { name: 'Show the numbers anyway' }))
    expect(s.textContent).toContain('Win rate100%')
  })

  it('thin sample: the numbers show with their ranges', async () => {
    global.fetch = vi.fn(() => respond(200, payload({ stats: stats({ trades: 12, n: 12, band: 'thin', wording: 'thin sample',
      wins: 7, losses: 5, winRate: 0.5833, avgR: 0.8, winRateRange: [0.32, 0.81], avgRRange: [-0.1, 1.7] }) })))
    renderBody()
    const s = await screen.findByTestId('slice-stats')
    expect(s.textContent).toContain('thin sample')
    expect(s.textContent).toContain('58% (range 32%–81%)')
    expect(s.textContent).toContain('+0.80R (range -0.10R to +1.70R)')
  })

  it('the regime filter is a disabled, labelled placeholder', async () => {
    global.fetch = vi.fn(() => respond(200, payload()))
    renderBody()
    await screen.findByTestId('playbook-card')
    const regime = screen.getByLabelText(/Market regime/)
    expect(regime.disabled).toBe(true)
    expect(screen.getByText(/needs the entry context lane \(13E\)/)).toBeTruthy()
  })

  it('missing fingerprint values excluded by a range are counted out loud', async () => {
    global.fetch = vi.fn(() => respond(200, payload({ excludedMissing: { rs_rank: 2 } })))
    renderBody()
    expect(await screen.findByText('2 charts were left out: no RS rank in the fingerprint.')).toBeTruthy()
  })

  it('a failed read is an error, never an empty playbook', async () => {
    global.fetch = vi.fn(() => respond(503, { detail: 'unreadable' }))
    renderBody()
    expect((await screen.findByRole('alert')).textContent).toContain('could not be read (503)')
    expect(screen.queryByText(/No tagged charts match/)).toBeNull()
  })

  // ── wave 14 playbook fixes, item 2 ────────────────────────────────────────
  // Opened from a chart's panel the sheet pre-selected that chart's setup tag, so a member
  // with 5 tagged charts saw 3 (the 13I-2 walk's `cards_unfiltered: 3`, screenshot "VCP (3)").
  it('⭐ opens on the WHOLE playbook even when opened from a tagged chart (fails on the old pre-filter)', async () => {
    global.fetch = vi.fn(() => respond(200, payload({ facets: { setups: { VCP: 3, 'Flat Base Breakout': 1, 'Bull Flag': 1 }, timeframes: { D: 5 } } })))
    renderBody({ initialSetup: 'VCP' })
    await screen.findByTestId('playbook-card')
    expect(String(global.fetch.mock.calls[0][0])).toBe('/api/j2/notebook-visual-playbook/cards')
    expect(screen.getByLabelText('Setup').value).toBe('')
    expect(screen.getByTestId('playbook-scope').textContent).toContain('All 5 tagged charts')
  })

  it("the chart's own setup is a one-tap shortcut, and the way back names the whole count", async () => {
    global.fetch = vi.fn(() => respond(200, payload({ facets: { setups: { VCP: 3, 'Bull Flag': 2 }, timeframes: { D: 5 } } })))
    renderBody({ initialSetup: 'VCP' })
    await screen.findByTestId('playbook-card')
    fireEvent.click(screen.getByRole('button', { name: "Only this chart's setup (VCP)" }))
    await waitFor(() => {
      expect(String(global.fetch.mock.calls.at(-1)[0])).toBe('/api/j2/notebook-visual-playbook/cards?setup=VCP')
    }, { timeout: 2000 })
    fireEvent.click(await screen.findByRole('button', { name: 'Show all 5 tagged charts' }))
    expect(screen.getByLabelText('Setup').value).toBe('')
  })

  // ── wave 14 playbook fixes, item 1: the regime filter reads 13E ──────────
  const regimeOn = (over = {}) => ({ available: true, values: ['green', 'amber', 'orange', 'red'], selected: null,
    facets: { green: 1, amber: 2, orange: 0, red: 0 }, unknown: 1, excludedUnknown: 0, ...over })

  it('with 13E on, the regime select is live, counted, and its choice reaches the server', async () => {
    global.fetch = vi.fn(() => respond(200, payload({ regime: regimeOn(),
      cards: [card({ regime: { value: 'amber', status: 'captured', entryDay: '2026-09-30' } })] })))
    renderBody()
    const c = await screen.findByTestId('playbook-card')
    expect(c.textContent).toContain('Regime at entry: Amber')
    const sel = screen.getByLabelText(/Market regime/)
    expect(sel.disabled).toBe(false)
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Any regime', 'Green (1)', 'Amber (2)', 'Orange (0)', 'Red (0)'])
    fireEvent.change(sel, { target: { value: 'amber' } })
    await waitFor(() => {
      expect(String(global.fetch.mock.calls.at(-1)[0])).toBe('/api/j2/notebook-visual-playbook/cards?regime=amber')
    }, { timeout: 2000 })
  })

  it('charts a regime filter left out for an unknown regime are counted out loud', async () => {
    global.fetch = vi.fn(() => respond(200, payload({ regime: regimeOn({ selected: 'green', excludedUnknown: 2 }) })))
    renderBody()
    expect(await screen.findByText('2 charts were left out: no market regime was frozen at their entry.')).toBeTruthy()
  })

  it('buildPlaybookQuery carries the regime', () => {
    expect(buildPlaybookQuery({ regime: 'red' })).toBe('?regime=red')
  })

  it('the sheet renders nothing with the gate off', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_visual_playbook_enabled: false })
    global.fetch = vi.fn(() => respond(200, payload()))
    const { container } = render(<VisualPlaybook open onClose={() => {}} />)
    await act(async () => {})
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ── round 2 (owner ruling): an example card says "Example" and is in no count ───────────────
describe('VisualPlaybookBody — sample cards', () => {
  beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_visual_playbook_enabled: true }) })
  afterEach(() => { __resetNotebookFlags() })
  const example = () => card({ noteId: 'ex', noteTitle: 'Trade plan: example', symbol: 'AAPL', example: true, trades: [], outcome: 'none' })

  it('a member whose only card is the sample sees it labelled, zero counts, and the "tag a chart" guidance', async () => {
    global.fetch = vi.fn(() => respond(200, payload({
      cards: [example()], count: 0, exampleCount: 1, facets: { setups: {}, timeframes: {} },
      stats: stats({ charts: 0, trades: 0, unlinkedCharts: 0, n: 0 }) })))
    renderBody()
    const cards = await screen.findAllByTestId('playbook-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].querySelector('[data-example]').textContent).toBe('Example')   // text, not colour alone
    expect(screen.getByText(/Tag a chart in a note/)).toBeTruthy()
    expect(screen.getByTestId('slice-stats').textContent).toMatch(/0\s*trades from\s*0\s*charts/)
  })

  it('with a chart of the member\'s own beside it, only the sample is labelled and the guidance is gone', async () => {
    global.fetch = vi.fn(() => respond(200, payload({ cards: [card(), example()], count: 1, exampleCount: 1 })))
    renderBody()
    const cards = await screen.findAllByTestId('playbook-card')
    expect(cards.map((c) => Boolean(c.querySelector('[data-example]')))).toEqual([false, true])
    expect(screen.queryByText(/Tag a chart in a note/)).toBeNull()
  })
})
