// app/src/components/chart/engine/__tests__/pinePaletteVendor.test.js
//
// ─── THE PIN: EVERY NAMED COLOUR, AT EVERY PROBED VERSION, EQUALS THE VENDOR ─
//
// ⭐⭐ THE EXPECTED VALUES ARE NOT IN THIS FILE. They are read from
// `tests/fixtures/vendor/palette-by-version-rddt-1d-2026-09-27.json` — TradingView's
// own resolved hex for all 17 constants under Pine v3, v4, v5 and v6, read from the
// study's style state after it compiled and drew one probe per version. A table
// typed here would be a second authority, and the one thing this rail exists to
// stop is the engine agreeing with a copy of itself.
//
// ⛔ THREE DOORS, BECAUSE A COLOUR REACHES A MEMBER THROUGH THREE:
//   1. the authority (`pinePalette.pineColourHex`),
//   2. the TRANSLATOR — `translatePine` over the vendor's own probe template, in
//      both the screener and the host lane, reading each plot's presentation,
//   3. the RUNTIME lane — `buildRuntimeIr` → lower → execute, reading the packed
//      integer a `bgcolor(<name>)` actually emits and unpacking it.
// A table can be right while a door ignores the script's version; only asking
// the doors catches that, and it is exactly the defect this file was written for.
//
// ⛔ CASE-INSENSITIVE: the vendor answers `#2962ff` lowercase for blue under v5
// and v6 only.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  PALETTE_BY_VERSION, MEASURED_VERSIONS, UNMEASURED_FALLBACK, PINE_COLOUR_NAMES,
  pineColourHex, paletteFor, isMeasuredVersion,
} from '../pinePalette.js'
import { translatePine, colourHexByName } from '../ast/pine.js'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { unpackColor } from '../colorInt.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const FIXTURE = 'tests/fixtures/vendor/palette-by-version-rddt-1d-2026-09-27.json'
const FX = JSON.parse(fs.readFileSync(path.join(REPO, FIXTURE), 'utf8'))
const VERSIONS = Object.keys(FX.versions).map(Number).sort((a, b) => a - b)
const vendor = (v, name) => FX.versions[String(v)].colours[name]
const low = (h) => String(h).toLowerCase()

/** The vendor's own probe spelling: bare names at v3, `color.<name>` from v4. */
const spell = (v, name) => (v <= 3 ? name : `color.${name}`)
const decl = (v) => (v >= 5 ? 'indicator' : 'study')

/** The vendor's probe template, one plot per name. */
const probe = (v) => [
  `//@version=${v}`,
  `${decl(v)}("UCTVH palette v${v}", overlay=false)`,
  ...PINE_COLOUR_NAMES.map((n) => `plot(close, title="${n}", color=${spell(v, n)})`),
].join('\n')

const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 103, v: 10 },
  { t: 1700086400, o: 104, h: 106, l: 100, c: 101, v: 11 },
]
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

/** What the runtime lane paints for `bgcolor(<spelling>)` at a version. */
function runtimeHex(v, spelling) {
  const src = `//@version=${v}\n${decl(v)}("t")\nbgcolor(${spelling})\nplot(close)`
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`runtime lane refused v${v} ${spelling}: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: BARS.length, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return unpackColor(res.outputs[0][0] >>> 0).hex
}

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔ CONTROL — the fixture is really read, and it can tell versions apart', () => {
  it('four probed versions, seventeen names each, the same seventeen the engine knows', () => {
    expect(VERSIONS).toEqual([3, 4, 5, 6])
    for (const v of VERSIONS) {
      expect(Object.keys(FX.versions[String(v)].colours).sort(), `v${v}`)
        .toEqual([...PINE_COLOUR_NAMES].sort())
    }
    expect(PINE_COLOUR_NAMES).toHaveLength(17)
  })

  it('the versions DISAGREE, so a version-blind engine cannot pass this file', () => {
    // ⭐ Non-vacuity for every per-version assertion below: if the fixture's
    // versions agreed, one table would satisfy all of them.
    const distinct = (name) => new Set(VERSIONS.map((v) => low(vendor(v, name)))).size
    expect(distinct('red')).toBe(3)      // v3 web · v4/v5 · v6
    expect(distinct('blue')).toBe(3)     // v3 web · v4 · v5/v6
    expect(distinct('olive')).toBe(1)    // the control's control: some names never move
  })

  it('the authority is measured at exactly the fixture\'s versions', () => {
    expect([...MEASURED_VERSIONS].sort()).toEqual(VERSIONS)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('door 1 — the authority equals the vendor, name by name, version by version', () => {
  for (const v of VERSIONS) {
    it(`v${v}`, () => {
      for (const name of PINE_COLOUR_NAMES) {
        expect(low(pineColourHex(spell(v, name), v)), `v${v} ${spell(v, name)}`).toBe(low(vendor(v, name)))
        expect(low(PALETTE_BY_VERSION[v][name]), `v${v} table ${name}`).toBe(low(vendor(v, name)))
      }
    })
  }

  it('`grey` is `gray` at every version (not probed; Pine documents it as an alias)', () => {
    for (const v of VERSIONS) {
      expect(pineColourHex('grey', v)).toBe(pineColourHex('gray', v))
      expect(pineColourHex('color.grey', v)).toBe(pineColourHex('color.gray', v))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('door 2 — the translator draws the vendor\'s hex for the vendor\'s own probe', () => {
  for (const lane of ['screener', 'host']) {
    for (const v of VERSIONS) {
      it(`${lane} lane, v${v}`, () => {
        const t = translatePine(probe(v), lane === 'host' ? { strict: true } : {})
        expect(t.version).toBe(v)
        const outs = (t.outputs || []).filter(Boolean)
        // non-vacuity: every probe plot came back as an output
        expect(outs.map((o) => o.title).sort()).toEqual([...PINE_COLOUR_NAMES].sort())
        for (const name of PINE_COLOUR_NAMES) {
          const out = outs.find((o) => o.title === name)
          expect(low(out.presentation && out.presentation.color), `v${v} ${spell(v, name)}`)
            .toBe(low(vendor(v, name)))
        }
      })
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
describe('door 3 — the runtime lane paints the vendor\'s hex', () => {
  for (const v of VERSIONS) {
    it(`v${v}`, () => {
      for (const name of PINE_COLOUR_NAMES) {
        expect(low(runtimeHex(v, spell(v, name))), `v${v} ${spell(v, name)}`).toBe(low(vendor(v, name)))
      }
    })
  }

  it('`colourHexByName` refuses to be asked without a version', () => {
    // ⛔ A default here is how a door ends up version-blind again without any
    // test noticing: every caller that forgets gets v5, which is right for one
    // dialect in four. `null` (a script with no annotation) is a real answer;
    // a missing argument is a forgotten one.
    expect(() => colourHexByName('color.red')).toThrow(/version/)
    expect(colourHexByName('color.red', 6)).toBe(pineColourHex('color.red', 6))
    expect(colourHexByName('nope', 6)).toBe(null)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⚠️ UNMEASURED — no annotation, v1, v2 keep the pre-existing (v5) table', () => {
  it('is named, not implied', () => {
    expect(UNMEASURED_FALLBACK).toBe(5)
    for (const v of [null, undefined, 1, 2, 7]) {
      expect(isMeasuredVersion(v), String(v)).toBe(false)
      expect(paletteFor(v), String(v)).toBe(PALETTE_BY_VERSION[UNMEASURED_FALLBACK])
    }
  })

  it('an unannotated script draws exactly what it drew before this file existed', () => {
    const t = translatePine('indicator("u")\nplot(close, title="r", color=color.red)', { strict: true })
    expect(t.version).toBe(null)
    expect(t.outputs[0].presentation.color).toBe('#FF5252')
  })
})
