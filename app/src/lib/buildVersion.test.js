import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getClientBuildId, createBuildWatcher, fetchBuildSafe } from './buildVersion'

// Same literal tests/test_health_build_id.py pins for /api/health `build_id`.
const ENTRY = 'assets/index-abc123.js'

function docFrom(html) {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('getClientBuildId', () => {
  it('returns the bare entry path without a leading slash', () => {
    const doc = docFrom(`<html><head><script type="module" crossorigin src="/${ENTRY}"></script></head></html>`)
    expect(getClientBuildId(doc)).toBe(ENTRY)
  })
  it('strips an origin and query', () => {
    const doc = docFrom(`<script type="module" src="https://uctintelligence.com/${ENTRY}?x=1"></script>`)
    expect(getClientBuildId(doc)).toBe(ENTRY)
  })
  it('ignores inline scripts and modulepreload links', () => {
    const doc = docFrom(
      `<head><link rel="modulepreload" href="/assets/vendor-zzz.js">` +
      `<script type="module">console.log(1)</script>` +
      `<script type="module" src="/${ENTRY}"></script></head>`,
    )
    expect(getClientBuildId(doc)).toBe(ENTRY)
  })
  it('returns empty string when there is no entry script or no doc', () => {
    expect(getClientBuildId(docFrom('<html></html>'))).toBe('')
    expect(getClientBuildId(null)).toBe('')
  })
})

describe('createBuildWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = (responses, clientId = 'assets/index-old.js') => {
    const queue = [...responses]
    const fetchHealth = vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0]
      if (next instanceof Error) throw next
      return next
    })
    const onNewBuild = vi.fn()
    const w = createBuildWatcher({ fetchHealth, clientId, onNewBuild, intervalMs: 1000 })
    return { w, fetchHealth, onNewBuild }
  }
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(1000)
  }

  it('does not fire on the first mismatch, fires on the second consecutive one', async () => {
    const { w, onNewBuild } = make([{ build_id: 'assets/index-new.js' }])
    await tick(1)
    expect(onNewBuild).not.toHaveBeenCalled()
    await tick(1)
    expect(onNewBuild).toHaveBeenCalledTimes(1)
    expect(onNewBuild).toHaveBeenCalledWith('assets/index-new.js')
    w.stop()
  })

  it('fires once per new id', async () => {
    const { w, onNewBuild } = make([{ build_id: 'assets/index-new.js' }])
    await tick(5)
    expect(onNewBuild).toHaveBeenCalledTimes(1)
    w.stop()
  })

  it('fires again for a later, different id', async () => {
    const { w, onNewBuild } = make([
      { build_id: 'assets/index-b.js' }, { build_id: 'assets/index-b.js' },
      { build_id: 'assets/index-c.js' }, { build_id: 'assets/index-c.js' },
    ])
    await tick(6)
    expect(onNewBuild.mock.calls.map((c) => c[0])).toEqual(['assets/index-b.js', 'assets/index-c.js'])
    w.stop()
  })

  it('A, B, A: announces B, clears when the server returns to the client id, announces B again', async () => {
    const queue = [
      { build_id: 'assets/index-b.js' }, { build_id: 'assets/index-b.js' },
      { build_id: 'assets/index-old.js' },
      { build_id: 'assets/index-b.js' }, { build_id: 'assets/index-b.js' },
    ]
    const fetchHealth = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]))
    const onNewBuild = vi.fn()
    const onBuildCleared = vi.fn()
    const w = createBuildWatcher({
      fetchHealth, clientId: 'assets/index-old.js', onNewBuild, onBuildCleared, intervalMs: 1000,
    })
    await tick(2)
    expect(onNewBuild).toHaveBeenCalledTimes(1)
    expect(onBuildCleared).not.toHaveBeenCalled()
    await tick(1)
    expect(onBuildCleared).toHaveBeenCalledTimes(1)
    await tick(2)
    expect(onNewBuild).toHaveBeenCalledTimes(2)
    w.stop()
  })

  it('a match with nothing announced never calls onBuildCleared', async () => {
    const onBuildCleared = vi.fn()
    const w = createBuildWatcher({
      fetchHealth: async () => ({ build_id: 'assets/index-old.js' }),
      clientId: 'assets/index-old.js', onNewBuild: vi.fn(), onBuildCleared, intervalMs: 1000,
    })
    await tick(3)
    expect(onBuildCleared).not.toHaveBeenCalled()
    w.stop()
  })

  it('a match between mismatches resets the streak', async () => {
    const { w, onNewBuild } = make([
      { build_id: 'assets/index-new.js' }, { build_id: 'assets/index-old.js' },
      { build_id: 'assets/index-new.js' }, { build_id: 'assets/index-old.js' },
    ])
    await tick(4)
    expect(onNewBuild).not.toHaveBeenCalled()
    w.stop()
  })

  it('never fires with an empty server id', async () => {
    const { w, onNewBuild } = make([{ build_id: '' }])
    await tick(5)
    expect(onNewBuild).not.toHaveBeenCalled()
    w.stop()
  })

  it('never fires with an empty client id', async () => {
    const { w, onNewBuild, fetchHealth } = make([{ build_id: 'assets/index-new.js' }], '')
    await tick(5)
    expect(onNewBuild).not.toHaveBeenCalled()
    expect(fetchHealth).not.toHaveBeenCalled()
    w.stop()
  })

  it('a fetch failure never fires and breaks the streak', async () => {
    const { w, onNewBuild } = make([
      { build_id: 'assets/index-new.js' }, new Error('offline'), { build_id: 'assets/index-new.js' },
    ])
    await tick(3)
    expect(onNewBuild).not.toHaveBeenCalled()
    w.stop()
  })

  it('a missing body never fires', async () => {
    const { w, onNewBuild } = make([null])
    await tick(4)
    expect(onNewBuild).not.toHaveBeenCalled()
    w.stop()
  })

  it('stop() ends polling', async () => {
    const { w, fetchHealth } = make([{ build_id: 'assets/index-new.js' }])
    w.stop()
    await tick(5)
    expect(fetchHealth).not.toHaveBeenCalled()
  })

  it('defaults to a five minute interval', async () => {
    const fetchHealth = vi.fn(async () => ({ build_id: 'x' }))
    const w = createBuildWatcher({ fetchHealth, clientId: 'y', onNewBuild: () => {} })
    await vi.advanceTimersByTimeAsync(299999)
    expect(fetchHealth).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchHealth).toHaveBeenCalledTimes(1)
    w.stop()
  })
})

// The frontend's identity comes from /build.json. /api/health is the fallback, for a server
// that has no such route yet: there the SPA catch-all answers /build.json with index.html and a 200.
describe('fetchBuildSafe', () => {
  const json = (body, ok = true) => ({ ok, json: async () => body })
  const htmlShell = () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } })
  const routes = (map) => vi.fn(async (url) => {
    const r = map[url]
    if (r instanceof Error) throw r
    if (r === undefined) throw new Error('unexpected url ' + url)
    return r
  })

  it('uses /build.json when it carries an assets/ id and never asks health', async () => {
    const fetchImpl = routes({ '/build.json': json({ build_id: 'assets/index-new.js', commit: 'abc' }) })
    const body = await fetchBuildSafe({ fetchImpl })
    expect(body).toEqual({ build_id: 'assets/index-new.js', commit: 'abc' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('/build.json')
    expect(fetchImpl.mock.calls[0][1].cache).toBe('no-store')
  })

  it('falls back to health when /build.json is the app shell (200, HTML)', async () => {
    const fetchImpl = routes({ '/build.json': htmlShell(), '/api/health': json({ build_id: 'assets/index-h.js' }) })
    expect(await fetchBuildSafe({ fetchImpl })).toEqual({ build_id: 'assets/index-h.js' })
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(['/build.json', '/api/health'])
  })

  it('falls back to health when /build.json is 404', async () => {
    const fetchImpl = routes({ '/build.json': json({ detail: 'Not Found' }, false), '/api/health': json({ build_id: 'assets/index-h.js' }) })
    expect(await fetchBuildSafe({ fetchImpl })).toEqual({ build_id: 'assets/index-h.js' })
  })

  it('falls back to health when /build.json has an empty build_id', async () => {
    const fetchImpl = routes({ '/build.json': json({ build_id: '', commit: 'abc' }), '/api/health': json({ build_id: 'assets/index-h.js' }) })
    expect(await fetchBuildSafe({ fetchImpl })).toEqual({ build_id: 'assets/index-h.js' })
  })

  it('falls back to health when the id is not an assets/ path', async () => {
    const fetchImpl = routes({ '/build.json': json({ build_id: '<!doctype html>' }), '/api/health': json({ build_id: 'assets/index-h.js' }) })
    expect(await fetchBuildSafe({ fetchImpl })).toEqual({ build_id: 'assets/index-h.js' })
  })

  it('falls back to health when /build.json cannot be reached', async () => {
    const fetchImpl = routes({ '/build.json': new Error('offline'), '/api/health': json({ build_id: 'assets/index-h.js' }) })
    expect(await fetchBuildSafe({ fetchImpl })).toEqual({ build_id: 'assets/index-h.js' })
  })

  it('resolves null when both fail, and never throws', async () => {
    const fetchImpl = routes({ '/build.json': new Error('offline'), '/api/health': new Error('offline') })
    await expect(fetchBuildSafe({ fetchImpl })).resolves.toBeNull()
  })

  it('follows /build.json when it disagrees with health', async () => {
    // After the frontend is served apart from the API, health names the API's own bundled copy.
    const fetchImpl = routes({ '/build.json': json({ build_id: 'assets/index-B.js' }), '/api/health': json({ build_id: 'assets/index-A.js' }) })
    expect((await fetchBuildSafe({ fetchImpl })).build_id).toBe('assets/index-B.js')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
