// app/src/pages/journal-2-0/a11y/visualPlaybook.a11y.test.jsx
//
// Wave 13, lane 13I-2: the fingerprint panel, the visual playbook and the trade page's before
// and after, through 8A's axe harness (the ONE way a Notebook rail asks axe-core). Every surface
// is dark behind its gate, so the gates are latched ON for each recipe. Each recipe proves the
// state it is about rendered before axe runs, so an empty screen can never pass as a clean one:
//   * fingerprint-panel   -- a frozen fingerprint, every field expanded (values, sources, a
//                            labelled missing value), the setup picker and a suggestion;
//   * visual-playbook     -- the sheet open: filters (regime placeholder included), the slice
//                            stats revealed, and a card;
//   * trade-before-after  -- both frozen charts captioned, plan line and the plan chart image.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../../../components/chart/pane/ChartPane', () => ({
  default: (props) => <div data-testid="pane" aria-label={`${props.sym} chart`} role="img" />,
}))

const { default: FingerprintPanel } = await import('../components/notebook/FingerprintPanel')
const { default: VisualPlaybook } = await import('../components/notebook/VisualPlaybook')
const { default: TradeBeforeAfter } = await import('../components/trade/TradeBeforeAfter')

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const cell = (value, missing = null) => ({ value, source: 'screener_row', missing })

const FP = {
  v: 1, symbol: 'NVDA', as_of: '2026-09-30', mode: 'nightly',
  fields: {
    rs_rank: cell(94), adr_pct: cell(5.9), base_depth_pct: cell(11.2), pole_pct: cell(62.4), ma_stack: cell('full-bull'),
    base_length_bars: cell(null, 'no_flat_base'),
    patterns: { value: [{ setup: 'vcp', asof_date: '2026-09-29', confidence: 81 }], source: 'pattern_vision', missing: null },
  },
}
const META = { missingReasons: { no_flat_base: 'no flat base ends at this day' } }
const CARDS = {
  cards: [{ noteId: 'n1', noteTitle: 'NVDA plan', embedKey: 'e1', symbol: 'NVDA', timeframe: 'D', asOf: '2026-09-30',
    setupTag: 'VCP', fingerprintSource: 'note', fingerprintAsOf: '2026-09-30', values: { rs_rank: 94 },
    image: { url: '/img/e1.png', w: 800, h: 400 }, outcome: 'win', trades: [{ tradeId: 't1', rMultiple: 2, outcome: 'win' }] }],
  count: 1,
  stats: { charts: 1, trades: 1, unlinkedCharts: 0, n: 1, band: 'too_few', wording: 'too few to judge', wins: 1, losses: 0,
    breakeven: 0, winRate: 1, avgR: 2, winRateRange: null, avgRRange: null },
  excludedMissing: {}, pending: 0, facets: { setups: { VCP: 1 }, timeframes: { D: 1 } },
  regime: { available: false, reason: 'Filtering by market regime needs the entry context lane (13E), which is not built yet.' },
}
const BEFORE_AFTER = {
  trade: { tradeId: 't1', symbol: 'NVDA', side: 'Long', result: 'Win', shares: 100, entryPrice: 100, exitPrice: 110,
    entryDate: '2026-09-30T14:00:00Z', exitDate: '2026-10-02T15:00:00Z', entryDay: '2026-09-30', exitDay: '2026-10-02' },
  planStatus: 'linked', plan: { entry: 100, stop: 96, target: 112, noteTitle: 'NVDA plan' },
  planChart: { asOf: '2026-09-29', setupTag: 'VCP', image: { url: '/img/a.png' } },
}

describe('a11y: the fingerprint and the visual playbook (wave 13, lane 13I-2)', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true, notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.endsWith('/notebook-fingerprint/meta')) return json(META)
      if (u.startsWith('/api/j2/notebook-visual-playbook/cards')) return json(CARDS)
      if (u.includes('/before-after')) return json(BEFORE_AFTER)
      return json({})
    })
  })
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  axeSurface('fingerprint-panel', async () => {
    const attrs = { widgetId: 'chart', embedId: 'e1', params: { symbol: 'NVDA', tf: 'D' }, ta: { v: 1, fingerprint: FP } }
    render(<Providers><FingerprintPanel attrs={attrs} updateAttributes={() => {}}
      editor={{ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }} /></Providers>)
    await screen.findByTestId('tag-suggestion')
    fireEvent.click(screen.getByRole('button', { name: /Show all fields/ }))
    expect(screen.getByText(/Not available: no flat base ends at this day/)).toBeTruthy()
    expect(screen.getByLabelText('Setup')).toBeTruthy()
    await settle()
  })

  axeSurface('visual-playbook', async () => {
    render(<Providers><VisualPlaybook open onClose={() => {}} initialSetup="VCP" /></Providers>)
    await screen.findByTestId('playbook-card')
    fireEvent.click(screen.getByRole('button', { name: 'Show the numbers anyway' }))
    expect(screen.getByLabelText(/Market regime/).disabled).toBe(true)
    await settle()
  })

  axeSurface('trade-before-after', async () => {
    render(<Providers route="/journal/trade/t1"><TradeBeforeAfter tradeId="t1" /></Providers>)
    expect((await screen.findAllByTestId('pane')).length).toBe(2)
    expect(screen.getByAltText(/The chart in the plan note/)).toBeTruthy()
    await settle()
  })
})
