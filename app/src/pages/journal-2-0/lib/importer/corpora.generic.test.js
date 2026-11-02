/**
 * Plan B Task 12 (spec §10): the GENERIC (md / html / docx) corpus and our own UCT JSON export,
 * through the real client import path (`__tests__/corpora.harness.js`), asserted on the stored body and
 * the rendered DOM, raw. Plus the inputs too big to commit, built in memory: a data: image over
 * the 25 MB cap and an archive past the entry limit.
 *
 * `generic/notes/*.md` link each other (same import), a note that is not there, and carry the
 * link-policy vectors in the Markdown lane; `generic/page.html` carries them in the HTML lane
 * (`java&#9;script:`, an upper-case scheme with a leading space, data: links and images,
 * a relative link and image with no source to resolve against, CJK punctuation). The .docx is
 * built in memory (a Word file is a zip; nothing about it needs committing).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { zipSync, strToU8 } from 'fflate'
import {
  importCorpus, folderDrop, zipDrop, fixtureBytes, vfileOf, renderBody, destroyEditors, renderedLinks, renderedImgs,
  renderedNotices, storedLinks, storedText, nodes, noteHref, assertCorpusInvariants, ATTACH,
} from './__tests__/corpora.harness'
import { expandArchives, ImportLimitError } from './intake'
import { MEDIA_SOURCE_MAX_BYTES } from './mediaRefs'
import { openableLinkHref, internalNoteIdFromHref, pendingLinkFallbackHref } from '../linkClickOpen'

// The Word path runs the REAL mammoth conversion; vitest resolves mammoth's NODE entry, whose
// unzip takes `{buffer}` (census.test.js, same map, nothing else stubbed).
vi.mock('mammoth', async (importOriginal) => {
  const real = await importOriginal()
  const m = real.default || real
  const convertToHtml = (input, options) =>
    m.convertToHtml(input && input.arrayBuffer ? { buffer: Buffer.from(input.arrayBuffer) } : input, options)
  return { ...real, convertToHtml, default: { ...m, convertToHtml } }
})

afterEach(destroyEditors)

const linksIn = (body, startsWith) => {
  const p = [...renderBody(body).querySelectorAll('p')].find((x) => x.textContent.startsWith(startsWith))
  expect(p, startsWith).toBeTruthy()
  return renderedLinks(p).map(({ text, href }) => ({ text, href }))
}
const paragraph = (body, startsWith) => [...renderBody(body).querySelectorAll('p')].find((x) => x.textContent.startsWith(startsWith))

describe('generic corpus: Markdown + HTML', () => {
  let run
  beforeAll(async () => {
    run = await importCorpus(folderDrop('generic'), { expectAdapter: 'file' })
  })
  const ALPHA = 'file:notes/Alpha.md'
  const body = (k) => run.storedByKey.get(k)

  it('every note imports; two pictures that could not come over are named once each', () => {
    expect(run.docs.map((d) => d.importKey).sort()).toEqual(['file:notes/Alpha.md', 'file:notes/Beta.md', 'file:notes/sub/Gamma.md', 'file:page.html'])
    expect(run.summary.created).toBe(4)
    expect(run.summary.failures).toEqual([])
    expect(run.summary.notices.map((n) => [n.note, n.reason, n.name])).toEqual([
      ['Saved page', 'decode_failed', null], ['Saved page', 'unresolvable_src', '/local/only.png']])
    expect(run.summary.unconnectedLinks).toEqual([])
  })

  it('every written note holds the corpus-wide invariants (stored + rendered)', () => {
    expect(assertCorpusInvariants(run)).toBe(4)
  })

  it('same-import .md links are note links (sibling, sub-folder, ./ and ../); a missing one is text', () => {
    expect(linksIn(body(ALPHA), 'Sibling')).toEqual([
      { text: 'Beta note', href: noteHref(run.idOf('file:notes/Beta.md')) },
      { text: 'Gamma', href: noteHref(run.idOf('file:notes/sub/Gamma.md')) },
    ])
    expect(paragraph(body(ALPHA), 'Sibling').textContent).toBe('Sibling: Beta note and nested Gamma and missing Delta.')
    expect(storedLinks(body('file:notes/Beta.md'))).toEqual([{ text: 'Alpha', href: noteHref(run.idOf(ALPHA)) }])
    expect(storedLinks(body('file:notes/sub/Gamma.md'))).toEqual([{ text: 'Alpha', href: noteHref(run.idOf(ALPHA)) }])
  })

  it('Markdown lane: javascript:, vbscript:, file: links are their text; tel:, //host and https are kept', () => {
    const p = paragraph(body(ALPHA), 'Unsafe')
    expect(p.textContent).toBe('Unsafe: js and vb and file.')
    expect(p.querySelector('a')).toBeNull()
    expect(linksIn(body(ALPHA), 'Kept')).toEqual([
      { text: 'phone', href: 'tel:+15550100' },
      { text: 'proto', href: 'https://example.org/p' },
      { text: 'site', href: 'https://example.com/md' },
    ])
  })

  it('media inside a link is lifted: the copied picture, then the link line', () => {
    const b = body(ALPHA)
    const at = b.content.findIndex((n) => n.type === 'image' && n.attrs.alt === 'chart')
    expect(b.content[at].attrs.src).toBe(`${ATTACH}${run.idOf(ALPHA)}/inline/fetched-linked.png`)
    expect(b.content[at + 1]).toMatchObject({ type: 'paragraph', content: [{ text: 'https://example.com/big',
      marks: [{ type: 'link', attrs: { href: 'https://example.com/big' } }] }] })
  })

  it('prose: NVDA.US stays text, www gets https, trailing punctuation is not in the link', () => {
    expect(linksIn(body(ALPHA), 'Prose')).toEqual([
      { text: 'www.example.com/b', href: 'https://www.example.com/b' },
      { text: 'https://example.com/end', href: 'https://example.com/end' },
    ])
    expect(paragraph(body(ALPHA), 'Prose').textContent).toBe('Prose: NVDA.US closed at 120. See www.example.com/b, then https://example.com/end.')
  })

  it('a URL in a code fence or in math is untouched', () => {
    const root = renderBody(body(ALPHA))
    expect(root.querySelector('pre').textContent.trim()).toBe('https://example.com/in-fence')
    expect(root.querySelector('pre a')).toBeNull()
    expect(root.querySelector('[data-type="inline-math"]').getAttribute('data-latex')).toBe('a = https://example.com/m')
    expect(storedLinks(body(ALPHA)).some((l) => /in-fence|example\.com\/m$/.test(l.href))).toBe(false)
  })

  it('a local picture uploads with its bytes and declared type', () => {
    const [pic] = run.server.uploads.filter((u) => u.name === 'pic.png' && u.status === 200)
    expect(pic.type).toBe('image/png')
    expect([...pic.bytes]).toEqual([...fixtureBytes('generic/notes/sub/pic.png')])
  })

  it('HTML lane: java<TAB>script:, " JAVASCRIPT:", data: links and a relative link with no source are text', () => {
    const b = body('file:page.html')
    expect(paragraph(b, 'tabbed').textContent).toBe('tabbed js upper js data link')
    expect(paragraph(b, 'tabbed').querySelector('a')).toBeNull()
    expect(linksIn(b, 'relative')).toEqual([{ text: 'ok', href: 'https://example.com/ok' }])
  })

  it('HTML lane data: images: base64 and percent-encoded are uploaded as bytes; malformed is a notice', () => {
    const n = run.idOf('file:page.html')
    const ups = run.server.uploads.filter((u) => u.noteId === n && u.status === 200)
    expect(ups.map((u) => [u.name, u.type])).toEqual([['image.png', 'image/png'], ['image.png', 'image/png']])
    // the percent-encoded payload decodes to BYTES, never to the URL's characters
    expect([...ups[1].bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode('genericpct')])
    const b = body('file:page.html')
    expect(renderedImgs(renderBody(b))).toEqual([`${ATTACH}${n}/inline/3-image.png`, `${ATTACH}${n}/inline/4-image.png`])
    expect(nodes(b, 'importNotice').map((x) => [x.attrs.reason, x.attrs.name])).toEqual([['decode_failed', null], ['unresolvable_src', '/local/only.png']])
  })

  it('a relative <img> with no source URL is never fetched from our own site', () => {
    expect(run.server.fetches.map((f) => f.url)).toEqual(['https://cdn.example.com/linked.png', 'https://cdn.example.com/linked.png'])
    expect(renderedNotices(renderBody(body('file:page.html'))).map((x) => x.text)).toContain("Couldn't find the image file for /local/only.png")
  })

  it('HTML lane CJK: a www glued after a space stops at the full stop; a fullwidth comma ends a URL', () => {
    expect(linksIn(body('file:page.html'), 'CJK')).toEqual([
      { text: 'www.example.com', href: 'https://www.example.com' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
    ])
    expect(renderBody(body('file:page.html')).querySelector('code').textContent).toBe('www.example.com/in-code')
  })
})

// ── a Word file, built in memory ─────────────────────────────────────────────

function docx(paragraphsXml, rels) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraphsXml}</w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + rels.map(([id, target]) => `<Relationship Id="${id}" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>`).join('') + '</Relationships>'),
  })
}
const run_ = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (...xs) => `<w:p>${xs.join('')}</w:p>`
const hyper = (id, text) => `<w:hyperlink r:id="${id}">${run_(text)}</w:hyperlink>`

describe('generic corpus: a .docx', () => {
  let run
  beforeAll(async () => {
    const bytes = docx([
      para(run_('Word link: '), hyper('rId5', 'docx site'), run_(' and '), hyper('rId6', 'macro')),
      para(run_('Typed: www.example.com/docx, NVDA.US.')),
    ].join(''), [['rId5', 'https://example.com/docx'], ['rId6', 'javascript:alert(1)']])
    run = await importCorpus([vfileOf('Plan.docx', bytes)], { expectAdapter: 'file' })
  })

  it('a Word hyperlink is kept, a javascript: one is its text, typed www is linked', () => {
    expect(run.docs).toHaveLength(1)
    const b = run.bodyOf('Plan')
    expect(storedLinks(b)).toEqual([
      { text: 'docx site', href: 'https://example.com/docx' },
      { text: 'www.example.com/docx', href: 'https://www.example.com/docx' },
    ])
    expect(storedText(b)).toBe('Word link: docx site and macroTyped: www.example.com/docx, NVDA.US.')
    expect(assertCorpusInvariants(run)).toBe(1)
  })
})

// ── our own JSON export ──────────────────────────────────────────────────────

describe('UCT JSON export corpus', () => {
  let run
  beforeAll(async () => {
    run = await importCorpus(zipDrop('uct', 'uct-export.zip'), { expectAdapter: 'uct-export' })
  })

  it('a crafted javascript: link mark (plain and tab-split) drops the MARK and keeps the text and bold', () => {
    const b = run.bodyOf('Crafted')
    const runs = b.content[0].content.filter((n) => n.type === 'text')
    expect(runs[0]).toEqual({ type: 'text', text: 'click me', marks: [{ type: 'bold' }] })
    expect(runs.find((r) => r.text === 'tabbed')).toEqual({ type: 'text', text: 'tabbed', marks: [] })
    expect(storedLinks(b)).toEqual([{ text: 'a real site', href: 'https://example.com/uct' }])
    expect(renderedLinks(renderBody(b)).map(({ text, href }) => ({ text, href }))).toEqual([{ text: 'a real site', href: 'https://example.com/uct' }])
  })

  it('a note link to a note in the same archive is re-pointed at its new id', () => {
    const [link] = nodes(run.bodyOf('Crafted'), 'noteLink')
    expect(link.attrs.noteId).toBe(run.idOf('uct:orig-levels'))
    expect(renderBody(run.bodyOf('Crafted')).querySelector('[data-note-id]').getAttribute('data-note-id')).toBe(run.idOf('uct:orig-levels'))
  })

  it('a bundled attachment uploads with its bytes and renders', () => {
    const [up] = run.server.uploads.filter((u) => u.status === 200)
    expect([up.name, up.type]).toEqual(['levels.png', 'image/png'])
    expect([...up.bytes]).toEqual([...fixtureBytes('uct/UCT Export/Trading/attachments/levels.png')])
    expect(renderedImgs(renderBody(run.bodyOf('Crafted')))).toEqual([`${ATTACH}${run.idOf('uct:orig-crafted')}/inline/2-levels.png`])
    expect(assertCorpusInvariants(run)).toBe(2)
  })
})

// ── too big to commit: built in memory ───────────────────────────────────────

describe('inputs built in memory', () => {
  it('a data: image over the 25 MB cap is a too_large notice, uploaded never', async () => {
    const payload = 'A'.repeat(Math.ceil(((MEDIA_SOURCE_MAX_BYTES + 1) * 4) / 3) + 8192)
    const html = `<html><body><h1>Huge</h1><p>Big: <img src="data:image/png;base64,${payload}"></p><p>after</p></body></html>`
    const run = await importCorpus([vfileOf('huge.html', strToU8(html))], { expectAdapter: 'file' })
    const b = run.bodyOf('Huge')
    expect(nodes(b, 'importNotice').map((n) => [n.attrs.reason, n.attrs.name])).toEqual([['too_large', null]])
    expect(run.server.uploads).toEqual([])
    expect(run.server.putsRaw.map((p) => p.importMediaPending)).toEqual([true])
    expect(JSON.stringify(b).length).toBeLessThan(2000)
    expect(assertCorpusInvariants(run)).toBe(1)
  }, 30_000)

  it('an archive past the entry limit is refused by name, before any parse', async () => {
    const entries = {}
    for (let i = 0; i <= 20_000; i++) entries[`n/${i}.md`] = strToU8('x')
    const bomb = zipSync(entries, { level: 0 })
    await expect(expandArchives([vfileOf('bomb.zip', bomb)])).rejects.toBeInstanceOf(ImportLimitError)
    await expect(expandArchives([vfileOf('bomb.zip', bomb)])).rejects.toThrow('This import has more than 20,000 files.')
  }, 30_000)
})

// ── defects the corpora exposed, recorded strictly (spec §10: never normalised away) ───────

describe('B-14: every imported link has a door or is plain text (the defect Task 12 found)', () => {
  // Task 12 recorded these six as stored inert links (`resolveHref` kept any scheme it did not
  // know). The controller ruling: a kept link must have a door, so each is now plain text that
  // keeps its visible text -- or its URL, when the link had no text of its own.
  const NO_DOOR = ['tel:+1 555 0100 ext 2', 'ftp://example.com/f', 'sms:+15550100?body=hi', 'https://example.com/a b', 'https://user:pw@example.com/', 'mailto:']
  // ...while these stay links, and the door opens them (tel:/sms: normalised).
  const KEPT = [
    ['tel:+1 555 0100', 'tel:+15550100'], ['sms:+15550100', 'sms:+15550100'],
    ['mailto:desk@example.com', 'mailto:desk@example.com'], ['https://example.com/a', 'https://example.com/a'],
  ]
  let body
  beforeAll(async () => {
    const html = '<html><body><h1>Doors</h1>'
      + NO_DOOR.map((h, i) => `<p>N${i}: <a href="${h}">L${i}</a></p>`).join('')
      + NO_DOOR.map((h, i) => `<p>E${i}: <a href="${h}"></a></p>`).join('')
      + KEPT.map(([h], i) => `<p>K${i}: <a href="${h}">K${i}</a></p>`).join('')
      + '</body></html>'
    const run = await importCorpus([vfileOf('doors.html', strToU8(html))], { expectAdapter: 'file' })
    body = run.bodyOf('Doors')
  })

  it('no stored or rendered link is left without a door', () => {
    const doorless = renderedLinks(renderBody(body))
      .filter((l) => !l.plain && !(openableLinkHref(l.href) || internalNoteIdFromHref(l.href) || pendingLinkFallbackHref(l.href)))
      .map((l) => l.href)
    expect(doorless).toEqual([])
  })

  it.each(NO_DOOR.map((h, i) => [h, i]))('%s becomes its visible text', (_h, i) => {
    const p = paragraph(body, `N${i}:`)
    expect(p.textContent).toBe(`N${i}: L${i}`)
    expect(p.querySelector('a')).toBeNull()
  })

  it.each(NO_DOOR.map((h, i) => [h, i]))('%s with no text of its own keeps its URL as text', (h, i) => {
    const p = paragraph(body, `E${i}:`)
    expect(p.textContent).toBe(`E${i}: ${h}`)
    // The URL is now prose, so linkify reads it like any other prose: `https://example.com/a b`
    // yields a link on `https://example.com/a` (a door), never one on the refused href.
    expect(renderedLinks(p).map((l) => l.href)).toEqual(h === 'https://example.com/a b' ? ['https://example.com/a'] : [])
  })

  it('tel: with spaces, sms:, mailto: and https stay links, and the door opens each', () => {
    const got = KEPT.map((_, i) => linksIn(body, `K${i}:`))
    expect(got).toEqual(KEPT.map(([h], i) => [{ text: `K${i}`, href: h }]))
    expect(KEPT.map(([h]) => openableLinkHref(h))).toEqual(KEPT.map(([, door]) => door))
  })
})
