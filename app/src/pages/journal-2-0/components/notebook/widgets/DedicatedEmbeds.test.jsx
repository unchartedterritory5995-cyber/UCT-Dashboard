// Wave 10 Task 10.15: the seven ready-made ("dedicated") widget embeds, drawn from REAL payloads of be's own builders
// (shelf_discipline.py, shelf_compose.py, run against a seeded scratch sqlite: __fixtures__/dedicatedPayloads.json).
// Every assertion reads RENDERED TEXT or the drawn SVG, never component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FIX from './__fixtures__/dedicatedPayloads.json'
import TiltCheckEmbed from './TiltCheckEmbed'
import RevengeCleanEmbed from './RevengeCleanEmbed'
import PlanVsActualEmbed from './PlanVsActualEmbed'
import RiskLeftTodayEmbed from './RiskLeftTodayEmbed'
import PropFirmEmbed from './PropFirmEmbed'
import GamePlanEmbed from './GamePlanEmbed'
import AlertsFiredEmbed from './AlertsFiredEmbed'
import { CELL_LABELS } from './RevengeCleanEmbed'
import * as SNAPSHOT_EMBEDS from './snapshotEmbeds'

const EMBEDS = {
  myTiltCheck: TiltCheckEmbed,
  myRevengeClean: RevengeCleanEmbed,
  myPlanVsActual: PlanVsActualEmbed,
  myRiskLeftToday: RiskLeftTodayEmbed,
  myPropFirm: PropFirmEmbed,
  myGamePlan: GamePlanEmbed,
  myAlertsFired: AlertsFiredEmbed,
}
/** The brand-new member's fixture for each kind (be's own `u-new` member: no trades, accounts, fires or limits). */
const BRAND_NEW = {
  myTiltCheck: 'tilt_new', myRevengeClean: 'revenge_new', myPlanVsActual: 'pva_new', myRiskLeftToday: 'risk_new',
  myPropFirm: 'prop_new', myGamePlan: 'game_new', myAlertsFired: 'alerts_new',
}
const FORBIDDEN = ['$0', '0%', '0 of']

const fixturesOf = (kind) => Object.entries(FIX).filter(([, f]) => f.kind === kind)
const attrsOf = (name) => ({ widgetId: FIX[name].kind, params: FIX[name].payload })
const draw = (name, props = {}) => {
  const Embed = EMBEDS[FIX[name].kind]
  return render(<Embed attrs={attrsOf(name)} {...props} />)
}

/** Every sentence the payload carries for a member to read, in any of its line lists. */
function sentencesOf(p) {
  const out = []
  const take = (xs) => { if (Array.isArray(xs)) for (const x of xs) if (typeof x === 'string' && x) out.push(x) }
  take(p.lines); take(p.notices); take(p.notes)
  for (const b of Array.isArray(p.accounts) ? p.accounts : []) take(b?.lines)
  for (const k of ['wire', 'reporting', 'risk']) take(p[k]?.lines)
  for (const r of Array.isArray(p.rows) ? p.rows : []) if (typeof r?.text === 'string') out.push(r.text)
  return out
}
/** Everything the widget renders, header included. */
const bodyText = (container) => container.textContent || ''

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('the fixtures are real builder payloads for every kind and state', () => {
  it('covers each kind, its brand-new member, and the states the brief names', () => {
    for (const kind of Object.keys(EMBEDS)) expect(fixturesOf(kind).length, kind).toBeGreaterThan(2)
    for (const name of Object.values(BRAND_NEW)) expect(FIX[name], name).toBeTruthy()
    for (const name of ['risk_past', 'prop_past', 'game_wire_gap', 'game_reporting_gap', 'alerts_one_log_gap',
      'revenge_capped', 'alerts_capped', 'game_capped', 'risk_capped', 'tilt_capped', 'pva_no_stop']) {
      expect(FIX[name], name).toBeTruthy()
    }
  })
})

describe.each(Object.keys(EMBEDS))('%s', (kind) => {
  it('renders_payload_sentences_verbatim', () => {
    for (const [name, f] of fixturesOf(kind)) {
      const { container, unmount } = draw(name)
      const said = sentencesOf(f.payload)
      expect(said.length, name).toBeGreaterThan(0)
      const texts = [...container.querySelectorAll('li, p, td')].map((n) => n.textContent)
      for (const line of said) expect(texts, `${name}: ${line}`).toContain(line)
      expect(fetchSpy, 'a snapshot never fetches on mount').not.toHaveBeenCalled()
      unmount()
    }
  })

  it('brand_new_member_no_zero_strings', () => {
    const name = BRAND_NEW[kind]
    const { container } = draw(name)
    const text = bodyText(container)
    expect(text.length).toBeGreaterThan(0)
    for (const bad of FORBIDDEN) expect(text, `${name} shows ${bad}`).not.toContain(bad)
    // ...and in table form too, where a chart offers one.
    const toggle = screen.queryByRole('button', { name: 'Show as table' })
    if (toggle) {
      fireEvent.click(toggle)
      for (const bad of FORBIDDEN) expect(bodyText(container), `${name} table shows ${bad}`).not.toContain(bad)
    }
  })
})

describe('bars', () => {
  it('past_limit_hatched_and_labelled', () => {
    for (const name of ['risk_past', 'prop_past']) {
      const { container, unmount } = draw(name)
      const past = [...container.querySelectorAll('[data-past]')]
      expect(past.length, name).toBeGreaterThan(0)
      for (const row of past) {
        // HATCHED: the past-the-limit segment is filled with a pattern, never a flat colour.
        const seg = row.querySelector('[data-bar-past]')
        expect(seg, name).not.toBeNull()
        const ref = /^url\(#(.+)\)$/.exec(seg.getAttribute('fill'))
        expect(ref, name).not.toBeNull()
        expect(row.querySelector(`pattern[id="${CSS.escape(ref[1])}"]`), name).not.toBeNull()
        // LABELLED: the legend says it in words.
        expect(within(row).getByText('Past the limit')).toBeInTheDocument()
      }
      unmount()
    }
    // CONTROL: a bar inside its limit is neither hatched nor labelled past it.
    const { container } = draw('risk_normal')
    const bar = container.querySelector('[data-testid="risk-bar"]')
    expect(bar).not.toBeNull()
    expect(bar.hasAttribute('data-past')).toBe(false)
    expect(bar.querySelector('[data-bar-past]')).toBeNull()
    expect(within(bar).queryByText('Past the limit')).toBeNull()
    expect(within(bar).getByText('Left')).toBeInTheDocument()
  })

  it('every bar is 44 px tall, inline SVG', () => {
    for (const name of ['risk_normal', 'risk_past', 'prop_normal', 'prop_past', 'tilt_normal', 'tilt_big']) {
      const { container, unmount } = draw(name)
      const bars = [...container.querySelectorAll('svg[data-bar]')]
      expect(bars.length, name).toBeGreaterThan(0)
      for (const svg of bars) {
        expect(svg.getAttribute('height'), name).toBe('44')
        expect(svg.getAttribute('viewBox').split(' ')[3], name).toBe('44')
      }
      unmount()
    }
  })

  it('a bar is drawn from the carried figures: the used share of the limit', () => {
    const { container } = draw('risk_normal')        // used $200 of a $500 limit
    const used = container.querySelector('[data-bar-used]')
    expect(Number(used.getAttribute('width'))).toBeCloseTo((200 / 500) * 300, 5)
  })

  it('Tilt check draws two bars with the server summary as each value label, and the small-sample badge', () => {
    const { container } = draw('tilt_normal')
    const p = FIX.tilt_normal.payload
    expect(container.querySelectorAll('[data-bar-rate]')).toHaveLength(2)
    expect(screen.getByTestId('tilt-bar-After a loss').textContent).toContain(p.after.text)
    expect(screen.getByTestId('tilt-bar-Other trades').textContent).toContain(p.other.text)
    expect(screen.getAllByText('small sample')).toHaveLength(2)
    expect(Number(container.querySelectorAll('[data-bar-rate]')[0].getAttribute('width'))).toBeCloseTo(p.after.winRate * 300, 5)
  })

  it('a group too small for a win rate draws no bar and no number', () => {
    const { container } = draw('tilt_capped')        // "Not enough trades yet (2)" / (1)
    expect(container.querySelector('svg[data-bar]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull()
  })
})

describe('revenge cells', () => {
  it('revenge_cells_have_text_labels', () => {
    const labels = new Set(Object.values(CELL_LABELS))
    for (const name of ['revenge_normal', 'revenge_every_day', 'revenge_dates_only', 'revenge_not_read', 'revenge_new']) {
      const p = FIX[name].payload
      const { unmount } = draw(name)
      const cells = within(screen.getByTestId('revenge-cells')).getAllByRole('listitem')
      expect(cells, name).toHaveLength(p.window)
      for (const c of cells) expect(labels.has(c.textContent), `${name}: "${c.textContent}"`).toBe(true)
      unmount()
    }
    // The counts are the payload's: 27 clean, 2 re-entry days, 1 day with dates only.
    draw('revenge_normal')
    const cells = within(screen.getByTestId('revenge-cells')).getAllByRole('listitem').map((c) => c.textContent)
    expect(cells.filter((t) => t === 'Clean')).toHaveLength(27)
    expect(cells.filter((t) => t === 'Revenge re-entry')).toHaveLength(2)
    expect(cells.filter((t) => t === 'Not checked')).toHaveLength(1)
  })

  it('a flagged day is hatched, a not-checked day is not, and the legend names each state shown', () => {
    const { container } = draw('revenge_normal')
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/widgets/DedicatedEmbeds.module.css'), 'utf8')
    expect(/\.cellFlagged\s*\{[^}]*repeating-linear-gradient/.test(css)).toBe(true)
    expect(/\.cellNotChecked\s*\{[^}]*dashed/.test(css)).toBe(true)
    const flagged = container.querySelector('[data-cell="flagged"]')
    expect(flagged.className).toMatch(/cellFlagged/)
    for (const t of ['Clean', 'Revenge re-entry', 'Not checked']) {
      expect(screen.getAllByText(t).some((n) => n.closest('[data-testid="revenge-cells"]') === null), t).toBe(true)
    }
  })
})

describe('Show as table', () => {
  const CHARTS = [
    ['tilt_normal', 'Tilt check, as a table'],
    ['revenge_normal', 'Revenge trades by day, as a table'],
    ['risk_normal', 'Risk left today, as a table'],
    ['prop_normal', 'Prop-firm rules, as a table'],
  ]
  it('show_as_table_toggle_per_chart', () => {
    for (const [name, tableName] of CHARTS) {
      const { container, unmount } = draw(name)
      const toggle = screen.getByRole('button', { name: 'Show as table' })
      expect(toggle.getAttribute('aria-pressed'), name).toBe('false')
      expect(screen.queryByRole('table', { name: tableName }), name).toBeNull()
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-pressed'), name).toBe('true')
      expect(screen.getByRole('table', { name: tableName }), name).toBeInTheDocument()
      expect(container.querySelector('[data-bar-used], [data-bar-rate], [data-testid="revenge-cells"]'), name).toBeNull()
      fireEvent.click(toggle)
      expect(screen.queryByRole('table', { name: tableName }), name).toBeNull()
      unmount()
    }
  })

  it('the tables carry the payload figures through the phase 1 formatters', () => {
    draw('risk_past')
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const row = screen.getByRole('row', { name: /Main/ })
    expect(row.textContent).toContain('$500.00')
    expect(row.textContent).toContain('$600.00')
    expect(row.textContent).toContain('-$100.00')
    expect(row.textContent).toContain('$250.00')
    expect(row.textContent).toContain('-$350.00')
  })

  it('a carried zero reads "none" in a table, never $0.00', () => {
    draw('risk_none_used')
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const row = screen.getByRole('row', { name: /Main/ })
    expect(row.textContent).not.toContain('$0')
    expect(within(row).getAllByText('none').length).toBeGreaterThan(0)
  })

  it('the revenge table lists each flagged day with its symbol', () => {
    draw('revenge_normal')
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table', { name: 'Revenge re-entries' })
    expect(within(table).getAllByRole('row')).toHaveLength(1 + FIX.revenge_normal.payload.flagged.length)
    expect(within(table).getAllByText('20 min').length).toBe(FIX.revenge_normal.payload.flagged.length)
  })
})

describe('Plan vs actual', () => {
  it('plan_vs_actual_no_stop_set_row', () => {
    const { container } = draw('pva_no_stop')
    const stop = container.querySelector('tr[data-row="Stop"]')
    expect(stop).not.toBeNull()
    expect(stop.textContent).toContain('No stop set')
    expect(stop.textContent).toContain('$96.00')            // the plan's stop
    expect(stop.textContent).not.toContain('$100.00')       // never the placeholder (entry-priced) stop
    expect(stop.textContent).not.toMatch(/\$0/)
  })

  it('the rows are a table of the four rows, planned against actual', () => {
    draw('pva_normal')
    const table = screen.getByTestId('pva-table')
    const labels = within(table).getAllByRole('rowheader').map((n) => n.textContent)
    expect(labels).toEqual(['Entry', 'Stop', 'Target', 'R'])
    expect(table.querySelector('tr[data-row="Entry"]').textContent).toContain('$100.50')
    expect(table.querySelector('tr[data-row="R"]').textContent).toContain('+1.5R')
  })

  it('an unlinked or unavailable trade says its sentence and draws no table', () => {
    for (const name of ['pva_unlinked', 'pva_new']) {
      const { unmount } = draw(name)
      expect(screen.queryByTestId('pva-table')).toBeNull()
      expect(screen.getByText(FIX[name].payload.lines[0])).toBeInTheDocument()
      unmount()
    }
  })
})

describe('Pre-market game plan', () => {
  it('game_plan_part_gap_alone', () => {
    for (const [name, gap] of [['game_wire_gap', 'wire'], ['game_reporting_gap', 'reporting']]) {
      const p = FIX[name].payload
      const { container, unmount } = draw(name)
      for (const key of ['wire', 'reporting', 'risk']) {
        const part = container.querySelector(`section[data-part="${key}"]`)
        expect(part, `${name}: ${key}`).not.toBeNull()
        expect([...part.querySelectorAll('li')].map((n) => n.textContent), `${name}: ${key}`).toEqual(p[key].lines)
      }
      // The gap is said in its own part only; the others still carry their own sentences.
      const gapLine = p[gap].lines[0]
      expect(container.querySelector(`section[data-part="${gap}"]`).textContent).toContain(gapLine)
      for (const key of ['wire', 'reporting', 'risk'].filter((k) => k !== gap)) {
        expect(container.querySelector(`section[data-part="${key}"]`).textContent, key).not.toContain(gapLine)
      }
      unmount()
    }
  })

  it('a capped list of names shows the server line for the rest', () => {
    draw('game_capped')
    expect(screen.getByText('2 more names report today.')).toBeInTheDocument()
  })
})

describe('Alerts that fired', () => {
  it('rows are the payload rows, newest first, with the log\'s own words', () => {
    draw('alerts_capped')
    const rows = within(screen.getByTestId('alerts-rows')).getAllByRole('listitem')
    expect(rows).toHaveLength(FIX.alerts_capped.payload.rows.length)
    expect(rows[0].textContent).toContain(FIX.alerts_capped.payload.rows[0].what)
    expect(rows[0].textContent).toContain(FIX.alerts_capped.payload.rows[0].symbol)
  })

  it('one log unreadable still shows the other log\'s fire and says so', () => {
    draw('alerts_one_log_gap')
    expect(screen.getByText("Some alerts couldn't be read right now.")).toBeInTheDocument()
    expect(within(screen.getByTestId('alerts-rows')).getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('lazy chunk', () => {
  it('snapshotEmbeds.js carries one row per dedicated kind', () => {
    for (const [kind, Embed] of Object.entries(EMBEDS)) expect(SNAPSHOT_EMBEDS[kind], kind).toBe(Embed)
  })
})

describe('R-31: nothing overflows a 390 px phone', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/widgets/DedicatedEmbeds.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  it('no rule forbids wrapping or sets a width wider than a phone column', () => {
    // The visually-hidden label (one pixel, read only by a screen reader) is the one rule allowed not to wrap.
    expect(css.replace(/\.srOnly\s*\{[^}]*\}/, '')).not.toMatch(/white-space:\s*nowrap/)
    for (const m of css.matchAll(/(?:^|[;{\s])(?:min-)?width:\s*(\d+)px/g)) expect(Number(m[1])).toBeLessThan(100)
  })
  it('every block of text wraps anywhere, and the revenge grid shares its width', () => {
    for (const cls of ['lines', 'heading', 'barLabel', 'alert']) {
      expect(new RegExp(`\\.${cls}\\s*\\{[^}]*overflow-wrap:\\s*anywhere`).test(css), cls).toBe(true)
    }
    expect(/\.cells\s*\{[^}]*repeat\(10, minmax\(0, 1fr\)\)/.test(css)).toBe(true)
  })
})
