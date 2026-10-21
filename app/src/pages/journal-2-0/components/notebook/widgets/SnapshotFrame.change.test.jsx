// F2 (ruling R58, UX I-10): a widget's Change control. It edits the kind's request keys (read from the registry
// paramsSchema), asks again through the See it now write, and a preset saved afterwards keeps those keys.
// Asserted by RENDERED TEXT and by the request the browser actually sends.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { changeKeysOf } from './SnapshotFrame'
import MyPnlStatsEmbed from './MyPnlStatsEmbed'
import TickerCardEmbed from './TickerCardEmbed'
import TradeRecapEmbed from './TradeRecapEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import { __resetSetsCache, CHART_SETS_PREF } from '../../../lib/notebookSets'

const realFetch = global.fetch
afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); __resetSetsCache() })

const ASOF = '2026-10-20T14:00:00Z'
const STATS = { asOf: ASOF, source: 'manual', range: { from: '2026-10-13', to: '2026-10-17' }, netPnl: 100, winRate: 0.5,
  avgR: null, tradeCount: 4, equity: [] }

/** The embed under a host that keeps its params, the way the editor's transaction does. */
function Host({ Embed, kind, payload, writes }) {
  const [attrs, setAttrs] = useState(() => widgetEmbedNode(kind, payload).attrs)
  const onUpdateParams = (next) => { writes.push(next); setAttrs((a) => ({ ...a, params: next })); return true }
  return <Embed attrs={attrs} editable onUpdateParams={onUpdateParams} />
}

describe('changeKeysOf: the request keys a kind can change, from its registry paramsSchema', () => {
  it('names each kind\'s settings, and none for a kind chosen from the / menu', () => {
    expect(changeKeysOf('tickerCard')).toEqual(['symbol'])
    expect(changeKeysOf('tickerFlow')).toEqual(['symbol'])
    expect(changeKeysOf('myWatchlistToday')).toEqual(['list'])
    expect(changeKeysOf('myPnlStats')).toEqual(['from', 'to'])
    expect(changeKeysOf('myRulesCheck')).toEqual(['from', 'to'])
    expect(changeKeysOf('myPnlCalendar')).toEqual(['month'])
    expect(changeKeysOf('tradeRecap')).toEqual([])
    expect(changeKeysOf('myScreenToday')).toEqual([])
    expect(changeKeysOf('myPositionsRisk')).toEqual([])
  })
})

describe('Change', () => {
  it('asks again with the new range, writes it through, and a preset then keeps it', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true, notebook_widgets_w5_enabled: true })
    const gets = []
    const posts = []
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) } }
      if (String(url).includes('/api/j2/notebook-widgets/')) {
        gets.push(String(url))
        return { ok: true, status: 200, json: async () => ({ ...STATS, asOf: '2026-10-21T14:00:00Z',
          range: { from: '2026-09-01', to: '2026-09-30' }, netPnl: 900 }) }
      }
      return { ok: true, status: 200, json: async () => ({ [CHART_SETS_PREF]: JSON.stringify({ v: 1, sets: [], presets: [] }) }) }
    })
    const writes = []
    render(<Host Embed={MyPnlStatsEmbed} kind="myPnlStats" payload={STATS} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-13')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(gets).toEqual(['/api/j2/notebook-widgets/myPnlStats?from=2026-09-01&to=2026-09-30'])
    expect(writes[0]).toMatchObject({ from: '2026-09-01', to: '2026-09-30', netPnl: 900, share: false })
    expect(screen.queryByRole('button', { name: 'Show these' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    // A preset saved now keeps the member's range (presets save the request keys).
    fireEvent.click(screen.getByRole('button', { name: 'Save these settings as a preset' }))
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'September' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(await screen.findByText('Saved as a preset. Type /preset to use it.')).toBeInTheDocument()
    expect(JSON.parse(posts[0].value).presets).toEqual([expect.objectContaining({
      name: 'September', kind: 'myPnlStats', params: { from: '2026-09-01', to: '2026-09-30', share: false } })])
  })

  it('a setting the server refuses shows the server\'s own sentence and writes nothing', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 400,
      json: async () => ({ detail: 'from must be between 1990-01-01 and 2027-10-21' }) }))
    const writes = []
    render(<Host Embed={MyPnlStatsEmbed} kind="myPnlStats" payload={STATS} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '1980-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    expect(await screen.findByText('from must be between 1990-01-01 and 2027-10-21')).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    // The form stays open with the member's input, to correct it.
    expect(screen.getByLabelText('From')).toHaveValue('1980-01-01')
  })

  it('the ticker card changes its symbol (typed in any case)', async () => {
    const gets = []
    global.fetch = vi.fn(async (url) => {
      gets.push(String(url))
      return { ok: true, status: 200, json: async () => ({ asOf: ASOF, source: 'market', symbol: 'AMD', price: 150 }) }
    })
    const writes = []
    render(<Host Embed={TickerCardEmbed} kind="tickerCard" payload={{ asOf: ASOF, source: 'market', symbol: 'NVDA' }} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('Symbol')).toHaveValue('NVDA')
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'amd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    expect(await screen.findByText('AMD')).toBeInTheDocument()
    expect(gets).toEqual(['/api/j2/notebook-widgets/tickerCard?symbol=AMD'])
  })

  it('control: a read-only widget, or a kind with no setting, offers no Change', () => {
    const { unmount } = render(<MyPnlStatsEmbed attrs={widgetEmbedNode('myPnlStats', STATS).attrs} />)
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    unmount()
    const writes = []
    render(<Host Embed={TradeRecapEmbed} kind="tradeRecap" payload={{ asOf: ASOF, source: 'manual', symbol: 'NVDA' }} writes={writes} />)
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
  })
})
