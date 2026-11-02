/**
 * Connector fidelity (2026-11) — the `importNotice` block in the live editor.
 *
 * The node renders the sentence DERIVED from its attrs (importNoticeText.js, the copy table
 * pinned against the server by tests/test_import_notice.py), a link to the original only for
 * an http(s) address, and survives the editor's own round trip with all five attrs.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtensions, editorSchema } from './tiptap'
import { NOTEBOOK_TYPE_SCHEMA, deriveDeclaredSchema } from './notebookSchema'
import { NOTICE_COPY, importNoticeText } from './importNoticeText'

let editor = null
afterEach(() => { editor?.destroy(); editor = null; document.body.textContent = '' })

const notice = (attrs) => ({ type: 'importNotice', attrs: { reason: 'fetch_failed', name: 'chart.png', sourceUrl: null, ref: null, attempts: 3, ...attrs } })

/** A mounted editor holding `nodes`, so node views run against a real DOM. */
function mount(...nodes) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: buildExtensions(), content: { type: 'doc', content: nodes } })
  return [...element.querySelectorAll('[data-type="import-notice"]')]
}

describe('the importNotice block', () => {
  it('renders the derived text and a safe sourceUrl link', () => {
    const [dom] = mount(notice({ sourceUrl: 'https://example.com/chart.png' }))
    expect(dom).toBeTruthy()
    expect(dom.getAttribute('contenteditable')).toBe('false')
    expect(dom.textContent).toBe("Couldn't copy chart.png — open the original")
    const links = dom.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://example.com/chart.png')
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
    expect(links[0].textContent).toBe('open the original')
    // the icon is UIcon's own glyph, never an emoji
    expect(dom.querySelector('.uctImportNoticeIcon svg')).toBeTruthy()
  })

  it('never renders a javascript: sourceUrl as a link', () => {
    // `javascript://host/…` and `file://host/…` HAVE a host: only the scheme check refuses them.
    const bad = ['javascript:alert(1)', 'javascript://example.com/%0Aalert(1)', 'data:text/html,<b>x</b>',
      'vbscript:msgbox(1)', 'file:///c/chart.png', 'file://server/chart.png', 'JavaScript:alert(1)']
    const doms = mount(...bad.map((sourceUrl) => notice({ sourceUrl })))
    expect(doms).toHaveLength(bad.length)
    for (const dom of doms) {
      expect(dom.querySelector('a')).toBe(null)
      expect(dom.textContent).toBe("Couldn't copy chart.png")
    }
    // and the static HTML (a copy) carries no unsafe href either
    const html = editor.getHTML()
    expect(html).not.toMatch(/href="(?:javascript|data|vbscript|file):/i)
    expect(html).not.toContain('<a ')
  })

  it.each(['upload_failed', 'type_refused', 'unresolvable_src', 'decode_failed', 'missing_resource'])(
    'renders the client reason %s from node JSON alone', (reason) => {
      const [dom] = mount(notice({ reason, attempts: 0 }))
      expect(dom.textContent).toBe(NOTICE_COPY[reason].replace('{name}', 'chart.png'))
      expect(dom.textContent).not.toContain('{name}')
    })

  it('an unknown reason renders the unsupported sentence', () => {
    const [unknown, missing, named] = mount(notice({ reason: 'from_the_future' }), notice({ reason: null, name: null }),
      notice({ reason: 'too-large' }))
    expect(unknown.textContent).toBe("chart.png can't be shown here")
    expect(missing.textContent).toBe("this item can't be shown here")
    expect(named.textContent).toBe('chart.png is too large to copy (limit 25 MB)')
  })

  it('says "retrying" while attempts are left, and the final sentence after', () => {
    expect(importNoticeText({ reason: 'fetch_failed', name: 'a.png', attempts: 1 })).toBe("Couldn't copy a.png — retrying on the next sync")
    expect(importNoticeText({ reason: 'fetch_failed', name: 'a.png', attempts: 3 })).toBe("Couldn't copy a.png")
    expect(importNoticeText({ reason: 'unsupported', name: '$& $1' })).toBe("$& $1 can't be shown here")
    expect(importNoticeText(undefined)).toBe("this item can't be shown here")
  })

  it('round-trips through getJSON with all five attrs', () => {
    const attrs = { reason: 'fetch_failed', name: 'chart.png', sourceUrl: 'https://example.com/chart.png', ref: 'r-1', attempts: 2 }
    mount({ type: 'importNotice', attrs })
    const out = editor.getJSON().content.find((n) => n.type === 'importNotice')
    expect(out.attrs).toEqual(attrs)
    // defaults: null, and attempts 0
    editor.destroy()
    mount({ type: 'importNotice' })
    expect(editor.getJSON().content[0].attrs).toEqual({ reason: null, name: null, sourceUrl: null, ref: null, attempts: 0 })
    // and the static HTML parses back to the same attrs
    editor.destroy()
    mount({ type: 'importNotice', attrs })
    const html = editor.getHTML()
    editor.destroy()
    const element = document.createElement('div')
    editor = new Editor({ element, extensions: buildExtensions(), content: html })
    expect(editor.getJSON().content.find((n) => n.type === 'importNotice').attrs).toEqual(attrs)
  })

  it('updates its words in place when its attrs change', () => {
    const [dom] = mount(notice({ attempts: 1 }))
    expect(dom.textContent).toBe("Couldn't copy chart.png — retrying on the next sync")
    editor.commands.command(({ tr }) => { tr.setNodeMarkup(0, undefined, { ...tr.doc.firstChild.attrs, attempts: 3 }); return true })
    const now = editor.view.dom.querySelector('[data-type="import-notice"]')
    expect(now.textContent).toBe("Couldn't copy chart.png")
  })

  it('a refused copy reads a notice as its sentence and the address as words (refusedCopyDisplay)', async () => {
    const { copyBodyText, copyHasHiddenItems } = await import('./offline/refusedCopyDisplay')
    const body = { type: 'doc', content: [notice({ sourceUrl: 'https://example.com/chart.png' }), notice({ reason: 'unsafe', sourceUrl: null })] }
    expect(copyBodyText(body)).toBe("Couldn't copy chart.png (https://example.com/chart.png)\nchart.png wasn't copied: its address isn't allowed")
    expect(copyHasHiddenItems(body)).toBe(false)
  })

  it('is registered in buildExtensions and in NOTEBOOK_TYPE_SCHEMA at 5', () => {
    const schema = editorSchema()
    expect(schema.nodes.importNotice).toBeTruthy()
    expect(schema.nodes.importNotice.isBlock && schema.nodes.importNotice.isAtom).toBe(true)
    expect(schema.nodes.importNotice.spec.selectable).toBe(true)
    expect(NOTEBOOK_TYPE_SCHEMA.importNotice).toBe(5)
    // this bundle reads every level, the notice's included
    expect(deriveDeclaredSchema(schema)).toBe(5)
  })
})
