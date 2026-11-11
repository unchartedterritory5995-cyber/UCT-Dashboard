// INVARIANTS (W-S 2026-11-11) — intraday deep history is a LEFT PREPEND, fuzzed:
//   H1 prependOlder(cur, win) ends with `cur` EXACTLY (same objects, same order): the newest
//      bar / developing candle / every tail-poll bar is untouched — scroll-back can never
//      move the right edge. Strictly ascending; never shorter; only bars older than cur[0].
//   H2 A member scrolling back over ANY history (any listing date, any window size) reaches
//      the listing bar, holding a contiguous suffix of the true history after every window,
//      and stops asking once the listing is reached.
//   H3 The loader: <=1 request per key, warming/filling are retried (not "exhausted"), a
//      window with nothing older is remembered as the floor.
//   H4 IDB history segment: persist then hydrate gives back the series (up to the cap), the
//      persisted depth never shrinks on a shallower later write, and a basis heal deletes it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { barsBeforeUrl as urlFor } from './prefetchBars'
import {
  historyReachesTail, historyLagsTail, TAIL_ENTRY_MAX_BARS,
  prependOlder, wantsOlder, etDateOf, historyWindowUrl, createHistoryLoader,
  HISTORY_WINDOW_BARS, EXHAUSTED_TTL_MS, ERROR_BACKOFF_BASE_MS, ERROR_BACKOFF_MAX_MS,
} from './historyPrepend'

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

// An RTH-ish 15m history: 26 bars per weekday session, ET-aligned (EDT/EST handled by Intl).
function history(sessions, startISO = '2026-01-05') {
  const out = []
  const d = new Date(startISO + 'T12:00:00Z')
  let n = 0
  while (n < sessions) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) {
      const ymd = d.toISOString().slice(0, 10)
      // 09:30 ET as UTC: find the offset via Intl (EDT -4 / EST -5)
      const probe = new Date(ymd + 'T14:30:00Z')
      const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(probe))
      const open = Math.floor(probe.getTime() / 1000) + (9 - etHour) * 3600
      for (let k = 0; k < 26; k++) out.push({ t: open + k * 900, o: 10, h: 10, l: 10, c: 10, v: 1 })
      n++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe('H1 prependOlder (fuzz, 500 cases)', () => {
  it('result = older-only bars + cur verbatim; ascending; never shorter', () => {
    const r = rng(1101)
    for (let i = 0; i < 500; i++) {
      const base = 1_000_000 + Math.floor(r() * 1000) * 900
      const cur = []
      for (let t = base, n = 1 + Math.floor(r() * 50); cur.length < n; t += 900) cur.push({ t, c: 10, tag: 'cur' })
      const win = []
      const wStart = base - Math.floor(r() * 80) * 900
      for (let t = wStart, n = Math.floor(r() * 120); win.length < n; t += 900) if (r() > 0.1) win.push({ t, c: 10, tag: 'win' })
      if (r() < 0.2) win.reverse()                             // order not trusted
      if (r() < 0.2 && win.length) win.push({ ...win[0] })      // duplicates not trusted
      const out = prependOlder(cur, win)
      expect(out.slice(out.length - cur.length)).toEqual(cur)
      for (let k = 0; k < cur.length; k++) expect(out[out.length - cur.length + k]).toBe(cur[k])
      for (let k = 1; k < out.length; k++) expect(out[k].t).toBeGreaterThan(out[k - 1].t)
      expect(out.length).toBeGreaterThanOrEqual(cur.length)
      if (!win.some(b => b.t < cur[0].t)) expect(out).toBe(cur)   // identity: nothing to repaint
    }
  })
  it('a window on another price basis (>2% at the shared oldest bar) is refused whole', () => {
    const cur = [{ t: 1000, c: 100 }, { t: 1900, c: 100 }]
    expect(prependOlder(cur, [{ t: 100, c: 25 }, { t: 1000, c: 25 }])).toBe(cur)
    expect(prependOlder(cur, [{ t: 100, c: 100 }, { t: 1000, c: 100.5 }]).length).toBe(3)
  })
})

// A fake `/api/bars?...&to=` that behaves like `_get_bars_to_response`: the last N bars at or
// before the end of the ET day `to`.
function fakeServer(full) {
  const calls = []
  const fetchJson = async (url) => {
    calls.push(url)
    const to = url.match(/[?&]to=(\d{4}-\d{2}-\d{2})/)[1]
    const n = Number(url.match(/[?&]bars=(\d+)/)[1])
    const upto = full.filter(b => etDateOf(b.t) <= to)
    return { bars: upto.slice(Math.max(0, upto.length - n)) }
  }
  return { fetchJson, calls }
}

describe('H2 a member scrolling back always reaches the listing (fuzz)', () => {
  it('contiguous suffix after every window, right edge fixed, stops at the listing', async () => {
    const r = rng(42)
    for (let i = 0; i < 25; i++) {
      const full = history(5 + Math.floor(r() * 120), '2025-10-01')
      const firstPaint = Math.min(full.length, 50 + Math.floor(r() * 1200))
      let cur = full.slice(full.length - firstPaint)
      const right = cur[cur.length - 1]
      const { fetchJson, calls } = fakeServer(full)
      const L = createHistoryLoader({ urlFor, fetchJson })
      const win = 100 + Math.floor(r() * 2500)
      for (let step = 0; step < 400; step++) {
        const res = await L.loadOlder('K', { sym: 'X', tf: '15', oldestT: cur[0].t, bars: win })
        cur = prependOlder(cur, res.bars)
        expect(cur[cur.length - 1]).toBe(right)
        expect(cur).toEqual(full.slice(full.length - cur.length))            // contiguous suffix
        if (res.exhausted) break
      }
      expect(cur[0].t).toBe(full[0].t)                                      // reached the listing
      const n = calls.length
      await L.loadOlder('K', { sym: 'X', tf: '15', oldestT: cur[0].t, bars: win })
      expect(calls.length).toBe(n)                                          // floor remembered
    }
  })
})

describe('H3 loader', () => {
  it('one request per key in flight; a second ask joins it', async () => {
    let release
    const fetchJson = vi.fn(() => new Promise((res) => { release = () => res({ bars: [{ t: 1 }] }) }))
    const L = createHistoryLoader({ urlFor, fetchJson })
    const a = L.loadOlder('K', { sym: 'X', tf: '5', oldestT: 1_800_000_000 })
    const b = L.loadOlder('K', { sym: 'X', tf: '5', oldestT: 1_800_000_000 })
    expect(fetchJson).toHaveBeenCalledTimes(1)
    release()
    expect(await a).toBe(await b)
  })
  it('warming 503 and `filling` are retried, not treated as the floor', async () => {
    const w = new Error('HTTP 503'); w.warming = true; w.retryAfterMs = 3000
    let now = 0
    const L = createHistoryLoader({ urlFor, now: () => now, fetchJson: vi.fn().mockRejectedValueOnce(w).mockResolvedValueOnce({ bars: [], filling: true }) })
    const o = { sym: 'X', tf: '60', oldestT: 1_800_000_000 }
    expect(await L.loadOlder('K', o)).toMatchObject({ exhausted: false, retryAfterMs: 3000 })
    now = 3000                                               // the Retry-After has passed
    expect(await L.loadOlder('K', o)).toMatchObject({ exhausted: false, retryAfterMs: 3000 })
    expect(L.isExhausted('K', o.oldestT)).toBe(false)
  })
  it('a failing key backs off exponentially (capped); a success resets it', async () => {
    let now = 0
    const fetchJson = vi.fn(async () => { throw new Error('HTTP 500') })
    const L = createHistoryLoader({ urlFor, fetchJson, now: () => now })
    const o = { sym: 'X', tf: '5', oldestT: 1_800_000_000 }
    const waits = []
    for (let i = 0; i < 8; i++) {
      const r = await L.loadOlder('K', o)
      waits.push(r.retryAfterMs)
      expect((await L.loadOlder('K', o)).backoff).toBe(true)       // panning again: no request
      now += r.retryAfterMs
    }
    expect(fetchJson).toHaveBeenCalledTimes(8)
    expect(waits.slice(0, 3)).toEqual([ERROR_BACKOFF_BASE_MS, 2 * ERROR_BACKOFF_BASE_MS, 4 * ERROR_BACKOFF_BASE_MS])
    expect(Math.max(...waits)).toBe(ERROR_BACKOFF_MAX_MS)
    fetchJson.mockImplementation(async () => ({ bars: [{ t: 1 }] }))
    expect((await L.loadOlder('K', o)).bars.length).toBe(1)
    fetchJson.mockImplementation(async () => { throw new Error('HTTP 500') })
    expect((await L.loadOlder('K', o)).retryAfterMs).toBe(ERROR_BACKOFF_BASE_MS)   // reset
  })
  it('a warming answer honours Retry-After before the next request', async () => {
    let now = 0
    const w = new Error('HTTP 503'); w.warming = true; w.retryAfterMs = 5000
    const fetchJson = vi.fn().mockRejectedValueOnce(w).mockResolvedValue({ bars: [{ t: 1 }] })
    const L = createHistoryLoader({ urlFor, fetchJson, now: () => now })
    const o = { sym: 'X', tf: '5', oldestT: 1_800_000_000 }
    expect((await L.loadOlder('K', o)).retryAfterMs).toBe(5000)
    now = 4999
    expect((await L.loadOlder('K', o)).backoff).toBe(true)
    now = 5000
    expect((await L.loadOlder('K', o)).bars.length).toBe(1)
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })
  it('the caller\'s AbortSignal reaches the fetch; an abort is "canceled", not an error to back off from', async () => {
    const ctl = new AbortController()
    let seen = null
    const fetchJson = vi.fn((url, { signal }) => new Promise((res, rej) => {
      seen = signal
      signal.addEventListener('abort', () => { const e = new Error('switch-aborted'); e.canceled = true; rej(e) })
    }))
    const L = createHistoryLoader({ urlFor, fetchJson })
    const o = { sym: 'X', tf: '5', oldestT: 1_800_000_000, signal: ctl.signal }
    const p = L.loadOlder('K', o)
    expect(seen).toBe(ctl.signal)
    ctl.abort()
    expect(await p).toMatchObject({ canceled: true })
    expect(L._state()).toMatchObject({ inflight: 0, backoff: 0 })
  })
  it('the floor expires after EXHAUSTED_TTL_MS', async () => {
    let now = 0
    const fetchJson = vi.fn(async () => ({ bars: [] }))
    const L = createHistoryLoader({ urlFor, fetchJson, now: () => now })
    const o = { sym: 'X', tf: '1', oldestT: 1_800_000_000 }
    expect((await L.loadOlder('K', o)).exhausted).toBe(true)
    await L.loadOlder('K', o)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    now = EXHAUSTED_TTL_MS + 1
    await L.loadOlder('K', o)
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })
})

describe('window URL / trigger', () => {
  it('a window is larger than any ET day (1m ETH = 960 bars), so to=<oldest day> always reaches older bars', () => {
    expect(HISTORY_WINDOW_BARS).toBeGreaterThan(960)
  })
  it('to= is the ET date of the oldest bar, DST-correct, carries the session', () => {
    // 2026-11-02 00:30 UTC = 2026-11-01 19:30 EST (after the DST end)
    expect(etDateOf(Date.UTC(2026, 10, 2, 0, 30) / 1000)).toBe('2026-11-01')
    // 2026-07-01 03:30 UTC = 2026-06-30 23:30 EDT
    expect(etDateOf(Date.UTC(2026, 6, 1, 3, 30) / 1000)).toBe('2026-06-30')
    expect(historyWindowUrl(urlFor, 'BRK.B', '60', Date.UTC(2026, 6, 1, 14) / 1000, '&session=eth'))
      .toBe(`/api/bars/BRK.B?tf=60&bars=${HISTORY_WINDOW_BARS}&session=eth&to=2026-07-01`)
  })
  it('fires while the left edge is within LOOKAHEAD_SCREENS widths of the oldest bar', () => {
    expect(wantsOlder({ fromIndex: 1000, toIndex: 1200, loadedCount: 1200 })).toBe(false)
    expect(wantsOlder({ fromIndex: 390, toIndex: 590, loadedCount: 1200 })).toBe(true)
    expect(wantsOlder({ fromIndex: 30, toIndex: 40, loadedCount: 1200 })).toBe(true)     // 50-bar floor
    expect(wantsOlder({ fromIndex: 10, toIndex: 5, loadedCount: 1200 })).toBe(false)
  })
})

// ── H4: the IDB history segment, through the ONE monotonic write path ──────────────
function installFakeIDB() {
  const rows = new Map()
  const later = (fn) => setTimeout(fn, 0)
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {}
      let pending = 0
      const settle = () => { if (--pending === 0) later(() => tx.oncomplete?.()) }
      tx.objectStore = () => ({
        get(key) { pending++; const r = {}; later(() => { r.result = rows.get(key); r.onsuccess?.(); settle() }); return r },
        put(v) { pending++; later(() => { rows.set(v.key, structuredClone(v)); settle() }); return {} },
        delete(k) { pending++; later(() => { rows.delete(k); settle() }); return {} },
      })
      return tx
    },
  }
  vi.stubGlobal('indexedDB', { open: () => { const r = {}; later(() => { r.result = db; r.onsuccess?.({ target: r }) }); return r } })
  return rows
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('H4 IDB deep-history segment', () => {
  it('persist then hydrate = the series; the tail entry stays capped; depth never shrinks', async () => {
    const rows = installFakeIDB()
    const idb = await import('./barsIDB')
    const series = history(400, '2025-01-06')                // 10,400 15m bars
    await idb.idbPutHistory('DEEP', '15', series)
    expect(rows.get('DEEP_15@hist').bars.length).toBe(series.length)
    // A later visit: the 3000-bar tail entry + the segment rebuild the whole series.
    const tail = series.slice(series.length - idb.INTRADAY_MAX_BARS)
    const hist = await idb.idbGetHistory('DEEP', '15')
    expect(historyReachesTail(hist, tail)).toBe(true)
    expect(prependOlder(tail, hist)).toEqual(series)
    // A shallower later write (4000 bars ending later) keeps the deeper stored history.
    const later = series.slice(series.length - 4000)
    await idb.idbPutHistory('DEEP', '15', later)
    const after = rows.get('DEEP_15@hist').bars
    expect(after[0].t).toBe(series[0].t)
    expect(after.length).toBe(series.length)
  })
  it('the segment is capped to HISTORY_SEGMENT_MAX (newest kept) and a short series writes nothing', async () => {
    const rows = installFakeIDB()
    const idb = await import('./barsIDB')
    const huge = history(Math.ceil((idb.HISTORY_SEGMENT_MAX + 600) / 26), '2024-01-02')
    await idb.idbPutHistory('BIG', '5', huge)
    const got = rows.get('BIG_5@hist').bars
    expect(got.length).toBe(idb.HISTORY_SEGMENT_MAX)
    expect(got.at(-1)).toEqual(huge.at(-1))
    await idb.idbPutHistory('SMALL', '5', history(10))
    expect(rows.has('SMALL_5@hist')).toBe(false)
  })
  it('a segment that does not reach the tail is never spliced (no hole drawn as contiguous)', async () => {
    const idb = await import('./barsIDB')
    const s = history(200, '2025-03-03')
    expect(historyReachesTail(s.slice(0, 1000), s.slice(2000))).toBe(false)
    expect(historyReachesTail(s.slice(0, 2001), s.slice(2000))).toBe(true)
  })
  it('the basis heal (idbDelete) drops the segment with the tail; daily never gets one', async () => {
    const rows = installFakeIDB()
    const idb = await import('./barsIDB')
    await idb.idbPutHistory('POI', '30', history(200))
    expect(rows.has('POI_30@hist')).toBe(true)
    await idb.idbDelete('POI', '30')
    expect(rows.has('POI_30@hist')).toBe(false)
    expect(await idb.idbPutHistory('DLY', 'D', history(200))).toBeNull()
  })
  it('the segment expires HISTORY_SEGMENT_MAX_AGE_MS after it was CREATED — merging into it does not renew it', async () => {
    const rows = installFakeIDB()
    const idb = await import('./barsIDB')
    const s = history(200)
    const DAY = 86400000
    rows.set('OLD_15@hist', { key: 'OLD_15@hist', bars: s, lastT: s.at(-1).t, savedAt: Date.now() - DAY, createdAt: Date.now() - 6 * DAY, v: idb._CACHE_LOGIC_VERSION })
    expect(await idb.idbGetHistory('OLD', '15')).not.toBeNull()
    await idb.idbPutHistory('OLD', '15', s.slice(s.length - 4000))
    expect(rows.get('OLD_15@hist').createdAt).toBeLessThan(Date.now() - 5 * DAY)   // carried, not renewed
    rows.get('OLD_15@hist').createdAt = Date.now() - 8 * DAY
    expect(await idb.idbGetHistory('OLD', '15')).toBeNull()                       // expired
    // an expired record is not a merge base: a new write replaces it whole and starts a new clock
    const fresh = s.slice(s.length - 3500)
    await idb.idbPutHistory('OLD', '15', fresh)
    expect(rows.get('OLD_15@hist').bars.length).toBe(fresh.length)
    expect(rows.get('OLD_15@hist').createdAt).toBeGreaterThan(Date.now() - DAY)
  })
  it('the restated tail cap never drifts from barsIDB', async () => {
    const idb = await import('./barsIDB')
    expect(TAIL_ENTRY_MAX_BARS).toBe(idb.INTRADAY_MAX_BARS)
  })
  it('the tail outrunning the segment triggers a refresh write', async () => {
    const idb = await import('./barsIDB')
    const s = history(300)
    const n = s.length
    expect(historyLagsTail(s[n - 1].t, s)).toBe(false)
    expect(historyLagsTail(s[n - idb.INTRADAY_MAX_BARS + 10].t, s)).toBe(true)
  })
})
