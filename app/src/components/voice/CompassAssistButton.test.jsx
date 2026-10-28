import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceContext } from '../../context/VoiceContext'
import CompassAssistButton from './CompassAssistButton'

const mockConnect = vi.fn()
const mockSetVoicePageHint = vi.fn()

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({
    connect: mockConnect,
    disconnect: vi.fn(),
    isConnected: false,
  }),
}))

vi.mock('../../context/VoiceContext', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    setVoicePageHint: (...args) => mockSetVoicePageHint(...args),
  }
})

function withVoiceProvider(node, providerValue = { mode: null, status: 'idle' }) {
  return (
    <VoiceContext.Provider value={providerValue}>
      {node}
    </VoiceContext.Provider>
  )
}

describe('CompassAssistButton', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockSetVoicePageHint.mockReset()
  })

  it('renders compass button when VoiceContext is present', () => {
    render(withVoiceProvider(
      <CompassAssistButton pageHint="Daily Notes · eod_recap" />,
    ))
    expect(screen.getByRole('button', { name: /compass/i })).toBeInTheDocument()
  })

  it('renders nothing when no VoiceContext mounted', () => {
    const { container } = render(<CompassAssistButton pageHint="anything" />)
    expect(container.firstChild).toBeNull()
  })

  it('clicking sets page hint and connects to compass agent', async () => {
    const user = userEvent.setup()
    render(withVoiceProvider(
      <CompassAssistButton pageHint="TradeDrawer · NVDA long" />,
    ))
    await user.click(screen.getByRole('button', { name: /compass/i }))
    expect(mockSetVoicePageHint).toHaveBeenCalledWith('TradeDrawer · NVDA long')
    expect(mockConnect).toHaveBeenCalledWith('compass')
  })

  it('is disabled when disabled prop is true', () => {
    render(withVoiceProvider(
      <CompassAssistButton pageHint="X" disabled />,
    ))
    expect(screen.getByRole('button', { name: /compass/i })).toBeDisabled()
  })

  // WCAG 2.5.3 label in name: a caller with custom visible text names the button with
  // those words (the Ticker Hub sheet's "Ask Compass about CLS"); the default name is
  // unchanged for every caller that passes nothing.
  it('ariaLabel names the button; omitted, the default name is unchanged', () => {
    const { unmount } = render(withVoiceProvider(
      <CompassAssistButton pageHint="chart of CLS" label="Ask Compass about CLS" ariaLabel="Ask Compass about CLS" />,
    ))
    expect(screen.getByRole('button')).toHaveAccessibleName('Ask Compass about CLS')
    unmount()
    render(withVoiceProvider(<CompassAssistButton pageHint="chart of CLS" />))
    expect(screen.getByRole('button')).toHaveAccessibleName('Talk to Compass about chart of CLS')
  })
})
