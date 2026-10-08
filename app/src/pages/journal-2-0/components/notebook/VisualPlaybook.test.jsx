// Wave 13 lane 13I-2 — the visual playbook grid: the filters build the server's query (setup,
// a family expanded through the ONE alias map, outcome, timeframe, fingerprint ranges), the
// slice stats wear the R3 wording (too few = behind a reveal; thin = a range), the regime filter
// reads the frozen entry context (or is a labelled placeholder), and a failed read is an error
// -- never "no charts".
//
// CONTRACT: every grid answer here is the REAL server's (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py from GET /api/j2/notebook-visual-playbook/cards and held
// current by tests/test_notebook_contract_fixtures.py). Nothing types a card, a facet or a
// slice by hand.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import VisualPlaybook, { VisualPlaybookBody, buildPlaybookQuery } from './VisualPlaybook'
import { tagsInFamily } from '../../lib/setupTagMap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse } from '../../__fixtures__/contract'

const BASE = '/api/j2/notebook-visual-playbook/cards'
const serve = (name) => { global.fetch = vi.fn(async () => contractResponse(name)) }

function renderBody(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <VisualPlaybookBody {...props} />
    </SWRConfig>,
  )
}
const cardFor = async (symbol) => {
  const cards = await screen.findAllByTestId('playbook-card')
  return cards.find((c) => c.textContent.includes(symbol))
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

  it('builds the very query the filtered answer was recorded with', () => {
    const q = buildPlaybookQuery({ setupChoice: 'tag:VCP', ranges: { rs_rank: '90' } })
    const recorded = new URL(contract('visual-playbook.cards.filtered')._contract.path, 'http://x')
    expect(new URLSearchParams(q.slice(1)).getAll('setup')).toEqual(recorded.searchParams.getAll('setup'))
    expect(new URLSearchParams(q.slice(1)).getAll('range')).toEqual(recorded.searchParams.getAll('range'))
  })

  it('every range the client can send is one the server says it can filter', () => {
    const { rangeFields } = contractBody('visual-playbook.cards')
    for (const field of ['rs_rank', 'base_depth_pct', 'adr_pct', 'pole_pct']) {
      const p = new URLSearchParams(buildPlaybookQuery({ ranges: { [field]: '1' } }).slice(1))
      if (p.getAll('range').length) expect(rangeFields, `the server cannot filter ${field}`).toContain(field)
    }
    // and the name the server refuses is refused in words
    expect(contractBody('visual-playbook.cards.bad-range').detail).toMatch(/not a fingerprint number/)
  })
})

describe('VisualPlaybookBody', () => {
  beforeEach(() => latchNotebookFlags({ notebook_visual_playbook_enabled: true }))
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  it('shows the card: frozen chart, fingerprint, outcome in R, and the note link', async () => {
    serve('visual-playbook.cards')
    renderBody()
    const sent = contractBody('visual-playbook.cards').cards.find((c) => c.symbol === 'VPNV')
    const c = await cardFor('VPNV')
    expect(c.querySelector('img').getAttribute('src')).toBe(sent.image.url)
    expect(c.querySelector('img').getAttribute('alt')).toBe('VPNV D chart as of 2026-09-30')
    expect(c.textContent).toContain('RS rank 95')
    expect(c.textContent).toContain('Base depth 12.0%')
    expect(c.textContent).toContain('Win · +2.00R')
    expect(c.querySelector('a').getAttribute('href')).toBe(`/journal?j2tab=notebook&note=${sent.noteId}`)
    expect(c.getAttribute('data-outcome')).toBe('win')
    expect((await screen.findAllByTestId('playbook-card')).length).toBe(3)
    expect(String(global.fetch.mock.calls[0][0])).toBe(BASE)
  })

  it('a loss and a chart with no trade are each worded, and a missing fingerprint value reads n/a', async () => {
    serve('visual-playbook.cards')
    renderBody()
    const loss = await cardFor('VPAM')
    expect(loss.textContent).toContain('Loss · -1.00R')
    expect(loss.getAttribute('data-outcome')).toBe('loss')
    const none = await cardFor('VPTS')
    const sent = contractBody('visual-playbook.cards').cards.find((c) => c.symbol === 'VPTS')
    expect(sent).toMatchObject({ outcome: 'none', trades: [] })
    expect(sent.values.rs_rank).toBeNull()
    expect(none.getAttribute('data-outcome')).toBe('none')
    expect(none.textContent).toContain('RS rank n/a')
    expect(none.textContent).not.toMatch(/R$/)                 // no R figure invented for it
  })

  it('filters by setup and RS: the query reaches the server', async () => {
    serve('visual-playbook.cards')
    renderBody()
    await screen.findAllByTestId('playbook-card')
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: 'tag:VCP' } })
    fireEvent.change(screen.getByLabelText('RS rank at least'), { target: { value: '90' } })
    await waitFor(() => {
      const last = String(global.fetch.mock.calls.at(-1)[0])
      expect(last).toBe(`${BASE}?setup=VCP&range=rs_rank%3A90%3A`)
    }, { timeout: 2000 })
    // which is the route and the filter the filtered answer was recorded from
    const recorded = new URL(contract('visual-playbook.cards.filtered')._contract.path, 'http://x')
    expect(recorded.pathname).toBe(BASE)
    expect([recorded.searchParams.get('setup'), recorded.searchParams.get('range')]).toEqual(['VCP', 'rs_rank:90:'])
  })

  it('too few to judge: the numbers sit behind a reveal', async () => {
    serve('visual-playbook.cards')
    expect(contractBody('visual-playbook.cards').stats).toMatchObject({ band: 'too_few', n: 2, winRate: 0.5 })
    renderBody()
    const s = await screen.findByTestId('slice-stats')
    expect(s.textContent).toContain('too few to judge')
    expect(s.textContent).not.toContain('Win rate')
    fireEvent.click(screen.getByRole('button', { name: 'Show the numbers anyway' }))
    expect(s.textContent).toContain('Win rate50%')
    expect(s.textContent).toContain('Average R+0.50R')
  })

  it('thin sample: the numbers show with their ranges', async () => {
    serve('visual-playbook.cards.thin')
    expect(contractBody('visual-playbook.cards.thin').stats).toMatchObject({
      band: 'thin', n: 12, wins: 7, losses: 5, winRateRange: [0.32, 0.807], avgRRange: [-0.2315, 1.7315],
    })
    renderBody()
    const s = await screen.findByTestId('slice-stats')
    expect(s.textContent).toContain('thin sample')
    expect(s.textContent).toContain('58% (range 32%–81%)')
    expect(s.textContent).toContain('+0.75R (range -0.23R to +1.73R)')
  })

  it('with the entry-context switch off the regime filter is a disabled, labelled placeholder', async () => {
    serve('visual-playbook.cards.regime-unavailable')
    const { regime } = contractBody('visual-playbook.cards.regime-unavailable')
    expect(regime.available).toBe(false)
    renderBody()
    await screen.findAllByTestId('playbook-card')
    const select = screen.getByLabelText(/Market regime/)
    expect(select.disabled).toBe(true)
    expect(screen.getByText(regime.reason)).toBeTruthy()       // the server's own sentence
    expect(screen.queryByTestId('playbook-card-regime')).toBeNull()
  })

  it('missing fingerprint values excluded by a range are counted out loud', async () => {
    serve('visual-playbook.cards.range-only')
    expect(contractBody('visual-playbook.cards.range-only').excludedMissing).toEqual({ rs_rank: 1 })
    renderBody()
    expect(await screen.findByText('1 chart was left out: no RS rank in the fingerprint.')).toBeTruthy()
  })

  it('a member with no tagged chart is told how to start', async () => {
    serve('visual-playbook.cards.empty')
    renderBody()
    expect(await screen.findByText(
      'No tagged charts match. Tag a chart in a note (the Setup picker under the chart) to build your playbook.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('playbook-card')).toBeNull()
  })

  it('a failed read is an error, never an empty playbook', async () => {
    serve('visual-playbook.cards.bad-range')
    renderBody()
    expect((await screen.findByRole('alert')).textContent).toContain('could not be read (422)')
    expect(screen.queryByText(/No tagged charts match/)).toBeNull()
  })

  // ── wave 14 playbook fixes, item 2 ────────────────────────────────────────
  // Opened from a chart's panel the sheet pre-selected that chart's setup tag, so a member
  // with 5 tagged charts saw 3 (the 13I-2 walk's `cards_unfiltered: 3`, screenshot "VCP (3)").
  it('⭐ opens on the WHOLE playbook even when opened from a tagged chart (fails on the old pre-filter)', async () => {
    serve('visual-playbook.cards')
    expect(contractBody('visual-playbook.cards').facets.setups).toEqual({ VCP: 2, 'Bull Flag': 1 })
    renderBody({ initialSetup: 'VCP' })
    await screen.findAllByTestId('playbook-card')
    expect(String(global.fetch.mock.calls[0][0])).toBe(BASE)
    expect(screen.getByLabelText('Setup').value).toBe('')
    expect(screen.getByTestId('playbook-scope').textContent).toContain('All 3 tagged charts')
  })

  it("the chart's own setup is a one-tap shortcut, and the way back names the whole count", async () => {
    serve('visual-playbook.cards')
    renderBody({ initialSetup: 'VCP' })
    await screen.findAllByTestId('playbook-card')
    fireEvent.click(screen.getByRole('button', { name: "Only this chart's setup (VCP)" }))
    await waitFor(() => {
      expect(String(global.fetch.mock.calls.at(-1)[0])).toBe(`${BASE}?setup=VCP`)
    }, { timeout: 2000 })
    fireEvent.click(await screen.findByRole('button', { name: 'Show all 3 tagged charts' }))
    expect(screen.getByLabelText('Setup').value).toBe('')
  })

  // ── wave 14 playbook fixes, item 1: the regime filter reads 13E ──────────
  it('with 13E on, the regime select is live, counted, and its choice reaches the server', async () => {
    serve('visual-playbook.cards.with-regime')
    const { regime } = contractBody('visual-playbook.cards.with-regime')
    expect(regime).toMatchObject({ available: true, facets: { green: 0, amber: 1, orange: 0, red: 0 }, unknown: 3 })
    renderBody()
    expect((await cardFor('VPRG')).textContent).toContain('Regime at entry: Amber')
    // a chart whose trade has no frozen context says so, never a guessed regime
    expect((await cardFor('VPNV')).textContent).toContain('Regime at entry: not known')
    const sel = screen.getByLabelText(/Market regime/)
    expect(sel.disabled).toBe(false)
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Any regime', 'Green (0)', 'Amber (1)', 'Orange (0)', 'Red (0)'])
    fireEvent.change(sel, { target: { value: 'amber' } })
    await waitFor(() => {
      expect(String(global.fetch.mock.calls.at(-1)[0])).toBe(`${BASE}?regime=amber`)
    }, { timeout: 2000 })
  })

  it('charts a regime filter left out for an unknown regime are counted out loud', async () => {
    serve('visual-playbook.cards.regime-filtered')
    expect(contractBody('visual-playbook.cards.regime-filtered').regime).toMatchObject({ selected: 'green', excludedUnknown: 3 })
    renderBody()
    expect(await screen.findByText('3 charts were left out: no market regime was frozen at their entry.')).toBeTruthy()
  })

  it('buildPlaybookQuery carries the regime', () => {
    expect(buildPlaybookQuery({ regime: 'red' })).toBe('?regime=red')
    expect(new URL(contract('visual-playbook.cards.regime-filtered')._contract.path, 'http://x').search)
      .toBe(buildPlaybookQuery({ regime: 'green' }))
  })

  it('the sheet renders nothing with the gate off', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_visual_playbook_enabled: false })
    serve('visual-playbook.cards')
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
  // The tests lane replaced this file's hand-typed cards with the server's recorded answer. No
  // recorded member has added the sample, so an example card is the recorded card with the
  // fields the server sets on one (`example: true`, no trades), and the counts it reports.
  const RECORDED = () => contractBody('visual-playbook.cards')
  const card = () => RECORDED().cards[0]
  const example = () => ({ ...card(), noteId: 'ex', noteTitle: 'Trade plan: example', symbol: 'AAPL', example: true, trades: [], outcome: 'none' })
  const stats = (over) => ({ ...RECORDED().stats, ...over })
  const payload = (over) => ({ ...RECORDED(), ...over })
  const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

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

// Lane KEYS3 (Q22): opened from a chart, the sheet's ten filter stops stood between a keyboard
// member and the one thing that chart's door is for, "Only this chart's setup". When the sheet
// is opened from a chart, focus lands on that button once the playbook has loaded.
describe('VisualPlaybookBody: opened from a chart, focus lands on its setup shortcut (lane KEYS3)', () => {
  const dialog = (props) => render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <div role="dialog" tabIndex={-1} data-testid="sheet"><button type="button">Close</button><VisualPlaybookBody {...props} /></div>
    </SWRConfig>,
  )
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

  it('focus goes to "Only this chart\'s setup (VCP)" when the cards arrive', async () => {
    serve('visual-playbook.cards')
    dialog({ initialSetup: 'VCP', landOnSetup: true })
    screen.getByTestId('sheet').focus()                 // where a sheet puts focus when it opens
    await screen.findAllByTestId('playbook-card')
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('button', { name: "Only this chart's setup (VCP)" })))
  })

  it('a member who has already moved focus keeps it', async () => {
    serve('visual-playbook.cards')
    dialog({ initialSetup: 'VCP', landOnSetup: true })
    screen.getByRole('button', { name: 'Close' }).focus()
    await screen.findAllByTestId('playbook-card')
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('CONTROL: without landOnSetup (the page body, a tour) focus is left alone', async () => {
    serve('visual-playbook.cards')
    dialog({ initialSetup: 'VCP' })
    screen.getByTestId('sheet').focus()
    await screen.findAllByTestId('playbook-card')
    await settle()
    expect(document.activeElement).toBe(screen.getByTestId('sheet'))
  })
})
