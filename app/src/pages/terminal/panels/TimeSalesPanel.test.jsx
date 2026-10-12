// TAS: rendered text and real behaviour against a fake EventSource (the stream is the only thing
// faked; nothing on the panel's own path is mocked).
//   * the snapshot renders newest first, with ET time, price, size and the tick word;
//   * a later batch is merged on top, never duplicated, and the list is capped;
//   * large and block prints are emphasised and labelled;
//   * a closed market with prints says "Market closed — last session's prints"; with none, "No prints yet";
//   * the server's `unavailable` (flag off) is said in words and the stream is closed, not retried;
//   * a refused request is an error with Retry, never "no trades";
//   * the stream closes on unmount and while the tab is hidden;
//   * the registry: `NVDA TAS` resolves to this panel.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, within, fireEvent } from '@testing-library/react'

import TimeSalesPanel, { tasStreamUrl } from './TimeSalesPanel'
import { mergePrints, tickOf, sessionLine, sizeLabel, printTimeEt, TAS_CAP, unavailableText } from './timeSalesModel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

class FakeEventSource {
  static all = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    this.closed = false
    this.onmessage = null
    this.onerror = null
    FakeEventSource.all.push(this)
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  close() { this.closed = true; this.readyState = 2 }
  emit(name, data) {
    const e = { data: JSON.stringify(data) }
    act(() => {
      this.readyState = 1
      if (name === 'message') this.onmessage?.(e)
      else (this.listeners[name] || []).forEach((fn) => fn(e))
    })
  }
  fail(readyState) { act(() => { this.readyState = readyState; this.onerror?.({}) }) }
}

const P = (seq, p, s, d = 'up', extra = {}) => ({ seq, t: Date.UTC(2026, 9, 12, 14, 30, seq), p, s, d, b: 0, o: 0, c: [], ...extra })
const last = () => FakeEventSource.all[FakeEventSource.all.length - 1]
const realES = globalThis.EventSource

beforeEach(() => { FakeEventSource.all = []; globalThis.EventSource = FakeEventSource })
afterEach(() => { cleanup(); globalThis.EventSource = realES })

describe('timeSalesModel', () => {
  it('merges newest first, deduplicates by seq and caps', () => {
    const a = mergePrints([], [P(1, 10, 100), P(2, 10.01, 100)])
    expect(a.map((r) => r.seq)).toEqual([2, 1])
    const b = mergePrints(a, [P(2, 10.01, 100), P(3, 10.02, 100)])
    expect(b.map((r) => r.seq)).toEqual([3, 2, 1])
    const many = Array.from({ length: TAS_CAP + 10 }, (_, i) => P(i + 1, 10, 100))
    const c = mergePrints([], many)
    expect(c).toHaveLength(TAS_CAP)
    expect(c[0].seq).toBe(TAS_CAP + 10)
  })
  it('labels the tick test as ticks, never as bid or ask', () => {
    expect(tickOf('up').label).toBe('Uptick')
    expect(tickOf('zdown').label).toBe('Zero downtick')
    expect(tickOf('').tone).toBe('')
    const words = ['up', 'down', 'zup', 'zdown', ''].map((d) => tickOf(d).label.toLowerCase()).join(' ')
    expect(words).not.toMatch(/\b(bid|ask|buy|sell)\b/)
  })
  it('says what the session is', () => {
    expect(sessionLine('closed', true)).toBe("Market closed — last session's prints.")
    expect(sessionLine('closed', false)).toBe('Market closed.')
    expect(sessionLine('regular', true)).toMatch(/open/)
  })
  it('names the size tiers and formats ET time', () => {
    expect(sizeLabel(2)).toMatch(/Block/)
    expect(sizeLabel(1)).toMatch(/Large/)
    expect(sizeLabel(0)).toBe('')
    expect(printTimeEt(Date.UTC(2026, 9, 12, 14, 30, 5))).toBe('10:30:05')
  })
  it('explains every refusal reason', () => {
    for (const r of ['off', 'feed_off', 'symbol_cap', 'at_capacity', 'user_cap', 'weird']) {
      expect(unavailableText(r).title.length).toBeGreaterThan(10)
    }
    expect(unavailableText('off').title).toBe('Time & Sales is not switched on yet.')
  })
})

describe('TimeSalesPanel', () => {
  it('opens ONE stream on the ticker and renders the snapshot newest first', () => {
    render(<TimeSalesPanel sym="nvda" />)
    expect(FakeEventSource.all).toHaveLength(1)
    expect(last().url).toBe('/api/stream/time-and-sales/NVDA')
    expect(tasStreamUrl('BRK-B')).toBe('/api/stream/time-and-sales/BRK-B')
    expect(screen.getByTestId('terminal-tas-loading')).toBeTruthy()
    last().emit('snapshot', { sym: 'NVDA', session: 'regular', method: 'tick', cap: 200, seq: 2,
      prints: [P(1, 120.5, 300, ''), P(2, 120.55, 1200, 'up')] })
    const rows = within(screen.getByTestId('terminal-tas-table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['terminal-tas-row-2', 'terminal-tas-row-1'])
    expect(rows[0].textContent).toContain('10:30:02')
    expect(rows[0].textContent).toContain('120.55')
    expect(rows[0].textContent).toContain('1,200')
    expect(rows[0].textContent).toContain('Uptick')
    expect(screen.getByTestId('terminal-tas-session').textContent).toBe('Market open. Prints stream live.')
    expect(screen.getByTestId('terminal-tas-method').textContent).toMatch(/not the bid or the ask/)
  })

  it('merges a pushed batch on top without duplicating', () => {
    render(<TimeSalesPanel sym="NVDA" />)
    last().emit('snapshot', { session: 'regular', prints: [P(1, 10, 100)] })
    last().emit('message', { session: 'regular', seq: 3, prints: [P(1, 10, 100), P(2, 9.99, 100, 'down'), P(3, 9.99, 100, 'zdown')] })
    const rows = within(screen.getByTestId('terminal-tas-table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['terminal-tas-row-3', 'terminal-tas-row-2', 'terminal-tas-row-1'])
    expect(rows[0].textContent).toContain('Zero downtick')
    expect(screen.getByTestId('terminal-tas-counts').textContent).toContain('3 prints shown')
  })

  it('emphasises large and block prints and labels them', () => {
    render(<TimeSalesPanel sym="NVDA" />)
    last().emit('snapshot', { session: 'regular', prints: [
      P(1, 100, 100), P(2, 100, 2500, 'up', { b: 1 }), P(3, 100, 12000, 'up', { b: 2 }), P(4, 100, 40, 'zup', { o: 1 }),
    ] })
    expect(screen.getByTestId('terminal-tas-row-3').getAttribute('data-size-tier')).toBe('2')
    expect(screen.getByTestId('terminal-tas-row-3').textContent).toContain('BLOCK')
    expect(screen.getByTestId('terminal-tas-row-2').getAttribute('data-size-tier')).toBe('1')
    expect(screen.getByTestId('terminal-tas-row-2').textContent).toContain('LARGE')
    expect(screen.getByTestId('terminal-tas-row-1').getAttribute('data-size-tier')).toBe('0')
    expect(screen.getByTestId('terminal-tas-row-4').textContent).toContain('odd')
    expect(screen.getByTestId('terminal-tas-counts').textContent).toContain('1 large and 1 block')
  })

  it("says the market is closed and shows last session's prints", () => {
    render(<TimeSalesPanel sym="NVDA" />)
    last().emit('snapshot', { session: 'closed', prints: [P(1, 10, 100)] })
    expect(screen.getByTestId('terminal-tas-session').textContent).toBe("Market closed — last session's prints.")
    expect(screen.getByTestId('terminal-tas-table')).toBeTruthy()
  })

  it('says "No prints yet" when closed with an empty buffer, and waits when open', () => {
    render(<TimeSalesPanel sym="NVDA" />)
    last().emit('snapshot', { session: 'closed', prints: [] })
    expect(screen.getByTestId('terminal-tas-empty').textContent).toContain('No prints yet.')
    cleanup()
    render(<TimeSalesPanel sym="AMD" />)
    last().emit('snapshot', { session: 'regular', prints: [] })
    expect(screen.getByTestId('terminal-tas-empty').textContent).toContain('Waiting for the first print in AMD.')
  })

  it('says the tape is off when the server refuses, and closes the stream for good', () => {
    render(<TimeSalesPanel sym="NVDA" />)
    const es = last()
    es.emit('unavailable', { reason: 'off' })
    expect(screen.getByTestId('terminal-tas-unavailable').textContent).toContain('Time & Sales is not switched on yet.')
    expect(es.closed).toBe(true)
    expect(FakeEventSource.all).toHaveLength(1)
  })

  it('a refused request (status 401 / 402 closes the EventSource) is an error with Retry, never "no trades"; Retry opens a new stream', () => {
    render(<TimeSalesPanel sym="NVDA" />)
    // The browser's answer to a non-2xx response ({ status: 401 } signed out, 402 unpaid): the
    // EventSource goes CLOSED (readyState 2) and fires error, and never retries by itself.
    last().fail(2)
    const err = screen.getByTestId('terminal-tas-error')
    expect(err.textContent).toContain('Could not open the live tape for NVDA.')
    expect(err.textContent).toContain('not the same as no trades')
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(FakeEventSource.all).toHaveLength(2)
  })

  it('a dropped connection keeps the rows and says it is reconnecting', () => {
    render(<TimeSalesPanel sym="NVDA" />)
    last().emit('snapshot', { session: 'regular', prints: [P(1, 10, 100)] })
    last().fail(0)
    expect(screen.getByTestId('terminal-tas-link').textContent).toBe('Reconnecting…')
    expect(screen.getByTestId('terminal-tas-row-1')).toBeTruthy()
  })

  it('closes the stream on unmount and on a ticker change', () => {
    const { rerender, unmount } = render(<TimeSalesPanel sym="NVDA" />)
    const first = last()
    rerender(<TimeSalesPanel sym="AMD" />)
    expect(first.closed).toBe(true)
    expect(last().url).toBe('/api/stream/time-and-sales/AMD')
    unmount()
    expect(last().closed).toBe(true)
  })

  it('holds no stream while the tab is hidden, and reopens when it is shown', () => {
    const vis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    let state = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    try {
      render(<TimeSalesPanel sym="NVDA" />)
      last().emit('snapshot', { session: 'regular', prints: [P(1, 10, 100)] })
      const first = last()
      state = 'hidden'
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(first.closed).toBe(true)
      expect(screen.getByTestId('terminal-tas-link').textContent).toBe('Paused while this tab is hidden')
      expect(FakeEventSource.all).toHaveLength(1)
      state = 'visible'
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(FakeEventSource.all).toHaveLength(2)
      expect(last().closed).toBe(false)
    } finally {
      delete document.visibilityState
      if (vis) Object.defineProperty(Document.prototype, 'visibilityState', vis)
    }
  })

  it('needs a ticker and opens nothing without one', () => {
    render(<TimeSalesPanel sym="" />)
    expect(screen.getByText('TAS needs a ticker.')).toBeTruthy()
    expect(FakeEventSource.all).toHaveLength(0)
  })
})

describe('the registry', () => {
  it('NVDA TAS resolves to the TimeSales panel', () => {
    expect(BY_CODE.TAS.group).toBe('Security')
    expect(variantFor('TAS', true).variant.panel).toBe('TimeSales')
    expect(variantFor('TAS', false).variant).toBe(null)
    expect(typeof PANEL_IMPORTERS.TimeSales).toBe('function')
  })
})
