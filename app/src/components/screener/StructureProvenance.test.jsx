// StructureProvenance — the panel that makes the research reachable.
//
// ⛔ The cases here are chosen for what they can DISPROVE, not for count. The
// three that matter most: an unmeasured structure must never render as a zero;
// a lift must never appear without its direction; and a failed fetch must not
// render as an empty library, because "we have no structures" is a different
// and false claim.
//
// ⛔⛔ THE ACCESSIBILITY CASES BELOW ASSERT ON THE ACCESSIBILITY TREE, NOT ON
// THE DOM THAT HAPPENS TO PRODUCE IT. `getByRole(..., { name })` computes the
// accessible name the way a screen reader does, so a case goes red when the
// NAME breaks — an id that stops resolving, a heading that stops being a
// heading, a separator that disappears — and stays green through any markup
// change that leaves the announcement intact. A `querySelector` on a class
// would have done neither.
//
// ⚠️ AND jsdom COMPUTES NO LAYOUT AND NO CASCADE. Nothing here can measure a
// tap target, an overflow, or a contrast ratio; the three CSS cases at the end
// read the stylesheet as TEXT and say so in their names. They are static
// analysis wearing a test's clothes, which is worth having and is not worth
// mistaking for a measurement.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StructureProvenance, {
  StructureCard, formatLift, groupCriteria, libraryOrder, refusalReasons,
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
  missing_kind: 'source_silent',
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

describe('libraryOrder — the browser found this and no test could', () => {
  // Rendered in payload order the panel opened on five near-empty cards we
  // invented, with Darvas Box's +7.35pp below them. Order is not correctness,
  // so nothing here was red; the defect existed only on a screen.
  const measured = { key: 'darvas-box', origin: 'published',
                     evidence: { published: true, lift: 0.0735 } }
  const classic = { key: 'flat-base', origin: 'published',
                    evidence: { published: false, reasons: ['negative'] } }
  const ours = { key: 'advancing-structure', origin: 'uct', evidence: null }

  it('puts a MEASURED structure above a published rule above one of ours', () => {
    const out = libraryOrder([ours, classic, measured])
    expect(out.map(e => e.key)).toEqual(
      ['darvas-box', 'flat-base', 'advancing-structure'])
  })

  it('is stable inside a tier — payload order is already grouped by family', () => {
    const a = { key: 'a', origin: 'published', evidence: null }
    const b = { key: 'b', origin: 'published', evidence: null }
    expect(libraryOrder([a, b]).map(e => e.key)).toEqual(['a', 'b'])
    expect(libraryOrder([b, a]).map(e => e.key)).toEqual(['b', 'a'])
  })

  it('drops nothing and mutates nothing', () => {
    const input = [ours, classic, measured]
    const before = input.map(e => e.key)
    expect(libraryOrder(input)).toHaveLength(3)
    expect(input.map(e => e.key)).toEqual(before)
  })

  it('survives an empty library', () => {
    expect(libraryOrder([])).toEqual([])
  })
})

describe('refusalReasons', () => {
  it('returns the reasons the gates gave for a refused row', () => {
    expect(refusalReasons({ published: false, reasons: ['too few trials'] }))
      .toEqual(['too few trials'])
  })

  it('⛔ says nothing for a PUBLISHED row — those reasons are spent', () => {
    expect(refusalReasons({ published: true, reasons: ['stale'] })).toEqual([])
  })

  it('survives a row with no evidence at all', () => {
    expect(refusalReasons(null)).toEqual([])
    expect(refusalReasons({ published: false })).toEqual([])
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
    expect(screen.getByText(/Published with no number we can use/i)).toBeInTheDocument()
    expect(screen.getByText(/no minimum or maximum box length/i)).toBeInTheDocument()
    expect(screen.getByText('the source never published this')).toBeInTheDocument()
  })

  it('⛔⛔ never claims a source was SILENT when it published the rule', () => {
    // Minervini states the 2.5-3x market-depth rule outright; the value is
    // blank only because a per-symbol detector holds no index series. Telling a
    // member he said nothing is a false claim about a real author.
    render(<StructureCard entry={entry({
      criteria: [{ ...REFUSED,
        condition: 'Depth relative to the general market',
        quote: 'stocks that correct more than two and a half or three times',
        missing: 'needs the index decline over the same window',
        missing_kind: 'not_computable' }],
    })} />)
    expect(screen.getByText('published, but we cannot compute it')).toBeInTheDocument()
    expect(screen.queryByText('the source never published this')).not.toBeInTheDocument()
  })

  it('distinguishes OUR scope decision from either of the above', () => {
    render(<StructureCard entry={entry({
      criteria: [{ ...REFUSED, missing_kind: 'our_scope',
                   missing: 'the short leg needs VWAP' }],
    })} />)
    expect(screen.getByText('we have not implemented this')).toBeInTheDocument()
  })

  it('falls back to source-silent for a row with no kind at all', () => {
    render(<StructureCard entry={entry({
      criteria: [{ ...REFUSED, missing_kind: undefined }],
    })} />)
    expect(screen.getByText('the source never published this')).toBeInTheDocument()
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

// ─── ACCESSIBILITY ──────────────────────────────────────────────────────────
//
// The panel is opened inside `Sheet` from the screener toolbar. Everything
// below renders the panel on its own; the one property that belongs to the
// COMPOSITION — that the dialog has an accessible name at all — is pinned one
// layer up in `Screener.structuremount.test.jsx`, because it is `ScannerShell`
// that does or does not pass `ariaLabel`, and no amount of green here would say.

describe('the panel announces itself — heading, list, and a position in it', () => {
  const two = [entry(), entry({ key: 'flat-base', label: 'Flat Base' })]
  const openPanel = async () => {
    const view = render(<StructureProvenance fetcher={okFetch(payload(two))} />)
    await waitFor(() => expect(screen.getByText('Darvas Box')).toBeInTheDocument())
    return view
  }

  it('⛔ has a real heading of its own — Sheet renders its title as a <div>', async () => {
    await openPanel()
    expect(screen.getByRole('heading', { level: 2, name: 'Structure library' }))
      .toBeInTheDocument()
  })

  it('⛔ skips no heading level on the way down into a card', async () => {
    const { container } = await openPanel()
    const levels = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map(h => Number(h.tagName[1]))
    expect(levels.length).toBeGreaterThan(2)
    expect(levels[0]).toBe(2)
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i], `${levels[i - 1]} -> ${levels[i]} skips a level`)
        .toBeLessThanOrEqual(levels[i - 1] + 1)
    }
  })

  it('⭐ the structures are a NAMED LIST, so "28 items" is announced', async () => {
    await openPanel()
    const list = screen.getByRole('list', { name: 'Structure library' })
    // Own items only — the criteria lists inside each card are also listitems,
    // and counting those would make this pass for the wrong reason.
    const items = within(list).getAllByRole('listitem')
      .filter(li => li.closest('ul') === list)
    expect(items).toHaveLength(2)
  })

  it('each card carries its own structure as its accessible name', async () => {
    await openPanel()
    expect(screen.getByRole('article', { name: 'Darvas Box' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Flat Base' })).toBeInTheDocument()
  })

  it('⛔ the counts line is not a second BANNER over the app\'s own', async () => {
    // <header> maps to the banner landmark unless it descends from
    // article/aside/main/nav/section — and the sheet is a <div role="dialog">,
    // which is none of those. The card's <header> is inside <article> and is
    // fine; the counts line was inside nothing.
    //
    // ⛔ ASSERTED AS THE SECTIONING-ANCESTOR CONDITION, NOT VIA getByRole.
    // Measured, not assumed: testing-library maps EVERY <header> to `banner`,
    // card headers included, so `queryAllByRole('banner')` returns 2 both
    // before and after the fix and cannot tell them apart. A rail that reports
    // the same number either way is not a rail.
    const { container } = await openPanel()
    const headers = [...container.querySelectorAll('header')]
    expect(headers.length).toBeGreaterThan(0)             // control
    expect(headers.filter(h => !h.closest('article'))).toEqual([])
  })

  it('⭐ the empty first paint is a live region, not silence', () => {
    // Sheet focuses the dialog before the fetch lands. Without a live region a
    // screen-reader user is told the panel's name and then nothing at all —
    // including when the structures arrive.
    render(<StructureProvenance fetcher={vi.fn(() => new Promise(() => {}))} />)
    expect(screen.getByRole('status')).toHaveTextContent(/Loading structures/i)
  })
})

describe('the three provenance states reach assistive tech, not just the eye', () => {
  it('⛔⛔ each criteria list is NAMED by the state label that owns it', () => {
    // The label was a sibling heading: a reader entering the list directly got
    // the criteria with no statement of whose they were. This is the whole job
    // of the panel, so it is the case that must not be able to pass by accident.
    render(<StructureCard entry={entry()} />)
    // ⚠️ The refused section's label changed from "The source did not publish
    // this" — for several criteria that sentence was FALSE (Minervini states
    // the market-depth rule outright and it renders in that section). What this
    // case tests is the BINDING of label to list, which is unaffected.
    for (const label of ['Published by the source', 'Our number, not theirs',
                         'Published with no number we can use']) {
      expect(screen.getByRole('list', { name: new RegExp(`^${label}`) }))
        .toBeInTheDocument()
    }
  })

  it('keeps a separator before the count, so the name is not "...source1"', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByRole('heading', { level: 4, name: 'Published by the source 1' }))
      .toBeInTheDocument()
  })

  it('⭐ puts the state on the item as a VALUE, not only as a hashed class', () => {
    const { container } = render(<StructureCard entry={entry()} />)
    expect([...container.querySelectorAll('[data-state]')]
      .map(el => el.getAttribute('data-state')))
      .toEqual(['sourced', 'ours', 'refused'])
  })

  it('⛔ "not published" does not run into the sentence it tags', () => {
    // The pill's margin is a VISUAL gap; the accessibility tree concatenates
    // adjacent inline text, so this read as "not publishedDarvas publishes...".
    // The tag's WORDS now depend on `missing_kind` (a source that published
    // nothing reads differently from one we cannot compute); the separator this
    // case exists for is the same either way.
    const { container } = render(<StructureCard entry={entry()} />)
    expect(container.querySelector('[data-state="refused"]').textContent)
      .toMatch(/the source never published this\s+Darvas publishes/)
  })
})

describe('the lift cannot be read without its direction', () => {
  it('spells the unit out and carries the direction in ONE string', () => {
    expect(formatLift({ published: true, lift: 0.3121, ci_low: 0.2914,
                        ci_high: 0.3361, n: 2077, direction: 'short' }).spoken)
      .toBe('+31.21 percentage points, resolving downward')
    expect(formatLift({ published: true, lift: 0.0735, ci_low: 0.0678,
                        ci_high: 0.0796, n: 24428, direction: 'long' }).spoken)
      .toBe('+7.35 percentage points, resolving upward')
  })

  it('⛔⛔ the number and its direction are ONE node, not two adjacent ones', () => {
    render(<StructureCard entry={entry({
      key: 'parabolic-extension', label: 'Parabolic Extension', bias: 'bearish',
      evidence: { published: true, lift: 0.3121, ci_low: 0.2914,
                  ci_high: 0.3361, n: 2077, direction: 'short' },
    })} />)
    const shown = screen.getByText('+31.21pp')
    expect(shown).toHaveAttribute('aria-hidden', 'true')
    expect(shown.closest('strong'))
      .toHaveTextContent(/\+31\.21 percentage points, resolving downward/)
  })

  it('does not announce the direction twice', () => {
    render(<StructureCard entry={entry()} />)
    expect(screen.getByText('resolves upward')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('the bias pill', () => {
  it('is labelled, so "neutral" is not a word floating beside a heading', () => {
    const { container } = render(<StructureCard entry={entry()} />)
    expect(container.querySelector('header').textContent).toMatch(/Bias:\s*neutral/)
    // and the pill's own text is still exactly the bias — the shape every
    // other reader of this element depends on.
    expect(screen.getByText('neutral')).toBeInTheDocument()
  })
})

// ─── THE STYLESHEET, READ AS TEXT ───────────────────────────────────────────
//
// ⚠️ STATIC ANALYSIS, NOT MEASUREMENT. jsdom applies no cascade and computes no
// layout, so none of the cases below has seen a pixel. They assert that the
// declaration a browser would need is PRESENT — which is the most a suite can
// honestly say about overflow, tap targets and colour from here.
describe('the stylesheet (static analysis — jsdom measures none of this)', () => {
  // Resolved RELATIVE TO THIS FILE, not to a cwd: the suite is invoked from
  // `app/` today and from the repo root by other runners, and a path that
  // silently resolves nowhere would make these cases pass by not running.
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const CSS = read('./StructureProvenance.module.css')
  const TOKENS = read('../../styles/tokens.css')
  /** The body of the first rule whose selector list contains `sel`. */
  const rule = (sel) => {
    const m = CSS.match(
      new RegExp(`(^|[},])\\s*${sel.replace(/[.[\]='*]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))
    return m ? m[2] : null
  }

  it('⛔⛔ every custom property it paints with is DEFINED in tokens.css', () => {
    // FOUR were not: --color-text-muted, --color-surface, --color-surface-2 and
    // --color-border are declared nowhere in the app. A var() WITH a fallback is
    // still a valid declaration, so the panel rendered from its fallbacks and
    // nothing errored — while --color-text, the one name that IS defined,
    // followed the theme. On the light theme that painted near-black ink on a
    // hardcoded #16181c card at 1.13:1. The repo's own tokens.reachable rail
    // cannot see this class: it only inspects var() calls with NO fallback.
    const declared = new Set(
      [...TOKENS.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(m => m[1]))
    const used = [...new Set(
      [...CSS.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)].map(m => m[1]))]
    expect(used.length).toBeGreaterThan(4)          // control: it found some
    expect(used.filter(n => !declared.has(n))).toEqual([])
  })

  it('⛔ the three states differ in border STYLE, not only in hue', () => {
    // The file header claims the states are told apart "by a LEFT BORDER and a
    // label, never by colour alone". Every state carried the same `3px solid`
    // and differed only in colour, so the border WAS colour alone.
    const shapes = ['sourced', 'ours', 'refused'].map((s) => {
      const body = rule(`.criterion.${s}`)
      expect(body, `.criterion.${s} must exist`).toBeTruthy()
      const m = body.match(/border-left-style:\s*([a-z]+)/)
      expect(m, `.criterion.${s} must set a border-left-style`).toBeTruthy()
      return m[1]
    })
    expect(new Set(shapes).size).toBe(3)
  })

  it('gives the panel\'s only control the 44px tap minimum on touch', () => {
    // <summary> at 12px on one line is ~19px tall, and this panel is a BOTTOM
    // SHEET at every touch width. Scoped to the canonical TOUCH breakpoint.
    const touch = CSS.match(/@media \(max-width: 1024px\)\s*\{([\s\S]*?)\n\}/)
    expect(touch, 'a touch-width block must exist').toBeTruthy()
    expect(touch[1]).toMatch(/\.noteSummary[\s\S]*min-height:\s*var\(--tap-min\)/)
  })

  it('lets unbreakable source prose wrap instead of widening the card', () => {
    // Verbatim quotes and refusal sentences arrive from the payload. overflow-wrap
    // inherits, so one declaration on .wrap reaches every descendant.
    expect(rule('.wrap')).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
