// Wave 8 (Tasks 8.13-8.14): a placed built widget, drawn from its params alone: the Number and Table views, "Show as
// table", drill-down and the ⋯ menu (How this is made, Manage…, an update, an archived or a missing widget). The
// seven chart views have their own file (builtViews/builtViews.test.jsx). Asserted by RENDERED TEXT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import BuiltWidgetEmbed, {
  SAVED_COPY_SENTENCE, ARCHIVED_SENTENCE, CHECK_FAILED_SENTENCE, UNAVAILABLE_SENTENCE,
} from './BuiltWidgetEmbed'
import { anchorPosition, PANEL_MAX_H } from './builtViews/DrillPanel'
import SnapshotFrame, { useSnapshotFrame } from './SnapshotFrame'
import frameStyles from './SnapshotFrame.module.css'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { openWidgetBuilder } from '../widgetBuilder/openWidgetBuilder.js'
import { openMyTools } from '../myTools/openMyTools.js'

// Ruling R-2: Tasks 8.15 and 8.17 replace these placeholder doors; here they are mocked, so the test sees the call.
vi.mock('../widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => true) }))
vi.mock('../myTools/openMyTools.js', () => ({ openMyTools: vi.fn(() => true) }))
// Wave 8's flag, switchable per test (a 404 while it is dark is the wave, not a deleted widget).
const flags = vi.hoisted(() => ({ w8: true }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({
  ...(await orig()), widgetsWaveOn: (w) => (w === 8 ? flags.w8 : false),
}))

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
beforeEach(() => {
  fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy); openWidgetBuilder.mockClear(); openMyTools.mockClear()
  flags.w8 = true
})
afterEach(() => vi.unstubAllGlobals())
/** Make the touch tier match (useIsTouch answers true). */
const asTouch = () => vi.stubGlobal('matchMedia', (q) => ({
  matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
}))

/** A fetch answer the client reads (`ok`, `status`, `json()`). */
const answer = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data })
/** The JSON body of fetch call `i`. */
const bodyOf = (i) => JSON.parse(fetchSpy.mock.calls[i][1].body)
const urlOf = (i) => fetchSpy.mock.calls[i][0]
const tradeRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: `t-${i}`, symbol: `SYM${i}`, side: 'long', day: '2026-10-02', net: 100 + i, r: 1.5, setup: 'Flag',
  flagged: i === 1,
}))
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More for this widget' }))

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
    const byAccount = { ...TABLE, view: 'table', labelKind: 'account', label2Kind: 'account', rows: [
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
    shared.unmount()
    // the table alternative of a chart view too
    const asBar = render(<BuiltWidgetEmbed attrs={attrsOf({ ...byAccount, view: 'bar', share: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(asBar.container.textContent).not.toContain(CANARY)
    expect(screen.getByTestId('built-table-alt').textContent).toContain('Account 1')
    asBar.unmount()
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
    // an average or a rate gets its count column, in its own unit (spec 5.2)
    expect(head).toEqual(['Group', 'Net P&L', 'Win rate', 'Win rate (n)', 'Expectancy', 'Expectancy (n)'])
    const cells = [...alt.querySelectorAll('tbody td')].map((td) => td.textContent)
    expect(cells).toEqual(['All', '+$2,140.00', '55.0% (small sample)', '12 decisive trades',
      'Not enough trades yet (3)', '3 trades'])
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
  it('table_alt_available_for_every_chart_view', () => {
    const rows = [{ label: 'Flag', v1: 10, n1: 1, s1: '', n: 1 }]
    const views = {
      number: {}, compare: { compare: { v1: 4, n1: 1, n: 1 }, compareLabel: 'Sep' }, bar: { rows },
      line: { series: rows }, heat: { cells: [{ label: '2026-10-20', v1: 10, n1: 1, s1: '' }] }, list: { rows },
      progress: { def: { display: { target: 100 } } },
      scatter: { measures: [M('R', 'r'), M('Net P&L', 'money')], points: [{ x: 1, y: 2, d: '2026-10-02', r: 'win' }] },
    }
    for (const [view, extra] of Object.entries(views)) {
      const { unmount } = render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view, ...extra })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
      const alt = screen.getByTestId('built-table-alt')
      expect(alt.querySelector('table'), view).not.toBeNull()
      expect(alt.querySelectorAll('tbody tr').length, view).toBe(1)
      unmount()
    }
  })

  it('drill_opens_on_enter_and_escape_returns_focus', async () => {
    fetchSpy.mockImplementation(() => answer({ rows: tradeRows(2), more: 0, count: 2, live: false, note: null }))
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar' })} />)
    const bars = screen.getByTestId('built-bar-view')
    const marks = bars.querySelectorAll('[data-built-cell]')
    expect(marks.length).toBe(3)
    // one Tab stop for the group; the arrow keys move it
    expect([...marks].map((m) => m.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    act(() => marks[0].focus())
    fireEvent.keyDown(marks[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(marks[1])
    expect([...marks].map((m) => m.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(fetchSpy).toHaveBeenCalledTimes(0)                       // nothing is asked until a mark is opened
    fireEvent.keyDown(marks[1], { key: 'Enter' })
    const panel = await screen.findByRole('dialog', { name: 'Behind __proto__' })
    await within(panel).findByText('SYM0 long')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(urlOf(0)).toBe('/api/j2/widget-definitions/drill')
    const body = bodyOf(0)
    expect(body.cell).toEqual({ label: '__proto__' })
    expect(body).toMatchObject({ defId: 'd-1', defRev: 1, snapshotCount: 47, snapshotAt: ASOF })
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Close' }))
    // a NON-modal dialog anchored inside the widget
    expect(panel.hasAttribute('aria-modal')).toBe(false)
    expect(screen.getByTestId('built-widget-embed').contains(panel)).toBe(true)
    expect(panel.style.left).not.toBe('')
    expect(panel.style.top).not.toBe('')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(marks[1])                  // focus is back on the bar that opened it
  })

  it('drill_absent_in_share_view', () => {
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar' })} shareView />)
    const bars = screen.getByTestId('built-bar-view')
    expect(bars.querySelectorAll('[data-built-cell]').length).toBe(0)
    expect(bars.querySelectorAll('[tabindex]').length).toBe(0)
    fireEvent.click(within(bars).getByText('Flag'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
    r.unmount()
    // the table rows and the number too
    const t = render(<BuiltWidgetEmbed attrs={attrsOf(TABLE)} shareView />)
    expect(t.container.querySelectorAll('[data-built-cell]').length).toBe(0)
    t.unmount()
    const n = render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} shareView />)
    expect(n.container.querySelectorAll('[data-built-cell]').length).toBe(0)
    n.unmount()
    // control: the same widget off a public page drills
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar' })} />)
    expect(screen.getByTestId('built-bar-view').querySelectorAll('[data-built-cell]').length).toBe(3)
  })

  it('drill_lists_40_and_more_and_flagged_label', async () => {
    fetchSpy.mockImplementation(() => answer({
      rows: tradeRows(40), more: 7, count: 46, live: true,
      note: 'That account is no longer in your Journal; showing all accounts. Live data; the snapshot was taken on Oct 24',
    }))
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} />)
    fireEvent.click(screen.getByRole('button', { name: /^Net P&L:/ }))
    const panel = await screen.findByRole('dialog')
    const list = await within(panel).findByTestId('built-drill-rows')
    expect(list.querySelectorAll('li').length).toBe(40)
    expect(within(panel).getByText('and 7 more')).toBeInTheDocument()
    // the note is rendered as given
    expect(within(panel).getByTestId('built-drill-note').textContent)
      .toBe('That account is no longer in your Journal; showing all accounts. Live data; the snapshot was taken on Oct 24')
    // each trade links into the Journal; the flagged one says so
    const first = within(panel).getByRole('link', { name: 'SYM0 long' })
    expect(first).toHaveAttribute('href', '/journal-2-0/trade/t-0')        // ruling R-30
    const flagged = within(panel).getByRole('link', { name: 'SYM1 long' }).closest('li')
    expect(within(flagged).getByText('Flagged')).toBeInTheDocument()
    expect(within(first.closest('li')).queryByText('Flagged')).toBeNull()
    expect(bodyOf(0).cell).toEqual({})                             // a total drills the whole widget
  })

  it('a refused drill shows its sentence, and nothing else changes', async () => {
    fetchSpy.mockImplementation(() => answer({ detail: { code: 'rate', message: 'x' } }, 429))
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} />)
    fireEvent.click(screen.getByRole('button', { name: /^Net P&L:/ }))
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('Too many refreshes in a minute. Try again shortly.')).toBeInTheDocument()
    expect(screen.getByText('+$2,140.00')).toBeInTheDocument()
  })

  it('proto_label_groups_safely: a row labelled __proto__ renders and drills', async () => {
    fetchSpy.mockImplementation(() => answer({ rows: [], more: 0, count: 0, live: false, note: null }))
    const rows = [{ label: '__proto__', label2: 'constructor', v1: 5, n1: 1, s1: '', n: 1 },
      { label: 'hasOwnProperty', label2: '__proto__', v1: -3, n1: 1, s1: '', n: 1 }]
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, rows })} />)
    const table = screen.getByTestId('built-table-view')
    const row = within(table).getAllByText('__proto__')[0].closest('tr')
    expect(within(row).getByText('+$5.00')).toBeInTheDocument()
    expect(within(row).getByText('constructor')).toBeInTheDocument()
    fireEvent.keyDown(row, { key: 'Enter' })
    await screen.findByRole('dialog')
    expect(bodyOf(0).cell).toEqual({ label: '__proto__', label2: 'constructor' })
    expect(Object.prototype.polluted).toBeUndefined()
    expect({}.constructor).toBe(Object)
  })

  it('shared_body_has_no_summary_or_filter_text', () => {
    const p = {
      ...TABLE, view: 'bar', share: true, summary: 'Net P&L of CANARY-SUMMARY trades, split by setup',
      def: { v: 1, source: 'closed_trades', filters: [{ field: 'setup', op: 'in', values: ['CANARY-FILTER'], overridable: true }],
        display: { subtitle: 'CANARY-SUBTITLE', title: 'Net P&L by setup' } },
      filter: ['CANARY-FILTER'],
    }
    const shared = render(<BuiltWidgetEmbed attrs={attrsOf(p)} editable onUpdateParams={() => true} />)
    const body = shared.getByTestId('built-widget-embed')
    for (const canary of ['CANARY-SUMMARY', 'CANARY-FILTER', 'CANARY-SUBTITLE', 'Main account']) {
      expect(body.textContent, canary).not.toContain(canary)
    }
    expect(screen.queryByRole('button', { name: 'More for this widget' })).toBeNull()   // nor the ⋯ menu
    shared.unmount()
    // control: private, the member sees their subtitle and gets the menu (the summary is behind it)
    const own = render(<BuiltWidgetEmbed attrs={attrsOf({ ...p, share: false })} editable onUpdateParams={() => true} />)
    expect(own.getByTestId('built-widget-embed').textContent).toContain('CANARY-SUBTITLE')
    expect(screen.getByRole('button', { name: 'More for this widget' })).toBeInTheDocument()
  })

  it('How this is made shows the summary and opens the builder at this node; Manage opens My tools', async () => {
    fetchSpy.mockImplementation(() => answer({ id: 'd-1', rev: 1, placedRev: 1, etag: 4, archived: false, summary: 'x' }))
    const editor = { id: 'editor' }
    const getPos = () => 7
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, summary: 'Net P&L of every closed trade in the last 90 days.' })}
      editable onUpdateParams={() => true} editor={editor} getPos={getPos} />)
    expect(fetchSpy).toHaveBeenCalledTimes(0)                       // nothing is read until the menu opens
    openMenu()
    expect(urlOf(0)).toBe('/api/j2/widget-definitions/d-1')
    fireEvent.click(screen.getByRole('button', { name: 'How this is made' }))
    const sheet = await screen.findByRole('dialog', { name: 'How this is made' })
    expect(within(sheet).getByText('Net P&L of every closed trade in the last 90 days.')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit widget' }))
    await waitFor(() => expect(openWidgetBuilder).toHaveBeenCalledTimes(1))
    expect(openWidgetBuilder).toHaveBeenCalledWith({ editor, from: { defId: 'd-1', getPos } })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Manage…' }))
    await waitFor(() => expect(openMyTools).toHaveBeenCalledTimes(1))
    expect(openMyTools).toHaveBeenCalledWith({ editor, defId: 'd-1' })
  })

  it('a firm example says Edit a copy, and is not read from the member\'s widgets', async () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, defId: 'shelf:pnl-by-setup' })} editable onUpdateParams={() => true} />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'How this is made' }))
    const sheet = await screen.findByRole('dialog', { name: 'How this is made' })
    expect(within(sheet).getByRole('button', { name: 'Edit a copy' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Edit widget' })).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('updated_version_control_previews_then_applies', async () => {
    const OLD = 'Net P&L of every closed trade.'
    const NEW = 'Net P&L of closed trades tagged Flag.'
    const payload = { ...NUMBER, defRev: 3, summary: NEW, value: { v1: 900, n1: 10, s1: '', n: 10 }, share: true }
    fetchSpy.mockImplementation((url) => (url.endsWith('/run') ? answer(payload)
      : answer({ id: 'd-1', rev: 3, placedRev: 2, etag: 9, archived: false, summary: NEW })))
    const onUpdateParams = vi.fn(() => true)
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, defRev: 2, summary: OLD })} editable onUpdateParams={onUpdateParams} />)
    openMenu()
    const item = await screen.findByRole('button', { name: 'Updated version available' })
    fireEvent.click(item)
    const sheet = await screen.findByRole('dialog', { name: 'How this is made' })
    // the new sentence beside the one this note runs
    expect(within(sheet).getAllByText(OLD).length).toBeGreaterThan(0)
    expect(within(sheet).getByTestId('built-how-latest').textContent).toBe(NEW)
    expect(onUpdateParams).not.toHaveBeenCalled()                   // a preview writes nothing
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use the updated version' }))
    await waitFor(() => expect(onUpdateParams).toHaveBeenCalledTimes(1))
    const run = fetchSpy.mock.calls.findIndex(([u]) => u.endsWith('/run'))
    expect(bodyOf(run)).toMatchObject({ defId: 'd-1', defRev: 3 })
    const written = onUpdateParams.mock.calls[0][0]
    expect(written.defRev).toBe(3)
    expect(written.value.v1).toBe(900)
    expect(written.share).toBe(false)                               // a refresh never publishes
  })

  it('a widget at its latest revision offers no update', async () => {
    fetchSpy.mockImplementation(() => answer({ id: 'd-1', rev: 2, placedRev: 2, etag: 9, archived: false, summary: 's' }))
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, defRev: 2 })} editable onUpdateParams={() => true} />)
    openMenu()
    await waitFor(() => expect(screen.queryByText('Checking this widget…')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Updated version available' })).toBeNull()
  })

  it('archived_shows_restore', async () => {
    fetchSpy.mockImplementation((url, init) => (init?.method === 'POST'
      ? answer({ id: 'd-1', archived: false })
      : answer({ id: 'd-1', rev: 1, placedRev: 1, etag: 3, archived: true, summary: 's' })))
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    openMenu()
    expect(await screen.findByText(ARCHIVED_SENTENCE)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(screen.queryByText(ARCHIVED_SENTENCE)).toBeNull())
    const post = fetchSpy.mock.calls.findIndex(([, init]) => init?.method === 'POST')
    expect(urlOf(post)).toBe('/api/j2/widget-definitions/d-1/unarchive')
  })

  it('missing_definition_says_saved_copy', async () => {
    fetchSpy.mockImplementation(() => answer({ detail: 'Not Found' }, 404))
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    openMenu()
    expect(await screen.findByText(SAVED_COPY_SENTENCE)).toBeInTheDocument()
    expect(SAVED_COPY_SENTENCE).toBe('Running from the saved copy in this note.')
    // the widget still draws its snapshot
    expect(screen.getByText('+$2,140.00')).toBeInTheDocument()
  })

  it('a read-only placed widget has no menu', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} />)
    expect(screen.queryByRole('button', { name: 'More for this widget' })).toBeNull()
  })

  it('an empty closed-trades widget offers Log a trade', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...NUMBER, count: 0, value: { v1: null, n1: 0, s1: '', n: 0 },
      empty: 'No closed trades in this range. Widen the range, or log a trade.' })} />)
    expect(screen.getByRole('link', { name: 'Log a trade' })).toHaveAttribute('href', '/journal/trades')
  })

  it('the notice and footnotes render under the body', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar', notice: 'Based on your newest 5,000 trades.',
      footnotes: ['Max drawdown: within your newest 5,000 trades.'] })} />)
    expect(screen.getByText('Based on your newest 5,000 trades.')).toBeInTheDocument()
    expect(screen.getByTestId('built-footnotes').textContent).toBe('Max drawdown: within your newest 5,000 trades.')
  })
  it('the desktop drill panel closes on an outside click, and NOT when focus leaves it (non-modal)', async () => {
    fetchSpy.mockImplementation(() => answer({ rows: tradeRows(1), more: 0, count: 1, live: false, note: null }))
    render(<><button type="button">Elsewhere</button><BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar' })} /></>)
    const marks = screen.getByTestId('built-bar-view').querySelectorAll('[data-built-cell]')
    fireEvent.click(marks[0])
    await screen.findByRole('dialog')
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // focus leaving it (Tab out) does not close it
    fireEvent.click(marks[0])
    const panel = await screen.findByRole('dialog')
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    fireEvent.blur(within(panel).getByRole('button', { name: 'Close' }), { relatedTarget: elsewhere })
    act(() => elsewhere.focus())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Close closes it
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the anchored panel sits under its mark, clamped inside the widget, and flips above when there is no room', () => {
    const box = { left: 100, top: 50, width: 500, bottom: 350 }
    expect(anchorPosition(box, { left: 150, top: 92, bottom: 120 }, 360)).toEqual({ left: 50, top: 74, width: 360, maxHeight: PANEL_MAX_H })
    expect(anchorPosition(box, { left: 560, top: 92, bottom: 120 }, 360).left).toBe(140)
    expect(anchorPosition({ left: 0, top: 0, width: 300 }, { left: 250, top: 12, bottom: 40 }, 360)).toEqual({ left: 0, top: 44, width: 300, maxHeight: PANEL_MAX_H })
    // in a visible frame: no taller than the room under the mark (minus the gap and an 8 px margin), at most 320
    const frame = { top: 0, bottom: 300 }
    const under = anchorPosition({ left: 0, top: 0, width: 600, bottom: 300 }, { left: 0, top: 30, bottom: 58 }, 360, frame)
    expect(under).toEqual({ left: 0, top: 62, width: 360, maxHeight: 230 })
    expect(under.top + under.maxHeight).toBeLessThanOrEqual(frame.bottom)                 // nothing overflows
    expect(anchorPosition({ left: 0, top: 0, width: 600 }, { left: 0, top: 30, bottom: 58 }, 360, { top: 0, bottom: 2000 }).maxHeight)
      .toBe(PANEL_MAX_H)
    // too little room under the mark: it opens ABOVE, still inside the frame
    const above = anchorPosition({ left: 0, top: 0, width: 600, bottom: 300 }, { left: 0, top: 222, bottom: 250 }, 360, frame)
    expect(above.above).toBe(true)
    expect(above.bottom).toBe(300 - 222 + 4)
    expect(above.maxHeight).toBe(222 - 4 - 8)
    expect(300 - above.bottom - above.maxHeight).toBeGreaterThanOrEqual(frame.top)
  })

  it('a mouse or touch drill returns focus to the MARK when it closes, not to the editor that held it', async () => {
    asTouch()
    fetchSpy.mockImplementation(() => answer({ rows: [], more: 0, count: 0, live: false, note: null }))
    render(<><div contentEditable suppressContentEditableWarning data-testid="editor" tabIndex={0}>note text</div>
      <BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar' })} /></>)
    const editor = screen.getByTestId('editor')
    act(() => editor.focus())                                       // the member was typing in the note
    const mark = screen.getByTestId('built-bar-view').querySelectorAll('[data-built-cell]')[0]
    fireEvent.click(mark)                                           // a tap: no keyboard focus moved to the mark
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(mark)
    expect(document.activeElement).not.toBe(editor)
  })

  it('the ⋯ menu is a plain popover of buttons: Escape returns focus to ⋯, Tab out closes it', async () => {
    fetchSpy.mockImplementation(() => answer({ id: 'd-1', rev: 1, placedRev: 1, etag: 3, archived: false, summary: 's' }))
    render(<><BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} /><button type="button">After</button></>)
    const more = screen.getByRole('button', { name: 'More for this widget' })
    fireEvent.click(more)
    const pop = screen.getByTestId('built-menu')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(more).not.toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(document.activeElement).toBe(within(pop).getByRole('button', { name: 'How this is made' }))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByTestId('built-menu')).toBeNull()
    expect(document.activeElement).toBe(more)
    fireEvent.click(more)
    const pop2 = screen.getByTestId('built-menu')
    fireEvent.blur(within(pop2).getByRole('button', { name: 'Manage…' }), { relatedTarget: screen.getByRole('button', { name: 'After' }) })
    expect(screen.queryByTestId('built-menu')).toBeNull()
  })

  it('a menu read that fails, or offline, says it could not check; a 404 while wave 8 is dark says Not available', async () => {
    fetchSpy.mockImplementation(() => answer({ detail: 'boom' }, 500))
    const r = render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    openMenu()
    expect(await screen.findByText(CHECK_FAILED_SENTENCE)).toBeInTheDocument()
    expect(CHECK_FAILED_SENTENCE).toBe("Couldn't check for updates.")
    r.unmount()
    // offline: no request, the same sentence
    fetchSpy.mockClear()
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const off = render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    openMenu()
    expect(await screen.findByText(CHECK_FAILED_SENTENCE)).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
    off.unmount()
    online.mockRestore()
    // dark wave: a 404 is the wave
    flags.w8 = false
    fetchSpy.mockImplementation(() => answer({ detail: 'Not Found' }, 404))
    render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} editable onUpdateParams={() => true} />)
    openMenu()
    expect(await screen.findByText(UNAVAILABLE_SENTENCE)).toBeInTheDocument()
    expect(UNAVAILABLE_SENTENCE).toBe('Not available right now.')
    expect(screen.queryByText(SAVED_COPY_SENTENCE)).toBeNull()
  })
  it('the anchored panel re-anchors when the window resizes, and its height fits the widget\u2019s visible area', async () => {
    fetchSpy.mockImplementation(() => answer({ rows: tradeRows(1), more: 0, count: 1, live: false, note: null }))
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'bar' })} />)
    const mark = screen.getByTestId('built-bar-view').querySelectorAll('[data-built-cell]')[1]
    fireEvent.click(mark)
    const panel = await screen.findByRole('dialog')
    expect(panel.style.left).toBe('0px')
    // the layout moves: the mark is now 200 px in, the widget 600 wide, the frame 300 tall
    const frame = screen.getByTestId('built-widget-embed').querySelector('[data-snapshot-frame]')
    Object.defineProperty(frame, 'clientHeight', { configurable: true, get: () => 300 })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this === mark) return { left: 200, top: 30, bottom: 58, right: 600, width: 400, height: 28 }
      return { left: 0, top: 0, bottom: 300, right: 600, width: 600, height: 300 }
    })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(panel.style.left).toBe('200px')
    expect(panel.style.top).toBe('62px')
    // the room under the mark inside the 300 px frame (300 - 58 - 4 - 8): the panel cannot overflow it
    expect(panel.style.maxHeight).toBe('230px')
    expect(62 + 230).toBeLessThanOrEqual(300)
    vi.restoreAllMocks()
  })
  it('a click on the Line overlay while its panel is open neither closes nor reopens it', async () => {
    fetchSpy.mockImplementation(() => answer({ rows: tradeRows(1), more: 0, count: 1, live: false, note: null }))
    render(<BuiltWidgetEmbed attrs={attrsOf({ ...TABLE, view: 'line', rows: [],
      series: [{ label: '2026-09', v1: 1, n1: 1, s1: '' }, { label: '2026-10', v1: 2, n1: 1, s1: '' }] })} />)
    const overlay = screen.getByTestId('built-line-view').querySelector('[data-overlay]')
    fireEvent.pointerDown(overlay, { pointerType: 'mouse' })
    fireEvent.click(overlay, { clientX: 9999 })
    const panel = await screen.findByRole('dialog', { name: 'Behind 2026-10' })
    fireEvent.mouseDown(overlay)
    fireEvent.pointerDown(overlay, { pointerType: 'mouse' })
    fireEvent.click(overlay, { clientX: 9999 })
    expect(screen.getByRole('dialog')).toBe(panel)                   // the same element: never closed
    expect(fetchSpy).toHaveBeenCalledTimes(1)                        // nor asked again
  })

  it('only a built widget reserves the frame\u2019s scrollbar gutter (H14), never another kind', () => {
    const r = render(<BuiltWidgetEmbed attrs={attrsOf(NUMBER)} />)
    expect(r.container.querySelector('[data-snapshot-frame]').className).toContain(frameStyles.frameGutter)
    r.unmount()
    function Other() {
      const attrs = widgetEmbedNode('myPnlStats', { asOf: ASOF, source: 'manual', netPnl: 1, tradeCount: 1 }).attrs
      const frame = useSnapshotFrame('myPnlStats', attrs, {})
      return <SnapshotFrame {...frame}><p>body</p></SnapshotFrame>
    }
    const o = render(<Other />)
    expect(o.container.querySelector('[data-snapshot-frame]').className).not.toContain(frameStyles.frameGutter)
    expect(frameStyles.frameGutter).toBeTruthy()
  })
})
