// ⛔⛔ A MERGING WRITE NEVER BUILDS A WHOLE VALUE FROM A BASE THAT HAS NOT BEEN READ.
//
// Measured 2026-10-28: the TickerPopup's focus write (useAppFocus.setSymbol ->
// `charts_workspace_groups`) fired while the first preferences read was still in flight. The
// cache held nothing, so the write was built from an empty base and posted `{A: 'ENPH'}`, which
// REPLACES the member's comparison slots B/C/D on the server with nothing.
//
// These rails drive the REAL usePreferences + useAppFocus (only `fetch` is faked), hold the GET
// open, fire the write in that window, and read what the server would end up holding.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { SWRConfig } from 'swr'
import usePreferences, { __resetRevisionStateForTests } from './usePreferences'
import useAppFocus, { FOCUS_PREF_KEY } from './useAppFocus'

let server
let posts
let releaseGet
let getMode     // 'ok' | '502' | 'reject'

function installFetch() {
  global.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      server[body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    // Every GET waits for the test to release it: the window a member's early click lands in.
    await new Promise((resolve) => { releaseGet = resolve })
    if (getMode === 'reject') throw new TypeError('Failed to fetch')
    if (getMode === '502') return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...server }) }
  })
}

const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>

function FocusWriter({ sym }) {
  const { setSymbol } = useAppFocus()
  useEffect(() => { setSymbol(sym) }, [sym, setSymbol])
  return null
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve() }) }
const saved = () => JSON.parse(server[FOCUS_PREF_KEY])

beforeEach(() => {
  __resetRevisionStateForTests()
  server = { [FOCUS_PREF_KEY]: JSON.stringify({ A: 'SPY', B: 'NVDA', C: 'QQQ', D: 'IWM' }) }
  posts = []
  releaseGet = null
  getMode = 'ok'
  installFetch()
})
afterEach(() => { vi.restoreAllMocks() })

describe('a focus write fired before the first read lands', () => {
  it('waits for the read and KEEPS B/C/D', async () => {
    render(<FocusWriter sym="ENPH" />, { wrapper })
    await flush()
    expect(posts).toHaveLength(0)                 // nothing posted while the read is in flight
    await act(async () => { releaseGet() })
    await flush()
    expect(posts).toHaveLength(1)
    expect(saved()).toEqual({ A: 'ENPH', B: 'NVDA', C: 'QQQ', D: 'IWM' })
  })

  it('a REFUSED read (502, served as {}) writes nothing: no value built from an empty base', async () => {
    getMode = '502'
    render(<FocusWriter sym="ENPH" />, { wrapper })
    await flush()
    await act(async () => { releaseGet() })
    await flush()
    expect(posts).toHaveLength(0)
    expect(saved()).toEqual({ A: 'SPY', B: 'NVDA', C: 'QQQ', D: 'IWM' })
  })

  it('a FAILED read (network) writes nothing either', async () => {
    getMode = 'reject'
    render(<FocusWriter sym="ENPH" />, { wrapper })
    await flush()
    await act(async () => { releaseGet() })
    await flush()
    expect(posts).toHaveLength(0)
    expect(saved().B).toBe('NVDA')
  })
})

describe('setPrefMerged — the general rule, for every multi-field pref', () => {
  it('a merge issued before the read lands is applied to the SERVER value, not to nothing', async () => {
    server.chart_settings = JSON.stringify({ background: '#000000', keepMe: true })
    const { result } = renderHook(() => usePreferences(), { wrapper })
    let p
    await act(async () => { p = result.current.setPrefMerged('chart_settings', (cs) => ({ ...cs, added: 1 })) })
    expect(posts).toHaveLength(0)
    await act(async () => { releaseGet() })
    await act(async () => { await p })
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0].value)).toMatchObject({ background: '#000000', keepMe: true, added: 1 })
  })

  it('after a refused read it returns false and posts nothing', async () => {
    getMode = '502'
    const { result } = renderHook(() => usePreferences(), { wrapper })
    let p
    await act(async () => { p = result.current.setPrefMerged('notebook_tours', (t) => ({ ...t, seen: true })) })
    await act(async () => { releaseGet() })
    let r
    await act(async () => { r = await p })
    expect(r).toBe(false)
    expect(posts).toHaveLength(0)
    // ...but the member's edit is applied to THIS tab's cache, so the screen still reflects it
    expect(JSON.parse(result.current.prefs.notebook_tours)).toEqual({ seen: true })
  })

  it('CONTROL: once a read has landed, a merge still posts at once (no wait, no refusal)', async () => {
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await act(async () => { releaseGet() })
    await flush()
    await act(async () => { await result.current.setPrefMerged(FOCUS_PREF_KEY, (g) => JSON.stringify({ ...g, A: 'AMD' })) })
    expect(posts).toHaveLength(1)
    expect(saved()).toEqual({ A: 'AMD', B: 'NVDA', C: 'QQQ', D: 'IWM' })
  })
})
