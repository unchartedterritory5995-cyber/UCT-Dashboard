// Wave 8 (Task 8.13): a placed built widget, drawn from its params alone. Number and Table views, every other view
// on the table until Task 8.14, and "Show as table". Asserted by RENDERED TEXT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import BuiltWidgetEmbed from './BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const ASOF = '2026-10-24T14:00:00Z'
const M = (label, fmt, unit = 'trades', kind = 'sum') => ({ label, unit, kind, fmt })
const BASE = {
  asOf: ASOF, source: 'manual', sourceKey: 'closed_trades', title: 'Net P&L by setup', defId: 'd-1', defRev: 1,
  def: { v: 1, source: 'closed_trades' }, scopeLabel: 'Main account', rangeLabel: 'Last 90 days', count: 47,
  sourceDetail: 'Your closed trades in the Journal.', share: false,
}
const NUMBER = {
  ...BASE, view: 'number',
  measures: [M('Net P&L', 'money'), M('Win rate', 'pct', 'decisive', 'rate'), M('Expectancy', 'r', 'trades', 'average')],
  value: { v1: 2140, n1: 47, s1: '', v2: 0.55, n2: 12, s2: 'small', v3: null, n3: 3, s3: 'hide', n: 47 },
}
const ROWS = [
  { label: 'Flag', label2: null, v1: 1500, n1: 20, s1: '', n: 20, flagged: false },
  { label: '__proto__', label2: null, v1: -200, n1: 4, s1: '', n: 4, flagged: false },
  { label: 'VCP', label2: null, v1: null, n1: 0, s1: '', n: 0, flagged: false },
]
const TABLE = { ...BASE, view: 'table', measures: [M('Net P&L', 'money')], value: { v1: 1300, n1: 24, n: 24 }, rows: ROWS }
const attrsOf = (p) => widgetEmbedNode('builtWidget', p).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('BuiltWidgetEmbed', () => {
  it('renders_number_and_table_from_params_without_fetch', () => {
    const { unmount } = render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    expect(screen.getByText('Net P&L by setup')).toBeInTheDocument()            // the frame title is the member's
    const view = screen.getByTestId('built-number-view')
    expect(within(view).getByText('+$2,140.00')).toBeInTheDocument()
    expect(within(view).getByText('from 47 trades')).toBeInTheDocument()
    // a small sample keeps its value with the badge; a hidden one says why, never a zero
    expect(within(view).getByText('55.0%')).toBeInTheDocument()
    expect(within(view).getByText('small sample')).toBeInTheDocument()
    expect(within(view).getByText('Not enough trades yet (3)')).toBeInTheDocument()
    expect(screen.getByText('Main account · Last 90 days')).toBeInTheDocument()
    unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf(TABLE)} />)
    const table = screen.getByTestId('built-table-view')
    const flag = within(table).getByText('Flag').closest('tr')
    expect(within(flag).getByText('+$1,500.00')).toBeInTheDocument()
    // a label that names an Object.prototype member is an ordinary row
    expect(within(within(table).getByText('__proto__').closest('tr')).getByText('-$200.00')).toBeInTheDocument()
    // an unknown value is "no data", never $0.00
    expect(within(within(table).getByText('VCP').closest('tr')).getByText('no data')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull()   // a table is one already
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('other_views_fall_back_to_table', () => {
    for (const view of ['bar', 'list', 'compare', 'progress']) {
      const p = { ...TABLE, view, rows: view === 'compare' || view === 'progress' ? [] : ROWS }
      const { unmount } = render(<BuiltWidgetEmbed attrs={attrsOf(p)} />)
      expect(screen.getByTestId('built-table-view'), view).toBeInTheDocument()
      expect(screen.queryByTestId('built-number-view'), view).toBeNull()
      unmount()
    }
    const { unmount } = render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'line', rows: [],
      series: [{ label: '2026-10', v1: 100, n1: 3, s1: '', n: 3 }, { label: '2026-09', v1: -50, n1: 2, s1: '', n: 2 }] })} />)
    const line = screen.getByTestId('built-table-view')
    expect(within(line).getByText('2026-10')).toBeInTheDocument()
    expect(within(line).getByText('-$50.00')).toBeInTheDocument()
    unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'scatter', rows: [], measures: [M('R', 'r'), M('Net P&L', 'money')],
      points: [{ x: 1.5, y: 300, d: '2026-10-02', r: 'win' }] })} />)
    const scatter = screen.getByTestId('built-table-view')
    expect(within(scatter).getByText('+1.5R')).toBeInTheDocument()
    expect(within(scatter).getByText('Win')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('table_alt_matches_rows', () => {
    const bar = { ...TABLE, view: 'bar' }
    render(<BuiltWidgetEmbed attrs={attrsOf(bar)} />)
    const toggle = screen.getByRole('button', { name: 'Show as table' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    const alt = screen.getByTestId('built-table-alt')
    const rows = [...alt.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows).toEqual([['Flag', '+$1,500.00'], ['__proto__', '-$200.00'], ['VCP', 'no data']])
    expect(alt.querySelector('caption').textContent).toBe('Net P&L by setup, as a table')
    // M2: one fixed label; the state is aria-pressed
    expect(screen.getByRole('button', { name: 'Show as table' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(screen.queryByTestId('built-table-alt')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show as table' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('R-25: a SHARED widget draws no account name (Account 1, 2 by first appearance); unshared it does', () => {
    const CANARY = 'CANARY-ACCT-Roth'
    const byAccount = { ...TABLE, view: 'bar', labelKind: 'account', label2Kind: 'account', rows: [
      { label: CANARY, label2: 'Main', v1: 10, n1: 1, s1: '', n: 1 },
      { label: 'Main', label2: CANARY, v1: 20, n1: 1, s1: '', n: 1 },
      { label: CANARY, label2: 'Main', v1: 30, n1: 1, s1: '', n: 1 },
    ] }
    const shared = render(<BuiltWidgetEmbed attrs={attrsOf({ ...byAccount, share: true })} />)
    const body = shared.container.textContent
    expect(body).not.toContain(CANARY)
    expect(body).not.toContain('Main account')                       // nor the scope label
    const rows = [...shared.container.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 2)
      .map((td) => td.textContent))
    // one account keeps one number; label and label2 are numbered separately
    expect(rows).toEqual([['Account 1', 'Account 1'], ['Account 2', 'Account 2'], ['Account 1', 'Account 1']])
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(shared.container.textContent).not.toContain(CANARY)       // the table alternative too
    shared.unmount()
    // control: unshared, the member sees their own account names
    const own = render(<BuiltWidgetEmbed attrs={attrsOf({ ...byAccount, share: false })} />)
    expect(own.container.textContent).toContain(CANARY)
    own.unmount()
    // control: shared with no account label, labels are left alone
    const plain = render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar', share: true })} />)
    expect(plain.container.textContent).toContain('Flag')
  })

  it('M5: a hidden value with no count says Not enough trades yet, with no number', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, value: { v1: 5, n1: 4, s1: '', v2: null, s2: 'hide', v3: null, s3: 'hide',
      n3: 2, n: 4 } })} />)
    expect(screen.getByText('Not enough trades yet')).toBeInTheDocument()
    expect(screen.getByText('Not enough trades yet (2)')).toBeInTheDocument()
  })

  it('the number view as a table is its total, one row per measure slot', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const alt = screen.getByTestId('built-table-alt')
    const head = [...alt.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(head).toEqual(['Group', 'Net P&L', 'Win rate', 'Expectancy'])
    const cells = [...alt.querySelectorAll('tbody td')].map((td) => td.textContent)
    expect(cells).toEqual(['All', '+$2,140.00', '55.0% (small sample)', 'Not enough trades yet (3)'])
  })

  it('an empty payload shows its sentence, never a zero or a blank chart', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, count: 0, value: { v1: null, n1: 0, s1: '', n: 0 },
      empty: 'No closed trades in this range. Widen the range, or log a trade.' })} />)
    expect(screen.getByText('No closed trades in this range. Widen the range, or log a trade.')).toBeInTheDocument()
    expect(screen.queryByTestId('built-number-view')).toBeNull()
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('a shared widget does not draw its scope label (an account name) in the body the archive rasterises', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, share: true })} />)
    expect(screen.queryByText(/Main account/)).toBeNull()
    expect(screen.getByText('Last 90 days')).toBeInTheDocument()
  })

  it('the frame says Only you while private, and offers See it now and Change when editable', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    expect(screen.getByText('Only you')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See it now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(screen.getByText('Your closed trades in the Journal.')).toBeInTheDocument()
  })

  it('the too-large form shows its sentence through the frame', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ asOf: ASOF, source: 'manual', title: 'Big one', tooLarge: true,
      empty: "This widget's data was too large to save. Narrow it and try again." })} />)
    expect(screen.getByText("This widget's data was too large to save. Narrow it and try again.")).toBeInTheDocument()
  })
})
