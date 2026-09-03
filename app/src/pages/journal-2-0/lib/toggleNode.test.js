import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateJSON, generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Toggle, ToggleSummary, ToggleContent } from './toggleNode'

const EXT = [StarterKit, Toggle, ToggleSummary, ToggleContent]

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
})
