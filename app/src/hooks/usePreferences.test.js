import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import usePreferences, { parsePref } from './usePreferences'
import { instanceTombstone, isInstanceTombstone } from '../components/chart/chartDefaults'

// ─── The bug under test ──────────────────────────────────────────────────────
//
// `setPref` optimistically mutates and then POSTs the WHOLE blob, with no CAS
// and no per-key merge (`usePreferences.js:32-50`). Up to sixteen multi-chart
// grid cells mount this hook independently, each holding its own snapshot of
// `chart_settings`, and every one of them is a writer. Two of them writing
// disjoint changes means the second POST — built from a snapshot taken before
// the first — silently erases the first. That is a LIVE bug today: it can
// already lose an indicator toggle. The engine only makes it louder, because an
// instance add is exactly the "new key the other writer never heard of" shape.
//
// The first test below documents that loss rather than fixing it. It is the
// evidence the new path is needed, so it must keep passing.

let posts
let server

/** Serve GETs from `server`, record POSTs, and apply them (like the API does). */
function installFetch({ gatePost = null } = {}) {
  global.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      if (gatePost) await gatePost(posts.length, body)
      server[body.key] = body.value
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({ ...server }) }
  })
}

async function mount() {
  const rendered = renderHook(() => usePreferences())
  await waitFor(() => expect(rendered.result.current.loading).toBe(false))
  return rendered
}

const lastPost = () => JSON.parse(posts[posts.length - 1].value)
const snapshot = (result) => parsePref(result.current.prefs.chart_settings, {})
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  posts = []
  server = { chart_settings: JSON.stringify({ background: '#000000', indicatorInstances: [] }) }
  installFetch()
})

afterEach(() => { vi.restoreAllMocks() })

describe('setPref — the lossy path this hook ships with', () => {
  it('LOSES a concurrent writer\'s change (the bug; this test documents it)', async () => {
    const { result } = await mount()

    // Two grid cells read the same blob…
    const writerA = snapshot(result)
    const writerB = snapshot(result)

    // …B writes first…
    await act(async () => { await result.current.setPref('chart_settings', { ...writerB, hideDrawings: true }) })
    // …then A writes from ITS snapshot, which predates B's change.
    await act(async () => { await result.current.setPref('chart_settings', { ...writerA, countdown: true }) })

    const final = lastPost()
    expect(final.countdown).toBe(true)
    expect(final.hideDrawings, 'B\'s write is gone — this is the live bug').toBeUndefined()
  })

  it('loses an INSTANCE the same way — the engine\'s version of the bug', async () => {
    const { result } = await mount()
    const writerA = snapshot(result)

    await act(async () => {
      await result.current.setPref('chart_settings', {
        ...snapshot(result),
        indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 7 } }],
      })
    })
    await act(async () => { await result.current.setPref('chart_settings', { ...writerA, countdown: true }) })

    expect(lastPost().indicatorInstances).toEqual([])
  })

  it('still serialises, still updates the cache optimistically, still reverts on failure', async () => {
    const { result } = await mount()

    await act(async () => { await result.current.setPref('theme', 'light') })
    expect(posts[0]).toEqual({ key: 'theme', value: 'light' })          // strings pass through
    expect(result.current.prefs.theme).toBe('light')                    // optimistic

    await act(async () => { await result.current.setPref('calendar_view', { view: 'month' }) })
    expect(JSON.parse(posts[1].value)).toEqual({ view: 'month' })       // objects are JSON

    global.fetch = vi.fn(async (url, init) => {
      if (init && init.method === 'POST') throw new Error('offline')
      return { ok: true, json: async () => ({ ...server }) }
    })
    await act(async () => { await result.current.setPref('theme', 'oled') })
    await waitFor(() => expect(result.current.prefs.theme).toBe('light'))  // reverted to the server's value
  })
})

describe('setPrefMerged — the write path that stops losing them', () => {
  it('keeps BOTH writers\' disjoint changes', async () => {
    const { result } = await mount()

    await act(async () => {
      await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, hideDrawings: true }))
    })
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, countdown: true }))
    })

    const final = lastPost()
    expect(final.hideDrawings).toBe(true)
    expect(final.countdown).toBe(true)
  })

  it('hands the updater the FRESHEST cached value, not the render-time snapshot', async () => {
    const { result } = await mount()

    await act(async () => { await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, first: true })) })

    let seen = null
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', cur => { seen = cur; return { ...cur, second: true } })
    })
    expect(seen.first, 'the second updater must see the first writer\'s change').toBe(true)
  })

  it('survives a STALE WHOLE-BLOB writer — the shape every existing caller has', async () => {
    // This is the migration case. Today's callers build a full `persisted` blob
    // from a possibly-stale `cs` and hand it over; an updater that ignores its
    // argument is exactly that. The id-merge is what saves the other writer's
    // instance from it.
    const { result } = await mount()
    const staleBlob = snapshot(result)

    await act(async () => {
      await result.current.setPrefMerged('chart_settings', cur => ({
        ...cur,
        indicatorInstances: [...(cur.indicatorInstances || []), { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 7 } }],
      }))
    })
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({ ...staleBlob, countdown: true }))
    })

    const final = lastPost()
    expect(final.countdown).toBe(true)
    expect(final.indicatorInstances).toHaveLength(1)
    expect(final.indicatorInstances[0].instanceId).toBe('legacy:rsi')
  })

  it('merges instances BY instanceId, not positionally', async () => {
    server.chart_settings = JSON.stringify({
      indicatorInstances: [
        { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' } },
        { instanceId: 'legacy:macd', defId: 'macd', inputs: { fastPeriod: 12 } },
      ],
    })
    const { result } = await mount()

    // A patch that mentions ONLY the second instance must not disturb the first,
    // and must merge into that instance rather than land at index 0.
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({
        indicatorInstances: [{ instanceId: 'legacy:macd', inputs: { slowPeriod: 26 } }],
      }))
    })

    const final = lastPost()
    expect(final.indicatorInstances).toHaveLength(2)
    expect(final.indicatorInstances[0].inputs).toEqual({ period: 14, color: '#7b68ee' })
    expect(final.indicatorInstances[1].inputs).toEqual({ fastPeriod: 12, slowPeriod: 26 })
  })

  it('KNOWN LIMIT: a stale writer still wins on a field it names by value', async () => {
    // The id-merge protects a writer's ADD from a writer who never heard of it.
    // It is not a CRDT: last-write-wins still governs any field both writers
    // name. Documented as a test so the boundary is a decision, not a surprise.
    const { result } = await mount()
    const staleBlob = snapshot(result)

    await act(async () => { await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, background: '#ffffff' })) })
    await act(async () => { await result.current.setPrefMerged('chart_settings', () => ({ ...staleBlob })) })

    expect(lastPost().background).toBe('#000000')
  })

  it('OMITTING an instance does not remove it — omission is not a removal', async () => {
    // Union-by-id treats an absent instance as "this writer never heard of it",
    // which is the whole reason a stale whole-blob write cannot delete another
    // cell's add. Removal therefore has to be something the patch SAYS — see the
    // tombstone block below.
    server.chart_settings = JSON.stringify({
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 } }],
    })
    const { result } = await mount()

    await act(async () => {
      await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, indicatorInstances: [] }))
    })

    expect(lastPost().indicatorInstances).toHaveLength(1)
  })

  it('updates the cache optimistically, like setPref does', async () => {
    const { result } = await mount()
    await act(async () => { await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, countdown: true })) })
    expect(parsePref(result.current.prefs.chart_settings, {}).countdown).toBe(true)
  })

  it('replaces wholesale for any OTHER key — the instance merge is chart_settings-only', async () => {
    server.charts_workspace_layout = JSON.stringify({ widgets: [{ id: 'a' }] })
    const { result } = await mount()

    await act(async () => {
      await result.current.setPrefMerged('charts_workspace_layout', cur => ({ ...cur, widgets: [{ id: 'b' }] }))
    })
    expect(lastPost()).toEqual({ widgets: [{ id: 'b' }] })
  })

  it('writes nothing at all when the updater returns undefined', async () => {
    const { result } = await mount()
    await act(async () => { await result.current.setPrefMerged('chart_settings', () => undefined) })
    expect(posts).toEqual([])
  })

  it('abandons the write when the updater THROWS — no cache change, no POST', async () => {
    const { result } = await mount()
    const before = result.current.prefs.chart_settings

    let caught = null
    await act(async () => {
      try {
        await result.current.setPrefMerged('chart_settings', () => { throw new Error('updater blew up') })
      } catch (err) { caught = err }
    })

    expect(caught?.message).toBe('updater blew up')
    expect(posts).toEqual([])
    expect(result.current.prefs.chart_settings).toBe(before)
  })

  it('accepts a pre-serialised string from a caller that has not migrated yet', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', cur => JSON.stringify({ ...cur, countdown: true }))
    })
    expect(lastPost().countdown).toBe(true)
    expect(lastPost().background).toBe('#000000')
  })

  it('reverts to the server on a failed POST', async () => {
    const { result } = await mount()
    global.fetch = vi.fn(async (url, init) => {
      if (init && init.method === 'POST') throw new Error('offline')
      return { ok: true, json: async () => ({ ...server }) }
    })
    await act(async () => { await result.current.setPrefMerged('chart_settings', cur => ({ ...cur, countdown: true })) })
    await waitFor(() => expect(parsePref(result.current.prefs.chart_settings, {}).countdown).toBeUndefined())
  })
})

describe('setPrefMerged — removing an instance', () => {
  // The settings-side mirror of a series release. Task 4 shipped add-and-edit
  // protection and left removal unrepresentable; B3 needs it the moment a user
  // toggles a migrated indicator off, and "toggled it off, it came back" is a
  // worse bug than the one the merge was written to fix.

  const rsi = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 } }
  const macd = { instanceId: 'legacy:macd', defId: 'macd', inputs: { fastPeriod: 12 } }

  beforeEach(() => {
    server.chart_settings = JSON.stringify({ background: '#000000', indicatorInstances: [rsi, macd] })
  })

  it('a tombstone DELETES the instance and leaves its siblings alone', async () => {
    const { result } = await mount()

    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({
        indicatorInstances: [instanceTombstone('legacy:rsi')],
      }))
    })

    const live = lastPost().indicatorInstances.filter(i => !isInstanceTombstone(i))
    expect(live.map(i => i.instanceId)).toEqual(['legacy:macd'])
  })

  it('a CONCURRENT UNRELATED write does not resurrect it', async () => {
    // Two grid cells. B snapshots the blob (RSI still live), A deletes RSI, then
    // B writes an unrelated field from its stale snapshot — which still names
    // RSI in full. Without a persisted tombstone, union-by-id brings it back.
    const { result } = await mount()
    const staleBlob = snapshot(result)
    expect(staleBlob.indicatorInstances, 'B really is holding the pre-delete list').toHaveLength(2)

    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({
        indicatorInstances: [instanceTombstone('legacy:rsi')],
      }))
    })
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({ ...staleBlob, countdown: true }))
    })

    const final = lastPost()
    expect(final.countdown, 'B\'s own change still lands').toBe(true)
    const live = final.indicatorInstances.filter(i => !isInstanceTombstone(i))
    expect(live.map(i => i.instanceId)).toEqual(['legacy:macd'])
  })

  it('an explicit re-add brings it back', async () => {
    const { result } = await mount()

    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({
        indicatorInstances: [instanceTombstone('legacy:rsi')],
      }))
    })
    await act(async () => {
      await result.current.setPrefMerged('chart_settings', () => ({
        indicatorInstances: [{ ...rsi, inputs: { period: 9 }, deleted: false }],
      }))
    })

    const live = lastPost().indicatorInstances.filter(i => !isInstanceTombstone(i))
    expect(live).toHaveLength(2)
    expect(live.find(i => i.instanceId === 'legacy:rsi').inputs).toEqual({ period: 9 })
  })
})

describe('setPrefMerged — write ordering', () => {
  it('merges atomically when two writes are issued WITHOUT awaiting', async () => {
    const { result } = await mount()

    await act(async () => {
      await Promise.all([
        result.current.setPrefMerged('chart_settings', cur => ({ ...cur, first: true })),
        result.current.setPrefMerged('chart_settings', cur => ({ ...cur, second: true })),
      ])
    })

    expect(posts).toHaveLength(2)
    const final = lastPost()
    expect(final.first).toBe(true)
    expect(final.second).toBe(true)
  })

  it('SERIALISES the POSTs for one key — a slow write cannot be overtaken', async () => {
    // Merging atomically is only half of it. If both POSTs were in flight at
    // once the network could deliver them in either order, and the server would
    // keep whichever landed last — which could be the EARLIER, smaller blob.
    let release
    const gate = new Promise(resolve => { release = resolve })
    installFetch({ gatePost: async (n) => { if (n === 1) await gate } })

    const { result } = await mount()

    let both
    await act(async () => {
      both = Promise.all([
        result.current.setPrefMerged('chart_settings', cur => ({ ...cur, first: true })),
        result.current.setPrefMerged('chart_settings', cur => ({ ...cur, second: true })),
      ])
      await flush()
      // The second POST must NOT have been sent while the first is in flight.
      expect(posts).toHaveLength(1)
      release()
      await both
    })

    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[0].value).second).toBeUndefined()
    expect(JSON.parse(posts[1].value).first).toBe(true)
    expect(JSON.parse(posts[1].value).second).toBe(true)
  })

  it('a FAILED write does not wedge the queue behind it', async () => {
    installFetch({ gatePost: async (n) => { if (n === 1) throw new Error('offline') } })
    const { result } = await mount()

    await act(async () => {
      await Promise.all([
        result.current.setPrefMerged('chart_settings', cur => ({ ...cur, first: true })),
        result.current.setPrefMerged('chart_settings', cur => ({ ...cur, second: true })),
      ])
    })
    expect(posts).toHaveLength(2)
  })
})
