// The routine and tracker data layer (Notebook widgets phase 2, wave 9, Task 9.12).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const realFetch = globalThis.fetch
const realBC = globalThis.BroadcastChannel

/** A fake channel: instances of one name hear each other (never themselves), as in a browser. */
class FakeBC {
  static all = []
  static posts = []
  constructor(name) { this.name = name; this.onmessage = null; this.handlers = []; FakeBC.all.push(this) }
  postMessage(data) {
    FakeBC.posts.push({ name: this.name, data })
    for (const other of FakeBC.all) {
      if (other !== this && other.name === this.name) {
        const ev = { data }
        other.onmessage?.(ev)
        other.handlers.forEach((h) => h(ev))
      }
    }
  }
  addEventListener(type, h) { if (type === 'message') this.handlers.push(h) }
  close() {}
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const tick0 = () => new Promise((r) => setTimeout(r, 5))
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })

async function freshApi() {
  vi.resetModules()
  return import('./toolsApi')
}

const routineAnswer = (ids, days) => ({
  resolved: { today: '2026-10-26' },
  routines: Object.fromEntries(ids.map((id) => [id, {
    routine: { id, name: `R ${id}` },
    days: Object.fromEntries(days.map((d) => [d === 'today' ? '2026-10-26' : d, { state: 'open', day: d }])),
  }])),
})

let visHandlers = []
const realAdd = document.addEventListener.bind(document)
const realRemove = document.removeEventListener.bind(document)
const fireVisible = () => visHandlers.forEach((h) => h())

beforeEach(() => {
  visHandlers = []
  document.addEventListener = (type, h, o) => { if (type === 'visibilitychange') visHandlers.push(h); else realAdd(type, h, o) }
  document.removeEventListener = (type, h, o) => { if (type === 'visibilitychange') visHandlers = visHandlers.filter((x) => x !== h); else realRemove(type, h, o) }
  FakeBC.all = []
  FakeBC.posts = []
  globalThis.BroadcastChannel = FakeBC
  globalThis.fetch = vi.fn()
  setOnline(true)
})
afterEach(() => {
  document.addEventListener = realAdd
  document.removeEventListener = realRemove
  vi.useRealTimers()
  globalThis.fetch = realFetch
  globalThis.BroadcastChannel = realBC
  setOnline(true)
})

describe('readDay: one batched read per kind per tick', () => {
  it('six_reads_in_one_tick_make_one_request', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body)
      return json(200, url.includes('/routines/') ? routineAnswer(body.ids, body.days)
        : { trackers: { t1: { tracker: { id: 't1' }, days: { '2026-10-23': { value: 4 } } } } })
    })
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const reads = ids.map((id) => api.readDay('routine', id, '2026-10-23'))
    const tracker = api.readDay('tracker', 't1', '2026-10-23')
    const got = await Promise.all([...reads, tracker])
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    const [routinesCall, trackersCall] = globalThis.fetch.mock.calls
    expect(routinesCall[0]).toBe('/api/j2/routines/days')
    expect(routinesCall[1].method).toBe('POST')
    expect(JSON.parse(routinesCall[1].body)).toEqual({ ids, days: ['2026-10-23'] })
    expect(trackersCall[0]).toBe('/api/j2/trackers/days')
    expect(JSON.parse(trackersCall[1].body)).toEqual({ ids: ['t1'], days: ['2026-10-23'] })
    expect(got.every((r) => r.ok)).toBe(true)
    expect(got[0]).toMatchObject({ ok: true, resolvedDay: '2026-10-23', tool: { id: 'a' } })
  })

  it('de-duplicates ids and days, and a later tick makes a second request', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    await Promise.all([api.readDay('routine', 'a', 'today'), api.readDay('routine', 'a', 'today'), api.readDay('routine', 'a', '2026-10-23')])
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ ids: ['a'], days: ['2026-10-23', 'today'] })
    await api.readDay('routine', 'a', 'today')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('"today" resolves to the server\'s resolved day', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    expect(await api.readDay('routine', 'a', 'today')).toMatchObject({ ok: true, resolvedDay: '2026-10-26' })
  })

  it('splits a big tick into requests of at most 30 ids and 31 days', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    const ids = Array.from({ length: 31 }, (_, i) => `r${i}`)
    const days = Array.from({ length: 32 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`.replace('2026-09-31', '2026-10-01').replace('2026-09-32', '2026-10-02'))
    const reads = ids.map((id) => api.readDay('routine', id, days[0]))          // 31 ids: two id chunks
    days.slice(1).forEach((d) => reads.push(api.readDay('routine', ids[0], d)))  // 32 days: two day chunks
    reads.push(api.readDay('routine', ids[30], days[31]))                        // the far corner: both second chunks
    const got = await Promise.all(reads)
    expect(got.every((r) => r.ok)).toBe(true)
    for (const [, init] of globalThis.fetch.mock.calls) {
      const b = JSON.parse(init.body)
      expect(b.ids.length).toBeLessThanOrEqual(30)
      expect(b.days.length).toBeLessThanOrEqual(31)
    }
    expect(globalThis.fetch.mock.calls.length).toBe(4)
  })

  it('missing_id_resolves_missing_not_zero', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(200, { routines: {} }))
    expect(await api.readDay('routine', 'gone', '2026-10-23')).toEqual({ ok: false, code: 'missing' })
    globalThis.fetch = vi.fn(async () => json(200, { routines: { a: { routine: {}, days: {} } } }))
    expect(await api.readDay('routine', 'a', '2026-10-23')).toEqual({ ok: false, code: 'missing' })
  })

  it('404_resolves_unavailable', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(404, { detail: 'Not found' }))
    expect(await api.readDay('tracker', 't', '2026-10-23')).toEqual({ ok: false, code: 'unavailable' })
  })

  it('429 is rate, a failed fetch and a 500 are network', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(429, { detail: { code: 'rate', message: 'x' } }))
    expect(await api.readDay('routine', 'a', '2026-10-23')).toEqual({ ok: false, code: 'rate' })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('down') })
    expect(await api.readDay('routine', 'a', '2026-10-23')).toEqual({ ok: false, code: 'network' })
    globalThis.fetch = vi.fn(async () => json(500, {}))
    expect(await api.readDay('routine', 'a', '2026-10-23')).toEqual({ ok: false, code: 'network' })
  })

  it('visible_again_rereads_once', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    const seen = []
    const offA = api.subscribe('routine', 'a', '2026-10-23', (e) => seen.push(['a', e.state]))
    const offB = api.subscribe('routine', 'b', '2026-10-23', (e) => seen.push(['b', e.state]))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    fireVisible()
    await tick0()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ ids: ['a', 'b'], days: ['2026-10-23'] })
    expect(seen).toEqual([['a', 'open'], ['b', 'open']])
    offA(); offB()
    fireVisible()
    await tick0()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)          // nothing subscribed: nothing re-read
  })

  it('a hidden tab does not re-read', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(200, {}))
    api.subscribe('routine', 'a', '2026-10-23', () => {})
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    fireVisible()
    await tick0()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })
})

describe('offline', () => {
  it('offline_makes_no_request', async () => {
    const api = await freshApi()
    setOnline(false)
    expect(api.isOffline()).toBe(true)
    expect(await api.readDay('routine', 'a', '2026-10-23')).toEqual({ ok: false, code: 'offline' })
    expect(await api.tick('a', '2026-10-23', 'i1', true)).toEqual({ ok: false, code: 'offline', message: api.TOOL_COPY.offline })
    expect(await api.setSkipped('a', '2026-10-23', true)).toMatchObject({ ok: false, code: 'offline' })
    expect(await api.logValue('t', '2026-10-23', 3)).toMatchObject({ ok: false, code: 'offline' })
    expect(await api.vsPnl('routine', 'a')).toEqual({ ok: false, code: 'offline' })
    await tick0()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('writes', () => {
  it('each write names its method and URL, and sends one item', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done' }))
    await api.tick('r 1', '2026-10-23', 'i/1', true)
    await api.setSkipped('r1', '2026-10-23', true)
    await api.logValue('t1', '2026-10-23', 4)
    await api.logValue('t1', '2026-10-23', undefined)
    const calls = globalThis.fetch.mock.calls
    expect(calls[0][0]).toBe('/api/j2/routines/r%201/days/2026-10-23/items/i%2F1')
    expect(calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'include' })
    expect(JSON.parse(calls[0][1].body)).toEqual({ ticked: true })
    expect(calls[1][0]).toBe('/api/j2/routines/r1/days/2026-10-23')
    expect(JSON.parse(calls[1][1].body)).toEqual({ skipped: true })
    expect(calls[2][0]).toBe('/api/j2/trackers/t1/days/2026-10-23')
    expect(JSON.parse(calls[2][1].body)).toEqual({ value: 4 })
    expect(JSON.parse(calls[3][1].body)).toEqual({ value: null })    // a cleared day is sent, never dropped
  })

  it('write_error_code_and_message_from_detail', async () => {
    const api = await freshApi()
    for (const code of ['window', 'read_only', 'rate', 'invalid']) {
      globalThis.fetch = vi.fn(async () => json(code === 'rate' ? 429 : 400, { detail: { code, message: `server says ${code}` } }))
      expect(await api.tick('r', '2026-10-01', 'i', true)).toEqual({ ok: false, code, message: `server says ${code}` })
    }
    globalThis.fetch = vi.fn(async () => json(400, { detail: { code: 'window', message: api.TOOL_COPY.window } }))
    expect((await api.logValue('t', '2026-10-01', 1)).message).toBe('Ticks can be added up to 7 trading days back.')
    globalThis.fetch = vi.fn(async () => json(500, {}))
    expect(await api.tick('r', '2026-10-01', 'i', true)).toEqual({ ok: false, code: 'invalid', message: api.TOOL_COPY.tickFailed })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('down') })
    expect(await api.tick('r', '2026-10-01', 'i', true)).toEqual({ ok: false, code: 'network', message: api.TOOL_COPY.tickFailed })
  })

  it('a refused write publishes nothing', async () => {
    const api = await freshApi()
    const seen = vi.fn()
    api.subscribe('routine', 'r', '2026-10-23', seen)
    globalThis.fetch = vi.fn(async () => json(400, { detail: { code: 'window', message: 'no' } }))
    await api.tick('r', '2026-10-23', 'i', true)
    expect(seen).not.toHaveBeenCalled()
    expect(FakeBC.posts).toEqual([])
  })

  it('tick_publishes_merged_entry_to_page_and_channel', async () => {
    const api = await freshApi()
    const entry = { state: 'done', ticks: { i1: true } }
    globalThis.fetch = vi.fn(async () => json(200, entry))
    const here = vi.fn()
    const other = vi.fn()
    api.subscribe('routine', 'r1', '2026-10-23', here)
    api.subscribe('routine', 'r1', '2026-10-23', other)
    api.subscribe('routine', 'r1', '2026-10-22', vi.fn())
    const out = await api.tick('r1', '2026-10-23', 'i1', true)
    expect(out).toEqual({ ok: true, entry })
    expect(here).toHaveBeenCalledWith(entry)
    expect(other).toHaveBeenCalledWith(entry)
    expect(FakeBC.posts).toEqual([{ name: 'uct-nb-tools', data: { kind: 'routine', id: 'r1', day: '2026-10-23', entry, at: expect.any(Number), seq: expect.any(Number) } }])
  })

  it('works with no BroadcastChannel at all', async () => {
    delete globalThis.BroadcastChannel
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(200, { value: 3 }))
    const here = vi.fn()
    api.subscribe('tracker', 't1', '2026-10-23', here)
    expect(await api.logValue('t1', '2026-10-23', 3)).toEqual({ ok: true, entry: { value: 3 } })
    expect(here).toHaveBeenCalledWith({ value: 3 })
  })

  it('channel_message_reaches_subscriber', async () => {
    const api = await freshApi()
    const fn = vi.fn()
    const off = api.subscribe('tracker', 't1', '2026-10-23', fn)
    const otherTab = new FakeBC('uct-nb-tools')
    otherTab.postMessage({ kind: 'tracker', id: 't1', day: '2026-10-23', entry: { value: 5 } })
    otherTab.postMessage({ kind: 'tracker', id: 't1', day: '2026-10-22', entry: { value: 1 } })     // another day
    otherTab.postMessage({ kind: 'routine', id: 't1', day: '2026-10-23', entry: { value: 1 } })     // another kind
    otherTab.postMessage({ nonsense: true })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith({ value: 5 })
    off()
    otherTab.postMessage({ kind: 'tracker', id: 't1', day: '2026-10-23', entry: { value: 6 } })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('vsPnl', () => {
  it('is a GET of the tool\'s own route', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(200, { sentence: 'x' }))
    expect(await api.vsPnl('routine', 'r1')).toEqual({ ok: true, data: { sentence: 'x' } })
    expect(await api.vsPnl('tracker', 'checkin:mood')).toEqual({ ok: true, data: { sentence: 'x' } })
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/j2/routines/r1/vs-pnl')
    expect(globalThis.fetch.mock.calls[1][0]).toBe('/api/j2/trackers/checkin%3Amood/vs-pnl')
    expect(globalThis.fetch.mock.calls[0][1].method).toBeUndefined()
    globalThis.fetch = vi.fn(async () => json(404, {}))
    expect(await api.vsPnl('routine', 'r1')).toEqual({ ok: false, code: 'unavailable' })
  })
})

describe('the constants', () => {
  it('say what the brief says, and the literal URLs in the file start with the two constants', async () => {
    const api = await freshApi()
    expect(api.ROUTINES_URL).toBe('/api/j2/routines')
    expect(api.TRACKERS_URL).toBe('/api/j2/trackers')
    expect(api.CHANNEL).toBe('uct-nb-tools')
    expect(Object.isFrozen(api.TOOL_COPY)).toBe(true)
    expect(api.TOOL_COPY).toEqual({
      offline: "You're offline. Ticks save when you're back online.",
      flagOff: 'Not available right now.',
      missing: 'Not available.',
      readFailedRoutine: "Can't load this routine right now.",
      readFailedTracker: "Can't load this tracker right now.",
      tickFailed: "Didn't save. Retry?",
      window: 'Ticks can be added up to 7 trading days back.',
      archivedRoutine: 'Archived routine, history only',
      archivedTracker: 'Archived tracker, history only',
    })
    // Every fetch URL is written literally (the door rail matches literals), so the constants must agree with them.
    const src = readFileSync(join(__dirname, 'toolsApi.js'), 'utf8')
    const urls = [...src.matchAll(/fetch\((?:'|`)(\/api\/[^'`$]*)/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThanOrEqual(7)
    for (const u of urls) expect(u.startsWith(api.ROUTINES_URL) || u.startsWith(api.TRACKERS_URL), u).toBe(true)
  })

  it('no label is hard-coded here: the state codes are never mapped to member words', () => {
    const src = readFileSync(join(__dirname, 'toolsApi.js'), 'utf8').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/['"`](Not yet|Not done|Skipped|Off day|Done)['"`]/)
  })
})

// -- fix round 1 --------------------------------------------------------------------------------------------

const flushTimers = () => vi.advanceTimersByTimeAsync(1)
/** An answer for any batch, resolving 'today' to `today`. */
const answerWithToday = (today) => async (u, init) => {
  const b = JSON.parse(init.body)
  const a = routineAnswer(b.ids, b.days)
  a.resolved = { today }
  for (const id of b.ids) {
    a.routines[id].days = Object.fromEntries(b.days.map((d) => [d === 'today' ? today : d, { state: 'open', day: d === 'today' ? today : d }]))
  }
  return json(200, a)
}

describe("'today' is the server's day (W9-R27, amended)", () => {
  it('a today subscriber hears a write for the day the server resolved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-23T15:00:00Z'))
    const api = await freshApi()
    globalThis.fetch = vi.fn(answerWithToday('2026-10-23'))
    const first = api.readDay('routine', 'r1', 'today')
    await flushTimers()
    expect(await first).toMatchObject({ ok: true, resolvedDay: '2026-10-23' })
    const fn = vi.fn()
    api.subscribe('routine', 'r1', 'today', fn)
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done' }))
    await api.tick('r1', '2026-10-23', 'i', true)
    expect(fn).toHaveBeenCalledWith({ state: 'done' })
    fn.mockClear()
    await api.tick('r1', '2026-10-22', 'i', true)          // another day
    expect(fn).not.toHaveBeenCalled()
  })

  it('on a weekend the server resolves to Monday, and a write for Monday is heard (not the calendar Saturday)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-24T15:00:00Z'))     // a Saturday
    const api = await freshApi()
    globalThis.fetch = vi.fn(answerWithToday('2026-10-26'))
    const first = api.readDay('routine', 'r1', 'today')
    await flushTimers()
    await first
    const fn = vi.fn()
    api.subscribe('routine', 'r1', 'today', fn)
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done' }))
    await api.tick('r1', '2026-10-24', 'i', true)
    expect(fn).not.toHaveBeenCalled()
    await api.tick('r1', '2026-10-26', 'i', true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('after ET midnight the timer re-reads: the new day is heard and the old one is not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-24T03:30:00Z'))     // Friday 23:30 ET
    const api = await freshApi()
    globalThis.fetch = vi.fn(answerWithToday('2026-10-23'))
    const first = api.readDay('routine', 'r1', 'today')
    await flushTimers()
    await first
    const fn = vi.fn()
    api.subscribe('routine', 'r1', 'today', fn)
    globalThis.fetch = vi.fn(answerWithToday('2026-10-26'))        // after midnight the server says Monday
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)               // the timer's re-read
    expect(fn).toHaveBeenCalledWith({ state: 'open', day: '2026-10-26' })
    fn.mockClear()
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done' }))
    await api.tick('r1', '2026-10-23', 'i', true)
    expect(fn).not.toHaveBeenCalled()
    await api.tick('r1', '2026-10-26', 'i', true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a stale cache falls back to the ET date and asks the server again (a tab that slept past midnight)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-23T15:00:00Z'))
    const api = await freshApi()
    globalThis.fetch = vi.fn(answerWithToday('2026-10-23'))
    const first = api.readDay('routine', 'r1', 'today')
    await flushTimers()
    await first
    const fn = vi.fn()
    api.subscribe('routine', 'r1', 'today', fn)
    vi.setSystemTime(new Date('2026-10-26T15:00:00Z'))              // no timer ran: the tab was asleep
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done' }))
    await api.tick('r1', '2026-10-26', 'i', true)                   // the fallback is the ET date, which matches here
    expect(fn).toHaveBeenCalledTimes(1)
    await flushTimers()
    expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/j2/routines/days')).toBe(true)   // and it re-resolved
  })

  it('the midnight timer is armed by a today subscriber and cleared once none is left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-23T15:00:00Z'))
    const api = await freshApi()
    expect(vi.getTimerCount()).toBe(0)
    const dated = api.subscribe('routine', 'r1', '2026-10-23', () => {})
    expect(vi.getTimerCount()).toBe(0)                              // a dated subscriber needs no midnight
    const a = api.subscribe('routine', 'r1', 'today', () => {})
    const b = api.subscribe('tracker', 't1', 'today', () => {})
    expect(vi.getTimerCount()).toBe(1)
    a()
    expect(vi.getTimerCount()).toBe(1)
    b()
    expect(vi.getTimerCount()).toBe(0)
    dated()
  })
})

describe('ordering: an older result never overwrites a newer entry', () => {
  it("two tabs: B's newer write is not overwritten by A's older broadcast arriving later", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T15:00:00.100Z'))
    const api = await freshApi()
    const fn = vi.fn()
    api.subscribe('routine', 'r1', '2026-10-23', fn)
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done', by: 'B' }))
    await api.tick('r1', '2026-10-23', 'i', true)
    fn.mockClear()
    const tabA = new FakeBC('uct-nb-tools')
    const older = Date.now() - 50
    tabA.postMessage({ kind: 'routine', id: 'r1', day: '2026-10-23', entry: { by: 'A' }, at: older, seq: 1 })
    expect(fn).not.toHaveBeenCalled()
    tabA.postMessage({ kind: 'routine', id: 'r1', day: '2026-10-23', entry: { by: 'A' }, at: Date.now() + 50, seq: 2 })
    expect(fn).toHaveBeenCalledWith({ by: 'A' })                    // a genuinely newer broadcast still lands
  })

  it('two rapid ticks in one tab whose answers arrive out of order: the later-sent one stands', async () => {
    const api = await freshApi()
    const fn = vi.fn()
    api.subscribe('routine', 'r1', '2026-10-23', fn)
    const gates = []
    globalThis.fetch = vi.fn(() => new Promise((resolve) => gates.push(resolve)))
    const t1 = api.tick('r1', '2026-10-23', 'i1', true)
    const t2 = api.tick('r1', '2026-10-23', 'i2', true)
    gates[1](json(200, { ticks: ['i1', 'i2'] }))                    // the second answer arrives first
    await t2
    gates[0](json(200, { ticks: ['i1'] }))                          // the first, older-sent, answer arrives last
    expect(await t1).toEqual({ ok: true, entry: { ticks: ['i1'] } })    // the caller still gets its own answer
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith({ ticks: ['i1', 'i2'] })
    expect(FakeBC.posts.length).toBe(1)                             // and the stale one was not broadcast either
  })

  it('a visibility re-read answered after a write landed is not applied over it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-23T15:00:00.000Z'))
    const api = await freshApi()
    const fn = vi.fn()
    api.subscribe('routine', 'r1', '2026-10-23', fn)
    let answerRead
    globalThis.fetch = vi.fn(() => new Promise((resolve) => { answerRead = resolve }))
    fireVisible()
    await flushTimers()                                              // the read is on the wire
    vi.setSystemTime(new Date('2026-10-23T15:00:01.000Z'))
    globalThis.fetch = vi.fn(async () => json(200, { state: 'done', fresh: true }))
    await api.tick('r1', '2026-10-23', 'i', true)
    fn.mockClear()
    answerRead(json(200, routineAnswer(['r1'], ['2026-10-23'])))     // the OLD answer, late
    await flushTimers()
    await flushTimers()
    expect(fn).not.toHaveBeenCalled()
  })

  it('a re-read with no write after it is applied', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    const fn = vi.fn()
    api.subscribe('routine', 'r1', '2026-10-23', fn)
    fireVisible()
    await tick0()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('fix round 1: the minors', () => {
  it("a write's not_found reads missing", async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(404, { detail: { code: 'not_found', message: 'Not available.' } }))
    expect(await api.tick('r', '2026-10-01', 'i', true)).toMatchObject({ ok: false, code: 'missing' })
  })

  it('a bad day resolves missing with no request and never poisons the batch', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    const [bad, good, alsoBad] = await Promise.all([
      api.readDay('routine', 'a', 'tomorrow'), api.readDay('routine', 'a', '2026-10-23'), api.readDay('routine', 'a', '2026-1-3'),
    ])
    expect(bad).toEqual({ ok: false, code: 'missing' })
    expect(alsoBad).toEqual({ ok: false, code: 'missing' })
    expect(good.ok).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ ids: ['a'], days: ['2026-10-23'] })
  })

  it('a 400 for a whole chunk is invalid for every item waiting on it, not network', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(400, { detail: { code: 'invalid', message: 'x' } }))
    const got = await Promise.all([api.readDay('routine', 'a', '2026-10-23'), api.readDay('routine', 'b', '2026-10-22')])
    expect(got).toEqual([{ ok: false, code: 'invalid' }, { ok: false, code: 'invalid' }])
  })

  it('a 402 stays unavailable (a paid-plan refusal reads as not available)', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async () => json(402, { detail: 'Routines and trackers require a paid plan' }))
    expect(await api.readDay('routine', 'a', '2026-10-23')).toEqual({ ok: false, code: 'unavailable' })
  })

  it('a malformed body settles every waiting read as network, with no unhandled rejection', async () => {
    const api = await freshApi()
    const seen = []
    const onRej = (e) => seen.push(e)
    process.on('unhandledRejection', onRej)
    try {
      globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ get routines() { throw new Error('boom') } }) }))
      const got = await Promise.all([api.readDay('routine', 'a', '2026-10-23'), api.readDay('routine', 'b', '2026-10-22')])
      expect(got).toEqual([{ ok: false, code: 'network' }, { ok: false, code: 'network' }])
      await tick0()
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onRej)
    }
  })

  it('an id containing | survives a re-read (the parts are kept, never split from a key)', async () => {
    const api = await freshApi()
    globalThis.fetch = vi.fn(async (u, init) => { const b = JSON.parse(init.body); return json(200, routineAnswer(b.ids, b.days)) })
    const fn = vi.fn()
    api.subscribe('routine', 'a|b', '2026-10-23', fn)
    fireVisible()
    await tick0()
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ ids: ['a|b'], days: ['2026-10-23'] })
    expect(fn).toHaveBeenCalledWith({ state: 'open', day: '2026-10-23' })
  })
})
