// FlowGate with the switch on IS the flow tab: a failed flow read still says so, with a retry.
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen } from '../../../test-utils'

vi.mock('../../../context/AuthContext', async (orig) => ({ ...(await orig()), useAuth: () => ({ researchFlowTabEnabled: true }) }))
const retry = vi.fn()
vi.mock('../hooks/useResearchFlow', () => ({ default: () => ({ data: null, error: { httpStatus: 503 }, isLoading: false, retry }) }))
// eslint-disable-next-line import/first
import FlowGate from './FlowGate'

describe('FlowGate (switch on) on a failed read', () => {
  it('shows the flow tab\'s unavailable state, never an empty tape', () => {
    renderWithProviders(<FlowGate sym="AAPL" />)
    expect(screen.getByTestId('flow-unavailable')).toHaveTextContent('unavailable right now (the request answered 503)')
  })
})
