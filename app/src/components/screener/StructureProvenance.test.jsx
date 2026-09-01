// StructureProvenance — the panel that makes the research reachable.
//
// ⛔ The cases here are chosen for what they can DISPROVE, not for count. The
// three that matter most: an unmeasured structure must never render as a zero;
// a lift must never appear without its direction; and a failed fetch must not
// render as an empty library, because "we have no structures" is a different
// and false claim.
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StructureProvenance, {
  StructureCard, formatLift, groupCriteria,
} from './StructureProvenance'

const SOURCED = {
  condition: 'Sessions with no touch of the prior high',
  value: 3,
  state: 'sourced',
  quote: 'does not touch or penetrate',
  source_id: 'darvas_1960',
  confidence: 'high',
  missing: null,
}
const REFUSED = {
  condition: 'Box duration',
  value: null,
  state: 'refused',
  quote: 'I did not care how long it stayed in its box',
  source_id: 'darvas_1960',
  confidence: 'high',
  missing: 'Darvas publishes no minimum or maximum box length, so any dwell bound is ours.',
}
const OURS = {
  condition: 'Frame must be LIVE',
  value: 20,
  state: 'ours',
  quote: null,
  source_id: null,
  confidence: 'high',
  missing: null,
}

const entry = (over = {}) => ({
  key: 'darvas-box',
  label: 'Darvas Box',
  desc: 'Price framed between a ceiling and a floor.',
  axis: 'relation',
  family: 'Base Structure',
  bias: 'neutral',
  coverage_pct: 4.8,
  criteria: [SOURCED, REFUSED, OURS],
  // The SHAPE `lift_ledger.for_structure()` actually returns -- copied from a
  // real darvas-box row, not imagined. The previous fixture used `lift_pp` and
  // `ci_pp`, which do not exist, and that is precisely why 26 green tests
  // stood over a panel that rendered "No measured edge published" for every
  // structure in the library.
  evidence: {
    published: true, lift: 0.0735, ci_low: 0.0678, ci_high: 0.0796,
    n: 24428, null_max: 0.011, null_trials: 30, direction: 'long',
    note: 'The moving-block null was built to strip the volatility premium.',
  },
  ...over,
})

const payload = (entries) => ({
  structures: Object.fromEntries(entries.map(e => [e.key, e])),
  counts: { structures: entries.length, sourced: 1, refused: 1, ours: 1 },
})

const okFetch = (body) => vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))

describe('formatLift — a number that cannot be read is worse than none', () => {
  it('returns null when nothing was measured, so the caller cannot print 0', () => {
    expect(formatLift(null)).toBeNull()
    expect(formatLift({})).toBeNull()
    expect(formatLift({ lift_pp: null })).toBeNull()
  })

  it('carries the DIRECTION, because +31.21pp short is not an upside edge', () => {
    const short = formatLift({ published: true, lift: 0.3121, ci_low: 0.2914,
                               ci_high: 0.3361, n: 2077, direction: 'short' })
    expect(short.resolves).toBe('downward')
    expect(short.headline).toBe('+31.21pp')
    const long = formatLift({ published: true, lift: 0.0735, ci_low: 0.0678,
                              ci_high: 0.0796, n: 24428, direction: 'long' })
    expect(long.resolves).toBe('upward')
  })

  it('⛔ converts FRACTIONS to percentage points — the ledger stores 0.0735', () => {
    const f = formatLift({ published: true, lift: 0.0735, ci_low: 0.0678,
                           ci_high: 0.0796, n: 1, direction: 'long' })
    expect(f.headline).toBe('+7.35pp')
    expect(f.headline).not.toBe('+0.07pp')
  })

  it('signs both ends of the interval so a negative bound is unmistakable', () => {
    const f = formatLift({ published: true, lift: 0.033, ci_low: -0.0145,
                           ci_high: 0.1506, n: 153, direction: 'long' })
    expect(f.interval).toBe('-1.45 to +15.06')
  })

  it('⛔⛔ REFUSES to headline a row the gates did not publish', () => {
    // A row can carry a lift and still have failed a gate. Rendering it would
    // publish exactly what the ledger refused.
    expect(formatLift({ published: false, lift: 0.033, ci_low: 0.0278,
                        ci_high: 0.0379, n: 34220, direction: 'short' })).toBeNull()
  })

  it('surfaces the null MAXIMUM, which is the gate that decides most rows', () => {
    const f = formatLift({ published: true, lift: 0.0735, ci_low: 0.0678,
                           ci_high: 0.0796, n: 1, null_max: 0.011,
                           null_trials: 30, direction: 'long' })
    expect(f.nullMax).toBe('+1.10pp')
    expect(f.trials).toBe(30)
  })
})

describe('groupCriteria — the three states survive the render boundary', () => {
  it('separates all three and drops nothing', () => {
    const g = groupCriteria([SOURCED, REFUSED, OURS])
    expect(g.sourced).toHaveLength(1)
    expect(g.refused).toHaveLength(1)
    expect(g.ours).toHaveLength(1)
  })

  it('ignores an unknown state rather than mislabelling it', () => {
    const g = groupCriteria([{ ...SOURCED, state: 'invented' }])
    expect(g.sourced.concat(g.refused, g.ours)).toHaveLength(0)
  })

  it('survives a structure with no criteria at all', () => {
    expect(groupCriteria(undefined).sourced).toEqual([])
  })
})

describe('StructureCard', () => {
  it('shows the measured lift WITH its direction', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByText('+7.35pp')).toBeInTheDocument()
    expect(screen.getByText('resolves upward')).toBeInTheDocument()
    expect(screen.getByText('n=24,428')).toBeInTheDocument()
  })

  it('says DOWNWARD for a short-graded structure', () => {
    render(<StructureCard entry={entry({
      key: 'parabolic-extension', label: 'Parabolic Extension', bias: 'bearish',
      evidence: { published: true, lift: 0.3121, ci_low: 0.2914,
                  ci_high: 0.3361, n: 2077, direction: 'short' },
    })} />)
    expect(screen.getByText('resolves downward')).toBeInTheDocument()
    expect(screen.getByText('+31.21pp')).toBeInTheDocument()
  })

  it('⭐ a MEASURED but unpublished row says so, and gives the reason', () => {
    render(<StructureCard entry={entry({
      evidence: {
        published: false, lift: 0.033, ci_low: 0.0278, ci_high: 0.0379,
        n: 34220, direction: 'short', null_trials: 5,
        reasons: ['graded against only 5 null trials; a published row requires 30'],
      },
    })} />)
    expect(screen.getByText('measured, not published')).toBeInTheDocument()
    expect(screen.getByText(/only 5 null trials/)).toBeInTheDocument()
    // and it must NOT render the refused number as an edge
    expect(screen.queryByText('+3.30pp')).not.toBeInTheDocument()
  })

  it('⭐ carries the ledger NOTE — a number without its caveat is the defect', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByText(/How this number was arrived at/i)).toBeInTheDocument()
    expect(screen.getByText(/moving-block null/i)).toBeInTheDocument()
  })

  it('⛔ renders an unmeasured structure in WORDS, never as +0.00pp', () => {
    render(<StructureCard entry={entry({ evidence: null })} />)
    expect(screen.getByText(/No measured edge published/i)).toBeInTheDocument()
    expect(screen.queryByText(/0\.00pp/)).not.toBeInTheDocument()
  })

  it('⭐ gives the refusal its own section with what was NOT published', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByText(/The source did not publish this/i)).toBeInTheDocument()
    expect(screen.getByText(/no minimum or maximum box length/i)).toBeInTheDocument()
    expect(screen.getByText('not published')).toBeInTheDocument()
  })

  it('prints the verbatim quote for a sourced criterion', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByText(/does not touch or penetrate/)).toBeInTheDocument()
  })

  it('marks our own number as ours and gives it no quote', () => {
    const { container } = render(<StructureCard entry={entry()} />)
    const ours = container.querySelector('[class*="ours"]')
    expect(ours).toBeTruthy()
    expect(within(ours).queryByText(/“/)).not.toBeInTheDocument()
  })

  it('distinguishes the states by CLASS, not by colour alone', () => {
    const { container } = render(<StructureCard entry={entry()} />)
    for (const state of ['sourced', 'refused', 'ours']) {
      expect(container.querySelector(`[class*="${state}"]`)).toBeTruthy()
    }
  })

  it('renders a range value readably rather than as an array', () => {
    render(<StructureCard entry={entry({
      criteria: [{ ...SOURCED, condition: 'Base depth', value: [0.12, 0.33] }],
    })} />)
    expect(screen.getByText('0.12 – 0.33')).toBeInTheDocument()
  })

  it('carries the bias and the coverage figure', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByText('neutral')).toBeInTheDocument()
    expect(screen.getByText(/4\.8% of the universe/)).toBeInTheDocument()
  })
})

describe('the UCT-original badge — ours vs a published classic', () => {
  it('says so, in words, when nothing in the structure traces to a house', () => {
    render(<StructureCard entry={entry({ origin: 'uct' })} />)
    expect(screen.getByText(/UCT original/i)).toBeInTheDocument()
    expect(screen.getByText(/not a published pattern/i)).toBeInTheDocument()
  })

  it('⛔ stays SILENT on a published classic that merely contains our numbers', () => {
    // Darvas Box carries `origin="uct"` criteria and is still Darvas' pattern.
    // A badge that fired on the per-criterion tag would mislabel every classic
    // in the library.
    render(<StructureCard entry={entry({ origin: 'published' })} />)
    expect(screen.queryByText(/UCT original/i)).not.toBeInTheDocument()
  })

  it('and is absent, not broken, when the route sends no origin at all', () => {
    render(<StructureCard entry={entry({ origin: undefined })} />)
    expect(screen.queryByText(/UCT original/i)).not.toBeInTheDocument()
    expect(screen.getByText('Darvas Box')).toBeInTheDocument()
  })
})

describe('StructureProvenance', () => {
  it('renders every structure the route returns', async () => {
    const two = [entry(), entry({ key: 'flat-base', label: 'Flat Base' })]
    render(<StructureProvenance fetcher={okFetch(payload(two))} />)
    await waitFor(() => expect(screen.getByText('Darvas Box')).toBeInTheDocument())
    expect(screen.getByText('Flat Base')).toBeInTheDocument()
  })

  it('summarises the three states from the route counts', async () => {
    render(<StructureProvenance fetcher={okFetch(payload([entry()]))} />)
    await waitFor(() =>
      expect(screen.getByText(/the sources never published/i)).toBeInTheDocument())
  })

  it('summarises how many of the structures are OURS, when any are', async () => {
    const body = payload([entry()])
    body.counts.uct_originals = 5
    render(<StructureProvenance fetcher={okFetch(body)} />)
    await waitFor(() =>
      expect(screen.getByText(/are ours, not classics/i)).toBeInTheDocument())
  })

  it('and says nothing about it when none are — no "0 of the structures"', async () => {
    const body = payload([entry()])
    body.counts.uct_originals = 0
    render(<StructureProvenance fetcher={okFetch(body)} />)
    await waitFor(() => expect(screen.getByText('Darvas Box')).toBeInTheDocument())
    expect(screen.queryByText(/are ours, not classics/i)).not.toBeInTheDocument()
  })

  it('⛔ reports a failed fetch instead of rendering an EMPTY library', async () => {
    const bad = vi.fn(() => Promise.resolve({ ok: false, status: 503 }))
    render(<StructureProvenance fetcher={bad} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/503/)
  })

  it('reports a rejected fetch too, rather than spinning forever', async () => {
    const bad = vi.fn(() => Promise.reject(new Error('offline')))
    render(<StructureProvenance fetcher={bad} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('shows a loading state before the first response', () => {
    render(<StructureProvenance fetcher={vi.fn(() => new Promise(() => {}))} />)
    expect(screen.getByText(/Loading structures/i)).toBeInTheDocument()
  })

  it('requests the provenance route and nothing else', async () => {
    const f = okFetch(payload([entry()]))
    render(<StructureProvenance fetcher={f} />)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(f).toHaveBeenCalledWith('/api/screener/structures')
  })
})
