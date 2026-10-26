// The waves 8-10 ship-walk fix round, the copy defects. Asserted by RENDERED TEXT.
//   * W10.3: a Notes widget said "Show how many trades each figure is from". Every source now gets its own noun, read
//     from the unit the catalog SERVES for it (the one noun table, builtModel.countNoun), never a builder guess.
//   * W10.4: "Updated version available" showed the same sentence for revision 1 and revision 2 of Equity curve. It now
//     says what actually changes (planChanges), and plainly when nothing visible does. The revisions are the server's
//     own shelf files, read from disk, never retyped here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS } from './WidgetBuilderSheet'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer } from './__fixtures__/builderFixtures'
import { W10_CATALOG } from './__fixtures__/w10Catalog'
import { countNoun, unitWord, KNOWN_UNITS } from '../widgets/builtViews/builtModel'
import { normalizeParams } from '../../../../../widgets/registry'
import HowMadeSheet, { UPDATED_VERSION } from '../widgets/builtViews/HowMadeSheet'
import { planChanges, NOTHING_VISIBLE, NO_COPY, TITLE_AUTO_AGAIN } from '../widgets/builtViews/planChanges'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('W10.3: the coverage switch counts in the source\'s own served noun', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    __resetBuiltCaches()
    window.localStorage.clear()
    installFetch([['GET', (u) => u.endsWith('/vocabulary'), () => answer(W10_CATALOG)]])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('each source tile, picked, says its own noun (notes say notes, strategies say strategies)', async () => {
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
    await flush()
    await flush(PREVIEW_DEBOUNCE_MS)
    const seen = new Map()
    for (const src of W10_CATALOG.sources) {
      fireEvent.click(screen.getByRole('radio', { name: src.label }))
      await flush(PREVIEW_DEBOUNCE_MS)
      const want = `Show how many ${countNoun(src.unit, 2)} each figure is from`
      expect(screen.getByLabelText(want), src.key).toBeInTheDocument()
      seen.set(src.key, want)
    }
    expect(seen.get('notes')).toBe('Show how many notes each figure is from')
    expect(seen.get('options_strategies')).toBe('Show how many strategies each figure is from')
    expect(seen.get('tracker_history')).toBe('Show how many entries each figure is from')
    expect(seen.get('closed_trades')).toBe('Show how many trades each figure is from')      // control
    expect(screen.queryByLabelText('Show how many trades each figure is from')).toBeNull()   // the last tile is Notes
  })

  it('the hidden-value line uses the same noun ("Not enough notes yet"), a decisive trade still says trades', () => {
    expect(unitWord('notes')).toBe('notes')
    expect(unitWord('strategies')).toBe('strategies')
    expect(unitWord('entries')).toBe('entries')
    expect(unitWord('decisive')).toBe('trades')
    expect(unitWord(undefined)).toBe('trades')
  })
})

// ── W10.4 ─────────────────────────────────────────────────────────────────────────────────────────────

const SHELF = join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine', 'shelf')
const rev = (slug, n) => JSON.parse(readFileSync(join(SHELF, `${slug}.r${n}.json`), 'utf8'))

describe('W10.4: "Updated version available" says what changes', () => {
  afterEach(() => cleanup())

  it('Equity curve r1 -> r2: the same sentence is not shown twice; the running total is named', () => {
    const r1 = rev('equity-curve', 1)
    const r2 = rev('equity-curve', 2)
    const summary = 'Net P&L, split by day, for closed trades over the last 90 days, all accounts.'
    render(<HowMadeSheet open onClose={() => {}} summary={summary} onEdit={() => {}} placedPlan={r1.plan}
      latest={{ rev: 2, summary, plan: r2.plan }} onApply={async () => ({ ok: true })} />)
    const update = screen.getByRole('region', { name: UPDATED_VERSION })
    expect(within(update).queryByText(summary)).toBeNull()                 // never the identical pair
    expect(within(update).getByText('Shows a running total, with each drawdown shaded.')).toBeInTheDocument()
    expect(within(update).getByText('What changes')).toBeInTheDocument()
    expect(within(update).getByRole('button', { name: 'Use the updated version' })).toBeInTheDocument()
  })

  it('every wave 10 revision the shelf ships names at least one change against its revision 1', () => {
    for (const slug of ['equity-curve', 'r-equity-curve', 'loss-streak', 'exit-quality', 'fees-drag', 'pnl-by-hold-time']) {
      const lines = planChanges(rev(slug, 1).plan, rev(slug, 2).plan)
      expect(lines.length, slug).toBeGreaterThan(0)
    }
    expect(planChanges(rev('loss-streak', 1).plan, rev('loss-streak', 2).plan))
      .toContain('Says when a losing streak reaches your stop rule of 3 in a row.')
    const exit = planChanges(rev('exit-quality', 1).plan, rev('exit-quality', 2).plan)
    expect(exit[0]).toBe('Shown as a number, not a table.')
    expect(exit).toContain('Adds its own field “Exit efficiency %”.')
    // the plan's format version alone is no member-visible change
    const r1 = rev('equity-curve', 1).plan
    expect(planChanges(r1, { ...r1, v: 3 })).toEqual([])
  })

  it('nothing visible differs: it says so plainly; no copy to compare with: it says that instead', () => {
    const plan = rev('win-rate', 1).plan
    const s = 'Win rate for closed trades over the last 90 days, all accounts.'
    const same = render(<HowMadeSheet open onClose={() => {}} summary={s} onEdit={() => {}} placedPlan={plan}
      latest={{ rev: 2, summary: s, plan: { ...plan, v: 3 } }} />)
    expect(screen.getByTestId('built-how-changes')).toHaveTextContent(NOTHING_VISIBLE)
    same.unmount()
    render(<HowMadeSheet open onClose={() => {}} summary={s} onEdit={() => {}} placedPlan={null}
      latest={{ rev: 2, summary: s, plan }} />)
    expect(screen.getByTestId('built-how-changes')).toHaveTextContent(NO_COPY)
  })

  it('different sentences are shown side by side (the measures or range changed)', () => {
    const plan = rev('win-rate', 1).plan
    render(<HowMadeSheet open onClose={() => {}} summary="Old sentence." onEdit={() => {}} placedPlan={plan}
      latest={{ rev: 2, summary: 'New sentence.', plan }} />)
    expect(screen.getByTestId('built-how-latest')).toHaveTextContent('New sentence.')
    expect(screen.queryByTestId('built-how-changes')).toBeNull()             // the sentences already say it
  })
})

// ── fix round 3 (review-walk-fix.md) ──────────────────────────────────────────────────────────────────
describe('round 3: m-2, m-3 and the publicHidden stamp', () => {
  it('m-2: a custom title the update drops is said ("named automatically again")', () => {
    const plan = rev('win-rate', 1).plan
    const custom = { ...plan, display: { ...plan.display, title: 'My win rate', titleAuto: false } }
    const auto = { ...plan, display: { ...plan.display, title: '', titleAuto: true } }
    expect(planChanges(custom, auto)).toContain(TITLE_AUTO_AGAIN)
    expect(planChanges(auto, auto)).toEqual([])                       // control
  })

  it('m-3: every unit the catalog serves (sources and measures) has its own noun; an unknown one is neutral', () => {
    const served = new Set([...W10_CATALOG.sources.map((s) => s.unit),
      ...(W10_CATALOG.measures || []).map((m) => m.unit).filter(Boolean)])
    expect(served.size).toBeGreaterThan(3)
    for (const u of served) expect(KNOWN_UNITS, u).toContain(u)
    expect(countNoun('lightyears', 2)).toBe('rows')
    expect(countNoun('lightyears', 1)).toBe('row')
    expect(unitWord('lightyears')).toBe('rows')
    expect(countNoun(undefined, 2)).toBe('trades')                    // an older payload's unit-less trade measure
  })

  it('the publicHidden stamp is kept when a payload is inserted into a note (normalizeParams)', () => {
    expect(normalizeParams('builtWidget', { title: 'x', publicHidden: true })).toMatchObject({ publicHidden: true })
  })
})
