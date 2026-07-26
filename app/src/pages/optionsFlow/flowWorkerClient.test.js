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
import { loadFlow, processFlow, mergeToday, tickerFlow, getLoadedKey, getLoadedMeta, setLoadedVersion, _resetFlowWorker } from './flowWorkerClient'
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
