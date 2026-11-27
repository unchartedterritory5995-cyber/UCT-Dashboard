// ⛔ (2026-11-27, the live sweep's S3b) A READ NEVER UNDOES A NEWER LOCAL WRITE.
// Measured on production: a preferences read that began before a dock switch answered after it, and
// `refreshPreferences` put its answer into the cache whole, so the switch's new `charts_active_template`
// went back to the old pointer under the new board (the auto-save then wrote the new board into the old
// layout's row; the save's own guard is #2926).
//   RO1 (red first) a refresh that began before a merge into the cache answers after it: the merged key keeps the
//       merged value, the other keys take the server's
//   RO2 (red first) a refresh that began before a setPref answers after the write was confirmed: the written value
//       stays
//   RO3 (red first) a merge marked `pending` (the workspace's one-write board apply) holds over a read that began
//       after it, until `settlePreferenceWrites`; then a read lands the server's value
//   RO4 CONTROL: a read that began after a refused write answered lands the server's value (the server is the
//       authority; the refused value does not stick)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { mutate as mutateGlobal } from 'swr'
import usePreferences, {
  PREFS_URL, refreshPreferences, mergeIntoPreferenceCache, settlePreferenceWrites, __resetRevisionStateForTests,
} from './usePreferences'

let server
let gate
let postStatus
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const isRead = (init) => !init || !init.method || String(init.method).toUpperCase() === 'GET'

beforeEach(async () => {
  __resetRevisionStateForTests()
  await mutateGlobal(PREFS_URL, undefined, { revalidate: false })
  server = { a: '1', b: '1' }
  gate = null
  postStatus = 200
  global.fetch = vi.fn(async (url, init) => {
    if (isRead(init)) {
      const g = gate                  // the gate current when the read BEGINS
      const answer = { ...server }   // and what the server holds then
      if (g) await g.promise
      return json(answer)
    }
    if (postStatus !== 200) return json({ detail: 'refused' }, postStatus)
    const body = JSON.parse(init.body || '{}')
    if (body && body.key) server = { ...server, [body.key]: body.value }
    return json({ ok: true })
  })
})
afterEach(() => { vi.restoreAllMocks() })

async function mounted() {
  const hook = renderHook(() => usePreferences())
  await waitFor(() => expect(hook.result.current.prefs.a).toBe('1'))
  return hook
}

describe('a read never undoes a newer local write', () => {
  it('RO1 (red first) a refresh that began before a merge answers after it: the merged key keeps its value', async () => {
    const { result } = await mounted()
    server = { a: '1', b: '9' }
    const g = deferred()
    gate = g
    let p
    await act(async () => { p = refreshPreferences() })                 // began: it will answer a = '1'
    gate = null
    await act(async () => { await mergeIntoPreferenceCache('a', '2') })
    expect(result.current.prefs.a).toBe('2')
    await act(async () => { g.resolve(); await p })
    expect(result.current.prefs.a, 'an older read undid a newer merge').toBe('2')
    expect(result.current.prefs.b, 'NON-VACUITY: the read landed').toBe('9')
  })

  it('RO2 (red first) a refresh that began before a setPref answers after the write was confirmed: the value stays', async () => {
    const { result } = await mounted()
    const g = deferred()
    gate = g
    let p
    await act(async () => { p = refreshPreferences() })                 // began while the server holds a = '1'
    gate = null
    await act(async () => { await result.current.setPref('a', '3') })
    expect(server.a, 'NON-VACUITY: the server took the write').toBe('3')
    await act(async () => { g.resolve(); await p })
    expect(result.current.prefs.a, 'an older read undid a confirmed write').toBe('3')
  })

  it('RO3 (red first) a pending merge holds over a later read until it is settled', async () => {
    const { result } = await mounted()
    await act(async () => { await mergeIntoPreferenceCache('a', '5', undefined, { pending: true }) })
    await act(async () => { await refreshPreferences() })               // began after the merge; the server still has '1'
    expect(result.current.prefs.a, 'a read put the old value back over a write still on its way').toBe('5')
    await act(async () => { settlePreferenceWrites(['a']) })
    await act(async () => { await refreshPreferences() })
    expect(result.current.prefs.a, 'a settled write still held over a later read').toBe('1')
  })

  it('RO4 CONTROL: a read that began after a refused write answered lands the server value', async () => {
    const { result } = await mounted()
    postStatus = 500
    await act(async () => { await result.current.setPref('a', '4') })
    expect(result.current.prefs.a, 'NON-VACUITY: the refused value stays on screen until a read').toBe('4')
    await act(async () => { await refreshPreferences() })
    expect(result.current.prefs.a).toBe('1')
  })
})
