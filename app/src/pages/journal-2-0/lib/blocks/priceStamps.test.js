// Price-stamped lines (spec §P2 item 4; R-P2-2, R-P2-3, IR-S3, S24). A real TipTap editor in jsdom, so
// the Enter order (V10) is proved rather than assumed: Enter lands at once, the stamp follows as its own
// undo step, within STAMP_TIMEOUT_MS of the Enter or not at all.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Editor, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

let STYLES_ON = true
vi.mock('../journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => STYLES_ON }))

import { buildExtensions } from '../tiptap'
import { stampsOn, STAMP_TIMEOUT_MS, PRICE_STAMPS_KEY } from './priceStamps'

let lineTicker, requestStamp
beforeAll(async () => { ({ lineTicker, requestStamp } = await import('./priceStampsRun')) })   // warm the lazy chunk once

const doc = (on, ...paras) => ({ type: 'doc', content: [
  { type: 'widgetEmbed', attrs: { widgetId: 'priceStamps', params: { on } } },
  ...paras.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
] })

function editorWith(content, extra = []) {
  const ed = new Editor({ extensions: [...buildExtensions(), ...extra], content })
  ed.storage.uctJournalWidgets = { noteId: 'n1', noteTicker: 'AMD' }
  return ed
}
const types = (ed) => ed.getJSON().content.map((n) => n.type)
const lineAt = (ed, index) => {
  let from = 0, to = 0
  ed.state.doc.forEach((n, off, i) => { if (i === index) { from = off; to = off + n.nodeSize } })
  return { from, to }
}
const pressEnterAtEndOf = (ed, index) => {
  ed.commands.setTextSelection(lineAt(ed, index).to - 1)
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
}
const reply = (id = 'f1') => ({ ok: true, json: async () => ({ fact: { id } }) })

describe('price stamps', () => {
  beforeEach(() => {
    STYLES_ON = true
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(() => new Promise((r) => setTimeout(() => r(reply()), 300)))
  })
  afterEach(() => { vi.useRealTimers() })

  it('lineTicker: a cashtag wins; the note ticker as a bare word counts; otherwise none', () => {
    expect(lineTicker('Bought $NVDA at the open', 'AMD')).toBe('NVDA')
    expect(lineTicker('AMD held the 20 EMA', 'AMD')).toBe('AMD')
    expect(lineTicker('Nothing here', 'AMD')).toBeNull()
    // a bare word is the note's ticker only as a whole word, never inside another word
    expect(lineTicker('AMDX ran', 'AMD')).toBeNull()
    expect(lineTicker('Nothing here', null)).toBeNull()
    // the note ticker is read live when storage holds a function (NoteEditorPage's form)
    expect(lineTicker('AMD held', () => 'AMD')).toBe('AMD')
  })

  it('requestStamp: the ONE write is the stamp route, never a note URL, with the note and the symbol', async () => {
    globalThis.fetch = vi.fn(async () => reply('f9'))
    const ac = new AbortController()
    await expect(requestStamp({ noteId: 'n1', symbol: 'NVDA', signal: ac.signal })).resolves.toEqual({ id: 'f9' })
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/trader-blocks/price-stamp')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(ac.signal)
    expect(JSON.parse(init.body)).toEqual({ noteId: 'n1', ticker: 'NVDA' })
  })

  it('Enter lands at once; the stamp lands after the line, as its own step', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // Enter, instantly
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'financialFact', 'paragraph'])
    expect(ed.getJSON().content[2].attrs.factId).toBe('f1')
    ed.commands.undo()
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // the stamp undoes alone
  })

  it('an edit right after the stamp is its own undo step: undoing it keeps the stamp', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    // ADJACENT to the stamp (at its end) and inside history's group delay: without the sealing
    // closeHistory this edit joins the stamp's undo event (mutation-proved).
    ed.commands.insertContentAt(lineAt(ed, 2).to, { type: 'paragraph', content: [{ type: 'text', text: 'next' }] })
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'financialFact', 'paragraph', 'paragraph'])
    ed.commands.undo()
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'financialFact', 'paragraph'])
  })

  it('off by default: no block or on=no stamps nothing and fetches nothing', async () => {
    const ed = editorWith(doc('no', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(stampsOn(ed.state.doc)).toBe(false)
    const none = editorWith({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Long $NVDA' }] }] })
    pressEnterAtEndOf(none, 0)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(stampsOn(none.state.doc)).toBe(false)
    expect(stampsOn(editorWith(doc('yes', 'x')).state.doc)).toBe(true)          // control: the switch reads on
  })

  it('the journal styles switch off: nothing is fetched and nothing stamped, even with on=yes (S24)', async () => {
    STYLES_ON = false
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(types(ed)).not.toContain('financialFact')
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph', 'paragraph'])     // Enter itself still landed
  })

  it('a fetch slower than the 2 s budget inserts nothing', async () => {
    // The budget is the spec's 2 s, written here as a number: a test that read it from the module
    // would follow the module to any value (mutation-proved: 20000 passed it).
    expect(STAMP_TIMEOUT_MS).toBe(2000)
    globalThis.fetch = vi.fn((url, { signal }) => new Promise((r, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      setTimeout(() => r(reply()), 2500)
    }))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(2600)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('CONTROL: a fetch inside the 2 s budget does land', async () => {
    globalThis.fetch = vi.fn(() => new Promise((r) => setTimeout(() => r(reply()), 1500)))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(1600)
    expect(types(ed)).toContain('financialFact')
  })

  it('a run that starts after the 2 s budget (a slow chunk) fetches nothing and settles', async () => {
    const { default: runStamp } = await import('./priceStampsRun')
    const { settle } = await import('./priceStamps')
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    ed.view.dispatch(ed.state.tr.setMeta(PRICE_STAMPS_KEY, [99, lineAt(ed, 1).from]))
    expect(PRICE_STAMPS_KEY.getState(ed.state).get(99)).toBe(lineAt(ed, 1).from)
    await runStamp({ editor: ed, id: 99, until: Date.now() - 1, key: PRICE_STAMPS_KEY, settle })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(PRICE_STAMPS_KEY.getState(ed.state).size).toBe(0)
    // CONTROL: the same run inside its budget does fetch
    ed.view.dispatch(ed.state.tr.setMeta(PRICE_STAMPS_KEY, [100, lineAt(ed, 1).from]))
    const done = runStamp({ editor: ed, id: 100, until: Date.now() + 2000, key: PRICE_STAMPS_KEY, settle })
    await vi.advanceTimersByTimeAsync(400)
    await done
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(types(ed)).toContain('financialFact')
  })

  it('a deleted line takes no stamp', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    ed.chain().deleteRange(lineAt(ed, 1)).run()
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('IR-S3: a line deleted while its stamp is in flight takes no stamp (its start maps as deleted)', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(100)                 // the fetch is out; the line is read
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    ed.chain().deleteRange(lineAt(ed, 1)).run()
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph'])
    await vi.advanceTimersByTimeAsync(400)
    expect(types(ed)).toEqual(['widgetEmbed', 'paragraph'])
  })

  it('a moved line takes its stamp where it now is', async () => {
    const ed = editorWith(doc('yes', 'first', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 2)
    ed.chain().insertContentAt(1, { type: 'paragraph', content: [{ type: 'text', text: 'typed above' }] }).run()
    await vi.advanceTimersByTimeAsync(400)
    const json = ed.getJSON().content
    const at = json.findIndex((n) => n.type === 'financialFact')
    expect(at).toBeGreaterThan(0)
    expect(json[at - 1].content[0].text).toBe('Long $NVDA here')
  })

  it('a line that names no ticker fetches nothing', async () => {
    const ed = editorWith(doc('yes', 'Nothing here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a failed fetch inserts nothing and never throws', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(100)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(types(ed)).not.toContain('financialFact')
  })

  it('Enter mid-line, or on an empty line, records nothing', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here', ''))
    ed.commands.setTextSelection(lineAt(ed, 1).from + 3)
    ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    pressEnterAtEndOf(ed, ed.state.doc.childCount - 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(PRICE_STAMPS_KEY.getState(ed.state).size).toBe(0)
  })

  it('Enter that picks a suggestion (a menu is open) stamps nothing', async () => {
    const key = new PluginKey('fakeSuggestion')
    const Open = Extension.create({
      name: 'fakeSuggestion',
      addProseMirrorPlugins: () => [new Plugin({ key, state: { init: () => ({ active: true, range: { from: 1, to: 2 } }), apply: (tr, v) => v } })],
    })
    const ed = editorWith(doc('yes', 'Long $NVDA here'), [Open])
    pressEnterAtEndOf(ed, 1)
    await vi.advanceTimersByTimeAsync(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('every pending stamp is settled: none is left in the plugin state once its run ends', async () => {
    const ed = editorWith(doc('yes', 'Long $NVDA here'))
    pressEnterAtEndOf(ed, 1)
    expect(PRICE_STAMPS_KEY.getState(ed.state).size).toBe(1)
    await vi.advanceTimersByTimeAsync(400)
    expect(PRICE_STAMPS_KEY.getState(ed.state).size).toBe(0)
  })
})
