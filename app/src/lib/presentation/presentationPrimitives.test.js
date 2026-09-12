// app/src/lib/presentation/presentationPrimitives.test.js
//
// ─── THE BYTE-IDENTITY PROOF, AND IT IS AN ORACLE, NOT A SNAPSHOT ───────────
//
// S10's approval condition is "no member-visible layout change; snapshot tests
// prove S8 renders byte-identical before and after adoption."
//
// ⛔ A COMMITTED SNAPSHOT FILE COULD NOT HAVE PROVED IT HERE. Three of the four
// formatters being replaced are timezone- and locale-sensitive, and one of them
// (`Cited`'s) renders in the VIEWER's zone — so a stored expected-string is a
// fact about the machine that generated it, not about the code. Run the suite
// in another timezone and a green snapshot turns red for a reason that is not
// a regression, which is `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`
// wearing a fixture's clothes.
//
// ⭐ SO THE ORACLE IS THE OLD CODE ITSELF, FROZEN VERBATIM BELOW, RUN IN THE
// SAME PROCESS. Both sides see the same TZ, the same ICU, the same Node. The
// assertion is `newFn(x) === oldFn(x)` over a wide input matrix, which is the
// claim the approval actually makes and is true in every timezone at once.
//
// ⛔ THE FROZEN BLOCK IS A COPY OF DELETED CODE AND MUST NOT BE "TIDIED".
// Reformatting it, or "fixing" its duplication against S10, destroys the only
// independent witness to what shipped before this commit. It is dead code on
// purpose. If S10's behaviour must change later, the frozen block is what says
// out loud that the change is member-visible.

import { describe, it, expect } from 'vitest'
import {
  ABSENT,
  LOCALE,
  MARKET_TIME_ZONE,
  formatNumber,
  formatPercent,
  formatCurrency,
  formatTimeEt,
  formatDateTimeEt,
  formatFreshnessAsOf,
} from './presentationPrimitives'

// ──────────────────────────────────────────────────────────────────────────
// THE FROZEN PRE-S10 IMPLEMENTATIONS. Copied character-for-character from the
// files named beside each one, as they stood at `07ce46090`. DO NOT EDIT.
// ──────────────────────────────────────────────────────────────────────────

/** was: `app/src/components/provenance/CoverageLine.jsx` — `const n` */
const OLD_n = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US') : '—')

/** was: `app/src/components/provenance/presentationFormat.js` — `formatPrice` */
function OLD_formatPrice(value) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—'
}

/** was: `app/src/components/provenance/presentationFormat.js` — `formatEtTime` */
function OLD_formatEtTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

/** was: `app/src/components/provenance/FreshnessBadge.jsx` — `formatAsOf` */
function OLD_formatAsOf(asOf) {
  if (!asOf) return null
  const d = new Date(asOf)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/** was: `app/src/components/provenance/Cited.jsx` — `epochToLocal` */
function OLD_epochToLocal(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null
  return new Date(epochSeconds * 1000).toLocaleString('en-US')
}

// ──────────────────────────────────────────────────────────────────────────
// The input matrix. Deliberately wider than the call sites: the ordinary
// values, the boundary values, and every shape of "no value" this app actually
// produces — `null`, `undefined`, `''`, `NaN`, `Infinity`, a non-number.
// ──────────────────────────────────────────────────────────────────────────

const NUMERIC_INPUTS = [
  0, 1, -1, 7, 41, 2615, 3742, 3699, 999, 1000, 1000000, 1234567890,
  0.5, -0.5, 1.005, 2.675, 1.5, -1.5, 99.994, 99.995, 123.456,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  NaN, Infinity, -Infinity, null, undefined, '', '42', {}, [],
]

const TIME_INPUTS = [
  '2026-09-11T13:32:15.000Z',   // a regular RTH minute, EDT
  '2026-09-11T20:00:00.000Z',   // the close, EDT
  '2026-01-15T14:30:00.000Z',   // EST, so the offset differs by an hour
  '2026-03-08T06:59:00.000Z',   // the minute before the US DST jump
  '2026-03-08T07:01:00.000Z',   // the minute after it
  '2026-11-01T05:30:00.000Z',   // inside the ambiguous fall-back hour
  '2026-09-11T04:00:00.000Z',   // midnight ET
  '2026-09-11T16:00:00.000Z',   // noon ET
  1757603535000,                // epoch millis — `new Date(number)` accepts it
  new Date('2026-09-11T13:32:15.000Z'),
  'not a date', '', null, undefined, 0, NaN,
]

const EPOCH_SECOND_INPUTS = [
  0, 1, 1757603535, 1735689600, 1e9, -1, 1.5,
  NaN, Infinity, null, undefined, '', '1757603535',
]

describe('S10 primitives are byte-identical to the helpers they replace', () => {
  it('formatNumber reproduces CoverageLine.jsx `n()` on every input', () => {
    for (const v of NUMERIC_INPUTS) {
      expect(formatNumber(v), `formatNumber(${String(v)})`).toBe(OLD_n(v))
    }
  })

  it('formatCurrency reproduces presentationFormat.formatPrice on every input', () => {
    for (const v of NUMERIC_INPUTS) {
      expect(formatCurrency(v), `formatCurrency(${String(v)})`).toBe(OLD_formatPrice(v))
    }
  })

  it('formatTimeEt({seconds:true}) reproduces presentationFormat.formatEtTime', () => {
    for (const v of TIME_INPUTS) {
      expect(formatTimeEt(v, { seconds: true }), `formatTimeEt(${String(v)})`)
        .toBe(OLD_formatEtTime(v))
    }
  })

  it('formatTimeEt({seconds:false}) reproduces FreshnessBadge.formatAsOf', () => {
    for (const v of TIME_INPUTS) {
      expect(formatTimeEt(v), `formatTimeEt(${String(v)})`).toBe(OLD_formatAsOf(v))
    }
  })

  it('⚰️ formatDateTimeEt DELIBERATELY DIVERGES from Cited.epochToLocal', () => {
    // ⚰️ THIS ASSERTED `.toBe(OLD_epochToLocal(v))` AND IT WAS TRUE. S10's first
    // build kept `<Cited>`'s viewer-local render byte-identical because its
    // approval demanded it. The ET fix (owner, 2026-09-12) is a SEPARATE line
    // that is ALLOWED to move the string, so the byte-identity claim is retired
    // here rather than deleted — and replaced by the record of what changed.
    for (const v of EPOCH_SECOND_INPUTS) {
      if (!Number.isFinite(v)) {
        // The ABSENT behaviour is unchanged, and that half still must not move.
        expect(formatDateTimeEt(v), `formatDateTimeEt(${String(v)})`)
          .toBe(OLD_epochToLocal(v))
      } else {
        expect(formatDateTimeEt(v)).toMatch(/ ET$/)
        expect(OLD_epochToLocal(v)).not.toMatch(/ ET$/)
      }
    }
  })
})

describe('the oracle can actually fail — non-vacuity', () => {
  // ⛔ WITHOUT THIS, THE FIVE ASSERTIONS ABOVE COULD BE COMPARING TWO COPIES OF
  // `undefined` AND PASSING. "An empty result is a failed invocation until
  // proven otherwise" (rule 14): each of these proves the frozen oracle
  // produced a REAL, DISTINCT string for at least one input, so an equality
  // that holds is holding over something.
  it('the frozen oracles return real formatted strings, not blanks', () => {
    expect(OLD_n(3742)).toBe('3,742')
    expect(OLD_formatPrice(12.5)).toBe('$12.50')
    expect(OLD_formatEtTime('2026-09-11T13:32:15.000Z')).toMatch(/\d:\d\d:\d\d\s?(AM|PM)/)
    expect(OLD_formatAsOf('2026-09-11T13:32:15.000Z')).toMatch(/\d:\d\d\s?(AM|PM)/)
    expect(OLD_epochToLocal(1757603535)).toMatch(/\d/)
  })

  it('the seconds option is load-bearing: the two time oracles DISAGREE', () => {
    // If `seconds` were ignored, the two byte-identity tests above would both
    // pass against ONE behaviour and the distinction S10 preserves would be
    // silently gone.
    const iso = '2026-09-11T13:32:15.000Z'
    expect(OLD_formatEtTime(iso)).not.toBe(OLD_formatAsOf(iso))
    expect(formatTimeEt(iso, { seconds: true })).not.toBe(formatTimeEt(iso))
  })

  it('a deliberately wrong implementation is caught', () => {
    // The mutation, run inline: a `formatNumber` that dropped the locale.
    const mutated = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('de-DE') : '—')
    expect(mutated(3742)).not.toBe(OLD_n(3742))
  })
})

describe('the declared constants', () => {
  it('there is exactly one locale and one market zone, and they are exported', () => {
    expect(LOCALE).toBe('en-US')
    expect(MARKET_TIME_ZONE).toBe('America/New_York')
    expect(ABSENT).toBe('—')
    // ⛔ An em dash, not a hyphen-minus. They are visually similar and the
    // tables in `CoverageLine` align on the wider glyph.
    expect(ABSENT.charCodeAt(0)).toBe(0x2014)
  })
})

describe('the absent sentinel is the caller\u2019s choice, not a constant', () => {
  it('number and currency default to the em dash; time defaults to null', () => {
    expect(formatNumber(NaN)).toBe(ABSENT)
    expect(formatCurrency(NaN)).toBe(ABSENT)
    expect(formatTimeEt(null)).toBe(null)
    expect(formatDateTimeEt(NaN)).toBe(null)
  })

  it('and every one of them is overridable, because the S8 four disagree', () => {
    expect(formatNumber(NaN, { absent: null })).toBe(null)
    expect(formatCurrency(NaN, { absent: 'n/a' })).toBe('n/a')
    expect(formatTimeEt(null, { absent: ABSENT })).toBe(ABSENT)
  })
})

describe('formatPercent', () => {
  it('renders percent UNITS, never a fraction times one hundred', () => {
    expect(formatPercent(1.5)).toBe('1.50%')
    expect(formatPercent(-2.25)).toBe('-2.25%')
    expect(formatPercent(0)).toBe('0.00%')
    expect(formatPercent(100)).toBe('100.00%')
  })

  it('signed adds the plus and never a second minus', () => {
    expect(formatPercent(1.5, { signed: true })).toBe('+1.50%')
    expect(formatPercent(0, { signed: true })).toBe('+0.00%')
    expect(formatPercent(-1.5, { signed: true })).toBe('-1.50%')
    expect(formatPercent(-1.5, { signed: true })).not.toContain('+')
  })

  it('decimals', () => {
    expect(formatPercent(1.234, { decimals: 0 })).toBe('1%')
    expect(formatPercent(1.234, { decimals: 1 })).toBe('1.2%')
    expect(formatPercent(1.234, { decimals: 3 })).toBe('1.234%')
  })

  it('absent', () => {
    expect(formatPercent(NaN)).toBe(ABSENT)
    expect(formatPercent(null)).toBe(ABSENT)
    expect(formatPercent(undefined, { absent: null })).toBe(null)
  })
})

describe('formatNumber decimals', () => {
  it('pins the fraction on both sides so 1 and 1.5 align in a column', () => {
    expect(formatNumber(1, { decimals: 2 })).toBe('1.00')
    expect(formatNumber(1.5, { decimals: 2 })).toBe('1.50')
    expect(formatNumber(1234.5, { decimals: 2 })).toBe('1,234.50')
    expect(formatNumber(1234.567, { decimals: 0 })).toBe('1,235')
  })
})

describe('formatFreshnessAsOf', () => {
  const iso = '2026-09-11T13:32:15.000Z'

  it('a real-time value gets NO as-of clause', () => {
    expect(formatFreshnessAsOf({ tier: 'real_time', asOf: iso })).toBe(null)
  })

  it('every other tier gets one, with the zone label attached', () => {
    for (const tier of ['delayed_15', 'end_of_day', 'historical', 'stale', 'unknown', null]) {
      const out = formatFreshnessAsOf({ tier, asOf: iso })
      expect(out, `tier=${String(tier)}`).toMatch(/^as of .* ET$/)
    }
  })

  it('no as-of timestamp means no clause, not the words "as of null"', () => {
    expect(formatFreshnessAsOf({ tier: 'delayed_15', asOf: null })).toBe(null)
    expect(formatFreshnessAsOf({ tier: 'delayed_15', asOf: 'not a date' })).toBe(null)
    expect(formatFreshnessAsOf({})).toBe(null)
  })

  it('the tier is an INPUT — this function maps no FreshnessClass of its own', () => {
    // D1's raw class strings are NOT tiers. Handing one in must not be silently
    // understood: only the literal tier `real_time` suppresses the clause, and
    // `freshnessContract.mapD1Freshness` is the only thing that produces it.
    expect(formatFreshnessAsOf({ tier: 'realtime', asOf: iso })).toMatch(/^as of /)
    expect(formatFreshnessAsOf({ tier: 'REAL_TIME', asOf: iso })).toMatch(/^as of /)
  })
})

describe('formatTimeEt pins the market zone regardless of where the reader is', () => {
  it('an ISO instant renders at its ET wall-clock, not the machine\u2019s', () => {
    // 13:32:15Z on 2026-09-11 is 09:32:15 EDT. This is the one assertion in
    // the file that would break under a different TZ if the zone were not
    // pinned — which is exactly why it is here and not left to the oracle.
    expect(formatTimeEt('2026-09-11T13:32:15.000Z', { seconds: true })).toBe('9:32:15 AM')
    expect(formatTimeEt('2026-09-11T13:32:15.000Z')).toBe('9:32 AM')
  })

  it('and it follows US DST, because the zone is named not offset', () => {
    // 14:30Z in January is 09:30 EST; the same instant in July would be 10:30.
    expect(formatTimeEt('2026-01-15T14:30:00.000Z')).toBe('9:30 AM')
    expect(formatTimeEt('2026-07-15T14:30:00.000Z')).toBe('10:30 AM')
  })

  it('zoneSuffix is appended, never interpolated into the time', () => {
    expect(formatTimeEt('2026-09-11T13:32:15.000Z', { zoneSuffix: 'ET' })).toBe('9:32 AM ET')
  })
})

describe('⚰️ the recorded divergence is FIXED — the before/after, pinned', () => {
  // ⛔ S10's first build recorded this as a defect it was not allowed to fix.
  // The owner's line of 2026-09-12 fixed it. This block is the evidence, and it
  // is written so a future "tidy-up" that un-pins the zone goes red.
  const SEC = 1757597535   // 2025-09-11 13:32:15Z

  it('renders the MARKET zone, not the viewer’s, and says so', () => {
    expect(formatDateTimeEt(SEC)).toBe('9/11/2025, 9:32:15 AM ET')
  })

  it('the BEFORE string depended on where the member sat; the AFTER does not', () => {
    // The retired rule, reproduced per zone. These are the strings four members
    // were shown for ONE instant, none of them labelled:
    const before = (tz) => new Date(SEC * 1000).toLocaleString('en-US', { timeZone: tz })
    expect(before('America/New_York')).toBe('9/11/2025, 9:32:15 AM')
    expect(before('America/Chicago')).toBe('9/11/2025, 8:32:15 AM')
    expect(before('Europe/London')).toBe('9/11/2025, 2:32:15 PM')
    expect(before('Asia/Tokyo')).toBe('9/11/2025, 10:32:15 PM')
    // ⭐ A London reader was shown "2:32:15 PM" with nothing saying which
    // afternoon that was. One answer now, for all four:
    expect(formatDateTimeEt(SEC)).toBe('9/11/2025, 9:32:15 AM ET')
  })

  it('carries a zone label — the half that made the old defect invisible', () => {
    expect(formatDateTimeEt(SEC)).toMatch(/ ET$/)
    expect(OLD_epochToLocal(SEC)).not.toMatch(/ET|UTC|GMT/)
  })

  it('still carries a DATE, which is what distinguishes it from formatTimeEt', () => {
    expect(formatDateTimeEt(SEC)).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    expect(formatTimeEt(SEC * 1000)).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })

  it('absent is unchanged — the one half that had to stay byte-identical', () => {
    for (const v of [NaN, null, undefined, '', Infinity]) {
      expect(formatDateTimeEt(v)).toBe(OLD_epochToLocal(v))
    }
  })
})
