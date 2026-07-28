import { describe, it, expect, beforeEach } from 'vitest'
import {
  planDelta,
  adoptVersion,
  baseFetchUrl,
  shouldFetchVersion,
  inFlowMarketWindow,
  readSnapshot,
  writeSnapshot,
  clearSnapshots,
  snapshotKey,
  shouldRefetchRange,
} from './flowLoadPolicy'

// Baseline: a mounted page that has finished its base fetch for the default
// (days=1) view, with a version that has not been merged yet.
const base = {
  dataVersion: '29750502',
  lastMergedVer: null,
  baseFetchedVer: '29750502',
  baseRowCount: 96178,
  dateFrom: '',
  dateTo: '',
  loadedFetchDays: 1,
  dataMode: 'stocks',
}

describe('planDelta — the days=1 redundancy', () => {
  it('SKIPS the network entirely when the base range is today-only and the base already covers this version', () => {
    // THE BUG: base fetch is `/api/flow/data?days=1` and the delta fetch is
    // `/api/flow/data?days=1&v=N` — the same one day. Running the delta
    // downloads the identical 12.7MB payload a second time (cache:"no-store",
    // so it cannot even be served from cache) and forces a second parseCSV +
    // a second full processFlowData.
    expect(planDelta(base)).toEqual({ action: 'skip', mergedVer: '29750502' })
  })

  it('refreshes via the BASE fetch (one pass) — not a delta — when today-only data is stale', () => {
    // A version bump during the session. The delta exists to keep a WIDE range
    // live cheaply; at days=1 the cheap refresh IS the base fetch.
    const stale = { ...base, dataVersion: '29750999', baseFetchedVer: '29750502' }
    expect(planDelta(stale)).toEqual({ action: 'refetch-base', mergedVer: '29750999' })
  })

  it('still fetches a real delta when the base range is WIDER than today', () => {
    expect(planDelta({ ...base, loadedFetchDays: 20 })).toEqual({ action: 'fetch-delta' })
  })

  it('still fetches a real delta for an all_data range', () => {
    expect(planDelta({ ...base, loadedFetchDays: 0 })).toEqual({ action: 'fetch-delta' })
  })

  it('treats an explicit calendar range as wider-than-today even if it is one day', () => {
    // A calendar pick asks the server for exact dates; the days=1 shortcut
    // does not describe that request, so keep the existing delta behaviour.
    const ranged = { ...base, dateFrom: '2026-07-16', dateTo: '2026-07-16' }
    expect(planDelta(ranged)).toEqual({ action: 'fetch-delta' })
  })
})

describe('planDelta — ordering and guards', () => {
  it('does nothing until the base rows have actually landed', () => {
    // THE RACE: version arrives ~80ms after mount, the base CSV takes ~2.6s.
    // The old code fired the delta immediately and then threw the merge away
    // (`if (!prev || !prev.length) return prev`) — a wasted 12.7MB fetch.
    expect(planDelta({ ...base, baseRowCount: 0 })).toEqual({ action: 'none' })
    expect(planDelta({ ...base, baseRowCount: null })).toEqual({ action: 'none' })
  })

  it('does nothing when this version was already merged', () => {
    expect(planDelta({ ...base, lastMergedVer: '29750502' })).toEqual({ action: 'none' })
  })

  it('does nothing before a version is known', () => {
    expect(planDelta({ ...base, dataVersion: null })).toEqual({ action: 'none' })
  })

  it('does nothing on the non-flow views', () => {
    expect(planDelta({ ...base, dataMode: 'gex' })).toEqual({ action: 'none' })
    expect(planDelta({ ...base, dataMode: 'darkpool' })).toEqual({ action: 'none' })
  })

  it('never loops: after a refetch-base the caller records mergedVer, which then plans none', () => {
    const stale = { ...base, dataVersion: '29750999', baseFetchedVer: '29750502' }
    const first = planDelta(stale)
    expect(first.action).toBe('refetch-base')
    const after = planDelta({ ...stale, lastMergedVer: first.mergedVer })
    expect(after).toEqual({ action: 'none' })
  })
})

describe('adoptVersion — the base/version race', () => {
  // Observed on prod after the first fix: /api/flow/data is browser-cached
  // (max-age=300) so the base can land in ~50ms, BEFORE /api/flow/version
  // resolves. The base was then stamped `null`, planDelta read that as "base
  // does not cover the current version", and fired a full refetch — three
  // base fetches on one page load. A base that landed before the version was
  // known IS current; the first version we learn is the one it represents.
  it('adopts the first known version for a base that landed before the version did', () => {
    expect(adoptVersion({ pending: true, dataVersion: '29750502', current: null }))
      .toEqual({ baseFetchedVer: '29750502', pending: false })
  })

  it('does not adopt once a real version is already stamped', () => {
    expect(adoptVersion({ pending: false, dataVersion: '29750999', current: '29750502' }))
      .toEqual({ baseFetchedVer: '29750502', pending: false })
  })

  it('stays pending while the version is still unknown', () => {
    expect(adoptVersion({ pending: true, dataVersion: null, current: null }))
      .toEqual({ baseFetchedVer: null, pending: true })
  })
})

describe('adoptVersion — X-Flow-Version defeats a stale cached payload', () => {
  // THE PROD BUG (2026-07-27, observed live at 8:54 PM ET): the page rendered
  // `7/24 · 862 confirmed of 21515` — Friday's tape — on a Monday night, while
  // a cache:'no-store' fetch of the SAME url in the SAME tab returned 120,074
  // rows all dated 7/27.
  //
  // Mechanism: Cloudflare served the version-stable url with max-age=14400, so
  // the body replayed from the browser disk cache in 20ms while
  // /api/flow/version took 921ms. `pending` was true, so the old rule adopted
  // the CURRENT version onto FRIDAY's bytes. planDelta then saw
  // baseFetchedVer === dataVersion and returned {action:'skip'} — permanently.
  //
  // The server now stamps X-Flow-Version on the payload, so the bytes describe
  // themselves and the client stops guessing.

  it('adopts the SERVED version, not the current one, when a cached body is replayed', () => {
    // Exactly the prod arrangement: base landed first (pending), version known,
    // but the bytes are old. Adopting `dataVersion` here is the bug.
    const r = adoptVersion({
      pending: true,
      dataVersion: '29753023',   // what the server says is current NOW
      current: null,
      served: '29751200',        // what these BYTES actually are (stale)
    })
    expect(r).toEqual({ baseFetchedVer: '29751200', pending: false })
    expect(r.baseFetchedVer).not.toBe('29753023')
  })

  it('END-TO-END: a stale served payload makes planDelta REFETCH instead of skip', () => {
    // This is the assertion that would have caught the Friday-tape-on-Monday
    // bug: adoptVersion feeds planDelta, and the pair must produce a refetch.
    const { baseFetchedVer } = adoptVersion({
      pending: true,
      dataVersion: '29753023',
      current: null,
      served: '29751200',
    })
    const plan = planDelta({ ...base, dataVersion: '29753023', baseFetchedVer })
    expect(plan.action).toBe('refetch-base')
  })

  it('a FRESH payload (served === current) still skips — no refetch storm', () => {
    // The fix must not reintroduce the three-base-fetches-per-load regression.
    const { baseFetchedVer } = adoptVersion({
      pending: true,
      dataVersion: '29753023',
      current: null,
      served: '29753023',
    })
    const plan = planDelta({ ...base, dataVersion: '29753023', baseFetchedVer })
    expect(plan.action).toBe('skip')
  })

  it('falls back to the old inference when the header is absent', () => {
    // An old edge object, or a proxy that strips unknown headers, must behave
    // exactly as before rather than refetching forever.
    expect(adoptVersion({ pending: true, dataVersion: '29750502', current: null, served: null }))
      .toEqual({ baseFetchedVer: '29750502', pending: false })
    expect(adoptVersion({ pending: true, dataVersion: '29750502', current: null, served: '' }))
      .toEqual({ baseFetchedVer: '29750502', pending: false })
  })

  it('coerces a numeric header to string so === against dataVersion holds', () => {
    // dataVersion is stored as a String(...) everywhere; a number here would
    // make every comparison mismatch and refetch on a loop.
    const r = adoptVersion({ pending: false, dataVersion: '29753023', current: null, served: 29753023 })
    expect(r.baseFetchedVer).toBe('29753023')
    expect(planDelta({ ...base, dataVersion: '29753023', baseFetchedVer: r.baseFetchedVer }).action)
      .toBe('skip')
  })
})

describe('baseFetchUrl — must be CF-cache correct', () => {
  it('uses the bare version-stable URL for first paint so the edge can serve it', () => {
    expect(baseFetchUrl('/api/flow/data?days=1', 0, '29750502')).toBe('/api/flow/data?days=1')
  })

  it('appends the version on a refresh — cache:"no-store" alone would get the stale edge copy', () => {
    expect(baseFetchUrl('/api/flow/data?days=1', 1, '29750502'))
      .toBe('/api/flow/data?days=1&v=29750502')
  })

  it('does not append when no version is known yet', () => {
    expect(baseFetchUrl('/api/flow/data?days=1', 1, null)).toBe('/api/flow/data?days=1')
  })
})

describe('shouldFetchVersion — the alt-tab re-process loop', () => {
  // Prod 2026-07-25, market CLOSED: processFlowData re-ran every 30-40s forever
  // (1,456 / 1,519 / 1,366 / 1,285 / 1,316 ms). The version is a 60s TIME
  // BUCKET, so every window focus rolled it -> refetch-base -> full reprocess.
  const t = 1_000_000

  it('never polls outside market hours — the data cannot have changed', () => {
    expect(shouldFetchVersion({ inMarketWindow: false, now: t, lastFetchAt: null })).toBe(false)
  })

  it('polls inside market hours on a fresh page', () => {
    expect(shouldFetchVersion({ inMarketWindow: true, now: t, lastFetchAt: null })).toBe(true)
  })

  it('rate-limits rapid focus/blur so alt-tabbing cannot thrash the tape', () => {
    expect(shouldFetchVersion({ inMarketWindow: true, now: t, lastFetchAt: t - 5000 })).toBe(false)
    expect(shouldFetchVersion({ inMarketWindow: true, now: t, lastFetchAt: t - 45000 })).toBe(true)
  })

  it('never polls a hidden tab', () => {
    expect(shouldFetchVersion({ inMarketWindow: true, visible: false, now: t, lastFetchAt: null })).toBe(false)
  })
})

describe('inFlowMarketWindow', () => {
  const et = (dow, h, m) => { const d = new Date(2026, 6, 20 + dow, h, m); return d }
  it('is open on a weekday inside 9:30-16:15', () => {
    expect(inFlowMarketWindow(et(1, 10, 0))).toBe(true)   // Tue 10:00
    expect(inFlowMarketWindow(et(1, 16, 15))).toBe(true)  // grace edge
  })
  it('is closed before the open, after the grace, and on weekends', () => {
    expect(inFlowMarketWindow(et(1, 9, 29))).toBe(false)
    expect(inFlowMarketWindow(et(1, 16, 16))).toBe(false)
    expect(inFlowMarketWindow(et(6, 11, 0))).toBe(false)  // Sunday
  })
})

describe('snapshot cache — instant re-entry', () => {
  beforeEach(() => clearSnapshots())

  const rows = [{ date: '7/24/2026', sym: 'NVDA' }]

  it('returns nothing for a cold key', () => {
    expect(readSnapshot(snapshotKey('/api/flow/data?days=1'))).toBeNull()
  })

  it('round-trips rows for the same URL so a re-mount needs no fetch and no parse', () => {
    const key = snapshotKey('/api/flow/data?days=1')
    writeSnapshot(key, { rows, version: '29750502' })
    expect(readSnapshot(key)).toEqual({ rows, version: '29750502' })
  })

  it('does not serve one range to another', () => {
    writeSnapshot(snapshotKey('/api/flow/data?days=1'), { rows, version: '1' })
    expect(readSnapshot(snapshotKey('/api/flow/data?days=20'))).toBeNull()
  })

  it('keeps only the newest entry so two 96k-row ranges are never held at once', () => {
    const a = snapshotKey('/api/flow/data?days=1')
    const b = snapshotKey('/api/flow/data?days=20')
    writeSnapshot(a, { rows, version: '1' })
    writeSnapshot(b, { rows, version: '1' })
    expect(readSnapshot(b)).not.toBeNull()
    expect(readSnapshot(a)).toBeNull()
  })

  it('refuses to cache an empty result so a failed load is never served as truth', () => {
    const key = snapshotKey('/api/flow/data?days=1')
    writeSnapshot(key, { rows: [], version: '1' })
    expect(readSnapshot(key)).toBeNull()
  })

  it('stores the processed view alongside the rows and only serves it for the same filters', () => {
    const key = snapshotKey('/api/flow/data?days=1')
    writeSnapshot(key, { rows, version: '1', processed: { D: 1 }, processedFor: 'Last1||' })
    expect(readSnapshot(key).processed).toEqual({ D: 1 })
    expect(readSnapshot(key).processedFor).toBe('Last1||')
  })
})

describe('shouldRefetchRange — a capped superset is not a superset', () => {
  it('refetches when widening (unchanged behaviour)', () => {
    expect(shouldRefetchRange(5, 1)).toBe(true)
    expect(shouldRefetchRange(0, 20)).toBe(true)
  })

  it('ALSO refetches when narrowing — the bug', () => {
    // Production caps every 2+ day range at the top 50,000 BY PREMIUM, so the
    // wide payload is a premium-filtered SAMPLE. The old rule sliced it instead
    // of refetching: "All" then "1d" rendered ~500 of that day's ~96,000 trades
    // while still labelled "1 trading day", and because the survivors are the
    // highest-premium rows every total and rank looked plausible.
    expect(shouldRefetchRange(1, 0), '1d after All must refetch').toBe(true)
    expect(shouldRefetchRange(1, 90), '1d after 90d must refetch').toBe(true)
    expect(shouldRefetchRange(5, 20), '5d after 20d must refetch').toBe(true)
    expect(shouldRefetchRange(20, 60)).toBe(true)
  })

  it('does not refetch when the window is already loaded', () => {
    expect(shouldRefetchRange(1, 1)).toBe(false)
    expect(shouldRefetchRange(0, 0)).toBe(false)
    expect(shouldRefetchRange(20, 20)).toBe(false)
  })
})
