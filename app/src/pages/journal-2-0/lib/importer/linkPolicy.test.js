// Plan B Task 1: the one client link policy (linkify + href rules), pinned to the SERVER's
// (`api/services/journal_two/note_connectors/convert/linkify.py`) through the shared vectors
// file, which this test READS (never restates), and to TipTap's own href reading.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { isAllowedUri } from '@tiptap/extension-link'
import { linkifyTextNodes, resolveHref, neutraliseAnchor, hrefAsRead } from './linkPolicy'
import { getLinkify, mdToHtml } from './adapters/generic'

const dom = (html) => new DOMParser().parseFromString(html, 'text/html').body

const VECTORS = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'linkify_vectors.json'), 'utf8'),
)

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const EXISTING = 'https://existing.example/'
// The vectors' `context` names, as the HTML an import produces for each.
const CONTEXTS = {
  plain: (t) => `<p>${esc(t)}</p>`,
  inline_code: (t) => `<p><code>${esc(t)}</code></p>`,
  code_block: (t) => `<pre><code>${esc(t)}</code></pre>`,
  link: (t) => `<p><a href="${EXISTING}">${esc(t)}</a></p>`,
  inline_math: (t) => `<p><span data-type="inline-math" data-latex="x">${esc(t)}</span></p>`,
  block_math: (t) => `<div data-type="block-math" data-latex="x">${esc(t)}</div>`,
}

describe('shared linkify vectors (linkify_vectors.json, also read by the server test)', () => {
  it('the file holds the 35 vectors and every context is mapped', () => {
    expect(VECTORS.vectors).toHaveLength(35)
    for (const v of VECTORS.vectors) expect(Object.keys(CONTEXTS)).toContain(v.context)
  })
  it.each(VECTORS.vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    const b = dom(CONTEXTS[v.context](v.text))
    const n = linkifyTextNodes(b)
    const made = [...b.querySelectorAll('a')]
      .filter((a) => a.getAttribute('href') !== EXISTING)
      .map((a) => ({ text: a.textContent, href: a.getAttribute('href') }))
    expect(made).toEqual(v.links)
    expect(n).toBe(v.links.length)
    expect(b.textContent).toBe(v.text) // never a character added or lost
  })
})

describe('linkifyTextNodes', () => {
  it('linkifies http, https, www and mailto with linkify-it trailing punctuation', () => {
    const b = dom('<p>See https://finviz.com/quote.ashx?t=NVDA, www.tradingview.com/x. and mailto:me@x.com</p>')
    expect(linkifyTextNodes(b)).toBe(3)
    expect([...b.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://finviz.com/quote.ashx?t=NVDA', 'https://www.tradingview.com/x', 'mailto:me@x.com'])
    expect(b.textContent).toBe('See https://finviz.com/quote.ashx?t=NVDA, www.tradingview.com/x. and mailto:me@x.com')
  })
  it('never linkifies code, math, existing links, attachment chips, or a bare ticker-dot-TLD', () => {
    const b = dom('<p><code>https://a.com</code></p><pre>https://b.com</pre>'
      + '<span data-type="inline-math" data-latex="x">https://c.com</span><a href="https://d.com">https://e.com</a>'
      + '<span data-latex="y">https://f.com</span><span data-type="attachmentChip">https://g.com/a.pdf</span>'
      + '<p>NVDA.US example.com</p>')
    expect(linkifyTextNodes(b)).toBe(0)
  })
  it('a fuzzy domain is DROPPED, not just unlinked: the shared instance does match NVDA.US', () => {
    // Control: linkify-it alone WOULD link it, so the zero above is the keep rule's doing.
    expect(getLinkify().match('long NVDA.US into earnings')).not.toBeNull()
    const b = dom('<p>long NVDA.US and https://x.com/a</p>')
    expect(linkifyTextNodes(b)).toBe(1)
    expect(b.innerHTML).toBe('<p>long NVDA.US and <a href="https://x.com/a">https://x.com/a</a></p>')
  })
  it('keeps the surrounding text and siblings, and handles several links in one node', () => {
    const b = dom('<p><b>x</b> a https://a.com b www.b.com c</p>')
    expect(linkifyTextNodes(b)).toBe(2)
    expect(b.innerHTML).toBe('<p><b>x</b> a <a href="https://a.com">https://a.com</a> b <a href="https://www.b.com">www.b.com</a> c</p>')
  })
  it('never inserts an <a> into script, style, textarea, title or svg (fix round 1)', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><title>https://t.com</title></head><body>'
      + '<script>var u = "https://s.com"</script><style>a{background:url(https://st.com/x.png)}</style>'
      + '<textarea>https://ta.com</textarea><svg><text>https://sv.com</text></svg>'
      + '<p>https://ok.com</p></body></html>', 'text/html')
    expect(linkifyTextNodes(doc.documentElement)).toBe(1)
    expect([...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://ok.com'])
    expect(doc.querySelector('script').textContent).toBe('var u = "https://s.com"')
    expect(doc.querySelector('textarea').value).toBe('https://ta.com')
  })
  it('is idempotent', () => {
    const b = dom('<p>see https://a.com</p>')
    expect(linkifyTextNodes(b)).toBe(1)
    expect(linkifyTextNodes(b)).toBe(0)
  })
  it('trims a long run of trailing punctuation in linear time', () => {
    const b = dom(`<p>https://x.com/a${'.'.repeat(20000)}b${'!'.repeat(20000)}</p>`)
    const t0 = performance.now()
    linkifyTextNodes(b)
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(b.querySelector('a').getAttribute('href')).toBe(`https://x.com/a${'.'.repeat(20000)}b`)
  })
  it('getLinkify is the markdown lane\'s own instance', () => {
    expect(getLinkify()).toBe(getLinkify())
    expect(typeof getLinkify().match).toBe('function')
  })
})

describe('hrefAsRead (the scheme is read the way TipTap and a browser read it)', () => {
  it('strips exactly TipTap isAllowedUri\'s invisible class', () => {
    // TipTap refuses `java<c>script:x` exactly when it strips <c>; compare over every code
    // point outside printable ASCII up to U+3100 (the class ends at U+3000).
    const diffs = []
    for (let cp = 0; cp <= 0x3100; cp++) {
      if (cp >= 0x21 && cp <= 0x7e) continue
      const c = String.fromCharCode(cp)
      const tiptapStrips = !isAllowedUri(`java${c}script:x`)
      const weStrip = hrefAsRead(`a${c}b`) === 'ab'
      if (tiptapStrips !== weStrip) diffs.push(cp.toString(16))
    }
    expect(diffs).toEqual([])
  })
})

describe('resolveHref', () => {
  it.each([
    ['javascript:alert(1)', null, null], ['JavaScript:x', null, null], ['vbscript:x', null, null],
    ['file:///C:/a.pdf', null, null], ['data:text/html,x', null, null],
    ['evernote:///view/1/s1/g/g/', null, null], ['onenote:https://x', null, null], ['obsidian://open?vault=V', null, null],
    ['/news/a-123', 'https://news.example.com/2026/clip', 'https://news.example.com/news/a-123'],
    ['#section', 'https://news.example.com/p', 'https://news.example.com/p#section'],
    ['?q=1', 'https://news.example.com/p', 'https://news.example.com/p?q=1'],
    ['a/b', 'https://news.example.com/x/y', 'https://news.example.com/x/a/b'],
    ['/news/a-123', null, null], ['#section', null, null],
    ['//cdn.example.com/x.jpg', null, 'https://cdn.example.com/x.jpg'],
    [' https://spaced.example.com ', null, 'https://spaced.example.com'],
    ['import-link://obsidian:V/a.md', null, 'import-link://obsidian:V/a.md'],
    ['import-ref://h', null, 'import-ref://h'],
    ['/journal?j2tab=notebook&note=abc', null, '/journal?j2tab=notebook&note=abc'],
    ['/terminal?cmd=NVDA', 'https://news.example.com/p', '/terminal?cmd=NVDA'],
    ['/api/j2/notes/attachments/abc', 'https://news.example.com/p', '/api/j2/notes/attachments/abc'],
    ['mailto:me@example.com', null, 'mailto:me@example.com'],
    // any OTHER scheme is kept unchanged
    ['tel:+15551234', null, 'tel:+15551234'], ['ftp://x.org/a', null, 'ftp://x.org/a'],
    ['zoommtg://zoom.us/join?confno=1', null, 'zoommtg://zoom.us/join?confno=1'],
    ['', null, null], ['   ', 'https://a.com/', null],
  ])('resolveHref(%j, %j) -> %j', (href, src, want) => expect(resolveHref(href, src)).toBe(want))

  it.each([
    // R1 / D4: an invisible character inside the scheme never makes it "relative"
    ['java\tscript:alert(1)', 'https://news.example.com/p'],
    ['java\nscript:alert(1)', 'https://news.example.com/p'],
    ['java\u0000script:x', 'https://news.example.com/p'],
    ['java\u00a0script:x', 'https://news.example.com/p'],
    ['java\u2028script:x', 'https://news.example.com/p'],
    ['\u3000javascript:x', 'https://news.example.com/p'],
    ['jav\u200ba\tscript:x', null],
    ['vb\tscript:x', 'https://news.example.com/p'],
    ['da\tta:text/html,x', 'https://news.example.com/p'],
    ['fi\tle:///etc/passwd', 'https://news.example.com/p'],
  ])('an invisible-split dangerous scheme %j is text, never resolved against %j', (href, src) => {
    expect(resolveHref(href, src)).toBeNull()
  })

  it('an invisible-split app scheme is read as that scheme', () => {
    expect(resolveHref('ever\tnote:///view/1', 'https://news.example.com/p')).toBeNull()
    expect(resolveHref('/\t/cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg')
  })

  it.each([
    ['notion://www.notion.so/My-Page-0123456789abcdef0123456789ABCDEF', 'import-link://notion:01234567-89ab-cdef-0123-456789abcdef'],
    ['notion:0123456789ABCDEF0123456789abcdef', 'import-link://notion:01234567-89ab-cdef-0123-456789abcdef'],
    ['notion://www.notion.so/ws/01234567-89AB-cdef-0123-456789abcdef/?pvs=4#blk', 'import-link://notion:01234567-89ab-cdef-0123-456789abcdef'],
    ['no\ttion:0123456789abcdef0123456789abcdef', 'import-link://notion:01234567-89ab-cdef-0123-456789abcdef'],
    ['notion://www.notion.so/My-Page', null],
    ['notion://www.notion.so/0123456789abcdef0123456789abcdef/child', null],
    ['notion://www.notion.so/abc0123456789abcdef0123456789abcdef', null],
  ])('notion deep link %j -> %j (the server notion_note_key form)', (href, want) => {
    expect(resolveHref(href, null)).toBe(want)
  })

  it.each([
    'https://uctintelligence.com/journal', 'https://app.uctintelligence.com/x', 'HTTPS://UCTIntelligence.com/',
    'ftp://news.example.com/p', 'file:///C:/a.html', 'not a url',
  ])('a relative href is never resolved against %j', (src) => {
    expect(resolveHref('/news/a-123', src)).toBeNull()
    expect(resolveHref('#x', src)).toBeNull()
  })

  it('a host that merely ends in the app host is not the app', () => {
    expect(resolveHref('/a', 'https://notuctintelligence.com/p')).toBe('https://notuctintelligence.com/a')
  })
})

describe('neutraliseAnchor', () => {
  it('keeps formatted and media children', () => {
    const b = dom('<p><a href="evernote:///x"><b>Bold</b> <img src="import-ref://h"></a></p>')
    neutraliseAnchor(b.querySelector('a'))
    expect(b.innerHTML).toBe('<p><b>Bold</b> <img src="import-ref://h"></p>')
  })
})

describe('markdown lane: a refused link keeps its visible text only (Plan A handoff H3)', () => {
  it.each([
    '[click](javascript:alert(1))', '[click](vbscript:x)', '[click](file:///etc/passwd)', '[click](data:text/html,x)',
  ])('%s never stores the raw markdown source', (md) => {
    const b = dom(mdToHtml(md))
    expect(b.textContent.trim()).toBe('click')
    const a = b.querySelector('a')
    expect(a).not.toBeNull() // emitted as a link so the post-parse pass can neutralise it
    expect(resolveHref(a.getAttribute('href'))).toBeNull()
  })
  it('an image keeps markdown-it\'s stock gate', () => {
    expect(dom(mdToHtml('![a](javascript:alert(1))')).querySelector('img')).toBeNull()
    expect(dom(mdToHtml('![a](data:image/png;base64,AAAA)')).querySelector('img')).not.toBeNull()
  })
  it('an image nested in a link label keeps the stock gate (the innermost rule decides)', () => {
    const b = dom(mdToHtml('[![i](javascript:alert(1))](https://a.com)'))
    expect(b.querySelector('img')).toBeNull()
    // The refused image degrades to `!` + an inner `[i](javascript:…)` link, which the
    // post-parse pass neutralises; never an image with that src.
    for (const a of b.querySelectorAll('a')) {
      const href = a.getAttribute('href')
      expect(href === 'https://a.com' || resolveHref(href) === null).toBe(true)
    }
    const ok = dom(mdToHtml('[![i](https://cdn.com/c.png)](https://a.com)'))
    expect(ok.querySelector('a img').getAttribute('src')).toBe('https://cdn.com/c.png')
  })
  it.each([
    '[<javascript:alert(1)>](https://a.com)',
    '[a <javascript:alert(1)> b](https://a.com)',
    '[<vbscript:x>](https://a.com)',
  ])('an autolink inside a link label keeps the stock gate: %s (fix round 1)', (md) => {
    const b = dom(mdToHtml(md))
    expect(b.querySelector('a[href^="javascript"], a[href^="vbscript"]')).toBeNull()
    expect(b.querySelector('a a')).toBeNull()
    expect(b.querySelector('a').getAttribute('href')).toBe('https://a.com')
    expect(b.textContent).toContain('script:')
  })
  it('a bare URL inside a link label is not a nested link', () => {
    const b = dom(mdToHtml('[see https://b.com](https://a.com)'))
    expect(b.querySelector('a a')).toBeNull()
    expect(b.querySelectorAll('a')).toHaveLength(1)
  })
  it.each([
    '[x](<javascript:alert(1)>)', '[x](javascript:alert(1) "t")',
  ])('%s is still emitted as a link that resolveHref refuses (text only)', (md) => {
    const b = dom(mdToHtml(md))
    expect(b.textContent.trim()).toBe('x')
    const a = b.querySelector('a')
    expect(a).not.toBeNull()
    expect(resolveHref(a.getAttribute('href'))).toBeNull()
    neutraliseAnchor(a)
    expect(b.querySelector('a')).toBeNull()
    expect(b.textContent.trim()).toBe('x')
  })
  it('a link nested in an image alt is not opened by it', () => {
    expect(dom(mdToHtml('![[x](javascript:y)](javascript:z)')).querySelector('img')).toBeNull()
  })
  it('a reference definition keeps markdown-it\'s stock gate (an image may use it)', () => {
    const b = dom(mdToHtml('![a][r]\n\n[r]: javascript:alert(1)'))
    expect(b.querySelector('img')).toBeNull()
  })
})
