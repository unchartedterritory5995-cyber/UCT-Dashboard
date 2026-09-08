// First paint assembled from several responses instead of one.
//
// The failure this file exists to prevent is NOT "a request failed" — it is a
// bundle that merges parts from two different builds and renders a page that
// looks completely plausible and is wrong.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REQUIRED_PARTS, partUrlFrom, planBundle, retryablePartsFrom, fetchPartsBundle,
} from './flowParts.js'

const CSV = '/api/flow/data?days=1'
const boot = (v = '7', stats = { availableDates: ['9/4/2026'] }) =>
  ({ part: 'bootstrap', version: v, body: { ok: true, stats, D: { CONV: [1], TICKER_DB: {} } } })
const dir = (v = '7') => ({ part: 'all_directional', version: v, body: [{ sym: 'NVDA' }] })
const trd = (v = '7') => ({ part: 'all_trades', version: v, body: [{ S: 'NVDA' }] })
const good = (v = '7') => [boot(v), dir(v), trd(v)]

describe('the required part set', () => {
  it('is bootstrap + the two Market Read parts, and nothing else', () => {
    expect([...REQUIRED_PARTS]).toEqual(['bootstrap', 'all_directional', 'all_trades'])
  })

  it('does NOT include WATCH — the whole saving of this slice', () => {
    // WATCH is 463.8 KB gzipped on prod and is read by Tracker/Watchlist only.
    // If it creeps back in, this slice is worth ~4 KB and should be abandoned.
    expect(REQUIRED_PARTS).not.toContain('WATCH')
  })
})

describe('planBundle — snapshot consistency', () => {
  it('merges the parts into one D when every part agrees on a version', () => {
    const p = planBundle(good('29813766'))
    expect(p.ok).toBe(true)
    expect(p.version).toBe('29813766')
    expect(p.D.CONV).toEqual([1])
    expect(p.D.all_directional).toEqual([{ sym: 'NVDA' }])
    expect(p.D.all_trades).toEqual([{ S: 'NVDA' }])
  })

  it('carries stats through, so availableDates reaches the date picker', () => {
    // The Phase A dependency. Losing it here gates the control off exactly as a
    // bare-subset bootstrap would.
    expect(planBundle(good()).stats.availableDates).toEqual(['9/4/2026'])
  })

  it('⛔ DECLINES a bundle whose parts came from different builds', () => {
    // The server serves a STALE cached part when its build lock is held, so this
    // is a real arrival, not a hypothetical. Merging gives one build's totals
    // beside another's rows.
    const p = planBundle([boot('8'), dir('7'), trd('7')])
    expect(p).toEqual({ ok: false, reason: 'version-mismatch' })
  })

  it('⛔ an UNKNOWN version is not agreement', () => {
    // Three parts that each failed to report a version all stringify to "null"
    // and would sail through a naive "they all match" check.
    const p = planBundle([boot(null), dir(null), trd(null)])
    expect(p).toEqual({ ok: false, reason: 'version-unknown' })
  })

  it.each(REQUIRED_PARTS)('declines when %s is missing entirely', (name) => {
    const p = planBundle(good().filter((r) => r.part !== name))
    expect(p.ok).toBe(false)
    expect(p.reason).toBe(`missing:${name}`)
  })

  it('declines on a declined part rather than rendering a hole', () => {
    const p = planBundle([boot(), dir(), { part: 'all_trades', declined: true }])
    expect(p).toEqual({ ok: false, reason: 'declined:all_trades' })
  })

  it('declines a bootstrap that is not the {ok, stats, D} envelope', () => {
    const bad = { part: 'bootstrap', version: '7', body: { CONV: [1] } }   // bare subset
    expect(planBundle([bad, dir(), trd()]).reason).toBe('bootstrap-shape')
  })

  it('declines a deferred part that is not an array', () => {
    // Whole-D slipping through under a part key would land here.
    const bad = { part: 'all_trades', version: '7', body: { all_trades: [] } }
    expect(planBundle([boot(), dir(), bad]).reason).toBe('shape:all_trades')
  })

  it('never mutates the bootstrap body it was handed', () => {
    const b = boot()
    planBundle([b, dir(), trd()])
    expect(b.body.D.all_trades).toBeUndefined()
  })

  it('CONTROL: the happy path really does discriminate', () => {
    // Without this, every assertion above could pass against a function that
    // returns ok:false for everything.
    expect(planBundle(good()).ok).toBe(true)
  })
})

describe('retryablePartsFrom — a decline is expected, not exceptional', () => {
  it('retries the declined siblings when something else succeeded', () => {
    // The cold build is single-flight: one request builds, the others are
    // declined, and by the time it lands they are cached.
    const r = retryablePartsFrom([boot(), { part: 'all_directional', declined: true },
                                  { part: 'all_trades', declined: true }])
    expect(r.sort()).toEqual(['all_directional', 'all_trades'])
  })

  it('retries NOTHING when every part failed — the endpoint is not building', () => {
    const r = retryablePartsFrom([{ part: 'bootstrap', declined: true },
                                  { part: 'all_directional', declined: true }])
    expect(r).toEqual([])
  })

  it('does not retry a plain failure — it is not waiting on a build', () => {
    const r = retryablePartsFrom([boot(), { part: 'all_trades', failed: true }])
    expect(r).toEqual([])
  })
})

describe('partUrlFrom', () => {
  it('appends the part to an answerable view', () => {
    expect(partUrlFrom('/api/flow/aggregate?source=stocks&days=1', 'all_trades'))
      .toBe('/api/flow/aggregate?source=stocks&days=1&part=all_trades')
  })
  it('returns null for a view the endpoint cannot answer', () => {
    expect(partUrlFrom(null, 'bootstrap')).toBe(null)
  })
})

// ── the wire ───────────────────────────────────────────────────────────────
const res = (body, { status = 200, part, version = '7' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h === 'X-Flow-Part' ? part : h === 'X-Flow-Version' ? version : null) },
  json: async () => body,
})

describe('fetchPartsBundle', () => {
  it('assembles a bundle from three healthy part responses', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const p = new URL(url, 'https://x').searchParams.get('part')
      if (p === 'bootstrap') return res({ ok: true, stats: { availableDates: ['9/4/2026'] }, D: { CONV: [1] } }, { part: p })
      return res([{ s: p }], { part: p })
    })
    const out = await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl })
    expect(out.version).toBe('7')
    expect(out.D.all_trades).toEqual([{ s: 'all_trades' }])
    expect(out.stats.availableDates).toEqual(['9/4/2026'])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries declined siblings ONCE and then succeeds', async () => {
    // The cold-cache shape: bootstrap builds, the siblings are declined, and the
    // retry finds them cached.
    // ⛔ Keyed on the attempt ROUND, not on "bootstrap has resolved". Promise.all
    // invokes bootstrap first, so a flag flipped inside its handler is already
    // set when the siblings are called and they never decline at all — the
    // fixture then proves nothing and the retry path goes unexercised.
    let calls = 0
    const fetchImpl = vi.fn(async (url) => {
      const p = new URL(url, 'https://x').searchParams.get('part')
      const firstRound = calls++ < REQUIRED_PARTS.length
      if (p === 'bootstrap') return res({ ok: true, stats: {}, D: {} }, { part: p })
      if (firstRound) return res(null, { status: 503 })
      return res([], { part: p })
    })
    const out = await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl })
    expect(out).not.toBe(null)
    expect(fetchImpl).toHaveBeenCalledTimes(5)   // 3 + 2 retried
  })

  it('⛔ ONE clock for the bundle, not one per part', async () => {
    // Three 3 s waits in series is a nine-second blank screen. The deadline must
    // cover the whole attempt, retry included.
    const fetchImpl = () => new Promise(() => {})       // never resolves
    const t0 = Date.now()
    const out = await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl, deadlineMs: 120 })
    const elapsed = Date.now() - t0
    expect(out).toBe(null)
    expect(elapsed).toBeLessThan(400)                   // not 3 x 120 in series
  })

  it('gives up inside the deadline even when the RETRY is the slow half', async () => {
    let n = 0
    const fetchImpl = async (url) => {
      const p = new URL(url, 'https://x').searchParams.get('part')
      if (p === 'bootstrap') return res({ ok: true, stats: {}, D: {} }, { part: p })
      if (n++ < 2) return res(null, { status: 503 })
      return new Promise(() => {})                      // the retry hangs
    }
    const t0 = Date.now()
    expect(await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl, deadlineMs: 120 })).toBe(null)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('⛔ refuses a whole-D response wearing a part name', async () => {
    // An unknown part still falls through to whole-D, which answers 200 and sets
    // no X-Flow-Part. The header is the ONLY thing that distinguishes them.
    //
    // ⛔ THE FALL-THROUGH MUST BE THE **BOOTSTRAP** REQUEST. Whole-D returns
    // {ok, stats, D} — a perfectly valid bootstrap envelope — so the shape check
    // waves it through and the client silently swallows the entire 24 MB
    // aggregate as its bootstrap. Written against a DEFERRED part instead, the
    // array-shape check rejects it for an unrelated reason and the rail passes
    // whether the header is checked or not: deleting the header check left it
    // green, which is how this version came to exist.
    const fetchImpl = async (url) => {
      const p = new URL(url, 'https://x').searchParams.get('part')
      if (p === 'bootstrap') {
        return res({ ok: true, stats: { availableDates: [] }, D: { CONV: [1] } },
                   { part: null })          // 200, valid envelope, NO X-Flow-Part
      }
      return res([], { part: p })
    }
    expect(await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl })).toBe(null)
  })

  it('CONTROL: the same bundle IS accepted once bootstrap identifies itself', () => {
    // Proves the rejection above is the missing header and nothing else.
    const plan = planBundle([
      { part: 'bootstrap', version: '7',
        body: { ok: true, stats: { availableDates: [] }, D: { CONV: [1] } } },
      { part: 'all_directional', version: '7', body: [] },
      { part: 'all_trades', version: '7', body: [] },
    ])
    expect(plan.ok).toBe(true)
  })

  it('returns null for a view the aggregate cannot answer, without fetching', async () => {
    const fetchImpl = vi.fn()
    expect(await fetchPartsBundle('/api/flow/small-data?days=1', 'Last1', 7, { fetchImpl })).toBe(null)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never throws when the network does', async () => {
    const fetchImpl = async () => { throw new Error('offline') }
    expect(await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl })).toBe(null)
  })

  it('declines a mismatched bundle even when every request succeeded', async () => {
    const fetchImpl = async (url) => {
      const p = new URL(url, 'https://x').searchParams.get('part')
      const version = p === 'all_trades' ? '6' : '7'      // one stale part
      if (p === 'bootstrap') return res({ ok: true, stats: {}, D: {} }, { part: p, version })
      return res([], { part: p, version })
    }
    expect(await fetchPartsBundle(CSV, 'Last1', 7, { fetchImpl })).toBe(null)
  })
})

// ── the wire ───────────────────────────────────────────────────────────────
// Built, tested, green and connected to nothing is this repo's most-repeated
// defect. These derive the wiring from OptionsFlow.jsx itself.
describe('the parts path is actually WIRED into the page', () => {
  // ⛔ NORMALISE LINE ENDINGS. This repo checks out CRLF on Windows, and the
  // slice below anchors on `'USE_PARTS\n'`. When git re-checked the file out
  // during a rebase it became `USE_PARTS\r\n`, `indexOf` returned -1, the slice
  // silently became an EMPTY STRING, and the guard failed claiming the parts
  // path was unwired — while the wiring was untouched. A rail that fails for
  // an environmental reason is worse than no rail: it trains the next person
  // to ignore it. The wiring assertions are about CODE, not about which bytes
  // end a line.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../OptionsFlow.jsx'), 'utf8')
    .replace(/\r\n/g, '\n')

  it('first paint chooses the parts bundle when the flag is on', () => {
    expect(src).toContain('fetchPartsBundle(')
    const block = src.slice(src.indexOf('USE_PARTS\n'), src.indexOf(').then(pre => {'))
    expect(block).toContain('fetchPartsBundle(')
    expect(block).toContain('fetchPrehydrate(')
  })

  it('⛔ the flag defaults OFF — the parts path must be opt-in', () => {
    expect(src).toContain('VITE_FLOW_PARTS === "1"')
  })

  it('the bundle shares the ONE fallback budget, not a second clock', () => {
    // A bundle allowed to outlast the tape fallback would leave the member on a
    // blank screen while a rescue it already scheduled sat waiting behind it.
    const block = src.slice(src.indexOf('fetchPartsBundle('), src.indexOf(').then(pre => {'))
    expect(block).toContain('PREHYDRATE_FALLBACK_MS')
  })

  it('both transports feed the SAME consumer, so rollback strands nothing', () => {
    // One .then handles either result: the tape fallback, the availableDates
    // seed and the per-view guard must not be duplicated per transport.
    expect(src.split('.then(pre => {').length - 1).toBe(1)
  })

  it('CONTROL: the source really was read', () => {
    expect(src.length).toBeGreaterThan(100000)
    expect(src).toContain('TOP 10 FLOW PICKS')
  })
})
