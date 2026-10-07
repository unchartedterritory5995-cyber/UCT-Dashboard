import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateJSON, generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Toggle, ToggleSummary, ToggleContent } from './toggleNode'

const EXT = [StarterKit, Toggle, ToggleSummary, ToggleContent]

// jsdom has no layout; ProseMirror's scroll-into-view after a keyboard
// command measures rects (same stub the a11y editor tests use).
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

let editor
afterEach(() => { editor?.destroy(); editor = null })

const TOGGLE_DOC = {
  type: 'doc',
  content: [{
    type: 'toggle',
    attrs: { open: true },
    content: [
      { type: 'toggleSummary', content: [{ type: 'text', text: 'More detail' }] },
      { type: 'toggleContent', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hidden until expanded.' }] },
      ] },
    ],
  }],
}

describe('Toggle node (toggle / toggleSummary / toggleContent)', () => {
  it('parses a raw Notion-shaped <details><summary> into the three-node shape', () => {
    const json = generateJSON(
      '<details><summary>More detail</summary>Hidden until expanded.</details>', EXT,
    )
    const toggle = json.content[0]
    expect(toggle.type).toBe('toggle')
    expect(toggle.content[0].type).toBe('toggleSummary')
    expect(toggle.content[0].content[0].text).toBe('More detail')
    expect(toggle.content[1].type).toBe('toggleContent')
    expect(toggle.content[1].content[0].content[0].text).toBe('Hidden until expanded.')
  })

  it('never loses content from a bare <details> with no <summary> (the schema own fallback, no convert.js preprocessing)', () => {
    // ProseMirror's content-matching greedily lands the loose text in the
    // FIRST required slot (toggleSummary, since inline text fits there
    // directly) and auto-fills the second required slot (toggleContent)
    // with an empty paragraph -- a labeling quirk (text becomes the "title"
    // rather than the body), never a crash or a dropped node. This is the
    // schema's OWN safety net for a caller that reaches generateJSON
    // without going through convert.js's mapCalloutsAndToggles (e.g. a raw
    // paste of foreign HTML) -- the real import path always preprocesses
    // and gets the correct summary/body split (see the first test above).
    const json = generateJSON('<details>just body</details>', EXT)
    const toggle = json.content[0]
    expect(toggle.type).toBe('toggle')
    expect(toggle.content[0].type).toBe('toggleSummary')
    expect(toggle.content[0].content[0].text).toBe('just body')
    expect(toggle.content[1].type).toBe('toggleContent')
  })

  it('honors data-open="false" from a preprocessed source', () => {
    const json = generateJSON(
      '<details data-type="toggle" data-open="false"><summary>x</summary>y</details>', EXT,
    )
    expect(json.content[0].attrs.open).toBe(false)
  })

  it('round-trips through renderHTML as real <details>/<summary>', () => {
    const html = generateHTML(TOGGLE_DOC, EXT)
    expect(html).toContain('<details')
    expect(html).toContain('<summary>More detail</summary>')
    expect(html).toContain('Hidden until expanded.')
    expect(html).toContain('data-type="toggleContent"')
  })

  it('re-parses its own rendered output unchanged (copy/paste stability)', () => {
    const html = generateHTML(TOGGLE_DOC, EXT)
    const second = generateJSON(html, EXT)
    expect(second).toEqual(TOGGLE_DOC)
  })

  it('mounts in a live editor with a chevron button that flips `open` without deleting content', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: EXT, content: TOGGLE_DOC })

    const wrapper = el.querySelector('[data-type="toggle"]')
    expect(wrapper).toBeTruthy()
    expect(wrapper.getAttribute('data-open')).toBe('true')
    expect(el.textContent).toContain('More detail')
    expect(el.textContent).toContain('Hidden until expanded.')

    const chevron = el.querySelector('button.uctToggleChevron')
    expect(chevron).toBeTruthy()
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(wrapper.getAttribute('data-open')).toBe('false')
    expect(editor.getJSON().content[0].attrs.open).toBe(false)
    // Collapsing never removes the body from the document -- it is a
    // display concern only.
    expect(el.textContent).toContain('Hidden until expanded.')
  })

  it('clicking inside the summary text does not toggle `open` (native <summary> default is suppressed)', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: EXT, content: TOGGLE_DOC })

    const wrapper = el.querySelector('[data-type="toggle"]')
    const summary = el.querySelector('summary')
    summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(wrapper.getAttribute('data-open')).toBe('true')
  })

  // Lane 12T (finding from lane 12B's real-browser walk, run 5): with focus
  // on the chevron, Enter did NOT open the toggle and an empty paragraph
  // appeared in the note. The node view had no `stopEvent`, so ProseMirror
  // treated a keydown on the chevron as its own: its Enter command ran
  // against the document selection (wherever the member last typed), and any
  // other key the editor binds (Mod-b, Mod-z) edited text the member could not
  // see the caret in. The chevron is chrome: a key on it belongs to the
  // button, never to the editor.
  //
  // The doc ends with the empty paragraph StarterKit's TrailingNode puts
  // there at mount in the real page (NoteEditorPage `stripTrailingEmptyParagraph`),
  // so every node counted below is one a keystroke added.
  const PROD_DOC = {
    type: 'doc',
    content: [
      { ...structuredClone(TOGGLE_DOC.content[0]), attrs: { open: false } },
      { type: 'paragraph' },
    ],
  }

  function mountProdDoc() {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: EXT, content: PROD_DOC })
    return el
  }

  const key = (k) => new KeyboardEvent('keydown', {
    key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true,
  })

  // Where the member's caret was before they tabbed to the chevron.
  const CARETS = {
    'the empty last line': () => editor.state.doc.content.size - 1,
    'the end of the summary': () => 1 + 1 + 'More detail'.length,
  }

  for (const [where, caretAt] of Object.entries(CARETS)) {
    it(`Enter on the chevron opens and closes the toggle and never edits the text (caret on ${where})`, () => {
      const el = mountProdDoc()
      editor.commands.setTextSelection(caretAt())
      const chevron = el.querySelector('button.uctToggleChevron')
      chevron.focus()

      const down = key('Enter')
      chevron.dispatchEvent(down)
      // The button consumed it: a browser must not ALSO fire its own
      // activation click, which would toggle a second time.
      expect(down.defaultPrevented).toBe(true)
      // No paragraph added (the walk's symptom), no character changed.
      expect(editor.getJSON().content).toHaveLength(PROD_DOC.content.length)
      expect(el.querySelector('[data-type="toggle"]').getAttribute('data-open')).toBe('true')
      expect(chevron.getAttribute('aria-expanded')).toBe('true')
      // Only `open` moved.
      expect(editor.getJSON()).toEqual({
        ...PROD_DOC, content: [{ ...PROD_DOC.content[0], attrs: { open: true } }, PROD_DOC.content[1]],
      })

      chevron.dispatchEvent(key('Enter'))
      expect(editor.getJSON()).toEqual(PROD_DOC)
    })
  }

  it('Space on the chevron is left to the button: the editor does not act on it, and the activation click toggles', () => {
    const el = mountProdDoc()
    editor.commands.setTextSelection(CARETS['the empty last line']())
    const chevron = el.querySelector('button.uctToggleChevron')
    chevron.focus()
    let editorTransactions = 0
    editor.on('transaction', () => { editorTransactions += 1 })

    const down = key(' ')
    chevron.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(editorTransactions).toBe(0)
    // jsdom does not perform a button's keyup activation; fire the click a
    // browser fires for an uncancelled Space.
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(editor.getJSON().content[0].attrs.open).toBe(true)
    expect(editor.getJSON().content).toHaveLength(2)
  })

  // The same root cause without Enter: every key the editor binds, pressed
  // with focus on the chevron, ran at the document selection -- an edit the
  // member cannot see, made while they were operating a button. These keys
  // are ones the chevron's own Enter handler does not touch, so only
  // `stopEvent` keeps them out of the editor.
  const ctrl = (k) => () => new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true })
  const CHEVRON_KEYS = {
    'Mod-b bolding the selected summary word': {
      prepare: () => editor.commands.setTextSelection({ from: 2, to: 2 + 'More'.length }),
      event: ctrl('b'),
    },
    'Mod-z undoing the last edit': {
      prepare: () => editor.commands.insertContentAt(1 + 1 + 'More detail'.length, '!'),
      event: ctrl('z'),
    },
  }

  for (const [what, { prepare, event }] of Object.entries(CHEVRON_KEYS)) {
    it(`a key on the chevron never reaches the editor (${what})`, () => {
      const el = mountProdDoc()
      prepare()
      const before = editor.getJSON()
      const chevron = el.querySelector('button.uctToggleChevron')
      chevron.focus()

      chevron.dispatchEvent(event())
      expect(editor.getJSON()).toEqual(before)
    })
  }

  // Control: the same key from the same state, pressed inside the text, DOES
  // edit -- so the assertion above can fail, and a pass there means the
  // chevron kept the key, not that the key does nothing.
  for (const [what, { prepare, event }] of Object.entries(CHEVRON_KEYS)) {
    it(`control: the same key inside the text edits the document (${what})`, () => {
      const el = mountProdDoc()
      prepare()
      const before = editor.getJSON()
      el.querySelector('summary').dispatchEvent(event())
      expect(editor.getJSON()).not.toEqual(before)
    })
  }

  it('keys typed inside the summary and the body still belong to the editor', () => {
    const el = mountProdDoc()
    editor.commands.setContent({ ...PROD_DOC, content: [{ ...PROD_DOC.content[0], attrs: { open: true } }, PROD_DOC.content[1]] })

    // Body: Enter at the end of the body paragraph splits it.
    let bodyEnd = null
    editor.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === 'Hidden until expanded.') bodyEnd = pos + n.nodeSize
    })
    editor.commands.setTextSelection(bodyEnd)
    const enter = key('Enter')
    el.querySelector('[data-type="toggleContent"] p').dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(editor.getJSON().content[0].content[1].content).toHaveLength(2)

    // Summary: Mod-b on a selected word bolds it (jsdom is not a Mac, so Mod is Ctrl).
    editor.commands.setTextSelection({ from: 2, to: 2 + 'More'.length })
    const bold = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
    el.querySelector('summary').dispatchEvent(bold)
    expect(bold.defaultPrevented).toBe(true)
    const summaryText = editor.getJSON().content[0].content[0].content
    expect(summaryText[0]).toEqual({ type: 'text', text: 'More', marks: [{ type: 'bold' }] })
  })
})
