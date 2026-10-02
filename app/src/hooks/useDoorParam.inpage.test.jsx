/* TERM-038 in-page doors (2026-10-01) — the Floor (`F:`), AI Search (`A:`) and the
 * screener (`S:`). The charts doors have their own file (ChartsWorkspace.doorInPage.test.jsx).
 *
 * The CLICK path every time: the REAL Ctrl/Cmd+K palette is mounted next to the page,
 * under a BrowserRouter (the app's own router kind), the page is ALREADY open, and the
 * member types a name and clicks the row. Asserted on what the page RENDERS (the post's
 * heading, the conversation's turns, the screen's filters) and that the door left the URL.
 * React commits are counted per pick: a door that writes the URL it reads can loop (H14).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Profiler } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'
import CommandPalette from '../components/CommandPalette'
import Floor2 from '../floor2/Floor2'
import useScreenSpec from '../pages/screener/shell/useScreenSpec'

vi.mock('../pages/charts/widgets/AiSearchWidget', () => ({
  default: ({ initialThread }) => (
    <div data-testid="widget">{initialThread ? initialThread.map((t) => t.q).join('|') : 'fresh'}</div>
  ),
  AIS_HANDOFF_KEY: 'uct.aisearch.handoff',
  AnswerBody: () => null,
}))
import AiSearchPage from '../pages/AiSearchPage'

const MAX_COMMITS_PER_PICK = 8   // measured 1-2 (2026-10-01); a loop runs to React's ceiling

const ADDRESSES = [
  { address: 'F:41', kind: 'floor', kind_label: 'Floor post', name: 'Breakout watch for semis', to: '/community?thread=41' },
  { address: 'F:42', kind: 'floor', kind_label: 'Floor post', name: 'Bonds are bid again', to: '/community?thread=42' },
  { address: 'A:t-9', kind: 'ai_thread', kind_label: 'AI Search', name: 'Is NVDA extended', to: '/ai-search?thread=t-9' },
  { address: 'A:t-10', kind: 'ai_thread', kind_label: 'AI Search', name: 'Copper versus gold', to: '/ai-search?thread=t-10' },
  { address: 'S:7', kind: 'saved_screen', kind_label: 'Saved screen', name: 'Leaders screen', to: '/screener?savedScreen=7' },
  { address: 'S:8', kind: 'saved_screen', kind_label: 'Saved screen', name: 'Cheap screen', to: '/screener?savedScreen=8' },
]
const thread = (id, title) => ({
  id, author_id: 'u-other', author: { name: 'Pat' }, flair: 'Discussion', title, body: '',
  score: 3, my_vote: 0, reactions: [], created_at: 1_790_000_000, posts: [],
})
const SERVED = {
  '/api/community/floor/threads/41': thread(41, 'Breakout watch for semis'),
  '/api/community/floor/threads/42': thread(42, 'Bonds are bid again'),
  '/api/ai-search/threads/t-9': { turns: [{ q: 'Is NVDA extended?', a: 'Yes.' }] },
  '/api/ai-search/threads/t-10': { turns: [{ q: 'Copper or gold?', a: 'Copper.' }] },
  '/api/screener/saved-screens': { saved: [
    { id: 7, name: 'Leaders screen', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } },
    { id: 8, name: 'Cheap screen', spec: { filters: [{ key: 'price', op: 'lte', max: 10 }] } },
  ] },
}

let calls
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    const url = String(u)
    calls.push(url)
    if (url.startsWith('/api/address/search')) {
      const q = new URL(url, 'http://x').searchParams.get('q')?.toLowerCase() || ''
      return { ok: true, status: 200, json: async () => ({ results: ADDRESSES.filter(a => a.name.toLowerCase().includes(q)), unavailable: [] }) }
    }
    const path = url.split('?')[0]
    if (path in SERVED) return { ok: true, status: 200, json: async () => SERVED[path] }
    if (path.startsWith('/api/community/floor/threads/') || path.startsWith('/api/ai-search/threads/')) {
      return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) }
    }
    return { ok: true, status: 200, json: async () => ({ threads: [], notifications: [], activity: [], unseen: 0, results: [], notes: [] }) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/') })

let commits = 0
// A runaway (H14) never returns control to the test, so a bound checked AFTER the pick
// could never fail; the commit counter itself throws past a hard ceiling, which turns a
// loop into a red test instead of a hung run.
const RUNAWAY = 200
function countCommit() {
  commits += 1
  if (commits > RUNAWAY) throw new Error(`H14 runaway: ${commits} commits`)
}
function RouteSpy() {
  const l = useLocation()
  return <div data-testid="route-spy">{l.pathname}{l.search}</div>
}
function mountAt(path, page) {
  commits = 0
  window.history.pushState({}, '', path)
  const auth = { user: { id: 'u-me', role: 'user', email: 'me@example.invalid' }, addressSpaceEnabled: true }
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={auth}>
        <BrowserRouter>
          <CommandPalette />
          <Profiler id="page" onRender={countCommit}>{page}</Profiler>
          <RouteSpy />
        </BrowserRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
async function pick(query, rowName) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
  const row = await screen.findByRole('option', { name: `${rowName}. Enter to open.` })
  const before = commits
  fireEvent.click(row)
  return before
}
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 40)) })

describe('the Floor door (F:) while the Floor is already open', () => {
  it('opens the picked post, then another, then the first again; the URL is left clean', async () => {
    mountAt('/community', <Floor2 embedded />)
    await settle()
    expect(screen.queryByRole('heading', { name: 'Breakout watch for semis' })).toBeNull()

    let before = await pick('breakout', 'Floor post: Breakout watch for semis')
    await screen.findByRole('heading', { name: 'Breakout watch for semis' })
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(window.location.search).toBe('')
    expect(screen.getByTestId('route-spy').textContent).toBe('/community')

    before = await pick('bonds', 'Floor post: Bonds are bid again')
    await screen.findByRole('heading', { name: 'Bonds are bid again' })
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(screen.queryByRole('heading', { name: 'Breakout watch for semis' })).toBeNull()

    before = await pick('breakout', 'Floor post: Breakout watch for semis')
    await screen.findByRole('heading', { name: 'Breakout watch for semis' })
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(window.location.search).toBe('')
  })
})

describe('the AI Search door (A:) while AI Search is already open', () => {
  it('reopens the picked conversation, then another, and strips the door', async () => {
    mountAt('/ai-search', <AiSearchPage />)
    await settle()
    expect(screen.getByTestId('widget')).toHaveTextContent('fresh')

    let before = await pick('nvda', 'AI Search: Is NVDA extended')
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('Is NVDA extended?'))
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(window.location.search).toBe('')

    before = await pick('copper', 'AI Search: Copper versus gold')
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('Copper or gold?'))
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(calls.filter(u => u.startsWith('/api/ai-search/threads/'))).toEqual(['/api/ai-search/threads/t-9', '/api/ai-search/threads/t-10'])
  })
})

function ScreenFilters() {
  const { filters } = useScreenSpec()
  return <div data-testid="filters">{Object.keys(filters).sort().join(',') || 'none'}</div>
}

describe('the saved-screen door (S:) while the screener is already open', () => {
  it('applies the picked screen, then another, and strips the door', async () => {
    mountAt('/screener', <ScreenFilters />)
    await settle()
    expect(screen.getByTestId('filters')).toHaveTextContent('none')

    let before = await pick('leaders', 'Saved screen: Leaders screen')
    await waitFor(() => expect(screen.getByTestId('filters')).toHaveTextContent('rs_rank'))
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(new URLSearchParams(window.location.search).has('savedScreen')).toBe(false)

    before = await pick('cheap', 'Saved screen: Cheap screen')
    await waitFor(() => expect(screen.getByTestId('filters')).toHaveTextContent('price'))
    expect(screen.getByTestId('filters')).not.toHaveTextContent('rs_rank')
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
  })
})
