/* The band on screen — the half of this feature the payload could not supply.
 *
 * 🔴 WHY THESE ARE WORTH WRITING. The bands shipped into `/api/screener/meta`
 * one commit before this file existed and no surface read either the band or
 * its basis, so a member opening /screener saw the identical blank box the
 * benchmark scored us last for. Every test below asserts something a member can
 * SEE, and the mount test is deliberately over FilterRail (the real wiring),
 * not over FilterBand alone — a component test is structurally blind to a
 * severed wire, which is exactly how the payload got shipped to nobody.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import FilterBand from './FilterBand'
import FilterRail from './FilterRail'

const BASIS = {
  label: 'Typical range',
  note: 'Measured across our own snapshot — the 5th, 25th, 50th, 75th and 95th '
    + 'percentile of the symbols that carry a value for this field. It describes '
    + 'what the data looks like. It is not a threshold this firm recommends.',
  percentiles: [5, 25, 50, 75, 95],
  min_non_null: 100,
  coverage_floor: 0.5,
  universe: 3714,
  snapshot_date: '2026-08-23',
  descriptive_only: true,
}

// The real payload for `price` off this box's 3,714-row snapshot.
const PRICE = {
  non_null: 3714, usable: 3714, universe: 3714,
  p5: 3.85, p25: 12.39, p50: 32.75, p75: 81.93, p95: 317.03,
}

describe('FilterBand — the measurement reaches the screen', () => {
  it('prints every percentile the server published, with its coverage', () => {
    render(<FilterBand band={PRICE} basis={BASIS} unit="$" />)

    expect(screen.getByText('Typical range')).toBeInTheDocument()
    // ⚠️ The unit rides ONCE, in the heading — repeating "$" in all five cells
    // was measured overflowing the 48px column on 3-glyph units.
    expect(screen.getByText('$')).toBeInTheDocument()
    for (const [label, value] of [['5%', '3.85'], ['25%', '12.39'],
      ['50%', '32.75'], ['75%', '81.93'], ['95%', '317.0']]) {
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(value)).toBeInTheDocument()
    }
    expect(screen.getByText('3,714 of 3,714')).toBeInTheDocument()
  })

  it('keeps the exact measured value reachable when the display rounds it', () => {
    // ⭐ Nearest-rank means every one of these is a value some symbol actually
    // holds. Rounding 317.03 to "317.0" for a 264px rail is a display choice
    // about a real number — losing the real number would not be.
    render(<FilterBand band={PRICE} basis={BASIS} unit="$" />)
    expect(screen.getByText('317.0')).toHaveAttribute('title', '317.03')
  })

  it('reads the percentile set off the BASIS, not a hardcoded five', () => {
    const basis = { ...BASIS, percentiles: [10, 90] }
    const band = { non_null: 400, usable: 400, universe: 400, p10: 1, p90: 9 }
    render(<FilterBand band={band} basis={basis} unit={null} />)
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.queryByText('50%')).toBeNull()
  })

  it('shows NOTHING when the basis is missing — five unlabelled numbers are worse than a blank', () => {
    const { container } = render(<FilterBand band={PRICE} basis={null} unit="$" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders no band for a control the server sent none for', () => {
    const { container } = render(<FilterBand band={undefined} basis={BASIS} unit={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('FilterBand — every refusal is answered IN WORDS', () => {
  // ⛔ These reason strings are `distribution.py`'s constants. The Python rail
  // `test_every_refusal_reason_is_answered_in_words_by_the_filter_rail` is what
  // stops a NEW one from shipping a blank; these assert the wording carries the
  // numbers and the published floor, so a member reads the rule, not a verdict.
  const cases = [
    ['no_data', { non_null: 0, usable: 0, universe: 3714 }, /nothing in tonight/i],
    ['not_numeric', { non_null: 3714, usable: 0, universe: 3714 }, /3,714 values here are non-numeric/i],
    ['binary', { non_null: 3714, usable: 3714, universe: 3714 }, /yes\/no flag/i],
    ['too_few_levels', { non_null: 2889, usable: 2889, universe: 3714 }, /category, not a scale/i],
    ['no_spread', { non_null: 2889, usable: 2889, universe: 3714, saturated_at: 100 }, /almost every symbol reads 100/i],
    ['below_min_non_null', { non_null: 24, usable: 24, universe: 3714 }, /only 24 of 3,714 .* under the 100/i],
    ['below_coverage_floor', { non_null: 482, usable: 482, universe: 3714 }, /only 482 of 3,714 symbols \(13%\).* under the 50%/i],
    ['column_absent', { non_null: 0, usable: 0, universe: 3714 }, /does not hold this column yet/i],
  ]

  for (const [reason, rest, expected] of cases) {
    it(`says why in plain words: ${reason}`, () => {
      render(<FilterBand band={{ ...rest, refused: reason }} basis={BASIS} unit={null} />)
      expect(screen.getByText(expected)).toBeInTheDocument()
    })
  }

  it('a reason this build has never heard of still prints itself, never a blank', () => {
    render(<FilterBand band={{ non_null: 1, usable: 1, universe: 2, refused: 'some_new_floor' }}
      basis={BASIS} unit={null} />)
    expect(screen.getByText(/some_new_floor/)).toBeInTheDocument()
  })
})

describe('FilterRail — the wire, not the component', () => {
  const META = {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [
      { key: 'price', label: 'Price', category: 'descriptive', type: 'range',
        allow_custom: true, unit: '$', presets: [{ label: 'Any' }],
        distribution: PRICE },
      { key: 'sector', label: 'Sector', category: 'descriptive', type: 'enum',
        unit: null, presets: [{ label: 'Any' }] },
    ],
    distribution_basis: BASIS,
  }

  it('mounts the band under the real control, off the real meta payload', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    const row = screen.getByLabelText('Price').closest('div')
    expect(within(row).getByText('32.75')).toBeInTheDocument()
  })

  it("renders the server's own disclaimer verbatim, exactly once", () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    const hits = screen.getAllByText(BASIS.note)
    expect(hits).toHaveLength(1)
    // ⛔ The half that matters: the caption must still say it recommends nothing.
    expect(hits[0]).toHaveTextContent('not a threshold this firm recommends')
  })

  // ⛔ NEAR IS NOT ASSOCIATED. DOM order serves a browse-mode reader; a member
  // moving select-to-select through the rail is in FORMS mode, where only the
  // control's name, value and DESCRIPTION are spoken — so an unassociated band
  // is silent at the one moment it exists for, while a threshold is chosen.
  const describedText = el => {
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    return ids.map(id => document.querySelectorAll(`#${CSS.escape(id)}`))
      .map(nodes => {
        // A describedby pointing at nothing — or at two things — resolves to
        // silence or to the wrong copy, and both look exactly like success.
        expect(nodes).toHaveLength(1)
        return nodes[0].textContent
      }).join(' ')
  }

  it('the select is DESCRIBED BY its measured band, not merely followed by it', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    const text = describedText(screen.getByLabelText('Price'))
    expect(text).toContain('Typical range')
    expect(text).toContain('32.75')          // the p50 a member is about to type against
    expect(text).toContain('3,714 of 3,714') // and the coverage that produced it
  })

  it('a REFUSAL is what the select points at when there is no range', () => {
    // The refusal sentence is the fact a member most needs before setting a
    // threshold on that column — "we hold nothing here" is not a blank.
    const refused = {
      ...META,
      filters: META.filters.map(f => f.key === 'price'
        ? { ...f, distribution: { non_null: 0, usable: 0, universe: 3714, refused: 'no_data' } }
        : f),
    }
    render(<FilterRail meta={refused} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(describedText(screen.getByLabelText('Price'))).toMatch(/nothing in tonight/i)
  })

  it('a control with no band names no description — same probe, both populations', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    // CONTROL first: absence is only evidence if the probe can see a presence.
    expect(screen.getByLabelText('Price')).toHaveAttribute('aria-describedby')
    expect(screen.getByLabelText('Sector')).not.toHaveAttribute('aria-describedby')
  })

  it('two rails on the page keep two separate associations', () => {
    // ⭐ THE REASON THE ID IS `useId`-SCOPED. Below 1024px `.railSlot` is
    // `display:none` but still IN THE DOM while FiltersSheet re-hosts the whole
    // rail, so a `fb_${key}` id would exist twice and the association would
    // resolve to whichever came first — quite possibly the hidden copy.
    render(<>
      <FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />
      <FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}}
        variant="sheet" />
    </>)
    const selects = screen.getAllByLabelText('Price')
    expect(selects).toHaveLength(2)
    const ids = selects.map(s => s.getAttribute('aria-describedby'))
    expect(new Set(ids).size).toBe(2)
    // `describedText` itself asserts each id resolves to exactly one element.
    for (const s of selects) expect(describedText(s)).toContain('32.75')
  })

  it('shows no disclaimer and no band when the snapshot could not be read', () => {
    // `meta()` ships `distribution_basis: null` exactly when `distributions()`
    // failed — and then no filter carries a `distribution` either.
    const blind = {
      ...META,
      filters: META.filters.map(f => { const g = { ...f }; delete g.distribution; return g }),
      distribution_basis: null,
    }
    render(<FilterRail meta={blind} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.getByLabelText('Price')).toBeInTheDocument()
    expect(screen.queryByText(/typical range/i)).toBeNull()
    expect(screen.queryByText(BASIS.note)).toBeNull()
  })
})
