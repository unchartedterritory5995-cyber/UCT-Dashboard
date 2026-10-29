// ⛔⛔ A FAILED PREFERENCE WRITE MUST NOT RE-FIRE ITSELF (rule H14 — a loop that throws nothing).
//
// Measured live (WebKit, 2026-10-28): opening the desktop TickerPopup with the preferences POST
// failing sent 50 POSTs in ~18 s, one every 200-300 ms, forever. The shape, end to end:
//
//   TickerPopup effect -> useAppFocus.setSymbol -> setPref('charts_workspace_groups', {A: SYM})
//   -> POST fails -> the throw path's revert (`mutate()`) re-reads the server -> the cache no
//   longer holds A=SYM -> `prefs` changes -> `setSymbol` is a new function -> the effect re-runs
//   -> POST again.
//
// Nothing in that cycle is specific to the focus key: any `prefs`-keyed effect that writes a pref
// does the same against a failing endpoint. So these rails drive the REAL usePreferences (only
// `fetch` is faked) under a REAL re-asserting effect, and count requests over a fake-timer window.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect } from 'react'
import { SWRConfig, useSWRConfig } from 'swr'
import usePreferences, { __resetRevisionStateForTests, PREFS_URL } from './usePreferences'
import useAppFocus, { FOCUS_PREF_KEY } from './useAppFocus'
import { onWorkspaceConflict } from '../lib/workspaceConflict'

const POST_CAP = 200
let server
let posts
let gets

/** GETs answer `server` (with an armed workspace stamp); POSTs answer `postAnswer(body)`. */
function installFetch(postAnswer) {
  global.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      // Circuit breaker FOR THE RAIL: the unfixed loop runs entirely in microtasks and would
      // never yield to the fake clock, hanging the worker. Past the cap a POST simply never
      // answers, so the loop stalls and the count assertion reports it instead.
      if (posts.length > POST_CAP) return new Promise(() => {})
      return postAnswer(body)
    }
    gets += 1
    return {
      ok: true, status: 200,
      headers: { get: (h) => (h === 'X-Workspace-Doc' ? 'v=7' : null) },
      json: async () => ({ ...server }),
    }
  })
}

const ok = (body) => {
  server[body.key] = body.value
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, version: 8 }) }
}
const reject = () => { throw new TypeError('Failed to fetch') }      // offline / aborted
const http502 = () => ({ ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) })

/** A surface that, like TickerPopup, re-asserts the focus symbol whenever its setter changes. */
function FocusWriter({ sym }) {
  const { setSymbol } = useAppFocus()
  useEffect(() => { setSymbol(sym) }, [sym, setSymbol])
  return null
}

/** The general shape: a `prefs`-keyed effect that writes some OTHER pref. */
function ThemeWriter() {
  const { prefs, setPref } = usePreferences()
  useEffect(() => { if (prefs.theme !== 'light') setPref('theme', 'light') }, [prefs, setPref])
  return null
}

/** Hands the test this tree's SWR `mutate`, so it can force the ordinary background re-read. */
let reread = null
function Rereader() {
  const { mutate } = useSWRConfig()
  reread = () => mutate(PREFS_URL)
  return null
}

function mount(node) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{node}</SWRConfig>)
}

async function runFor(ms) {
  for (let t = 0; t < ms; t += 50) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  }
}

beforeEach(() => {
  __resetRevisionStateForTests()
  vi.useFakeTimers()
  server = { [FOCUS_PREF_KEY]: JSON.stringify({ A: 'SPY', B: 'NVDA' }), theme: 'oled' }
  posts = []
  gets = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Exponential 1 s, 2 s, 4 s, 8 s ... from the first failure: over 20 s at most ~5 attempts.
const BOUND_20S = 6
const RETRY_WAIT_MS = 61000   // past RETRY_CAP_MS, whatever the failure count

describe('a failed preferences write is bounded, never a tight loop', () => {
  it('a REJECTED POST (offline / aborted) from the focus writer is bounded over 20 s', async () => {
    installFetch(reject)
    mount(<FocusWriter sym="ENPH" />)
    await runFor(20000)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.length, `${posts.length} POSTs in 20 s: the write is re-firing itself`).toBeLessThanOrEqual(BOUND_20S)
    expect(posts.every((p) => p.key === FOCUS_PREF_KEY)).toBe(true)
  })

  it('a 502 POST from the focus writer is bounded over 20 s', async () => {
    installFetch(http502)
    mount(<FocusWriter sym="ENPH" />)
    await runFor(20000)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.length).toBeLessThanOrEqual(BOUND_20S)
  })

  it('a 502 POST stays bounded when something else keeps re-reading (every 250 ms for 20 s)', async () => {
    // A 502 keeps the optimistic value (no revert), so on its own it settles. It does not settle
    // when the cache is re-read from under it — another consumer's revalidation, a remount — and
    // each re-read takes the unsaved value back out. 80 re-reads must not mean 80 POSTs.
    installFetch(http502)
    mount(<><FocusWriter sym="ENPH" /><Rereader /></>)
    for (let i = 0; i < 80; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await reread() })
      // eslint-disable-next-line no-await-in-loop
      await runFor(250)
    }
    expect(gets).toBeGreaterThanOrEqual(80)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.length).toBeLessThanOrEqual(BOUND_20S)
  })

  it('the same holds for ANY key: a prefs-keyed writer of `theme` against a rejecting endpoint', async () => {
    installFetch(reject)
    mount(<ThemeWriter />)
    await runFor(20000)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.length).toBeLessThanOrEqual(BOUND_20S)
    expect(posts.every((p) => p.key === 'theme')).toBe(true)
  })

  it('the backoff is per VALUE: a new value (a superseding edit) is sent at once', async () => {
    installFetch(reject)
    const view = mount(<FocusWriter sym="ENPH" />)
    await runFor(300)
    const before = posts.length
    expect(before).toBeGreaterThan(0)
    view.rerender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusWriter sym="FTNT" /></SWRConfig>)
    await runFor(100)
    expect(posts.slice(before).some((p) => JSON.parse(p.value).A === 'FTNT')).toBe(true)
  })

  it('recovers: after the window, the next re-read lets the same value through once, and it is saved', async () => {
    let failing = true
    installFetch((body) => (failing ? reject() : ok(body)))
    mount(<><FocusWriter sym="ENPH" /><Rereader /></>)
    await runFor(3000)
    const failed = posts.length
    expect(failed).toBeGreaterThan(0)
    expect(failed).toBeLessThanOrEqual(3)
    failing = false
    // There is no timer resend (see usePreferences: a retry is a caller asking again). The ask
    // comes back when the cache is next re-read from the server and the effect re-asserts.
    await runFor(RETRY_WAIT_MS)
    await act(async () => { await reread() })
    await runFor(500)
    expect(posts.length).toBe(failed + 1)
    expect(JSON.parse(server[FOCUS_PREF_KEY]).A).toBe('ENPH')
    await runFor(20000)
    expect(posts.length).toBe(failed + 1)             // saved: nothing more
  })

  it('a 409 base_version conflict is ONE POST: the key is refused and the conflict is reported once', async () => {
    const conflicts = []
    const off = onWorkspaceConflict((c) => conflicts.push(c))
    installFetch(() => ({
      ok: false, status: 409, headers: { get: () => null },
      json: async () => ({ detail: { code: 'workspace_conflict', message: 'stale' } }),
    }))
    mount(<FocusWriter sym="ENPH" />)
    await runFor(20000)
    off?.()
    expect(posts).toHaveLength(1)
    expect(posts[0].base_version).toBe(7)            // the revision the read stamped
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].key).toBe(FOCUS_PREF_KEY)
  })

  it('the success path is still exactly ONE POST', async () => {
    installFetch(ok)
    mount(<FocusWriter sym="ENPH" />)
    await runFor(20000)
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0].value).A).toBe('ENPH')
  })
})

describe('a member asking again is never held (only a re-assert with no input is)', () => {
  let api = null
  function Saver() {
    const { setPref } = usePreferences()
    api = setPref
    return null
  }

  it('after a failed save, the SAME value sent again right after a click goes out at once', async () => {
    installFetch(reject)
    mount(<Saver />)
    await runFor(100)
    await act(async () => { await api('theme', 'light') })
    expect(posts).toHaveLength(1)
    // a re-send with no input in between: held (this is the loop's shape)
    await act(async () => { await api('theme', 'light') })
    expect(posts).toHaveLength(1)
    // the member presses Try again: a click, then the same save
    await act(async () => { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await api('theme', 'light') })
    expect(posts).toHaveLength(2)
  })

  it('a keyboard Try again arrives as a click on the button, so it is not held either', async () => {
    installFetch(http502)
    mount(<Saver />)
    await runFor(100)
    await act(async () => { await api('theme', 'light') })
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.addEventListener('click', () => { api('theme', 'light') })
    await act(async () => { btn.click() })          // what Enter/Space on a focused button dispatches
    await runFor(100)
    btn.remove()
    expect(posts).toHaveLength(2)
  })
})
