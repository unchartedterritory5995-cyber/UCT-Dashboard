import { describe, it, expect } from 'vitest'
import { generateJSON, resolveExtensions } from '@tiptap/core'
import { buildExtensions, extractPlainText } from './tiptap'

const ext = buildExtensions()
const toDoc = (html) => generateJSON(html, ext)
const types = (doc) => (doc.content || []).map((n) => n.type)

describe('import-critical editor extensions', () => {
  it('parses a plain HTML table', () => {
    const doc = toDoc('<table><tr><th>h</th></tr><tr><td>c</td></tr></table>')
    expect(types(doc)).toContain('table')
  })

  it('parses taskList HTML (the mapped shape) with checked state', () => {
    const doc = toDoc(
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true">done</li>' +
      '<li data-type="taskItem" data-checked="false">todo</li></ul>')
    const list = doc.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })

  it('round-trips an attachment chip and plain-texts it as [file: name]', () => {
    const doc = toDoc('<a data-type="attachmentChip" href="/api/x.pdf" data-name="x.pdf" data-size="10">x.pdf</a>')
    expect(types(doc)).toContain('attachmentChip')
    expect(extractPlainText(doc)).toContain('[file: x.pdf]')
  })

  it('keeps an app-relative internal note link', () => {
    const doc = toDoc('<p><a href="/journal?j2tab=notebook&note=abc123">Alpha</a></p>')
    const mark = doc.content[0].content[0].marks?.find((m) => m.type === 'link')
    expect(mark?.attrs?.href).toBe('/journal?j2tab=notebook&note=abc123')
  })

  // Regression: StarterKit v3 bundles its own unconfigured Link extension. If a
  // future StarterKit upgrade re-adds it (or `link: false` is dropped from the
  // StarterKit.configure call in buildExtensions), the schema ends up with TWO
  // 'link' extensions. ProseMirror plugins are not deduped like schema marks
  // are — the second, unconfigured copy's default openOnClick:true would fire
  // window.open(href) on every link click in the editable Notebook editor,
  // defeating this file's explicit openOnClick:false.
  it('resolves exactly one Link extension (StarterKit\'s bundled copy must stay disabled)', () => {
    const resolved = resolveExtensions(buildExtensions())
    const linkExtensions = resolved.filter((e) => e.name === 'link')
    expect(linkExtensions).toHaveLength(1)
  })
})
