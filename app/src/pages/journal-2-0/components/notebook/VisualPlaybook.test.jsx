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
