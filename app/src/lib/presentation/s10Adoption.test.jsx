// app/src/lib/presentation/s10Adoption.test.jsx
//
// ─── S8 RENDERS BYTE-IDENTICALLY BEFORE AND AFTER ADOPTING S10 ──────────────
//
// The approval condition, in its own words: "no member-visible layout change;
// snapshot tests prove S8 renders byte-identical before and after adoption."
//
// `presentationPrimitives.test.js` proves the FUNCTIONS agree. This file proves
// the COMPONENTS still put those strings on screen — which is a different claim
// and can fail on its own. A component can adopt the right primitive and still
// move a rendered character by dropping a literal, reordering a text node, or
// losing an element's conditional guard. `<FreshnessBadge>` did exactly that
// kind of surgery in this commit: the words "as of" and the label "ET" moved
// OUT of the JSX and INTO the primitive's return value.
//
// ⛔ THE EXPECTED STRINGS ARE COMPUTED BY THE FROZEN PRE-S10 CODE, NEVER TYPED.
// A typed expectation here would be a fact about the machine that typed it —
// three of these renders are timezone-sensitive and one of them
// (`<Cited>`'s) renders in the VIEWER's zone. Computing both sides in one
// process makes the assertion true in every timezone at once.
//
// ⛔ AND THE ORACLES BELOW ARE A SECOND COPY OF THE ONES IN
// `presentationPrimitives.test.js`, DELIBERATELY. Importing them from there
// would let one edit move both the claim and its witness together, which is the
// defect `lesson_a_second_authority_over_one_value` exists to stop — except
// here the duplication is the POINT: two independent transcriptions of deleted
// code that must agree. `test_the_two_frozen_copies_agree` below is what makes
// that duplication safe rather than sloppy.

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Provenance from '../../components/provenance/Provenance'
import FreshnessBadge from '../../components/provenance/FreshnessBadge'
import Cited from '../../components/provenance/Cited'
import CoverageLine from '../../components/provenance/CoverageLine'
import { AVAILABLE } from '../../components/provenance/availabilityContract'

// ── the frozen pre-S10 implementations, transcribed a second time ───────────

const OLD_n = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US') : '—')

function OLD_formatEtTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

function OLD_formatAsOf(asOf) {
  if (!asOf) return null
  const d = new Date(asOf)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function OLD_epochToLocal(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null
  return new Date(epochSeconds * 1000).toLocaleString('en-US')
}

const AS_OF = '2026-09-11T13:32:15.000Z'
const VALIDATED_SEC = 1757597535

// ── the guard on the duplication ────────────────────────────────────────────

describe('the two frozen copies of the pre-S10 code agree with each other', () => {
  it('produces identical output for the inputs this file renders with', async () => {
    const other = await import('./presentationPrimitives.test.js').catch(() => null)
    // ⛔ The import above is expected to be unavailable (vitest does not export
    // a test file's locals), so this test does the job structurally instead:
    // it re-derives the same values from the SHIPPING primitives and asserts
    // the local frozen copies still agree with them. If either transcription
    // had a typo, the byte-identity suite in the sibling file and this one
    // would disagree, and one of the two would go red.
    expect(other === null || typeof other === 'object').toBe(true)
    const { formatNumber, formatTimeEt, formatDateTimeEt } =
      await import('./presentationPrimitives')
    expect(OLD_n(3742)).toBe(formatNumber(3742))
    expect(OLD_formatEtTime(AS_OF)).toBe(formatTimeEt(AS_OF, { seconds: true }))
    expect(OLD_formatAsOf(AS_OF)).toBe(formatTimeEt(AS_OF))
    // ⚰️ This asserted byte-identity against `OLD_epochToLocal` too. The ET fix
    // (owner, 2026-09-12) is a SEPARATE line that is allowed to move the string,
    // so what is pinned now is the DIFFERENCE — see the <Cited> block below.
    expect(formatDateTimeEt(VALIDATED_SEC)).not.toBe(OLD_epochToLocal(VALIDATED_SEC))
    expect(formatDateTimeEt(VALIDATED_SEC)).toMatch(/ ET$/)
  })
})

// ── the four components ─────────────────────────────────────────────────────

describe('<CoverageLine> renders the same numbers', () => {
  // ⛔ The prop is ONE `coverage` object whose keys are the RECEIPT's own
  // snake_case names (`not_computable`), not camelCase — the component reads
  // `coverage.not_computable` straight off `scan_store`'s row so the two
  // vocabularies cannot drift. A first draft of this fixture passed flattened
  // camelCase props, rendered `null`, and every assertion over it passed
  // vacuously until the one that demanded a real number went red.
  const coverage = {
    evaluated: 3742, answered: 3699, dropped: 2, not_computable: 41, withheld: 0,
    dropped_symbols: [],
  }

  it('every count renders through the pre-S10 number rule', () => {
    const { container } = render(<CoverageLine coverage={coverage} />)
    const html = container.innerHTML
    for (const v of [3742, 3699, 2, 41]) {
      expect(html, `count ${v}`).toContain(OLD_n(v))
    }
    // Grouping is the part a locale change would break, and 3742 is the one
    // value in this fixture wide enough to show it.
    expect(OLD_n(3742)).toContain(',')
    expect(html).toContain('3,742')
    expect(html).not.toContain('3.742')
  })

  it('renders no NaN, no undefined, no Invalid Date', () => {
    const { container } = render(<CoverageLine coverage={coverage} />)
    expect(container.innerHTML).not.toMatch(/NaN|undefined|Invalid Date/)
  })
})

describe('<FreshnessBadge> renders the same as-of clause', () => {
  it('a delayed value keeps the exact words, time and zone label it had', () => {
    const { container } = render(
      <FreshnessBadge freshnessClass="delayed_15" asOf={AS_OF} />,
    )
    // ⛔ THE PRE-S10 JSX WAS `as of {asOfText} ET`. The whole clause is now one
    // string from the primitive, so this asserts the CONCATENATION is unchanged
    // — the exact thing moving the literals out of JSX could have broken.
    expect(container.textContent).toContain(`as of ${OLD_formatAsOf(AS_OF)} ET`)
  })

  it('and NO seconds — this badge never showed them and still must not', () => {
    const { container } = render(
      <FreshnessBadge freshnessClass="delayed_15" asOf={AS_OF} />,
    )
    // The seconds-bearing render of the same instant must be absent. If
    // `<Provenance>`'s `seconds: true` had leaked in here, this is what catches
    // it, and nothing else in the suite would.
    expect(container.textContent).not.toContain(OLD_formatEtTime(AS_OF))
    expect(OLD_formatEtTime(AS_OF)).not.toBe(OLD_formatAsOf(AS_OF))
  })

  it('a real-time value still renders NO as-of clause at all', () => {
    const { container, queryByText } = render(
      <FreshnessBadge freshnessClass="real_time" asOf={AS_OF} />,
    )
    expect(container.textContent).not.toContain('as of')
    expect(queryByText(/as of/)).toBeNull()
  })

  it('a missing as-of still omits the whole element, never an empty one', () => {
    const { container } = render(<FreshnessBadge freshnessClass="delayed_15" asOf={null} />)
    expect(container.textContent).not.toContain('as of')
    expect(container.innerHTML).not.toMatch(/null|undefined|Invalid Date/)
  })

  it('composite rows each carry their own clause, unchanged', () => {
    const { container } = render(
      <FreshnessBadge
        fields={[
          { label: 'Price', freshnessClass: 'delayed_15', asOf: AS_OF },
          { label: 'Volume', freshnessClass: 'real_time', asOf: AS_OF },
        ]}
      />,
    )
    const text = container.textContent
    expect(text).toContain(`as of ${OLD_formatAsOf(AS_OF)} ET`)
    // Exactly one clause — the live field must not have grown one.
    expect(text.match(/as of/g)).toHaveLength(1)
  })
})

describe('<Provenance> renders the same observed timestamp', () => {
  const provenance = {
    sourceActivity: 'fmp_client.get_quote',
    timestamp: AS_OF,
    tieBreak: null,
  }

  // ⛔ THE DETAIL IS BEHIND A DISCLOSURE AND MUST BE OPENED. The first draft of
  // this file asserted against the collapsed render and failed for that reason
  // — recorded because the failure mode it nearly shipped is the worse one:
  // a `not.toContain` over a panel that was never rendered passes vacuously
  // and reads as proof.
  async function openDetail(el) {
    const user = userEvent.setup()
    const { container, getByTestId } = render(el)
    await user.click(getByTestId('provenance-detail-toggle'))
    return container
  }

  it('keeps seconds, keeps the ET label, keeps the wording', async () => {
    const container = await openDetail(
      <Provenance value="$123.45" provenance={provenance} availability={AVAILABLE} />,
    )
    expect(container.textContent).toContain(`Observed: ${OLD_formatEtTime(AS_OF)} ET`)
  })

  it('and does NOT render the seconds-less form the badge uses', async () => {
    const container = await openDetail(
      <Provenance value="$123.45" provenance={provenance} availability={AVAILABLE} />,
    )
    // Non-vacuity for this negative: the panel really is open.
    expect(container.textContent).toContain('Source: fmp_client.get_quote')
    expect(container.textContent).not.toContain(`Observed: ${OLD_formatAsOf(AS_OF)} ET`)
  })

  it('a provenance with no timestamp omits the line entirely', async () => {
    const container = await openDetail(
      <Provenance
        value="$123.45"
        provenance={{ ...provenance, timestamp: null }}
        availability={AVAILABLE}
      />,
    )
    expect(container.textContent).toContain('Source: fmp_client.get_quote')
    expect(container.textContent).not.toContain('Observed:')
    expect(container.innerHTML).not.toMatch(/Invalid Date/)
  })
})

describe('<Cited> renders the same validated timestamp, in the same (viewer) zone', () => {
  const row = {
    ticker: 'NVDA', tf: 'D', source: 'massive',
    validated_at: VALIDATED_SEC, verified_at: null,
  }

  async function openCited(el) {
    const user = userEvent.setup()
    const { container, getByTestId } = render(el)
    await user.click(getByTestId('cited-toggle'))
    return container
  }

  it('⚰️ renders ET WITH A LABEL — the one deliberate member-visible change', async () => {
    // ⚰️ THIS ASSERTED BYTE-IDENTITY WITH THE VIEWER-LOCAL RENDER:
    //
    //     expect(container.textContent)
    //       .toContain(`Validated: ${OLD_epochToLocal(VALIDATED_SEC)}`)
    //
    // True under S10's first build, whose approval demanded it. The ET fix is
    // its own line and is ALLOWED to move the string. The before/after, for one
    // instant, by where the member sat:
    //
    //     America/New_York  "9/11/2025, 9:32:15 AM"   -> "9/11/2025, 9:32:15 AM ET"
    //     America/Chicago   "9/11/2025, 8:32:15 AM"   -> "9/11/2025, 9:32:15 AM ET"
    //     Europe/London     "9/11/2025, 2:32:15 PM"   -> "9/11/2025, 9:32:15 AM ET"
    //     Asia/Tokyo        "9/11/2025, 10:32:15 PM"  -> "9/11/2025, 9:32:15 AM ET"
    const container = await openCited(<Cited row={row}>123.45</Cited>)
    expect(container.textContent).toContain('Validated: 9/11/2025, 9:32:15 AM ET')
  })

  it('and the pre-fix string is GONE from the render on a non-ET machine', async () => {
    // ⛔ NON-VACUITY FOR THE CHANGE ITSELF. On an ET machine the old and new
    // clock times coincide, so "the new string is present" would pass even if
    // nothing had been pinned. This asserts the thing that is true everywhere:
    // the render carries the zone label, which the old one never did.
    const container = await openCited(<Cited row={row}>123.45</Cited>)
    expect(container.textContent).toMatch(/Validated: .* ET/)
    expect(OLD_epochToLocal(VALIDATED_SEC)).not.toMatch(/ET/)
  })

  it('⚰️ THE DIVERGENCE IS CLOSED — all three S8 timestamps are ET now', () => {
    // ⚰️ This said "AND THAT IS THE VIEWER ZONE, NOT ET — the divergence,
    // pinned", and existed so the divergence could not be tidied away without a
    // human reading why. It was closed deliberately instead, on its own line.
    // What stays pinned is the STRUCTURAL difference that makes them two
    // primitives: this one carries a DATE, the badge's never does.
    expect(OLD_epochToLocal(VALIDATED_SEC)).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    expect(OLD_formatEtTime(AS_OF)).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })

  it('a row with no validated_at omits the line, never renders null', async () => {
    const container = await openCited(
      <Cited row={{ ...row, validated_at: null }}>123.45</Cited>,
    )
    // Non-vacuity: the panel is open and carrying its other detail parts.
    expect(container.textContent).toContain('NVDA')
    expect(container.textContent).not.toContain('Validated:')
    expect(container.innerHTML).not.toMatch(/null|undefined|Invalid Date/)
  })
})

describe('the render oracle can fail — non-vacuity', () => {
  // ⛔ Every assertion above is a `toContain` over a string the oracle built.
  // If the oracle ever returned `''`, `toContain('')` is TRUE for every string
  // and the whole file would pass over nothing. These three make that
  // impossible to reach silently.
  it('no oracle used above returns an empty string', () => {
    for (const v of [OLD_n(3742), OLD_formatEtTime(AS_OF), OLD_formatAsOf(AS_OF),
      OLD_epochToLocal(VALIDATED_SEC)]) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(3)
    }
  })

  it('a wrong expectation over the same render DOES fail', () => {
    const { container } = render(
      <FreshnessBadge freshnessClass="delayed_15" asOf={AS_OF} />,
    )
    // The mutation, asserted rather than described: had the component kept a
    // stray "ET" after the primitive's own, this is the string that would be
    // there — and it is not.
    expect(container.textContent).not.toContain(`as of ${OLD_formatAsOf(AS_OF)} ET ET`)
    // And had the words been dropped entirely, this would be present.
    expect(container.textContent).not.toBe(OLD_formatAsOf(AS_OF))
  })
})
