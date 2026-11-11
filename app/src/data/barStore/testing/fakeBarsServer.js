// Test-only: a global `fetch` that answers /api/bars like the server would at Date.now()
// (P1 contract fields for intraday, plain date rows for D/W/M; synthetic prices), held until
// the test releases it — so a suite can count requests, watch concurrency and abort.
// Never imported by product code.
import { vi } from 'vitest'
import { bucketStartUnix } from '../../../components/chart/barTime'
import { bucketEndUnix } from '../../../components/chart/liveBuckets'

export const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 2026-11-10 09:30 ET

export function parseBarsUrl(url) {
  const u = new URL(String(url), 'http://x')
  const sym = decodeURIComponent(u.pathname.split('/').pop())
  const since = u.searchParams.get('since')
  return {
    sym, tf: u.searchParams.get('tf'), bars: Number(u.searchParams.get('bars')),
    since: since != null ? Number(since) : null, to: u.searchParams.get('to'), warm: u.searchParams.has('warm'),
  }
}

/** Intraday rows from the open to `now` (unix s) on `tf`, newer than `since`. */
export function intradayRows(tf, now, { since = null, from = OPEN } = {}) {
  const out = []
  for (let t = from; t <= now; t = bucketEndUnix(t, tf, {})) {
    const s = bucketStartUnix(t, tf, {})
    if (since != null && s <= since) continue
    out.push({ t: s, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  }
  return out
}

/** The server's answer for a parsed request at Date.now(). `mode`: ok | behind | nodata | shed | fail */
export function serverAnswer(q, mode = 'ok') {
  if (mode === 'nodata') return { body: { bars: [], no_data: true } }
  if (mode === 'shed') return { body: { error: 'warming' }, status: 503, headers: { 'Retry-After': '3' } }
  if (mode === 'fail') return { body: { detail: 'boom' }, status: 500 }
  if (['D', 'W', 'M'].includes(q.tf)) {
    return { body: { ticker: q.sym, tf: q.tf, bars: ['2026-11-06', '2026-11-09', '2026-11-10'].map((t) => ({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })) } }
  }
  const tf = Number(q.tf)
  const now = Math.floor(Date.now() / 1000)
  if (mode === 'behind') {
    // A legacy answer (no contract fields) whose newest row is 09:40: a halt.
    return { body: { ticker: q.sym, tf: q.tf, bars: intradayRows(tf, OPEN + 600, { since: q.since }) } }
  }
  const bars = intradayRows(tf, now, { since: q.since })
  let C = null
  for (const b of bars) { const e = bucketEndUnix(b.t, tf, {}); if (e <= now - 45) C = e }
  const last = bars[bars.length - 1]
  return {
    body: {
      ticker: q.sym, tf: q.tf, bars, contract: 1, grid: 'eth-clock', session: 'rth',
      cache_key: `b1:${q.sym}:${q.tf}:eth-clock`, series_rev: Date.now(), history_rev: 1,
      verified_through: now, complete_through: C, tail_status: 'verified',
      developing: last && bucketEndUnix(last.t, tf, {}) > now ? { ...last, rev: Date.now() } : null,
    },
  }
}

/**
 * Install a held fetch. `modeFor(q)` picks the answer per request (default 'ok').
 * Returns { calls, pending, live, maxLive, release(i?), releaseAll(), flush() }.
 */
export function installFakeBarsServer({ modeFor = () => 'ok' } = {}) {
  const st = { calls: [], pending: [], live: 0, maxLive: 0 }
  globalThis.fetch = vi.fn((url, opts) => new Promise((resolve, reject) => {
    const q = parseBarsUrl(url)
    const call = { url: String(url), q, opts, done: false }
    st.calls.push(call)
    st.live++; st.maxLive = Math.max(st.maxLive, st.live)
    const finish = () => { if (!call.done) { call.done = true; st.live-- } }
    call.respond = () => {
      if (call.done) return
      finish()
      const { body, status = 200, headers = {} } = serverAnswer(q, modeFor(q))
      resolve({ ok: status >= 200 && status < 300, status, headers: { get: (h) => headers[h] ?? null }, json: async () => body, clone() { return this } })
    }
    opts?.signal?.addEventListener?.('abort', () => {
      if (call.done) return
      finish(); call.aborted = true
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
    })
    st.pending.push(call)
  }))
  const flush = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }
  return {
    st,
    get calls() { return st.calls },
    open: () => st.calls.filter((c) => !c.done),
    flush,
    /** Answer every open request, repeatedly, until none is left (or `rounds`). */
    async drain({ rounds = 200, advance = null } = {}) {
      for (let i = 0; i < rounds; i++) {
        await flush()
        const open = st.calls.filter((c) => !c.done)
        if (!open.length) {
          if (!advance) return
          await advance()
          await flush()
          if (!st.calls.some((c) => !c.done)) return
          continue
        }
        for (const c of open) c.respond()
      }
    },
  }
}
