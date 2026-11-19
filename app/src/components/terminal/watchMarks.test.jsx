// Watchlist marks — the ONE shared source (WatchMarksProvider) and the pure shaping behind it.
//
//     cd app && npx vitest run src/components/terminal/watchMarks.test.jsx --maxWorkers=2
//
// Rails:
//   * the pure builder: own lists and Flagged, never a prebuilt list, never a throw on a shape
//     nobody expected; the words for a mark; a signature that follows content;
//   * ONE read for every cell on the board, shared with the app shell's own reader of that key;
//   * a member with no watchlist sees no mark and no error; a refused read, a network failure and
//     a wrong shape all yield no watchlist marks and never throw;
//   * the envelope the MON panel stores under the same key is read, not taken for "no lists";
//   * signed out reads nothing;
//   * a watchlist change the app announces (a mutate of `/api/watchlists…`) refreshes the marks,
//     and flagging a name marks it at once with no read at all;
//   * the same names coming back hand the cells the Map they already hold (no re-render).
// Every ticker and list name here is made up.
import { memo, useContext, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import { AuthContext } from '../../context/AuthContext'
import { writeFlagged, FLAGGED_STORAGE_KEY } from '../../hooks/flaggedStore'
import useUserTickerSet, { USER_LISTS_URL, userListRows } from '../../hooks/useUserTickerSet'
import { PanelListContext, PanelSymbol, WatchMarksContext, usePanelDrawsWatchMark } from '.'
import WatchMarksProvider from './WatchMarksProvider'
import { buildWatchMarks, watchMarkWords, watchMarksSignature } from './watchMarks'

const LISTS = [
  { id: 'w1', name: 'Swing ideas', items: [{ sym: 'AAA' }, { sym: 'bbb' }] },
  { id: 'w2', name: 'Leaders', items: [{ sym: 'AAA' }, { ticker: 'CCC' }] },
]
const MEMBER = { user: { id: 'u1', display_name: 'Test' }, loading: false }

const realFetch = globalThis.fetch
let lists
let listReads
/** A fake network: the watchlists key answers `lists` (a number is that HTTP status, an Error is a
 *  network failure); the Flagged list's own reads answer an empty 200. */
function serve() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === USER_LISTS_URL) {
      listReads += 1
      if (lists instanceof Error) throw lists
      if (typeof lists === 'number') return new Response('{"detail":"x"}', { status: lists })
      return new Response(JSON.stringify(lists), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

const run = vi.fn()
const Cells = ({ syms }) => (
  <PanelListContext.Provider value={{ run }}>
    <table><tbody>{syms.map((s) => <tr key={s}><td><PanelSymbol sym={s} /></td></tr>)}</tbody></table>
  </PanelListContext.Provider>
)
let swr
/** Hands the test this tree's own SWR cache (its `mutate`), the way a page would reach it. */
function Grab() {
  const config = useSWRConfig()
  useEffect(() => { swr = config }, [config])
  return null
}
function Shell() { useUserTickerSet(true); return null }   // the app root's own reader (LogoPrewarm)

function mount(children, { auth = MEMBER, shell = false } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthContext.Provider value={auth}>
        <Grab />
        {shell ? <Shell /> : null}
        <WatchMarksProvider>{children}</WatchMarksProvider>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
const marked = () => screen.queryAllByTestId('watch-mark').map((m) => m.closest('button')?.getAttribute('data-testid').replace('panel-symbol-', ''))

beforeEach(() => { lists = LISTS; listReads = 0; localStorage.removeItem(FLAGGED_STORAGE_KEY); serve() })
afterEach(() => { cleanup(); globalThis.fetch = realFetch; localStorage.removeItem(FLAGGED_STORAGE_KEY); swr = null })

describe('the pure shaping', () => {
  it('reads own lists and Flagged, upper-cases, and remembers which lists hold a name', () => {
    const m = buildWatchMarks([...LISTS, { id: 'f', name: 'Flagged', is_flagged_list: 1, items: [{ sym: 'ddd' }, { sym: 'AAA' }] }], ['eee', 'BBB'])
    expect([...m.keys()].sort()).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'])
    expect(m.get('AAA')).toEqual({ lists: ['Swing ideas', 'Leaders'], flagged: true })
    expect(m.get('BBB')).toEqual({ lists: ['Swing ideas'], flagged: true })
    expect(m.get('DDD')).toEqual({ lists: [], flagged: true })
    expect(m.get('EEE')).toEqual({ lists: [], flagged: true })
  })

  it('a prebuilt index list is never the member\'s own names', () => {
    const m = buildWatchMarks([{ id: 'p', name: 'Russell 2000', is_prebuilt: 1, items: [{ sym: 'ZZZ' }] }, LISTS[0]], [])
    expect(m.has('ZZZ')).toBe(false)
    expect(m.has('AAA')).toBe(true)
  })

  it.each([
    ['nothing', undefined, undefined],
    ['an object where a list was expected', { detail: 'nope' }, { a: 1 }],
    ['a string and a number', 'not a list', 7],
    ['lists whose items are not lists', [{ name: 'x', items: 'AAA' }, null, 3, { name: 'y' }], [null, '', 0]],
  ])('%s yields no marks and does not throw', (_label, a, b) => {
    expect(buildWatchMarks(a, b).size).toBe(0)
  })

  it('the words: a watchlist, several, flagged only, and both', () => {
    expect(watchMarkWords(null)).toBeNull()
    expect(watchMarkWords({ lists: [], flagged: false })).toBeNull()
    expect(watchMarkWords({ lists: ['Swing ideas'], flagged: false })).toEqual({ short: 'on your watchlist', title: 'On your watchlist: Swing ideas' })
    expect(watchMarkWords({ lists: ['A', 'B', 'C', 'D', 'E'], flagged: false }).title).toBe('On your watchlists: A, B, C and 2 more')
    expect(watchMarkWords({ lists: [], flagged: true })).toEqual({ short: 'on your Flagged list', title: 'On your Flagged list' })
    expect(watchMarkWords({ lists: ['Leaders'], flagged: true })).toEqual({ short: 'on your watchlist and flagged', title: 'On your watchlist: Leaders. Also flagged' })
  })

  it('the signature follows content, not order or identity', () => {
    const a = buildWatchMarks(LISTS, ['EEE'])
    const b = buildWatchMarks([LISTS[0], LISTS[1]].map((l) => ({ ...l, items: [...l.items] })), ['eee'])
    expect(watchMarksSignature(a)).toBe(watchMarksSignature(b))
    expect(watchMarksSignature(buildWatchMarks(LISTS, []))).not.toBe(watchMarksSignature(a))
    expect(watchMarksSignature(new Map())).toBe('')
  })

  it('the shared key\'s rows: a bare list, the MON panel\'s envelope, anything else empty', () => {
    expect(userListRows(LISTS)).toBe(LISTS)
    expect(userListRows({ body: LISTS, receivedAt: 'x' })).toBe(LISTS)
    expect(userListRows({ body: 'no' })).toEqual([])
    expect(userListRows(null)).toEqual([])
  })
})

describe('the shared source', () => {
  it('ONE read marks every cell on the board, and the app shell\'s reader shares it', async () => {
    const syms = ['AAA', 'BBB', 'CCC', ...Array.from({ length: 57 }, (_, i) => `N${i}`)]
    mount(<><Cells syms={syms.slice(0, 30)} /><Cells syms={syms.slice(30)} /></>, { shell: true })
    await waitFor(() => expect(marked()).toEqual(['AAA', 'BBB', 'CCC']))
    expect(screen.getAllByRole('button')).toHaveLength(60)
    expect(listReads).toBe(1)
  })

  it('a member with no watchlist and no flag sees no mark and no error', async () => {
    lists = []
    mount(<Cells syms={['AAA', 'BBB']} />)
    await waitFor(() => expect(listReads).toBe(1))
    expect(screen.queryByTestId('watch-mark')).toBeNull()
    expect(screen.getByRole('button', { name: 'Load AAA' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['a refused read (500)', 500],
    ['a signed-out answer (401)', 401],
    ['a network failure', new Error('offline')],
    ['an error page served as JSON', { detail: 'proxy' }],
  ])('%s shows no watchlist marks and never breaks the cells', async (_label, answer) => {
    lists = answer
    mount(<Cells syms={['AAA', 'BBB']} />)
    await waitFor(() => expect(listReads).toBe(1))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('watch-mark')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Load AAA', 'Load BBB'])
  })

  it('the envelope the MON panel stores under the same key still marks the names', async () => {
    mount(<Cells syms={['AAA', 'ZZZ']} />)
    await waitFor(() => expect(marked()).toEqual(['AAA']))
    await act(async () => { await swr.mutate(USER_LISTS_URL, { body: [{ id: 'w9', name: 'Fresh', items: [{ sym: 'ZZZ' }] }], receivedAt: '2026-11-17T15:00:00Z' }, { revalidate: false }) })
    expect(marked()).toEqual(['ZZZ'])
  })

  it('signed out (or still loading) reads nothing and marks nothing, flags included', async () => {
    writeFlagged(['AAA'])
    mount(<Cells syms={['AAA']} />, { auth: { user: null, loading: false } })
    cleanup()
    mount(<Cells syms={['AAA']} />, { auth: { user: { id: 'u1' }, loading: true } })
    cleanup()
    mount(<Cells syms={['AAA']} />, { auth: null })
    await act(async () => { await Promise.resolve() })
    expect(listReads).toBe(0)
    expect(screen.queryByTestId('watch-mark')).toBeNull()
  })

  it('a watchlist change the app announces refreshes the marks', async () => {
    mount(<Cells syms={['AAA', 'QQQQ']} />)
    await waitFor(() => expect(marked()).toEqual(['AAA']))
    lists = [...LISTS, { id: 'w3', name: 'Screener picks', items: [{ sym: 'QQQQ' }] }]
    // exactly what the screener's "add to watchlist" does (pages/screener/focus/useWatchlistTarget.js)
    await act(async () => { await swr.mutate((k) => typeof k === 'string' && k.startsWith('/api/watchlists')) })
    await waitFor(() => expect(marked()).toEqual(['AAA', 'QQQQ']))
    expect(screen.getByTestId('panel-symbol-QQQQ').getAttribute('title')).toBe('Load QQQQ into the linked panels. On your watchlist: Screener picks.')
  })

  it('flagging a name marks it at once, with no read', async () => {
    lists = []
    mount(<Cells syms={['AAA', 'BBB']} />)
    await waitFor(() => expect(listReads).toBe(1))
    expect(marked()).toEqual([])
    act(() => { writeFlagged(['BBB']) })
    expect(marked()).toEqual(['BBB'])
    expect(screen.getByRole('button', { name: 'Load BBB, on your Flagged list' })).toBeTruthy()
    act(() => { writeFlagged([]) })
    expect(marked()).toEqual([])
    expect(listReads).toBe(1)
  })

  it('the same names coming back re-render no cell', async () => {
    let renders = 0
    // an effect with no dependency list runs after EVERY render of this component
    const Probe = memo(function Probe() { useContext(WatchMarksContext); useEffect(() => { renders += 1 }); return null })
    mount(<><Probe /><Cells syms={['AAA']} /></>)
    await waitFor(() => expect(marked()).toEqual(['AAA']))
    const before = renders
    // The MON panel re-stamps the shared entry every minute: new objects, the same names.
    await act(async () => { await swr.mutate(USER_LISTS_URL, { body: LISTS.map((l) => ({ ...l })), receivedAt: 't1' }, { revalidate: false }) })
    await act(async () => { await swr.mutate(USER_LISTS_URL, LISTS.map((l) => ({ ...l, items: [...l.items] })), { revalidate: false }) })
    expect(renders).toBe(before)
    await act(async () => { await swr.mutate(USER_LISTS_URL, [LISTS[1]], { revalidate: false }) })
    expect(renders).toBe(before + 1)
    expect(screen.getByTestId('panel-symbol-AAA').getAttribute('title')).toBe('Load AAA into the linked panels. On your watchlist: Leaders.')
  })

  it('sets no timer of its own: the shell\'s poll is the only one for this key', async () => {
    vi.useFakeTimers()
    try {
      mount(<Cells syms={['AAA']} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(listReads).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000) })
      expect(listReads).toBe(1)
    } finally { vi.useRealTimers() }
  })
})

describe('who draws the mark', () => {
  function Says() { return <span data-testid="says">{String(usePanelDrawsWatchMark())}</span> }
  it('the kit draws it only inside a panel that can load a name AND inside the provider', () => {
    render(<Says />)
    expect(screen.getByTestId('says').textContent).toBe('false')
    cleanup()
    render(<PanelListContext.Provider value={{ run }}><Says /></PanelListContext.Provider>)
    expect(screen.getByTestId('says').textContent).toBe('false')
    cleanup()
    render(<WatchMarksContext.Provider value={new Map()}><Says /></WatchMarksContext.Provider>)
    expect(screen.getByTestId('says').textContent).toBe('false')
    cleanup()
    render(<WatchMarksContext.Provider value={new Map()}><PanelListContext.Provider value={{ run }}><Says /></PanelListContext.Provider></WatchMarksContext.Provider>)
    expect(screen.getByTestId('says').textContent).toBe('true')
  })
})
