/* global process */
// Notebook widgets phase 2 (wave 8, Task 8.18): the "Mine" group in the / menu ("Build a widget", the member's own
// widgets, "Manage my tools"), the direct commands /build and /widgets, all dark behind widgetsWaveOn(8).
// builtItems is SYNCHRONOUS like mineItems: it answers what is loaded and starts ONE background load, keyed to the
// signed-in member, through lib/builtWidgets (the one widget HTTP client), loaded only by a dynamic import.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import {
  SLASH_GROUPS, SlashList, menuItems, builtItems, __builtLoad, __resetBuilt, __resetMine, __resetPicks,
} from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { buildExtensions } from '../../lib/tiptap'
import { FAILURE_COPY } from '../../lib/builtWidgets'
import { writeDraft, DRAFT_TTL_MS, RESUME_OFFER } from './widgetBuilder/builderDraft'
import { openWidgetBuilder } from './widgetBuilder/openWidgetBuilder.js'
import { openMyTools } from './myTools/openMyTools.js'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// The doors are their own rails (galleryDoor.test.jsx, MyToolsSheet tests): here only WHAT each row asks of them.
vi.mock('./widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('./myTools/openMyTools.js', () => ({ openMyTools: vi.fn(() => () => {}) }))

const W8 = { notebook_widgets_w8_enabled: true }
// Every other wave, and the journal-styles switch, on: the bare list a member sees with everything but wave 8.
// (Wave 9 stays off: its own lane adds its rows.)
const ALL_BUT_8 = {
  notebook_widgets_w1_enabled: true, notebook_widgets_w2_enabled: true, notebook_widgets_w3_enabled: true,
  notebook_widgets_w4_enabled: true, notebook_widgets_w5_enabled: true, notebook_widgets_w6_enabled: true,
  notebook_widgets_w10_enabled: true, notebook_journal_styles_enabled: true,
}
const widget = (id, name, more = {}) => ({ id, name, rev: 1, etag: 1, archived: false, usedIn: 0, summary: `${name}.`, ...more })
const LIST = [widget('w1', 'Net P&L by setup'), widget('w2', 'Win rate by hour'), widget('w9', 'Old one', { archived: true })]
const PAYLOAD = (defId) => ({
  asOf: '2026-10-24T14:00:00Z', defId, defRev: 1, title: 'Net P&L by setup', view: 'number',
  def: { v: 1, source: 'closed_trades', range: { token: 'last_90d' }, measures: [{ key: 'net_pnl' }] },
  rows: [{ value: 1234 }],
})

const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
/** The network: the member's widget list (per member), `/run`, and nothing else (every other read fails quietly). */
function installNet({ lists = { u1: LIST }, run = (body) => json(200, PAYLOAD(body.defId)) } = {}) {
  let uid = 'u1'
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} })
    if (url === '/api/j2/widget-definitions' && method === 'GET') return json(200, { widgets: lists[uid] || [] })
    if (url === '/api/j2/widget-definitions/run' && method === 'POST') return run(JSON.parse(init.body))
    return json(500, {})
  })
  return { calls, as: (u) => { uid = u } }
}
const member = (uid = 'u1', notify) => ({ storage: { uctJournalWidgets: { uid, notify } } })
const loaded = async (q, ed = member()) => { builtItems(q, ed); await __builtLoad(); return builtItems(q, ed) }
const titles = (items) => items.map((i) => i.title)
const labelsOf = (items) => {
  const { container, unmount } = render(<SlashList items={items} command={() => {}} />)
  const out = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
  unmount()
  return out
}

const realFetch = global.fetch
let editor
beforeEach(() => {
  __resetBuilt(); __resetMine(); __resetPicks()
  window.localStorage.clear()
  vi.mocked(openWidgetBuilder).mockClear()
  vi.mocked(openMyTools).mockClear()
})
afterEach(() => {
  global.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy()
  editor = null
  cleanup()
})

// The bare / list as it was before Task 8.18, item for item (group|title), captured from the code at 35e5014fce.
const BARE_ALL_OFF = [
  'plan|Chart', 'plan|MTF stack', 'plan|Before / after', 'plan|Price', 'plan|Analyst Consensus',
  'basics|Heading 1', 'basics|Heading 2', 'basics|Heading 3', 'basics|Bullet list', 'basics|Numbered list',
  'basics|Quote', 'basics|Divider', 'basics|Table', 'basics|Checklist', 'basics|Due date', 'basics|Reminder',
  'basics|Callout', 'basics|Toggle', 'basics|Image',
  'more|Heading 4', 'more|Heading 5', 'more|Heading 6', 'more|Code block', 'more|2 columns', 'more|3 columns',
  'more|Table of contents', 'more|Inline math', 'more|Math block', 'more|Emoji',
]
const BARE_ALL_BUT_8 = [
  'open|My watchlist today', 'open|My names reporting', 'open|Market on my names', 'open|Room buzz on my names',
  'open|My earnings reactions',
  'plan|Ticker card', 'plan|Options flow on a ticker', 'plan|Chart', 'plan|MTF stack', 'plan|Before / after',
  'plan|Price', 'plan|Analyst Consensus', 'plan|Trade plan', 'plan|Journal style', 'plan|Pre-entry checklist',
  'plan|Price stamps', 'plan|Position sizing', 'plan|My rules', 'plan|Morning wire and exposure',
  'plan|Earnings for my names', 'plan|My movers', 'plan|Key levels from my plans', 'plan|Post-trade review',
  'plan|Market context',
  'review|My P&L and stats', 'review|My open positions and risk', 'review|My rules check',
  'review|My recurring mistakes', 'review|My P&L calendar', 'review|My setup edge',
  'basics|Heading 1', 'basics|Heading 2', 'basics|Heading 3', 'basics|Bullet list', 'basics|Numbered list',
  'basics|Quote', 'basics|Divider', 'basics|Table', 'basics|Checklist', 'basics|Due date', 'basics|Reminder',
  'basics|Callout', 'basics|Toggle', 'basics|Image',
  'more|UCT Terminal day', 'more|News and catalysts', 'more|Fundamentals', 'more|Breadth heatmap',
  'more|My price alerts', 'more|Watchlist snapshot', 'more|Theme rankings',
  'more|Heading 4', 'more|Heading 5', 'more|Heading 6', 'more|Code block', 'more|2 columns', 'more|3 columns',
  'more|Table of contents', 'more|Inline math', 'more|Math block', 'more|Emoji',
]

/** The bare list through the menu's REAL items callback, after every background load it starts has landed. */
async function bareList(ed = member()) {
  menuItems('', ed)
  await __builtLoad()
  await new Promise((r) => setTimeout(r, 0))
  return menuItems('', ed)
}
const asRows = (items) => items.map((i) => `${i.group}|${i.title}`)

describe('the Mine group is dark while wave 8 is off', () => {
  it('mine_group_absent_when_w8_off_and_bare_list_unchanged', async () => {
    const net = installNet()
    expect(asRows(await bareList())).toEqual(BARE_ALL_OFF)
    __resetNotebookFlags()
    latchNotebookFlags(ALL_BUT_8)
    const items = await bareList()
    expect(asRows(items)).toEqual(BARE_ALL_BUT_8)
    expect(labelsOf(items)).not.toContain('Mine')
    for (const q of ['build', 'widgets', 'tools', 'net', '']) expect(builtItems(q, member())).toEqual([])
    // Off, the menu never asks for the member's widgets.
    expect(net.calls.some((c) => c.url.startsWith('/api/j2/widget-definitions'))).toBe(false)
    // CONTROL: the same callback answers the Mine rows once wave 8 is on (so the off answer above is the gate's).
    __resetNotebookFlags()
    latchNotebookFlags({ ...ALL_BUT_8, ...W8 })
    expect(labelsOf(await bareList())).toContain('Mine')
  })
})

describe('the Mine group (wave 8 on)', () => {
  beforeEach(() => latchNotebookFlags(W8))

  it('my_presets_keeps_label', () => {
    expect(SLASH_GROUPS.find((g) => g.id === 'mine')).toEqual({ id: 'mine', label: 'My presets' })
    expect(SLASH_GROUPS.find((g) => g.id === 'tools')).toEqual({ id: 'tools', label: 'Mine' })
    const ids = SLASH_GROUPS.map((g) => g.id)
    expect(ids.indexOf('tools')).toBe(ids.indexOf('mine') - 1)
  })

  it('mine_group_order_build_first_manage_last', async () => {
    installNet()
    const items = await bareList()
    expect(items.filter((i) => i.group === 'tools').map((i) => i.title))
      .toEqual(['Build a widget', 'Net P&L by setup', 'Win rate by hour', 'Manage my tools'])   // archived left out
    const labels = labelsOf(items)
    expect(labels).toContain('Mine')
    expect(labels.indexOf('Mine')).toBeLessThan(labels.indexOf('Basics'))
    // Before the list has loaded, the two doors are there already (the list never holds the menu).
    __resetBuilt()
    expect(titles(builtItems('', member()))).toEqual(['Build a widget', 'Manage my tools'])
  })

  it('five_rows_bare_all_when_typed', async () => {
    const many = Array.from({ length: 7 }, (_, i) => widget(`w${i}`, `Setup edge ${i + 1}`))
    installNet({ lists: { u1: many } })
    const bare = (await loaded('')).filter((i) => i.defId)
    expect(bare).toHaveLength(5)
    expect(titles(bare)).toEqual(['Setup edge 1', 'Setup edge 2', 'Setup edge 3', 'Setup edge 4', 'Setup edge 5'])
    expect(builtItems('setup', member()).filter((i) => i.defId)).toHaveLength(7)
    expect(titles(builtItems('edge 7', member()))).toEqual(['Setup edge 7'])
    expect(builtItems('setup nope', member())).toEqual([])
  })

  it('loader_keyed_to_member', async () => {
    const net = installNet({ lists: { A: [widget('a1', 'A widget')], B: [widget('b1', 'B widget')] } })
    const A = member('A')
    const B = member('B')
    let answerA
    const real = global.fetch
    global.fetch = vi.fn((url, init) => (url === '/api/j2/widget-definitions' && global.fetch.mock.calls.length === 1
      ? new Promise((r) => { answerA = r })
      : real(url, init)))
    builtItems('', A)                      // A's read starts and is still in flight...
    net.as('B')
    builtItems('', B)                      // ...when B signs in on the same tab
    await __builtLoad()
    answerA(json(200, { widgets: [widget('a1', 'A widget')] }))
    await new Promise((r) => setTimeout(r, 0))
    const shown = titles(builtItems('', B))
    expect(global.fetch).toHaveBeenCalledTimes(2)        // non-vacuity: both reads ran, and A's did land
    expect(shown).toContain('B widget')
    expect(shown).not.toContain('A widget')
    // ONE read per member for every keystroke: the one client's GET of the list, nothing else.
    for (const q of ['b', 'b w', 'b wi']) builtItems(q, B)
    await __builtLoad()
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(net.calls.every((c) => c.url === '/api/j2/widget-definitions' && c.method === 'GET')).toBe(true)
  })

  it('widget_row_inserts_frozen_built_widget', async () => {
    const net = installNet()
    const notify = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/net</p>' })
    editor.storage.uctJournalWidgets = { ...editor.storage.uctJournalWidgets, uid: 'u1', notify }
    const [row] = await loaded('net', editor)
    expect(row.title).toBe('Net P&L by setup')
    await row.command({ editor, range: { from: 1, to: 1 + '/net'.length } })
    const run = net.calls.find((c) => c.url.endsWith('/run'))
    expect(run).toMatchObject({ method: 'POST', body: { defId: 'w1', settings: {} } })
    const embeds = []
    editor.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') embeds.push(n) })
    expect(embeds).toHaveLength(1)
    expect(embeds[0].attrs.widgetId).toBe('builtWidget')
    expect(embeds[0].attrs.params).toMatchObject({ defId: 'w1', asOf: '2026-10-24T14:00:00Z' })
    expect(embeds[0].attrs.params.def).toMatchObject({ source: 'closed_trades' })     // the frozen copy
    expect(editor.getText()).not.toContain('/net')
    expect(notify.mock.calls).toEqual([['Adding Net P&L by setup…', 'busy'], ['Net P&L by setup added.', 'info']])
  })

  it('failed_run_inserts_nothing_and_says_why', async () => {
    for (const [status, body, sentence] of [
      [503, { detail: { code: 'busy', message: 'x' } }, FAILURE_COPY.busy],
      [402, {}, FAILURE_COPY.paid],
      [429, { detail: { code: 'daily_cap', message: 'x' } }, FAILURE_COPY.daily_cap],
    ]) {
      __resetBuilt()
      installNet({ run: () => json(status, body) })
      const notify = vi.fn()
      const el = document.createElement('div')
      document.body.appendChild(el)
      editor?.destroy()
      editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/win</p>' })
      editor.storage.uctJournalWidgets = { ...editor.storage.uctJournalWidgets, uid: 'u1', notify }
      const [row] = await loaded('win', editor)
      await row.command({ editor, range: { from: 1, to: 1 + '/win'.length } })
      let n = 0
      editor.state.doc.descendants((x) => { if (x.type.name === 'widgetEmbed') n += 1 })
      expect(n).toBe(0)
      expect(notify).toHaveBeenLastCalledWith(sentence, 'error')
    }
    // Offline: no request is made, and it is said as the insert's own offline sentence (never the preview's words).
    __resetBuilt()
    const net = installNet()
    const notify = vi.fn()
    editor.storage.uctJournalWidgets = { ...editor.storage.uctJournalWidgets, notify }
    const [row] = await loaded('win', editor)
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await row.command({ editor, range: { from: 1, to: 1 } })
    } finally { online.mockRestore() }
    expect(net.calls.some((c) => c.url.endsWith('/run'))).toBe(false)
    expect(notify).toHaveBeenLastCalledWith("You're offline, so Win rate by hour was not added.", 'error')
  })

  it('build_and_widgets_commands', async () => {
    installNet()
    const ed = { ...member('u1'), chain: () => ({ focus: () => ({ deleteRange: () => ({ run: () => true }) }) }) }
    // /build: its row comes first, and opens the builder on "Start from an example" (where a kept draft is offered).
    const build = menuItems('build', ed)
    expect(build[0]).toMatchObject({ title: 'Build a widget', cmd: 'build' })
    await build[0].command({ editor: ed, range: { from: 1, to: 7 } })
    expect(openWidgetBuilder).toHaveBeenLastCalledWith({ editor: ed, start: 'examples' })
    // /widgets: the examples gallery.
    const gallery = menuItems('widgets', ed)
    expect(gallery[0]).toMatchObject({ cmd: 'widgets' })
    await gallery[0].command({ editor: ed, range: { from: 1, to: 9 } })
    expect(openWidgetBuilder).toHaveBeenCalledTimes(2)
    expect(openWidgetBuilder).toHaveBeenLastCalledWith({ editor: ed, start: 'examples' })
    // "Manage my tools" opens My tools on its Widgets tab.
    const tools = menuItems('tools', ed)
    expect(tools[0]).toMatchObject({ title: 'Manage my tools', cmd: 'tools' })
    await tools[0].command({ editor: ed, range: { from: 1, to: 7 } })
    expect(openMyTools).toHaveBeenLastCalledWith({ editor: ed, tab: 'widgets' })

    // A kept draft of a NEW widget under 24 h old: the row says "Resume your unsaved widget" (the builder's own reader).
    await __builtLoad()
    const now = Date.now()
    writeDraft('u1', { plan: { v: 1 }, nameTouched: false, target: null }, now - 60_000)
    expect(builtItems('build', ed)[0].description).toBe(RESUME_OFFER)
    // ...not one over 24 h old, and not a draft kept for a saved widget (R-42: offered from its own Edit door only).
    writeDraft('u1', { plan: { v: 1 }, nameTouched: false, target: null }, now - DRAFT_TTL_MS - 60_000)
    expect(builtItems('build', ed)[0].description).not.toBe(RESUME_OFFER)
    writeDraft('u1', { plan: { v: 1 }, nameTouched: false, target: 'w1' }, now - 60_000)
    expect(builtItems('build', ed)[0].description).not.toBe(RESUME_OFFER)
    // ...and never another member's.
    writeDraft('u2', { plan: { v: 1 }, nameTouched: false, target: null }, now - 60_000)
    expect(builtItems('build', ed)[0].description).not.toBe(RESUME_OFFER)
  })

  it('a typed query ranks a name match above a keyword match', async () => {
    installNet({ lists: { u1: [widget('w1', 'Tools P&L'), widget('w2', 'Hold time')] } })
    const typed = await loaded('tools')
    expect(titles(typed)).toEqual(['Tools P&L', 'Manage my tools'])
    // "widget" names the gallery and the build row; the member's widgets answer to it as a keyword, after them.
    const w = titles(builtItems('widget', member()))
    expect(w.slice(0, 2)).toEqual(['Widget examples', 'Build a widget'])
    expect(w).toEqual(expect.arrayContaining(['Tools P&L', 'Hold time']))
  })
})

// ⛔ First-open bytes: the widget client, the builder and My tools are reached only by dynamic import().
describe('lazy doors', () => {
  const SRC = join(process.cwd(), 'src', 'pages', 'journal-2-0')
  const P = Parser.extend(jsx())
  const imports = (file) => {
    const ast = P.parse(readFileSync(join(SRC, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
    const statics = ast.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value)
    const dynamics = []
    const walk = (n) => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'ImportExpression' && n.source.type === 'Literal') dynamics.push(n.source.value)
      for (const k of Object.keys(n)) {
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v.type === 'string') walk(v)
      }
    }
    walk(ast)
    return { statics, dynamics }
  }
  const LAZY = /builtWidgets|widgetBuilder\/|myTools\//
  it('SlashMenu and NotebookTab import the widget client, the builder and My tools only dynamically', () => {
    const slash = imports('components/notebook/SlashMenu.jsx')
    const tab = imports('tabs/NotebookTab.jsx')
    expect(slash.statics.filter((s) => LAZY.test(s))).toEqual([])
    expect(tab.statics.filter((s) => LAZY.test(s))).toEqual([])
    // Non-vacuity: the doors ARE there, as dynamic imports.
    expect(slash.dynamics).toEqual(expect.arrayContaining(['../../lib/builtWidgets', './widgetBuilder/openWidgetBuilder.js',
      './myTools/openMyTools.js']))
    expect(tab.dynamics).toContain('../components/notebook/myTools/openMyTools.js')
  })
})
