import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// TERM-049 -- the History tab. Asserted on RENDERED TEXT:
//   * every row shows its lane, its date and its SOURCE;
//   * the room lane is a count, never message text;
//   * a failed read says "unavailable", never an empty history;
//   * an unreadable lane is named as missing, not absent.

afterEach(() => { cleanup(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

const BODY = {
  ticker: 'NVDA', since: '2026-07-01', days: 90,
  lanes: { wire: { status: 'ok' }, book: { status: 'ok' }, catalysts: { status: 'ok' }, room: { status: 'ok' } },
  timeline: [
    { date: '2026-09-26', lane: 'room', mentions: 2, text: 'Mentioned 2 times in the community room', source: 'buzz_mentions', as_of: '2026-09-26', ref: 'x' },
    { date: '2026-09-25', lane: 'book', event: 'entered', text: 'Entered the UCT 20', source: 'uct20_compositions', as_of: '2026-09-25', ref: 'x' },
    { date: '2026-09-24', lane: 'wire', mentions: 2, text: 'Named in the Morning Wire (2 mentions)', source: 'wire_archive', as_of: '2026-09-24', ref: 'x' },
  ],
}

async function renderWith(data, isLoading = false, mutate = () => {}) {
  vi.resetModules()
  vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => ({ data, isLoading, mutate }) }))
  const { default: Tab } = await import('./HistoryTab')
  return render(<Tab sym="nvda" />)
}

describe('HistoryTab', () => {
  it('renders each row with its lane, date and source', async () => {
    await renderWith({ ok: true, body: BODY })
    expect(screen.getAllByTestId('history-row')).toHaveLength(3)
    expect(screen.getByText(/Entered the UCT 20/)).toBeTruthy()
    expect(screen.getByText(/UCT 20 ledger, as of 2026-09-25/)).toBeTruthy()
    expect(screen.getByText(/Morning Wire archive, as of 2026-09-24/)).toBeTruthy()
  })

  // tq-panels: a row whose text is empty, whitespace or only bold markers drew a blank.
  it('a row is never blank: empty or marker-only text says what the row is', async () => {
    const rows = [
      { date: '2026-09-23', lane: 'catalysts', tag: 'Earnings', text: '', source: 'catalysts', as_of: '2026-09-23', ref: 'x' },
      { date: '2026-09-22', lane: 'catalysts', tag: null, text: '** **', source: 'catalysts', as_of: '2026-09-22', ref: 'x' },
      { date: '2026-09-21', lane: 'setups', text: '   ', source: 'setup_triggers', as_of: '2026-09-21', ref: 'x' },
      { date: '2026-09-20', lane: 'catalysts', tag: 'News', text: 'Synthesis temporarily unavailable. Retry later.', source: 'catalysts', as_of: '2026-09-20', ref: 'x' },
    ]
    await renderWith({ ok: true, body: { ...BODY, timeline: rows } })
    const got = screen.getAllByTestId('history-row').map((li) => li.textContent)
    expect(got[0]).toMatch(/· Catalysts · On the catalyst list \(Earnings\) ·/)
    expect(got[1]).toMatch(/· Catalysts · On the catalyst list \(untagged\) ·/)
    expect(got[2]).toMatch(/· Setups · Setups entry; no description was recorded ·/)
    expect(got[3]).toMatch(/No write-up for this day: the summary step failed/)
  })

  it('shows the room lane as a count only', async () => {
    await renderWith({ ok: true, body: BODY })
    expect(screen.getByText(/Mentioned 2 times in the community room/)).toBeTruthy()
    expect(screen.getByText(/Community mention counts/)).toBeTruthy()
  })

  it('a failed read is unavailable, never an empty history', async () => {
    await renderWith({ ok: false, httpStatus: 500, body: null })
    expect(screen.getByTestId('history-unavailable').textContent).toMatch(/does not mean nothing happened/)
    expect(screen.queryByTestId('history-empty')).toBeNull()
  })

  it('a failed read offers Retry, and Retry reads again (2026-10-07: it had none)', async () => {
    const mutate = vi.fn()
    await renderWith({ ok: false, httpStatus: 503, body: null }, false, mutate)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('a 402 is the paid gate, not "History is unavailable"', async () => {
    await renderWith({ ok: false, httpStatus: 402, body: null })
    expect(screen.getByTestId('history-paywalled').textContent).toBe('Ticker history requires a paid plan.')
    expect(screen.queryByTestId('history-unavailable')).toBeNull()
  })

  it('names an unreadable lane as missing', async () => {
    await renderWith({ ok: true, body: { ...BODY, lanes: { ...BODY.lanes, catalysts: { status: 'unavailable' } } } })
    expect(screen.getByTestId('history-lane-unavailable').textContent).toMatch(/Catalysts/)
  })

  it('names a lane whose store began inside the window, with its start date', async () => {
    const lanes = { ...BODY.lanes, wire: { status: 'ok', count: 0, covers_from: '2026-09-28', partial: true } }
    await renderWith({ ok: true, body: { ...BODY, lanes } })
    const note = screen.getByTestId('history-lane-partial').textContent
    expect(note).toMatch(/Morning Wire since 2026-09-28/)
    expect(note).toMatch(/not recorded/)
  })

  it('says nothing about coverage when every lane covers the window', async () => {
    await renderWith({ ok: true, body: BODY })
    expect(screen.queryByTestId('history-lane-partial')).toBeNull()
  })

  it('renders a flow row as a print count with its source and a link, never premium', async () => {
    const flowRow = { date: '2026-09-27', lane: 'flow', prints: 1234, text: '1,234 options prints on the tape', source: 'flow_tape', as_of: '2026-09-27', ref: '/options-flow', symbol: 'NVDA' }
    await renderWith({ ok: true, body: { ...BODY, timeline: [flowRow, ...BODY.timeline] } })
    const row = screen.getAllByTestId('history-row')[0]
    expect(row.textContent).toMatch(/2026-09-27 · Options flow · 1,234 options prints on the tape/)
    expect(row.textContent).toMatch(/Options flow tape \(print counts\), as of 2026-09-27/)
    expect(row.querySelector('a').getAttribute('href')).toBe('/options-flow')
    // Wave 3 (HIS P2 #21): the link leaves the terminal, and says so
    expect(row.textContent).toMatch(/Open Options Flow \(opens a page\)/)
    // Wave 3 (HIS P2 #25): ruled rows, the source on its own line
    expect(screen.getByTestId('history-rows').className).toMatch(/historyList/)
    expect(row.className).toMatch(/historyRow/)
    expect(row.querySelector('[data-testid="history-row-source"]').className).toMatch(/historySource/)
    expect(row.textContent).not.toMatch(/\$|premium/i)
  })

  it('renders setup publication and outcome rows from the setup ledger', async () => {
    const rows = [
      { date: '2026-09-29', lane: 'setups', event: 'outcome', text: 'VCP setup from 2026-09-25: won (+0.42R)', source: 'setup_triggers', as_of: '2026-09-29', ref: 'x' },
      { date: '2026-09-25', lane: 'setups', event: 'published', text: 'Published as a VCP setup (leadership list)', source: 'setup_triggers', as_of: '2026-09-25', ref: 'x' },
    ]
    await renderWith({ ok: true, body: { ...BODY, timeline: rows } })
    const text = screen.getByTestId('history-rows').textContent
    expect(text).toMatch(/Setups · VCP setup from 2026-09-25: won \(\+0\.42R\) · UCT setup ledger, as of 2026-09-29/)
    expect(text).toMatch(/Published as a VCP setup \(leadership list\) · UCT setup ledger, as of 2026-09-25/)
  })

  it('names how far a nightly lane reaches, and an unreadable flow lane as missing', async () => {
    const lanes = { ...BODY.lanes,
      setups: { status: 'ok', count: 0, covers_from: '2026-07-30', covers_to: '2026-09-30', partial: true },
      flow: { status: 'unavailable', count: null } }
    await renderWith({ ok: true, body: { ...BODY, lanes } })
    expect(screen.getByTestId('history-lane-partial').textContent).toMatch(/Setups since 2026-07-30 \(through 2026-09-30\)/)
    expect(screen.getByTestId('history-lane-unavailable').textContent).toMatch(/Options flow/)
  })

  it('while the slice-2 lanes are dark, names only the lanes it read and says flow is missing', async () => {
    await renderWith({ ok: true, body: { ...BODY, not_rendered: { flow: 'built, dark', setups: 'built, dark' } } })
    const intro = screen.getByTestId('history-tab').querySelector('p').textContent
    expect(intro).toMatch(/what Morning Wire, UCT 20, Catalysts, Community room recorded/)
    expect(intro).toMatch(/Options flow is not included yet/)
    expect(intro).not.toMatch(/Setups/)
  })

  it('says which earlier name a row was recorded under', async () => {
    const body = { ...BODY, ticker: 'META',
      entity: { status: 'resolved', entity_id: 'E1', aliases: [
        { alias: 'FB', valid_from: '2012-05-18', valid_to: '2022-06-09' },
        { alias: 'META', valid_from: '2022-06-09', valid_to: null }] },
      timeline: [{ date: '2022-06-01', lane: 'catalysts', text: 'FB era.', source: 'catalysts', as_of: '2022-06-01', ref: 'x', symbol: 'FB' }] }
    await renderWith({ ok: true, body })
    expect(screen.getByTestId('history-entity').textContent).toMatch(/Joined across renames: FB \(until 2022-06-09\)/)
    expect(screen.getByTestId('history-row').textContent).toMatch(/FB era\. \(as FB\)/)
  })

  it('renders the member\'s own journal rows, labelled as theirs alone', async () => {
    const body = { ...BODY, lanes: { ...BODY.lanes, journal: { status: 'ok', count: 2, covers_from: '2026-05-01', partial: false } },
      timeline: [
        { date: '2026-09-23', lane: 'journal', event: 'closed', text: 'You closed your long from 2026-09-20: win (+2.00R)', source: 'j2_trades', as_of: '2026-09-23', ref: 'j2_trades#id:1' },
        { date: '2026-09-22', lane: 'journal', event: 'opened', text: 'You opened a long position, still open (your journal)', source: 'j2_positions', as_of: '2026-09-22', ref: 'j2_positions#p1' },
      ] }
    await renderWith({ ok: true, body })
    const rows = screen.getAllByTestId('history-row').map((r) => r.textContent)
    expect(rows[0]).toMatch(/2026-09-23 · Your journal · You closed your long from 2026-09-20: win \(\+2\.00R\)/)
    expect(rows[0]).toMatch(/Your Journal 2\.0 trades \(only you see these\), as of 2026-09-23/)
    expect(rows[1]).toMatch(/Your Journal 2\.0 open positions \(only you see these\)/)
    expect(screen.getByTestId('history-tab').querySelector('p').textContent).toMatch(/Your journal recorded/)
  })

  it('an empty history says so in words', async () => {
    await renderWith({ ok: true, body: { ...BODY, timeline: [] } })
    expect(screen.getByTestId('history-empty').textContent).toMatch(/No recorded mentions of NVDA/)
  })

  // First open of HIS took 5-6 s because the whole panel waited on the options tape. The
  // server now answers without it (`pending`) and the panel asks again.
  it('a lane still being read is named as still reading, never as unreadable or empty', async () => {
    const lanes = { ...BODY.lanes, flow: { status: 'pending', count: null, retry_after_s: 2 } }
    await renderWith({ ok: true, body: { ...BODY, lanes } })
    expect(screen.getByTestId('history-lane-pending').textContent).toMatch(/Still reading: Options flow/)
    expect(screen.getByTestId('history-lane-pending').textContent).toMatch(/does not mean there are none/)
    expect(screen.queryByTestId('history-lane-unavailable')).toBeNull()
    expect(screen.getAllByTestId('history-row')).toHaveLength(3)    // the other lanes are shown now
  })

  it('any lane can be still reading, several at once, each named in plain words', async () => {
    const lanes = { ...BODY.lanes, wire: { status: 'pending', count: null, retry_after_s: 2 },
      journal: { status: 'pending', count: null, retry_after_s: 2 } }
    await renderWith({ ok: true, body: { ...BODY, lanes } })
    expect(screen.getByTestId('history-lane-pending').textContent).toMatch(/Still reading: Morning Wire, Your journal\./)
    expect(screen.queryByTestId('history-lane-unavailable')).toBeNull()
    expect(screen.queryByTestId('history-lane-partial')).toBeNull()
  })

  it('an empty answer while a lane is still reading says "so far", not "nothing"', async () => {
    const lanes = { ...BODY.lanes, flow: { status: 'pending', count: null } }
    await renderWith({ ok: true, body: { ...BODY, lanes, timeline: [] } })
    expect(screen.getByTestId('history-empty').textContent).toMatch(/so far \(Options flow still reading\)/)
  })

  it('asks again while a lane is pending, and stops once every lane has answered', async () => {
    let opts = null
    vi.resetModules()
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: (k, f, o) => { opts = o; return { data: undefined, isLoading: true } } }))
    const mod = await import('./HistoryTab')
    render(<mod.default sym="nvda" />)
    expect(opts.refreshInterval).toBe(mod.historyRefreshMs)
    const pending = { ok: true, body: { ...BODY, lanes: { ...BODY.lanes, flow: { status: 'pending', retry_after_s: 2 } } } }
    expect(mod.historyRefreshMs(pending)).toBe(2000)
    expect(mod.historyRefreshMs({ ok: true, body: BODY })).toBe(0)
    expect(mod.historyRefreshMs({ ok: false, httpStatus: 500, body: null })).toBe(0)
    expect(mod.historyRefreshMs(undefined)).toBe(0)
  })
})
