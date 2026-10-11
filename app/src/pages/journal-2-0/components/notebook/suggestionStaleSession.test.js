// H14 sweep (polish round): every TipTap suggestion menu in the Notebook calls `onStart` only after
// Suggestion has awaited its `items` (a microtask; for the note-link search, a 150 ms debounce plus a
// fetch). A session that ENDS in that gap -- the trigger deleted, or a start and an end in one task --
// used to get its `onStart` anyway: a popup for a session that is gone, which nothing removes, and a
// row in it whose command edits the dead session's range. The four menus, found from source
// (`grep Suggestion(`): NoteLinkMenu, DateSuggest (the @ list), SlashMenu, EmojiMenu.
//
// Each menu is held to the same three things:
//   * CONTROL: a real trigger does draw its popup (so "no popup" below is not vacuous);
//   * a session that ends in the gap draws NO popup and leaves the text as it was;
//   * its real Suggestion command does NOTHING with a dead session's range (text intact), and does
//     its job with the live one.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor } from '@tiptap/core'
import { SuggestionPluginKey as slashKey } from '@tiptap/suggestion'
import { buildExtensions } from '../../lib/tiptap'
import { dateSuggestPluginKey, dateSuggestCommand } from '../../lib/dateSuggest'
import { noteLinkMenuPluginKey, noteLinkCommand } from './NoteLinkMenu'
import { emojiMenuPluginKey, emojiCommand } from './EmojiMenu'
import { slashCommand } from './SlashMenu'

// jsdom has no Range geometry (the same two lines EmojiMenu.test.jsx carries).
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const realFetch = globalThis.fetch
let editor
afterEach(() => {
  editor?.destroy(); editor = null
  document.body.innerHTML = ''
  globalThis.fetch = realFetch
})

function mount(text = 'See ') {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
  editor.commands.focus('end', { scrollIntoView: false })
  return editor
}
const popups = () => [...document.body.children].filter((el) => el.style?.position === 'fixed')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const answerSearchAtOnce = () => {
  const searched = vi.fn(async () => ({ ok: true, json: async () => ({ notes: [{ id: 'n1', title: 'Weekly review' }] }) }))
  globalThis.fetch = searched
  return searched
}
/** Type `trigger` at the end; returns the range it occupies. */
function type(ed, trigger) {
  const from = ed.state.selection.from
  ed.commands.insertContent(trigger)
  return { from, to: ed.state.selection.from }
}
const reset = () => { editor?.destroy(); editor = null; document.body.innerHTML = '' }

// [menu, trigger, how long its gap can take, setup]
const MENUS = [
  ['the note-link menu ([[)', '[[Weekly', 2000, answerSearchAtOnce],
  ['the @ date list', '@tom', 3000, () => {}],
  ['the slash menu', '/', 1000, () => {}],
  ['the emoji menu', ':smile', 1000, () => {}],
]

describe.each(MENUS)('%s: a session that ends before its onStart', (name, trigger, gapMs, setup) => {
  it('CONTROL: a real trigger draws the popup', async () => {
    setup()
    const ed = mount()
    type(ed, trigger)
    await vi.waitFor(() => expect(popups().length).toBe(1), { timeout: gapMs })
  })

  it('a start and an end in ONE task: no popup, the text as it was', async () => {
    setup()
    const ed = mount()
    const before = ed.state.doc.textContent
    const r = type(ed, trigger)
    ed.commands.deleteRange(r) // same task: this update's onExit runs before the start's onStart
    await wait(gapMs > 1000 ? 600 : 100)
    expect(popups()).toEqual([])
    expect(ed.state.doc.textContent).toBe(before)
  })
})

describe('the note-link menu: the [[ deleted inside the search delay (polish review P1)', () => {
  it('no popup appears, and the text stays as the member left it', async () => {
    const searched = answerSearchAtOnce()
    const ed = mount()
    const r = type(ed, '[[Weekly')
    await wait(10) // a later keystroke: its own task
    expect(searched).not.toHaveBeenCalled() // still inside the debounce
    ed.commands.deleteRange(r)
    ed.commands.insertContent('my words')
    await vi.waitFor(() => expect(searched).toHaveBeenCalledTimes(1), { timeout: 2000 })
    await wait(50)
    expect(popups()).toEqual([])
    expect(ed.state.doc.textContent).toBe('See my words')
  })
})

describe('the note-link menu: the session changed inside the search delay (H14 review F1, F2)', () => {
  it('F1: a backspace, then a row click, deletes the LIVE range, never one past the cursor', () => {
    const ed = mount('See end')
    ed.commands.setTextSelection(5) // between 'See ' and 'end'
    const captured = type(ed, '[[Weekly') // the range a row rendered before the backspace holds
    ed.commands.deleteRange({ from: captured.to - 1, to: captured.to }) // backspace: '[[Weekl'
    const live = noteLinkMenuPluginKey.getState(ed.state)
    expect(live.active).toBe(true)
    expect(live.range.to).toBe(captured.to - 1) // the session shrank; the row's range did not
    noteLinkCommand({ editor: ed, range: captured, props: { id: 'n1' } })
    expect(ed.state.doc.textContent).not.toContain('[[Weekl')
    expect(ed.state.doc.textContent.endsWith('end')).toBe(true) // the 'e' of 'end' survives
  })

  it('F2: the [[ re-pasted at the same spot inside the delay draws ONE popup, not two', async () => {
    const searched = answerSearchAtOnce()
    const ed = mount()
    const r = type(ed, '[[Weekly')
    await wait(10)
    ed.commands.deleteRange(r)
    type(ed, '[[Weekly') // same `from`: both sessions pass the start-position check
    await vi.waitFor(() => expect(searched).toHaveBeenCalled(), { timeout: 2000 })
    await wait(100)
    expect(popups().length).toBe(1)
    ed.commands.deleteRange({ from: r.from, to: ed.state.selection.from }) // ends the session
    await wait(50)
    expect(popups()).toEqual([]) // and the one that exists is the one onExit removes
  })
})

describe('a dead session\'s range is never edited by the real commands', () => {
  // Start a session, end it, put the member's words where it was; then hand the command the DEAD
  // range, as a row in a popup that outlived its session would.
  function deadRange(trigger) {
    const ed = mount()
    const r = type(ed, trigger)
    ed.commands.deleteRange(r)
    ed.commands.insertContent('keep these words')
    return { ed, range: r }
  }

  it('note link: the text is intact; CONTROL: a live session inserts the link', () => {
    const { ed, range } = deadRange('[[Weekly')
    expect(noteLinkMenuPluginKey.getState(ed.state).active).toBeFalsy()
    noteLinkCommand({ editor: ed, range, props: { id: 'n1' } })
    expect(ed.state.doc.textContent).toBe('See keep these words')
    reset()
    const live = mount()
    type(live, '[[Weekly')
    const s = noteLinkMenuPluginKey.getState(live.state)
    noteLinkCommand({ editor: live, range: s.range, props: { id: 'n1' } })
    expect(live.state.doc.textContent).not.toContain('[[Weekly')
  })

  it('@ date: the text is intact; CONTROL: a live session inserts the date', () => {
    const { ed, range } = deadRange('@tom')
    dateSuggestCommand({ editor: ed, range, props: { label: 'Tomorrow', date: '2026-10-15' } })
    expect(ed.state.doc.textContent).toBe('See keep these words')
    expect(JSON.stringify(ed.getJSON())).not.toContain('dateMention')
    reset()
    const live = mount()
    type(live, '@tom')
    dateSuggestCommand({ editor: live, range: dateSuggestPluginKey.getState(live.state).range, props: { label: 'Tomorrow', date: '2026-10-15' } })
    expect(JSON.stringify(live.getJSON())).toContain('2026-10-15')
  })

  it('slash: the item never runs; CONTROL: a live session runs it', () => {
    const { ed, range } = deadRange('/')
    const item = vi.fn()
    slashCommand({ editor: ed, range, props: { command: item } })
    expect(item).not.toHaveBeenCalled()
    expect(ed.state.doc.textContent).toBe('See keep these words')
    reset()
    const live = mount()
    type(live, '/')
    slashCommand({ editor: live, range: slashKey.getState(live.state).range, props: { command: item } })
    expect(item).toHaveBeenCalledTimes(1)
  })

  it('emoji: the text is intact; CONTROL: a live session inserts the emoji', () => {
    const { ed, range } = deadRange(':smile')
    emojiCommand({ editor: ed, range, props: { char: 'X' } })
    expect(ed.state.doc.textContent).toBe('See keep these words')
    reset()
    const live = mount()
    type(live, ':smile')
    emojiCommand({ editor: live, range: emojiMenuPluginKey.getState(live.state).range, props: { char: 'X' } })
    expect(live.state.doc.textContent).toBe('See X')
  })

  it('each menu hands Suggestion its exported, guarded command (the one tested above)', () => {
    const src = (p) => readFileSync(join(__dirname, p), 'utf8')
    expect(src('NoteLinkMenu.jsx')).toMatch(/command: noteLinkCommand,/)
    expect(src('EmojiMenu.jsx')).toMatch(/command: emojiCommand,/)
    expect(src('SlashMenu.jsx')).toMatch(/command: slashCommand,/)
    expect(src('../../lib/dateSuggest.js')).toMatch(/command: dateSuggestCommand,/)
    for (const [file, key] of [['NoteLinkMenu.jsx', 'noteLinkMenuPluginKey'], ['EmojiMenu.jsx', 'emojiMenuPluginKey'],
      ['SlashMenu.jsx', 'SuggestionPluginKey'], ['../../lib/dateSuggest.js', 'dateSuggestPluginKey']]) {
      expect(src(file), file).toMatch(new RegExp(`guardedCommand\\(${key}`))
      expect(src(file), file).toMatch(new RegExp(`sessionStillOpen\\(${key}`))
    }
  })
})
