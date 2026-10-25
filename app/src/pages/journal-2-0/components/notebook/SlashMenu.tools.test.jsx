/* global process */
// Notebook widgets phase 2, wave 9 (Task 9.19): the routine and tracker rows of the / menu, dark behind
// widgetsWaveOn(9): "Routine (remembered daily)" and "Tracker (one value a day)" open the tool picker (/routine,
// /track), and the Mine group lists the member's own routines then trackers after the widget rows (at most five each
// on a bare /, every match when typed), each inserting its block bound to the note's day. The list comes through
// lib/toolsCrud (the one routine and tracker client) in ONE background loader keyed to the member, reached only by a
// dynamic import, and a write through that client drops it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import {
  SlashList, menuItems, toolItems, __toolsLoad, __resetTools, __builtLoad, __resetBuilt, __resetMine, __resetPicks,
} from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { buildExtensions } from '../../lib/tiptap'
import { noteDayOf, toolSearchText } from '../../lib/blocks/toolDays'
import { __resetEditorDoor } from './routines/mountEditor'
import { __resetToolPicker } from './routines/openToolPicker'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const W8 = { notebook_widgets_w8_enabled: true }
const W9 = { notebook_widgets_w9_enabled: true }
// Every other wave, and the journal-styles switch, on (waves 8 and 9 off): the bare list a member sees.
const ALL_BUT_8_9 = {
  notebook_widgets_w1_enabled: true, notebook_widgets_w2_enabled: true, notebook_widgets_w3_enabled: true,
  notebook_widgets_w4_enabled: true, notebook_widgets_w5_enabled: true, notebook_widgets_w6_enabled: true,
  notebook_widgets_w10_enabled: true, notebook_journal_styles_enabled: true,
}

// The bare / list item for item (group|title), captured from the code at deb5a1a170 (before Task 9.19).
const BARE_ALL_OFF = [
  'plan|Chart', 'plan|MTF stack', 'plan|Before / after', 'plan|Price', 'plan|Analyst Consensus',
  'basics|Heading 1', 'basics|Heading 2', 'basics|Heading 3', 'basics|Bullet list', 'basics|Numbered list',
  'basics|Quote', 'basics|Divider', 'basics|Table', 'basics|Checklist', 'basics|Due date', 'basics|Reminder',
  'basics|Callout', 'basics|Toggle', 'basics|Image',
  'more|Heading 4', 'more|Heading 5', 'more|Heading 6', 'more|Code block', 'more|2 columns', 'more|3 columns',
  'more|Table of contents', 'more|Inline math', 'more|Math block', 'more|Emoji',
]
const OPEN_PLAN_REVIEW = [
  'open|My watchlist today', 'open|My names reporting', 'open|Market on my names', 'open|Room buzz on my names',
  'open|My earnings reactions',
  'plan|Ticker card', 'plan|Options flow on a ticker', 'plan|Chart', 'plan|MTF stack', 'plan|Before / after',
  'plan|Price', 'plan|Analyst Consensus', 'plan|Trade plan', 'plan|Journal style', 'plan|Pre-entry checklist',
  'plan|Price stamps', 'plan|Position sizing', 'plan|My rules', 'plan|Morning wire and exposure',
  'plan|Earnings for my names', 'plan|My movers', 'plan|Key levels from my plans', 'plan|Post-trade review',
  'plan|Market context',
  'review|My P&L and stats', 'review|My open positions and risk', 'review|My rules check',
  'review|My recurring mistakes', 'review|My P&L calendar', 'review|My setup edge',
]
const BASICS_MORE = [
  'basics|Heading 1', 'basics|Heading 2', 'basics|Heading 3', 'basics|Bullet list', 'basics|Numbered list',
  'basics|Quote', 'basics|Divider', 'basics|Table', 'basics|Checklist', 'basics|Due date', 'basics|Reminder',
  'basics|Callout', 'basics|Toggle', 'basics|Image',
  'more|UCT Terminal day', 'more|News and catalysts', 'more|Fundamentals', 'more|Breadth heatmap',
  'more|My price alerts', 'more|Watchlist snapshot', 'more|Theme rankings',
  'more|Heading 4', 'more|Heading 5', 'more|Heading 6', 'more|Code block', 'more|2 columns', 'more|3 columns',
  'more|Table of contents', 'more|Inline math', 'more|Math block', 'more|Emoji',
]
const BARE_ALL_BUT_8_9 = [...OPEN_PLAN_REVIEW, ...BASICS_MORE]
const BARE_W8_ON = [...OPEN_PLAN_REVIEW,
  'tools|Build a widget', 'tools|Net P&L by setup', 'tools|Win rate by hour', 'tools|Manage my tools', ...BASICS_MORE]

const ROUTINE_ITEM = 'Routine (remembered daily)'
const TRACKER_ITEM = 'Tracker (one value a day)'

const routine = (id, name, more = {}) => ({ id, name, archived: false, deleted: false, items: [], ...more })
const tracker = (id, name, more = {}) => ({ id, name, kind: 'number', unit: 'hours', archived: false, deleted: false, ...more })
const widget = (id, name) => ({ id, name, rev: 1, etag: 1, archived: false, usedIn: 0, summary: `${name}.` })

const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
/** The network, per member: routines, trackers, widgets, and the writes My tools and the editors make. */
function installNet({ routines = {}, trackers = {}, widgets = {} } = {}) {
  let uid = 'u1'
  const calls = []
  const store = { routines, trackers }
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const path = String(url).split('?')[0]
    calls.push({ url: String(url), path, method })
    if (path === '/api/j2/widget-definitions' && method === 'GET') return json(200, { widgets: widgets[uid] || [] })
    const m = /^\/api\/j2\/(routines|trackers)(?:\/([^/]+))?(?:\/([a-z-]+))?$/.exec(path)
    if (!m) return json(500, {})
    const [, kind, id, action] = m
    const list = store[kind][uid] || []
    if (!id && method === 'GET') return json(200, { [kind]: list })
    if (!id && method === 'POST') {
      const made = { ...(kind === 'routines' ? routine('r-new', 'Evening review') : tracker('t-new', 'Focus')), ...JSON.parse(init.body) }
      store[kind][uid] = [...list, made]
      return json(200, made)
    }
    if (action === 'archive' && method === 'POST') {
      store[kind][uid] = list.map((t) => (t.id === id ? { ...t, archived: true } : t)).filter((t) => !t.archived)
      return json(200, { id, archived: true })
    }
    if (action === 'unarchive' && method === 'POST') {
      const back = kind === 'routines' ? routine(id, 'Back again') : tracker(id, 'Back again')
      store[kind][uid] = [...list, back]
      return json(200, back)
    }
    if (action === 'duplicate' && method === 'POST') {
      const src = list.find((t) => t.id === id)
      const copy = { ...src, id: `${id}-copy`, name: `${src.name} copy` }
      store[kind][uid] = [...list, copy]
      return json(200, copy)
    }
    return json(500, {})
  })
  return { calls, as: (u) => { uid = u }, lists: () => calls.filter((c) => /^\/api\/j2\/(routines|trackers)$/.test(c.path) && c.method === 'GET') }
}
const member = (uid = 'u1', more = {}) => ({ storage: { uctJournalWidgets: { uid, ...more } } })
const titles = (items) => items.map((i) => i.title)
const asRows = (items) => items.map((i) => `${i.group}|${i.title}`)
const labelsOf = (items) => {
  const { container, unmount } = render(<SlashList items={items} command={() => {}} />)
  const out = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
  unmount()
  return out
}
const settle = async () => { await __builtLoad(); await __toolsLoad(); await new Promise((r) => setTimeout(r, 0)) }
/** The bare list through the menu's REAL items callback, after every background load it starts has landed. */
async function bareList(ed = member()) {
  menuItems('', ed)
  await settle()
  return menuItems('', ed)
}
const loaded = async (q, ed = member()) => { menuItems(q, ed); await settle(); return menuItems(q, ed) }

const realFetch = global.fetch
let editor
beforeEach(() => {
  __resetBuilt(); __resetMine(); __resetPicks(); __resetTools()
  __resetEditorDoor(); __resetToolPicker()
  window.localStorage.clear()
})
afterEach(() => {
  global.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy()
  editor = null
  cleanup()
  document.querySelectorAll('[data-tool-picker-root],[data-routine-editor-root],[data-tracker-editor-root]').forEach((n) => n.remove())
})

/** A real note editor holding `text`, its storage as NoteEditorPage writes it (`noteDay` a function of the note). */
function noteEditor(text, note) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: `<p>${text}</p>` })
  editor.storage.uctJournalWidgets = { ...editor.storage.uctJournalWidgets, uid: 'u1', noteDay: () => noteDayOf(note) }
  return editor
}
const embeds = (ed) => {
  const out = []
  ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') out.push(n) })
  return out
}

describe('the routine and tracker rows are dark while wave 9 is off', () => {
  it('routine_and_tracker_items_absent_when_w9_off_and_bare_list_unchanged', async () => {
    const net = installNet({ routines: { u1: [routine('r1', 'Pre-market routine')] }, trackers: { u1: [tracker('t1', 'Sleep')] },
      widgets: { u1: [widget('w1', 'Net P&L by setup'), widget('w2', 'Win rate by hour')] } })
    // All off, then every wave but 8 and 9, then wave 8 on as well: each is the list as it was, item for item.
    expect(asRows(await bareList())).toEqual(BARE_ALL_OFF)
    __resetNotebookFlags()
    latchNotebookFlags(ALL_BUT_8_9)
    expect(asRows(await bareList())).toEqual(BARE_ALL_BUT_8_9)
    __resetNotebookFlags()
    latchNotebookFlags({ ...ALL_BUT_8_9, ...W8 })
    expect(asRows(await bareList())).toEqual(BARE_W8_ON)
    for (const q of ['routine', 'track', 'sleep', 'pre', '']) {
      expect(toolItems(q, member())).toEqual([])
      expect(titles(menuItems(q, member()))).not.toEqual(expect.arrayContaining([ROUTINE_ITEM]))
      expect(titles(menuItems(q, member()))).not.toContain(TRACKER_ITEM)
    }
    // Off, the menu never asks for the member's routines or trackers.
    expect(net.lists()).toHaveLength(0)
    // CONTROL: the same callback answers the rows once wave 9 is on (so the off answers above are the gate's).
    __resetNotebookFlags()
    latchNotebookFlags({ ...ALL_BUT_8_9, ...W8, ...W9 })
    const on = titles(await bareList())
    expect(on).toEqual(expect.arrayContaining([ROUTINE_ITEM, TRACKER_ITEM, 'Pre-market routine', 'Sleep']))
    expect(net.lists().length).toBeGreaterThan(0)
  })
})

describe('the routine and tracker rows (wave 9 on)', () => {
  beforeEach(() => latchNotebookFlags({ ...W8, ...W9 }))

  it('the two items carry their words, and /routine and /track put them first', () => {
    installNet()
    const r = menuItems('routine', member())[0]
    expect(r).toMatchObject({ title: ROUTINE_ITEM, description: 'Tick it every trading day; it never changes the note',
      keywords: ['routine', 'habit', 'daily', 'pre-market', 'rules', 'process'] })
    const t = menuItems('track', member())[0]
    expect(t).toMatchObject({ title: TRACKER_ITEM, description: 'Log sleep, focus or anything once a day',
      keywords: ['track', 'tracker', 'sleep', 'mood', 'log', 'habit'] })
    expect(menuItems('rout', member())[0].title).toBe(ROUTINE_ITEM)
    expect(menuItems('tracker', member())[0].title).toBe(TRACKER_ITEM)
  })

  it('slash_routine_opens_picker_and_inserts_bound_to_note_day', async () => {
    installNet({ routines: { u1: [routine('r1', 'Pre-market routine'), routine('r9', 'Gone', { archived: true })] },
      trackers: { u1: [tracker('t1', 'Sleep')] } })
    // A daily note for Tue Oct 27: /routine opens the picker, and the routine picked is bound to the note's day.
    const ed = noteEditor('/routine', { id: 'n1', dailyDate: '2026-10-27', createdAt: '2026-10-29T15:00:00Z' })
    const [row] = menuItems('routine', ed)
    expect(row.title).toBe(ROUTINE_ITEM)
    await act(async () => { await row.command({ editor: ed, range: { from: 1, to: 1 + '/routine'.length } }) })
    expect(ed.getText()).not.toContain('/routine')
    const pick = await screen.findByRole('button', { name: 'Pre-market routine' })
    expect(screen.queryByRole('button', { name: 'Gone' })).toBeNull()                    // archived is left out
    expect(screen.getByRole('button', { name: 'New routine' })).toBeTruthy()
    await act(async () => { fireEvent.click(pick) })
    let placed = embeds(ed)
    expect(placed).toHaveLength(1)
    expect(placed[0].attrs.widgetId).toBe('routine')
    expect(placed[0].attrs.params).toEqual({ routineId: 'r1', day: '2026-10-27', bind: 'note-day', display: 'items' })
    await waitFor(() => expect(document.querySelector('[data-tool-picker-root]')).toBeNull())

    // A note with no daily date, created at 03:30Z on the 28th: in New York that is still the 27th.
    editor.destroy()
    const ed2 = noteEditor('/track', { id: 'n2', dailyDate: null, createdAt: '2026-10-28T03:30:00Z' })
    const [trow] = menuItems('track', ed2)
    expect(trow.title).toBe(TRACKER_ITEM)
    await act(async () => { await trow.command({ editor: ed2, range: { from: 1, to: 1 + '/track'.length } }) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Sleep' })) })
    placed = embeds(ed2)
    expect(placed).toHaveLength(1)
    expect(placed[0].attrs.widgetId).toBe('tracker')
    expect(placed[0].attrs.params).toEqual({ trackerId: 't1', day: '2026-10-27', bind: 'note-day', display: 'chart' })
  })

  it('search_text_static_name_and_day', async () => {
    installNet({ routines: { u1: [routine('r1', 'Pre-market routine')] }, trackers: { u1: [tracker('t1', 'Sleep')] } })
    const ed = noteEditor('/pre', { id: 'n1', dailyDate: '2026-10-27' })
    const rows = await loaded('pre', ed)
    const row = rows.find((r) => r.title === 'Pre-market routine')
    expect(row, 'non-vacuity: the routine row is offered').toBeTruthy()
    await row.command({ editor: ed, range: { from: 1, to: 1 + '/pre'.length } })
    const [node] = embeds(ed)
    // The name and the day, written at insert as plain text (the line a note's search reads).
    expect(node.attrs.searchText).toBe('[routine: Pre-market routine · For Tue Oct 27]')
    expect(node.attrs.searchText).toBe(toolSearchText('routine', 'Pre-market routine', '2026-10-27', 'note-day'))
    expect(ed.getHTML()).toContain('[routine: Pre-market routine · For Tue Oct 27]')
    expect(node.attrs.params).toEqual({ routineId: 'r1', day: '2026-10-27', bind: 'note-day', display: 'items' })
    expect(ed.getText()).not.toContain('/pre')
    // A tracker row likewise.
    editor.destroy()
    const ed2 = noteEditor('/sleep', { id: 'n2', dailyDate: '2026-10-27' })
    const [t] = await loaded('sleep', ed2)
    expect(t.title).toBe('Sleep')                      // a name match above the tracker item's keyword match
    await t.command({ editor: ed2, range: { from: 1, to: 1 + '/sleep'.length } })
    expect(embeds(ed2)[0].attrs.searchText).toBe('[tracker: Sleep · For Tue Oct 27]')
  })

  it('mine_rows_after_widgets_five_each_bare', async () => {
    const seven = (make, prefix, word) => Array.from({ length: 7 }, (_, i) => make(`${prefix}${i}`, `${word} ${i + 1}`))
    installNet({
      // An archived one FIRST, so leaving it out is what keeps the five (never the cap hiding it).
      routines: { u1: [routine('rx', 'Archived routine', { archived: true }), ...seven(routine, 'r', 'Morning')] },
      trackers: { u1: [tracker('tx', 'Archived tracker', { archived: true }), ...seven(tracker, 't', 'Sleep')] },
      widgets: { u1: [widget('w1', 'Net P&L by setup'), widget('w2', 'Win rate by hour')] },
    })
    // Before anything has loaded, the doors are there already (a list never holds the menu).
    expect(titles(menuItems('', member()).filter((i) => i.group === 'tools')))
      .toEqual(['Build a widget', ROUTINE_ITEM, TRACKER_ITEM, 'Manage my tools'])
    const items = await bareList()
    expect(titles(items.filter((i) => i.group === 'tools'))).toEqual([
      'Build a widget', 'Net P&L by setup', 'Win rate by hour',
      ROUTINE_ITEM, 'Morning 1', 'Morning 2', 'Morning 3', 'Morning 4', 'Morning 5',
      TRACKER_ITEM, 'Sleep 1', 'Sleep 2', 'Sleep 3', 'Sleep 4', 'Sleep 5',
      'Manage my tools',
    ])
    // One Mine group, never interleaved with another.
    const groups = items.map((i) => i.group).filter((g, i, a) => g !== a[i - 1])
    expect(groups.filter((g) => g === 'tools')).toHaveLength(1)
    expect(labelsOf(items)).toContain('Mine')
    // A routine row inserts its block at once (no picker), bound to the note's day.
    const ed = noteEditor('/', { id: 'n1', dailyDate: '2026-10-27' })
    const row = (await bareList(ed)).find((i) => i.title === 'Morning 1')
    await row.command({ editor: ed, range: { from: 1, to: 2 } })
    expect(embeds(ed)[0].attrs.params).toEqual({ routineId: 'r0', day: '2026-10-27', bind: 'note-day', display: 'items' })
    expect(document.querySelector('[data-tool-picker-root]')).toBeNull()
    // Wave 8 off: the routines and trackers are still Mine, without the widget doors.
    __resetNotebookFlags()
    latchNotebookFlags(W9)
    expect(titles((await bareList()).filter((i) => i.group === 'tools'))).toEqual([
      ROUTINE_ITEM, 'Morning 1', 'Morning 2', 'Morning 3', 'Morning 4', 'Morning 5',
      TRACKER_ITEM, 'Sleep 1', 'Sleep 2', 'Sleep 3', 'Sleep 4', 'Sleep 5',
    ])
  })

  it('typed_query_lists_every_match', async () => {
    const seven = (make, prefix, word) => Array.from({ length: 7 }, (_, i) => make(`${prefix}${i}`, `${word} ${i + 1}`))
    installNet({ routines: { u1: seven(routine, 'r', 'Morning') }, trackers: { u1: seven(tracker, 't', 'Sleep') } })
    const r = titles(await loaded('routine'))
    expect(r[0]).toBe(ROUTINE_ITEM)
    expect(r).toEqual(expect.arrayContaining(Array.from({ length: 7 }, (_, i) => `Morning ${i + 1}`)))
    expect(r).not.toContain('Sleep 1')
    const t = titles(menuItems('track', member()))
    expect(t[0]).toBe(TRACKER_ITEM)
    expect(t).toEqual(expect.arrayContaining(Array.from({ length: 7 }, (_, i) => `Sleep ${i + 1}`)))
    expect(t).not.toContain('Morning 1')
    expect(toolItems('morning', member()).map((i) => i.title)).toHaveLength(7)
    expect(titles(toolItems('morning 7', member()))).toEqual(['Morning 7'])
    expect(toolItems('morning nope', member())).toEqual([])
  })

  it('a write through the routine and tracker client drops the rows; a read drops nothing', async () => {
    const net = installNet({ routines: { u1: [routine('r1', 'Pre-market routine'), routine('r2', 'Rules I keep')] } })
    expect(titles(await loaded(''))).toContain('Rules I keep')
    const crud = await import('../../lib/toolsCrud')
    expect((await crud.archiveTool('routine', 'r2')).ok).toBe(true)
    let after = titles(await loaded(''))
    expect(after).not.toContain('Rules I keep')
    expect(after).toContain('Pre-market routine')                       // control: the list did load again
    expect((await crud.createTool('routine', { name: 'Evening review', items: [] })).ok).toBe(true)
    after = titles(await loaded(''))
    expect(after).toContain('Evening review')
    expect((await crud.duplicateTool('routine', 'r1')).ok).toBe(true)
    expect(titles(await loaded(''))).toContain('Pre-market routine copy')
    expect((await crud.unarchiveTool('routine', 'r2')).ok).toBe(true)
    expect(titles(await loaded(''))).toContain('Back again')
    // A READ changes nothing and drops nothing: no second list read.
    const n = net.lists().length
    await crud.listTools('routine')
    await crud.getTool('routine', 'r1')
    await loaded('')
    expect(net.lists().length).toBe(n + 1)                              // only the read made above
  })

  it('m-3: one of the two reads failing caches no empty list; the next / after the back-off reads again', async () => {
    const net = installNet({ routines: { u1: [routine('r1', 'Pre-market routine')] }, trackers: { u1: [tracker('t1', 'Sleep')] } })
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      expect(titles(await loaded(''))).toEqual(expect.arrayContaining(['Pre-market routine', 'Sleep']))
      // A minute on, the routines read fails (a 429) while the trackers read succeeds.
      now += 61_000
      const real = global.fetch
      global.fetch = vi.fn((url, init) => (String(url).startsWith('/api/j2/routines?')
        ? Promise.resolve(json(429, { detail: { code: 'rate', message: 'Too many.' } })) : real(url, init)))
      const during = titles(await loaded(''))
      expect(during).toContain('Pre-market routine')                    // the last good rows stay; never an empty list
      expect(during).toContain('Sleep')
      // From nothing, a half-failed read caches nothing either: the doors only, no empty kind.
      __resetTools()
      const fresh = titles(await loaded(''))
      expect(fresh).not.toContain('Sleep')                              // the good half is not cached alone
      expect(fresh).toEqual(expect.arrayContaining([ROUTINE_ITEM, TRACKER_ITEM]))
      // The routines answer again; after the 30 s back-off the next / reads both again.
      global.fetch = real
      now += 31_000
      const reads = net.lists().length
      const after = titles(await loaded(''))
      expect(after).toEqual(expect.arrayContaining(['Pre-market routine', 'Sleep']))
      expect(net.lists().length).toBe(reads + 2)
    } finally {
      clock.mockRestore()
    }
  })

  it('W9-R49: a block restore through toolsApi.unarchive drops Mine, which re-reads exactly once', async () => {
    const net = installNet({ routines: { u1: [routine('r1', 'Pre-market routine')] } })
    expect(titles(await loaded(''))).not.toContain('Back again')
    const routineReads = () => net.lists().filter((c) => c.path === '/api/j2/routines').length
    const before = routineReads()
    // The block's own Restore (RoutineBlock): toolsApi directly, never toolsCrud.
    const { unarchive } = await import('../../lib/blocks/toolsApi')
    expect((await unarchive('routine', 'r9')).ok).toBe(true)
    const shown = titles(await loaded(''))
    expect(shown).toContain('Back again')                               // at once, never after the 60 s expiry
    for (const q of ['', 'b', 'ba']) menuItems(q, member())
    await settle()
    expect(routineReads()).toBe(before + 1)                             // exactly one re-read for one write
  })

  it('the loader is keyed to the member', async () => {
    const net = installNet({ routines: { A: [routine('a1', 'A routine')], B: [routine('b1', 'B routine')] } })
    net.as('A')
    menuItems('', member('A'))
    await settle()
    expect(titles(menuItems('', member('A')))).toContain('A routine')
    net.as('B')
    const shown = titles(await loaded('', member('B')))
    expect(shown).toContain('B routine')
    expect(shown).not.toContain('A routine')
    // ONE pair of reads per member across keystrokes.
    const n = net.lists().length
    for (const q of ['b', 'b r', 'b ro']) menuItems(q, member('B'))
    await settle()
    expect(net.lists().length).toBe(n)
  })
})

// ⛔ First-open bytes: the routine and tracker client and the picker are reached only by dynamic import().
describe('lazy doors (wave 9)', () => {
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
  it('SlashMenu and NoteEditorPage reach toolsCrud and routines/ only dynamically', () => {
    const LAZY = /toolsCrud|routines\//
    const slash = imports('components/notebook/SlashMenu.jsx')
    const page = imports('components/notebook/NoteEditorPage.jsx')
    expect(slash.statics.filter((s) => LAZY.test(s))).toEqual([])
    expect(page.statics.filter((s) => LAZY.test(s))).toEqual([])
    // Non-vacuity: the doors ARE there, as dynamic imports.
    expect(slash.dynamics).toEqual(expect.arrayContaining(['../../lib/toolsCrud', './routines/openToolPicker.js']))
  })
})
