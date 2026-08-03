import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeVWAP } from '../../indicators'
import * as engineRegistry from '../nativeRegistry'
import fixture from '../../../../pages/parityBars/intraday5m.json'

// ─── VWAP_SESSION_ANCHOR — THE DECISION, APPLIED AND PINNED ─────────────────
//
// `computeVWAP` anchors on the **ET session**. It used to anchor on the UTC
// calendar day, which for a SESSION VWAP is wrong, and on extended hours is
// severely wrong: the chart opened one of this fixture's sessions **$14.45**
// away from the session-anchored number.
//
// B3 Task 8 migrated VWAP to the engine and deliberately did NOT touch the
// maths — changing it inside a migration makes the migration's parity number
// unattributable, which is the reasoning that governed the MACD head-mask. The
// owner then took the correctness side on 2026-08-03 against a measured 2,590
// changed pixels, and the change landed in a commit of its own.
//
// ⛔ THIS FILE IS STILL THE TRIPWIRE, IT HAS ONLY CHANGED SIDES. Every value
// below is now the CORRECTED one. A revert to UTC-day bucketing turns this file
// red exactly as loudly as the correction did — which is the property that
// makes it worth keeping rather than deleting.
//
// ⚠️ NOT A DUPLICATE OF `goldenFixtures.test.js`. That file pins the SHAPE
// (where the resets land, that a session is no longer carried over). This one
// pins the four VALUES a user reads off the chart, the magnitude of the
// correction, and the EXISTENCE and CONTENT of the decision record. A change
// that updated the golden file and forgot the record would pass there and fail
// here.
//
// Record: `docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`
// Spec row: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11

const DECISION_ID = 'VWAP_SESSION_ANCHOR'
const RECORD = join(process.cwd(), '..', 'docs', 'decisions', '2026-08-02-vwap-utc-day-bucketing.md')
const SESSIONS = join(process.cwd(), '..', 'tests', 'fixtures', 'indicators', 'intraday5m_sessions.json')
const BARS = fixture.bars

/** What `computeVWAP` reads TODAY at the four bars where the two bucketings
 *  disagree, to 4dp. Measured by B3 Task 7; §3 of the decision record. */
const SESSION_ANCHORED = {
  192: 101.9471,   // Fri 20:00 EDT — 11-01 00:00 UTC: no longer wiped on a session's LAST bar
  373: 96.4361,    // Mon 19:00 EST — 11-04 00:00 UTC: the split hour that used to MOVE
  386: 108.3633,   // Tue 04:00 EST — the open, which was never a UTC boundary at all
  566: 109.4466,   // Tue 19:00 EST — 11-05 00:00 UTC
}
/** What the RETIRED bucketing read at the same bars. Same source. */
const UTC_DAY = { 192: 106.8533, 373: 93.7233, 386: 93.9178, 566: 112.5800 }

const round4 = (v) => Number(v.toFixed(4))

/** The bucketing that shipped until 2026-08-03, verbatim. It is a
 *  re-implementation on purpose: every non-vacuity assertion below needs a
 *  series `computeVWAP` no longer produces to be measured against. */
const vwapByUtcDay = (bars) => {
  const out = []
  let cumPV = 0, cumVol = 0, day = null
  for (const b of bars) {
    const d = new Date(b.t * 1000)
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    if (k !== day) { cumPV = 0; cumVol = 0; day = k }
    cumPV += ((b.h + b.l + b.c) / 3) * b.v
    cumVol += b.v
    out.push(cumPV / cumVol)
  }
  return out
}

describe(`${DECISION_ID} — the ET-session anchor is PINNED`, () => {
  it('the decision record exists, carries this id, and records that it was TAKEN', () => {
    // The record is the whole point: a red assertion below is only useful if it
    // can point somewhere. Deleting or renaming the file breaks this first.
    expect(existsSync(RECORD), `${RECORD} is missing — the decision has nowhere to live`).toBe(true)
    const text = readFileSync(RECORD, 'utf8')
    expect(text).toContain(`**Decision id:** \`${DECISION_ID}\``)
    expect(text, 'the record no longer says the decision was accepted').toMatch(/Status:.*ACCEPTED/)
    expect(text, 'the record does not carry the date it was taken').toContain('ACCEPTED 2026-08-03')
    // It must name the thing that changed, or "what was decided" becomes a
    // scavenger hunt.
    expect(text).toContain('computeVWAP')
    expect(text).toContain('compute.rev')
  })

  it('the record states the pixel cost that was PAID, in the APPLIED section', () => {
    // The MACD precedent: the owner acted on a measured number, not a claim, and
    // the number stays in the record so a future reader can re-derive it.
    const text = readFileSync(RECORD, 'utf8')
    expect(text, 'the record does not name the test that pins it')
      .toContain('vwapUtcBucketing.test.js')

    // ⚠️ THIS PINS THE §9a TABLE ROWS, NOT "the file mentions 2,590", AND THREE
    // SURVIVING MUTATIONS ARE WHY.
    //
    //   * A whole-file `toMatch(/\*\*2,590\*\*/)` reads like "the record states
    //     the cost" and is not: §4 (the pre-decision ESTIMATE) carries that
    //     string too, so §9a's applied number could be corrupted and the
    //     assertion stayed green on §4's copy. The estimate agreeing with the
    //     measurement is a happy fact about this decision, not something a test
    //     of the APPLIED cost may lean on.
    //   * Narrowing to §9 was NOT enough either. Every one of these tokens
    //     appears TWICE inside §9 — the measurement table and the prose that
    //     discusses it — so `toContain` on the slice still passed with the table
    //     row rewritten. Prose about a number is not the number.
    //
    // So each assertion below matches the ROW: the label, the separator and the
    // value together. That is the thing a reader quotes, and the thing a
    // re-measurement would have to update.
    const applied = text.slice(text.search(/^##\s*9\.\s/m))
    expect(applied, 'the record has no §9 APPLIED section').not.toBe('')
    expect(applied.length, '§9 is a stub').toBeGreaterThan(2000)
    expect(applied, '§9a\'s changed-pixel row lost the re-measured count')
      .toMatch(/\|\s*\*\*Changed pixels\*\*\s*\|\s*\*\*2,590\*\*\s*of 744,000\s*—\s*\*\*0\.348118%\*\*\s*\|/)
    // Every parity number names BOTH build identities, or it describes no tree.
    expect(applied, '§9a\'s A-side row does not name the pre-decision build')
      .toMatch(/\|\s*\*\*A — UTC-day[^|]*\|\s*build\s*\*\*`89f73b36ae29`\*\*/)
    expect(applied, '§9a\'s B-side row does not name the shipped build')
      .toMatch(/\|\s*\*\*B — ET-session[^|]*\|\s*build\s*\*\*`35ec82560ea5`\*\*/)
  })

  it('computeVWAP buckets by ET SESSION — the four values a user reads today', () => {
    // ⛔ IF THIS IS RED, YOU CHANGED WHAT THE CHART DRAWS. Reverting to UTC-day
    // bucketing is a `compute.rev` move of its own and needs the same treatment
    // this one got: its own commit, a re-measured pixel number, and §7's list of
    // the other tests that move with it. Do not re-baseline these numbers to make
    // a suite green.
    const got = computeVWAP(BARS)
    expect(got).toHaveLength(BARS.length)
    for (const [i, value] of Object.entries(SESSION_ANCHORED)) {
      expect(round4(got[Number(i)].value), `bar ${i} — see ${DECISION_ID}`).toBe(value)
    }
  })

  it('…and the ENGINE reads the same function, so the fix could not half-land', () => {
    // Both lanes go through `computeVWAP`. That is why correcting it moved the
    // legacy block and the engine together — and why `engine_vwap_vs_legacy`
    // reported 0 either way, which is exactly why the decision was measured on
    // `vwap_only` across two builds instead.
    const def = engineRegistry.getDefinition('vwap')
    const cols = engineRegistry.computeFor(def, BARS, {})
    const raw = computeVWAP(BARS)
    for (const i of Object.keys(SESSION_ANCHORED).map(Number)) {
      expect(cols.vwap[i], `bar ${i}: the engine's column left computeVWAP`).toBe(raw[i].value)
    }
  })

  it('the pin is NOT vacuous — the retired bucketing gives materially different numbers', () => {
    // Without this, every assertion above would still pass on a fixture where the
    // two bucketings happened to agree, and the pin would be guarding nothing.
    // Task 7's mutation T7 is the other half of this: with the post-market drift
    // removed the Monday split costs $0.36 instead of $2.71 and the fixture stops
    // being able to tell the two apart at all.
    const old = vwapByUtcDay(BARS)
    for (const i of Object.keys(SESSION_ANCHORED).map(Number)) {
      // The retired series is still reproducible here, bar for bar…
      expect(round4(old[i]), `bar ${i}: the UTC-day control drifted`).toBe(UTC_DAY[i])
      const delta = Math.abs(UTC_DAY[i] - SESSION_ANCHORED[i])
      expect(delta, `bar ${i} — the two bucketings agree here`).toBeGreaterThan(2)
    }
    // …and the worst of them is the session OPEN, which is the number the record
    // leads with and the reason this was a correctness decision rather than a
    // cosmetic one.
    expect(round4(Math.abs(UTC_DAY[386] - SESSION_ANCHORED[386]))).toBe(14.4455)
  })

  it('the correction is a WHOLE SESSION, not four bars', () => {
    // Four pinned values could be four unlucky bars. This is the magnitude claim
    // the record's §3 makes, recomputed from the SHIPPED function against the
    // retired one rather than copied: Tuesday's session (bars 386..578) moved by
    // more than $0.50 on 120 of its 193 bars, and 207 of all 579 bars moved by
    // more than a cent.
    const got = computeVWAP(BARS).map(p => p.value)
    const old = vwapByUtcDay(BARS)
    const overCent = got.filter((v, i) => Math.abs(v - old[i]) > 0.01).length
    const tueOver50c = got.slice(386, 579).filter((v, i) => Math.abs(v - old[386 + i]) > 0.5).length
    expect(overCent, 'bars that moved by more than a cent').toBe(207)
    expect(tueOver50c, 'Tuesday bars that moved by more than fifty cents').toBe(120)
  })

  it('the shipped series IS the golden fixture\'s etSessionVwap, exactly', () => {
    // The validation the corrected build was put through before it was
    // photographed, kept as a standing test rather than a one-off: the
    // accumulator resets at exactly the fixture's `etResetIndices`, and the
    // output matches `session.etSessionVwap` with a worst absolute difference of
    // ZERO across all 579 bars. So the 2,590 px is the cost of the CORRECT
    // series, not of an approximation of it.
    //
    // The fixture is derived from `zoneinfo.ZoneInfo("America/New_York")` in
    // `tests/fixtures/indicators/_generate.py` and `computeVWAP` from
    // `Intl.DateTimeFormat`'s `America/New_York` — two independent readings of
    // the same IANA zone, which is what makes the agreement worth asserting.
    const session = JSON.parse(readFileSync(SESSIONS, 'utf8')).session
    const got = computeVWAP(BARS).map(p => p.value)

    const resets = got
      .map((v, i) => (Math.abs(v - (BARS[i].h + BARS[i].l + BARS[i].c) / 3) < 1e-12 ? i : -1))
      .filter(i => i >= 0)
    expect(resets, 'the accumulator does not reset at the ET session opens')
      .toEqual(session.etResetIndices)
    expect(resets).toEqual([0, 193, 386])

    const worst = got.reduce((m, v, i) => Math.max(m, Math.abs(v - session.etSessionVwap[i])), 0)
    expect(worst, 'worst absolute difference vs the fixture\'s ET-anchored series').toBe(0)
  })

  it('the vwap definition is on compute.rev 2, and `version` did NOT move', () => {
    // Applying the decision was a `compute.rev` bump (§7) — the maths changed and
    // what it renders did not. That is the exact MIRROR of the head-mask, which
    // bumped `version` and left `compute.rev` alone. Asserting both halves is what
    // stops the next maths change being filed as presentation.
    const def = engineRegistry.getDefinition('vwap')
    expect(def.compute.rev, `${DECISION_ID} was reverted without updating its record`).toBe(2)
    expect(def.version, 'a numbers change must not be filed as a presentation change').toBe(1)
    // It is the only definition off the shared rev, which is the claim the
    // registry comment makes and the thing that would rot silently.
    const offRev = engineRegistry.listDefinitions()
      .filter(d => d.compute.rev !== 1).map(d => d.id)
    expect(offRev).toEqual(['vwap'])
  })
})
