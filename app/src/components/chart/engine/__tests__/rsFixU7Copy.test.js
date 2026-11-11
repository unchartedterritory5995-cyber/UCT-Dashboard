// app/src/components/chart/engine/__tests__/rsFixU7Copy.test.js
//
// ─── Review findings #9, #21, #22, #23, #35 (2026-11-07): the RS card copy ────
//
// Each block names its finding. The copy rails in readoutSchema.evidence.test.js
// (two sentences at most, no emoji, the must-not-claim list) still run over the
// same cards; this file pins what the review found wrong.
import { describe, it, expect } from 'vitest'
import { cardEvidenceText, readoutRows } from '../readoutSchema'
import { getDefinition } from '../nativeRegistry'

const HONESTY = 'No published hit rate exists for this signal and UCT has not measured one yet.'
// The server's sentence (rs_evidence_pull.sentence_for): since owner decision N6
// (2026-11-07) the hit rate states its base, the next session's open.
const MEASURED = '1,284 RS new highs before price on 240 sessions, 2025-11-05 to 2026-11-04, daily bars: 58.3% beat SPY from the next session\'s open to the close 63 sessions later (about 3 months; median +2.1%), against 50.2% for all bars. Universe as held, survivorship not yet corrected.'
const BULKOWSKI = 'Bulkowski measured 15,763 chart patterns: the direction of RS before a breakout barely changed the result, while RS rising after the breakout did (an average gain of 41% against 22%).'

const RS = getDefinition('rsLine')
const rowOf = (key) => RS.readout.find((e) => e.key === key)
const cardOf = (key) => rowOf(key).card
const entry = (card) => ({ key: 'x', label: 'X', source: 'scalar:a.b', format: 'text', card })

describe('finding #9 — the Mansfield card prints the length actually used', () => {
  it('the card no longer says "(200 bars daily, 52 weekly)" and says the length row prints the bars', () => {
    const what = cardOf('mansfield').what
    expect(what).not.toMatch(/200 bars daily, 52 weekly/)
    expect(what).toMatch(/Mansfield length/)
    expect(what).toMatch(/52/)            // Weinstein's weekly length is still named, as a setting
    expect(what).toMatch(/Weinstein/)
  })

  it('a readout row prints the length the server used (`payload.mansfield.lengthText`) — a weekly chart at the default reads 200 bars, not 52', () => {
    const row = rowOf('mansfieldLength')
    expect(row, 'a mansfieldLength readout row exists').toBeTruthy()
    // visual spec, Mansfield card: `Length  200 bars` (2026-11-07). The server
    // writes the words from the length it computed with, so the two cannot differ.
    expect(row.source).toBe('scalar:mansfield.lengthText')
    const weeklyDefault = { mansfield: { value: 4.2, length: 200, lengthText: '200 bars', stateLabel: 'bull' } }
    const rows = readoutRows(RS, weeklyDefault, { inputs: {} })
    expect(rows.find((r) => r.key === 'mansfieldLength').text).toBe('200 bars')
    const trendWeekly = { mansfield: { value: 4.2, length: 52, lengthText: '52 bars' } }
    expect(readoutRows(RS, trendWeekly, { inputs: {} }).find((r) => r.key === 'mansfieldLength').text).toBe('52 bars')
    // it sits in the Mansfield card it qualifies (visual round A1: the numbers
    // block Value, Last zero cross, Length), never in the glance list
    expect(row.detailOf).toBe('mansfield')
    const mansfieldDetails = RS.readout.filter((e) => e.detailOf === 'mansfield').map((e) => e.key)
    expect(mansfieldDetails).toEqual(['mansfieldValue', 'mansfieldCross', 'mansfieldLength'])
    // a v1 envelope (flag off) has no mansfield block: the row is omitted, never "undefined"
    expect(readoutRows(RS, { benchmark: { resolved: 'SPY' } }, { inputs: {} }).some((r) => r.key === 'mansfieldLength')).toBe(false)
  })
})

describe('finding #21 — the Checks card states UCT\'s threshold, not an unmeasured "unusual / noise" claim', () => {
  it('drops "six in twenty is unusual, one is noise" and says 6 of 20 is UCT\'s own threshold', () => {
    const ev = cardOf('checks').evidence
    expect(ev).not.toMatch(/unusual/)
    expect(ev).not.toMatch(/noise/)
    expect(ev).toMatch(/6 of the last 20/)
    expect(ev).toMatch(/UCT's own threshold/)
    expect(ev).toMatch(/3/)              // the looser screener scan is named, so the two read as two rules
    expect(ev).toMatch(/No published hit rate exists for these checks and UCT has not measured them yet\.$/)
  })
})

describe('finding #22 — the Before-price card keeps its literature line when the server sentence lands', () => {
  it('measured: the Bulkowski line, then the measured sentence verbatim', () => {
    const e = rowOf('beforePrice')
    const payload = { evidence: { sentence: { beforePrice: MEASURED } } }
    expect(cardEvidenceText(e, payload)).toBe(`${BULKOWSKI} ${MEASURED}`)
  })

  it('the provider\'s honesty form: the Bulkowski line, then the honesty sentence (the same text as no envelope)', () => {
    const e = rowOf('beforePrice')
    expect(cardEvidenceText(e, { evidence: { sentence: { beforePrice: HONESTY } } })).toBe(`${BULKOWSKI} ${HONESTY}`)
    expect(cardEvidenceText(e, null)).toBe(`${BULKOWSKI} ${HONESTY}`)
  })

  it('a below-floor server sentence replaces only the stand-in, never the literature', () => {
    const below = 'UCT measured 41 events on 30 sessions, too few to print a hit rate (floor 100).'
    expect(cardEvidenceText(rowOf('beforePrice'), { evidence: { sentence: { beforePrice: below } } })).toBe(`${BULKOWSKI} ${below}`)
  })

  it('a card whose static line is the stand-in alone still prints the server sentence alone', () => {
    for (const key of ['rsHigh', 'redDay', 'phase', 'mansfield']) {
      expect(cardEvidenceText(rowOf(key), { evidence: { sentence: { [key]: MEASURED } } }), key).toBe(MEASURED)
    }
    expect(cardEvidenceText(entry({ what: 'w', origin: 'o', evidence: 'static line', evidenceSource: 'scalar:s.k' }), { s: { k: MEASURED } })).toBe(MEASURED)
  })

  it('rail: every sourced card\'s static line ENDS in the honesty sentence, the stand-in the server sentence replaces', () => {
    for (const e of RS.readout.filter((x) => x.card && x.card.evidenceSource)) {
      expect(e.card.evidence.endsWith(HONESTY), e.key).toBe(true)
    }
  })
})

describe('finding #23 — the fast rating card describes a nightly snapshot of the hourly rank', () => {
  it('no "read hourly ... moves during the session", no "a few points"; names the nightly capture and ~138 sessions', () => {
    const { what, origin } = cardOf('fastRating')
    const text = `${what} ${origin}`
    expect(text).not.toMatch(/moves during the session/)
    expect(text).not.toMatch(/a few points/)
    expect(text).not.toMatch(/200 days/)
    expect(what).toMatch(/nightly/)
    expect(what).toMatch(/hourly RS Rank/)
    expect(what).toMatch(/138 sessions/)
    expect(what).toMatch(/3-month, 6-month, 1-month and 1-week/)
    expect(origin).toMatch(/differ widely/)
  })
})

describe('finding #35 — the regime card says fourteen of the fifteen worst months came in rising markets', () => {
  it('no "all ... during rebounds"; the source\'s 14 of 15', () => {
    const ev = cardOf('regime').evidence
    expect(ev).not.toMatch(/during rebounds/)
    expect(ev).toMatch(/all came after a negative two-year market return, fourteen of them in months the market rose \(1932, 2001, 2009\)/)
  })
})
