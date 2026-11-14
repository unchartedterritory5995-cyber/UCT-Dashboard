/**
 * ⭐ Follow-up D, fix round 2 — THE FIRST-RENDER ASSUMPTION, AGAINST REAL SWR.
 *
 * `NoteEditorPage` lets the settle on open use the note only when THIS mount saw the read go to
 * the network: `isLoading && !note` on the mount's first render (`fromNetworkRef`). That reading is
 * SWR's, not ours, so it is checked here with the real `useJ2Note` and the real SWR cache, never
 * the mocked hook the editor rails use: an empty cache must read "saw the network", and a cache
 * already holding the note (an in-app reopen) must not.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mutate } from 'swr'
import { useJ2Note } from '../../hooks/useJ2Notes'

const NOTE = { id: 'x', title: 'T', subtitle: '', bodyJson: { type: 'doc', content: [] }, updatedAt: '2026-11-13T10:00:00Z' }

/** What the editor computes on a mount's first render for this note id. */
function sawTheNetworkOnFirstRender(noteId) {
  let first = null
  const view = renderHook(() => {
    const { note, isLoading } = useJ2Note(noteId)
    if (first === null) first = Boolean(isLoading) && !note
    return note
  })
  return { first, view }
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ note: NOTE }) }))
})

describe('real SWR: the first render tells a network read from a cached one', () => {
  it('an empty cache: loading with no note on the first render ("saw the network"), then the note arrives', async () => {
    const { first, view } = sawTheNetworkOnFirstRender('fresh-1')
    expect(first).toBe(true)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(view.result.current).toMatchObject({ title: 'T' })
  })

  it('a cache seeded by mutate(key, data, false): the note at once, not "saw the network"', async () => {
    await mutate('/api/j2/notes/cached-1', { note: NOTE }, false)
    const { first, view } = sawTheNetworkOnFirstRender('cached-1')
    expect(first).toBe(false)
    expect(view.result.current).toMatchObject({ title: 'T' })
  })
})
