import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen } from '../../test-utils'

// TERM-062 — the Research header shows the pre-save fire-frequency line BEFORE a
// member saves a filing watch (not watching / suspended), and not once it is
// saved. The shared hook is mocked so the header's state is deterministic; the
// line's own text is asserted end-to-end in FilingWatchFrequency.test.jsx.

const W = vi.hoisted(() => ({
  state: 'NOT_WATCHING',
  freq: null,
}))
vi.mock('../../hooks/useFilingWatch', () => ({
  default: () => ({
    enabled: true,
    predicates: [],
    isLoading: false,
    watchState: () => W.state,
    getWatch: () => null,
    createOrReactivate: vi.fn(),
    suspend: vi.fn(),
    cooldown: null,
  }),
  useFilingWatchFrequency: () => W.freq,
}))
vi.mock('../../components/chart/SymbolSearch', () => ({
  default: ({ displayLabel, sym }) => <button type="button">{displayLabel || sym}</button>,
}))

import ResearchHeader from './ResearchHeader'

const NOW = 1_790_000_000
const FREQ = {
  ticker: 'AAPL', window_days: 30, window_start: NOW - 30 * 86400, covered: true,
  covered_since: NOW - 30 * 86400, fires: 3,
  cooldown: { sentence: 'Checked every 20 minutes. Each new filing alerts you once, and never again.' },
}
const LINE = 'A filing watch on AAPL fired 3 times in the last 30 days.'

const mount = () => renderWithProviders(
  <ResearchHeader sym="AAPL" meta={{}} live={{}} ratings={null} onSymbolChange={() => {}} />,
)

beforeEach(() => { W.state = 'NOT_WATCHING'; W.freq = FREQ })

describe('ResearchHeader — filing-watch fire-frequency before saving', () => {
  it('shows the count and the published rule beside "Notify me" when not watching', () => {
    mount()
    expect(screen.getByRole('button', { name: /Notify me about new SEC filings for AAPL/ })).toBeInTheDocument()
    expect(screen.getByText(LINE)).toBeInTheDocument()
    expect(screen.getByText(FREQ.cooldown.sentence)).toBeInTheDocument()
  })

  it('shows it for a suspended watch too (reactivating is saving again)', () => {
    W.state = 'SUSPENDED'
    mount()
    expect(screen.getByText(LINE)).toBeInTheDocument()
  })

  it('does not show it once the watch is saved', () => {
    W.state = 'ACTIVE'
    mount()
    expect(screen.queryByText(LINE)).not.toBeInTheDocument()
    expect(screen.queryByTestId('filing-watch-frequency')).not.toBeInTheDocument()
  })
})
