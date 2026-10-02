/* TERM-038 slice 2 — the `F:<id>` address door: /community?thread=<id> opens that Floor
 * post on arrival, through the REAL data hooks (fetch is the only stub), and only while
 * the address space rides the auth payload. Asserted on rendered text + the request made. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'
import Floor2 from './Floor2'

const THREAD = {
  id: 41, author_id: 'u-other', author: { name: 'Pat' }, flair: 'Discussion',
  title: 'Breakout watch for semis', body: '', score: 3, my_vote: 0, reactions: [],
  created_at: 1_790_000_000, posts: [],
}

function serve() {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    const url = String(u)
    calls.push(url)
    const body = url.startsWith('/api/community/floor/threads/41') ? THREAD
      : url.startsWith('/api/community/floor/threads/') ? null
        : { threads: [], notifications: [], activity: [], unseen: 0 }
    return { ok: body !== null, status: body ? 200 : 404, json: async () => body || { detail: 'Not found' } }
  }))
  return calls
}

function renderFloor(path, addressSpaceEnabled) {
  window.history.pushState({}, '', path)
  const auth = { user: { id: 'u-me', role: 'user', email: 'me@example.invalid' }, addressSpaceEnabled }
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={auth}><Floor2 embedded /></AuthContext.Provider>
    </SWRConfig>,
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/') })

describe('The Floor — the ?thread= door (F:<id>)', () => {
  it('opens the named post on arrival and strips its instruction', async () => {
    const calls = serve()
    renderFloor('/community?thread=41', true)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Breakout watch for semis' })).toBeInTheDocument())
    expect(calls).toContain('/api/community/floor/threads/41')
    expect(window.location.search).not.toContain('thread=')
  })

  it('while the address space is dark the param is ignored: the feed, no post asked for', async () => {
    const calls = serve()
    renderFloor('/community?thread=41', false)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls.some((u) => u.startsWith('/api/community/floor/threads/'))).toBe(false)
    expect(screen.queryByText('Breakout watch for semis')).toBeNull()
    expect(window.location.search).toContain('thread=41')
  })

  it('a garbage id is not a door', async () => {
    const calls = serve()
    renderFloor('/community?thread=41;drop', true)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls.some((u) => u.startsWith('/api/community/floor/threads/'))).toBe(false)
  })
})
