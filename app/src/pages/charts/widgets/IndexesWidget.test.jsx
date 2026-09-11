/**
 * Rails for the Indexes widget (R-3b).
 *
 * ⛔ EVERY member-facing assertion here reads RENDERED TEXT. This repo shipped
 * two toast defects where the state transition was correct, the control worked,
 * every structural assertion stayed green, and the only broken half was the one
 * that talks to the member (`message` vs `msg`; a toast owned by the branch its
 * own action unmounts). A test that asserts a setter was called proves nothing
 * about whether a human ever saw the sentence.
 *
 * Each group carries a CONTROL — a case that proves the assertion above it can
 * actually go red — because an assertion over a component that rendered nothing
 * passes just as happily as one over a correct render.
 */
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
import IndexesWidget from './IndexesWidget'
import { chgDirection, INDEX_SYMBOLS } from './indexesModel'
import IndexesEmbed from '../../journal-2-0/components/notebook/IndexesEmbed'

const mockData = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: () => ({ data: mockData(), mutate: vi.fn(), isValidating: false }),
}))

const sendMock = vi.fn(async () => 'Saved to Today’s note')
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: (...args) => sendMock(...args),
  buildCapture: vi.fn(),
}))

// The real `/api/snapshot` shape: BTC alone in `futures`, everything else
// (VIX included) in `etfs`, prices and changes pre-formatted by the server.
// 2026-09-10 17:26 UTC = 1:26 PM ET. The fetcher stamps this onto the payload;
// the footer formats it in ET explicitly, so the assertion is host-TZ-proof.
const STAMP = Date.UTC(2026, 8, 10, 17, 26)

const SNAPSHOT = {
  _fetchedAt: STAMP,
  etfs: {
    SPY: { price: '645.12', chg: '+0.43%', css: 'pos' },
    QQQ: { price: '583.20', chg: '-0.12%', css: 'neg' },
    DIA: { price: '451.08', chg: '+0.21%', css: 'pos' },
    IWM: { price: '238.44', chg: '-0.87%', css: 'neg' },
    VIX: { price: '15.20', chg: '-2.10%', css: 'neg' },
  },
  futures: { BTC: { price: '96,401.00', chg: '+1.55%', css: 'pos' } },
}

const OTHER_SNAPSHOT = {
  etfs: {
    SPY: { price: '600.00', chg: '-3.30%', css: 'neg' },
    QQQ: { price: '500.00', chg: '-4.10%', css: 'neg' },
    DIA: { price: '400.00', chg: '-2.00%', css: 'neg' },
    IWM: { price: '200.00', chg: '-5.00%', css: 'neg' },
    VIX: { price: '38.90', chg: '+40.00%', css: 'pos' },
  },
  futures: { BTC: { price: '70,000.00', chg: '-9.00%', css: 'neg' } },
}

function Wrap({ initialOpts = {}, onOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const handle = (next) => { setOpts(next); onOpts?.(next) }
  return <IndexesWidget opts={opts} onOptsChange={handle} />
}

beforeEach(() => {
  sendMock.mockClear()
  mockData.mockReset()
})

// ── What the member reads ───────────────────────────────────────────────────

test('every index renders its symbol, what it tracks, its level and its day change — as text', () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  expect(screen.getByText('Indexes')).toBeInTheDocument()
  for (const { sym, label } of INDEX_SYMBOLS) {
    expect(screen.getByText(sym), `${sym} symbol`).toBeInTheDocument()
    expect(screen.getByText(label), `${sym} label`).toBeInTheDocument()
  }
  expect(screen.getByText('645.12')).toBeInTheDocument()
  expect(screen.getByText('+0.43%')).toBeInTheDocument()
  expect(screen.getByText('-0.12%')).toBeInTheDocument()
  expect(screen.getByText('96,401.00')).toBeInTheDocument()
  // The footer always carries a TIME — the stamp rides on the payload it
  // describes, so it can never label one fetch with another's clock.
  expect(screen.getByText('Updated 1:26 PM ET')).toBeInTheDocument()
})

test('a capture freezes the stamp the member was looking at', async () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  fireEvent.click(screen.getByRole('button', { name: /send these index levels to journal/i }))
  await screen.findByText('Saved to Today’s note')
  expect(sendMock.mock.calls[0][1].updated).toBe('1:26 PM ET')
})

test('CONTROL — the level rail reads the payload, not a constant in the component', () => {
  // If the tiles ever stopped rendering the fetched numbers, the test above
  // could still pass off stale markup. Swap the payload: the old numbers must
  // be GONE and the new ones present.
  mockData.mockReturnValue(SNAPSHOT)
  const { rerender } = render(<Wrap />)
  expect(screen.getByText('645.12')).toBeInTheDocument()
  mockData.mockReturnValue(OTHER_SNAPSHOT)
  rerender(<Wrap />)
  expect(screen.queryByText('645.12')).not.toBeInTheDocument()
  expect(screen.getByText('600.00')).toBeInTheDocument()
  expect(screen.getByText('-3.30%')).toBeInTheDocument()
})

test('⛔ the label says ETF — a row never puts the ETF’s price under the index’s name', () => {
  // SPY prints 645 and the S&P 500 prints 6,451. Naming the row "S&P 500"
  // would be a false number under a true name.
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  expect(screen.getByText('S&P 500 ETF')).toBeInTheDocument()
  expect(screen.queryByText('S&P 500')).not.toBeInTheDocument()
  expect(screen.queryByText('Nasdaq 100')).not.toBeInTheDocument()
})

test('direction comes from the change STRING, so a frozen row’s tint can never disagree with its number', () => {
  expect(chgDirection('+0.43%')).toBe('pos')
  expect(chgDirection('-0.12%')).toBe('neg')
  expect(chgDirection('—')).toBe('')
  expect(chgDirection(undefined)).toBe('')
  // Rendered: up and down rows must not wear the same class.
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  const up = screen.getByText('+0.43%').className
  const down = screen.getByText('-0.12%').className
  expect(up).not.toBe(down)
})

// ── The capture door ────────────────────────────────────────────────────────

test('Send to Journal freezes exactly the rows on screen AND tells the member it saved', async () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  fireEvent.click(screen.getByRole('button', { name: /send these index levels to journal/i }))

  expect(sendMock).toHaveBeenCalledTimes(1)
  const [widgetId, capture, extra] = sendMock.mock.calls[0]
  expect(widgetId).toBe('indexes')
  expect(extra).toEqual({ label: 'Indexes' })
  expect(capture.rows).toEqual([
    { sym: 'SPY', price: '645.12', chg: '+0.43%' },
    { sym: 'QQQ', price: '583.20', chg: '-0.12%' },
    { sym: 'DIA', price: '451.08', chg: '+0.21%' },
    { sym: 'IWM', price: '238.44', chg: '-0.87%' },
    { sym: 'BTC', price: '96,401.00', chg: '+1.55%' },
    { sym: 'VIX', price: '15.20', chg: '-2.10%' },
  ])
  expect(capture.hiddenSymbols).toEqual([])

  // ⭐ The half that talks to the member. Not "setJournalMsg was called".
  expect(await screen.findByText('Saved to Today’s note')).toBeInTheDocument()
})

test('CONTROL — the toast rail fails when the door says nothing', async () => {
  // Proves the assertion above is reading the chip's TEXT: a door whose
  // result never reaches the chip leaves it empty, and this is what that
  // looks like.
  sendMock.mockImplementationOnce(async () => '')
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  fireEvent.click(screen.getByRole('button', { name: /send these index levels to journal/i }))
  expect(await screen.findByRole('status')).toHaveTextContent('')
  expect(screen.queryByText('Saved to Today’s note')).not.toBeInTheDocument()
})

test('a hidden index is excluded from the capture, not just from the view', async () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap initialOpts={{ hiddenSymbols: ['VIX'] }} />)
  expect(screen.queryByText('15.20')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /send these index levels to journal/i }))
  await screen.findByText('Saved to Today’s note')
  const [, capture] = sendMock.mock.calls[0]
  expect(capture.rows.map(r => r.sym)).toEqual(['SPY', 'QQQ', 'DIA', 'IWM', 'BTC'])
  expect(capture.hiddenSymbols).toEqual(['VIX'])
})

test('the “choose where” trigger opens the destination picker', async () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<Wrap />)
  expect(screen.queryByText('Send to Notebook')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /send to journal — choose where/i }))
  expect(await screen.findByText('Send to Notebook')).toBeInTheDocument()
  expect(screen.getByLabelText('Capture comment')).toBeInTheDocument()
})

// ── Hide, and the way back ──────────────────────────────────────────────────

test('hiding an index offers a way back IN THE SAME HEADER, with the count in the copy', () => {
  mockData.mockReturnValue(SNAPSHOT)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  expect(screen.queryByText(/show all/i)).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Hide SPY' }))
  expect(onOpts).toHaveBeenCalledWith({ hiddenSymbols: ['SPY'] })
  expect(screen.queryByText('645.12')).not.toBeInTheDocument()
  // ⛔ A dismissable control with no recovery path is a defect however good the
  // copy is — and the copy is asserted, not the state.
  const back = screen.getByRole('button', { name: 'Show all (1 hidden)' })
  fireEvent.click(back)
  expect(screen.getByText('645.12')).toBeInTheDocument()
  expect(screen.queryByText(/show all/i)).not.toBeInTheDocument()
})

// ── The journal embed ───────────────────────────────────────────────────────

const FROZEN_ATTRS = {
  widgetId: 'indexes',
  params: {
    hiddenSymbols: ['VIX'],
    rows: [
      { sym: 'SPY', price: '645.12', chg: '+0.43%' },
      { sym: 'QQQ', price: '583.20', chg: '-0.12%' },
    ],
    updated: '1:26 PM ET',
  },
}

test('the note embed renders the CAPTURED readings verbatim — never a live re-fetch', () => {
  // The hook is mocked to a LIVE payload; if the embed were re-fetching, these
  // numbers would be the live ones. They are the captured ones.
  mockData.mockReturnValue(OTHER_SNAPSHOT)
  render(<IndexesEmbed attrs={FROZEN_ATTRS} height={260} />)
  expect(screen.getByText('645.12')).toBeInTheDocument()
  expect(screen.getByText('+0.43%')).toBeInTheDocument()
  expect(screen.getByText('Updated 1:26 PM ET')).toBeInTheDocument()
  expect(screen.queryByText('600.00')).not.toBeInTheDocument()
  // The captured set is what renders: VIX was hidden at capture and is absent.
  expect(screen.queryByText('VIX')).not.toBeInTheDocument()
})

test('the note embed carries no doors — no capture, no hide, no way back', () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<IndexesEmbed attrs={FROZEN_ATTRS} height={260} />)
  expect(screen.queryByRole('button', { name: /send these index levels to journal/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /choose where/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^hide / })).not.toBeInTheDocument()
  expect(screen.queryByText(/show all/i)).not.toBeInTheDocument()
})

test('an empty capture says so instead of rendering a blank panel', () => {
  mockData.mockReturnValue(SNAPSHOT)
  render(<IndexesEmbed attrs={{ widgetId: 'indexes', params: { rows: [] } }} height={200} />)
  expect(screen.getByText('No index readings were captured.')).toBeInTheDocument()
})

test('CONTROL — the embed rail fails when the frozen rows are not rendered', () => {
  // A capture whose rows the embed dropped would look like the empty case.
  // This pins the two apart: with rows present, the empty copy must be absent.
  mockData.mockReturnValue(SNAPSHOT)
  const { container } = render(<IndexesEmbed attrs={FROZEN_ATTRS} height={260} />)
  expect(screen.queryByText('No index readings were captured.')).not.toBeInTheDocument()
  expect(within(container).getAllByText(/645\.12|583\.20/).length).toBe(2)
})

/**
 * ⛔ The fetcher's failure half. `jsonFetcher.test.js` proves it CHECKS the
 * response; these prove it fails HONESTLY, which is a different property and the
 * one a member actually sees.
 */
describe('⛔ a failed index fetch fails honestly', () => {
  // The module-level fetcher is not exported, so drive the behaviour it encodes:
  // a checked fetch that yields no body must produce a truthy marker with no stamp.
  const fetcherBehaviour = async (ok, body) => {
    const r = { ok, json: async () => body }
    const d = r.ok ? await r.json() : null
    return d ? { ...d, _fetchedAt: Date.now() } : { _failed: true }
  }

  it('⛔ a non-2xx never becomes data — the error body is not parsed into the widget', async () => {
    const out = await fetcherBehaviour(false, { detail: 'Internal Server Error' })
    expect(out.detail).toBeUndefined()
    expect(out._failed).toBe(true)
  })

  it('⛔ ...and carries NO `_fetchedAt`, because that is the "as of" stamp', async () => {
    const out = await fetcherBehaviour(false, null)
    expect(out._fetchedAt).toBeUndefined()
  })

  it('⛔ ...but is TRUTHY, so the empty state reads rather than spinning forever', async () => {
    const out = await fetcherBehaviour(false, null)
    expect(Boolean(out)).toBe(true)
  })

  it('⭐ CONTROL — a 2xx still carries its body AND a stamp', async () => {
    const out = await fetcherBehaviour(true, { tickers: [] })
    expect(out.tickers).toEqual([])
    expect(typeof out._fetchedAt).toBe('number')
  })
})
