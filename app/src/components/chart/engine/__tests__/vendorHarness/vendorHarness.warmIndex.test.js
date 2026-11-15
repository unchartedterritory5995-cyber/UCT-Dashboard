// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.warmIndex.test.js
//
// ─── The warm-candidate metadata index must never change a pick ───────────────
//
// `warmCandidates` reads each capture's metadata (symbol, timeframe, first/last bar, listing,
// capturedAt) from a gitignored on-disk index instead of parsing the whole fixture directory
// in every worker. A row is trusted only while the file's size and mtimeMs still match it.
// These rails hold the one property that makes the cache safe: for every committed capture
// the supplier picked through the index EQUALS the supplier a full scan picks, and a stale or
// unreadable index is rebuilt, never believed.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadCapture } from './harness'
import { warmBarsSupply, warmCandidates, resetWarmCandidateCache, WARM_INDEX_NAME, WARM_INDEX_SCHEMA } from './ourSide'

const DIR = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness')
const pickOf = (s) => ({ kind: s.kind, file: s.file, bars: s.bars, historyFromListing: s.historyFromListing })

describe('warm-candidate index', () => {
  it('⭐ for EVERY committed capture, the index-built pick equals the full-scan pick', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
    const diffs = []
    let warm = 0
    for (const f of files) {
      const { capture } = loadCapture(path.join(DIR, f))
      if (!capture || !capture.bars) continue
      const viaIndex = pickOf(warmBarsSupply(capture, { useIndex: true }))
      const full = pickOf(warmBarsSupply(capture, { useIndex: false }))
      if (JSON.stringify(viaIndex) !== JSON.stringify(full)) diffs.push(`${f}: index ${JSON.stringify(viaIndex)} vs full ${JSON.stringify(full)}`)
      if (full.kind === 'warm') warm += 1
    }
    expect(diffs).toEqual([])
    // non-vacuity: the comparison covered real warm picks, not only bar0/cold answers
    expect(warm).toBeGreaterThan(20)
  }, 900000)

  describe('⛔ a stale or unreadable index is rebuilt, never believed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uct-warm-index-'))
    const WINNER = 'vw-object-gc-b-spy-1d-2026-09-28.json'
    const RUNNER = 'vw-clock-close-tfchange-spy-1d-2026-09-28.json'
    const WINDOW = 'atr-trailing-stoploss-spy-1d-2026-10-03.json'
    for (const f of [WINNER, RUNNER, WINDOW]) fs.copyFileSync(path.join(DIR, f), path.join(tmp, f))
    const window = loadCapture(path.join(tmp, WINDOW)).capture
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it('control: with no index the earliest-captured listing supplier wins, and an index is written', () => {
      const full = warmBarsSupply(window, { dir: tmp, useIndex: false })
      expect(full.file).toBe(WINNER)
      warmCandidates({ dir: tmp, useIndex: true }) // builds the metadata and writes the index
      expect(fs.existsSync(path.join(tmp, WARM_INDEX_NAME))).toBe(true)
    })

    it('a row whose file changed (size or mtime) is rebuilt from the file, so a poisoned row cannot exclude the winner', () => {
      const idxFile = path.join(tmp, WARM_INDEX_NAME)
      const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'))
      const st = fs.statSync(path.join(tmp, WINNER))
      // the winner's row is stale (its size no longer matches) and poisoned: it claims to start
      // after the window, so believing it would drop the winner and pick the runner-up
      idx.rows[WINNER] = { ...idx.rows[WINNER], size: st.size + 1, firstT: Number.MAX_SAFE_INTEGER }
      fs.writeFileSync(idxFile, JSON.stringify(idx))
      resetWarmCandidateCache()
      const viaIndex = warmBarsSupply(window, { dir: tmp, useIndex: true })
      expect(viaIndex.file).toBe(WINNER)
      expect(pickOf(viaIndex)).toEqual(pickOf(warmBarsSupply(window, { dir: tmp, useIndex: false })))
    })

    it('an unreadable index is ignored and rewritten', () => {
      const idxFile = path.join(tmp, WARM_INDEX_NAME)
      fs.writeFileSync(idxFile, '{ not json')
      resetWarmCandidateCache()
      const viaIndex = warmBarsSupply(window, { dir: tmp, useIndex: true })
      expect(viaIndex.file).toBe(WINNER)
      expect(JSON.parse(fs.readFileSync(idxFile, 'utf8')).schema).toBe(WARM_INDEX_SCHEMA)
    })
  })
})
