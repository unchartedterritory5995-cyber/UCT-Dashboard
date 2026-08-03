import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeVWAP } from '../../indicators'
import * as engineRegistry from '../nativeRegistry'
import fixture from '../../../../pages/parityBars/intraday5m.json'

// ─── VWAP_SESSION_ANCHOR — TODAY'S BEHAVIOUR, PINNED TO A DECISION RECORD ────
//
// `computeVWAP` restarts its accumulator on a UTC calendar day. For a SESSION
// VWAP that is wrong, and on extended hours it is severely wrong — the chart
// opens one of this fixture's sessions **$14.45** away from the session-anchored
// number. B3 Task 8 migrated VWAP to the engine and deliberately did NOT touch
// it: changing the maths inside a migration makes the migration's parity number
// unattributable, which is the reasoning that governed the MACD head-mask.
//
// So this file exists to make the change IMPOSSIBLE TO MAKE SILENTLY. It is
// green today, on purpose. Correcting the bucketing turns it red, and the red
// says where the decision lives.
//
// ⚠️ THIS IS NOT A DUPLICATE OF `goldenFixtures.test.js`. That file pins the
// SHAPE of the bug — where the resets land, that a session is carried over, that
// ET bucketing would differ materially. This one pins the four shipped VALUES a
// user reads off the chart, the correctness cost of keeping them, and the
// EXISTENCE and CONTENT of the decision record. A fix that updated the golden
// file and forgot the record would pass there and fail here.
//
// Record: `docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`
// Spec row: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11

const DECISION_ID = 'VWAP_SESSION_ANCHOR'
const RECORD = join(process.cwd(), '..', 'docs', 'decisions', '2026-08-02-vwap-utc-day-bucketing.md')
const BARS = fixture.bars

/** The shipped VWAP at the four bars where UTC-day and ET-session bucketing
 *  disagree, to 4dp. Measured by B3 Task 7; §3 of the decision record. */
const SHIPPED = {
  192: 106.8533,   // Fri 20:00 EDT — 11-01 00:00 UTC: wiped on a session's LAST bar
  373: 93.7233,    // Mon 19:00 EST — 11-04 00:00 UTC: the split hour MOVED
  386: 93.9178,    // Tue 04:00 EST — the open that is not a UTC boundary at all
  566: 112.5800,   // Tue 19:00 EST — 11-05 00:00 UTC
}
/** What a session anchor would read at the same bars. Same source. */
const SESSION_ANCHORED = { 192: 101.9471, 373: 96.4361, 386: 108.3633, 566: 109.4466 }

const round4 = (v) => Number(v.toFixed(4))

describe(`${DECISION_ID} — the UTC-day bucketing is PINNED, not endorsed`, () => {
  it('the decision record exists and carries this id', () => {
    // The record is the whole point: a red assertion below is only useful if it
    // can point somewhere. Deleting or renaming the file breaks this first.
    expect(existsSync(RECORD), `${RECORD} is missing — the decision has nowhere to live`).toBe(true)
    const text = readFileSync(RECORD, 'utf8')
    expect(text).toContain(`**Decision id:** \`${DECISION_ID}\``)
    expect(text, 'the record no longer says the decision is open').toMatch(/Status:.*OPEN/)
    // It must name the file that will have to change, or "apply the decision"
    // becomes a scavenger hunt.
    expect(text).toContain('computeVWAP')
    expect(text).toContain('compute.rev')
  })

  it('the record states the pixel cost of correcting it, and this test\'s own path', () => {
    // The MACD precedent: the owner acted on a measured number, not a claim.
    // A record that lost its measurement is a record that cannot be decided on.
    const text = readFileSync(RECORD, 'utf8')
    expect(text, 'the measured pixel cost is gone from the record').toMatch(/\*\*2,590\*\*/)
    expect(text, 'the record does not name the test that pins it')
      .toContain('vwapUtcBucketing.test.js')
  })

  it('computeVWAP still buckets by UTC DAY — the four values a user reads today', () => {
    // ⛔ IF THIS IS RED, YOU CHANGED WHAT THE CHART DRAWS. That is allowed — it
    // is `VWAP_SESSION_ANCHOR` and it may well be the right call — but it is the
    // owner's, it needs its own commit, and §7 of the decision record lists every
    // other test that has to move with it. Do not re-baseline these numbers to
    // make a suite green.
    const got = computeVWAP(BARS)
    expect(got).toHaveLength(BARS.length)
    for (const [i, value] of Object.entries(SHIPPED)) {
      expect(round4(got[Number(i)].value), `bar ${i} — see ${DECISION_ID}`).toBe(value)
    }
  })

  it('…and the ENGINE reads the same function, so a fix cannot half-land', () => {
    // Both lanes go through `computeVWAP`. That is why correcting it moves the
    // legacy block and the engine together — and why `engine_vwap_vs_legacy`
    // would report 0 either way, which is exactly why the decision is measured on
    // `vwap_only` instead.
    const def = engineRegistry.getDefinition('vwap')
    const cols = engineRegistry.computeFor(def, BARS, {})
    const raw = computeVWAP(BARS)
    for (const i of Object.keys(SHIPPED).map(Number)) {
      expect(cols.vwap[i], `bar ${i}: the engine's column left computeVWAP`).toBe(raw[i].value)
    }
  })

  it('the pin is NOT vacuous — a session anchor gives materially different numbers', () => {
    // Without this, every assertion above would still pass on a fixture where the
    // two bucketings happened to agree, and the pin would be guarding nothing.
    // Task 7's mutation T7 is the other half of this: with the post-market drift
    // removed the Monday split costs $0.36 instead of $2.71 and the fixture stops
    // being able to tell the two apart at all.
    for (const i of Object.keys(SHIPPED).map(Number)) {
      const delta = Math.abs(SHIPPED[i] - SESSION_ANCHORED[i])
      expect(delta, `bar ${i} — the two bucketings agree here`).toBeGreaterThan(2)
    }
    // …and the worst of them is the session OPEN, which is the number the record
    // leads with and the reason this is a correctness decision rather than a
    // cosmetic one.
    expect(round4(Math.abs(SHIPPED[386] - SESSION_ANCHORED[386]))).toBe(14.4455)
  })

  it('the correctness cost is a WHOLE SESSION, not four bars', () => {
    // Four pinned values could be four unlucky bars. This is the magnitude claim
    // the record's §3 makes, recomputed from the shipped function rather than
    // copied: Tuesday's session (bars 386..578) is more than $0.50 wrong for 120
    // of its 193 bars, and 207 of all 579 bars are wrong by more than a cent.
    const got = computeVWAP(BARS).map(p => p.value)
    const session = JSON.parse(readFileSync(
      join(process.cwd(), '..', 'tests', 'fixtures', 'indicators', 'intraday5m_sessions.json'), 'utf8',
    )).session
    const anchored = session.etSessionVwap
    const overCent = got.filter((v, i) => Math.abs(v - anchored[i]) > 0.01).length
    const tueOver50c = got.slice(386, 579).filter((v, i) => Math.abs(v - anchored[386 + i]) > 0.5).length
    expect(overCent, 'bars wrong by more than a cent').toBe(207)
    expect(tueOver50c, 'Tuesday bars wrong by more than fifty cents').toBe(120)
  })

  it('the vwap definition is still on compute.rev 1 — the bump has not happened', () => {
    // Applying the decision is a `compute.rev` bump (§7), NOT a `version` bump —
    // the opposite of the head-mask, which was presentation. This asserts the
    // pre-decision pair so the bump cannot arrive without a red test next to the
    // record that explains it.
    const def = engineRegistry.getDefinition('vwap')
    expect(def.compute.rev, `${DECISION_ID} was applied without updating its record`).toBe(1)
    expect(def.version).toBe(1)
  })
})
