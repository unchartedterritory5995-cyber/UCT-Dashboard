import { describe, it, expect, beforeEach } from 'vitest'
import {
  planDelta,
  readSnapshot,
  writeSnapshot,
  clearSnapshots,
  snapshotKey,
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
