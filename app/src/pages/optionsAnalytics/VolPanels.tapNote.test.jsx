import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The two "how this is measured" notes used to be hover titles only, which a
// touch screen cannot read. They are now tap-to-open lines as well.
vi.mock('./useDarkSection', () => ({
  default: (url) => {
    if (url && url.includes('/iv-rank')) {
      return { data: { sentence: 's', iv_rank: 42, rank_word: 'mid', iv_percentile: 40, window_sessions: 60, method: 'IV rank over logged sessions.', n: 60, logging_began: '2026-06-01' } }
    }
    if (url && url.includes('/monitor')) {
      return { data: { hv: { hv20: 0.3, hv30: 0.32 }, hv_method: 'Close-to-close stdev, annualised', events: { note: 'none' }, volume: {} } }
    }
    return {}
  },
}))

import { IvRankBadge, OptionMonitorStrip } from './VolPanels'

describe('tap-readable measurement notes', () => {
  it('the IV rank badge carries its method as visible tappable text', () => {
    render(<IvRankBadge sym="AAPL" />)
    expect(screen.getByTestId('iv-rank-note').textContent).toContain('60 sessions logged since 2026-06-01')
  })
  it('the option monitor carries the HV method as visible tappable text', () => {
    render(<MemoryRouter><OptionMonitorStrip sym="AAPL" /></MemoryRouter>)
    expect(screen.getByTestId('hv-method-note').textContent).toContain('Close-to-close stdev, annualised (computed)')
  })
})
