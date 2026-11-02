import { describe, it, expect, vi } from 'vitest'
import { finishDoc, parseImport } from './postParse'
import { htmlToNote } from './convert'
import { holdBodyForImport, heldBody } from './uctJson'
import { genericAdapter } from './adapters/generic'
import { notionAdapter } from './adapters/notion'
import { obsidianAdapter } from './adapters/obsidian'
import { evernoteAdapter } from './adapters/evernote'
import { keepAdapter } from './adapters/keep'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const vf = (path, text) => ({
  path,
  size: text.length,
  lastModified: null,
  bytes: async () => new TextEncoder().encode(text),
})
const body = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body

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

  it('linkify runs after the href pass: a neutralised link whose text is a URL becomes that link', () => {
    const d = finishDoc({ html: '<p><a href="javascript:x">https://y.com</a></p>', media: [] })
    expect(d.html).toBe('<p><a href="https://y.com">https://y.com</a></p>')
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
})

// ── every adapter: no dangerous href survives the post-parse pass ──────────────────────────
const UNSAFE = /^\s*(javascript|vbscript|data|file):/i
function unsafeHrefs(docs) {
  const out = []
  for (const d of docs) {
    for (const a of body(d.html).querySelectorAll('a[href]')) {
      const h = a.getAttribute('href').replace(/[\u0000- ]/g, '')
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
  ]

  it.each(cases)('%s', async (_name, adapter, files) => {
    const { docs } = await parseImport(adapter, files, {})
    expect(docs.length).toBeGreaterThan(0)
    expect(unsafeHrefs(docs)).toEqual([])
    // Non-vacuity: the pass kept the safe link, so the checker can see an anchor at all.
    expect(docs.some((d) => /href="https:\/\/ok\.com/.test(d.html))).toBe(true)
  })

  it('control: the checker sees an unsafe href when one is there', () => {
    expect(unsafeHrefs([{ html: HOSTILE_HTML }])).toHaveLength(4)
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
