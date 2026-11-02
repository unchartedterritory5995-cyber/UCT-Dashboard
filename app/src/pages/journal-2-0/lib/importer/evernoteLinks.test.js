import { describe, it, expect } from 'vitest'
import SparkMD5 from 'spark-md5'
import { evernoteAdapter } from './adapters/evernote'
import { isEvernoteNoteHref, normTitle, resolveEvernoteLinks } from './evernoteLinks'
import { parseImport } from './postParse'
import { htmlToNote } from './convert'
import { rewriteBody } from './commit'

// Plan B Task 7 (spec E-5, §15 Q5): an Evernote link to another note resolves BY TITLE.

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_MD5 = SparkMD5.ArrayBuffer.hash(Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)).buffer)
const PNG_RES = `<resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><file-name>chart.png</file-name></resource-attributes></resource>`

/** One <note> element: title, ENML body, raw created stamp, resources XML. */
function note(title, body, created = '20240105T093000Z', resources = '') {
  return ` <note><title>${title}</title>
  <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
   <en-note>${body}</en-note>]]></content>
  <created>${created}</created>
  ${resources}
 </note>`
}

function enexFile(path, notes) {
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260810T120000Z" application="Evernote">
${notes.join('\n')}
</en-export>`
  return { path, size: text.length, lastModified: null, bytes: async () => new TextEncoder().encode(text) }
}

const bodyOf = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
const byTitle = (docs, t) => docs.find((d) => d.title === t)

describe('resolveEvernoteLinks through the Evernote adapter', () => {
  it('links to the imported note whose title equals the link text', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div>See <a href="evernote:///view/1/s1/abc/abc/">Target Note</a> now</div>'),
      note('Target Note', '<div>the target</div>', '20240102T000000Z'),
    ])])
    const src = byTitle(docs, 'Source')
    const a = bodyOf(src.html).querySelector('a')
    expect(a.getAttribute('data-import-link')).toBe('evernote:Book/Target Note/20240102T000000Z')
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.hasAttribute('data-evernote-link')).toBe(false)
    expect(a.textContent).toBe('Target Note')
    expect(src.links).toEqual([{ targetKey: 'evernote:Book/Target Note/20240102T000000Z' }])
    // The target, which links nowhere, still has an (empty) links list.
    expect(byTitle(docs, 'Target Note').links).toEqual([])
  })

  it('resolves share and shard links by title too', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div><a href="https://www.evernote.com/shard/s1/nl/1234/abcd/">Target</a> and ' +
        '<a href="https://evernote.com/l/AAAbbb/">Target</a> and <a href="https://evernote.com/pricing">Pricing</a></div>'),
      note('Target', '<div>t</div>', '20240102T000000Z'),
    ])])
    const b = bodyOf(byTitle(docs, 'Source').html)
    const resolved = [...b.querySelectorAll('a[data-import-link]')]
    expect(resolved).toHaveLength(2)
    for (const a of resolved) expect(a.getAttribute('data-import-link')).toBe('evernote:Book/Target/20240102T000000Z')
    // An ordinary evernote.com page stays a web link.
    expect(b.querySelector('a[href="https://evernote.com/pricing"]')).not.toBeNull()
  })

  it('matches on trimmed, whitespace-collapsed text, case-sensitively', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div><a href="evernote:///view/1/s1/a/a/">  Target \n  <b>Note</b> </a> | ' +
        '<a href="evernote:///view/1/s1/b/b/">target note</a></div>'),
      note('Target   Note', '<div>t</div>', '20240102T000000Z'),
    ])])
    const as = [...bodyOf(byTitle(docs, 'Source').html).querySelectorAll('a')]
    expect(as[0].getAttribute('data-import-link')).toBe('evernote:Book/Target   Note/20240102T000000Z')
    expect(as[0].innerHTML).toContain('<b>Note</b>')
    // A different case is a different title (the server compares exactly too).
    expect(as[1].getAttribute('data-import-link')).toBe('evernote-title:target note')
  })

  it('keeps an ambiguous title as text and says so', async () => {
    const { docs, warnings } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div>See <a href="evernote:///view/1/s1/abc/abc/"><i>Twin</i></a> here</div>'),
      note('Twin', '<div>one</div>', '20240102T000000Z'),
      note(' Twin ', '<div>two</div>', '20240103T000000Z'),
    ])])
    const src = byTitle(docs, 'Source')
    const b = bodyOf(src.html)
    expect(b.querySelector('a')).toBeNull()
    expect(b.innerHTML).toContain('See <i>Twin</i> here')
    expect(src.links).toEqual([])
    expect(warnings).toContain('Link "Twin" in "Source" was kept as text: more than one note is titled "Twin".')
    expect(warnings.some((w) => /more than one note is titled/.test(w))).toBe(true)
  })

  it('keeps a not-yet-imported target as an evernote-title placeholder', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div><a href="evernote:///view/1/s1/abc/abc/"> Missing   Note </a></div>'),
    ])])
    const d = docs[0]
    const a = bodyOf(d.html).querySelector('a')
    expect(a.getAttribute('data-import-link')).toBe('evernote-title:Missing Note')
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.hasAttribute('data-evernote-link')).toBe(false)
    expect(d.links).toEqual([{ targetKey: 'evernote-title:Missing Note' }])
  })

  it('keeps a note link with no text as its children, never a raw evernote: href', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div>a <a href="evernote:///view/1/s1/abc/abc/"> <br/> </a> b</div>'),
    ])])
    const d = docs[0]
    expect(bodyOf(d.html).querySelector('a')).toBeNull()
    expect(d.html).not.toContain('evernote:')
    expect(d.links).toEqual([])
  })

  it('resolves a link holding an image and a title BEFORE the lift: the image comes out, the link keeps its target', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', `<div>Lead <a href="evernote:///view/1/s1/abc/abc/"><en-media type="image/png" hash="${PNG_MD5}"/>Target Note</a></div>`, undefined, PNG_RES),
      note('Target Note', '<div>t</div>', '20240102T000000Z'),
    ])])
    const b = bodyOf(byTitle(docs, 'Source').html)
    const img = b.querySelector(`img[src="import-ref://${PNG_MD5}"]`)
    const a = b.querySelector('a')
    expect(img).not.toBeNull()
    expect(a.getAttribute('data-import-link')).toBe('evernote:Book/Target Note/20240102T000000Z')
    expect(a.contains(img)).toBe(false)
    expect(img.nextSibling).toBe(a)
    expect(a.textContent).toBe('Target Note')
  })

  it('keeps the image of an image-only note link, and says the link could not be kept (no title to resolve by)', async () => {
    const { docs, warnings } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', `<div>Lead <a href="evernote:///view/1/s1/abc/abc/"><en-media type="image/png" hash="${PNG_MD5}"/></a> tail</div>`, undefined, PNG_RES),
    ])])
    const d = docs[0]
    expect(d.html).toContain(`<img src="import-ref://${PNG_MD5}">`)
    expect(d.html).not.toContain('evernote:')
    expect(bodyOf(d.html).querySelector('a')).toBeNull()
    expect(d.links).toEqual([])
    expect(warnings).toContain('A link to another note in "Source" was kept as its content: it has no text, and Evernote links name their note only by its title.')
  })

  it('resolves across two .enex files dropped together', async () => {
    const { docs } = await evernoteAdapter.parse([
      enexFile('Alpha.enex', [note('Source', '<div><a href="evernote:///view/1/s1/abc/abc/">Elsewhere</a></div>')]),
      enexFile('Beta.enex', [note('Elsewhere', '<div>in another notebook</div>', '20240109T000000Z')]),
    ])
    const a = bodyOf(byTitle(docs, 'Source').html).querySelector('a')
    expect(a.getAttribute('data-import-link')).toBe('evernote:Beta/Elsewhere/20240109T000000Z')
  })

  it('names the same target once in links when it is linked twice', async () => {
    const { docs } = await evernoteAdapter.parse([enexFile('Book.enex', [
      note('Source', '<div><a href="evernote:///view/1/s1/a/a/">T</a> <a href="evernote:///view/1/s1/b/b/">T</a> ' +
        '<a href="evernote:///view/1/s1/c/c/">Gone</a> <a href="evernote:///view/1/s1/d/d/">Gone</a></div>'),
      note('T', '<div>t</div>', '20240102T000000Z'),
    ])])
    expect(byTitle(docs, 'Source').links).toEqual([
      { targetKey: 'evernote:Book/T/20240102T000000Z' },
      { targetKey: 'evernote-title:Gone' },
    ])
  })

  it('end to end: the resolved link survives conversion and rewriteBody', async () => {
    const { docs } = await parseImport(evernoteAdapter, [enexFile('Book.enex', [
      note('Source', '<div>See <a href="evernote:///view/1/s1/abc/abc/">Target <b>Note</b></a> and <a href="evernote:///view/1/s1/x/x/">Missing Note</a></div>'),
      note('Target Note', '<div>t</div>', '20240102T000000Z'),
    ])], {})
    const src = byTitle(docs, 'Source')
    const { bodyJson } = htmlToNote(src.html)
    const idByKey = { 'evernote:Book/Target Note/20240102T000000Z': 'note-42' }
    const { body, keptLinks } = rewriteBody(bodyJson, { idByKey })
    const hrefs = []
    const walk = (n) => {
      for (const m of n.marks || []) if (m.type === 'link') hrefs.push(m.attrs.href)
      for (const c of n.content || []) walk(c)
    }
    walk(body)
    expect(hrefs).toContain('/journal?j2tab=notebook&note=note-42')
    // The bold word keeps the link too.
    expect(hrefs.filter((h) => h === '/journal?j2tab=notebook&note=note-42')).toHaveLength(2)
    // The not-yet-imported target is KEPT, raw (no %-encoding), for the server heal.
    expect(hrefs).toContain('import-link://evernote-title:Missing Note')
    expect(keptLinks).toEqual([{ key: 'evernote-title:Missing Note', text: 'Missing Note' }])
    expect(JSON.stringify(body)).not.toContain('evernote:///')
  })
})

describe('normTitle (parity with link_keys._norm_title: " ".join(t.split()))', () => {
  it('trims and collapses runs of whitespace to one space', () => {
    expect(normTitle('  a \t\n b  ')).toBe('a b')
    expect(normTitle('a 　b')).toBe('a b')
  })

  it('treats exactly Python str.split()\'s whitespace as whitespace', () => {
    // Python's str.isspace includes the C0 separators and NEL; JS \s does not.
    for (const ch of ['\x1c', '\x1d', '\x1e', '\x1f', '\x85', ' ', ' ', ' ']) {
      expect(normTitle(`a${ch}b`)).toBe('a b')
    }
    // JS \s includes U+FEFF; Python does not split on it, so neither may we.
    expect(normTitle('a﻿b')).toBe('a﻿b')
    expect(normTitle('﻿a')).toBe('﻿a')
  })

  it('keeps case', () => {
    expect(normTitle('Target Note')).toBe('Target Note')
  })

  it('answers "" for a non-string', () => {
    expect(normTitle(null)).toBe('')
    expect(normTitle(undefined)).toBe('')
  })
})

describe('resolveEvernoteLinks (direct)', () => {
  const doc = (title, html, importKey = `k:${title}`) => ({ title, html, importKey, links: [] })

  it('leaves anchors that are not marked as note links alone', () => {
    const d = doc('S', '<a href="https://example.com/T">T</a>')
    const warnings = []
    resolveEvernoteLinks([d, doc('T', '')], warnings)
    expect(d.html).toBe('<a href="https://example.com/T">T</a>')
    expect(d.links).toEqual([])
    expect(warnings).toEqual([])
  })

  it('never picks one of two same-titled notes', () => {
    const d = doc('S', '<a href="evernote:///view/x/" data-evernote-link="1">T</a>')
    const warnings = []
    resolveEvernoteLinks([d, doc('T', '', 'k1'), doc('T', '', 'k2')], warnings)
    expect(d.html).toBe('T')
    expect(d.links).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

describe('isEvernoteNoteHref', () => {
  it.each(['evernote:///view/1/s1/g/g/', 'EVERNOTE://view/1/s1/g/g/', 'https://www.evernote.com/shard/s1/nl/1234/abcd/', 'https://www.evernote.com/l/AAAbbb/'])(
    'isEvernoteNoteHref(%s)', (h) => expect(isEvernoteNoteHref(h)).toBe(true))

  it('does not treat an ordinary evernote.com marketing link as a note link', () => {
    expect(isEvernoteNoteHref('https://evernote.com/pricing')).toBe(false)
  })
})
