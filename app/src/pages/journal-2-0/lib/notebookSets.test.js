// Notebook widgets Task 17: saved chart sets and widget presets (lib/notebookSets.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  readSets, saveSets, chartSetNodes, presetParams, setRefusal, chartSetRows, presetRows, savePreset,
  CHART_SETS_PREF, MAX_CHARTS_PER_SET, SETTINGS_KEYS, __resetSetsCache, READ_FAILED_REASON,
} from './notebookSets'
import { WIDGET_KINDS } from './notebookWidgets'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { buildExtensions } from './tiptap'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const SEMIS = { id: 's_1', name: 'Semis', charts: [{ symbol: 'NVDA', tf: 'D' }, { symbol: 'AMD', tf: '60' }, { symbol: 'AVGO', tf: '15' }] }
const PRESET = { id: 'p_1', name: 'Flagged only', kind: 'myWatchlistToday', params: { list: 'flagged', share: false } }

/** A fetch double for the preferences endpoint: GET answers `stored`, POST records its body. */
function prefsFetch(stored, { getOk = true, postOk = true } = {}) {
  const posts = []
  const fn = vi.fn(async (url, init = {}) => {
    if (init.method === 'POST') {
      posts.push(JSON.parse(init.body))
      return { ok: postOk, status: postOk ? 200 : 500, json: async () => ({}) }
    }
    if (!getOk) return { ok: false, status: 502, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => (stored === undefined ? {} : { [CHART_SETS_PREF]: stored }) }
  })
  fn.posts = posts
  return fn
}

const realFetch = global.fetch
beforeEach(() => { __resetSetsCache() })
afterEach(() => { global.fetch = realFetch; __resetNotebookFlags() })

describe('readSets', () => {
  it('readSets_garbage_gives_empty', () => {
    for (const raw of [null, undefined, '', '{', 'null', '42', '"text"', '[]', JSON.stringify({ sets: 'x', presets: 7 })]) {
      expect(readSets(raw)).toEqual({ v: 1, sets: [], presets: [] })
    }
    // A bad entry is dropped; the good ones stay (the control: the reader is not answering empty to everything).
    const mixed = readSets(JSON.stringify({ v: 1, sets: [SEMIS, { name: 'no id' }, { id: 'x', name: 'Bad', charts: [{ symbol: '!!' }] }],
      presets: [PRESET, { id: 'p_2', name: 'Unknown kind', kind: 'nope', params: {} }] }))
    expect(mixed.sets.map((s) => s.name)).toEqual(['Semis'])
    expect(mixed.presets.map((p) => p.name)).toEqual(['Flagged only'])
  })
})

describe('saveSets', () => {
  it('saveSets_posts_whole_value_keeping_other_key', async () => {
    global.fetch = prefsFetch(JSON.stringify({ v: 1, sets: [], presets: [PRESET] }))
    const res = await saveSets({ sets: [SEMIS] })
    expect(res.ok).toBe(true)
    expect(global.fetch.posts).toHaveLength(1)
    const body = global.fetch.posts[0]
    expect(body.key).toBe('notebook_chart_sets')
    const value = JSON.parse(body.value)
    expect(value.v).toBe(1)
    expect(value.sets.map((s) => s.name)).toEqual(['Semis'])
    // The other key, read from the server, is written back whole.
    expect(value.presets).toEqual([PRESET])

    // And the other way round: a preset save keeps the stored sets.
    __resetSetsCache()
    global.fetch = prefsFetch(JSON.stringify({ v: 1, sets: [SEMIS], presets: [] }))
    expect((await saveSets({ presets: [PRESET] })).ok).toBe(true)
    expect(JSON.parse(global.fetch.posts[0].value).sets).toEqual([SEMIS])
  })

  it('a read that fails writes nothing (writing onto an unreadable value would wipe the other key)', async () => {
    global.fetch = prefsFetch(undefined, { getOk: false })
    expect(await saveSets({ sets: [SEMIS] })).toEqual({ ok: false, reason: READ_FAILED_REASON })
    expect(global.fetch.posts).toHaveLength(0)
  })

  it('set_over_12_charts_refused_with_reason', async () => {
    const big = { id: 's_2', name: 'Too many', charts: Array.from({ length: 13 }, (_, i) => ({ symbol: `A${String.fromCharCode(65 + i)}`, tf: 'D' })) }
    expect(MAX_CHARTS_PER_SET).toBe(12)
    expect(setRefusal(big)).toBe('A chart set holds up to 12 charts. This one has 13.')
    global.fetch = prefsFetch(JSON.stringify({ v: 1, sets: [], presets: [] }))
    const res = await saveSets({ sets: [big] })
    expect(res).toEqual({ ok: false, reason: 'Too many: A chart set holds up to 12 charts. This one has 13.' })
    expect(global.fetch.posts).toHaveLength(0)
    // Control: twelve is allowed.
    expect(setRefusal({ ...big, charts: big.charts.slice(0, 12) })).toBeNull()
    expect((await saveSets({ sets: [{ ...big, charts: big.charts.slice(0, 12) }] })).ok).toBe(true)
  })
})

describe('chart sets insert ordinary chart embeds', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null })

  it('chart_set_inserts_n_chart_embeds_in_order', () => {
    const settings = { theme: 'oled' }
    const nodes = chartSetNodes(SEMIS, settings)
    expect(nodes).toHaveLength(3)
    expect(nodes.map((n) => [n.type, n.attrs.widgetId, n.attrs.mode, n.attrs.params.symbol, n.attrs.params.tf]))
      .toEqual([
        ['widgetEmbed', 'chart', 'snapshot', 'NVDA', 'D'],
        ['widgetEmbed', 'chart', 'snapshot', 'AMD', '60'],
        ['widgetEmbed', 'chart', 'snapshot', 'AVGO', '15'],
      ])
    expect(nodes.every((n) => n.attrs.params.settings?.theme === 'oled')).toBe(true)

    // Through the / menu row, into a real editor: one transaction, the typed command gone, order kept.
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/set semis</p><p>tail</p>' })
    editor.storage.uctJournalWidgets = { ...(editor.storage.uctJournalWidgets || {}), chartSettings: settings }
    const [row] = chartSetRows('set semis', { sets: [SEMIS], presets: [] }, 'mine')
    expect(row.title).toBe('Chart set — Semis')
    let transactions = 0
    editor.on('transaction', () => { transactions += 1 })
    row.command({ editor, range: { from: 1, to: 1 + '/set semis'.length } })
    expect(transactions).toBe(1)
    const embeds = []
    editor.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') embeds.push(n) })
    expect(embeds.map((n) => n.attrs.params.symbol)).toEqual(['NVDA', 'AMD', 'AVGO'])
    expect(editor.state.doc.textContent).not.toContain('/set')
  })

  it('twelve charts are snapshots, so a full set never meets the live-embed cap', () => {
    const twelve = { id: 's', name: 'Twelve', charts: Array.from({ length: 12 }, (_, i) => ({ symbol: `B${String.fromCharCode(65 + i)}`, tf: 'D' })) }
    const nodes = chartSetNodes(twelve)
    expect(nodes).toHaveLength(12)
    expect(nodes.every((n) => n.attrs.mode === 'snapshot')).toBe(true)
  })

  it('/set matches a name case-insensitively by prefix, two regimes like /ticker', () => {
    const doc = { sets: [SEMIS, { id: 's_2', name: 'Software', charts: [{ symbol: 'NOW', tf: 'D' }] }], presets: [] }
    const titles = (q) => chartSetRows(q, doc, 'mine').map((r) => r.title)
    expect(titles('set')).toEqual(['Chart set — Semis', 'Chart set — Software', 'Manage chart sets'])
    expect(titles('se')).toEqual(['Chart set — Semis', 'Chart set — Software', 'Manage chart sets'])
    expect(titles('sets')).toEqual(['Manage chart sets'])
    expect(titles('set SEM')).toEqual(['Chart set — Semis'])
    expect(titles('set s')).toEqual(['Chart set — Semis', 'Chart set — Software'])
    // Prose after a near word, or a name that matches nothing, offers nothing (Enter stays a newline).
    expect(titles('set nothing here')).toEqual([])
    expect(titles('settle the trade')).toEqual([])
  })
})

/** For each snapshot kind: the settings its builder reads, beside the data its payload carries
 *  (the payload keys api/services/journal_two/notebook_widgets.py returns for that kind). */
const KIND_FIXTURES = {
  myWatchlistToday: { settings: { list: 'flagged' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'market', listLabel: 'Flagged', rows: [{ sym: 'NVDA', price: 181 }], truncated: 0 } },
  myNamesReporting: { settings: { list: 'watchlist' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'market', rows: [{ sym: 'NVDA', day: '2026-10-22' }], partial: false } },
  marketOnMyNames: { settings: { list: 'watchlist' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'market', sectorBasis: 'etf', rows: [{ sym: 'NVDA', vsSector: 2.1 }] } },
  tickerCard: { settings: { symbol: 'NVDA' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'mixed', price: 181.5, changePct: 1.2, earningsDay: '2026-11-19',
      impliedMovePct: 7.1, history: [{ id: 't1' }] } },
  tickerFlow: { settings: { symbol: 'AMD' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'market', bullPremium: 1e6, bearPremium: 5e5, window: '1D', topPrints: [{ p: 1 }] } },
  myPnlStats: { settings: { from: '2026-10-13', to: '2026-10-17' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'broker', range: { from: '2026-10-13', to: '2026-10-17' },
      netPnl: 1234, winRate: 0.6, avgR: 0.8, tradeCount: 10, equity: [['2026-10-13', 1]] } },
  myPositionsRisk: { settings: {},
    data: { asOf: '2026-10-20T14:00:00Z', source: 'broker', accountSize: 50000, accountSizeSource: 'member', rows: [{ sym: 'NVDA' }] } },
  myRulesCheck: { settings: { from: '2026-10-13' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'manual', range: { from: '2026-10-13', to: '2026-10-17' }, kept: 3, total: 4, rules: [{ id: 'r' }] } },
  myMistakes: { settings: { tradeId: 't_9', month: '2026-10' },
    data: { asOf: '2026-10-20T14:00:00Z', source: 'mixed', rows: [{ tag: 'fomo', cost: -120 }] } },
}

describe('presets store settings only', () => {
  it('a fixture exists for every snapshot kind (a new kind cannot skip this rail)', () => {
    expect(Object.keys(KIND_FIXTURES).sort()).toEqual(WIDGET_KINDS.map((k) => k.id).sort())
  })

  it.each(Object.entries(KIND_FIXTURES))('preset_strips_data_keys: %s', (kind, { settings, data }) => {
    // A stored snapshot's params: the frozen payload, the request keys it was made with, and share ON.
    const stored = { ...data, ...settings, share: true }
    const params = presetParams({ kind, params: stored })
    const expected = { ...settings, share: false }
    // The list setting survives through the payload's listLabel even when the request key is absent.
    if (data.listLabel && !settings.list) expected.list = data.listLabel.toLowerCase()
    expect(params).toEqual(expected)
    for (const k of Object.keys(params)) expect([...SETTINGS_KEYS, 'share']).toContain(k)
    // A default date range is data (the day it ran), never a setting.
    if (!settings.from) expect(params.from).toBeUndefined()
  })

  it('a preset inserts through the menu insert it is handed, with its settings', () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    const insert = vi.fn(() => 'the-command')
    const rows = presetRows('preset', { sets: [], presets: [PRESET] }, 'mine', insert)
    expect(rows).toEqual([expect.objectContaining({ title: 'Flagged only', group: 'mine', command: 'the-command' })])
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'myWatchlistToday' }), { list: 'flagged', share: false })
    // A preset of a kind whose wave is off is not offered (control: on above, off here).
    __resetNotebookFlags()
    expect(presetRows('preset', { sets: [], presets: [PRESET] }, 'mine', insert)).toEqual([])
  })

  it('savePreset keeps the stored sets and strips the data', async () => {
    global.fetch = prefsFetch(JSON.stringify({ v: 1, sets: [SEMIS], presets: [] }))
    const res = await savePreset({ name: ' Flagged only ', kind: 'myWatchlistToday',
      params: { ...KIND_FIXTURES.myWatchlistToday.data, list: 'flagged', share: true } })
    expect(res.ok).toBe(true)
    const value = JSON.parse(global.fetch.posts[0].value)
    expect(value.sets).toEqual([SEMIS])
    expect(value.presets).toEqual([expect.objectContaining({ name: 'Flagged only', kind: 'myWatchlistToday', params: { list: 'flagged', share: false } })])
  })
})
