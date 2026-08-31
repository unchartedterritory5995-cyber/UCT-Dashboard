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
  evidence: {
    lift_pp: 7.35, ci_pp: [6.78, 7.96], n: 24428,
    direction: 'long', resolves: 'upward',
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
    const short = formatLift({ lift_pp: 31.21, ci_pp: [29.14, 33.61], n: 2077,
                               direction: 'short' })
    expect(short.resolves).toBe('downward')
    const long = formatLift({ lift_pp: 7.35, ci_pp: [6.78, 7.96], n: 24428,
                              direction: 'long' })
    expect(long.resolves).toBe('upward')
  })

  it('signs both ends of the interval so a negative bound is unmistakable', () => {
    const f = formatLift({ lift_pp: 3.3, ci_pp: [-1.45, 15.06], n: 153,
                           direction: 'long' })
    expect(f.interval).toBe('-1.45 to +15.06')
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
      evidence: { lift_pp: 31.21, ci_pp: [29.14, 33.61], n: 2077,
                  direction: 'short', resolves: 'downward' },
    })} />)
    expect(screen.getByText('resolves downward')).toBeInTheDocument()
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
