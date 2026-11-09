import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getClientBuildId, createBuildWatcher } from './buildVersion'

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
