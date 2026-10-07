// app/src/components/provenance/AbsenceReceipt.test.jsx
//
// TERM-057 -- the "why isn't X here" receipt, asserted by RENDERED TEXT. The
// state a member cannot see is not tested here; the sentence they read is.
//
// ⛔ The load-bearing pair: `not_evaluated` and `excluded_by_gate` must read as
// two different facts. Collapse them (render one with the other's words) and
// the first describe block goes red.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import AbsenceReceipt, { describeAbsence, describeFailure } from './AbsenceReceipt'
import { CATALYST_TAG_DISPLAY_ORDER } from '../../lib/taxonomy/a8Taxonomy'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const json = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) })

function stubExplain(respond) {
  const fn = vi.fn((url) => respond(String(url)))
  vi.stubGlobal('fetch', fn)
  return fn
}

async function checkFixed(sym, body, opts = {}) {
  stubExplain(() => (typeof body === 'function' ? body() : json(body)))
  render(<AbsenceReceipt ticker={sym} {...opts} />)
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  return screen.getByTestId('absence-receipt')
}

const NOT_EVALUATED = { ticker: 'ZZZZ', found: false, verdict: 'not_evaluated', pool_size: 41, market_date: '2026-09-29' }
const EXCLUDED = {
  ticker: 'PENY', found: true, excluded_by_gate: true, verdict: 'excluded_by_gate',
  gate: 'quality', gate_reason: 'price $1.20 below $3 floor', market_date: '2026-09-29',
  // market_cap is a WHOLE number on purpose: the S8 rail's fix (routing fmtSignal
  // through formatNumberMax) must never pad it to "100.00" -- see the exact-text
  // assertion below.
  signal_summary: { price: 1.2, gap_pct: 12.5, sector: 'Tech', market_cap: 100 },
}

describe('"not evaluated" is never rendered as "excluded"', () => {
  it('a name no source surfaced reads NOT EVALUATED, and the word "excluded" appears nowhere', async () => {
    const receipt = await checkFixed('ZZZZ', NOT_EVALUATED)
    expect(receipt).toHaveAttribute('data-kind', 'not_evaluated')
    expect(screen.getByTestId('absence-receipt-headline')).toHaveTextContent('ZZZZ was not evaluated today.')
    expect(screen.getByTestId('absence-receipt-detail')).toHaveTextContent('it was never looked at')
    expect(receipt.textContent).not.toMatch(/exclud/i)
  })

  it('a gate exclusion reads EXCLUDED, names the gate, and quotes the gate', async () => {
    const receipt = await checkFixed('PENY', EXCLUDED)
    expect(receipt).toHaveAttribute('data-kind', 'excluded_by_gate')
    expect(screen.getByTestId('absence-receipt-headline')).toHaveTextContent('PENY was excluded by the tradeability gate.')
    expect(screen.getByTestId('absence-receipt-detail')).toHaveTextContent("The gate's reason: price $1.20 below $3 floor.")
    expect(receipt.textContent).not.toMatch(/not evaluated/i)
  })

  it('the two verdicts produce different sentences for the same ticker', () => {
    const a = describeAbsence({ ...NOT_EVALUATED, ticker: 'SAME' })
    const b = describeAbsence({ ...EXCLUDED, ticker: 'SAME' })
    expect(a.kind).not.toBe(b.kind)
    expect(a.headline).not.toBe(b.headline)
  })

  it('an empty pull is still NOT EVALUATED, and says the pull was empty', () => {
    const d = describeAbsence({ ticker: 'NVDA', verdict: 'not_evaluated', pool_size: 0 })
    expect(d.headline).toBe('NVDA was not evaluated today.')
    expect(d.detail).toMatch(/No catalyst source returned anything on this check/)
    expect(`${d.headline} ${d.detail}`).not.toMatch(/exclud/i)
  })
})

describe('each cause says which', () => {
  it('the activity gate is named as the activity gate', () => {
    const d = describeAbsence({ ...EXCLUDED, gate: 'real_catalyst', gate_reason: 'no real move' })
    expect(d.headline).toBe('PENY was excluded by the activity gate.')
    expect(d.detail).toMatch(/a real move, a volume surge, or a hard catalyst/)
  })

  it('a quota exclusion names the bucket, its slots, and the rank inside it', async () => {
    await checkFixed('GXX', {
      ticker: 'GXX', found: true, verdict: 'quota_full', tag: 'Gapper',
      quota: { tag: 'Gapper', slots: 3, rank_in_tag: 7, in_tag: 7 },
      rank_among_scored: 27, total_scored: 30, score: 12.345,
    })
    expect(screen.getByTestId('absence-receipt-headline'))
      .toHaveTextContent("GXX missed today's catalyst list because the Gapper bucket was full.")
    expect(screen.getByTestId('absence-receipt-detail'))
      .toHaveTextContent('The list takes 3 Gapper names. GXX ranked 7 of 7 Gapper names by score.')
    expect(screen.getByText(/Score on this check: 12\.35 · Rank among scored names: 27 of 30/)).toBeInTheDocument()
  })

  it('no qualifying signal lists the catalyst tags from the A8 vocabulary, not a copy', () => {
    const d = describeAbsence({ ticker: 'QUIET', verdict: 'no_qualifying_signal' })
    expect(d.headline).toBe('QUIET had no qualifying signal today.')
    expect(d.detail).toContain(CATALYST_TAG_DISPLAY_ORDER.join(', '))
  })

  it('on the list says so, with its rank', () => {
    const d = describeAbsence({ ticker: 'ONL', verdict: 'on_list', list_rank: 4 })
    expect(d.headline).toBe("ONL is on today's catalyst list, at #4.")
  })

  it('a curator cut, a not-picked name and a qualifies-now name read as three different facts', () => {
    const cut = describeAbsence({ ticker: 'X', verdict: 'cut_by_curator', tag: 'News' })
    const ns = describeAbsence({ ticker: 'X', verdict: 'not_selected', tag: 'News' })
    const qn = describeAbsence({ ticker: 'X', verdict: 'qualifies_now', tag: 'News' })
    expect(cut.headline).toBe('X was cut by the curator.')
    expect(ns.headline).toBe("X scored but was not picked for today's catalyst list.")
    expect(qn.headline).toBe('X qualifies on this check but is not on the list yet.')
    expect(ns.detail).toMatch(/No single gate or quota removed it/)
  })

  it('an older server without a verdict is shown in its own words, never guessed', () => {
    const d = describeAbsence({ ticker: 'OLD', found: true, reason: 'On today\'s list.' })
    expect(d.kind).toBe('unclassified')
    expect(d.headline).toBe('The engine did not classify why OLD is absent.')
    expect(d.detail).toBe("In the engine's own words: On today's list.")
  })
})

describe('a failed check is not an answer', () => {
  it('an HTTP error says it failed and that it says nothing about the list', async () => {
    const receipt = await checkFixed('NVDA', () => json({ detail: 'boom' }, false, 500))
    expect(receipt).toHaveAttribute('data-kind', 'failed')
    expect(screen.getByTestId('absence-receipt-headline')).toHaveTextContent('Could not check NVDA right now: the service hit an error.')
    expect(receipt.textContent).toMatch(/not an answer about the list/)
    expect(receipt.textContent).not.toMatch(/not evaluated|exclud/i)
  })

  it('a network error says so too', () => {
    expect(describeFailure('NVDA', null).headline).toBe('Could not check NVDA right now: the connection did not go through.')
    // tq-panels: never a raw status code
    expect(describeFailure('NVDA', 503).headline).toBe('Could not check NVDA right now: the service is busy or restarting.')
    expect(describeFailure('NVDA', 503).headline).not.toMatch(/HTTP|503/)
  })

  it('an invalid ticker is refused before any request', async () => {
    const fn = stubExplain(() => json({}))
    render(<AbsenceReceipt />)
    fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: '???' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
    expect(screen.getByTestId('absence-receipt-headline')).toHaveTextContent('Enter a ticker, e.g. NVDA or BRK.B.')
    expect(fn).not.toHaveBeenCalled()
  })

  it('a genuinely empty input is still refused and still prompts for a ticker (no regression)', async () => {
    const fn = stubExplain(() => json({}))
    render(<AbsenceReceipt />)
    // input starts empty; click Check with nothing typed
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
    expect(screen.getByTestId('absence-receipt-headline')).toHaveTextContent('Enter a ticker, e.g. NVDA or BRK.B.')
    expect(fn).not.toHaveBeenCalled()
  })

  it('dual-class tickers (BRK.B, BF.B) pass validation and reach the explain route', async () => {
    const fn = stubExplain(() => json({ ...NOT_EVALUATED, ticker: 'BRK.B' }))
    render(<AbsenceReceipt />)
    fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: 'BRK.B' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
    expect(fn).toHaveBeenCalledWith('/api/catalysts/explain/BRK.B')
    expect(screen.queryByText('Enter a ticker, e.g. NVDA or BRK.B.')).toBeNull()

    cleanup()
    const fn2 = stubExplain(() => json({ ...NOT_EVALUATED, ticker: 'BF.B' }))
    render(<AbsenceReceipt />)
    fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: 'BF.B' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
    expect(fn2).toHaveBeenCalledWith('/api/catalysts/explain/BF.B')
    expect(screen.queryByText('Enter a ticker, e.g. NVDA or BRK.B.')).toBeNull()
  })

  it('hyphenated dual-class form (BRK-B) also passes validation', async () => {
    const fn = stubExplain(() => json({ ...NOT_EVALUATED, ticker: 'BRK-B' }))
    render(<AbsenceReceipt />)
    fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: 'BRK-B' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
    expect(fn).toHaveBeenCalledWith('/api/catalysts/explain/BRK-B')
    expect(screen.queryByText('Enter a ticker, e.g. NVDA or BRK.B.')).toBeNull()
  })
})

describe('the free-text lookup and its feedback host', () => {
  it('asks the explain route for the typed ticker and renders the receipt', async () => {
    const fn = stubExplain(() => json(NOT_EVALUATED))
    render(<AbsenceReceipt collapsible />)
    fireEvent.click(screen.getByRole('button', { name: /Why isn't X on the list\?/ }))
    fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: 'zzzz' } })
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Ticker to check'), { key: 'Enter' }) })
    expect(fn).toHaveBeenCalledWith('/api/catalysts/explain/ZZZZ')
    expect(screen.getByTestId('absence-receipt-headline')).toHaveTextContent('ZZZZ was not evaluated today.')
  })

  it('the host outlives the control that triggers it: the SAME live region before, during and after', async () => {
    stubExplain(() => json(EXCLUDED))
    render(<AbsenceReceipt collapsible />)
    const host = screen.getByTestId('absence-receipt-host')
    expect(host).toHaveAttribute('role', 'status')
    expect(host).toHaveAttribute('aria-live', 'polite')

    const toggle = screen.getByRole('button', { name: /Why isn't X on the list\?/ })
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: 'PENY' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
    expect(screen.getByTestId('absence-receipt-host')).toBe(host)
    expect(host).toHaveTextContent('PENY was excluded by the tradeability gate.')

    // Closing the panel removes the input and the Check button; the host stays mounted.
    fireEvent.click(screen.getByRole('button', { name: 'Close lookup' }))
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull()
    expect(screen.getByTestId('absence-receipt-host')).toBe(host)
  })

  it('the fixed-ticker door names the ticker and the list, then offers a re-check', async () => {
    await checkFixed('NVDA', NOT_EVALUATED)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.getByText(/Source: UCT Catalyst Engine, checked against today's catalyst list \(2026-09-29\)\./)).toBeInTheDocument()
  })

  it('signals render as labelled values, never as raw JSON', async () => {
    await checkFixed('PENY', EXCLUDED)
    const sig = screen.getByTestId('absence-receipt-signals')
    expect(sig).toHaveTextContent('Gap %12.5')
    expect(sig).toHaveTextContent('SectorTech')
    expect(sig.textContent).not.toMatch(/[{}"]/)
  })

  it('a whole-number signal is never padded with trailing zeros ("100", not "100.00")', async () => {
    // ⛔ `toHaveTextContent` does a substring match, so it would pass on
    // "100.00" too -- this checks the ACTUAL cell text, which the S8 rail's fix
    // (fmtSignal -> formatNumberMax, max-only decimals) must keep byte-identical
    // to the retired direct `.toLocaleString('en-US', {maximumFractionDigits:2})`.
    await checkFixed('PENY', EXCLUDED)
    const sig = screen.getByTestId('absence-receipt-signals')
    const dd = [...sig.querySelectorAll('dt')]
      .find((dt) => dt.textContent === 'Market cap')
      ?.nextElementSibling
    expect(dd?.textContent).toBe('100')
  })
})
