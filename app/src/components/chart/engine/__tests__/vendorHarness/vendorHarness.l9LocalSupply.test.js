// ─── ⭐⭐ RS RATING L9 — PROVIDER BARS ARE COMMITTED ONLY UNDER A RULING; ELSE A MANIFEST ──────
//
// The repo is PUBLIC. FMP's index bars are class R / LA for MEMBER display and Yahoo's are class X
// (`api/services/provider_licensing_class.py`; licensing-register T-71/T-72). Owner ruling
// 2026-11-15, "That's fine, I accept it all", allows committing the RS Rating grade's supply
// records (and only those), so they hold FMP's SPX inline and QUOTE the ruling in `licence`. Any
// other provider supply is named by a manifest (`other.<T>.rows: {file, sha256, count, first,
// last}`) and the rows live in the local supply store (`$UCT_HARNESS_SUPPLY_STORE`, default
// `%LOCALAPPDATA%/uct-vendor-batch/supply`), the way a licence-held capture lives in the capture
// store: `ourSide.js::recordedSupplyOf` reads the file only when it is the manifest's, and a
// machine without it refuses the grade by name. The store rails run on a SCRATCH store, so they
// mean the same on any machine.
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
/** The records the 2026-11-15 ruling covers: the RS Rating grade's supply, and nothing else. */
const RULED_RECORD = /^rs-rating-fred6724-/
const RULING_QUOTE = "That's fine, I accept it all"
/** Why an inline provider entry is not allowed, or null when it is. */
const inlineProblem = (file, e) => {
  if (!inlineProviderBars(e)) return null
  if (!RULED_RECORD.test(file)) return 'provider bars inline outside the RS Rating records the ruling covers'
  if (!String(e.licence || '').includes(RULING_QUOTE)) return 'provider bars inline without quoting the ruling in `licence`'
  return null
}

afterEach(() => { __setSupplyDirForTests(null); __setSupplyStoreForTests(null) })

describe('L9 — provider bars are committed only where the owner ruling covers them', () => {
  it('⛔ every committed inline provider entry is an RS Rating record quoting the ruling', () => {
    const bad = []
    for (const f of fs.readdirSync(SUPPLY).filter((n) => n.endsWith('.json'))) {
      const rec = JSON.parse(fs.readFileSync(path.join(SUPPLY, f), 'utf8'))
      expect(rec.schema, f).toBe(HARNESS_SUPPLY_SCHEMA)
      for (const [t, e] of Object.entries(rec.other || {})) {
        const why = inlineProblem(f, e)
        if (why) bad.push(`${f}: ${t}: ${why}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('CONTROL: the rail catches provider bars with no ruling, or on a record it does not cover', () => {
    const fmp = { source: 'FMP ^GSPC', servedBy: 'x', bars: BARS }
    expect(inlineProblem(`${RDDT}.json`, fmp)).toMatch(/without quoting the ruling/)
    expect(inlineProblem('some-other-capture.json', { ...fmp, licence: RULING_QUOTE })).toMatch(/outside the RS Rating records/)
    expect(inlineProblem(`${RDDT}.json`, { source: 'yfinance ^GSPC', servedBy: 'x', bars: BARS })).toBeTruthy()
    expect(inlineProblem(`${RDDT}.json`, { ...fmp, licence: `owner ruling: "${RULING_QUOTE}"` })).toBe(null)
    expect(inlineProblem('x.json', { source: 'pine_seed_store replay', servedBy: 'x', bars: BARS })).toBe(null)
    expect(inlineProblem('x.json', { source: 'FMP ^GSPC', servedBy: 'x', rows: {} })).toBe(null)
  })

  it('RDDT and NVDA carry FMP\'s SPX (the primary): 9286 sessions 1990-01-02..2026-11-13', () => {
    const day = (b) => new Date(b.t * 1000).toISOString().slice(0, 10)
    for (const id of [RDDT, 'rs-rating-fred6724-nvda-1d-2026-11-15']) {
      const e = committed(id).other.SPX
      expect(e.source).toMatch(/FMP \^GSPC, the server's PRIMARY/)
      expect(e.bars.length).toBe(9286)
      expect([day(e.bars[0]), day(e.bars[e.bars.length - 1])]).toEqual(['1990-01-02', '2026-11-13'])
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

  it('a DAILY rows file whose `t` is the session date (the OWN~D rows, the seed) is read; its span is checked the same way', () => {
    // ⚰️ 2026-11-19: `new Date('2024-03-20' * 1000)` threw a RangeError out of the span check and failed the whole
    // corpus file (the l12-now regrade). A store row's `t` is unix seconds OR the session date; both span-check.
    const isoBars = BARS.map((b) => ({ ...b, t: new Date(b.t * 1000).toISOString().slice(0, 10) }))
    const { dir, manifest } = storeWith(rowsDoc({ bars: isoBars }))
    __setSupplyStoreForTests(dir)
    expect(recordedSupplyOf(capOf(RDDT), recordWith(manifest)).other.SPX.bars).toEqual(isoBars)
    // and the span is still CHECKED on date rows: a manifest naming another first day is refused by name
    expect(() => recordedSupplyOf(capOf(RDDT), recordWith({ ...manifest, first: '1990-01-02' }))).toThrow(/the manifest 3 1990/)
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
    rec.other.SPX = { ...rec.other.SPX, bars: BARS, rows: { file: 'x.json', sha256: 'f'.repeat(64), count: 3 } }
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
