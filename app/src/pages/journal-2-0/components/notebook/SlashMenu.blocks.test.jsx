// Notebook P2a Task 12: the slash menu's P2a rail (there is no SlashMenu.test.jsx; pre-flight N6).
// The three trader blocks and the market context stamp, offered in the Trading group while journal
// styles are on. A block item inserts its kind with its catalog defaults; "Market context" reads
// GET /api/j2/trader-blocks/market-context and stamps what it read (R-P2-8), or inserts nothing.
// ⛔ R-RC-4: the typed "/market context" leaves the note BEFORE the read is awaited, so a slow read
// can never leave the command text behind.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { ITEMS, blockItemsAvailable, groupedSlashItems, blockItemGroup, rankedBlockItems } from './SlashMenu'
import { BLOCK_KINDS } from '../../lib/journalBlocks'
import { buildExtensions } from '../../lib/tiptap'
import { normalizeParams } from '../../../../widgets/registry'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

// jsdom has no Range geometry; the slash popup positions itself off the caret (dateSuggest.test.js).
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const ON = () => latchNotebookFlags({ notebook_journal_styles_enabled: true })
const BLOCK_IDS = ['preEntryChecklist', 'priceStamps', 'positionSizing']
const IDS = [...BLOCK_IDS, 'marketcontext']
// The words a member sees are the catalog's labels (journalBlocks.js), read here, never retyped.
const label = (id) => BLOCK_KINDS.find((k) => k.id === id).label
const catalogDefaults = (id) => Object.fromEntries(BLOCK_KINDS.find((k) => k.id === id).settings.map((s) => [s.key, s.default]))
const titles = IDS.map(label)
const MC = '/api/j2/trader-blocks/market-context'

/** A chain that records every call in order, so a rail can say what ran before what. */
function chainOf(log = []) {
  const chain = {}
  for (const name of ['focus', 'deleteRange', 'insertWidgetEmbed']) {
    chain[name] = vi.fn((...args) => { log.push([name, ...args]); return chain })
  }
  chain.run = vi.fn(() => { log.push(['run']); return true })
  return chain
}
const itemTitled = (t) => blockItemsAvailable({}).find((i) => i.title === t)

const origFetch = globalThis.fetch
afterEach(() => { __resetNotebookFlags(); globalThis.fetch = origFetch; document.body.innerHTML = '' })

describe('P2a slash items', () => {
  it('the titles are the catalog labels, including the words this rail expects (control)', () => {
    expect(titles).toEqual(['Pre-entry checklist', 'Price stamps', 'Position sizing', 'Market context'])
  })

  it('each is offered in the Trading group while the switch is on', () => {
    ON()
    const here = blockItemsAvailable({})
    for (const t of titles) {
      const item = here.find((i) => i.title === t)
      expect(item, t).toBeTruthy()
      expect(blockItemGroup(item), t).toBe('trading')
    }
    const grouped = groupedSlashItems(here, []).filter((i) => titles.includes(i.title))
    expect(grouped.map((i) => i.title).sort()).toEqual([...titles].sort())
    expect(grouped.every((i) => i.group === 'trading')).toBe(true)
  })

  it('none is offered while the switch is off, though each is in the menu', () => {
    for (const t of titles) expect(ITEMS.some((i) => i.title === t), t).toBe(true)
    expect(blockItemsAvailable({}).filter((i) => titles.includes(i.title))).toEqual([])
  })

  it('a typed query finds them by title, and "/block" finds all four', () => {
    ON()
    const here = blockItemsAvailable({})
    expect(rankedBlockItems(here, 'market')[0].title).toBe('Market context')
    expect(rankedBlockItems(here, 'position')[0].title).toBe('Position sizing')
    expect(rankedBlockItems(here, 'block').map((i) => i.title)).toEqual(expect.arrayContaining(titles))
  })

  it('each block item inserts its own kind, after deleting the typed command', () => {
    // Cut A: no params are passed -- buildWidgetEmbedAttrs -> normalizeParams fills the registry
    // defaults. The STORED node's params are the defaults rail ("...in a real editor" below).
    ON()
    for (const id of BLOCK_IDS) {
      const log = []
      const chain = chainOf(log)
      itemTitled(label(id)).command({ editor: { chain: () => chain }, range: { from: 3, to: 9 } })
      expect(chain.insertWidgetEmbed, id).toHaveBeenCalledTimes(1)
      expect(chain.insertWidgetEmbed, id).toHaveBeenCalledWith(id)
      const del = log.findIndex(([n]) => n === 'deleteRange')
      const ins = log.findIndex(([n]) => n === 'insertWidgetEmbed')
      expect(log[del], id).toEqual(['deleteRange', { from: 3, to: 9 }])
      expect(del, id).toBeLessThan(ins)
    }
  })

  it('Market context reads the route and inserts the existing marketcontext kind with what it read (R-P2-8)', async () => {
    ON()
    const params = { readings: { regime: { value: 'green' } }, wireDate: '2026-10-13', updated: '1:26 PM ET' }
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => params }))
    const chain = chainOf()
    await itemTitled('Market context').command({ editor: { chain: () => chain }, range: { from: 1, to: 2 } })
    expect(globalThis.fetch).toHaveBeenCalledWith(MC, expect.objectContaining({ credentials: 'include' }))
    // Cut B: what was read goes in as read; `fields: 'all'` is the registry default (next case).
    expect(chain.insertWidgetEmbed).toHaveBeenCalledWith('marketcontext', params)
  })

  it('the registry fills a stamp\'s `fields` with "all" when the read carries none (why cut B is safe)', () => {
    expect(normalizeParams('marketcontext', {}).fields).toBe('all')
    expect(normalizeParams('marketcontext', { readings: {}, wireDate: 'x', updated: 'y' }).fields).toBe('all')
  })

  it('Market context: a failed read inserts nothing, and a thrown read inserts nothing', async () => {
    ON()
    for (const fetchImpl of [async () => ({ ok: false, status: 503 }), async () => { throw new TypeError('offline') }]) {
      globalThis.fetch = vi.fn(fetchImpl)
      const chain = chainOf()
      await itemTitled('Market context').command({ editor: { chain: () => chain }, range: { from: 1, to: 2 } })
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(chain.insertWidgetEmbed).not.toHaveBeenCalled()
    }
  })

  it('⛔ R-RC-4: the range is deleted BEFORE the read is awaited (recorded order)', async () => {
    ON()
    const log = []
    let release
    globalThis.fetch = vi.fn(() => { log.push(['fetch']); return new Promise((r) => { release = r }) })
    const chain = chainOf(log)
    const done = itemTitled('Market context').command({ editor: { chain: () => chain }, range: { from: 4, to: 19 } })
    // The read is still pending: the typed command is already gone, nothing is inserted yet.
    expect(log.slice(0, 3)).toEqual([['focus'], ['deleteRange', { from: 4, to: 19 }], ['run']])
    expect(chain.insertWidgetEmbed).not.toHaveBeenCalled()
    release({ ok: true, json: async () => ({ readings: {}, wireDate: null, updated: '9:41 AM ET' }) })
    await done
    expect(chain.insertWidgetEmbed).toHaveBeenCalledTimes(1)
    expect(log.findIndex(([n]) => n === 'deleteRange')).toBeLessThan(log.findIndex(([n]) => n === 'fetch'))
  })
})

describe('P2a slash items in a real editor', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null })
  const embeds = () => editor.getJSON().content.filter((n) => n.type === 'widgetEmbed')

  function typed(text) {
    editor = new Editor({ extensions: buildExtensions(), content: `<p>Plan ${text}</p>` })
    editor.commands.focus('end')
    const to = editor.state.selection.from
    return { from: to - text.length, to }
  }

  it('⛔ R-RC-4: a slow read never leaves "/market context" in the note, and the stamp lands after', async () => {
    ON()
    let release
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = r }))
    const range = typed('/market context')
    const done = itemTitled('Market context').command({ editor, range })
    expect(editor.state.doc.textContent).toBe('Plan ')
    expect(embeds()).toEqual([])
    const readings = { regime: { value: 'amber', source: 'x', asOf: '2026-10-12', missing: null } }
    release({ ok: true, json: async () => ({ readings, wireDate: '2026-10-12', updated: '10:30 AM ET' }) })
    await done
    const [stamp] = embeds()
    expect(stamp.attrs.widgetId).toBe('marketcontext')
    expect(stamp.attrs.params).toEqual({ readings, wireDate: '2026-10-12', updated: '10:30 AM ET', fields: 'all' })
    expect(typeof stamp.attrs.capturedAt).toBe('string')
    expect(editor.state.doc.textContent).not.toContain('/market')
  })

  it('a failed read leaves the note as it was, minus the typed command', async () => {
    ON()
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    const range = typed('/market context')
    await itemTitled('Market context').command({ editor, range })
    expect(embeds()).toEqual([])
    expect(editor.state.doc.textContent).toBe('Plan ')
  })

  // The read can outlive the editor (the member left the note). Two shapes: the view is gone but the
  // editor object (and its storage, so `notify`) survives -- tiptap's unmount() -- and a full destroy().
  it('a failed read that outlives the editor\'s view tells nobody (the note is gone)', async () => {
    ON()
    let release
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = r }))
    const range = typed('/market context')
    const notify = vi.fn()
    editor.storage.uctJournalWidgets = { ...(editor.storage.uctJournalWidgets || {}), notify }
    const done = itemTitled('Market context').command({ editor, range })
    editor.unmount()
    expect(editor.isDestroyed).toBe(true)
    expect(editor.storage.uctJournalWidgets.notify).toBe(notify)   // non-vacuity: notify is still reachable
    release({ ok: false, status: 503 })
    await done
    expect(notify).not.toHaveBeenCalled()
  })

  it('a good read that outlives the editor stamps nothing and does not throw', async () => {
    ON()
    let release
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = r }))
    const range = typed('/market context')
    const done = itemTitled('Market context').command({ editor, range })
    editor.destroy()
    release({ ok: true, json: async () => ({ readings: {}, wireDate: null, updated: '9:41 AM ET' }) })
    await expect(done).resolves.toBeUndefined()
    editor = null
  })

  it('a block item lands its node, with the catalog defaults, where the command was typed (the defaults rail)', () => {
    ON()
    for (const id of BLOCK_IDS) {
      const range = typed(`/${label(id).toLowerCase()}`)
      itemTitled(label(id)).command({ editor, range })
      const [node] = embeds()
      expect(node.attrs.widgetId, id).toBe(id)
      expect(node.attrs.params, id).toEqual(expect.objectContaining(catalogDefaults(id)))
      expect(editor.state.doc.textContent, id).toBe('Plan ')
      editor.destroy(); editor = null
    }
  })
})

// ⛔ R-T12-1: a command a member names in full (`/price`) answers ahead of a block whose title merely
// starts with the same word ("Price stamps"). Driven the way a member drives it: the REAL slash
// extension on the REAL roster, the menu as rendered, Enter on the top row.
describe('R-T12-1: a named command outranks a block title (the rendered menu)', () => {
  let ed
  afterEach(() => { cleanup(); ed?.destroy(); ed = null })
  const pressKey = (k) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: k })))
  const rows = () => [...document.querySelectorAll('#uct-slash-menu [role="option"]')]
    .map((o) => o.firstElementChild.textContent)

  /** Mount the editor with "Plan " typed, then type the slash text; resolves once the menu shows. */
  async function typeSlash(text) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    ed = new Editor({ element: el, extensions: buildExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }] } })
    render(createElement(EditorContent, { editor: ed }))
    ed.commands.focus('end', { scrollIntoView: false })
    await act(async () => { ed.commands.insertContent(text) })
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    return rows()
  }

  it('/price + Enter picks the Price command, not Price stamps', async () => {
    ON()
    const shown = await typeSlash('/price')
    expect(shown[0]).toBe('Price')
    expect(shown).toContain('Price stamps')       // the block is still offered, just below the command
    await act(async () => { pressKey('Enter') })
    expect(ed.state.doc.textContent).toBe('Plan /price ')   // the Price hint completes the command
    expect(ed.getJSON().content.some((n) => n.type === 'widgetEmbed')).toBe(false)
  })

  it('/price with a trailing space still puts Price first', async () => {
    ON()
    const shown = await typeSlash('/price ')
    expect(shown[0]).toBe('Price')
    expect(shown.indexOf('Price')).toBeLessThan(shown.indexOf('Price stamps'))
  })

  it('/price st ranks the "Price — ST" capture first (ST is a real ticker)', async () => {
    ON()
    const shown = await typeSlash('/price st')
    expect(shown[0]).toBe('Price — ST')
    expect(shown).toContain('Price stamps')
  })

  it('control: /pric (no command named yet) still offers Price stamps first', async () => {
    ON()
    const shown = await typeSlash('/pric')
    expect(shown[0]).toBe('Price stamps')
    expect(shown).toContain('Price')
  })

  it('control: /pre still offers the Pre-entry checklist first', async () => {
    ON()
    const shown = await typeSlash('/pre')
    expect(shown[0]).toBe('Pre-entry checklist')
  })
})
