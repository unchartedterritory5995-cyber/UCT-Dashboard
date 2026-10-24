// Wave 8 (Task 8.13): the frame's built-widget branch -- the refresh that echoes the server, the share race, the
// three Change fields, the title and the absent preset action. Asserted by RENDERED TEXT and by the request sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, renderHook, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { useSnapshotFrame, changeKeysOf } from './SnapshotFrame'
import BuiltWidgetEmbed from './BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'

const ASOF = '2026-10-20T14:00:00Z'
const DEF = { v: 1, source: 'closed_trades', range: { token: 'last_90d' }, measures: [{ key: 'net_pnl' }],
  filters: [{ field: 'symbol', op: 'in', values: ['NVDA'] }] }
const DEF_OVERRIDABLE = { ...DEF, filters: [{ field: 'setup', op: 'in', values: ['Flag'], overridable: true }] }
const PARAMS = {
  asOf: ASOF, source: 'manual', sourceKey: 'closed_trades', view: 'number', title: 'Net P&L by setup',
  defId: 'd-1', defRev: 2, def: DEF, scopeLabel: 'All my accounts', rangeLabel: 'Last 90 days', count: 12,
  measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }],
  value: { v1: 1250, n1: 12, s1: '', n: 12 }, share: true,
}
const ECHO = { ...PARAMS, asOf: '2026-10-24T15:00:00Z', value: { v1: 1900, n1: 14, s1: '', n: 14 }, count: 14 }
delete ECHO.share

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const realFetch = globalThis.fetch
beforeEach(() => { __resetBuiltCaches(); Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true }) })
afterEach(() => { globalThis.fetch = realFetch; __resetNotebookFlags() })

describe('useSnapshotFrame for a built widget', () => {
  it('title_from_params: the member-given title, else the kind name', () => {
    const { result } = renderHook(() => useSnapshotFrame('builtWidget', { params: PARAMS }))
    expect(result.current.title).toBe('Net P&L by setup')
    const { result: bare } = renderHook(() => useSnapshotFrame('builtWidget', { params: { asOf: ASOF } }))
    expect(bare.current.title).toBe('Widget')
    // control: a phase 1 kind with no title param keeps its own name
    const { result: phase1 } = renderHook(() => useSnapshotFrame('myPnlStats', { params: { asOf: ASOF } }))
    expect(phase1.current.title).toBe('My P&L and stats')
  })

  it('no_preset_action_for_built: no preset even with wave 5 on and an editable host', () => {
    latchNotebookFlags({ notebook_widgets_w5_enabled: true, notebook_widgets_w1_enabled: true })
    const onUpdateParams = vi.fn(() => true)
    const { result } = renderHook(() => useSnapshotFrame('builtWidget', { params: PARAMS }, { editable: true, onUpdateParams }))
    expect(result.current.onSavePreset).toBeUndefined()
    // control: a phase 1 kind under the same host does offer it
    const { result: phase1 } = renderHook(() => useSnapshotFrame('myPnlStats', { params: { asOf: ASOF } }, { editable: true, onUpdateParams }))
    expect(typeof phase1.current.onSavePreset).toBe('function')
  })

  it('changeKeysOf(builtWidget) is the three viewer settings, never from/to', () => {
    expect(changeKeysOf('builtWidget')).toEqual(['range', 'accountId', 'filter'])
  })

  it('See it now posts to /run and writes the server echo plus the current share', async () => {
    globalThis.fetch = vi.fn(async () => reply(200, ECHO))
    const onUpdateParams = vi.fn(() => true)
    const { result } = renderHook(() => useSnapshotFrame('builtWidget', { params: PARAMS }, { editable: true, onUpdateParams }))
    let got
    await act(async () => { got = await result.current.onRefresh() })
    expect(got).toEqual({ ok: true })
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/widget-definitions/run')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ defId: 'd-1', defRev: 2, def: DEF, settings: {} })
    expect(onUpdateParams).toHaveBeenCalledTimes(1)
    expect(onUpdateParams.mock.calls[0][0]).toEqual({ ...ECHO, share: true })
  })

  it('refresh_after_share_switched_off_writes_false', async () => {
    let answer
    globalThis.fetch = vi.fn(() => new Promise((r) => { answer = r }))
    const onUpdateParams = vi.fn(() => true)                 // takes the write, never re-renders the hook
    const { result } = renderHook(() => useSnapshotFrame('builtWidget', { params: PARAMS }, { editable: true, onUpdateParams }))
    let refreshed
    act(() => { refreshed = result.current.onRefresh() })
    act(() => { result.current.onShareChange(false) })
    answer(reply(200, { ...ECHO, share: true }))              // even a payload that claims share: true
    await act(async () => { await refreshed })
    expect(onUpdateParams).toHaveBeenCalledTimes(2)
    expect(onUpdateParams.mock.calls[0][0].share).toBe(false)
    expect(onUpdateParams.mock.calls[1][0]).toMatchObject({ share: false, count: 14 })
  })

  it('the refresh is written through: a share switch right after it (no re-render yet) keeps the new numbers', async () => {
    globalThis.fetch = vi.fn(async () => reply(200, ECHO))
    const onUpdateParams = vi.fn(() => true)                 // takes the write, never re-renders the hook
    const { result } = renderHook(() => useSnapshotFrame('builtWidget', { params: PARAMS }, { editable: true, onUpdateParams }))
    await act(async () => { await result.current.onRefresh() })
    act(() => { result.current.onShareChange(false) })
    expect(onUpdateParams.mock.calls[1][0]).toMatchObject({ share: false, count: 14, asOf: ECHO.asOf })
  })

  it('a refused run writes nothing and says the spec sentence; a superseded run says nothing', async () => {
    globalThis.fetch = vi.fn(async () => reply(503, { detail: { code: 'busy', message: 'x' } }))
    const onUpdateParams = vi.fn(() => true)
    const { result } = renderHook(() => useSnapshotFrame('builtWidget', { params: PARAMS }, { editable: true, onUpdateParams }))
    let got
    await act(async () => { got = await result.current.onRefresh() })
    expect(got).toMatchObject({ ok: false, text: 'Busy right now. Try again in a moment.' })
    globalThis.fetch = vi.fn(async () => reply(409, { detail: { code: 'superseded', message: 'A newer preview replaced this one.' } }))
    await act(async () => { got = await result.current.onRefresh() })
    expect(got).toEqual({ ok: false, quiet: true })
    expect(onUpdateParams).not.toHaveBeenCalled()
  })
})

/** The embed under a host that keeps its params, the way the editor's transaction does. */
function Host({ params, writes }) {
  const [attrs, setAttrs] = useState(() => widgetEmbedNode('builtWidget', params).attrs)
  const onUpdateParams = (next) => { writes.push(next); setAttrs((a) => ({ ...a, params: next })); return true }
  return <BuiltWidgetEmbed attrs={attrs} editable onUpdateParams={onUpdateParams} />
}

function routes({ run = ECHO } = {}) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push([String(url), init])
    const u = String(url)
    if (u === '/api/j2/accounts') return reply(200, { accounts: [{ id: 'acc-1', name: 'Main' }, { id: 'acc-2', name: 'IRA' }] })
    if (u === '/api/j2/widget-definitions/vocabulary') {
      return reply(200, { ranges: [{ token: 'last_30d', label: 'last 30 days' }, { token: 'last_90d', label: 'last 90 days' }] })
    }
    if (u.startsWith('/api/j2/widget-definitions/vocabulary?field=')) return reply(200, { field: 'setup', values: ['Flag', 'VCP'] })
    if (u === '/api/j2/widget-definitions/run') return reply(200, { ...run, ...JSON.parse(init.body).settings })
    return reply(404, {})
  })
  return calls
}

describe('Change on a built widget', () => {
  it('change_fields_for_built: range, accountId and filter render; filter is disabled without an overridable filter', async () => {
    routes()
    render(<Host params={PARAMS} writes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const form = screen.getByRole('form', { name: 'Change this widget' })
    expect(within(form).getByLabelText('Date range')).toBeInTheDocument()
    expect(within(form).getByLabelText('Accounts')).toBeInTheDocument()
    const filter = within(form).getByLabelText('Filter values')
    expect(filter).toBeDisabled()
    // M3: the reason is visible text, and the field names it for a screen reader
    const why = within(form).getByText('This widget has no filter you can change from the note.')
    expect(filter.getAttribute('aria-describedby')).toBe(why.id)
    // the accounts are read when Change opens: All my accounts plus each account
    await waitFor(() => expect(within(form).getByRole('option', { name: 'IRA' })).toBeInTheDocument())
    expect(within(form).getByRole('option', { name: 'All my accounts' })).toBeInTheDocument()
    expect(within(form).getByRole('option', { name: 'Main' })).toBeInTheDocument()
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Last 30 days' })).toBeInTheDocument())
    expect(within(form).getByRole('option', { name: 'Fixed dates' })).toBeInTheDocument()
    // no From/To until Fixed dates is chosen
    expect(within(form).queryByLabelText('From')).toBeNull()
  })

  it('an overridable filter enables the filter, its values from the member vocabulary', async () => {
    const calls = routes()
    render(<Host params={{ ...PARAMS, def: DEF_OVERRIDABLE, filter: ['Flag'] }} writes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const filter = screen.getByLabelText('Filter values')
    expect(filter).not.toBeDisabled()
    await waitFor(() => expect(within(filter).getByRole('option', { name: 'VCP' })).toBeInTheDocument())
    expect(calls.some(([u]) => u === '/api/j2/widget-definitions/vocabulary?field=setup')).toBe(true)
  })

  it('Fixed dates reveals From and To, and Show these runs with the asked settings and stores the echo', async () => {
    const calls = routes()
    const writes = []
    render(<Host params={{ ...PARAMS, def: DEF_OVERRIDABLE }} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'IRA' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'fixed' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('Accounts'), { target: { value: 'acc-2' } })
    await waitFor(() => expect(screen.getByRole('option', { name: 'VCP' })).toBeInTheDocument())
    const filter = screen.getByLabelText('Filter values')
    for (const o of filter.options) o.selected = o.value === 'VCP'
    fireEvent.change(filter)
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    const run = calls.find(([u]) => u === '/api/j2/widget-definitions/run')
    expect(JSON.parse(run[1].body).settings).toEqual({
      range: { from: '2026-10-01', to: '2026-10-20' }, accountId: 'acc-2', filter: ['VCP'] })
    expect(writes[0]).toMatchObject({ range: { from: '2026-10-01', to: '2026-10-20' }, accountId: 'acc-2', filter: ['VCP'], share: true })
    expect(screen.queryByRole('form', { name: 'Change this widget' })).toBeNull()
  })

  it('a refused setting shows the server sentence and writes nothing', async () => {
    routes()
    globalThis.fetch = vi.fn(async (url) => (String(url) === '/api/j2/widget-definitions/run'
      ? reply(400, { detail: { code: 'invalid', message: 'The start date is after the end date.' } })
      : reply(200, { accounts: [], ranges: [] })))
    const writes = []
    render(<Host params={PARAMS} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'fixed' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument()
    expect(writes).toHaveLength(0)
  })

  it('M4: a defRef-only widget reads its plan from GET /{defId}; an overridable filter there enables the filter', async () => {
    const calls = routes()
    const fetch0 = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => (String(url) === '/api/j2/widget-definitions/d-1'
      ? reply(200, { id: 'd-1', plan: DEF_OVERRIDABLE }) : fetch0(url, init)))
    const { def, ...noDef } = PARAMS                                    // eslint-disable-line no-unused-vars
    render(<Host params={{ ...noDef, defRef: { id: 'd-1', rev: 2 } }} writes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('Filter values')).toBeDisabled()       // before the plan is read
    await waitFor(() => expect(screen.getByLabelText('Filter values')).not.toBeDisabled())
    await waitFor(() => expect(screen.getByRole('option', { name: 'VCP' })).toBeInTheDocument())
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u) === '/api/j2/widget-definitions/d-1')).toBe(true)
    expect(calls.some(([u]) => u === '/api/j2/widget-definitions/vocabulary?field=setup')).toBe(true)
  })

  it('M4: when that read fails, the filter stays disabled with its reason', async () => {
    routes()
    const fetch0 = globalThis.fetch
    const seen = []
    globalThis.fetch = vi.fn(async (url, init) => {
      seen.push(String(url))
      return String(url) === '/api/j2/widget-definitions/d-1' ? reply(500, null) : fetch0(url, init)
    })
    const { def, ...noDef } = PARAMS                                    // eslint-disable-line no-unused-vars
    render(<Host params={{ ...noDef, defRef: { id: 'd-1', rev: 2 } }} writes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(seen).toContain('/api/j2/widget-definitions/d-1'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'IRA' })).toBeInTheDocument())
    expect(screen.getByLabelText('Filter values')).toBeDisabled()
    expect(screen.getByText('This widget has no filter you can change from the note.')).toBeInTheDocument()
    expect(seen.some((u) => u.includes('vocabulary?field='))).toBe(false)
  })

  it('M6: Change while offline says so, makes no run and writes nothing', async () => {
    routes()
    const writes = []
    render(<Host params={PARAMS} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    expect(await screen.findByText("Offline. You can change this when you're back.")).toBeInTheDocument()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).endsWith('/run'))).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('See it now with wave 8 dark (a 404) says Not available right now and keeps the snapshot', async () => {
    globalThis.fetch = vi.fn(async () => reply(404, { detail: 'Not Found' }))
    const writes = []
    render(<Host params={PARAMS} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'See it now' }))
    expect(await screen.findByText('Not available right now.')).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(screen.getByText('+$1,250.00')).toBeInTheDocument()
  })

  it('no preset button on a placed built widget', () => {
    latchNotebookFlags({ notebook_widgets_w5_enabled: true })
    render(<Host params={PARAMS} writes={[]} />)
    expect(screen.queryByRole('button', { name: 'Save these settings as a preset' })).toBeNull()
    expect(screen.getByRole('button', { name: 'See it now' })).toBeInTheDocument()
  })
})
