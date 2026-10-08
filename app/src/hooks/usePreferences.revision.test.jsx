// REVISION SAFETY — the client half. Every board write names the document version at which THIS
// tab last read or wrote that key; the revision comes only from the server (the read's `v=`, the
// write's `version`); a 409 refuses the write, keeps the local value, tells the workspace once,
// and stops further writes of that key until a reload. The server half (the atomic compare-and-
// set) is `tests/test_workspace_revision_safety.py`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import usePreferences, { refreshPreferences, onWorkspaceConflict, __resetRevisionStateForTests } from './usePreferences'

let posts
let readVersion
let answer          // (body) => response for a POST

function install({ header = (v) => `document; v=${v}` } = {}) {
  global.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      return answer(body)
    }
    const h = header(readVersion)
    return {
      ok: true, status: 200,
      headers: { get: (n) => (n.toLowerCase() === 'x-workspace-doc' ? h : null) },
      json: async () => ({ charts_workspace_layout: '{"widgets":[]}', chart_settings: '{}' }),
    }
  })
}
const ok = (version) => ({ ok: true, status: 200, json: async () => (version == null ? { ok: true } : { ok: true, version }) })
const conflict = (code = 'workspace_conflict') => ({ ok: false, status: 409, json: async () => ({ detail: { code, key: 'k', head_version: 99, message: 'm' } }) })

async function mount() {
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
  const r = renderHook(() => usePreferences(), { wrapper })
  await waitFor(() => expect(r.result.current.loading).toBe(false))
  return r
}

beforeEach(() => {
  __resetRevisionStateForTests()
  posts = []
  readVersion = 7
  let next = 7
  answer = () => ok(++next)
  install()
})
afterEach(() => { delete global.fetch; __resetRevisionStateForTests() })

describe('board writes carry the revision this tab last saw — and only the server moves it', () => {
  it('the first write names the version the tab LOADED at; the next names the version that write returned', async () => {
    const { result } = await mount()
    await act(async () => { await result.current.setPref('charts_workspace_layout', '{"widgets":[1]}') })
    await act(async () => { await result.current.setPref('charts_workspace_layout', '{"widgets":[2]}') })
    expect(posts.map(p => p.base_version)).toEqual([7, 8])
  })

  it('rapid edits of ONE key are sent one at a time, each on the previous answer — never a self-conflict', async () => {
    const { result } = await mount()
    let release
    const gate = new Promise(r => { release = r })
    let n = 7
    answer = async () => { if (n === 7) await gate; return ok(++n) }
    let a, b, c
    act(() => {
      a = result.current.setPref('charts_workspace_layout', '{"w":1}')
      b = result.current.setPref('charts_workspace_layout', '{"w":2}')
      c = result.current.setPref('charts_workspace_layout', '{"w":3}')
    })
    await new Promise(r => setTimeout(r, 20))
    expect(posts).toHaveLength(1)                         // the 2nd waits for the 1st's answer
    release()
    await act(async () => { await Promise.all([a, b, c]) })
    expect(posts.map(p => [p.base_version, p.value])).toEqual([[7, '{"w":1}'], [8, '{"w":2}'], [9, '{"w":3}']])
  })

  it('a BACKGROUND re-read does not advance the revision (the board on screen was built from the first read); refreshPreferences adopts the newer one', async () => {
    const { result } = await mount()
    readVersion = 20                                     // another tab moved the document on
    const gets = () => global.fetch.mock.calls.filter(([, init]) => !init || !init.method).length
    const g0 = gets()
    await mount()                                        // a real background read at v=20 — not an adoption
    expect(gets()).toBe(g0 + 1)
    await act(async () => { await result.current.setPref('charts_workspace_layout', '{"w":"stale"}') })
    expect(posts[0].base_version).toBe(7)
    await act(async () => { await refreshPreferences() })   // an explicit "take the server's state"
    await act(async () => { await result.current.setPref('chart_settings', '{"x":1}') })
    expect(posts[1].base_version).toBe(20)
  })

  it('a 409 is NOT a save: false, the workspace is told once, the key stops writing, other keys still save', async () => {
    const { result } = await mount()
    const seen = []
    const off = onWorkspaceConflict(e => seen.push(e))
    answer = (body) => (body.key === 'charts_workspace_layout' ? conflict() : ok(8))
    let r1, r2, r3
    await act(async () => { r1 = await result.current.setPref('charts_workspace_layout', '{"w":"mine"}') })
    await act(async () => { r2 = await result.current.setPref('charts_workspace_layout', '{"w":"mine2"}') })
    await act(async () => { r3 = await result.current.setPref('chart_settings', '{"x":1}') })
    off()
    expect([r1, r2, r3]).toEqual([false, false, true])
    expect(seen).toEqual([{ key: 'charts_workspace_layout', code: 'workspace_conflict', message: 'm' }])
    expect(posts.map(p => p.key)).toEqual(['charts_workspace_layout', 'chart_settings'])   // no 2nd stale POST
    expect(result.current.prefs.charts_workspace_layout).toBe('{"w":"mine2"}')             // local work kept on screen
  })

  it('an out-of-date page (the server requires a revision) is reported the same way, with its own code', async () => {
    const { result } = await mount()
    const seen = []
    const off = onWorkspaceConflict(e => seen.push(e.code))
    answer = () => conflict('workspace_revision_required')
    await act(async () => { await result.current.setPref('charts_workspace_layout', '{}') })
    off()
    expect(seen).toEqual(['workspace_revision_required'])
  })

  it('setPrefMerged rides the same queue and revision', async () => {
    const { result } = await mount()
    await act(async () => { await result.current.setPrefMerged('chart_settings', cs => ({ ...cs, a: 1 })) })
    expect(posts[0]).toMatchObject({ key: 'chart_settings', base_version: 7 })
  })

  it('DARK store (no header): no revision is sent and nothing changes', async () => {
    install({ header: () => null })
    const { result } = await mount()
    answer = () => ok(null)
    await act(async () => { await result.current.setPref('charts_workspace_layout', '{}') })
    expect('base_version' in posts[0]).toBe(false)
  })

  it('no document yet ("fallback; reason=absent") is revision 0 — the server compares against its first copy', async () => {
    install({ header: () => 'fallback; reason=absent' })
    const { result } = await mount()
    await act(async () => { await result.current.setPref('charts_workspace_layout', '{}') })
    expect(posts[0].base_version).toBe(0)
  })
})
