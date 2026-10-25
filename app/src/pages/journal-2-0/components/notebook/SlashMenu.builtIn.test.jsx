// Notebook widgets wave 10 (Task 10.21, spec section 8): the ready-made widgets in the / menu, dark behind wave 10.
// A bare `/` lists at most eight under "Widgets" (the member's most used, then the defaults, in spec order), then
// "All widgets…"; typed, every shelf and dedicated card is searched with the menu's blocks, a name match above a
// keyword match. The synonyms are the shelf's (read from its revision files) and WIDGET_KINDS'; none is typed here
// except as the query a member would type.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, cleanup } from '@testing-library/react'
import {
  SlashList, menuItems, builtInItems, __builtInLoad, __resetBuiltIn, __builtLoad, __resetBuilt, __resetMine,
  __resetPicks, __picksLoad, __resetTools, __toolsLoad,
} from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { buildExtensions } from '../../lib/tiptap'
import { __resetBuiltCaches, MARK_EXAMPLE, MARK_YOURS } from '../../lib/builtWidgets'
import { __resetDedicatedQueue } from '../../lib/dedicatedWidgets'
import { WIDGET_KINDS } from '../../lib/notebookWidgets'
import { recordUse, DEFAULTS, BARE_MAX, ALL_WIDGETS } from '../../lib/builtInWidgets'
import { wave10Shelf } from './widgetBuilder/__fixtures__/shelfExamples'
import { openWidgetBuilder } from './widgetBuilder/openWidgetBuilder.js'

// The builder's door is its own rail (galleryDoor.test.jsx): here only WHAT "All widgets…" asks of it.
vi.mock('./widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// Every wave this menu reads, and the journal-styles switch, on.
const ALL_ON = {
  notebook_widgets_w1_enabled: true, notebook_widgets_w2_enabled: true, notebook_widgets_w3_enabled: true,
  notebook_widgets_w4_enabled: true, notebook_widgets_w5_enabled: true, notebook_widgets_w6_enabled: true,
  notebook_widgets_w8_enabled: true, notebook_widgets_w9_enabled: true, notebook_widgets_w10_enabled: true,
  notebook_journal_styles_enabled: true,
}
const SHELF = wave10Shelf()      // the server's revision files, newest revision of each id
const revOf = (id) => SHELF.find((e) => e.id === id).rev
// The dedicated kinds as /shelf serves them while wave 10 is on. One served word that WIDGET_KINDS does not have
// proves the shelf's own keywords are searched too.
const SERVED_WORD = 'zz served synonym'
const DEDICATED = WIDGET_KINDS.filter((k) => k.dedicated === 1).map((k) => ({
  kind: k.id, name: k.title, description: k.description, keywords: k.id === 'myTiltCheck' ? [SERVED_WORD] : [],
}))
const TRADES = [
  { id: 't1', symbol: 'nvda', side: 'Long', exitDate: '2026-10-14' },
  { id: 't2', symbol: 'amd', side: 'Short', exitDate: '2026-10-15' },
]

const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const payloadFor = (over) => ({ asOf: '2026-10-24T14:00:00Z', title: 'x', view: 'number', rows: [], ...over })
function installNet({ shelf = () => json(200, { examples: SHELF, dedicated: DEDICATED }) } = {}) {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = String(url)
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null })
    if (u === '/api/j2/widget-definitions/shelf' && method === 'GET') return shelf()
    if (u === '/api/j2/widget-definitions/run' && method === 'POST') {
      const b = JSON.parse(init.body)
      return json(200, payloadFor({ defId: b.defId, defRev: b.defRev, def: { v: 1, source: 'closed_trades' } }))
    }
    const ded = /^\/api\/j2\/notebook-shelf-widgets\/([A-Za-z]+)$/.exec(u)
    if (ded && method === 'POST') return json(200, payloadFor({ lines: ['Room left today.'] }))
    if (u.startsWith('/api/j2/trades') && method === 'GET') return json(200, { trades: TRADES })
    return json(500, {})
  })
  return calls
}
const member = (uid = 'u1') => ({ storage: { uctJournalWidgets: { uid } } })
const settle = async () => {
  await __builtInLoad(); await __builtLoad(); await __toolsLoad(); await __picksLoad()
  await new Promise((r) => setTimeout(r, 0))
}
const loaded = async (q, ed = member()) => { menuItems(q, ed); await settle(); return menuItems(q, ed) }
const titles = (items) => items.map((i) => i.title)
const group = (items, g) => titles(items.filter((i) => i.group === g))
const labelsOf = (items) => {
  const { container, unmount } = render(<SlashList items={items} command={() => {}} />)
  const out = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
  unmount()
  return out
}

const realFetch = global.fetch
let editor
beforeEach(() => {
  __resetBuiltIn(); __resetBuilt(); __resetMine(); __resetPicks(); __resetTools(); __resetBuiltCaches(); __resetDedicatedQueue()
  window.localStorage.clear()
  latchNotebookFlags(ALL_ON)
})
afterEach(() => {
  global.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy()
  editor = null
  cleanup()
})

function noteEditor(text, notify = vi.fn()) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: `<p>${text}</p>` })
  editor.storage.uctJournalWidgets = { ...editor.storage.uctJournalWidgets, uid: 'u1', notify }
  return editor
}
const embeds = (ed) => {
  const out = []
  ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') out.push(n) })
  return out
}

describe('a bare / (spec 8)', () => {
  it('bare_slash_defaults_order_with_risk_left_today', async () => {
    installNet()
    const items = await loaded('')
    expect(group(items, 'widgets')).toEqual([
      'Equity curve', 'Win rate', 'Daily P&L bars', 'My setup edge', 'Max drawdown', 'Risk left today',
      'My open positions and risk', 'Weekly scorecard', ALL_WIDGETS,
    ])
    expect(DEFAULTS).toHaveLength(BARE_MAX)
    expect(labelsOf(items)).toContain('Widgets')
    // One card per idea: a phase 1 default is listed in Widgets and nowhere else.
    for (const t of ['My setup edge', 'My open positions and risk', 'Risk left today']) {
      expect(titles(items).filter((x) => x === t), t).toHaveLength(1)
    }
    expect(group(items, 'review')).not.toContain('My setup edge')
    // The group sits after Reviewing and before Mine, once.
    const order = items.map((i) => i.group).filter((g, i, a) => g !== a[i - 1])
    expect(order.filter((g) => g === 'widgets')).toHaveLength(1)
    expect(order.indexOf('widgets')).toBe(order.indexOf('review') + 1)
    expect(order.indexOf('tools')).toBe(order.indexOf('widgets') + 1)
  })

  it('most_used_first_then_the_defaults_eight_at_most', async () => {
    installNet()
    let t = 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { t += 1000; return t })
    recordUse('u1', 'shelf:profit-factor')
    recordUse('u1', 'shelf:profit-factor')
    recordUse('u1', 'myTiltCheck')
    recordUse('u1', 'shelf:win-rate')                 // already a default: listed once, where its use puts it
    clock.mockRestore()
    const rows = group(await loaded(''), 'widgets')
    // The most added first; a tie, the latest first. Then the defaults; eight in all, so Weekly scorecard waits.
    expect(rows).toEqual([
      'Profit factor', 'Win rate', 'Tilt check', 'Equity curve', 'Daily P&L bars', 'My setup edge', 'Max drawdown',
      'Risk left today', ALL_WIDGETS,
    ])
    // Another member's uses are theirs.
    expect(group(await loaded('', member('u2')), 'widgets')[0]).toBe('Equity curve')
  })

  it('m-2: a storage that throws leaves the defaults alone, and an insert still counts nothing and throws nothing', async () => {
    installNet()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private mode') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    try {
      expect(() => recordUse('u1', 'shelf:profit-factor')).not.toThrow()
      expect(group(await loaded(''), 'widgets')[0]).toBe('Equity curve')
      expect(get).toHaveBeenCalled()                                       // non-vacuity: the storage WAS asked
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })

  it('a shelf that cannot be read leaves the defaults that need none', async () => {
    installNet({ shelf: () => json(500, {}) })
    expect(group(await loaded(''), 'widgets'))
      .toEqual(['My setup edge', 'Risk left today', 'My open positions and risk', ALL_WIDGETS])
  })

  it('All widgets… opens the examples', async () => {
    installNet()
    const ed = noteEditor('/')
    const row = (await loaded('', ed)).find((i) => i.title === ALL_WIDGETS)
    expect(row.description).toBe('Every ready-made widget')
    expect(row.group).toBe('widgets')
    vi.mocked(openWidgetBuilder).mockClear()
    await row.command({ editor: ed, range: { from: 1, to: 2 } })
    expect(openWidgetBuilder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openWidgetBuilder).mock.calls[0][0]).toMatchObject({ editor: ed, start: 'examples' })
    expect(ed.getText()).toBe('')
  })
})

describe('typing searches every card', () => {
  it('name_match_ranks_above_keyword', async () => {
    installNet()
    const hit = async (q) => titles(await loaded(q))
    // The synonyms: the shelf's keywords and WIDGET_KINDS' keywords.
    // m-5: FIRST, not merely found, so Enter takes it.
    expect((await hit('hit rate'))[0]).toBe('Win rate')
    expect((await hit('PF'))[0]).toBe('Profit factor')
    expect((await hit('DD'))[0]).toBe('Max drawdown')
    expect((await hit('funded'))[0]).toBe('Prop-firm rules')
    expect(await hit(SERVED_WORD)).toContain('Tilt check')
    // A name match leads a keyword match, wherever the keyword lives (a card, or a block).
    const dd = await hit('drawdown')
    expect(dd.indexOf('Max drawdown')).toBeGreaterThanOrEqual(0)
    expect(dd.indexOf('Max drawdown')).toBeLessThan(dd.indexOf('Prop-firm rules'))
    const risk = await hit('risk')
    expect(risk[0]).toBe('Risk left today')
    expect(risk.indexOf('Risk left today')).toBeLessThan(risk.indexOf('Position size calculator'))
    // A full name is first.
    expect((await hit('win rate'))[0]).toBe('Win rate')
    // Typed, a phase 1 card is its own snapshot row only (never a second one), and "All widgets…" is not offered.
    const setup = await hit('setup edge')
    expect(setup.filter((t) => t === 'My setup edge')).toHaveLength(1)
    expect(await hit('all widgets')).not.toContain(ALL_WIDGETS)
  })

  it('slash_size_direct_command', async () => {
    installNet()
    const items = await loaded('size')
    expect(titles(items)).toContain('Average win vs average loss')   // non-vacuity: a card answers "size" as a keyword
    const [first] = items
    expect(first.title).toBe('Position size calculator')
    expect(first.cmd).toBe('size')
    const log = []
    const chain = {}
    for (const name of ['focus', 'deleteRange', 'insertWidgetEmbed']) chain[name] = vi.fn((...a) => { log.push(name); return chain })
    chain.run = vi.fn(() => true)
    first.command({ editor: { chain: () => chain }, range: { from: 1, to: 6 } })
    expect(chain.insertWidgetEmbed).toHaveBeenCalledWith('sizeCalc')
  })
})

describe('the inserts', () => {
  it('a ready-made row inserts a built widget pinned to its revision', async () => {
    const calls = installNet()
    const notify = vi.fn()
    const ed = noteEditor('/equity', notify)
    const row = (await loaded('equity', ed)).find((i) => i.title === 'Equity curve')
    expect(revOf('shelf:equity-curve')).toBeGreaterThan(1)          // non-vacuity: a revision other than the default
    await row.command({ editor: ed, range: { from: 1, to: 1 + '/equity'.length } })
    const run = calls.find((c) => c.url.endsWith('/run'))
    expect(run.body).toMatchObject({ defId: 'shelf:equity-curve', defRev: revOf('shelf:equity-curve'), settings: {} })
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('builtWidget')
    expect(node.attrs.params).toMatchObject({ defId: 'shelf:equity-curve', defRev: revOf('shelf:equity-curve') })
    expect(ed.getText()).not.toContain('/equity')
    expect(notify.mock.calls).toEqual([['Adding Equity curve…', 'busy'], ['Equity curve added.', 'info']])
    // It counts as used: the next bare / lists it first.
    expect(group(await loaded('', ed), 'widgets')[0]).toBe('Equity curve')
  })

  it('a dedicated row inserts its own kind through its POST door', async () => {
    const calls = installNet()
    const ed = noteEditor('/risk')
    const row = (await loaded('risk', ed)).find((i) => i.title === 'Risk left today')
    await row.command({ editor: ed, range: { from: 1, to: 1 + '/risk'.length } })
    expect(calls.filter((c) => c.url === '/api/j2/notebook-shelf-widgets/myRiskLeftToday' && c.method === 'POST'))
      .toHaveLength(1)
    expect(calls.some((c) => c.url.startsWith('/api/j2/notebook-widgets/'))).toBe(false)   // never the phase 1 GET
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('myRiskLeftToday')
    expect(node.attrs.params.lines).toEqual(['Room left today.'])
  })

  it('Plan vs actual goes on to the trades, and a trade row inserts it with that trade', async () => {
    const calls = installNet()
    const ed = noteEditor('/plan vs')
    const row = (await loaded('plan vs', ed)).find((i) => i.title === 'Plan vs actual')
    expect(row.description).toBe('Pick one of your trades')
    row.command({ editor: ed, range: { from: 1, to: 1 + '/plan vs'.length } })
    expect(ed.getText()).toBe('/actual ')
    const trades = (await loaded('actual', ed)).filter((i) => i.cmd === 'actual')
    expect(titles(trades)).toEqual(['Plan vs actual — NVDA long, Oct 14', 'Plan vs actual — AMD short, Oct 15'])
    expect(titles(await loaded('actual amd', ed)).filter((t) => t.startsWith('Plan vs actual —')))
      .toEqual(['Plan vs actual — AMD short, Oct 15'])
    await trades[0].command({ editor: ed, range: { from: 1, to: 1 + '/actual '.length } })
    const post = calls.find((c) => c.url === '/api/j2/notebook-shelf-widgets/myPlanVsActual')
    expect(post.body).toEqual({ params: { tradeId: 't1' } })
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('myPlanVsActual')
    expect(node.attrs.params.settings).toEqual({ tradeId: 't1' })
    // Never on a bare /: the trades are there as recaps already.
    expect((await loaded('', ed)).some((i) => i.cmd === 'actual')).toBe(false)
  })
})

describe('dark while wave 10 is off', () => {
  it('no ready-made rows, no shelf read, and no /actual rows', async () => {
    const calls = installNet()
    __resetNotebookFlags()
    latchNotebookFlags({ ...ALL_ON, notebook_widgets_w10_enabled: false })
    for (const q of ['', 'win rate', 'risk', 'funded', 'actual']) {
      const items = await loaded(q)
      expect(builtInItems(q, member()), q).toEqual([])
      expect(items.some((i) => i.group === 'widgets' || i.cmd === 'actual'), q).toBe(false)
    }
    expect(titles(await loaded('risk'))).not.toContain('Risk left today')
    expect(calls.some((c) => c.url === '/api/j2/widget-definitions/shelf')).toBe(false)
    // CONTROL: on, the same callbacks answer.
    __resetNotebookFlags()
    latchNotebookFlags(ALL_ON)
    expect(titles(await loaded('risk'))).toContain('Risk left today')
  })
})

// ── The waves 8-10 ship-walk fix round, W8.8: whose widget a row is ─────────────────────────────────────────────
describe('a typed query that finds the firm example and the member widget of one name (W8.8)', () => {
  it('marks the example "Example" and the member\'s own "Yours", in the option\'s own text (its accessible name)', async () => {
    installNet()
    const base = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => (String(url) === '/api/j2/widget-definitions' && (init.method || 'GET') === 'GET'
      ? json(200, { widgets: [{ id: 'd-mine', name: 'Daily P&L bars', summary: 'Net P&L by day, my version' }] })
      : base(url, init)))
    const items = await loaded('daily p&l')
    const twins = items.filter((i) => i.title === 'Daily P&L bars')
    expect(twins).toHaveLength(2)
    expect(twins.map((i) => i.mark).sort()).toEqual([MARK_EXAMPLE, MARK_YOURS].sort())
    const { getByRole, getAllByRole } = render(<SlashList items={twins} command={() => {}} />)
    expect(getAllByRole('option')).toHaveLength(2)                       // two options, never one key twice
    expect(getByRole('option', { name: /^Daily P&L bars Example/ })).toBeTruthy()
    expect(getByRole('option', { name: /^Daily P&L bars Yours/ })).toBeTruthy()
  })

  it('CONTROL: an item with no mark renders its title alone', () => {
    const { getByRole } = render(<SlashList items={[{ title: 'Heading 1', description: 'Big' }]} command={() => {}} />)
    expect(getByRole('option', { name: 'Heading 1 Big' })).toBeTruthy()
  })
})
