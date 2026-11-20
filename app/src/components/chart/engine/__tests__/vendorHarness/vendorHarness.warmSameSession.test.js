// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.warmSameSession.test.js
//
// ─── A WARM SUPPLIER MUST BE THE WINDOW'S OWN SERIES, BOTH WAYS (2026-11-17) ──────
//
// `warmBarsSupply` proved a candidate's prehistory by checking that every WINDOW bar is in the
// candidate, equal. An extended-hours capture holds every regular-hours bar, equal, so it proved
// against a regular-hours window and handed it EXTENDED-HOURS prehistory: on master @ e92e54efb7,
// `rolling-vwap-spy-5-2026-11-16` (session 0400-2000, the deepest SPY 5m capture) supplied three
// 0930-1600 SPY 5m windows. The fix adds the other direction: every candidate bar inside the
// window's span must be in the window.
//
// These rails read the session LABEL (`symbol.session`) as an independent witness to the bar
// check the fix makes: the code decides by bars, the rail checks by label, so neither can agree
// with itself by construction.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { warmBarsSupply } from './ourSide'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const read = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
const ETH_SUPPLIER = 'rolling-vwap-spy-5-2026-11-16.json'
// the three regular-hours windows it supplied before the fix
const RTH_WINDOWS = [
  'h3-vwap-source-spy-5-2026-10-02.json',
  'vw-request-htf-alignment-spy-5-2026-10-02.json',
  'vw-time-tf-spy-5-2026-10-01.json',
]
// an extended-hours window it must STILL supply (the control: the fix is not a blanket refusal)
const ETH_WINDOW = 'vw-time-tf-spy-5-ext-2026-10-02.json'

describe('warm supply — the supplier is the window\'s own session', () => {
  it('the premise: the supplier is extended-hours and the three windows are regular-hours', () => {
    expect(read(ETH_SUPPLIER).symbol.session).toBe('0400-2000')
    for (const f of RTH_WINDOWS) expect(read(f).symbol.session, f).toBe('0930-1600')
    expect(read(ETH_WINDOW).symbol.session).toBe('0400-2000')
  })

  it.each(RTH_WINDOWS)('%s takes no prehistory from the extended-hours supplier, and says why', (f) => {
    const s = warmBarsSupply(read(f))
    expect(s.file).not.toBe(ETH_SUPPLIER)
    const why = (s.refused || []).find((r) => r.startsWith(`${ETH_SUPPLIER}:`))
    expect(why, JSON.stringify(s.refused)).toMatch(/lies inside the window's span and the window has no such bar/)
    if (s.kind === 'warm') expect(read(s.file).symbol.session, s.file).toBe('0930-1600')
  })

  it('the control: the extended-hours window is still warm from the extended-hours supplier', () => {
    const s = warmBarsSupply(read(ETH_WINDOW))
    expect(s.kind).toBe('warm')
    expect(s.file).toBe(ETH_SUPPLIER)
    expect(s.bars).toBeGreaterThan(0)
  })

  // The fixture set is ~600 MB, mostly daily. A capture's `timeframe` sits in its first few hundred bytes
  // (schema, id, capturedAtUTC, tool, page, symbol, timeframe, ...), so the census reads that much to skip
  // the daily, weekly and monthly ones, and parses in full any file whose header does not say (fails closed).
  const INTRADAY_TF = /^\d+S?$/
  const headerTimeframeOf = (f) => {
    const fd = fs.openSync(path.join(DIR, f), 'r')
    try {
      const buf = Buffer.alloc(4096)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      const m = /"timeframe"\s*:\s*"([^"]+)"/.exec(buf.toString('utf8', 0, n))
      return m ? m[1] : null
    } finally { fs.closeSync(fd) }
  }

  it('the census header read: an intraday timeframe is kept, a daily or weekly one skipped', () => {
    expect(headerTimeframeOf(ETH_WINDOW)).toBe('5')
    expect(INTRADAY_TF.test(headerTimeframeOf(ETH_WINDOW))).toBe(true)
    expect(INTRADAY_TF.test('D')).toBe(false)
    expect(INTRADAY_TF.test('1W')).toBe(false)
    expect(INTRADAY_TF.test('15S')).toBe(true)
  })

  it('every committed intraday fixture with a warm supplier has one of its own session', () => {
    const mixed = []
    const sessionOf = new Map()
    const supplierSession = (file) => {
      if (!sessionOf.has(file)) sessionOf.set(file, read(file).symbol.session)
      return sessionOf.get(file)
    }
    let warm = 0
    for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
      const tf = headerTimeframeOf(f)
      if (tf !== null && !INTRADAY_TF.test(tf)) continue
      let cap
      try { cap = read(f) } catch { continue }
      if (!cap || !INTRADAY_TF.test(String(cap.timeframe)) || !cap.bars || cap.bars.timeUnit !== 'unix-s'
        || !Array.isArray(cap.bars.rows) || !cap.bars.rows.length) continue
      const s = warmBarsSupply(cap)
      if (s.kind !== 'warm') continue
      warm += 1
      const theirs = supplierSession(s.file)
      if (theirs !== cap.symbol.session) mixed.push(`${f} (${cap.symbol.session}) <- ${s.file} (${theirs})`)
    }
    expect(warm).toBeGreaterThan(5) // the census saw warm suppliers at all
    expect(mixed).toEqual([])
  }, 120_000)
})
