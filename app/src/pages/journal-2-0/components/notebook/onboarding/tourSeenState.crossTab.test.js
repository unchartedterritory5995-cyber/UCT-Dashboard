// @vitest-environment node
// Wave 14, lane W14-C2: two tabs recording DIFFERENT tours at the same moment must
// not lose a row. Each "tab" here has its OWN preferences cache (its own fake
// `setPrefMerged`, loaded before either writes -- exactly two browser tabs), and one
// shared fake server that implements BOTH doors faithfully:
//   * POST /api/auth/preferences  -- REPLACES the stored value (what auth.py does);
//   * PUT  /api/j2/onboarding/tours/{id} -- merges ONE row (what notebook_onboarding.py
//     does; its own atomicity is railed in tests/test_notebook_tour_seen_state.py).
// The CONTROL takes the merge door away (404 -> the old whole-value path) and the same
// race loses a row, so the main rail can fail.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TOURS_PREF, TOUR_ROW_URL, readToursPref, recordTourState } from './tourSeenState'

let server
let mergeDoor
function installServer() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const m = /^\/api\/j2\/onboarding\/tours\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      if (!mergeDoor) return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
      const { state, step } = JSON.parse(init.body)
      const map = readToursPref(server[TOURS_PREF])
      map[decodeURIComponent(m[1])] = { v: 1, state, step }
      server[TOURS_PREF] = JSON.stringify(map)
      return { ok: true, status: 200, json: async () => ({ value: server[TOURS_PREF] }) }
    }
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      server[key] = value
      return { ok: true, status: 200, json: async () => ({}) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

/** One tab: a cache loaded from the server ONCE, and a setPrefMerged with the real
 *  hook's contract (merge over THIS tab's cache, then POST the whole value). */
function tab() {
  const cache = { ...server }
  const setPrefMerged = vi.fn(async (key, updater) => {
    const next = updater(cache[key])
    if (next === undefined) return
    cache[key] = typeof next === 'string' ? next : JSON.stringify(next)
    await fetch('/api/auth/preferences', { method: 'POST', body: JSON.stringify({ key, value: cache[key] }) })
  })
  return { cache, setPrefMerged }
}

const puts = () => global.fetch.mock.calls.filter(([, i = {}]) => i.method === 'PUT')
const posts = () => global.fetch.mock.calls.filter(([u, i = {}]) => u === '/api/auth/preferences' && i.method === 'POST')

beforeEach(() => {
  server = { [TOURS_PREF]: JSON.stringify({ 'old-tour': { v: 1, state: 'done', step: null } }) }
  mergeDoor = true
  installServer()
})
afterEach(() => { vi.restoreAllMocks() })

describe('two tabs, two tours, one moment', () => {
  it('⛔⛔ both rows survive, and the row written before either tab loaded is kept', async () => {
    const a = tab()
    const b = tab()
    await Promise.all([
      recordTourState(a.setPrefMerged, 'tour-a', 'started', 's1'),
      recordTourState(b.setPrefMerged, 'tour-b', 'dismissed', null),
    ])
    expect(readToursPref(server[TOURS_PREF])).toEqual({
      'old-tour': { v: 1, state: 'done', step: null },
      'tour-a': { v: 1, state: 'started', step: 's1' },
      'tour-b': { v: 1, state: 'dismissed', step: null },
    })
    // the merge door carried both writes; the whole-value door carried none
    expect(posts()).toEqual([])
    expect(a.setPrefMerged).not.toHaveBeenCalled()
  })

  it('CONTROL: without the merge door the SAME race loses a row (so the rail above can fail)', async () => {
    mergeDoor = false
    const a = tab()
    const b = tab()
    await Promise.all([
      recordTourState(a.setPrefMerged, 'tour-a', 'started', 's1'),
      recordTourState(b.setPrefMerged, 'tour-b', 'dismissed', null),
    ])
    const rows = Object.keys(readToursPref(server[TOURS_PREF]))
    expect(rows).toContain('old-tour')
    expect(rows.includes('tour-a') && rows.includes('tour-b')).toBe(false)
  })
})

describe('the request', () => {
  it('sends ONE row -- {state, step} -- to the tour\'s own URL, never the map', async () => {
    const a = tab()
    await recordTourState(a.setPrefMerged, 'tour-a', 'done', 'last')
    expect(puts()).toHaveLength(1)
    const [url, init] = puts()[0]
    expect(url).toBe(TOUR_ROW_URL('tour-a'))
    expect(url).toBe('/api/j2/onboarding/tours/tour-a')
    expect(JSON.parse(init.body)).toEqual({ state: 'done', step: 'last' })
  })

  it('a network failure falls back to the old read-modify-write path', async () => {
    global.fetch.mockImplementationOnce(async () => { throw new TypeError('offline') })
    const a = tab()
    await recordTourState(a.setPrefMerged, 'tour-a', 'done', null)
    expect(a.setPrefMerged).toHaveBeenCalledTimes(1)
    expect(readToursPref(a.cache[TOURS_PREF])['tour-a']).toEqual({ v: 1, state: 'done', step: null })
  })

  it('a refusal that is not "no door" (413) writes nothing more -- no whole-map POST around the cap', async () => {
    global.fetch.mockImplementationOnce(async () => ({ ok: false, status: 413, json: async () => ({}) }))
    const a = tab()
    const out = await recordTourState(a.setPrefMerged, 'tour-a', 'done', null)
    expect(out).toBe(false)
    expect(a.setPrefMerged).not.toHaveBeenCalled()
    expect(posts()).toEqual([])
  })

  it('writes for one tab go out one at a time, in call order', async () => {
    const order = []
    let release
    const first = new Promise((r) => { release = r })
    global.fetch.mockImplementation(async (url, init = {}) => {
      const { step } = JSON.parse(init.body)
      order.push(`sent ${step}`)
      if (step === 's1') await first
      order.push(`done ${step}`)
      return { ok: true, status: 200, json: async () => ({ value: '{}' }) }
    })
    const a = tab()
    const p1 = recordTourState(a.setPrefMerged, 'tour-a', 'started', 's1')
    const p2 = recordTourState(a.setPrefMerged, 'tour-a', 'started', 's2')
    await new Promise((r) => setTimeout(r, 20))
    expect(order).toEqual(['sent s1'])           // s2 waits for s1
    release()
    await Promise.all([p1, p2])
    expect(order).toEqual(['sent s1', 'done s1', 'sent s2', 'done s2'])
  })
})
