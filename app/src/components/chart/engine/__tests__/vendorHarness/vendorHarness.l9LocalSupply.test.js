// ─── ⭐⭐ RS RATING L9 — PROVIDER BARS LIVE OUT OF GIT; THE RECORD COMMITS ONLY A MANIFEST ─────────
//
// The repo is PUBLIC. FMP's index bars are class R / LA for MEMBER display only and Yahoo's are
// class X (`api/services/provider_licensing_class.py`; licensing-register T-71/T-72), and nothing
// in docs/ allows committing provider data, so a recorded supply names its served bars by a
// manifest (`other.<T>.rows: {file, sha256, count, first, last}`) and the rows live in the local
// supply store (`$UCT_HARNESS_SUPPLY_STORE`, default `%LOCALAPPDATA%/uct-vendor-batch/supply`), the
// way a licence-held capture lives in the capture store. `ourSide.js::recordedSupplyOf` reads the
// file only when it is the manifest's; a machine without it refuses the grade by name.
// Every rail here runs on a SCRATCH store, so it means the same on any machine.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  recordedSupplyOf, runOurSide, HARNESS_SUPPLY_SCHEMA, HARNESS_SUPPLY_ROWS_SCHEMA,
  __setSupplyDirForTests, __setSupplyStoreForTests,
} from './ourSide'
import { loadCapture, HARNESS_DIR, REPO } from './harness'

vi.setConfig({ testTimeout: 120000 })

const RDDT = 'rs-rating-fred6724-rddt-1d-2026-11-15'
const capOf = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const SUPPLY = path.join(REPO, 'tests/fixtures/vendor-supply')
const committed = (id) => JSON.parse(fs.readFileSync(path.join(SUPPLY, `${id}.json`), 'utf8'))
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const BARS = ['2024-03-20', '2024-03-21', '2024-03-22'].map((d, i) => ({ t: utc(d), o: 1 + i, h: 2 + i, l: i, c: 1.5 + i, v: 0 }))

/** A scratch store holding one rows file, and its manifest. */
function storeWith(doc, name = 'spx-rows.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l9-store-'))
  const raw = Buffer.from(JSON.stringify(doc))
  fs.writeFileSync(path.join(dir, name), raw)
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex')
  return { dir, manifest: { file: name, sha256, count: 3, first: '2024-03-20', last: '2024-03-22' } }
}
const rowsDoc = (extra = {}) => ({ schema: HARNESS_SUPPLY_ROWS_SCHEMA, ticker: 'SPX', source: 's', servedBy: 'b',
  recordedAtUTC: 'now', bars: BARS, ...extra })
/** A scratch supply dir holding the RDDT record with SPX named by `rows`. */
function recordWith(rows) {
  const rec = committed(RDDT)
  rec.other.SPX = { servedBy: 'b', source: 's', primaryRecorded: true, recordedAtUTC: 'now', rows }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l9-supply-'))
  fs.writeFileSync(path.join(dir, `${RDDT}.json`), JSON.stringify(rec))
  return dir
}

/** An entry carrying provider (FMP / Yahoo) index bars inline. */
const inlineProviderBars = (e) => Array.isArray(e.bars) && /fmp|yfinance|yahoo|\^GSPC/i.test(`${e.source} ${e.servedBy}`)

afterEach(() => { __setSupplyDirForTests(null); __setSupplyStoreForTests(null) })

describe('L9 — the committed records carry no provider bars', () => {
  it('⛔ no committed supply record holds index bars inline (FMP / yfinance rows are out of git)', () => {
    const inline = []
    for (const f of fs.readdirSync(SUPPLY).filter((n) => n.endsWith('.json'))) {
      const rec = JSON.parse(fs.readFileSync(path.join(SUPPLY, f), 'utf8'))
      expect(rec.schema, f).toBe(HARNESS_SUPPLY_SCHEMA)
      for (const [t, e] of Object.entries(rec.other || {})) {
        if (inlineProviderBars(e)) inline.push(`${f}: ${t}`)
      }
    }
    expect(inline).toEqual([])
  })

  it('CONTROL: the rail sees an inline provider row when there is one', () => {
    expect(inlineProviderBars({ source: 'yfinance ^GSPC', servedBy: 'x', bars: BARS })).toBe(true)
    expect(inlineProviderBars({ source: 'FMP ^GSPC', servedBy: 'x', bars: BARS })).toBe(true)
    expect(inlineProviderBars({ source: 'pine_seed_store replay', servedBy: 'x', bars: BARS })).toBe(false)
    expect(inlineProviderBars({ source: 'FMP ^GSPC', servedBy: 'x', rows: {} })).toBe(false)
  })

  it('RDDT and NVDA name FMP\'s SPX by manifest: 9286 sessions 1990-01-02..2026-11-13', () => {
    for (const id of [RDDT, 'rs-rating-fred6724-nvda-1d-2026-11-15']) {
      const m = committed(id).other.SPX.rows
      expect(m).toMatchObject({ count: 9286, first: '1990-01-02', last: '2026-11-13' })
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('L9 — recordedSupplyOf reads out-of-git rows only when they are the manifest\'s', () => {
  it('CONTROL: the manifest\'s file is read into the bars the grade is handed', () => {
    const { dir, manifest } = storeWith(rowsDoc())
    __setSupplyStoreForTests(dir)
    const rec = recordedSupplyOf(capOf(RDDT), recordWith(manifest))
    expect(rec.other.SPX.bars).toEqual(BARS)
    expect(rec.other.SPX.notOnThisMachine).toBeUndefined()
  })

  it('⛔ a file whose bytes are not the manifest\'s is refused', () => {
    const { dir, manifest } = storeWith(rowsDoc())
    __setSupplyStoreForTests(dir)
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith({ ...manifest, sha256: 'f'.repeat(64) })))
      .toThrow(/is not the recorded file/)
  })

  it('⛔ a count or span that is not the manifest\'s is refused', () => {
    const { dir, manifest } = storeWith(rowsDoc())
    __setSupplyStoreForTests(dir)
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith({ ...manifest, count: 4 }))).toThrow(/the manifest 4/)
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith({ ...manifest, first: '1990-01-02' }))).toThrow(/the manifest 3 1990/)
  })

  it('⛔ a file of another ticker, or not a rows file, is refused', () => {
    const other = storeWith(rowsDoc({ ticker: 'NDX' }))
    __setSupplyStoreForTests(other.dir)
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith(other.manifest))).toThrow(/holds "NDX"/)
    const notRows = storeWith({ bars: BARS })
    __setSupplyStoreForTests(notRows.dir)
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith(notRows.manifest))).toThrow(/is not a uct.harness-supply-rows/)
  })

  it('⛔ a manifest naming a path (not a bare file name in the store) is refused', () => {
    const { dir, manifest } = storeWith(rowsDoc())
    __setSupplyStoreForTests(dir)
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith({ ...manifest, file: `../${manifest.file}` })))
      .toThrow(/bare file name/)
  })

  it('⛔ an entry holding both inline bars and a manifest is refused', () => {
    const rec = committed(RDDT)
    rec.other.SPX = { ...rec.other.SPX, bars: BARS }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l9-supply-'))
    fs.writeFileSync(path.join(dir, `${RDDT}.json`), JSON.stringify(rec))
    expect(() => recordedSupplyOf(capOf(RDDT), dir)).toThrow(/exactly one of `bars`, `rows` or `notRecorded`/)
  })

  it('⛔ without the file on this machine the grade is refused by name, never run on a stand-in', () => {
    const { manifest } = storeWith(rowsDoc())
    __setSupplyStoreForTests(fs.mkdtempSync(path.join(os.tmpdir(), 'l9-empty-')))
    __setSupplyDirForTests(recordWith(manifest))
    const ours = runOurSide(capOf(RDDT))
    expect(ours.ok).toBe(false)
    expect(String(ours.refusal)).toMatch(/other symbol SPX: the served bars \(s\) are kept out of git .* is not in the local supply store/)
  })
})
