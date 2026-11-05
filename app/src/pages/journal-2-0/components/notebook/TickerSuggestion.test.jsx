// Audit 2026-11-05, spec S2: a blank note no longer inherits the last-charted symbol (B1). Instead,
// once the body names the same `$TICKER` twice, the note OFFERS to link it: "Link this note to
// $NVDA?" [Link] [No]. Link sets the ticker through the editor's own ticker door; No hides the
// offer for this note, remembered on this device.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import TickerSuggestion, { suggestedTicker, TICKER_SUGGEST_DISMISS_KEY } from './TickerSuggestion'

// The smallest editor the component reads: getText() and on/off('update').
function fakeEditor(text) {
  const handlers = new Set()
  return {
    text,
    isDestroyed: false,
    getText() { return this.text },
    on(evt, fn) { if (evt === 'update') handlers.add(fn) },
    off(evt, fn) { if (evt === 'update') handlers.delete(fn) },
    type(next) { this.text = next; handlers.forEach((fn) => fn()) },
  }
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('suggestedTicker', () => {
  it('a $TICKER named twice is suggested; once is not', () => {
    expect(suggestedTicker('Watching $NVDA into earnings. $NVDA held the 50.')).toBe('NVDA')
    expect(suggestedTicker('Watching $NVDA into earnings.')).toBeNull()
  })

  it('the first symbol to reach two mentions wins, and a bare word never counts', () => {
    expect(suggestedTicker('$AMD $NVDA $NVDA $AMD')).toBe('NVDA')
    expect(suggestedTicker('NVDA NVDA NVDA')).toBeNull()
    expect(suggestedTicker('')).toBeNull()
  })
})

describe('TickerSuggestion', () => {
  const mount = (editor, props = {}) => render(
    <TickerSuggestion editor={editor} noteId="n1" ticker={null} onLink={vi.fn()} {...props} />,
  )

  it('says nothing until the body names a symbol twice, then offers it', () => {
    const editor = fakeEditor('Plain words.')
    mount(editor)
    expect(screen.queryByRole('group', { name: 'Ticker suggestion' })).toBeNull()
    act(() => { editor.type('$NVDA looks tight. $NVDA again.'); vi.advanceTimersByTime(500) })
    const offer = screen.getByRole('group', { name: 'Ticker suggestion' })
    expect(offer).toHaveTextContent('Link this note to $NVDA?')
  })

  it('Link sets the ticker through the given door', () => {
    const onLink = vi.fn(() => Promise.resolve())
    mount(fakeEditor('$NVDA and $NVDA'), { onLink })
    fireEvent.click(screen.getByRole('button', { name: 'Link note to $NVDA' }))
    expect(onLink).toHaveBeenCalledWith('NVDA')
  })

  it('No hides it for this note, and it stays hidden on the next mount', () => {
    const editor = fakeEditor('$NVDA and $NVDA')
    mount(editor)
    fireEvent.click(screen.getByRole('button', { name: "No, don't link" }))
    expect(screen.queryByRole('group', { name: 'Ticker suggestion' })).toBeNull()
    expect(localStorage.getItem(`${TICKER_SUGGEST_DISMISS_KEY}n1`)).toBe('1')
    cleanup()
    mount(editor)
    expect(screen.queryByRole('group', { name: 'Ticker suggestion' })).toBeNull()
    // Another note is still asked.
    cleanup()
    render(<TickerSuggestion editor={editor} noteId="n2" ticker={null} onLink={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Ticker suggestion' })).toBeInTheDocument()
  })

  it('a note that already has a ticker, or a locked note, is never asked', () => {
    mount(fakeEditor('$NVDA and $NVDA'), { ticker: 'AMD' })
    expect(screen.queryByRole('group', { name: 'Ticker suggestion' })).toBeNull()
    cleanup()
    mount(fakeEditor('$NVDA and $NVDA'), { readOnly: true })
    expect(screen.queryByRole('group', { name: 'Ticker suggestion' })).toBeNull()
  })
})

// Fix round 1 (review minor 10): the offer appeared silently while the member wrote, and its
// buttons were named "Link" and "No" out of context.
describe('TickerSuggestion for a screen reader (fix round 1)', () => {
  it('the offer is announced through a polite status region that is there before it appears', () => {
    const editor = fakeEditor('Plain words.')
    render(<TickerSuggestion editor={editor} noteId="n1" ticker={null} onLink={vi.fn()} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')
    act(() => { editor.type('$NVDA looks tight. $NVDA again.'); vi.advanceTimersByTime(500) })
    expect(screen.getByRole('status')).toHaveTextContent('Link this note to $NVDA?')
  })

  it('the buttons say what they do', () => {
    render(<TickerSuggestion editor={fakeEditor('$NVDA and $NVDA')} noteId="n1" ticker={null} onLink={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Link note to $NVDA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "No, don't link" })).toBeInTheDocument()
  })
})
