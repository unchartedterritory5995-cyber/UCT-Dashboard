/* TERM-073 (FB-A4-01) — the analyst revision panel, rendered text asserted. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import AnalystRevisions from './AnalystRevisions'

const FIELDS = {
  consensus: 'Consensus rating', pt_target: 'Consensus price target',
  upgrades_30d: 'Upgrades (30d)', downgrades_30d: 'Downgrades (30d)',
  eps_next_y_growth: 'EPS growth, next year',
}
const BASE = {
  ticker: 'NVDA', fields: FIELDS, source: 'UCT nightly analyst pass (FMP)',
  contributors: null,
  contributors_note: 'The nightly pass does not retain the number of contributing analysts, so no contributor count is shown.',
}

function serve(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300, status, json: async () => body,
  })))
}
const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AnalystRevisions sym="NVDA" />
  </SWRConfig>)

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AnalystRevisions', () => {
  it('DARK: a 404 renders nothing at all', async () => {
    serve(404, { detail: 'Not Found' })
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
  })

  it('two identical snapshots read "No revision", never a flat line', async () => {
    serve(200, { ...BASE, status: 'no_revision', observations: 3, revisions: [],
      window: { first: '2026-09-28', last: '2026-09-30' } })
    mount()
    expect(await screen.findByTestId('revisions-status'))
      .toHaveTextContent('No revision across 3 nightly snapshots (2026-09-28 – 2026-09-30).')
    expect(screen.queryByTestId('revisions-list')).toBeNull()
  })

  it('a revision names each changed field, from and to', async () => {
    serve(200, { ...BASE, status: 'revised', observations: 3,
      window: { first: '2026-09-28', last: '2026-09-30' },
      revisions: [{ from_date: '2026-09-29', to_date: '2026-09-30', changes: {
        consensus: { from: 'Buy', to: 'Strong Buy' }, pt_target: { from: 150, to: 165 } } }] })
    mount()
    const list = await screen.findByTestId('revisions-list')
    expect(list).toHaveTextContent('2026-09-29 → 2026-09-30:')
    expect(list).toHaveTextContent('Consensus rating Buy → Strong Buy; Consensus price target $150.00 → $165.00')
  })

  it('one snapshot says a revision needs two', async () => {
    serve(200, { ...BASE, status: 'no_history', observations: 1, revisions: [],
      window: { first: '2026-09-30', last: '2026-09-30' } })
    mount()
    expect(await screen.findByTestId('revisions-status'))
      .toHaveTextContent('Not enough history yet — 1 nightly snapshot retained (2026-09-30 – 2026-09-30); a revision needs two.')
  })

  it('the method ships with the number: window, count, source and the contributor note', async () => {
    serve(200, { ...BASE, status: 'no_revision', observations: 2, revisions: [],
      window: { first: '2026-09-29', last: '2026-09-30' } })
    mount()
    const m = await screen.findByTestId('revisions-method')
    expect(m).toHaveTextContent('Window 2026-09-29 – 2026-09-30, 2 snapshots.')
    expect(m).toHaveTextContent('Source: UCT nightly analyst pass (FMP).')
    expect(m).toHaveTextContent('does not retain the number of contributing analysts')
  })

  it('a server error says it could not load, rather than showing nothing', async () => {
    serve(500, {})
    mount()
    expect(await screen.findByText(/Couldn.t load the analyst revision history/)).toBeTruthy()
  })
})
