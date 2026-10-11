// P0.9 -- the `@` date suggestions. The pure choices, the ONE command, and the extension on the
// REAL Notebook roster (buildExtensions), driven the way a member drives it: type `@`, read the
// list, press Enter.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { SuggestionPluginKey as slashKey } from '@tiptap/suggestion'
import { noteLinkMenuPluginKey } from '../components/notebook/NoteLinkMenu'
import { EditorContent } from '@tiptap/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { todayET } from './calendar'
import { resolveDateWord } from './dateMentionNode'
import { dateChoices, runDateCommand, dateSuggestPluginKey, DateSuggest } from './dateSuggest'

const TODAY = '2026-10-14' // a Wednesday

describe('dateChoices', () => {
  it('an empty query offers today, tomorrow and next Monday first', () => {
    expect(dateChoices('', TODAY).slice(0, 3)).toEqual([
      { label: 'Today', date: '2026-10-14' },
      { label: 'Tomorrow', date: '2026-10-15' },
      { label: 'Next Monday', date: '2026-10-19' },
    ])
  })

  it('an empty query offers the five weekdays after today and then the picker', () => {
    const all = dateChoices('', TODAY)
    expect(all.map((c) => c.label)).toEqual([
      'Today', 'Tomorrow', 'Next Monday', 'Next Tuesday', 'Next Wednesday', 'Next Thursday', 'Next Friday',
      'Pick a date…',
    ])
    // "Next Wednesday" on a Wednesday is a week out, never today (resolveDateWord's rule).
    expect(all.find((c) => c.label === 'Next Wednesday').date).toBe('2026-10-21')
  })

  it('filters by prefix, case-insensitive', () => {
    expect(dateChoices('tom', TODAY)).toEqual([{ label: 'Tomorrow', date: '2026-10-15' }])
    expect(dateChoices('TOM', TODAY)).toEqual([{ label: 'Tomorrow', date: '2026-10-15' }])
  })

  it('a bare weekday name finds its "Next ..." row (the input rule accepts "@friday")', () => {
    expect(dateChoices('fri', TODAY)).toEqual([{ label: 'Next Friday', date: '2026-10-16' }])
    expect(dateChoices('next', TODAY)).toHaveLength(5)
  })

  it('a typed ISO date becomes one exact choice', () => {
    expect(dateChoices('2026-11-03', TODAY)).toEqual([{ label: 'Nov 3, 2026', date: '2026-11-03' }])
  })

  it('an impossible date offers nothing', () => {
    expect(dateChoices('2026-02-30', TODAY)).toEqual([])
  })

  it('always ends with a "Pick a date…" entry when nothing has been typed', () => {
    const all = dateChoices('', TODAY)
    expect(all[all.length - 1]).toEqual({ label: 'Pick a date…', date: null, picker: true })
  })

  it('⛔ prose after the @ offers NOTHING, so Enter stays a newline ("@john", "@5pm")', () => {
    for (const q of ['john', 'gmail', '5pm', '2026-1', 'x']) {
      expect(dateChoices(q, TODAY), q).toEqual([])
    }
  })

  it('every dated choice is exactly what the input rule would store for the same word', () => {
    for (const c of dateChoices('', TODAY).filter((x) => x.date)) {
      expect(c.date, c.label).toBe(resolveDateWord(c.label, TODAY))
    }
  })

  it('is pure: the same input, the same answer, no fetch', () => {
    expect(dateChoices('', TODAY)).toEqual(dateChoices('', TODAY))
  })
})

describe('the extension on the real roster', () => {
  let editor
  afterEach(() => { cleanup(); editor?.destroy(); editor = null; document.body.innerHTML = '' })

  // JSON content, not HTML: an HTML parse collapses a trailing space, and "Call broker " + "@" is
  // exactly the case under test (the "@" must follow a space).
  const para = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
  function mount(text = '', block = para) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [block(text)] } })
    return editor
  }
  const state = (ed) => dateSuggestPluginKey.getState(ed.state)
  const mentions = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'dateMention') o.push(n.attrs.date) }); return o }
  const text = (ed) => ed.state.doc.textContent
  const press = (ed, key) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key })))

  it('DateSuggest is registered exactly once, in the Notebook roster', () => {
    const names = buildExtensions().map((e) => e.name)
    expect(names.filter((n) => n === 'dateSuggest')).toHaveLength(1)
    expect(names).toContain('dateMention')
    expect(DateSuggest.name).toBe('dateSuggest')
  })

  it('adds no node, mark or attribute: the schema is the one it was', () => {
    const ed = mount()
    expect(Object.keys(ed.schema.nodes)).toContain('dateMention')
    expect(Object.keys(ed.schema.nodes)).not.toContain('dateSuggest')
    expect(Object.keys(ed.schema.marks)).not.toContain('dateSuggest')
    expect(Object.keys(ed.schema.nodes.dateMention.spec.attrs)).toEqual(['date'])
  })

  it('typing @ after a space opens the suggestion, with the query as typed', () => {
    const ed = mount('Call broker ')
    ed.commands.focus('end')
    ed.commands.insertContent('@tom')
    const s = state(ed)
    expect(s.active).toBe(true)
    expect(s.query).toBe('tom')
  })

  it('at the very start of a line it opens too', () => {
    const ed = mount('')
    ed.commands.focus('end')
    ed.commands.insertContent('@')
    expect(state(ed).active).toBe(true)
  })

  it('⛔ an email address never opens it (the @ must start a word)', () => {
    const ed = mount('write to me')
    ed.commands.focus('end')
    ed.commands.insertContent('name@tom')
    expect(state(ed).active).toBeFalsy()
  })

  it('⛔ it never opens inside a code block', () => {
    const ed = mount('x ', (t) => ({ type: 'codeBlock', content: [{ type: 'text', text: t }] }))
    ed.commands.setTextSelection(3) // the end of "x " INSIDE the block (focus('end') lands after it)
    ed.commands.insertContent('@tom')
    expect(ed.state.doc.firstChild.type.name).toBe('codeBlock')
    expect(ed.state.doc.firstChild.textContent).toBe('x @tom')
    expect(state(ed).active).toBeFalsy()
  })

  it('typing @ then choosing Tomorrow inserts a date mention (the command the Enter key runs)', () => {
    const ed = mount('Call broker ')
    ed.commands.focus('end')
    ed.commands.insertContent('@')
    runDateCommand(ed, { label: 'Tomorrow', date: '2026-10-15' }, state(ed).range)
    const json = JSON.stringify(ed.getJSON())
    expect(json).toContain('"type":"dateMention"')
    expect(json).toContain('2026-10-15')
    expect(mentions(ed)).toEqual(['2026-10-15'])
    // The "@" typed to open the list is gone, and a space follows the mention.
    expect(text(ed)).toBe('Call broker  ')
  })

  it('runDateCommand without a range inserts at the caret and removes nothing', () => {
    const ed = mount('Due ')
    ed.commands.focus('end')
    runDateCommand(ed, { label: 'Today', date: '2026-10-14' })
    expect(mentions(ed)).toEqual(['2026-10-14'])
    expect(text(ed)).toBe('Due  ')
  })

  it('runDateCommand refuses a choice with no date (the picker row) and changes nothing', () => {
    const ed = mount('Due ')
    ed.commands.focus('end')
    const before = JSON.stringify(ed.getJSON())
    expect(runDateCommand(ed, { label: 'Pick a date…', date: null, picker: true })).toBe(false)
    expect(runDateCommand(ed, { label: 'x', date: '2026-02-30' })).toBe(false)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  // The list is only real when it is drawn: a key sent to an editor whose list never rendered
  // passes through trivially. These helpers draw it (ReactRenderer needs a React tree) and wait.
  async function typeWithList(text, typed) {
    const ed = mount(text)
    render(createElement(EditorContent, { editor: ed }))
    ed.commands.focus('end')
    ed.commands.insertContent(typed)
    await waitFor(() => expect(document.getElementById('uct-date-suggest')).not.toBeNull())
    return ed
  }
  const pressKey = (ed, k) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: k })))
  const paragraphs = (ed) => ed.getJSON().content.map((n) => n.type)

  it('end to end: "@tom", ArrowDown, Enter inserts tomorrow and leaves no @tom text behind', async () => {
    const ed = await typeWithList('Call broker ', '@tom')
    await act(async () => { expect(pressKey(ed, 'ArrowDown')).toBe(true) })
    await act(async () => { expect(pressKey(ed, 'Enter')).toBe(true) })
    expect(mentions(ed)).toEqual([resolveDateWord('tomorrow', todayET())])
    expect(text(ed)).toBe('Call broker  ')
  })

  it('⛔ a bare "@" then Enter inserts NO date: it leaves the "@" and starts a new paragraph', async () => {
    const ed = await typeWithList('Buy NVDA ', '@')
    pressKey(ed, 'Enter')
    expect(mentions(ed)).toEqual([])
    expect(paragraphs(ed)).toEqual(['paragraph', 'paragraph'])
    expect(ed.state.doc.firstChild.textContent).toBe('Buy NVDA @')
  })

  it('⛔ "@tom" then Enter inserts NO date either (and "@mon", "@fri", "@next")', async () => {
    for (const q of ['@tom', '@mon', '@fri', '@next']) {
      const ed = await typeWithList('ask ', q)
      pressKey(ed, 'Enter')
      expect(mentions(ed), q).toEqual([])
      expect(paragraphs(ed), q).toEqual(['paragraph', 'paragraph'])
      expect(ed.state.doc.firstChild.textContent, q).toBe(`ask ${q}`)
      cleanup(); ed.destroy(); editor = null; document.body.innerHTML = ''
    }
  })

  it('ArrowDown then Enter on a bare "@" inserts the FIRST choice (Today)', async () => {
    const ed = await typeWithList('Due ', '@')
    await act(async () => { pressKey(ed, 'ArrowDown') })
    await act(async () => { pressKey(ed, 'Enter') })
    expect(mentions(ed)).toEqual([todayET()])
    expect(paragraphs(ed)).toEqual(['paragraph'])
  })

  it('Tab inserts the first choice with nothing selected', async () => {
    const ed = await typeWithList('Due ', '@tom')
    expect(pressKey(ed, 'Tab')).toBe(true)
    expect(mentions(ed)).toEqual([resolveDateWord('tomorrow', todayET())])
    expect(paragraphs(ed)).toEqual(['paragraph'])
  })

  describe('never beside another suggestion', () => {
    it('⛔ "[" is not a word start: "[@tom" opens nothing', () => {
      const ed = mount('see ')
      ed.commands.focus('end')
      ed.commands.insertContent('[@tom')
      expect(state(ed).active).toBeFalsy()
    })

    it('⛔ typing "@" inside an open slash command does not open the date list; Enter is not a date', async () => {
      const ed = mount('Call ')
      render(createElement(EditorContent, { editor: ed }))
      ed.commands.focus('end')
      ed.commands.insertContent('/chart AMD ')
      await waitFor(() => expect(document.getElementById('uct-slash-menu')).not.toBeNull())
      expect(slashKey.getState(ed.state).active).toBe(true) // non-vacuity: the slash session IS open
      ed.commands.insertContent('@')
      expect(slashKey.getState(ed.state).active).toBe(true)
      expect(state(ed).active).toBeFalsy()
      expect(document.getElementById('uct-date-suggest')).toBeNull()
      pressKey(ed, 'Enter')
      expect(mentions(ed)).toEqual([])
    })

    it('⛔ typing "@" inside an open [[ note link does not open the date list', () => {
      const ed = mount('See ')
      ed.commands.focus('end')
      ed.commands.insertContent('[[Weekly review ')
      expect(noteLinkMenuPluginKey.getState(ed.state).active).toBe(true) // non-vacuity
      ed.commands.insertContent('@')
      expect(noteLinkMenuPluginKey.getState(ed.state).active).toBe(true)
      expect(state(ed).active).toBeFalsy()
    })

    it('the "Due date" slash item still opens the date list (the slash session ends in the same step)', async () => {
      const ed = mount('Call broker ')
      render(createElement(EditorContent, { editor: ed }))
      ed.commands.focus('end')
      ed.commands.insertContent('/due')
      await waitFor(() => expect(document.getElementById('uct-slash-menu')).not.toBeNull())
      await act(async () => { pressKey(ed, 'ArrowDown') })
      await act(async () => { pressKey(ed, 'Enter') })
      expect(ed.state.doc.textContent).toBe('Call broker @')
      expect(slashKey.getState(ed.state).active).toBeFalsy()
      expect(state(ed).active).toBe(true)
    })
  })

  it('⛔ "@john" then Enter is NOT swallowed: no list, so Enter reaches the editor as a newline', () => {
    const ed = mount('ask ')
    ed.commands.focus('end')
    ed.commands.insertContent('@john')
    press(ed, 'Enter')
    expect(mentions(ed)).toEqual([])
    expect(ed.getJSON().content.map((n) => n.type)).toEqual(['paragraph', 'paragraph'])
    expect(ed.state.doc.firstChild.textContent).toBe('ask @john')
  })

  it('the existing input rule still turns "@tomorrow " into a mention (it was not changed)', () => {
    const ed = mount('Call ')
    ed.commands.focus('end')
    const type = (s) => {
      for (const ch of s) {
        const { from, to } = ed.state.selection
        const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
        if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
      }
    }
    type('@tomorrow ')
    expect(mentions(ed)).toEqual([resolveDateWord('tomorrow', todayET())])
  })
})
