// Wave 7 (lane H, carry-over M14) — the client for `PATCH /api/j2/notes/{id}/tags`.
//
// The route applies a tag DELTA to the list the server holds, inside one
// transaction, and answers with the note. What the client must get right:
//   * send the delta, never a list it computed;
//   * LAND the revision (settleNoteWrite) when its own write moved the note --
//     doorEnumeration rail ③ demands the settle;
//   * and NEVER record a revision it did not write. The route moves no
//     revision for a delta that changes nothing and then answers with the
//     note AS STORED -- whose revision may belong to another writer. Recording
//     that as ours would tell guard 2 "ours" about a second writer's edit, and
//     the fork that protects the member would not happen. The caller passes
//     the revision it READ; an answer at that same revision wrote nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

const settleSpy = vi.fn(async () => {})
vi.mock('../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: (...a) => settleSpy(...a) }))

import { useJ2Note } from './useJ2Notes'

function wrapper({ children }) {
  return createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
}

const NOTE = { id: 'n1', title: 'T', tags: ['earnings'], updatedAt: 'T1' }
let patchAnswer
let patchStatus
let calls
beforeEach(() => {
  settleSpy.mockClear()
  calls = []
  patchStatus = 200
  patchAnswer = { note: { ...NOTE, tags: ['earnings', 'mine'], updatedAt: 'T2' } }
  global.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (init.method === 'PATCH') {
      return { ok: patchStatus < 400, status: patchStatus, json: async () => (patchStatus < 400 ? patchAnswer : { detail: 'nope' }) }
    }
    return { ok: true, status: 200, json: async () => ({ note: NOTE }) }
  })
})
afterEach(() => vi.restoreAllMocks())

async function mounted() {
  const hook = renderHook(() => useJ2Note('n1'), { wrapper })
  await waitFor(() => expect(hook.result.current.note?.id).toBe('n1'))
  return hook
}

describe('useJ2Note().patchTags — the tag DELTA door (M14)', () => {
  it('PATCHes the delta itself to the tags route -- never a whole list', async () => {
    const { result } = await mounted()
    await act(async () => { await result.current.patchTags({ add: ['mine'] }, { readAt: 'T1' }) })
    const patch = calls.find((c) => c.init.method === 'PATCH')
    expect(patch.url).toBe('/api/j2/notes/n1/tags')
    expect(JSON.parse(patch.init.body)).toEqual({ add: ['mine'], remove: [] })
    expect(patch.init.headers['Content-Type']).toBe('application/json')
  })

  it('a write that MOVED the note is landed, returned, and shown', async () => {
    const { result } = await mounted()
    let landed
    await act(async () => { landed = await result.current.patchTags({ add: ['mine'] }, { readAt: 'T1' }) })
    expect(settleSpy).toHaveBeenCalledWith('n1', patchAnswer.note)
    expect(landed).toEqual(patchAnswer.note)
    await waitFor(() => expect(result.current.note.tags).toEqual(['earnings', 'mine']))
  })

  it('⛔ an answer at the revision the caller READ wrote nothing: it is shown, never landed as ours', async () => {
    // e.g. another device had already added the tag -- the route returns the
    // note as stored, and nothing about that revision is this page's.
    patchAnswer = { note: { ...NOTE, tags: ['earnings', 'mine'], updatedAt: 'T1' } }
    const { result } = await mounted()
    let landed
    await act(async () => { landed = await result.current.patchTags({ add: ['mine'] }, { readAt: 'T1' }) })
    expect(settleSpy).not.toHaveBeenCalled()
    expect(landed).toBeNull()
    await waitFor(() => expect(result.current.note.tags).toEqual(['earnings', 'mine']))
  })

  it('a refusal throws with its status and lands nothing', async () => {
    patchStatus = 400
    const { result } = await mounted()
    let caught
    await act(async () => {
      try { await result.current.patchTags({ add: ['x'], remove: ['x'] }, { readAt: 'T1' }) } catch (e) { caught = e }
    })
    expect(caught?.status).toBe(400)
    expect(settleSpy).not.toHaveBeenCalled()
  })
})
