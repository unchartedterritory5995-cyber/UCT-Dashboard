/**
 * Plan B final review, fix 1 — a crafted UCT JSON export's URL-bearing node attributes.
 *
 * `parseUctJsonNote` copies the stored body nearly verbatim. Before this fix only the `link`
 * MARK went through the one href policy (`resolveHref`); an attachment chip's `href`, an
 * image's `src` and a widget's archived-image `fallback.url` reached the stored body as they
 * came, and `attachmentChip.js` renders `<a href="javascript:…" download>`. Now every such
 * attribute that is not the importer's own `import-ref://` or an in-app
 * `/api/j2/notes/attachments/` address goes through `resolveHref`; a refusal turns the chip
 * or image into its visible name as plain text (never dropped silently).
 */
import { describe, expect, it } from 'vitest'
import { parseUctJsonNote } from './uctJson'

const exportOf = (bodyJson) => JSON.stringify({
  format: 'uct-notebook-note',
  version: 1,
  note: { id: 'n1', title: 'Crafted', bodyJson },
})
const doc = (...content) => ({ type: 'doc', content })
const p = (...inline) => ({ type: 'paragraph', content: inline })
const t = (text) => ({ type: 'text', text })
const parse = (bodyJson, byPath = new Map()) => parseUctJsonNote(exportOf(bodyJson), 'Notes/Crafted.json', byPath)

const UNSAFE = [
  'javascript:alert(document.cookie)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
]

// Every string anywhere in the parsed body (attrs included), so a vector can not hide.
const strings = (node, out = []) => {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) node.forEach((n) => strings(n, out))
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => strings(v, out))
  return out
}
const unsafeLeft = (body) => strings(body).filter((s) => /^\s*(java\s*script|data|vbscript):/i.test(s.replace(/[\t\n\r]/g, '')))

describe('uctJson: URL-bearing node attributes go through the one href policy', () => {
  for (const bad of UNSAFE) {
    it(`attachmentChip href ${JSON.stringify(bad)} becomes the chip's name as text`, () => {
      const out = parse(doc(p(t('see '), { type: 'attachmentChip', attrs: { href: bad, name: 'report.pdf', size: 10 } })))
      expect(unsafeLeft(out.bodyJson)).toEqual([])
      expect(out.bodyJson.content[0]).toEqual(p(t('see '), t('report.pdf')))
    })

    it(`a block-level attachmentChip href ${JSON.stringify(bad)} becomes a paragraph of its name`, () => {
      const out = parse(doc({ type: 'attachmentChip', attrs: { href: bad, name: 'report.pdf' } }))
      expect(out.bodyJson.content).toEqual([p(t('report.pdf'))])
    })

    it(`image src ${JSON.stringify(bad)} becomes its alt as text`, () => {
      const out = parse(doc({ type: 'image', attrs: { src: bad, alt: 'the chart' } }, p(t('after'))))
      expect(unsafeLeft(out.bodyJson)).toEqual([])
      expect(out.bodyJson.content).toEqual([p(t('the chart')), p(t('after'))])
      expect(out.media).toEqual([])
    })

    it(`resizableImage src ${JSON.stringify(bad)} becomes its alt as text`, () => {
      const out = parse(doc({ type: 'resizableImage', attrs: { src: bad, alt: 'sized', width: 200 } }))
      expect(out.bodyJson.content).toEqual([p(t('sized'))])
    })

    it(`an imageFigure whose image src is ${JSON.stringify(bad)} keeps its alt and caption as text`, () => {
      const out = parse(doc({ type: 'imageFigure', content: [
        { type: 'image', attrs: { src: bad, alt: 'fig alt' } },
        { type: 'imageCaption', content: [t('the caption')] }] }))
      expect(unsafeLeft(out.bodyJson)).toEqual([])
      expect(out.bodyJson.content).toEqual([p(t('fig alt')), p(t('the caption'))])
    })

    it(`widgetEmbed fallback.url ${JSON.stringify(bad)} is dropped; the widget stays`, () => {
      const out = parse(doc({ type: 'widgetEmbed', attrs: { widgetId: 'chart', searchText: 'w', fallback: { url: bad, w: 4, h: 2 } } }))
      expect(unsafeLeft(out.bodyJson)).toEqual([])
      expect(out.bodyJson.content[0].type).toBe('widgetEmbed')
      expect(out.bodyJson.content[0].attrs.widgetId).toBe('chart')
      expect(out.bodyJson.content[0].attrs.fallback).toBeNull()
    })

    it(`linkPreview / webEmbed / importNotice URL attrs ${JSON.stringify(bad)} are cleared`, () => {
      const out = parse(doc(
        { type: 'linkPreview', attrs: { url: bad, image: bad, title: 'Preview' } },
        { type: 'webEmbed', attrs: { url: bad, provider: 'youtube' } },
        { type: 'importNotice', attrs: { reason: 'fetch_failed', name: 'x.png', sourceUrl: bad, ref: 'r', attempts: 1 } },
      ))
      expect(unsafeLeft(out.bodyJson)).toEqual([])
      expect(out.bodyJson.content.map((n) => n.type)).toEqual(['linkPreview', 'webEmbed', 'importNotice'])
      expect(out.bodyJson.content[0].attrs.title).toBe('Preview')
    })
  }

  it('an unnamed chip / unlabelled image still leaves visible text', () => {
    const out = parse(doc(
      { type: 'attachmentChip', attrs: { href: 'javascript:x' } },
      { type: 'image', attrs: { src: 'javascript:x' } },
    ))
    expect(out.bodyJson.content).toEqual([p(t('file')), p(t('image'))])
  })

  it('control: safe https image src, https chip and https preview pass unchanged', () => {
    const body = doc(
      { type: 'image', attrs: { src: 'https://example.com/i.png', alt: 'ok' } },
      p(t('see '), { type: 'attachmentChip', attrs: { href: 'https://example.com/r.pdf', name: 'r.pdf' } }),
      { type: 'linkPreview', attrs: { url: 'https://example.com/p', image: 'https://example.com/p.png', title: 'P' } },
      { type: 'widgetEmbed', attrs: { widgetId: 'chart', fallback: { url: '/api/j2/notes/attachments/u/n/inline/a.png', w: 1, h: 1 } } },
    )
    expect(parse(body).bodyJson).toEqual(body)
  })

  it('control: a bundled file becomes an import-ref chip and image, unchanged by the policy', () => {
    const vfile = { path: 'Notes/files/r.pdf' }
    const img = { path: 'Notes/files/i.png' }
    const byPath = new Map([['Notes/files/r.pdf', vfile], ['Notes/files/i.png', img]])
    const out = parse(doc(
      p(t('see '), { type: 'attachmentChip', attrs: { href: 'files/r.pdf', name: 'r.pdf' } }),
      { type: 'image', attrs: { src: 'files/i.png', alt: 'bundled' } },
      { type: 'attachmentChip', attrs: { href: 'import-ref://Notes/files/r.pdf', name: 'r.pdf' } },
    ), byPath)
    expect(out.bodyJson.content[0].content[1].attrs.href).toBe('import-ref://Notes/files/r.pdf')
    expect(out.bodyJson.content[1].attrs.src).toBe('import-ref://Notes/files/i.png')
    expect(out.bodyJson.content[2].attrs.href).toBe('import-ref://Notes/files/r.pdf')
    expect(out.media.map((m) => m.ref)).toEqual(['Notes/files/r.pdf', 'Notes/files/i.png'])
  })
})
