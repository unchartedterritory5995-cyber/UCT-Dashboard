// The WIRE rail. rankOrder.test.js proves the comparator; this proves WeekView
// actually USES it — a correct helper imported by nobody is the defect this
// repo keeps re-learning. Renders the real WeekView with the pre-enrichment
// state (weekTiers undefined, every row mine, entries handed over in the
// provider's alphabetical order) and reads the ticker order back out of the DOM.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeekView from './WeekView'
import { DEFAULT_FILTERS } from './filterLogic'

// CompanyLogo reaches for network/img plumbing that is irrelevant here.
vi.mock('../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid="logo">{sym}</span>,
}))
vi.mock('../../components/ui/UIcon', () => ({ default: () => null }))

const E = (sym, over = {}) => ({
  sym, ew: 0, mc_b: null, _avg_vol: null, _price: null,
  eps_est: null, eps_act: null, expected_move: null,
  mine: true, _sources: [], ...over,
})

const DS = '2026-08-10'

function renderWeek(bmo, { weekTiers, filters } = {}) {
  render(
    <WeekView
      weekDates={[DS]}
      days={{ [DS]: { label: 'MON AUG 10', bmo, amc: [], tbd: [], econ: [], fed: [] } }}
      filters={{ ...DEFAULT_FILTERS, ...(filters || {}) }}
      eventTypes={new Set()}
      onSelect={() => {}}
      weekTiers={weekTiers}
    />,
  )
  // The ticker label under each tile, in DOM order. DIRECT children only —
  // the logo wrapper nests its own spans, which a descendant query picks up first.
  return screen.getAllByRole('button').map(b => {
    const spans = [...b.children].filter(el => el.tagName === 'SPAN')
    return spans[1]?.textContent
  }).filter(Boolean)
}

describe('WeekView ordering wire', () => {
  it('paints ranked, NOT alphabetical, before any enrichment has landed', () => {
    // Exactly the reported state: no weekTiers at all, every row mine, and the
    // list arriving alphabetically the way /api/calendar serializes it.
    const order = renderWeek([
      E('AAON', { mc_b: 8 }),
      E('AIRS', { mc_b: 0.5 }),
      E('COGT', { mc_b: 1.2 }),
      E('FERG', { mc_b: 40 }),
    ], { weekTiers: undefined })

    expect(order).toEqual(['FERG', 'AAON', 'COGT', 'AIRS'])
    // The regression itself, stated plainly.
    expect(order).not.toEqual(['AAON', 'AIRS', 'COGT', 'FERG'])
  })

  it('upgrades to the importance ranking once tiers arrive', () => {
    const weekTiers = {
      [DS]: { impBySym: new Map([['AIRS', 4.0], ['FERG', 0.2], ['AAON', 0.1], ['COGT', 0.0]]) },
    }
    const order = renderWeek([
      E('AAON', { mc_b: 8 }),
      E('AIRS', { mc_b: 0.5 }),
      E('COGT', { mc_b: 1.2 }),
      E('FERG', { mc_b: 40 }),
    ], { weekTiers })

    expect(order[0]).toBe('AIRS')   // imp beats the $40B name
    expect(order[1]).toBe('FERG')
  })

  it('honors an explicit Market cap sort instead of overriding it with imp', () => {
    // Week used to re-sort by imp on top of the user's choice, which demoted
    // "Market cap" to a tiebreak. The Feed always honored it; now both do.
    const weekTiers = { [DS]: { impBySym: new Map([['SMALL', 9.0], ['HUGE', 0.0]]) } }
    const order = renderWeek([
      E('HUGE',  { mc_b: 400 }),
      E('SMALL', { mc_b: 1 }),
    ], { weekTiers, filters: { sort: 'mcap' } })

    expect(order).toEqual(['HUGE', 'SMALL'])
  })
})
