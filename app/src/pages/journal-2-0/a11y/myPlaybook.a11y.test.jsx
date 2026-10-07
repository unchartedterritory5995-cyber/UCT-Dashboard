// app/src/pages/journal-2-0/a11y/myPlaybook.a11y.test.jsx
//
// Wave 13, lane 13B: My Playbook through 8A's axe harness. Dark behind notebook_playbook_enabled,
// so the gate is latched ON for each recipe. Each recipe proves the state it is about rendered
// before axe runs, so an empty screen can never pass as a clean one:
//   * my-playbook           -- all three R3 bands on screen, a drill table open, a finding's
//                              citations open, the snapshot button;
//   * playbook-section-door -- Insights > Playbook carrying the door to My Playbook.
import { describe, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import MyPlaybook from '../components/insights/MyPlaybook'
import PlaybookSection from '../components/insights/PlaybookSection'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

const t = (id, result, r) => ({ id, tradeRef: `id:${id}`, symbol: 'NVDA', side: 'Long', result,
  entryDate: '2026-03-02T14:30:00Z', exitDate: '2026-03-03T19:30:00Z', rMultiple: r, pnlDollar: r * 100, source: null })
const setup = (name, n, band, wording, range) => ({
  setup: name, tradeCount: n, winCount: Math.ceil(n / 2), lossCount: Math.floor(n / 2), beCount: 0,
  profitFactor: 1.4, totalPnlDollar: 250, sample: { n, band, wording },
  winRateStat: { k: Math.ceil(n / 2), n, rate: 0.5, band, wording, range },
  avgRStat: { n, mean: 0.3, band, wording, range: range ? [-0.2, 0.8] : null },
  expectancyStat: { n, mean: 30, band, wording, range: range ? [-20, 80] : null },
  trades: Array.from({ length: n }, (_, i) => t(`${name}-${i}`, i % 2 ? 'Loss' : 'Win', i % 2 ? -1 : 1.6)),
})
const PAYLOAD = {
  asOf: '2026-10-03T12:00:00Z', untagged: { count: 2 }, sample: { tooFewBelow: 10, normalFrom: 25 },
  setups: [setup('Breakout', 12, 'thin', 'thin sample', [0.25, 0.75]), setup('EP', 6, 'too_few', 'too few to judge', null),
    setup('Pullback', 30, 'normal', null, null)],
  notesBySetup: { Breakout: [{ noteId: 'n1', title: 'Breakout plan', tradeCount: 3 }], EP: [], Pullback: [] },
  patterns: { caption: 'Patterns, not proof', status: 'ok', noted: { wins: 6, losses: 6 }, findings: [
    { term: 'FOMO', kind: 'mistake', leans: 'losses', losses: { k: 4, n: 6 }, wins: { k: 1, n: 6 },
      citations: [{ tradeId: 'Breakout-1', symbol: 'NVDA', result: 'Loss', exitDate: '2026-03-03', notes: [{ noteId: 'n2', title: 'Pre-trade' }] }] },
  ] },
}

describe('a11y: My Playbook (wave 13, lane 13B)', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_playbook_enabled: true })
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/j2/my-playbook')) return json(PAYLOAD)
      if (u.includes('/playbook')) return json([])
      return json({})
    })
  })
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  axeSurface('my-playbook', async () => {
    render(<Providers route="/journal-2-0/playbook"><MyPlaybook onSaveSnapshot={async () => ({ id: 's1' })} /></Providers>)
    const card = await screen.findByRole('article', { name: 'Breakout' })
    expect(screen.getAllByText('too few to judge').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/thin sample/).length).toBeGreaterThan(0)
    await userEvent.click(within(card).getByRole('button', { name: /^Win rate / }))
    expect(within(card).getByTestId('playbook-drill')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Show the 1 trade and notes/ }))
    expect(screen.getByTestId('pattern-citations')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save a snapshot note' })).toBeTruthy()
    await settle()
  })

  axeSurface('playbook-section-door', async () => {
    render(<Providers route="/journal?j2tab=analytics"><PlaybookSection /></Providers>)
    expect(await screen.findByTestId('open-my-playbook')).toBeTruthy()
    await settle()
  })
})
