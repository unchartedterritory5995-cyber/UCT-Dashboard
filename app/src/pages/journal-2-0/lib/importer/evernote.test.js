import { describe, it, expect } from 'vitest'
import SparkMD5 from 'spark-md5'
import { evernoteAdapter } from './adapters/evernote'
import { isEvernoteNoteHref } from './evernoteLinks'
import { parseImport } from './postParse'
import { htmlToNote } from './convert'
import { rewriteBody, storeMediaItem } from './commit'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))
const pngMd5 = SparkMD5.ArrayBuffer.hash(pngBytes.buffer)

const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260810T120000Z" application="Evernote">
 <note><title>Trade recap</title>
  <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
   <en-note><div><en-todo checked="true"/>review AAPL</div><div><en-todo/>size DDOG</div>
   <div><en-media type="image/png" hash="${pngMd5}"/></div>
   <div><en-crypt cipher="AES">Zm9v</en-crypt></div></en-note>]]></content>
  <created>20240105T093000Z</created><tag>swing</tag><tag>recap</tag>
  <resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><file-name>chart.png</file-name></resource-attributes></resource>
 </note></en-export>`

const vf = { path: 'Trading Notebook.enex', size: enex.length, lastModified: null,
             bytes: async () => new TextEncoder().encode(enex) }

describe('evernote adapter', () => {
  it('maps notebook filename to folder, dates, tags, todos, media, crypt', async () => {
    const { docs } = await evernoteAdapter.parse([vf])
    const d = docs[0]
    expect(d.folderPath).toEqual(['Trading Notebook'])
    expect(d.title).toBe('Trade recap')
    expect(d.createdAt).toBe('2024-01-05T09:30:00Z')
    expect(d.tags).toEqual(['swing', 'recap'])
    expect(d.html).toContain('data-type="taskList"')
    expect(d.html).toContain('data-checked="true"')
    expect(d.html).toContain('review AAPL')
    expect(d.html).toContain('data-checked="false"')
    expect(d.html).toContain('size DDOG')
    expect(d.html).toContain(`import-ref://${pngMd5}`)
    expect(d.media[0]).toMatchObject({ kind: 'image', name: 'chart.png' })
    expect(d.html).toContain('encrypted content')
    expect(d.importKey).toBe('evernote:Trading Notebook/Trade recap/20240105T093000Z')
  })
})

describe('evernote adapter — mixed-platform drop (audit B4)', () => {
  it('names the non-.enex files it silently discarded, with a count', async () => {
    // The Export Guide tells members to "drop them all in together". Evernote's
    // detect() scores a mixed drop 1.0 and used to swallow every other
    // platform's files with zero signal. A markdown file that looks like it
    // came from a Notion/Obsidian export dropped alongside the .enex must be
    // named, not silently discarded.
    const notionFile = {
      path: 'My Notion Page.md', size: 4, lastModified: null,
      bytes: async () => new TextEncoder().encode('body'),
    }
    const { docs, warnings } = await evernoteAdapter.parse([vf, notionFile])
    expect(docs).toHaveLength(1) // the .enex note still imports
    const joined = warnings.join(' ')
    expect(joined).toContain('1 file')
    expect(joined).toContain('My Notion Page.md')
  })

  it('warns about nothing when every dropped file is a real .enex', async () => {
    const { warnings } = await evernoteAdapter.parse([vf])
    expect(warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// en-media self-closing-tag trap (same HTML5 parsing quirk as en-todo): HTML
// tree construction ignores the self-closing flag on unknown elements, so
// content textually AFTER an `<en-media/>` on one line can land AS its child
// rather than as a later sibling. A naive `el.replaceWith(img)` would then
// silently discard that subtree. Reproduced + fixed in `replaceEnMedia`.
// ---------------------------------------------------------------------------

function enexWithContent(contentInner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260810T120000Z" application="Evernote">
 <note><title>Media trap</title>
  <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
   <en-note>${contentInner}</en-note>]]></content>
  <created>20240105T093000Z</created>
  <resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><file-name>chart.png</file-name></resource-attributes></resource>
 </note></en-export>`
}

function vfileFor(enexText, path) {
  return { path, size: enexText.length, lastModified: null, bytes: async () => new TextEncoder().encode(enexText) }
}

describe('evernote adapter: en-media unwrap (same trap as en-todo)', () => {
  it('caption text after <en-media/> survives beside the <img>', async () => {
    const enexText = enexWithContent(
      `<div><en-media type="image/png" hash="${pngMd5}"/>caption text after</div>`
    )
    const { docs } = await evernoteAdapter.parse([vfileFor(enexText, 'Caption.enex')])
    const d = docs[0]
    expect(d.html).toContain(`import-ref://${pngMd5}`)
    expect(d.html).toContain('<img')
    expect(d.html).toContain('caption text after')
  })

  it('two <en-media/> citations on one line both become <img>, middle text intact', async () => {
    const enexText = enexWithContent(
      `<div><en-media type="image/png" hash="${pngMd5}"/> middle text <en-media type="image/png" hash="${pngMd5}"/></div>`
    )
    const { docs } = await evernoteAdapter.parse([vfileFor(enexText, 'TwoMedia.enex')])
    const d = docs[0]
    expect((d.html.match(/<img/g) || []).length).toBe(2)
    expect(d.html).toContain('middle text')
    // Byte-identical resource -> one hash -> deduped to a single media entry.
    expect(d.media).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Plan B Task 6 (spec E-4, E-6, E-11, E-12, E-14): links keep their children,
// an image inside a link survives, the clip source is kept, declared MIME,
// an en-media with no resource is a visible notice in place.
// ---------------------------------------------------------------------------

// A second, different resource: a 1-byte-different payload so its MD5 differs.
const PDF_B64 = btoa('%PDF-1.4\n%fake trade plan\n')
const pdfBytes = Uint8Array.from(atob(PDF_B64), (c) => c.charCodeAt(0))
const pdfMd5 = SparkMD5.ArrayBuffer.hash(pdfBytes.buffer)
const PNG_RES = `<resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><file-name>chart.png</file-name></resource-attributes></resource>`
const PDF_RES = `<resource><data encoding="base64">${PDF_B64}</data><mime>application/pdf</mime>
   <resource-attributes><file-name>plan.pdf</file-name></resource-attributes></resource>`

/** One-note .enex: ENML body, the resources' XML, and optional <note-attributes> XML. */
function noteEnex(body, { resources = PNG_RES, attributes = '', title = 'Clip' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260810T120000Z" application="Evernote">
 <note><title>${title}</title>
  <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
   <en-note>${body}</en-note>]]></content>
  <created>20240105T093000Z</created>
  ${attributes ? `<note-attributes>${attributes}</note-attributes>` : ''}
  ${resources}
 </note></en-export>`
}

async function parseOne(body, opts) {
  const { docs } = await evernoteAdapter.parse([vfileFor(noteEnex(body, opts), 'Book.enex')])
  return docs[0]
}

async function finishOne(body, opts) {
  const { docs } = await parseImport(evernoteAdapter, [vfileFor(noteEnex(body, opts), 'Book.enex')], {})
  return docs[0]
}

const bodyOf = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body

describe('evernote adapter: Plan B Task 6', () => {
  it('carries the declared <mime> on every media item', async () => {
    const d = await parseOne(`<div><en-media type="image/png" hash="${pngMd5}"/></div>`, { resources: PNG_RES + PDF_RES })
    expect(d.media.find((m) => m.ref === pngMd5).mime).toBe('image/png')
    expect(d.media.find((m) => m.ref === pdfMd5).mime).toBe('application/pdf')
  })

  it('keeps the clip source URL as a clickable first line and on the doc', async () => {
    const d = await parseOne('<div>Clipped body <a href="/news/item">relative</a></div>', {
      attributes: '<source-url>https://example.com/articles/one</source-url>',
    })
    expect(d.sourceUrl).toBe('https://example.com/articles/one')
    const first = bodyOf(d.html).firstElementChild
    expect(first.tagName).toBe('P')
    expect(first.textContent).toBe('Source: https://example.com/articles/one')
    expect(first.querySelector('a').getAttribute('href')).toBe('https://example.com/articles/one')
    // And the post-parse pass resolves a relative link against it.
    const f = await finishOne('<div>Clipped body <a href="/news/item">relative</a></div>', {
      attributes: '<source-url>https://example.com/articles/one</source-url>',
    })
    expect(f.html).toContain('href="https://example.com/news/item"')
  })

  it('reads the NOTE source-url, not a resource\'s, and keeps only http(s), never our own site', async () => {
    const resWithSource = `<resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><source-url>https://cdn.example.com/x.png</source-url><file-name>chart.png</file-name></resource-attributes></resource>`
    const none = await parseOne('<div>x</div>', { resources: resWithSource })
    expect(none.sourceUrl).toBeUndefined()
    expect(none.html).not.toContain('Source:')
    for (const bad of ['evernote:///view/1/s1/g/g/', 'javascript:alert(1)', 'https://uctintelligence.com/journal', 'https://app.uctintelligence.com/x']) {
      const d = await parseOne('<div>x</div>', { attributes: `<source-url>${bad}</source-url>` })
      expect(d.sourceUrl).toBeUndefined()
      expect(d.html).not.toContain('Source:')
    }
  })

  it('keeps an image that sits inside an evernote:/// link', async () => {
    const body = `<div>Lead <a href="evernote:///view/1/s1/abc/abc/"><en-media type="image/png" hash="${pngMd5}"/></a></div><div>Tail</div>`
    const d = await parseOne(body)
    expect(d.html).toContain(`<img src="import-ref://${pngMd5}">`)
    // In place, where the link was: not orphaned to the end of the note as an unreferenced resource.
    expect(d.html.indexOf(`import-ref://${pngMd5}`)).toBeGreaterThan(d.html.indexOf('Lead'))
    expect(d.html.indexOf(`import-ref://${pngMd5}`)).toBeLessThan(d.html.indexOf('Tail'))
    expect((d.html.match(/<img/g) || []).length).toBe(1)
    expect(d.media.map((m) => m.ref)).toContain(pngMd5)
    // Through the post-parse pass too: the image is still there, no evernote: href is left.
    const f = await finishOne(body)
    expect(f.html).toContain(`<img src="import-ref://${pngMd5}">`)
    expect(f.html).not.toContain('evernote:')
    expect(f.media.map((m) => m.ref)).toContain(pngMd5)
  })

  it('keeps bold inside an internal link', async () => {
    const body = '<div>See <a href="evernote:///view/1/s1/abc/abc/"><b>Bold title</b> plan</a></div>'
    const d = await parseOne(body)
    const a = bodyOf(d.html).querySelector('a[data-evernote-link]')
    expect(a).not.toBeNull()
    expect(a.getAttribute('href')).toBe('evernote:///view/1/s1/abc/abc/')
    expect(a.innerHTML).toBe('<b>Bold title</b> plan')
    const f = await finishOne(body)
    expect(f.html).toContain('<b>Bold title</b> plan')
  })

  it('marks share and shard Evernote links as note links, not web links', async () => {
    const d = await parseOne('<div><a href="https://www.evernote.com/shard/s1/nl/1234/abcd/">Target</a> ' +
      '<a href="https://evernote.com/pricing">Pricing</a></div>')
    const b = bodyOf(d.html)
    expect(b.querySelector('a[href^="https://www.evernote.com/shard"]').getAttribute('data-evernote-link')).toBe('1')
    expect(b.querySelector('a[href="https://evernote.com/pricing"]').hasAttribute('data-evernote-link')).toBe(false)
  })

  it('keeps the web link around an image as a link line after it', async () => {
    const d = await parseOne(`<div><a href="https://example.com/chart"><en-media type="image/png" hash="${pngMd5}"/></a></div>`)
    expect(d.html).toContain(`<img src="import-ref://${pngMd5}"><a href="https://example.com/chart">https://example.com/chart</a>`)
  })

  it('keeps the web link around an attachment as a link line after the chip', async () => {
    const d = await parseOne(`<div><a href="https://example.com/plan"><en-media type="application/pdf" hash="${pdfMd5}"/></a></div>`,
      { resources: PDF_RES })
    // Serialised and re-parsed (what finishDoc does): the outer link must not be eaten by the
    // parser closing it at the nested chip <a>.
    const b = bodyOf(d.html)
    const chip = b.querySelector('[data-type="attachmentChip"]')
    expect(chip.getAttribute('href')).toBe(`import-ref://${pdfMd5}`)
    const link = b.querySelector('a[href="https://example.com/plan"]')
    expect(link).not.toBeNull()
    expect(link.textContent).toBe('https://example.com/plan')
    expect(chip.contains(link) || link.contains(chip)).toBe(false)
    expect(chip.nextSibling).toBe(link)
  })

  it('places a hash-mismatched image where its en-media was, not at the end', async () => {
    const d = await parseOne('<div>before</div><div><en-media type="image/png" hash="00000000000000000000000000000000"/></div><div>after</div>')
    const html = d.html
    expect((html.match(/<img/g) || []).length).toBe(1)
    expect(html.indexOf(`import-ref://${pngMd5}`)).toBeGreaterThan(html.indexOf('before'))
    expect(html.indexOf(`import-ref://${pngMd5}`)).toBeLessThan(html.indexOf('after'))
    expect(html).not.toContain('attachmentChip')
  })

  it('pairs a mismatched en-media only with a resource of its own kind, and never steals an exact match', async () => {
    // The image en-media mismatches; the only unreferenced resource is a PDF -> no pairing,
    // missing notice instead. The PDF still reaches the note, as a chip at the end.
    const d = await parseOne('<div><en-media type="image/png" hash="11111111111111111111111111111111"/></div>', { resources: PDF_RES })
    expect(d.html).toContain('import-ref://missing-1')
    expect(d.html).toContain(`data-import-ref="${pdfMd5}"`)
    // An exact match later in the note keeps its resource: the mismatch before it does not take it.
    const e = await parseOne(`<div><en-media type="image/png" hash="22222222222222222222222222222222"/></div><div><en-media type="image/png" hash="${pngMd5}"/></div>`)
    expect((e.html.match(new RegExp(`import-ref://${pngMd5}`, 'g')) || []).length).toBe(1)
    expect(e.html.indexOf('import-ref://missing-1')).toBeLessThan(e.html.indexOf(`import-ref://${pngMd5}`))
  })

  it('marks an en-media with no resource at all as missing in place', async () => {
    const d = await parseOne('<div>before<en-media type="image/png" hash="33333333333333333333333333333333"/></div><div>after</div>', { resources: '' })
    expect(d.html).toContain('<img src="import-ref://missing-1">')
    expect(d.html.indexOf('missing-1')).toBeGreaterThan(d.html.indexOf('before'))
    expect(d.html.indexOf('missing-1')).toBeLessThan(d.html.indexOf('after'))
    const item = d.media.find((m) => m.ref === 'missing-1')
    expect(item).toEqual({ ref: 'missing-1', kind: 'image', name: null, failed: { reason: 'missing_resource', sourceUrl: null } })
  })

  it('end to end: the missing en-media becomes a visible missing_resource notice, never a silent drop', async () => {
    const f = await finishOne('<div>before<en-media type="image/png" hash="33333333333333333333333333333333"/></div>', { resources: '' })
    const { bodyJson } = htmlToNote(f.html)
    const item = f.media.find((m) => m.ref === 'missing-1')
    const result = await storeMediaItem('n1', 'k', item)
    const { body, notices } = rewriteBody(bodyJson, { mediaResults: { 'missing-1': result } })
    expect(notices).toEqual([{ ref: 'missing-1', reason: 'missing_resource', name: null, sourceUrl: null }])
    expect(JSON.stringify(body)).toContain('"importNotice"')
  })

  it('appends an unreferenced image resource as an image, not a chip', async () => {
    const d = await parseOne('<div>no media cited</div>', { resources: PNG_RES + PDF_RES })
    expect(d.html).toContain(`<img src="import-ref://${pngMd5}">`)
    expect(d.html).toContain(`data-import-ref="${pdfMd5}"`)
    expect(d.html).not.toContain(`data-import-ref="${pngMd5}"`)
  })
})

describe('isEvernoteNoteHref (Task 7 interface, carried by Task 6)', () => {
  it.each([
    'evernote:///view/1/s1/g/g/', 'EVERNOTE://view/1/s1/g/g/', 'evernote://view/1/s1/g/g/',
    'https://www.evernote.com/shard/s1/nl/1234/abcd/', 'https://evernote.com/shard/s1/sh/abcd/efgh',
    'https://www.evernote.com/l/AAAbbb/', 'HTTPS://WWW.EVERNOTE.COM/l/AAAbbb/', '  evernote:///view/1/s1/g/g/ ',
  ])('true for %s', (h) => expect(isEvernoteNoteHref(h)).toBe(true))

  it.each([
    'https://evernote.com/pricing', 'https://www.evernote.com/', 'https://help.evernote.com/l/x',
    'https://notevernote.com/l/x', 'https://example.com/shard/s1/nl/1/2', 'evernote:', 'notion://x', '', null, undefined,
  ])('false for %s', (h) => expect(isEvernoteNoteHref(h)).toBe(false))
})
