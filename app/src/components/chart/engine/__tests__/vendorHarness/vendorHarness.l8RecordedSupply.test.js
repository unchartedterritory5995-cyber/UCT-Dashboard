// ─── ⭐⭐ RS RATING L8 — THE GRADE RUNS ON THE BARS OUR SERVER SERVES, RECORDED BESIDE A CAPTURE ──
//
// `ourSide.js::recordedSupplyOf` reads `tests/fixtures/vendor-supply/<capture id>.json`
// (`uct.harness-supply/v1`): for an other symbol whose vendor bars must NOT feed the grade (an
// index, a seed), the bars our server serves (with where they came from), or `notRecorded`; and a
// classification field fed with the vendor's value off a committed probe, checked against it.
// Each rail has a refusal and a control. The RS Rating records are the committed ones.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordedSupplyOf, runOurSide, HARNESS_SUPPLY_SCHEMA } from './ourSide'
import { loadCapture, HARNESS_DIR, REPO } from './harness'

vi.setConfig({ testTimeout: 120000 })

const RDDT = 'rs-rating-fred6724-rddt-1d-2026-11-15'
const SPY = 'rs-rating-fred6724-spy-1d-2026-11-15'
const capOf = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const recFile = (id) => path.join(REPO, 'tests/fixtures/vendor-supply', `${id}.json`)
const committed = (id) => JSON.parse(fs.readFileSync(recFile(id), 'utf8'))

/** A scratch supply directory holding one record, for the refusal rails. */
function dirWith(id, rec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l8-supply-'))
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(rec))
  return dir
}

describe('L8 — recordedSupplyOf reads only a well-formed record of THIS capture', () => {
  it('CONTROL: the committed RDDT record is read: SPX from the server\'s PRIMARY, the seed replay, the industry', () => {
    const rec = recordedSupplyOf(capOf(RDDT))
    expect(rec.schema).toBe(HARNESS_SUPPLY_SCHEMA)
    // ⭐ L9 — FMP's rows, committed under the owner ruling the entry quotes (vendorHarness.l9LocalSupply.test.js)
    expect(rec.other.SPX.bars.length).toBe(9286)
    expect(rec.other.SPX.licence).toMatch(/That's fine, I accept it all/)
    expect(rec.other.SPX.source).toMatch(/FMP \^GSPC, the server's PRIMARY/)
    expect(rec.other.SPX.primaryRecorded).toBe(true)
    expect(rec.other['SEED_FRED6725_RS_RATING:RSRATING'].bars.length).toBeGreaterThan(0)
    expect(rec.symbol.industry.value).toBe('Internet Software/Services')
  })

  it('a capture with no record has none (C26 unchanged)', () => {
    expect(recordedSupplyOf({ id: 'no-such-capture-2026-01-01' })).toBe(null)
  })

  it('⛔ a record of ANOTHER capture is refused', () => {
    const dir = dirWith(RDDT, { ...committed(RDDT), capture: SPY })
    expect(() => recordedSupplyOf(capOf(RDDT), dir)).toThrow(/not of rs-rating-fred6724-rddt/)
  })

  it('⛔ an entry holding both bars and notRecorded (or neither) is refused', () => {
    const rec = committed(RDDT)
    const both = { ...rec, other: { SPX: { ...rec.other.SPX, notRecorded: 'x' } } }
    expect(() => recordedSupplyOf(capOf(RDDT), dirWith(RDDT, both))).toThrow(/exactly one of/)
    const neither = { ...rec, other: { SPX: { servedBy: 'x', source: 'y' } } }
    expect(() => recordedSupplyOf(capOf(RDDT), dirWith(RDDT, neither))).toThrow(/exactly one of/)
  })

  it('⛔ recorded bars that do not say where they came from are refused', () => {
    const rec = committed(RDDT)
    const nameless = { ...rec, other: { SPX: { bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }] } } }
    expect(() => recordedSupplyOf(capOf(RDDT), dirWith(RDDT, nameless))).toThrow(/without naming/)
  })

  it('⛔ a classification value the cited probe did NOT print is refused, never fed', () => {
    const rec = committed(RDDT)
    const wrong = { ...rec, symbol: { industry: { ...rec.symbol.industry, value: 'Semiconductors' } } }
    expect(() => recordedSupplyOf(capOf(RDDT), dirWith(RDDT, wrong))).toThrow(/is not what .* printed/)
    const uncited = { ...rec, symbol: { industry: { ...rec.symbol.industry, vendorValueFrom: 'capture.symbol.industry' } } }
    expect(() => recordedSupplyOf(capOf(RDDT), dirWith(RDDT, uncited))).toThrow(/must cite a committed capture/)
  })
})

describe('L8 — what the grade is handed', () => {
  it('RDDT: SPX and the seed come from the record, and the industry is declared substituted, citing the probe', () => {
    const ours = runOurSide(capOf(RDDT))
    expect(ours.ok, String(ours.refusal)).toBe(true)
    expect(ours.notes.join(' ')).toMatch(/other symbol SPX: the bars our server serves, recorded beside the capture \(.*FMP \^GSPC/)
    expect(ours.notes.join(' ')).toMatch(/other symbol RSRATING: the bars our server serves, recorded/)
    expect(ours.substituted).toEqual([expect.objectContaining({ name: 'syminfo.industry',
      vendorValueFrom: 'committed:tests/fixtures/vendor/harness/rs-syminfo-industry-rddt-1d-2026-11-15.json' })])
  })

  it('⛔ SPY: deliberately not supplied (owner ruling), so the capture is not graded at all (INCONCLUSIVE by name)', () => {
    const ours = runOurSide(capOf(SPY))
    expect(ours.ok).toBe(false)
    expect(String(ours.refusal)).toMatch(/not recorded — other symbol SPX: not graded, by owner ruling 2026-11-15/)
  })

  // ⭐ (coordinator ruling 2026-11-21, the Fred RS parity audit at engine 91, option (b)) the three post-close captures of
  // 2026-11-17 have no record of what our server served; their post-close state is graded MATCH by pm-rddt-1d-2026-11-16.
  // Before this record they read DIVERGE on no-bars (other-symbol:no-bars); now each is refused by NAME, never graded.
  it.each(['agl', 'nvda', 'rddt'])('⛔ pc-%s-1d-2026-11-17: deliberately not supplied (coordinator ruling), INCONCLUSIVE by name', (sym) => {
    const ours = runOurSide(capOf(`rs-rating-fred6724-pc-${sym}-1d-2026-11-17`))
    expect(ours.ok).toBe(false)
    expect(String(ours.refusal)).toMatch(/not recorded — other symbol (SPX|RSRATING|SEED_FRED6725_RS_RATING:RSRATING): not graded, by coordinator ruling 2026-11-21/)
  })
})

describe('L8 — the runtime-on lane\'s run-half grant is a test seam only', () => {
  it('no member surface imports `__admitEveryRunHalfForTests`', () => {
    const root = path.join(REPO, 'app/src')
    const hits = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
        if (!/\.(js|jsx|mjs)$/.test(e.name) || /\.test\.(js|jsx)$/.test(e.name) || p.includes(`${path.sep}__tests__${path.sep}`)) continue
        if (e.name === 'runHalfRailSeam.js') continue
        if (fs.readFileSync(p, 'utf8').includes('__admitEveryRunHalfForTests')) hits.push(path.relative(REPO, p))
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
