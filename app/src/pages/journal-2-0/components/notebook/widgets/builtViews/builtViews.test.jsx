// Wave 8 (Task 8.14): the seven chart views of a placed built widget, drawn from params alone. Asserted by RENDERED
// TEXT (and, for the heat map, the SVG it draws), never by component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import BuiltWidgetEmbed from '../BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../../lib/notebookWidgets'
import { fmtValue, countText, compactValue, tableModelOf } from './builtModel'
import { TEXT_MIN_CELL } from './HeatView'

const ASOF = '2026-10-24T14:00:00Z'
const M = (label, fmt, unit = 'trades', kind = 'sum') => ({ label, unit, kind, fmt })
const BASE = {
  asOf: ASOF, source: 'manual', sourceKey: 'closed_trades', title: 'My widget', defId: 'd-1', defRev: 1,
  def: { v: 1, source: 'closed_trades', display: { target: 1000 } }, rangeLabel: 'Last 90 days', count: 47,
  sourceDetail: 'Your closed trades in the Journal.', share: false,
}
const MONEY = [M('Net P&L', 'money')]
const ROWS = [
  { label: 'Flag', label2: null, v1: 1500, n1: 20, s1: '', n: 20, flagged: false },
  { label: 'Pullback', label2: null, v1: -200, n1: 4, s1: '', n: 4, flagged: false },
  { label: 'VCP', label2: null, v1: null, n1: 0, s1: '', n: 0, flagged: false },
]
const SEVEN = {
  compare: { view: 'compare', measures: MONEY, value: { v1: 1300, n1: 24, s1: '', n: 24 },
    compare: { v1: 800, n1: 20, s1: '', n: 20 }, compareLabel: 'Aug 26 to Sep 24, 2026' },
  bar: { view: 'bar', measures: MONEY, value: { v1: 1300, n1: 24, n: 24 }, rows: ROWS },
  line: { view: 'line', measures: MONEY, value: { v1: 50, n1: 5, n: 5 }, series: [
    { label: '2026-08', v1: 100, n1: 3, s1: '', n: 3 }, { label: '2026-09', v1: null, n1: 0, s1: '', n: 0 },
    { label: '2026-10', v1: -50, n1: 2, s1: '', n: 2 }] },
  scatter: { view: 'scatter', measures: [M('R', 'r'), M('Net P&L', 'money')], value: { v1: 1, n1: 2, n: 2 }, points: [
    { x: 1.5, y: 300, d: '2026-10-02', r: 'win' }, { x: -1, y: -120, d: '2026-10-03', r: 'loss' },
    { x: null, y: 40, d: '2026-10-04', r: 'be' }] },
  heat: { view: 'heat', measures: MONEY, value: { v1: 1, n1: 3, n: 3 }, cells: [
    { label: '2026-10-20', v1: 400, n1: 2, s1: '' }, { label: '2026-10-21', v1: -150, n1: 1, s1: '' },
    { label: '2026-10-22', v1: null, n1: 0, s1: '' }] },
  list: { view: 'list', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, rows: [
    { label: 'AAPL', label2: '2026-10-02', v1: 300, n1: 1, s1: '', n: 1, flagged: false },
    { label: 'TSLA', label2: '2026-10-01', v1: -90, n1: 1, s1: '', n: 1, flagged: true }] },
  progress: { view: 'progress', measures: MONEY, value: { v1: 250, n1: 9, s1: '', n: 9 } },
}
const attrsOf = (p) => widgetEmbedNode('builtWidget', { ...BASE, ...p }).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('built widget views', () => {
  it('renders_from_params_without_fetch (each of the seven new views)', () => {
    const ids = { compare: 'built-compare-view', bar: 'built-bar-view', line: 'built-line-view',
      scatter: 'built-scatter-view', heat: 'built-heat-view', list: 'built-list-view', progress: 'built-progress-view' }
    for (const [view, p] of Object.entries(SEVEN)) {
      const { unmount } = render(<BuiltWidgetEmbed attrs={attrsOf(p)} editable onUpdateParams={() => true} />)
      expect(screen.getByTestId(ids[view]), view).toBeInTheDocument()
      expect(screen.queryByTestId('built-table-view'), view).toBeNull()        // no table fallback any more
      unmount()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('each view draws its own numbers', () => {
    const one = (view) => render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN[view])} />)
    let r = one('compare')
    expect(screen.getByText('+$1,300.00')).toBeInTheDocument()
    expect(screen.getByText('vs Aug 26 to Sep 24, 2026')).toBeInTheDocument()
    expect(screen.getByText('+$800.00')).toBeInTheDocument()
    expect(screen.getByText('Change +$500.00')).toBeInTheDocument()
    r.unmount()
    r = one('bar')
    const bar = screen.getByTestId('built-bar-view')
    expect(within(bar).getByText('Flag')).toBeInTheDocument()
    expect(within(bar).getByText('+$1,500.00')).toBeInTheDocument()
    expect(bar.querySelectorAll('rect[class*="barNeg"]').length).toBe(1)    // the loss grows left, in its colour
    r.unmount()
    r = one('line')
    const line = screen.getByTestId('built-line-view')
    expect(line.querySelectorAll('polyline').length).toBe(2)                 // the unknown month BREAKS the line
    expect(screen.getByText('No data for 2026-09.')).toBeInTheDocument()
    r.unmount()
    r = one('scatter')
    expect(screen.getByTestId('built-scatter-view').querySelectorAll('circle[class*="dot"]').length).toBe(2)
    expect(screen.getByText(/1 trade has no data for one of the two values and is not plotted/)).toBeInTheDocument()
    r.unmount()
    r = one('list')
    const list = screen.getByTestId('built-list-view')
    expect(within(within(list).getByText('TSLA').closest('li')).getByText('Flagged')).toBeInTheDocument()
    expect(within(list).getByText('-$90.00')).toBeInTheDocument()
    r.unmount()
    r = one('progress')
    expect(screen.getByText('+$250.00')).toBeInTheDocument()
    expect(screen.getByText('of +$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    r.unmount()
  })

  it('hide_cell_shows_not_enough_with_count (trades, and days for a day unit)', () => {
    const rows = [{ label: 'Flag', v1: null, n1: 3, s1: 'hide', n: 3 }, { label: 'VCP', v1: 5, n1: 30, s1: '', n: 30 }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [M('Win rate', 'pct', 'decisive', 'rate')],
      value: { v1: 0.5, n1: 33, n: 33 }, rows })} />)
    expect(screen.getByText('Not enough trades yet (3)')).toBeInTheDocument()
    expect(screen.getByTestId('built-bar-view').querySelectorAll('rect[class*="bar"]').length).toBe(1)  // no bar for it
    r.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf({ sourceKey: 'trading_days', view: 'number',
      measures: [M('Average day', 'money', 'days', 'average')], value: { v1: null, n1: 2, s1: 'hide', n: 2 } })} />)
    expect(screen.getByText('Not enough days yet (2)')).toBeInTheDocument()
  })

  it('small_badge_under_20 (a value kept, with the badge, in a chart and in a number)', () => {
    const rows = [{ label: 'Flag', v1: 0.6, n1: 12, s1: 'small', n: 12 }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [M('Win rate', 'pct', 'decisive', 'rate')],
      value: { v1: 0.6, n1: 12, s1: 'small', n: 12 }, rows })} />)
    const bar = screen.getByTestId('built-bar-view')
    expect(within(bar).getByText('60.0%')).toBeInTheDocument()
    expect(within(bar).getByText('small sample')).toBeInTheDocument()
    r.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'compare', measures: [M('Win rate', 'pct', 'decisive', 'rate')],
      value: { v1: 0.6, n1: 12, s1: 'small', n: 12 }, compare: null })} />)
    expect(screen.getByText('small sample')).toBeInTheDocument()
    expect(screen.getByText('from 12 decisive trades')).toBeInTheDocument()   // its count, in its own unit
  })

  it('coverage_sentence_and_add_stops_link', () => {
    const coverage = [{ have: 9, total: 47, hint: 'Add stops to see R for more trades' }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'number', measures: [M('Expectancy (R)', 'r', 'trades', 'average')],
      value: { v1: 0.4, n1: 9, s1: 'small', n: 47 }, coverage })} />)
    expect(screen.getByText(/from 9 of 47 trades \(38 have no stop\)/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Add stops to see R for more trades' })
    expect(link).toHaveAttribute('href', '/journal/trades?seg=closed')
    r.unmount()
    // a chart view says it under the chart, one line per short measure
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [M('Expectancy (R)', 'r', 'trades', 'average')],
      value: { v1: 0.4, n1: 9, n: 47 }, coverage, rows: [{ label: 'Flag', v1: 0.4, n1: 9, s1: '', n: 20 }] })} />)
    const note = screen.getByTestId('built-coverage')
    expect(note.textContent).toContain('Expectancy (R): from 9 of 47 trades (38 have no stop)')
    expect(within(note).getByRole('link', { name: 'Add stops to see R for more trades' })).toBeInTheDocument()
    // control: a measure known on every row says only its count
    expect(countText({ n1: 47 }, 1, M('Net P&L', 'money'), [{ have: 47, total: 47, hint: null }]))
      .toEqual({ text: 'from 47 trades', hint: null })
  })

  it('pf_cap_shows_5_plus', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [M('Profit factor', 'pf', 'trades', 'rate')],
      value: { v1: 5, n1: 30, n: 30 }, rows: [{ label: 'Flag', v1: 5, n1: 25, s1: '', n: 25 },
        { label: 'VCP', v1: 1.4, n1: 25, s1: '', n: 25 }] })} />)
    const bar = screen.getByTestId('built-bar-view')
    expect(within(bar).getByText('5+')).toBeInTheDocument()
    expect(within(bar).getByText('1.40')).toBeInTheDocument()
    expect(fmtValue(5, 'pf')).toBe('5+')
    expect(fmtValue(4.99, 'pf')).toBe('4.99')
    expect(fmtValue(5, 'ratio')).toBe('5.00')                                  // only profit factor is capped
    expect(compactValue(5, 'pf')).toBe('5+')
  })

  it('nan_shows_no_data_never_zero', () => {
    const r = render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN.bar)} />)
    const bar = screen.getByTestId('built-bar-view')
    expect(within(within(bar).getByText('VCP').closest('g')).getByText('no data')).toBeInTheDocument()
    expect(bar.textContent).not.toContain('$0.00')
    r.unmount()
    const r2 = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'compare', measures: MONEY,
      value: { v1: NaN, n1: 0, n: 0 }, compare: { v1: Infinity, n1: 0, n: 0 } })} />)
    expect(screen.getAllByText('no data').length).toBe(2)
    expect(r2.container.textContent).not.toContain('$0.00')
    expect(screen.queryByText(/Change/)).toBeNull()                            // no change against a missing number
    r2.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN.heat)} />)
    const heat = screen.getByTestId('built-heat-view')
    const unknown = heat.querySelector('[data-heat-value="none"]')
    expect(unknown.getAttribute('aria-label')).toBe('2026-10-22: no data')
    expect(unknown.textContent).toBe('no data')
  })

  it('heat_cell_has_text_label_and_pattern_for_negative', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN.heat)} />)
    const heat = screen.getByTestId('built-heat-view')
    const pattern = heat.querySelector('pattern')
    expect(pattern).not.toBeNull()
    const neg = heat.querySelector('[data-heat-value="neg"]')
    const pos = heat.querySelector('[data-heat-value="pos"]')
    // a big cell carries its value as text; a loss is ALSO hatched (never colour alone)
    expect(neg.textContent).toBe('-150')
    expect(pos.textContent).toBe('+400')
    expect([...neg.querySelectorAll('rect')].some((r) => r.getAttribute('fill') === `url(#${pattern.id})`)).toBe(true)
    expect([...pos.querySelectorAll('rect')].some((r) => (r.getAttribute('fill') || '').startsWith('url('))).toBe(false)
    expect(neg.getAttribute('aria-label')).toBe('2026-10-21: -$150.00')
  })

  it('a heat cell smaller than 32 px shows only its sign', () => {
    // a year of days: 53 weeks across the width makes every cell well under 32 px
    const cells = []
    const start = Date.UTC(2025, 9, 27)
    for (let i = 0; i < 365; i += 1) {
      const d = new Date(start + i * 86400000)
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
      cells.push({ label: d.toISOString().slice(0, 10), v1: i % 3 === 0 ? -10 : 25, n1: 1, s1: '' })
    }
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'heat', measures: MONEY, value: { v1: 1, n1: 1, n: 1 }, cells })} />)
    const heat = screen.getByTestId('built-heat-view')
    const rect = heat.querySelector('[data-heat-value="pos"] rect')
    expect(Number(rect.getAttribute('width'))).toBeLessThan(TEXT_MIN_CELL)
    expect(heat.querySelector('[data-heat-value="pos"]').textContent).toBe('+')
    expect(heat.querySelector('[data-heat-value="neg"]').textContent).toBe('−')
    expect(heat.querySelector('[data-heat-value="neg"]').getAttribute('aria-label')).toMatch(/: -\$10\.00$/)
  })

  it('R-25 canary: a SHARED bar or heat view draws no account name, and the drill still asks by the real one', () => {
    const CANARY = 'CANARY-ACCT-Roth'
    const bar = { view: 'bar', labelKind: 'account', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, rows: [
      { label: CANARY, v1: 10, n1: 1, s1: '', n: 1 }, { label: 'Main', v1: 20, n1: 1, s1: '', n: 1 }] }
    const heat = { view: 'heat', labelKind: 'account', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, cells: [
      { label: CANARY, v1: 10, n1: 1, s1: '' }, { label: 'Main', v1: -20, n1: 1, s1: '' }] }
    for (const p of [bar, heat]) {
      const shared = render(<BuiltWidgetEmbed attrs={attrsOf({ ...p, share: true })} />)
      expect(shared.container.textContent, p.view).not.toContain(CANARY)
      expect(shared.container.innerHTML, p.view).not.toContain(CANARY)   // nor in an aria-label
      expect(shared.container.textContent, p.view).toContain('Account 1')
      shared.unmount()
      // control: unshared, the member sees their own account names
      const own = render(<BuiltWidgetEmbed attrs={attrsOf({ ...p, share: false })} />)
      expect(own.container.innerHTML, p.view).toContain(CANARY)
      own.unmount()
    }
    // every view reads its rows through ONE path: the drill cell is the real label while the shown one is numbered
    const model = tableModelOf({ ...BASE, ...bar, share: true })
    expect(model.rows.map((r) => r.label)).toEqual(['Account 1', 'Account 2'])
    expect(model.rows.map((r) => r.drill)).toEqual([{ label: CANARY }, { label: 'Main' }])
  })
})
