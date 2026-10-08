// Wave 13 lane 13H-2 — the chart-plan inserts in the slash menu: the weekly /mtf stack and /vs.
//
// Both are dark behind 13H-1's gate (`notebook_chart_plan_enabled`, reused, never a second
// flag). With it off the menu is exactly what it was — the pre-existing SlashMenu.items rail
// keeps holding that; here the OFF case is asserted beside the ON case so the gate can be
// seen to do something (a rail that only ever runs with the gate on cannot tell a gate from
// no gate).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { widgetItems } from './SlashMenu'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { parseVsSlashArgs, chartInsertNodes, MTF_WEEKLY_STACK_TFS } from '../../lib/widgetEmbedCore'

const titles = (q) => widgetItems(q).map((i) => i.title)

function runItem(item, storage = {}) {
  const box = { inserted: null }
  const chain = {
    focus: () => chain, deleteRange: () => chain,
    insertContent: (c) => { box.inserted = c; return chain },
    caretAfterWidgetEmbed: () => chain,
    run: () => {},
  }
  const p = item.command({ editor: { chain: () => chain, storage }, range: {} })
  return { box, p }
}

const on = () => latchNotebookFlags({ notebook_chart_plan_enabled: true })
const off = () => latchNotebookFlags({ notebook_chart_plan_enabled: false })

describe('the gate', () => {
  beforeEach(() => __resetNotebookFlags())
  afterEach(() => __resetNotebookFlags())

  it('OFF (and never latched): no /vs, and /mtf refuses the weekly token', () => {
    expect(titles('')).not.toContain('Versus')
    expect(titles('vs AMD')).toEqual([])
    expect(titles('mtf AMD W')).toEqual([])
    off()
    expect(titles('vs')).toEqual([])
    expect(titles('mtf AMD weekly')).toEqual([])
  })

  it('ON: a bare / lists Versus; /v discovers it; /mtf AMD W is the weekly stack', () => {
    on()
    expect(titles('')).toContain('Versus')
    expect(titles('v')).toEqual(['Versus'])
    expect(titles('mtf AMD W')).toEqual(['MTF stack — AMD · W / D / 1h'])
    expect(titles('mtf AMD weekly 3/13/2026')).toEqual(['MTF stack — AMD · W / D / 1h @ Mar 13, 2026'])
    // today's stack is unchanged with the gate on
    expect(titles('mtf AMD')).toEqual(['MTF stack — AMD · D / 1h / 15m'])
  })
})

describe('/mtf weekly inserts', () => {
  beforeEach(() => { __resetNotebookFlags(); on() })
  afterEach(() => __resetNotebookFlags())

  it('three charts W / D / 60, one symbol, one anchor', () => {
    const { box } = runItem(widgetItems('mtf AMD W 3/13/2026')[0])
    expect(box.inserted.map((n) => n.attrs.params.tf)).toEqual(MTF_WEEKLY_STACK_TFS)
    expect(new Set(box.inserted.map((n) => n.attrs.params.symbol))).toEqual(new Set(['AMD']))
    expect(box.inserted.map((n) => n.attrs.params.to)).toEqual(['2026-03-13', '2026-03-13', '2026-03-13'])
  })

  it('the strictness contract still holds — a second stack token or a tf is NOT accepted', () => {
    expect(titles('mtf AMD W W')).toEqual([])
    expect(titles('mtf AMD 15m')).toEqual([])
    expect(titles('mtf AMD looks')).toEqual([])
  })
})

describe('/vs', () => {
  const realFetch = global.fetch
  beforeEach(() => { __resetNotebookFlags(); on(); global.fetch = vi.fn() })
  afterEach(() => { __resetNotebookFlags(); global.fetch = realFetch })

  it('parses SYMBOL [bench] [day] [tf]; prose and self-comparison parse as nothing', () => {
    expect(parseVsSlashArgs('amd')).toEqual({ symbol: 'AMD', bench: null, day: null, tf: 'D' })
    expect(parseVsSlashArgs('AMD spy 3/13/2026 15m')).toEqual({ symbol: 'AMD', bench: 'SPY', day: '2026-03-13', tf: '15' })
    expect(parseVsSlashArgs('AMD sector')).toMatchObject({ bench: 'sector' })
    expect(parseVsSlashArgs('AMD 3/13/2026')).toMatchObject({ bench: null, day: '2026-03-13' })
    expect(parseVsSlashArgs('AMD AMD')).toBeNull()
    expect(parseVsSlashArgs('looks great here today ok')).toBeNull()
    expect(parseVsSlashArgs('AMD SPY looks')).toBeNull()
  })

  it('without a benchmark the menu offers the four; prose offers nothing', () => {
    expect(titles('vs AMD')).toEqual([
      'Versus — AMD vs SPY', 'Versus — AMD vs QQQ',
      'Versus — AMD vs its sector ETF', 'Versus — AMD vs its theme ETF',
    ])
    expect(titles('vs QQQ')).toEqual([
      'Versus — QQQ vs SPY', 'Versus — QQQ vs its sector ETF', 'Versus — QQQ vs its theme ETF',
    ])
    expect(titles('vs looks great here')).toEqual([])
    expect(titles('v AMD')).toEqual([])                       // prefix + args never matches
  })

  it('SPY inserts a half-width pair frozen at the SAME `to`, with no fetch', async () => {
    const { box, p } = runItem(widgetItems('vs AMD SPY')[0], { uctJournalWidgets: { chartSettings: { k: 1 } } })
    await p
    expect(global.fetch).not.toHaveBeenCalled()
    expect(box.inserted).toHaveLength(2)
    const [a, b] = box.inserted
    expect([a.attrs.params.symbol, b.attrs.params.symbol]).toEqual(['AMD', 'SPY'])
    expect(a.attrs.params.to).toBe(b.attrs.params.to)
    expect(Number.isFinite(Number(a.attrs.params.to))).toBe(true)
    expect([a.attrs.layout.width, b.attrs.layout.width]).toEqual(['half', 'half'])
    expect(a.attrs.params.settings).toEqual({ k: 1 })
    expect(b.attrs.caption).toBe('vs SPY')
  })

  it('sector asks the server for the ETF and inserts it, labelled', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({
      symbol: 'AMD', options: [{ key: 'SPY', symbol: 'SPY' }, { key: 'sector', symbol: 'XLK', label: 'Technology sector' }], missing: {},
    }) })
    const item = widgetItems('vs AMD sector 2026-03-13')[0]
    expect(item.title).toBe('Versus — AMD vs its sector ETF @ Mar 13, 2026')
    const { box, p } = runItem(item)
    await p
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/chart-plan/benchmarks?symbol=AMD', expect.anything())
    expect(box.inserted.map((n) => n.attrs.params.symbol)).toEqual(['AMD', 'XLK'])
    expect(box.inserted.map((n) => n.attrs.params.to)).toEqual(['2026-03-13', '2026-03-13'])
    expect(box.inserted[1].attrs.caption).toBe('vs XLK · Technology sector')
  })

  it('a stock with no theme ETF, a refused lookup, or a network error inserts NOTHING', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ options: [{ key: 'SPY', symbol: 'SPY' }], missing: { theme: 'x' } }) })
    let r = runItem(widgetItems('vs AMD theme')[0]); await r.p
    expect(r.box.inserted).toBeNull()
    global.fetch.mockResolvedValue({ ok: false })
    r = runItem(widgetItems('vs AMD sector')[0]); await r.p
    expect(r.box.inserted).toBeNull()
    global.fetch.mockRejectedValue(new Error('down'))
    r = runItem(widgetItems('vs AMD sector')[0]); await r.p
    expect(r.box.inserted).toBeNull()
  })

  it('the builder refuses a pair with no benchmark or the stock against itself', () => {
    expect(chartInsertNodes('vs', { symbol: 'AMD', benchmark: '' })).toEqual([])
    expect(chartInsertNodes('vs', { symbol: 'AMD', benchmark: 'AMD' })).toEqual([])
  })
})
