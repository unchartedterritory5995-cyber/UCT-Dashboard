import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchGroups, fetchGroupTop, fetchPeers } from './groupsApi'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status, body) {
  globalThis.fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
}

describe('groupsApi', () => {
  it('fetchGroups returns the groups array', async () => {
    mockFetch(200, { groups: [{ id: 'space', name: 'Space' }] })
    expect(await fetchGroups()).toEqual([{ id: 'space', name: 'Space' }])
  })

  it('fetchGroupTop passes n/by and returns syms', async () => {
    mockFetch(200, { syms: ['RKLB', 'ASTS'], total: 2, by: 'today', ranked_as_of: 'regular' })
    const r = await fetchGroupTop('space', { n: 9, by: 'today' })
    expect(r.syms).toEqual(['RKLB', 'ASTS'])
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/groups/space/top?n=9&by=today')
  })

  it('fetchPeers returns a safe empty shape on error', async () => {
    mockFetch(503, { error: 'x' })
    expect(await fetchPeers('RKLB', { n: 5 })).toEqual({ seed: 'RKLB', group_id: null, peers: [], source: 'none' })
  })
})
