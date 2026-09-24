// Wave 5 — the `:` emoji picker. Real editor, real roster, real Suggestion.
import { describe, it, expect, afterEach } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { getSchema } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildExtensions } from '../../lib/tiptap'
import { EMOJI, EMOJI_QUERY_RE, SHORTCODE_BODY, emojiByName, searchEmoji } from '../../lib/emojiData'
import { ITEMS } from './SlashMenu'
import { EMOJI_INPUT_PATTERN, EMOJI_MENU_ID, EMOJI_MENU_MIN_QUERY } from './EmojiMenu'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
afterEach(() => { cleanup(); document.body.innerHTML = '' })
// Mounted through React's EditorContent, as the page mounts it: the menu is a
// ReactRenderer, which renders through the editor's content component and
// renders NOTHING for an editor built with bare `new Editor()`.
// `text` becomes ONE paragraph (JSON, not HTML: an HTML parse would collapse
// the leading/trailing spaces these rails depend on); the caret ends it.
async function mount(text = '') {
  const content = text && text.startsWith('<') ? text
    : { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] }
  let editor = null
  function Host() {
    const ed = useEditor({ extensions: buildExtensions(), content, immediatelyRender: true })
    editor = ed
    return <EditorContent editor={ed} />
  }
  render(<Host />)
  await settle()
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1) })
  return editor
}
// The Suggestion plugin's view update is ASYNC (it awaits `items`), and the
// list is a React render: every step settles before the rail looks.
async function type(ed, text) {
  for (const ch of text) {
    await act(async () => {
      const { from, to } = ed.state.selection
      const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
      if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
    })
    await settle()
  }
}
async function key(ed, k) {
  let handled
  await act(async () => { handled = ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: k }))) })
  await settle()
  return Boolean(handled)
}
const menu = () => document.getElementById(EMOJI_MENU_ID)
const visibleMenu = () => { const m = menu(); return m && m.parentElement?.style.display !== 'none' ? m : null }
const options = () => [...(menu()?.querySelectorAll('[role="option"]') || [])]

describe('the curated list', () => {
  it('every shortcode is unique and shortcode-shaped; every entry is ONE character a reader sees', async () => {
    const names = EMOJI.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length)
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
    for (const e of EMOJI) {
      expect(EMOJI_QUERY_RE.test(e.name), e.name).toBe(true)
      expect([...seg.segment(e.char)].length, `${e.name} is one grapheme`).toBe(1)
    }
    expect(EMOJI.length).toBeGreaterThan(100) // non-vacuity
  })

  it('ranks a shortcode prefix first, then a contained name, then a keyword; caps the list', async () => {
    expect(searchEmoji('roc')[0].char).toBe('🚀')
    expect(searchEmoji('bull').map((e) => e.char)).toContain('🐂') // keyword
    expect(searchEmoji('chart').slice(0, 2).map((e) => e.char)).toEqual(['📈', '📉'])
    expect(searchEmoji('a').length).toBe(8)
  })

  it('a query that is not shortcode-shaped matches nothing (":)", ": ", "")', async () => {
    expect(searchEmoji(')')).toEqual([])
    expect(searchEmoji(' ')).toEqual([])
    expect(searchEmoji('')).toEqual([])
    expect(emojiByName('ROCKET').char).toBe('🚀')
    expect(emojiByName('nope')).toBe(null)
  })
})

describe('typing : and a name', () => {
  it('opens a labelled listbox; Enter inserts the emoji as TEXT in place of ":roc"', async () => {
    const ed = await mount('Breakout ')
    await type(ed, ':roc')
    expect(visibleMenu()?.getAttribute('aria-label')).toBe('Insert emoji')
    expect(options()[0].getAttribute('aria-label')).toBe('🚀 rocket')
    // Combobox wiring on the focused element (the editor).
    expect(ed.view.dom.getAttribute('role')).toBe('combobox')
    expect(ed.view.dom.getAttribute('aria-activedescendant')).toBe(`${EMOJI_MENU_ID}-opt-0`)
    expect(await key(ed, 'Enter')).toBe(true)
    expect(ed.state.doc.textContent).toBe('Breakout 🚀')
    expect(menu()).toBe(null)
    expect(ed.view.dom.getAttribute('role')).toBe(null)
  })

  it('↓ then Tab picks the second match', async () => {
    const ed = await mount(' ')
    await type(ed, ':chart')
    await key(ed, 'ArrowDown')
    expect(await key(ed, 'Tab')).toBe(true)
    expect(ed.state.doc.textContent).toBe(' 📉')
  })

  it('a tap on a row inserts it (the touch door)', async () => {
    const ed = await mount(' ')
    await type(ed, ':fir')
    await act(async () => { options()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })
    await settle()
    expect(ed.state.doc.textContent).toBe(' 🔥')
  })

  it('the emoji is plain text: no emoji node type exists, and the saved JSON holds the character', async () => {
    expect(Object.keys(getSchema(buildExtensions()).nodes)).not.toContain('emoji')
    const ed = await mount(' ')
    await type(ed, ':rocket')
    await key(ed, 'Enter')
    expect(JSON.stringify(ed.getJSON())).toContain('🚀')
  })

  it('Escape dismisses the menu and leaves the text; the next ":" re-arms', async () => {
    const ed = await mount(' ')
    await type(ed, ':roc')
    expect(await key(ed, 'Escape')).toBe(true)
    expect(visibleMenu()).toBe(null)
    expect(ed.state.doc.textContent).toBe(' :roc')
    await type(ed, ' :fire')
    expect(visibleMenu()).not.toBe(null)
  })

  it('`:rocket:` typed whole converts on the closing colon; an unknown shortcode stays text', async () => {
    const ed = await mount(' ')
    await type(ed, ':rocket: and :notaname: ')
    expect(ed.state.doc.textContent).toBe(' 🚀 and :notaname: ')
  })
})

describe('a note full of colons never opens it (and never eats a key)', () => {
  it.each([
    ['a time', 'Open at 10:30'],
    ['a label', 'Note: margins'],
    ['a ratio', 'ratio 3:1'],
    ['a smiley', 'fine :)'],
    ['a lone colon', 'list : '],
  ])('%s: %j', async (_label, text) => {
    const ed = await mount('')
    await type(ed, text)
    expect(visibleMenu()).toBe(null)
    // Enter stays the editor's own: a new line, the text untouched.
    await key(ed, 'Enter')
    expect(ed.state.doc.childCount).toBe(2)
    expect(ed.state.doc.firstChild.textContent).toBe(text)
  })

  it('inside a code block', async () => {
    const ed = await mount('<pre><code>x</code></pre>')
    ed.commands.setTextSelection(2)
    await type(ed, ' :roc')
    expect(visibleMenu()).toBe(null)
  })
})

// S2 (wave-5 review): a one-character floor armed the menu on emoticons, so
// "great day :D" + Enter inserted an emoji and ate the new line.
describe('an emoticon is never an emoji: the menu opens from two characters', () => {
  it('" :D" then Enter makes a new paragraph and leaves the text', async () => {
    const ed = await mount('great day')
    await type(ed, ' :D')
    expect(visibleMenu()).toBe(null)
    await key(ed, 'Enter')
    expect(ed.state.doc.childCount).toBe(2)
    expect(ed.state.doc.firstChild.textContent).toBe('great day :D')
  })

  it('" :P" then Tab is not swallowed: the editor leaves it to the browser and the text is untouched', async () => {
    const ed = await mount('ok')
    await type(ed, ' :P')
    expect(visibleMenu()).toBe(null)
    expect(await key(ed, 'Tab')).toBe(false)
    expect(ed.state.doc.textContent).toBe('ok :P')
  })

  it.each([':O', ':x', ':v', ':1'])('%j (one character, and it would match) opens nothing', async (typed) => {
    expect(searchEmoji(typed.slice(1)).length).toBeGreaterThan(0) // the floor, not the shape, keeps it shut
    const ed = await mount('3')
    await type(ed, ` ${typed}`)
    expect(visibleMenu()).toBe(null)
  })

  it('two characters open it (the floor is exactly EMOJI_MENU_MIN_QUERY)', async () => {
    expect(EMOJI_MENU_MIN_QUERY).toBe(2)
    const ed = await mount('')
    await type(ed, ' :ro')
    expect(visibleMenu()).not.toBe(null)
  })

  it('a one-letter shortcode still converts typed whole: " :x: "', async () => {
    const ed = await mount('')
    await type(ed, ' :x: ')
    expect(ed.state.doc.textContent).toBe(' ❌ ')
  })
})

// N2 (wave-5 review): the menu read `:Rocket` but typed `:Rocket:` never
// converted -- two hand-written copies of one shortcode shape.
describe('the menu and the typed-whole rule read ONE shortcode shape', () => {
  it('`:Rocket:` typed whole converts, exactly as picking `:Rocket` from the menu does', async () => {
    const ed = await mount('')
    await type(ed, ' :Rocket: ')
    expect(ed.state.doc.textContent).toBe(' 🚀 ')
    const ed2 = await mount('')
    await type(ed2, ' :Rocket')
    expect(await key(ed2, 'Enter')).toBe(true)
    expect(ed2.state.doc.textContent).toBe(' 🚀')
  })

  it('both are built from SHORTCODE_BODY', () => {
    expect(EMOJI_QUERY_RE.source).toContain(SHORTCODE_BODY)
    expect(EMOJI_INPUT_PATTERN.source).toContain(SHORTCODE_BODY)
    expect(EMOJI_QUERY_RE.flags).toContain('i')
    expect(EMOJI_INPUT_PATTERN.flags).toContain('i')
  })
})

describe('the slash door', () => {
  it('"Emoji" starts a picker session, adding the space a word needs', async () => {
    const ed = await mount('word/em')
    const item = ITEMS.find((it) => it.title === 'Emoji')
    const end = ed.state.doc.content.size - 1
    await act(async () => { item.command({ editor: ed, range: { from: end - 3, to: end } }) })
    await settle()
    expect(ed.state.doc.textContent).toBe('word :')
    await type(ed, 'roc')
    expect(visibleMenu()).not.toBe(null)
  })
})
