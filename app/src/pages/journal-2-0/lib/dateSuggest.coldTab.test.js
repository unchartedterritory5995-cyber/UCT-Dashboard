// N3 (polish round): on the FIRST `@` of a page load the date list's UI is still a chunk on its way
// (dateSuggest.js loads DateSuggestList on the first `@`). Tab must already insert the first date,
// as it does once the list is on screen; every other key keeps reaching the editor (Enter is a new
// line). The list's chunk is held pending here for the whole file, so no case can see a list.
// Its own file: the plugin keeps the loaded list in module state, once per module registry.
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { todayET } from './calendar'
import { resolveDateWord } from './dateMentionNode'
import { dateSuggestPluginKey, tabFirstChoice } from './dateSuggest'

const { gate, loads } = vi.hoisted(() => {
  let release
  const p = new Promise((r) => { release = r })
  return { gate: { p, release: () => release() }, loads: { n: 0 } }
})
vi.mock('../components/notebook/DateSuggestList', async (importOriginal) => {
  loads.n += 1
  await gate.p
  return importOriginal()
})

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
afterAll(() => gate.release())

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
function mount(text) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [para(text)] } })
  editor.commands.focus('end')
  return editor
}
const press = (ed, key) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key })))
const mentions = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'dateMention') o.push(n.attrs.date) }); return o }
const paragraphs = (ed) => ed.getJSON().content.map((n) => n.type)
const tick = () => new Promise((r) => setTimeout(r, 0))
const noList = () => expect(document.getElementById('uct-date-suggest')).toBeNull()

describe('Tab before the date list has loaded', () => {
  it('right after the keystroke (before the session has even started): Tab inserts the first date', () => {
    const ed = mount('Due ')
    ed.commands.insertContent('@tom')
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true) // non-vacuity: a session is open
    noList()
    expect(press(ed, 'Tab')).toBe(true)
    expect(mentions(ed)).toEqual([resolveDateWord('tomorrow', todayET())])
    expect(ed.state.doc.textContent).toBe('Due  ') // "@tom" is gone, a space follows the mention
  })

  it('once the session has started and the chunk has been asked for (still loading): Tab inserts it', async () => {
    const ed = mount('Due ')
    ed.commands.insertContent('@tom')
    // the list's chunk WAS requested (the import reaches the module a few ticks later), still pending
    await vi.waitFor(() => expect(loads.n).toBe(1))
    noList()
    expect(press(ed, 'Tab')).toBe(true)
    expect(mentions(ed)).toEqual([resolveDateWord('tomorrow', todayET())])
    expect(paragraphs(ed)).toEqual(['paragraph'])
  })

  it('a bare "@": Tab takes the first row, Today (never the picker)', async () => {
    const ed = mount('Due ')
    ed.commands.insertContent('@')
    await tick()
    noList()
    expect(press(ed, 'Tab')).toBe(true)
    expect(mentions(ed)).toEqual([todayET()])
  })

  it('"@john" (nothing to take): Tab is not swallowed, and nothing is inserted', async () => {
    const ed = mount('ask ')
    ed.commands.insertContent('@john')
    await tick()
    expect(press(ed, 'Tab')).toBeFalsy() // no handler claimed it (someProp answers undefined)
    expect(mentions(ed)).toEqual([])
    expect(ed.state.doc.textContent).toBe('ask @john')
  })

  it('Enter with no list stays a new line (unchanged): no date unchosen', async () => {
    const ed = mount('Buy NVDA ')
    ed.commands.insertContent('@tom')
    await tick()
    noList()
    press(ed, 'Enter')
    expect(mentions(ed)).toEqual([])
    expect(paragraphs(ed)).toEqual(['paragraph', 'paragraph'])
  })

  it('tabFirstChoice answers false with no session open', () => {
    const ed = mount('plain text')
    expect(tabFirstChoice(ed, ed.state, todayET())).toBe(false)
    expect(mentions(ed)).toEqual([])
  })
})
