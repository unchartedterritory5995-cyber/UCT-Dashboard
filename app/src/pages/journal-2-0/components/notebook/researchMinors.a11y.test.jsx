// Lane FIN-A11Y (review R4 minors on the Notebook's research surfaces):
//   M-5   Passed setups: Add and Remove were silent, and Remove dropped focus.
//   M-7   Fingerprint tag suggestion: Use and Dismiss dropped focus; Dismiss was unnamed.
//   M-8   Find similar: "100 is an identical fingerprint" lived in a mouse-only title.
//   M-10  Setups board: the note link's underline was a fixed white, invisible in light.
//   M-13  Visual playbook: the sheet layout was read from a hook at mount, not at the click.
//   M-16  Visual playbook and transcript filters did not say how many results they left.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import PassedSetups from './PassedSetups'
import FingerprintPanel from './FingerprintPanel'
import SimilarNames from './SimilarNames'
import VisualPlaybook, { VisualPlaybookBody } from './VisualPlaybook'

const DIR = join(process.cwd(), 'src/pages/journal-2-0/components/notebook')
const css = (name) => readFileSync(join(DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const Swr = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter>{children}</MemoryRouter>
  </SWRConfig>
)

afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

// ── M-5 ────────────────────────────────────────────────────────────────────────────────────
describe('M-5 -- Passed setups says what happened and keeps focus', () => {
  const out = (key, sessions, pct) => ({ key, sessions, pct, missing: null, label: null })
  const row = (id, symbol) => ({
    id, symbol, source: 'manual', savedDay: '2026-08-10', baseDate: '2026-08-07', status: 'scored',
    noBarsLabel: null, outcomes: [out('r1', 1, 1)],
  })
  let items
  beforeEach(() => {
    latchNotebookFlags({ notebook_passed_setups_enabled: true })
    items = [row('a', 'NVDA'), row('b', 'AMD'), row('c', 'TSLA')]
    global.fetch = vi.fn(async (url, init = {}) => {
      const method = init.method || 'GET'
      if (method === 'DELETE') items = items.filter((i) => !String(url).endsWith('/' + i.id))
      if (method === 'POST') items = [...items, row('z', JSON.parse(init.body).symbol)]
      return { ok: true, status: 200, json: async () => ({ horizons: [1], tradedCount: 0, items }) }
    })
  })

  const status = () => document.querySelector('[data-passed-status]')

  it('a status region is mounted, empty, before anything is done', async () => {
    render(<Swr><PassedSetups /></Swr>)
    await screen.findByRole('list', { name: 'Passed setups' })
    expect(status()).toHaveAttribute('role', 'status')
    expect(status()).toHaveTextContent('')
  })

  it('Remove says so and moves focus to the next row', async () => {
    const user = userEvent.setup()
    render(<Swr><PassedSetups /></Swr>)
    await user.click(await screen.findByRole('button', { name: 'Remove AMD from passed setups' }))
    await waitFor(() => expect(status()).toHaveTextContent('Removed AMD from passed setups.'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove TSLA from passed setups' })).toHaveFocus())
  })

  it('removing the last row moves focus to the row before it', async () => {
    const user = userEvent.setup()
    render(<Swr><PassedSetups /></Swr>)
    await user.click(await screen.findByRole('button', { name: 'Remove TSLA from passed setups' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove AMD from passed setups' })).toHaveFocus())
  })

  it('removing the only row moves focus to the ticker field', async () => {
    items = [row('a', 'NVDA')]
    const user = userEvent.setup()
    render(<Swr><PassedSetups /></Swr>)
    await user.click(await screen.findByRole('button', { name: 'Remove NVDA from passed setups' }))
    await waitFor(() => expect(screen.getByLabelText('Ticker you passed on')).toHaveFocus())
  })

  it('Add says what was added', async () => {
    const user = userEvent.setup()
    render(<Swr><PassedSetups /></Swr>)
    await screen.findByRole('list', { name: 'Passed setups' })
    await user.type(screen.getByLabelText('Ticker you passed on'), 'crwd{Enter}')
    await waitFor(() => expect(status()).toHaveTextContent('Added CRWD to passed setups.'))
  })
})

// ── M-7 ────────────────────────────────────────────────────────────────────────────────────
describe('M-7 -- the fingerprint tag suggestion keeps focus and names its buttons', () => {
  const cell = (value, missing = null) => ({ value, source: 'screener_row', missing })
  const FP = {
    v: 1, symbol: 'NVDA', requested_as_of: '2026-09-30', as_of: '2026-09-30', mode: 'nightly',
    fields: {
      rs_rank: cell(94), adr_pct: cell(5.9), base_depth_pct: cell(11.2), pole_pct: cell(62.4), ma_stack: cell('full-bull'),
      vol_nweek_low: cell(15), rs_line_trend: cell('up'), base_length_bars: cell(null, 'no_flat_base'),
      patterns: { value: [{ setup: 'vcp', asof_date: '2026-09-29', confidence: 81.2, key_level: 100 }], source: 'pattern_vision', missing: null },
    },
  }
  const ATTRS = { widgetId: 'chart', embedId: 'e-1', capturedAt: '2026-09-30T18:00:00Z', params: { symbol: 'NVDA', tf: 'D', to: 1790791200 }, ta: { v: 1, fingerprint: FP } }
  const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n-1' } } }
  const panel = (updateAttributes = vi.fn()) => render(
    <Swr><FingerprintPanel attrs={ATTRS} updateAttributes={updateAttributes} editor={editor} /></Swr>,
  )
  beforeEach(() => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true, notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn((url) => (String(url).endsWith('/meta')
      ? respond(200, { version: 1, fields: [], missingReasons: {}, transientMissing: [] }) : respond(200, {})))
  })

  it('Dismiss says which suggestion it dismisses', async () => {
    panel()
    await screen.findByTestId('tag-suggestion')
    expect(screen.getByRole('button', { name: 'Dismiss the suggested tag VCP' })).toBeInTheDocument()
  })

  it('Dismiss moves focus to the Setup picker, not to <body>', async () => {
    const user = userEvent.setup()
    panel()
    await screen.findByTestId('tag-suggestion')
    await user.click(screen.getByRole('button', { name: 'Dismiss the suggested tag VCP' }))
    expect(screen.queryByTestId('tag-suggestion')).toBeNull()
    expect(screen.getByLabelText('Setup')).toHaveFocus()
  })

  it('Use moves focus to the Setup picker as well', async () => {
    const user = userEvent.setup()
    const updateAttributes = vi.fn()
    panel(updateAttributes)
    await screen.findByTestId('tag-suggestion')
    await user.click(screen.getByRole('button', { name: 'Use “VCP”' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Setup')).toHaveFocus()
  })
})

// ── M-8 ────────────────────────────────────────────────────────────────────────────────────
describe('M-8 -- what a match score means is on screen, not in a hover title', () => {
  it('the scale is visible text and the score carries no title', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    global.fetch = vi.fn(() => respond(200, {
      template: { noteId: 'n1', embedKey: 'e-1', symbol: 'NVDA', setupTag: 'VCP' }, asOf: '2026-10-01', status: 'ready',
      matches: [{ rank: 1, symbol: 'CRWD', score: 88, reasons: { fields: [], patterns: { shared: [], templateOnly: [], missing: null } } }],
    }))
    render(<Swr><SimilarNames noteId="n1" embedKey="e-1" /></Swr>)
    const score = await screen.findByText('88 match')
    expect(score).not.toHaveAttribute('title')
    expect(screen.getByText(/100 is an identical fingerprint/)).toBeVisible()
  })
})

// ── M-13, M-16 ─────────────────────────────────────────────────────────────────────────────
describe('M-13 and M-16 -- the visual playbook', () => {
  const card = (n) => ({
    noteId: 'n' + n, noteTitle: 'Plan ' + n, embedKey: 'e' + n, symbol: 'NVDA', timeframe: 'D', asOf: '2026-09-30',
    setupTag: 'VCP', fingerprintSource: 'note', fingerprintAsOf: '2026-09-30',
    values: { rs_rank: 95, base_depth_pct: 12.4, adr_pct: 5.1, pole_pct: 60 },
    image: { url: '/img/e.png', w: 800, h: 400 }, outcome: 'win', trades: [],
  })
  const payload = (cards) => ({
    cards, count: cards.length,
    stats: { charts: cards.length, trades: 0, unlinkedCharts: 0, n: 0, band: 'too_few', wording: 'too few to judge', wins: 0, losses: 0, breakeven: 0, winRate: null, avgR: null, winRateRange: null, avgRRange: null },
    excludedMissing: {}, pending: 0, facets: { setups: { VCP: 2 }, timeframes: { D: 2 } },
    regime: { available: false, reason: 'x' },
  })
  const realMatchMedia = window.matchMedia
  const setTouch = (touch) => {
    window.matchMedia = (query) => ({
      matches: touch && /max-width:\s*1024px/.test(query), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })
  }
  beforeEach(() => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn(() => respond(200, payload([card(1), card(2)])))
  })
  afterEach(() => { window.matchMedia = realMatchMedia })

  it('the layout is decided when it OPENS: mounted on a desktop read, opened on touch, it is fullscreen', async () => {
    setTouch(false)
    const { rerender } = render(<Swr><VisualPlaybook open={false} onClose={() => {}} /></Swr>)
    setTouch(true) // the query answers differently by the time the member taps
    rerender(<Swr><VisualPlaybook open onClose={() => {}} /></Swr>)
    const panel = (await screen.findByRole('dialog', { name: 'Visual playbook' }))
    expect(panel.className).toMatch(/fullscreen/)
  })

  it('opened on a desktop it is the centred modal', async () => {
    setTouch(false)
    render(<Swr><VisualPlaybook open onClose={() => {}} /></Swr>)
    const panel = await screen.findByRole('dialog', { name: 'Visual playbook' })
    expect(panel.className).toMatch(/modal/)
    expect(panel.className).not.toMatch(/fullscreen/)
  })

  it('a polite status says how many charts the filters leave', async () => {
    render(<Swr><VisualPlaybookBody /></Swr>)
    await screen.findByRole('list', { name: 'Tagged charts' })
    const status = document.querySelector('[data-vp-count]')
    expect(status).toHaveAttribute('role', 'status')
    await waitFor(() => expect(status).toHaveTextContent('2 tagged charts match.'))
    global.fetch = vi.fn(() => respond(200, payload([card(1)])))
    fireEvent.change(screen.getByLabelText(/Outcome/i), { target: { value: 'win' } })
    await waitFor(() => expect(status).toHaveTextContent('1 tagged chart matches.'))
    await act(async () => {})
  })
})

// ── M-10 and the literal colours in M-16 ───────────────────────────────────────────────────
describe('M-10 and M-16 -- stylesheets follow the theme', () => {
  it('the Setups board note link is underlined in its own colour, not a fixed white', () => {
    const src = css('SetupsBoard.module.css')
    const at = src.indexOf('.noteLink {')
    const rule = src.slice(at, src.indexOf('}', at))
    expect(rule).toMatch(/text-decoration:\s*underline/)
    expect(rule).not.toMatch(/text-decoration-color:\s*rgba\(255/)
  })

  it('no fixed gold, green or red literal is left in the rules the review named', () => {
    expect(css('SetupsBoard.module.css')).not.toMatch(/rgba\((74, 222, 128|248, 113, 113|220, 187, 94)/)
    expect(css('PassedSetups.module.css')).not.toMatch(/rgba\(220, 187, 94/)
    expect(css('TemplatePicker.module.css')).not.toMatch(/rgba\(220, 187, 94/)
  })
})
