/**
 * The worker client's FALLBACK path.
 *
 * jsdom has no real Worker, so every call here exercises the main-thread
 * fallback — which is exactly the path that must never break. If a browser
 * refuses to construct the module worker, or the worker throws, the page has to
 * keep working. Slow is acceptable; blank is not.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFlow, processFlow, mergeToday, tickerFlow, getLoadedKey, getLoadedMeta, setLoadedVersion, forgetLoaded, computeCsv, _resetFlowWorker } from './flowWorkerClient'
import { parseCSV, processFlowData } from './flowCompute'

const here = path.dirname(fileURLToPath(import.meta.url))
const CSV = fs.readFileSync(path.join(here, '__fixtures__', 'flow-sample.csv'), 'utf8')
const FILTER = { dateFilter: 'All', dateFrom: '', dateTo: '' }

describe('flowWorkerClient — main-thread fallback', () => {
  beforeEach(() => _resetFlowWorker())

  it('loads without a Worker present, and does NOT aggregate', async () => {
    const res = await loadFlow(CSV, FILTER, null, 'k')
    expect(res.ok).toBe(true)
    expect(res.usedWorker).toBe(false)      // proves we are on the fallback
    expect(res.rowCount).toBe(3419)
    expect(res.availableDates.length).toBeGreaterThan(0)
    // Aggregation is processFlow's job. If load aggregated too, the page would
    // do the duplicate pass this whole exercise exists to remove.
    expect(res.D).toBeUndefined()
  })

  it('remembers which range it holds, so a re-entry can skip the fetch', async () => {
    expect(getLoadedKey()).toBeNull()
    await loadFlow(CSV, FILTER, null, '/api/flow/data?days=1')
    expect(getLoadedKey()).toBe('/api/flow/data?days=1')
  })

  it('produces byte-for-byte the same aggregate the page would compute directly', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    const res = await processFlow(FILTER, null)
    const direct = processFlowData(parseCSV(CSV), null)
    expect(res.D.clean_confirmed.length).toBe(direct.clean_confirmed.length)
    expect(res.D.clean_confirmed.map(t => `${t.S}|${t.D}|${t.P}`).join(','))
      .toBe(direct.clean_confirmed.map(t => `${t.S}|${t.D}|${t.P}`).join(','))
  })

  it('publishes rowCount + dates for a re-entry, not just that it holds them', async () => {
    // THE RE-ENTRY HANG (shipped and caught live 2026-07-25): a remount resets
    // component state, so knowing the worker still HOLDS the rows is not enough.
    // Without rowCount coming back the processing effect's `if (!rowCount) return`
    // guard never fires and the page sits on "Processing flow data..." forever.
    expect(getLoadedMeta()).toBeNull()
    await loadFlow(CSV, FILTER, null, 'k')
    const meta = getLoadedMeta()
    expect(meta).not.toBeNull()
    expect(meta.rowCount).toBe(3419)
    expect(meta.availableDates.length).toBeGreaterThan(0)
  })

  it('publishes the data VERSION too, so a re-entry does not refetch what it just skipped', async () => {
    // Found by the live sweep: re-entry restored the rows but reported no
    // version, so planDelta read them as stale and refetched the whole 12.4MB
    // range we had just avoided downloading.
    await loadFlow(CSV, FILTER, null, 'k')
    setLoadedVersion('29750502')
    expect(getLoadedMeta().version).toBe('29750502')
  })

  it('keeps the published meta in step after a delta merge', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    await mergeToday(CSV, FILTER, null)
    expect(getLoadedMeta().rowCount).toBe(3419)
  })

  it('re-aggregates a loaded dataset under a new date selection', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    const all = await processFlow({ dateFilter: 'All', dateFrom: '', dateTo: '' }, null)
    const one = await processFlow({ dateFilter: 'Last1', dateFrom: '', dateTo: '' }, null)
    expect(all.ok && one.ok).toBe(true)
    expect(one.filteredCount).toBeLessThanOrEqual(all.filteredCount)
  })

  it('reports a real data error rather than pretending to succeed', async () => {
    const res = await loadFlow('not,a,flow,file\n', FILTER, null)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/0 valid rows/)
  })

  it('refuses to process before anything is loaded', async () => {
    const res = await processFlow(FILTER, null)
    expect(res.ok).toBe(false)
  })

  it('merges a delta by REPLACING that date, not appending duplicates', async () => {
    const first = await loadFlow(CSV, FILTER, null, 'k')
    // Feed the identical CSV back as "today's" delta: every date matches, so the
    // row count must stay put. Appending instead of replacing would double it.
    const merged = await mergeToday(CSV, FILTER, null)
    expect(merged.ok).toBe(true)
    expect(merged.rowCount).toBe(first.rowCount)
  })

  it('aggregates a single ticker for the search drill-in', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    const sym = parseCSV(CSV)[0].ticker.toUpperCase().trim()
    const res = await tickerFlow(sym, null)
    expect(res.ok).toBe(true)
    expect(res.rowCount).toBeGreaterThan(0)
  })

  it('returns a miss, not a throw, for a ticker that is not in the data', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    const res = await tickerFlow('ZZZZNOTREAL', null)
    expect(res.ok).toBe(true)
    expect(res.rowCount).toBe(0)
    expect(res.D).toBeNull()
  })
})

describe('worker dies mid-session', () => {
  // THE GAP THIS SUITE MISSED: every other test runs the fallback from the very
  // start, so fbRows is always populated. In production the WORKER does the load,
  // which means the main thread never holds the rows — and if the worker then
  // dies, the fallback has nothing. processFlow used to return
  // {ok:false,'no rows loaded'} and the page rendered that as an ERROR SCREEN,
  // which is exactly what "the page must never break because of the worker" was
  // supposed to prevent.
  beforeEach(() => _resetFlowWorker())

  it('asks the page to re-fetch instead of erroring when the dataset is gone', async () => {
    // Simulate the worker having owned the data: nothing was ever loaded on the
    // main thread, so there is no fallback copy.
    const res = await processFlow({ dateFilter: 'All' }, null)
    expect(res.ok).toBe(false)
    expect(res.needsReload, 'must signal a reload, not a user-facing error').toBe(true)
  })

  it('signals a reload from mergeToday and tickerFlow too', async () => {
    const m = await mergeToday(CSV, { dateFilter: 'All' }, null)
    expect(m.needsReload).toBe(true)
    const t = await tickerFlow('NVDA', null)
    expect(t.needsReload).toBe(true)
  })

  it('forgetLoaded clears the key so a re-entry cannot skip the refetch', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    expect(getLoadedKey()).toBe('k')
    forgetLoaded()
    expect(getLoadedKey()).toBeNull()
    expect(getLoadedMeta()).toBeNull()
  })

  it('recovers fully once the page re-fetches', async () => {
    // The re-fetch runs loadFlow, which repopulates the main-thread copy.
    const lost = await processFlow({ dateFilter: 'All' }, null)
    expect(lost.needsReload).toBe(true)
    await loadFlow(CSV, FILTER, null, 'k')
    const ok = await processFlow(FILTER, null)
    expect(ok.ok).toBe(true)
    expect(ok.D).not.toBeNull()
  })
})

describe('computeCsv — the Search drill-in', () => {
  // Clicking a ticker in Search fetches that symbol's UNCAPPED history from
  // /api/flow/ticker — NVDA is ~64k lines, about a second of frozen UI if parsed
  // and aggregated on the main thread. It cannot reuse tickerFlow (which filters
  // the STORED rows) because that feed deliberately contains history the loaded
  // range does not.
  beforeEach(() => _resetFlowWorker())

  it('aggregates an arbitrary CSV the caller already holds', async () => {
    const res = await computeCsv(CSV, null)
    expect(res.ok).toBe(true)
    expect(res.rowCount).toBe(3419)
    expect(res.D).not.toBeNull()
  })

  it('matches what the page would have computed inline', async () => {
    const res = await computeCsv(CSV, null)
    const direct = processFlowData(parseCSV(CSV), null)
    expect(res.D.clean_confirmed.map(t => `${t.S}|${t.D}|${t.P}`).join(','))
      .toBe(direct.clean_confirmed.map(t => `${t.S}|${t.D}|${t.P}`).join(','))
  })

  it('does NOT disturb the loaded dataset', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    const before = getLoadedMeta().rowCount
    const NL = String.fromCharCode(10)
    await computeCsv(['CreatedDate,CreatedTime,Symbol', '7/24/2026,9:30,ZZZZ', ''].join(NL), null)
    expect(getLoadedMeta().rowCount, 'a one-shot must not replace the stored rows').toBe(before)
    expect(getLoadedKey()).toBe('k')
    const still = await processFlow(FILTER, null)
    expect(still.ok).toBe(true)
    expect(still.filteredCount).toBe(before)
  })

  it('returns a null aggregate for an empty feed rather than throwing', async () => {
    const res = await computeCsv(['CreatedDate,Symbol', ''].join(String.fromCharCode(10)), null)
    expect(res.ok).toBe(true)
    expect(res.D).toBeNull()
  })
})

describe('dataset identity — the wrong-feed-under-the-right-header bug', () => {
  // AUDIT FINDING (critical): the worker holds exactly ONE dataset and neither
  // process nor merge checked WHICH one. Switching Stocks -> Indexes, or coming
  // back from GEX/Dark Pool, left a window where a process call aggregated the
  // PREVIOUS feed's rows and the page painted them under the new header. No
  // error, and rowCount still reconciled, so nothing looked wrong.
  beforeEach(() => _resetFlowWorker())

  it('refuses to aggregate when the caller expects a different dataset', async () => {
    await loadFlow(CSV, FILTER, null, '/api/flow/data?days=1')
    const wrong = await processFlow(FILTER, null, undefined, '/api/flow/indexes-data?days=1')
    expect(wrong.ok).toBe(false)
    expect(wrong.staleDataset, 'must flag a dataset mismatch, not silently aggregate').toBe(true)
    expect(wrong.D, 'must not hand back numbers from the other feed').toBeUndefined()
  })

  it('aggregates normally when the dataset matches', async () => {
    await loadFlow(CSV, FILTER, null, '/api/flow/data?days=1')
    const right = await processFlow(FILTER, null, undefined, '/api/flow/data?days=1')
    expect(right.ok).toBe(true)
    expect(right.D).not.toBeNull()
  })

  it('still works when no key is supplied (back-compat)', async () => {
    await loadFlow(CSV, FILTER, null, 'k')
    const res = await processFlow(FILTER, null)
    expect(res.ok).toBe(true)
  })

  it('refuses to splice a delta into a different dataset', async () => {
    await loadFlow(CSV, FILTER, null, '/api/flow/data?days=1')
    const m = await mergeToday(CSV, FILTER, null, '/api/flow/indexes-data?days=1')
    expect(m.ok).toBe(false)
    expect(m.staleDataset).toBe(true)
  })
})
