// Audit 2026-11-05, S17 (M7): an empty widget asks for what it needs -- one sentence, an inline input, three
// suggestions (+ "Import from Charts watchlist" when there is one) -- and every write is the existing watchlist API.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmptyNamesAsk, { IMPORT_LABEL, NAMES_ASK } from './EmptyNamesAsk'
import { __resetMyNamesQueue, MY_NAMES_LIST } from '../../lib/myNames'
import MyWatchlistTodayEmbed from './widgets/MyWatchlistTodayEmbed'

const S = { lists: [], calls: [] }
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  __resetMyNamesQueue()
  S.lists = []
  S.calls = []
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const u = String(url)
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    S.calls.push({ method, url: u, body })
    // A COPY taken when the request is made: a list created later must not appear in an answer already sent.
    if (u.startsWith('/api/watchlists?') && method === 'GET') return json(200, S.lists.map((l) => ({ ...l, items: [...l.items] })))
    if (u === '/api/watchlists' && method === 'POST') {
      const l = { id: `wl${S.lists.length + 1}`, name: body.name, items: [] }
      S.lists.push(l)
      return json(200, l)
    }
    const m = /^\/api\/watchlists\/([^/]+)\/items\/bulk$/.exec(u)
    if (m && method === 'POST') {
      const l = S.lists.find((x) => x.id === m[1])
      const before = l.items.length
      for (const sym of body.symbols) if (!l.items.some((i) => i.sym === sym)) l.items.push({ sym })
      return json(200, { added: l.items.length - before })
    }
    return json(404, { detail: 'Not found' })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const creates = () => S.calls.filter((c) => c.method === 'POST' && c.url === '/api/watchlists')

describe('the ask (M7)', () => {
  it('says what it needs, offers an input and three suggestions, and nothing to import without a Charts list', async () => {
    render(<EmptyNamesAsk />)
    expect(screen.getByText(NAMES_ASK)).toBeInTheDocument()
    expect(NAMES_ASK).toBe('Add the tickers you watch. This list, your earnings and your daily plan will follow them.')
    expect(screen.getByLabelText('Ticker to add')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Add [A-Z]+$/ }).map((b) => b.textContent)).toEqual(['+ NVDA', '+ SPY', '+ QQQ'])
    await waitFor(() => expect(S.calls.some((c) => c.url.includes('include_items=1'))).toBe(true))
    expect(screen.queryByText(IMPORT_LABEL)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('')                  // mounted empty
  })

  it('a suggestion creates "My names" once, adds the name, says so and tells the host', async () => {
    const onAdded = vi.fn()
    render(<EmptyNamesAsk onAdded={onAdded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add NVDA' }))
    await screen.findByText('Added NVDA to My names.')
    expect(S.lists.map((l) => l.name)).toEqual([MY_NAMES_LIST])
    expect(S.lists[0].items).toEqual([{ sym: 'NVDA' }])
    expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ listId: 'wl1', symbols: ['NVDA'], created: true }))
    expect(screen.queryByRole('button', { name: 'Add NVDA' })).toBeNull()      // a name added is not suggested again
  })

  it('an existing "My names" is added to, never made twice -- even with two asks pressed at once', async () => {
    render(<><EmptyNamesAsk testId="a" /><EmptyNamesAsk testId="b" /></>)
    const [one, two] = screen.getAllByRole('button', { name: 'Add SPY' })
    fireEvent.click(one)
    fireEvent.click(two)
    await waitFor(() => expect(screen.getAllByText('Added SPY to My names.')).toHaveLength(2))
    expect(creates()).toHaveLength(1)
    expect(S.lists).toHaveLength(1)
    expect(S.lists[0].items).toEqual([{ sym: 'SPY' }])
  })

  it('typed tickers are cleaned ($, case, commas) before they are sent', async () => {
    render(<EmptyNamesAsk />)
    fireEvent.change(screen.getByLabelText('Ticker to add'), { target: { value: '$amd, crwd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText('Added AMD, CRWD to My names.')
    const bulk = S.calls.find((c) => c.url.endsWith('/items/bulk'))
    expect(bulk.body).toEqual({ symbols: ['AMD', 'CRWD'] })
  })

  it('"Import from Charts watchlist" appears only when a Charts list has names, and imports them into My names', async () => {
    S.lists = [{ id: 'c1', name: 'Swing longs', items: [{ sym: 'TSLA' }, { sym: 'META' }] }]
    render(<EmptyNamesAsk />)
    fireEvent.click(await screen.findByRole('button', { name: IMPORT_LABEL }))
    await screen.findByText('Imported 2 names into My names.')
    expect(S.lists.find((l) => l.name === MY_NAMES_LIST).items).toEqual([{ sym: 'TSLA' }, { sym: 'META' }])
    expect(S.lists.find((l) => l.id === 'c1').items).toHaveLength(2)          // the Charts list is untouched
  })

  it('a refused write says nothing was saved and tells the host nothing', async () => {
    const onAdded = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => json(500, { detail: 'boom' })))
    render(<EmptyNamesAsk onAdded={onAdded} canImport={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add QQQ' }))
    await screen.findByText("Couldn't add that. Nothing was saved. Try again.")
    expect(onAdded).not.toHaveBeenCalled()
  })
})

describe('My watchlist today with no names (S17)', () => {
  const attrs = { widgetId: 'myWatchlistToday', params: { rows: [], listLabel: 'Watchlist', asOf: '2026-11-04T12:00:00Z' } }
  it('an editable widget asks, and reserves no fixed height while empty', () => {
    render(<MyWatchlistTodayEmbed attrs={attrs} editable onUpdateParams={() => true} />)
    expect(screen.getByTestId('empty-names-ask')).toBeInTheDocument()
    expect(screen.getByTestId('my-watchlist-today-embed').style.height).toBe('')
    expect(screen.queryByText('No names on this list yet.')).toBeNull()
  })
  it('a read-only copy says what it needs, with nothing to press', () => {
    render(<MyWatchlistTodayEmbed attrs={attrs} />)
    expect(screen.getByText(NAMES_ASK)).toBeInTheDocument()
    expect(screen.queryByTestId('empty-names-ask')).toBeNull()
  })
  it('CONTROL: with rows it keeps its height and its table', () => {
    const full = { ...attrs, params: { ...attrs.params, rows: [{ symbol: 'NVDA', price: 1, changePct: 0.5 }] } }
    render(<MyWatchlistTodayEmbed attrs={full} height={300} />)
    expect(screen.getByTestId('my-watchlist-today-embed').style.height).toBe('300px')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
