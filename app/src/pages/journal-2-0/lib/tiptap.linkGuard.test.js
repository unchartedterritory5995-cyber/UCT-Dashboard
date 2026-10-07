/**
 * A link in a note never carries a `class`, and carries a `title` only when it is plain,
 * bounded text (security lane, round 3).
 *
 * The stock Link mark declares `class` and `title` attributes and renders whatever a stored
 * mark holds. A pasted or imported `<a class="...">`, or a note body written through the
 * API, could therefore put any class name the app's stylesheet defines onto a link (an
 * overlay, a backdrop, a hidden element). `lib/tiptap.js` now configures the Notebook's own
 * Link so a class is never read and never rendered. Driven on the REAL extension list.
 */
import { describe, expect, it } from 'vitest'
import { Editor, generateJSON } from '@tiptap/core'
import fs from 'node:fs'
import path from 'node:path'
import { buildExtensions, safeLinkTitle } from './tiptap'
import { htmlToNote } from './importer/convert'

const CASES = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../../../tests/fixtures/notebook_text_style_cases.json'), 'utf8')).link_title

const doc = (attrs) => ({ type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'x', marks: [{ type: 'link', attrs }] }] }] })

function renderLink(attrs) {
  const el = document.createElement('div')
  const editor = new Editor({ element: el, extensions: buildExtensions(), content: doc(attrs) })
  const a = el.querySelector('p a')
  const out = a ? Object.fromEntries([...a.attributes].map((x) => [x.name, x.value])) : null
  editor.destroy()
  return out
}

describe('a stored link', () => {
  it('renders no class, whatever the stored mark holds', () => {
    for (const cls of ['uct-overlay modal-backdrop', 'hidden', 'x" onmouseover="alert(1)', 'a'.repeat(5000)]) {
      const out = renderLink({ href: 'https://example.com/a', class: cls, target: '_blank', rel: 'noreferrer' })
      expect(out).toEqual({ target: '_blank', rel: 'noreferrer', href: 'https://example.com/a' })
    }
  })

  it('an ordinary link renders exactly as it did (the control)', () => {
    expect(renderLink({ href: 'https://example.com/a', target: '_blank', rel: 'noreferrer', class: null, title: null }))
      .toEqual({ target: '_blank', rel: 'noreferrer', href: 'https://example.com/a' })
    expect(renderLink({ href: '/journal/notebook?note=abc' }).href).toBe('/journal/notebook?note=abc')
  })

  it.each(CASES.accept)('keeps the plain title %j', (title) => {
    expect(safeLinkTitle(title)).toBe(title)
    expect(renderLink({ href: 'https://example.com/a', title }).title).toBe(title)
  })

  it.each(CASES.reject)('drops the title %j', (title) => {
    expect(safeLinkTitle(title)).toBeNull()
    expect(renderLink({ href: 'https://example.com/a', title })).not.toHaveProperty('title')
  })

  it('a title that is not text is dropped', () => {
    for (const title of [5, true, {}, ['x'], null, undefined]) expect(safeLinkTitle(title)).toBeNull()
  })
})

describe('paste and import', () => {
  const HTML = '<p><a href="https://example.com/a" class="uct-overlay modal-backdrop" title="Read the guide">ok</a>'
    + '<a href="https://example.com/b" class="hidden" title="bad‮title">two</a></p>'

  const links = (json) => json.content[0].content.map((n) => n.marks[0].attrs)

  it('paste: a class is never read, and only a plain title is', () => {
    const [one, two] = links(generateJSON(HTML, buildExtensions()))
    expect(one.class).toBeNull()
    expect(one.title).toBe('Read the guide')
    expect(one.href).toBe('https://example.com/a')
    expect(two.class).toBeNull()
    expect(two.title).toBeNull()
  })

  it('import: the importer goes through the same Link', () => {
    const { bodyJson } = htmlToNote(HTML, {})
    const text = JSON.stringify(bodyJson)
    expect(text).not.toContain('uct-overlay')
    expect(text).not.toContain('hidden')
    expect(text).toContain('Read the guide')
  })
})
