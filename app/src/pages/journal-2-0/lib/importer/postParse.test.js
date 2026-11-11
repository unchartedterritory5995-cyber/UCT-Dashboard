import { describe, it, expect, vi } from 'vitest'
import { finishDoc, parseImport, FINISH_CHUNK } from './postParse'
import { logseqAdapter } from './adapters/logseq'
import { uctAdapter } from './adapters/uct'
import { htmlToNote } from './convert'
import { holdBodyForImport, heldBody } from './uctJson'
import { genericAdapter } from './adapters/generic'
import { notionAdapter } from './adapters/notion'
import { obsidianAdapter } from './adapters/obsidian'
import { evernoteAdapter } from './adapters/evernote'
import { keepAdapter } from './adapters/keep'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// B-14 fix round 1: the shared refused-link vectors (the server's test_linkify.py reads them too).
const REFUSED = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'linkify_vectors.json'), 'utf8',
)).refused_link_vectors
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const vf = (path, text) => ({
  path,
  size: text.length,
  lastModified: null,
  bytes: async () => new TextEncoder().encode(text),
})
const body = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body

const linkMarks = (bodyJson) => {
  const out = []
  const walk = (n) => {
    for (const m of n.marks || []) if (m.type === 'link') out.push(m.attrs.href)
    for (const c of n.content || []) walk(c)
  }
  walk(bodyJson)
  return out
}
const textOf = (bodyJson) => {
  let t = ''
  const walk = (n) => { if (n.type === 'text') t += n.text; for (const c of n.content || []) walk(c) }
  walk(bodyJson)
  return t
}

describe('shared refused-link vectors: the text a refused link leaves is never re-linked (B-14 fix round 1)', () => {
  it.each(REFUSED.map((v) => [v.name, v]))('finishDoc: %s', (_name, v) => {
    const d = finishDoc({ html: `<p><a href="${escHtml(v.href)}"><b>${escHtml(v.text)}</b></a></p>`, media: [] })
    expect(d.html).not.toContain('data-uct-refused-link')
    const { bodyJson } = htmlToNote(d.html)
    expect(linkMarks(bodyJson)).toEqual([])
    expect(textOf(bodyJson)).toBe(v.text)
  })
  it.each(REFUSED.map((v) => [v.name, v]))('Evernote adapter, then finishDoc: %s', async (_name, v) => {
    const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export><note><title>T</title><content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div><a href="${escHtml(v.href)}">${escHtml(v.text)}</a></div></en-note>]]></content><created>20240105T093000Z</created></note></en-export>`
    const { docs } = await parseImport(evernoteAdapter, [vf('Book.enex', enex)])
    expect(docs).toHaveLength(1)
    expect(docs[0].html).not.toContain('data-uct-refused-link')
    const { bodyJson } = htmlToNote(docs[0].html)
    expect(linkMarks(bodyJson)).toEqual([])
    expect(textOf(bodyJson)).toBe(v.text)
  })
  it('linkify still runs around a refused link', () => {
    const d = finishDoc({ html: '<p>see https://a.com/x <a href="https://b.com/c d">https://b.com/c d</a> and www.e.com</p>', media: [] })
    expect(linkMarks(htmlToNote(d.html).bodyJson)).toEqual(['https://a.com/x', 'https://www.e.com'])
  })
})

describe('finishDoc', () => {
  it('applies the shared rules to an Evernote-shaped doc', () => {
    const d = finishDoc({ html: '<div>See https://a.com and <a href="/x">rel</a> <img src="https://cdn.com/c.png"></div>', media: [], sourceUrl: 'https://news.com/p' })
    expect(d.html).toContain('<a href="https://a.com">https://a.com</a>')
    expect(d.html).toContain('<a href="https://news.com/x">rel</a>')
    expect(d.media.map((m) => m.remoteUrl)).toEqual(['https://cdn.com/c.png'])
  })

  it("keeps a caption's link after an inline image", () => {
    const d = finishDoc({ html: '<div><img src="import-ref://h">Caption with <a href="https://cap.com">link</a></div>', media: [] })
    const { bodyJson } = htmlToNote(d.html)
    expect(JSON.stringify(bodyJson)).toContain('"href":"https://cap.com"')
  })

  it('leaves a held UCT JSON body untouched', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see https://a.com' }] }] }
    const marker = holdBodyForImport(json)
    const media = []
    const doc = { html: marker, media }
    const out = finishDoc(doc)
    expect(out).toBe(doc)
    expect(out.html).toBe(marker)
    expect(out.media).toBe(media) // not even re-assigned: the pass never ran
    expect(heldBody(out.html)).toEqual(json)
  })

  it('mutates and returns the same doc, and works when media is missing', () => {
    const doc = { html: '<p>https://a.com</p>' }
    const out = finishDoc(doc)
    expect(out).toBe(doc)
    expect(out.media).toEqual([])
    expect(out.html).toBe('<p><a href="https://a.com">https://a.com</a></p>')
  })

  it('appends new media after the adapter items, deduped by ref, first wins', () => {
    const own = { ref: 'remote-x', kind: 'image', name: 'mine' }
    const d = finishDoc({ html: '<p><img src="https://cdn.com/a.png"><img src="https://cdn.com/a.png"></p>', media: [own] })
    expect(d.media[0]).toBe(own)
    expect(d.media).toHaveLength(2)
    expect(d.media[1].remoteUrl).toBe('https://cdn.com/a.png')
    const again = finishDoc({ html: d.html, media: d.media })
    expect(again.media).toHaveLength(2)
  })

  // ── call order (Task 2 CARRY): data -> remote -> resolveHref -> lift ──────────────────────
  it('a data: image inside a relative link: extracted, the link resolved, the image lifted, the text the RESOLVED href', () => {
    const d = finishDoc({
      html: `<p><a href="/story"><img src="data:image/png;base64,${PNG_B64}"></a></p>`,
      media: [],
      sourceUrl: 'https://news.com/p/1',
    })
    const root = body(d.html)
    const img = root.querySelector('p > img')
    expect(img.getAttribute('src')).toMatch(/^import-ref:\/\/data-[0-9a-f]{32}$/)
    const a = root.querySelector('a')
    expect(a.getAttribute('href')).toBe('https://news.com/story')
    expect(a.textContent).toBe('https://news.com/story')
    expect(img.nextElementSibling).toBe(a)
    expect(d.media).toHaveLength(1)
    expect(d.media[0].vfile).toBeTruthy()
  })

  it('a data: image inside a relative link with no source URL: the link becomes nothing, the image stays', () => {
    const d = finishDoc({ html: `<p><a href="/story"><img src="data:image/png;base64,${PNG_B64}"></a></p>`, media: [] })
    const root = body(d.html)
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('img').getAttribute('src')).toMatch(/^import-ref:\/\/data-/)
    expect(root.textContent).not.toContain('/story')
  })

  it('a remote image inside an unsafe link: the image is collected, the link neutralised', () => {
    const d = finishDoc({ html: '<p><a href="javascript:alert(1)"><img src="https://cdn.com/c.png"> go</a></p>', media: [] })
    const root = body(d.html)
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('img').getAttribute('src')).toMatch(/^import-ref:\/\/remote-/)
    expect(root.textContent.trim()).toBe('go')
    expect(d.media.map((m) => m.remoteUrl)).toEqual(['https://cdn.com/c.png'])
  })

  it('every a[href] passes resolveHref: unsafe schemes become text, kept ones stay, //host gets https', () => {
    const d = finishDoc({
      html: '<p><a href="javascript:x">j</a> <a href="java\tscript:x">t</a> <a href="vbscript:x">v</a> ' +
        '<a href="data:text/html,x">d</a> <a href="file:///etc/passwd">f</a> <a href="//h.com/x">s</a> ' +
        '<a href="import-ref://k">c</a> <a href="mailto:a@b.co">m</a></p>',
      media: [],
    })
    const hrefs = [...body(d.html).querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://h.com/x', 'import-ref://k', 'mailto:a@b.co'])
    expect(body(d.html).textContent).toContain('j t v d f')
  })

  // B-14 fix round 1 (controller ruling) REVERSES what this test used to pin ("a neutralised
  // link whose text is a URL becomes that link"): a refused link's text is never re-linked on
  // either runtime, because the URL it names may not be the one the text shows.
  it('linkify runs after the href pass, but never over a neutralised link\'s text', () => {
    const d = finishDoc({ html: '<p><a href="javascript:x">https://y.com</a></p>', media: [] })
    expect(d.html).toBe('<p>https://y.com</p>')
  })

  it('linkify never runs inside a link, code, pre or math, and runs after the href pass', () => {
    const d = finishDoc({
      html: '<p><a href="https://x.com">see https://y.com</a></p><pre>https://p.com</pre><p><code>https://c.com</code></p>' +
        '<p><span data-type="inline-math" data-latex="x">https://m.com</span></p><p>www.w.com</p>',
      media: [],
    })
    const hrefs = [...body(d.html).querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://x.com', 'https://www.w.com'])
  })
})

describe('parseImport', () => {
  it('runs finishDoc over every doc an adapter returns, and passes opts and warnings through', async () => {
    const onProgress = vi.fn()
    const adapter = {
      parse: vi.fn(async (files, opts) => {
        opts.onProgress({ done: 1, total: 1 })
        return {
          docs: [{ html: '<p>https://a.com</p>', media: [] }, { html: '<p><a href="javascript:x">b</a></p>', media: [] }],
          warnings: ['w'],
        }
      }),
    }
    const files = [vf('a.md', 'x')]
    const { docs, warnings } = await parseImport(adapter, files, { onProgress })
    expect(adapter.parse).toHaveBeenCalledWith(files, { onProgress })
    expect(onProgress).toHaveBeenCalled()
    expect(warnings).toEqual(['w'])
    expect(docs[0].html).toBe('<p><a href="https://a.com">https://a.com</a></p>')
    expect(docs[1].html).toBe('<p>b</p>')
  })

  it('throws exactly what adapter.parse throws', async () => {
    const boom = new Error('boom')
    await expect(parseImport({ parse: async () => { throw boom } }, [], {})).rejects.toBe(boom)
  })

  // Fix round 1: a few-thousand-note export must not freeze the tab.
  const manyDocs = (n) => Array.from({ length: n }, (_, i) => ({ html: `<p>https://n${i}.com</p>`, media: [] }))
  const finished = (d) => d.html.includes('<a ')

  it(`finishes FINISH_CHUNK (${FINISH_CHUNK}) docs at a time, yielding to the event loop between chunks`, async () => {
    vi.useFakeTimers()
    try {
      const docs = manyDocs(FINISH_CHUNK * 2 + 10)
      const onProgress = vi.fn()
      let settled = false
      const run = parseImport({ parse: async () => ({ docs, warnings: [] }) }, [], { onProgress }).then((r) => {
        settled = true
        return r
      })
      for (let i = 0; i < 10; i++) await Promise.resolve()
      // One chunk done, then a macrotask yield: nothing after it has run yet.
      expect(docs.slice(0, FINISH_CHUNK).every(finished)).toBe(true)
      expect(finished(docs[FINISH_CHUNK])).toBe(false)
      expect(settled).toBe(false)
      expect(onProgress.mock.calls.map((c) => c[0])).toEqual([{ phase: 'finishing', done: FINISH_CHUNK, total: docs.length }])
      await vi.runAllTimersAsync()
      const result = await run
      expect(result.docs.every(finished)).toBe(true)
      expect(onProgress.mock.calls.map((c) => c[0].done)).toEqual([FINISH_CHUNK, FINISH_CHUNK * 2, docs.length])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops between chunks once isCancelled() answers true', async () => {
    const docs = manyDocs(FINISH_CHUNK * 3)
    let calls = 0
    const isCancelled = () => ++calls > 1 // true from the second chunk on
    const result = await parseImport({ parse: async () => ({ docs, warnings: [] }) }, [], { isCancelled })
    expect(result.cancelled).toBe(true)
    expect(docs.slice(0, FINISH_CHUNK).every(finished)).toBe(true)
    expect(docs.slice(FINISH_CHUNK).some(finished)).toBe(false)
  })
})

describe('links between notes of one generic import (fix round 1)', () => {
  it('a relative .md link to another note in the import becomes that note\'s link key; any other relative link is text', async () => {
    const { docs } = await parseImport(genericAdapter, [
      vf('A/One.md', '[two](../B/Two%20note.md) [gone](../B/Missing.md) [self](One.md)\n'),
      vf('B/Two note.md', 'Two.\n'),
    ], {})
    const one = docs.find((d) => d.importKey === 'file:A/One.md')
    const hrefs = [...body(one.html).querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(hrefs).toEqual([['two', 'import-link://file:B/Two note.md'], ['self', 'import-link://file:A/One.md']])
    expect(body(one.html).textContent).toContain('gone')
    expect(one.links.map((l) => l.targetKey)).toEqual(['file:B/Two note.md', 'file:A/One.md'])
  })

  it('a TextBundle note is linked by its bundle key', async () => {
    const { docs } = await parseImport(genericAdapter, [
      vf('One.md', '[b](Idea.textbundle/text.md)\n'),
      vf('Idea.textbundle/text.md', '# Idea\n'),
    ], {})
    const one = docs.find((d) => d.importKey === 'file:One.md')
    expect(one.html).toContain('href="import-link://file:Idea.textbundle"')
  })
})

describe('a UCT JSON note goes through the same href policy (fix round 1)', () => {
  const jsonNote = (marks) => JSON.stringify({
    format: 'uct-notebook-note',
    version: 1,
    note: {
      id: 'n1',
      title: 'J',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: marks.map(([text, href]) => ({ type: 'text', text, marks: [{ type: 'bold' }, { type: 'link', attrs: { href } }] })) }] },
    },
  })

  it('an unsafe link mark is dropped, its text and other marks kept; a safe one stays; the held body is the checked one', async () => {
    const files = [
      vf('UCT_NOTEBOOK_EXPORT.json', JSON.stringify({ format: 'json' })),
      vf('J.json', jsonNote([['j', 'javascript:alert(1)'], ['t', 'java\tscript:x'], ['f', 'file:///etc'], ['ok', 'https://ok.com'], ['n', '/journal?j2tab=notebook&note=x']])),
    ]
    const { docs } = await parseImport(uctAdapter, files, {})
    const para = docs[0].bodyJson.content[0].content
    expect(para.map((t) => t.text)).toEqual(['j', 't', 'f', 'ok', 'n'])
    expect(para.map((t) => t.marks.map((m) => m.attrs?.href ?? m.type))).toEqual([
      ['bold'], ['bold'], ['bold'], ['bold', 'https://ok.com'], ['bold', '/journal?j2tab=notebook&note=x'],
    ])
    expect(heldBody(docs[0].html)).toEqual(docs[0].bodyJson)
  })
})

// ── every adapter: no dangerous href survives the post-parse pass ──────────────────────────
const UNSAFE = /^\s*(javascript|vbscript|data|file):/i
/** Every link-mark href in a TipTap JSON body. */
function markHrefs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => markHrefs(n, out))
  else if (node && typeof node === 'object') {
    for (const m of node.marks || []) if (m?.type === 'link' && typeof m.attrs?.href === 'string') out.push(m.attrs.href)
    markHrefs(node.content, out)
  }
  return out
}
/** Every href a doc can store: its HTML anchors, and a JSON body (held or given). */
function allHrefs(d) {
  const held = heldBody(d.html)
  if (held || d.bodyJson) return [...markHrefs(held), ...markHrefs(d.bodyJson)]
  return [...body(d.html).querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
}
function unsafeHrefs(docs) {
  const out = []
  for (const d of docs) {
    for (const href of allHrefs(d)) {
      const h = href.replace(/[\u0000- ]/g, '')
      if (UNSAFE.test(h)) out.push(h)
    }
  }
  return out
}
const HOSTILE_HTML = '<p><a href="javascript:alert(1)">j</a> <a href="vbscript:x">v</a> ' +
  '<a href="data:text/html,x">d</a> <a href="file:///etc/passwd">f</a> <a href="https://ok.com">ok</a></p>'
const HOSTILE_MD = '[j](javascript:alert(1)) [v](vbscript:x) [d](data:text/html,x) [f](file:///etc/passwd) [ok](https://ok.com)\n\n' +
  HOSTILE_HTML + '\n'

describe('no javascript:, vbscript:, data: or file: href survives on any adapter', () => {
  const cases = [
    ['generic markdown', genericAdapter, [vf('notes/a.md', HOSTILE_MD)]],
    ['generic html', genericAdapter, [vf('notes/a.html', `<html><body>${HOSTILE_HTML}</body></html>`)]],
    ['notion', notionAdapter, [vf('Export/Page 0123456789abcdef0123456789abcdef.md', `# Page\n\n${HOSTILE_MD}`)]],
    ['obsidian', obsidianAdapter, [vf('Vault/.obsidian/app.json', '{}'), vf('Vault/Note.md', HOSTILE_MD)]],
    ['evernote', evernoteAdapter, [vf('Book.enex', `<?xml version="1.0" encoding="UTF-8"?>
<en-export><note><title>T</title><content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>${HOSTILE_HTML}</div></en-note>]]></content><created>20240105T093000Z</created></note></en-export>`)]],
    ['keep', keepAdapter, [vf('Takeout/Keep/a.json', JSON.stringify({
      title: 'k', textContent: 'see javascript:alert(1) and https://ok.com', createdTimestampUsec: 1, userEditedTimestampUsec: 1,
      annotations: [{ source: 'WEBLINK', url: 'javascript:alert(1)', title: 'bad' }, { source: 'WEBLINK', url: 'https://ok.com/w', title: 'good' }],
    }))]],
    ['logseq', logseqAdapter, [vf('Graph/logseq/config.edn', '{}'), vf('Graph/pages/Note.md', HOSTILE_MD)]],
    ['uct markdown export', uctAdapter, [vf('UCT_NOTEBOOK_EXPORT.json', JSON.stringify({ format: 'md' })), vf('Notes/a.md', HOSTILE_MD)]],
    ['uct JSON export', uctAdapter, [vf('UCT_NOTEBOOK_EXPORT.json', JSON.stringify({ format: 'json' })), vf('a.json', JSON.stringify({
      format: 'uct-notebook-note',
      version: 1,
      note: {
        id: 'h',
        title: 'h',
        bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: ['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', 'file:///etc/passwd', 'https://ok.com']
          .map((href, i) => ({ type: 'text', text: `t${i}`, marks: [{ type: 'link', attrs: { href } }] })) }] },
      },
    }))]],
  ]

  it.each(cases)('%s', async (_name, adapter, files) => {
    const { docs } = await parseImport(adapter, files, {})
    expect(docs.length).toBeGreaterThan(0)
    expect(unsafeHrefs(docs)).toEqual([])
    // Non-vacuity: the pass kept the safe link, so the checker can see an anchor at all.
    expect(docs.some((d) => allHrefs(d).some((h) => h.startsWith('https://ok.com')))).toBe(true)
  })

  it('control: the checker sees an unsafe href when one is there, in HTML or in a JSON body', () => {
    expect(unsafeHrefs([{ html: HOSTILE_HTML }])).toHaveLength(4)
    const bodyJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] }] }] }
    expect(unsafeHrefs([{ html: '', bodyJson }])).toEqual(['javascript:x'])
  })
})

describe('the markdown lane has ONE linkify behaviour (Task 1 CARRY)', () => {
  it('NVDA.US and example.com import with no link; www.x.com gets https://', async () => {
    const { docs } = await parseImport(genericAdapter, [vf('a.md', 'Long NVDA.US, see example.com and www.x.com today.\n')], {})
    const hrefs = [...body(docs[0].html).querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://www.x.com'])
  })

  it('the adapter itself no longer links fuzzy domains (finishDoc owns linkify)', async () => {
    const { docs } = await genericAdapter.parse([vf('a.md', 'NVDA.US example.com\n')])
    expect(docs[0].html).not.toContain('<a ')
  })
})
