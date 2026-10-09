// Audit wave 2 (lane A, EE/EEH P2 #6/#22): inside a terminal panel the loading state is the
// terminal's one skeleton (role=status), not a plain "Loading…" line.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { TerminalPanelContext } from '../../../components/terminal'
import ConsensusEstimates from '../../../components/research/fmpDepth/ConsensusEstimates'
import EstimateHistoryTab from './EstimateHistoryTab'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const inPanel = (code, el) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider>
  </SWRConfig>,
)

describe('EE / EEH loading in a terminal panel', () => {
  it('EE shows the terminal skeleton', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    inPanel('EE', <ConsensusEstimates sym="NVDA" />)
    expect(screen.getByTestId('ee-loading').getAttribute('role')).toBe('status')
  })

  it('EEH shows the terminal skeleton', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    inPanel('EEH', <EstimateHistoryTab sym="NVDA" />)
    expect(screen.getByTestId('esthist-loading').querySelector('[role="status"]')).not.toBeNull()
  })
})
