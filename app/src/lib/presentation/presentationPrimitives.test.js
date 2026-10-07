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
  formatPercentAsSent,
  formatCompact,
  COMPACT_TIERS,
  TERMINAL_COMPACT_TIERS,
  formatCompactTerminal,
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

  it('formatCurrency reproduces presentationFormat.formatPrice on every input -- except the ONE deliberate move: the minus goes before the "$"', () => {
    // "$-2.90" read as a typo to members; "-$2.90" is the only intended change.
    const signMoved = (s) => (String(s).startsWith('$-') ? `-$${String(s).slice(2)}` : String(s))
    for (const v of NUMERIC_INPUTS) {
      expect(formatCurrency(v), `formatCurrency(${String(v)})`).toBe(signMoved(OLD_formatPrice(v)))
    }
    expect(formatCurrency(-2.9)).toBe('-$2.90')
    expect(OLD_formatPrice(-2.9)).toBe('$-2.90') // the oracle still differs, so the move is real
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
    // a negative that ROUNDS to zero is zero, never "-0.00%" (accuracy audit 2026-10-06)
    expect(formatPercent(-0.001)).toBe('0.00%')
    expect(formatPercent(-0.001, { signed: true })).toBe('0.00%')
    expect(formatPercent(-0.004, { decimals: 2 })).toBe('0.00%')
    expect(formatPercent(-0.005, { decimals: 2 })).toBe('-0.01%')        // a real -0.01 keeps its sign
    expect(formatPercent(-0.04, { decimals: 1, signed: true })).toBe('0.0%')
    expect(formatPercent(-0)).toBe('0.00%')
    expect(formatPercent(0.001, { signed: true })).toBe('+0.00%')
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

describe('formatCompact (TERM-066) — volume, market cap, revenue, share count', () => {
  it('the default ladder is B / M / K at one decimal, picked by MAGNITUDE', () => {
    expect(formatCompact(11_800_000)).toBe('11.8M')
    expect(formatCompact(25e9)).toBe('25.0B')
    expect(formatCompact(1500)).toBe('1.5K')
    expect(formatCompact(-2_500_000)).toBe('-2.5M')
    expect(COMPACT_TIERS.map((t) => t.suffix)).toEqual(['B', 'M', 'K'])
    expect(Object.isFrozen(COMPACT_TIERS)).toBe(true)
  })

  it('below the smallest tier it is a Math.round integer — and never "-0"', () => {
    expect(formatCompact(999.4)).toBe('999')
    // rounds up to the K threshold, so it prints in K (accuracy audit 2026-10-06; was "1000")
    expect(formatCompact(999.5)).toBe('1.0K')
    expect(formatCompact(-0.4)).toBe('0')
    expect(formatCompact(0)).toBe('0')
  })

  it('a currency prefix goes INSIDE the minus: "-$2.9B", never "$-2.9B"', () => {
    expect(formatCompact(-2.9e9, { prefix: '$' })).toBe('-$2.9B')
    expect(formatCompact(-1.5e9, { prefix: '$' })).toBe('-$1.5B')
    expect(formatCompact(-512, { prefix: '$' })).toBe('-$512')
    expect(formatCompact(512, { prefix: '$' })).toBe('$512')
    expect(formatCompact(-1.5e9)).toBe('-1.5B')              // no prefix: unchanged
  })

  it('per-tier decimals, and "round" is Math.round — NOT toFixed(0)', () => {
    const tiers = [{ at: 1e6, suffix: 'M', decimals: 2 }, { at: 1e3, suffix: 'K', decimals: 'round' }]
    expect(formatCompact(2_072_358, { tiers })).toBe('2.07M')
    expect(formatCompact(-2500, { tiers })).toBe('-2K')
    const fixed0 = [{ at: 1e3, suffix: 'K', decimals: 0 }]
    expect(formatCompact(-2500, { tiers: fixed0 })).toBe('-3K')
    // a ladder with no B tier keeps counting in M
    expect(formatCompact(1e9, { tiers })).toBe('1000.00M')
  })

  it('a value that ROUNDS up to the next tier prints in it (accuracy audit 2026-10-06)', () => {
    // was "1000.0K" / "1000K" / "1000.0M": the tier was picked before rounding
    expect(formatCompact(999_950)).toBe('1.0M')
    expect(formatCompact(999_949)).toBe('999.9K')               // just below: unchanged
    expect(formatCompact(-999_950)).toBe('-1.0M')
    expect(formatCompact(999_950_000)).toBe('1.0B')
    expect(formatCompact(999.6)).toBe('1.0K')                   // below the smallest tier too
    expect(formatCompact(999.4)).toBe('999')
    expect(formatCompactTerminal(999_999)).toBe('1.0M')         // was "1000K"
    expect(formatCompactTerminal(999_499)).toBe('999K')
    expect(formatCompactTerminal(999_950_000, { money: true })).toBe('$1.00B')   // was "$1000.0M"
    expect(formatCompactTerminal(-999_995_000_000, { money: true })).toBe('-$1.00T')
    expect(formatCompactTerminal(999.5)).toBe('1K')
    // the top tier has nothing to promote to; a ladder without B keeps counting in M
    expect(formatCompactTerminal(1e18)).toBe('1000000.00T')
    const tiers = [{ at: 1e6, suffix: 'M', decimals: 2 }, { at: 1e3, suffix: 'K', decimals: 'round' }]
    expect(formatCompact(999_999_999, { tiers })).toBe('1000.00M')
    expect(formatCompact(999_500, { tiers })).toBe('1.00M')     // Math.round(999.5) = 1000 -> M
  })

  it('independent reference: no rendered number ever reads 1000 of a unit that has a next tier', () => {
    // the units that HAVE a next tier: default ladder K M (B is its top), terminal K M B (T top)
    let x = 0x5eed
    for (let i = 0; i < 20000; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0
      const v = (x / 2 ** 32) * 10 ** (1 + (i % 13)) * (i % 2 ? -1 : 1)
      for (const [out, units] of [[formatCompact(v), 'KM'], [formatCompactTerminal(v, { money: true }), 'KMB']]) {
        const m = out.match(/(\d+(?:\.\d+)?)([KMBT]?)$/)
        const hasNext = m && (m[2] ? units.includes(m[2]) : true)
        if (hasNext) expect(Number(m[1]), `${v} -> ${out}`).toBeLessThan(1000)
      }
    }
  })

  it('is total: a non-finite or non-number value is the caller’s absent', () => {
    expect(formatCompact(NaN)).toBe(ABSENT)
    expect(formatCompact(Infinity)).toBe(ABSENT)
    expect(formatCompact(null)).toBe(ABSENT)
    expect(formatCompact('1000')).toBe(ABSENT)
    expect(formatCompact(undefined, { absent: '' })).toBe('')
  })
})

describe('formatNumber decimals', () => {
  it('pins the fraction on both sides so 1 and 1.5 align in a column', () => {
    expect(formatNumber(1, { decimals: 2 })).toBe('1.00')
    expect(formatNumber(1.5, { decimals: 2 })).toBe('1.50')
    expect(formatNumber(1234.5, { decimals: 2 })).toBe('1,234.50')
    expect(formatNumber(1234.567, { decimals: 0 })).toBe('1,235')
  })

  it('grouping: false drops the thousands separator and nothing else', () => {
    expect(formatNumber(1234.5, { decimals: 2, grouping: false })).toBe('1234.50')
    expect(formatNumber(-1234567.891, { decimals: 1, grouping: false })).toBe('-1234567.9')
    expect(formatNumber(1234567, { grouping: false })).toBe('1234567')
    expect(formatNumber(NaN, { grouping: false })).toBe(ABSENT)
    // byte-identical to the toFixed grammar it replaces in the options panels
    for (const v of [0, 0.005, 1.005, 2.5, -2.5, 12.345, 999.995, 1234.5678, -0.4]) {
      for (const d of [0, 1, 2, 3]) {
        expect(formatNumber(v, { decimals: d, grouping: false })).toBe(v.toFixed(d))
      }
    }
  })
})

describe('formatCompactTerminal — the ONE large-number rule every terminal panel uses', () => {
  it('T and B at two decimals, M at one, K whole, below 1,000 a whole number', () => {
    expect(formatCompactTerminal(2.912e12)).toBe('2.91T')
    expect(formatCompactTerminal(391.035e9)).toBe('391.04B')
    expect(formatCompactTerminal(45_340_000)).toBe('45.3M')
    expect(formatCompactTerminal(950_400)).toBe('950K')
    expect(formatCompactTerminal(812.4)).toBe('812')
    expect(formatCompactTerminal(0)).toBe('0')
    expect(TERMINAL_COMPACT_TIERS.map((t) => `${t.suffix}${t.decimals}`)).toEqual(['T2', 'B2', 'M1', 'K0'])
    expect(Object.isFrozen(TERMINAL_COMPACT_TIERS)).toBe(true)
  })

  it('money: true adds the dollar sign INSIDE the minus', () => {
    expect(formatCompactTerminal(94.93e9, { money: true })).toBe('$94.93B')
    expect(formatCompactTerminal(-48.8e6, { money: true })).toBe('-$48.8M')
    expect(formatCompactTerminal(-1.25e9, { money: true })).toBe('-$1.25B')
    expect(formatCompactTerminal(500_000, { money: true })).toBe('$500K')
  })

  it('a missing value is the caller’s absent, the shared em dash by default', () => {
    expect(formatCompactTerminal(null)).toBe(ABSENT)
    expect(formatCompactTerminal(NaN, { money: true })).toBe(ABSENT)
    expect(formatCompactTerminal(undefined, { money: true, absent: '' })).toBe('')
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

describe('TERM-066 golden — a pre-1900 date formats, it does not crash or blank', () => {
  // Ledger A3's strftime crash class. 1895-06-10 12:00 UTC is 7:00 AM in New York:
  // after 1883 standard time, before 1918 daylight saving, so the answer is fixed.
  const epoch1895 = Date.UTC(1895, 5, 10, 12, 0, 0) / 1000

  it('formatDateTimeEt renders a negative epoch as a real ET date-time', () => {
    expect(epoch1895).toBeLessThan(0)
    expect(formatDateTimeEt(epoch1895)).toBe('6/10/1895, 7:00:00 AM ET')
  })

  it('formatTimeEt renders the same instant, never "Invalid Date" or the absent value', () => {
    const out = formatTimeEt(new Date(epoch1895 * 1000), { absent: 'ABSENT' })
    expect(out).toBe('7:00 AM')
  })
})

describe('formatCurrency grouping (completeness audit 2026-10-07)', () => {
  it('the default is unchanged: toFixed, ungrouped', () => {
    expect(formatCurrency(1234.5)).toBe('$1234.50')
    expect(formatCurrency(-2.9, { decimals: 0 })).toBe('-$3')
  })
  it('grouping: a grouped amount, the sign inside the minus, halves away from zero', () => {
    expect(formatCurrency(12500, { decimals: 0, grouping: true })).toBe('$12,500')
    expect(formatCurrency(-12500.4, { decimals: 0, grouping: true })).toBe('-$12,500')
    expect(formatCurrency(-2.5, { decimals: 0, grouping: true })).toBe('-$3')
    expect(formatCurrency(1234.567, { grouping: true })).toBe('$1,234.57')
  })
  it('a value that rounds to zero is zero, never "-$0"', () => {
    expect(formatCurrency(-0.4, { decimals: 0, grouping: true })).toBe('$0')
    expect(formatCurrency(-0, { decimals: 0, grouping: true })).toBe('$0')
    expect(formatCurrency(-0.001, { grouping: true })).toBe('$0.00')
    expect(formatCurrency(-0.6, { decimals: 0, grouping: true })).toBe('-$1')
  })
  it('absent as every primitive', () => {
    expect(formatCurrency(NaN, { grouping: true })).toBe(ABSENT)
    expect(formatCurrency(null, { grouping: true, absent: null })).toBe(null)
  })
})

describe('formatPercentAsSent (completeness audit 2026-10-07)', () => {
  it('prints what the server sent: no padded zeros, ungrouped, up to three decimals', () => {
    expect(formatPercentAsSent(3.27)).toBe('3.27%')
    expect(formatPercentAsSent(3)).toBe('3%')
    expect(formatPercentAsSent(87.5)).toBe('87.5%')
    expect(formatPercentAsSent(1234.5)).toBe('1234.5%')
    expect(formatPercentAsSent(-12.25)).toBe('-12.25%')
    expect(formatPercentAsSent('3.5')).toBe('3.5%')
  })
  it('zero has no sign; a missing or non-numeric value is absent, never "NaN%" / "null%"', () => {
    expect(formatPercentAsSent(-0)).toBe('0%')
    expect(formatPercentAsSent(null)).toBe(ABSENT)
    expect(formatPercentAsSent('')).toBe(ABSENT)
    expect(formatPercentAsSent('n/a')).toBe(ABSENT)
    expect(formatPercentAsSent(Infinity, { absent: null })).toBe(null)
  })
})
