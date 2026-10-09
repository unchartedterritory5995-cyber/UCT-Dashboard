// EE with BRKE folded in (owner decision 2026-10-08). The consensus is the research page's own
// component (stubbed here; it has its own tests). What this adapter adds is BRKE's firms-acting
// list, and only when the broker-estimates read is switched on AND holds real rows: a failed,
// pending or empty read adds nothing under the consensus.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'

const fetcher = vi.hoisted(() => ({ fn: null }))
vi.mock('../../research/depth/depthFetch', () => ({
  depthFetcher: (...a) => fetcher.fn(...a),
}))
vi.mock('../../../components/research/fmpDepth/ConsensusEstimates', () => ({
  default: ({ sym }) => <div data-testid="stub-consensus">consensus:{sym}</div>,
}))

import EstimatesPanel, { BROKER_ESTIMATES_FLAG, brokerEstimatesKey, firmActions } from './EstimatesPanel'

const ON = { researchDepth: { broker_estimates_enabled: true } }
const OFF = { researchDepth: { broker_estimates_enabled: false } }

const okRead = {
  state: 'ok',
  periods: [],
  firms: {
    state: 'ok', source: 'FMP grades',
    actions: [
      { date: '2026-10-01', firm: 'Morgan Stanley', action: 'upgrade', to_grade: 'Overweight', from_grade: 'Equal-Weight' },
      { date: '2026-09-20', firm: 'Jefferies', action: 'maintain', to_grade: 'Buy' },
    ],
  },
}

function renderPanel(auth, sym = 'NVDA') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={auth}>
        <EstimatesPanel sym={sym} />
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

beforeEach(() => { fetcher.fn = vi.fn() })
afterEach(() => cleanup())

describe('EE carries what BRKE had (the firms acting on the stock)', () => {
  it('names the flag the Depth tab already gates broker estimates on', () => {
    expect(BROKER_ESTIMATES_FLAG).toBe('researchDepth.broker_estimates_enabled')
    expect(brokerEstimatesKey('BRK.B')).toBe('/api/research/broker-estimates/BRK.B')
  })

  it('flag ON with real rows: the consensus, then the firms acting, in plain words', async () => {
    fetcher.fn.mockResolvedValue(okRead)
    renderPanel(ON)
    expect(screen.getByTestId('stub-consensus')).toHaveTextContent('consensus:NVDA')
    const rows = await screen.findAllByTestId('ee-firm-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Morgan Stanley: upgrade to Overweight (from Equal-Weight)')
    expect(screen.getByTestId('ee-firms')).toHaveTextContent('These are not the estimates above.')
    expect(fetcher.fn).toHaveBeenCalledWith('/api/research/broker-estimates/NVDA')
  })

  it('flag OFF: no broker read at all, the consensus alone', async () => {
    fetcher.fn.mockResolvedValue(okRead)
    renderPanel(OFF)
    expect(screen.getByTestId('stub-consensus')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 20))
    expect(fetcher.fn).not.toHaveBeenCalled()
    expect(screen.queryByTestId('ee-firms')).toBeNull()
  })

  it('a failed broker read adds nothing (no second error box under the consensus)', async () => {
    fetcher.fn.mockRejectedValue(new Error('503 Service Unavailable'))
    renderPanel(ON)
    await waitFor(() => expect(fetcher.fn).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('stub-consensus')).toBeTruthy()
    expect(screen.queryByTestId('ee-firms')).toBeNull()
  })

  it('pending, paywalled, unavailable or empty reads hold no real data and add nothing', () => {
    expect(firmActions(undefined)).toEqual([])
    expect(firmActions({ state: 'pending' })).toEqual([])
    expect(firmActions({ paywalled: true, firms: okRead.firms })).toEqual([])
    expect(firmActions({ state: 'ok', firms: { state: 'error', reason: 'x', actions: [] } })).toEqual([])
    expect(firmActions({ state: 'ok', firms: { state: 'ok', actions: [] } })).toEqual([])
    expect(firmActions({ state: 'ok', firms: { state: 'ok', actions: [{ date: '2026-10-01' }] } })).toEqual([])
    expect(firmActions(okRead)).toHaveLength(2)
  })
})
