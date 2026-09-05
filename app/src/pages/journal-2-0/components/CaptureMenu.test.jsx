import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CaptureMenu from './CaptureMenu'

const sendMock = vi.fn(() => Promise.resolve('AMD sent to “Tuesday”'))
vi.mock('../lib/sendToJournal', () => ({
  sendCaptureToJournal: (...args) => sendMock(...args),
}))

beforeEach(() => { sendMock.mockClear() })

describe('CaptureMenu — Wave 1 (P1-1) destination + comment picker', () => {
  it('renders nothing when closed', () => {
    render(<CaptureMenu open={false} onClose={() => {}} widgetId="chart" capture={{ symbol: 'AMD' }} label="AMD" />)
    expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument()
  })

  it('shows a comment field and every universal destination when open', () => {
    render(<CaptureMenu open onClose={() => {}} anchor={{ x: 0, y: 0 }} widgetId="breadth" capture={{}} label="Breadth" />)
    expect(screen.getByPlaceholderText(/add a comment/i)).toBeInTheDocument()
    expect(screen.getByText('Current note')).toBeInTheDocument()
    expect(screen.getByText('New entry')).toBeInTheDocument()
    expect(screen.getByText('Notebook inbox')).toBeInTheDocument()
    // breadth has no symbol — copyChartLink must not appear (targetsFor's own filter).
    expect(screen.queryByText('Copy chart link')).not.toBeInTheDocument()
  })

  it('a chart capture with a symbol also offers Copy chart link', () => {
    render(<CaptureMenu open onClose={() => {}} anchor={{ x: 0, y: 0 }} widgetId="chart" capture={{ symbol: 'AMD', tf: '5' }} label="AMD" />)
    expect(screen.getByText('Copy chart link')).toBeInTheDocument()
  })

  it('clicking a destination sends the SAME frozen capture with the typed comment, then closes', async () => {
    const onClose = vi.fn()
    const onSent = vi.fn()
    const capture = { symbol: 'AMD', tf: '5' }
    render(
      <CaptureMenu open onClose={onClose} onSent={onSent} anchor={{ x: 0, y: 0 }}
        widgetId="chart" capture={capture} label="AMD" />,
    )
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), { target: { value: 'watching for a breakout' } })
    fireEvent.click(screen.getByText('New entry'))

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock).toHaveBeenCalledWith('chart', capture, {
      label: 'AMD', target: 'newNote', comment: 'watching for a breakout', tradeRef: undefined,
    })
    expect(onSent).toHaveBeenCalledWith('AMD sent to “Tuesday”')
    expect(onClose).toHaveBeenCalled()
  })

  it('an empty/whitespace-only comment is sent as undefined, not a blank string', async () => {
    render(
      <CaptureMenu open onClose={() => {}} anchor={{ x: 0, y: 0 }}
        widgetId="chart" capture={{ symbol: 'AMD' }} label="AMD" />,
    )
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Notebook inbox'))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock.mock.calls[0][2].comment).toBeUndefined()
  })

  it('a tradeRef passed to the menu rides along to whichever destination is chosen', async () => {
    render(
      <CaptureMenu open onClose={() => {}} anchor={{ x: 0, y: 0 }}
        widgetId="chart" capture={{ symbol: 'AMD' }} label="AMD" tradeRef="trade_42" />,
    )
    fireEvent.click(screen.getByText('Notebook inbox'))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock.mock.calls[0][2].tradeRef).toBe('trade_42')
  })

  it('a stale comment does NOT survive into the next, unrelated capture', async () => {
    // The real host (TradeDetailPage, every widget door) renders <CaptureMenu>
    // UNCONDITIONALLY and toggles `open` — this component instance never
    // unmounts between captures. Caught by real browser E2E (2026-09-05):
    // typing a comment on one capture, sending it, then opening the picker
    // again for a DIFFERENT symbol/widget silently resent the FIRST comment,
    // because `useState('')` only initializes once for a component that never
    // remounts. Simulated here the same way — one instance, toggled via
    // rerender — rather than mounting a fresh instance per open, which would
    // pass trivially without proving the fix.
    const { rerender } = render(
      <CaptureMenu open onClose={() => {}} anchor={{ x: 0, y: 0 }}
        widgetId="chart" capture={{ symbol: 'AMD' }} label="AMD" />,
    )
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), { target: { value: 'stale note about AMD' } })
    fireEvent.click(screen.getByText('Notebook inbox'))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))

    // Close (open=false — the host's onClose already did this in real usage).
    rerender(
      <CaptureMenu open={false} onClose={() => {}} anchor={{ x: 0, y: 0 }}
        widgetId="chart" capture={{ symbol: 'AMD' }} label="AMD" />,
    )
    // Reopen for a DIFFERENT capture entirely.
    rerender(
      <CaptureMenu open onClose={() => {}} anchor={{ x: 0, y: 0 }}
        widgetId="chart" capture={{ symbol: 'MSFT' }} label="MSFT" />,
    )
    expect(screen.getByPlaceholderText(/add a comment/i)).toHaveValue('')

    fireEvent.click(screen.getByText('Notebook inbox'))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2))
    expect(sendMock.mock.calls[1][2].comment).toBeUndefined()
  })

})
