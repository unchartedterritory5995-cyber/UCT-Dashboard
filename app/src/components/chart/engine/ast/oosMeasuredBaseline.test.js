// app/src/components/chart/engine/ast/oosMeasuredBaseline.test.js
//
// ─── ⭐⭐ THE MEASURED SIDECAR pine.oosBaseline.test.js DELIBERATELY LACKS ────
//
// `pine.oosBaseline.test.js` is a MEASUREMENT INSTRUMENT and says so: *"NO RATCHET
// IN THIS FILE YET … its assertions are non-vacuity checks only"*. That ruling is
// correct and is NOT changed here — a floor asserted before the baseline is
// adjudicated pins numbers nobody has looked at.
//
// ⚰️ BUT IT COST A REAL MISS. R33a's re-baseline ran over `corpus/committed` and
// reported "20 predicted, 2 moved". **Six of the census's named 20 are not in that
// corpus at all** — they are `high_engagement__` / `mid_engagement__` /
// `long_tail__` fixtures living HERE — so they were never measured, and the OOS
// rail could not say so because it pins no counts. The corrected figure was 3
// scripts / 15 positions, and the sixth mover (`mid_engagement__09-relative-
// volume-breakout-context`, flat 0 → 2) was found only by checking the names.
//
// ⛔ SO THIS FILE ADDS THE MEASUREMENT, NOT A VERDICT. It pins, per OOS script,
// the output count, the refusal guards IN ORDER, and the colour-carrying position
// counts — against a committed artifact. A move is reported BY NAME as a set
// difference, never as a count: a count that stays equal while two scripts swap
// answers is the failure this shape exists to catch.
//
// Regenerate deliberately (a change here is reviewable, like any baseline):
//   OOS_MEASURED_WRITE=1 npx vitest run src/components/chart/engine/ast/oosMeasuredBaseline.test.js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')
const ARTIFACT = path.resolve(__dirname, 'oos-measured-baseline.json')

const isStr = (v) => typeof v === 'string' && v.length > 0

/** One script's measured row. ⭐ Refusal GUARDS in order, never just how many. */
function measure(src) {
  let t
  try {
    t = translatePine(src, { strict: true })
  } catch (e) {
    return { threw: String((e && e.message) || e).slice(0, 120) }
  }
  const outs = t.outputs || []
  const fills = ((t.presentation || {}).fills || [])
  return {
    outputs: outs.length,
    refusals: (t.refusals || []).map((r) => r.guard || r.code || '(unnamed)'),
    flat: outs.filter((o) => isStr((o.presentation || {}).color)).length,
    pair: outs.filter((o) => isStr((o.presentation || {}).colorUp)
      && isStr((o.presentation || {}).colorDown)).length,
    fillFlat: fills.filter((f) => isStr(f.color)).length,
    fillPair: fills.filter((f) => isStr(f.colorUp) && isStr(f.colorDown)).length,
  }
}

const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
const MEASURED = Object.fromEntries(
  FILES.map((f) => [f, measure(fs.readFileSync(path.join(DIR, f), 'utf8'))]),
)

if (process.env.OOS_MEASURED_WRITE) {
  fs.writeFileSync(ARTIFACT, `${JSON.stringify(MEASURED, null, 2)}\n`, 'utf8')
}

describe('the OOS corpus is measured, not merely exercised', () => {
  it('⛔⛔ NON-VACUITY — the corpus is really here and really translates', () => {
    // Without this, every assertion below passes over an empty directory.
    expect(FILES.length).toBeGreaterThan(50)
    const threw = Object.entries(MEASURED).filter(([, m]) => m.threw)
    expect(threw, 'a script threw rather than refusing').toEqual([])
    // …and the instrument separates the corpus, so it cannot pass by grading
    // everything identically.
    expect(new Set(Object.values(MEASURED).map((m) => m.outputs)).size).toBeGreaterThan(1)
  })

  it('⛔⛔ THE ARTIFACT EXISTS AND COVERS EXACTLY THIS CORPUS', () => {
    expect(fs.existsSync(ARTIFACT),
      'the committed baseline is missing — regenerate with OOS_MEASURED_WRITE=1').toBe(true)
    const pinned = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'))
    // ⭐ A SET DIFFERENCE, BOTH WAYS, BY NAME. A count comparison stays green when
    // one script is added and another removed.
    const added = FILES.filter((f) => !(f in pinned))
    const gone = Object.keys(pinned).filter((f) => !FILES.includes(f))
    expect({ added, gone }, 'the OOS corpus membership moved').toEqual({ added: [], gone: [] })
  })

  it('⛔⛔ EVERY SCRIPT STILL MEASURES WHAT IT MEASURED — reported BY NAME', () => {
    const pinned = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'))
    const moved = []
    for (const f of FILES) {
      const a = pinned[f]
      const b = MEASURED[f]
      if (JSON.stringify(a) !== JSON.stringify(b)) moved.push({ script: f, was: a, now: b })
    }
    // ⛔ The message carries the NAMES and both readings — a differ that truncates
    // to a count is the thing this rail exists to avoid.
    expect(moved, `OOS measurements moved:\n${JSON.stringify(moved, null, 2)}`).toEqual([])
  })

  it('⭐ THE SIX CENSUS-NAMED SCRIPTS THAT LIVE HERE ARE COVERED', () => {
    // ⚰️ These are the six R33a's first re-baseline silently omitted. Naming them
    // here means a future re-baseline cannot lose them the same way.
    const SIX = [
      'high_engagement__13-ultimate-opening-range-breakout-luxalgo.pine',
      'high_engagement__22-reversal-probability-profile-algoalpha.pine',
      'long_tail__06-sector-rotation-leadership-persistence.pine',
      'mid_engagement__09-relative-volume-breakout-context.pine',
      'mid_engagement__22-rsi-levels-regime-map.pine',
      'mid_engagement__23-distilled-htf-po3.pine',
    ]
    const missing = SIX.filter((f) => !FILES.includes(f))
    expect(missing, 'a census-named OOS script left the corpus').toEqual([])
  })
})
