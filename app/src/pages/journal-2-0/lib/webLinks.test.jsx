// Wave 6 item 6 — a pasted link: Link · Preview card · Embed. The allowlist
// and the one place an iframe address is built (webEmbeds.js), the two nodes
// (webLinkNodes.js), the paste offer (linkPasteOffer.js) and its menu
// (LinkPasteMenu.jsx), on a REAL editor over the app's roster.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { Editor, generateJSON } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { buildExtensions } from './tiptap'
import { EMBED_PROVIDERS, embedFor, embedSrc, embedHref } from './webEmbeds'
import { linkPasteKey, offerStillValid, placeLinkBlock, previewCardNode, fetchLinkPreview } from './linkPasteOffer'
import { citationText } from './askCitation'
import LinkPasteMenu from '../components/notebook/LinkPasteMenu'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null; document.body.innerHTML = ''; vi.restoreAllMocks() })

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })
const at = (ed, str) => { let hit = null; ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } }); return hit }
const caret = (ed, pos) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
const offerOf = (ed) => linkPasteKey.getState(ed.state)
const types = (ed) => { const o = []; ed.state.doc.forEach((n) => o.push(n.type.name)); return o }
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'
const ARTICLE = 'https://news.example.com/nvda-record-quarter'

describe('the embed allowlist (webEmbeds.js)', () => {
  it.each([
    [YT, 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('YouTube: %s', (url, ref) => {
    expect(embedFor(url)).toEqual({ provider: 'youtube', ref })
  })

  it.each([
    ['https://www.tradingview.com/symbols/NASDAQ-AAPL/', 'NASDAQ:AAPL'],
    ['https://www.tradingview.com/symbols/NYSE-BRK.B/', 'NYSE:BRK.B'],
    ['https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT', 'BINANCE:BTCUSDT'],
    ['https://uk.tradingview.com/symbols/AAPL/', 'AAPL'],
  ])('TradingView: %s', (url, ref) => {
    expect(embedFor(url)).toEqual({ provider: 'tradingview', ref })
  })

  it.each([
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
    'https://tradingview.com.evil.example/symbols/NASDAQ-AAPL/',
    'https://www.tradingview.com/symbols/NASDAQ-AAPL%22onload%3D/',
    'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
    'https://vimeo.com/123456',
    ARTICLE,
  ])('no embed: %s', (url) => {
    expect(embedFor(url)).toBeNull()
  })

  it('an iframe address is REBUILT from provider + ref, and only for the allowlist', () => {
    expect(embedSrc('youtube', 'dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1')
    expect(embedSrc('tradingview', 'NASDAQ:AAPL')).toMatch(/^https:\/\/s\.tradingview\.com\/widgetembed\/\?symbol=NASDAQ%3AAAPL&/)
    for (const [p, r] of [['youtube', '../../evil'], ['youtube', 'https://evil'], ['vimeo', '123'],
      ['constructor', 'x'], ['__proto__', 'x'], ['toString', 'x'], [null, null]]) {
      expect(embedSrc(p, r), `${p}:${r}`).toBeNull()
      expect(embedHref(p, r), `${p}:${r}`).toBeNull()
    }
    expect(Object.keys(EMBED_PROVIDERS).sort()).toEqual(['tradingview', 'youtube'])
  })
})

describe('the embed node', () => {
  const embed = (attrs) => ({ type: 'webEmbed', attrs })

  it('plays through a SANDBOXED iframe at the rebuilt nocookie address, lazily, sending no referrer', () => {
    const ed = mount([embed({ provider: 'youtube', ref: 'dQw4w9WgXcQ', url: YT })])
    const frame = ed.view.dom.querySelector('.uctWebEmbed iframe')
    expect(frame.getAttribute('src')).toBe(embedSrc('youtube', 'dQw4w9WgXcQ'))
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('loading')).toBe('lazy')
    expect(ed.view.dom.querySelector('.uctWebEmbedOpen').getAttribute('rel')).toBe('noopener noreferrer nofollow')
  })

  it('a stored embed that fails the allowlist is NEVER an iframe (a crafted note, a crafted paste)', () => {
    const ed = mount([
      embed({ provider: 'youtube', ref: '"><img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }),
      embed({ provider: 'evil', ref: 'x', url: 'https://example.com/v' }),
    ])
    expect(ed.view.dom.querySelectorAll('iframe')).toHaveLength(0)
    const links = [...ed.view.dom.querySelectorAll('.uctWebEmbed a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['https://example.com/v'])
  })

  it('pasted HTML carrying an iframe or a data-src cannot point one anywhere', () => {
    const json = generateJSON('<div data-type="web-embed" data-provider="youtube" data-ref="dQw4w9WgXcQ" data-src="https://evil.example/x"></div><iframe src="https://evil.example/"></iframe>', buildExtensions())
    const ed = mount(json.content)
    const frames = [...ed.view.dom.querySelectorAll('iframe')].map((f) => f.getAttribute('src'))
    expect(frames).toEqual([embedSrc('youtube', 'dQw4w9WgXcQ')])
  })

  it('its HTML (the clipboard, an HTML export) is a plain link — never an iframe', () => {
    const ed = mount([embed({ provider: 'youtube', ref: 'dQw4w9WgXcQ', url: YT })])
    const html = ed.getHTML()
    expect(html).not.toMatch(/iframe/)
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"')
  })

  it('a re-render of the same player leaves its iframe alone (no restart)', () => {
    const ed = mount([embed({ provider: 'youtube', ref: 'dQw4w9WgXcQ', url: YT }), P('x')])
    const before = ed.view.dom.querySelector('iframe')
    // A decoration landing on the node (find-in-note's highlight is one) makes
    // ProseMirror call update() with the SAME player.
    const size = ed.state.doc.firstChild.nodeSize
    ed.registerPlugin(new Plugin({ props: { decorations: (state) =>
      DecorationSet.create(state.doc, [Decoration.node(0, size, { class: 'uctFindHit' })]) } }))
    expect(ed.view.dom.querySelector('.uctFindHit')).not.toBeNull()
    expect(ed.view.dom.querySelector('iframe')).toBe(before)
    // A different player does re-render.
    ed.view.dispatch(ed.state.tr.setNodeMarkup(0, null, { provider: 'youtube', ref: 'aaaaaaaaaaa', url: 'https://youtu.be/aaaaaaaaaaa' }))
    expect(ed.view.dom.querySelector('iframe').getAttribute('src')).toBe(embedSrc('youtube', 'aaaaaaaaaaa'))
  })
})

describe('the preview card node', () => {
  const card = (attrs) => ({ type: 'linkPreview', attrs })
  const ATTRS = { url: ARTICLE, title: 'NVDA prints a record quarter', description: 'Data-centre revenue beat.',
    domain: 'news.example.com', image: 'https://news.example.com/card.png' }

  it('renders from its attrs alone — opening a note never fetches', () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network')))
    const ed = mount([card(ATTRS)])
    const a = ed.view.dom.querySelector('a.uctLinkPreviewCard')
    expect(a.getAttribute('href')).toBe(ARTICLE)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    expect(ed.view.dom.querySelector('.uctLinkPreviewTitle').textContent).toBe(ATTRS.title)
    expect(ed.view.dom.querySelector('.uctLinkPreviewDesc').textContent).toBe(ATTRS.description)
    expect(ed.view.dom.querySelector('.uctLinkPreviewDomain').textContent).toBe(ATTRS.domain)
    expect(spy).not.toHaveBeenCalled()
  })

  it('a remote image loads lazily with no referrer, and only from https', () => {
    const ed = mount([card(ATTRS), card({ ...ATTRS, image: 'http://cdn.example.com/x.png' }),
      card({ ...ATTRS, image: 'javascript:alert(1)' })])
    const imgs = [...ed.view.dom.querySelectorAll('img.uctLinkPreviewImage')]
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(imgs[0].getAttribute('loading')).toBe('lazy')
  })

  it('a stored card whose link is not a web link is not a link', () => {
    const ed = mount([card({ ...ATTRS, url: 'javascript:alert(1)' })])
    expect(ed.view.dom.querySelector('.uctLinkPreview a')).toBeNull()
    expect(ed.view.dom.querySelector('.uctLinkPreviewTitle').textContent).toBe(ATTRS.title)
  })

  it('round-trips through its own HTML with every field', () => {
    const ed = mount([card(ATTRS)])
    const json = generateJSON(ed.getHTML(), buildExtensions())
    expect(json.content[0]).toEqual({ type: 'linkPreview', attrs: ATTRS })
  })

  it('reads as NOTHING in citation text (one position, no separator)', () => {
    const ed = mount([P('Read this.'), card(ATTRS), P('After.')])
    expect(citationText(ed.state.doc, 0, ed.state.doc.content.size)).toBe('Read this.\nAfter.')
  })
})

describe('pasting a lone link (the offer)', () => {
  it('a lone https link lands as a LINK at once and offers a card (no embed for an article)', () => {
    const ed = mount([P('See ')])
    caret(ed, at(ed, 'See ') + 4)
    ed.view.pasteText(ARTICLE)
    expect(ed.state.doc.textContent).toBe(`See ${ARTICLE}`)
    const linkMark = ed.state.doc.nodeAt(at(ed, 'https')).marks.find((m) => m.type.name === 'link')
    expect(linkMark.attrs.href).toBe(ARTICLE)
    expect(offerOf(ed)).toMatchObject({ url: ARTICLE, preview: true, embed: null })
    expect(offerStillValid(ed.state, offerOf(ed))).toBe(true)
  })

  it('a YouTube link offers the embed too', () => {
    const ed = mount([P('')])
    ed.view.pasteText(YT)
    expect(offerOf(ed)).toMatchObject({ preview: true, embed: { provider: 'youtube', ref: 'dQw4w9WgXcQ' } })
  })

  it('plain http gets no card (the server fetch is https-only): an article is just a link, YouTube offers only the embed', () => {
    const ed = mount([P('')])
    ed.view.pasteText('http://old.example.com/page')
    expect(offerOf(ed)).toBeNull()
    expect(ed.state.doc.textContent).toBe('http://old.example.com/page')
    ed.view.pasteText(' ')
    ed.view.pasteText('http://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(offerOf(ed)).toMatchObject({ preview: false, embed: { provider: 'youtube' } })
  })

  it('no offer for: words around a link, a selection (Link wraps it), a code block', () => {
    const ed = mount([P('pick me'), { type: 'codeBlock', content: [{ type: 'text', text: 'CODE' }] }])
    caret(ed, at(ed, 'pick'))
    ed.view.pasteText(`read ${ARTICLE} now`)
    expect(offerOf(ed), 'words around').toBeNull()
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at(ed, 'pick'), at(ed, 'pick') + 4)))
    ed.view.pasteText(ARTICLE)
    expect(offerOf(ed), 'over a selection').toBeNull()
    const wrapped = ed.state.doc.nodeAt(at(ed, 'pick'))
    expect(wrapped.text.startsWith('pick')).toBe(true)
    expect(wrapped.marks.find((m) => m.type.name === 'link')?.attrs.href, 'Link wrapped the selection').toBe(ARTICLE)
    caret(ed, at(ed, 'CODE') + 4)
    ed.view.pasteText(ARTICLE)
    expect(offerOf(ed), 'in a code block').toBeNull()
    let code = null
    ed.state.doc.forEach((n) => { if (n.type.name === 'codeBlock') code = n })
    expect(code.textContent).toBe(`CODE${ARTICLE}`)
    expect(code.firstChild.marks).toEqual([])
  })

  it('the offer ends at the first other edit, a caret move, or Escape — the link stays', () => {
    const ed = mount([P('a'), P('b')])
    caret(ed, at(ed, 'a') + 1)
    ed.view.pasteText(ARTICLE)
    expect(offerOf(ed)).not.toBeNull()
    ed.commands.insertContent('!')
    expect(offerOf(ed)).toBeNull()

    // An edit ELSEWHERE (the caret does not move) ends it too: the range it
    // names is no longer where the link is.
    ed.view.pasteText(ARTICLE)
    expect(offerOf(ed)).not.toBeNull()
    ed.view.dispatch(ed.state.tr.insertText('Z', 1))
    expect(offerOf(ed)).toBeNull()

    ed.view.pasteText(ARTICLE)
    caret(ed, at(ed, 'b'))
    expect(offerOf(ed)).toBeNull()

    caret(ed, at(ed, 'b') + 1)
    ed.view.pasteText(ARTICLE)
    fireEvent.keyDown(ed.view.dom, { key: 'Escape', code: 'Escape' })
    expect(offerOf(ed)).toBeNull()
    expect(ed.state.doc.lastChild.textContent).toBe(`b${ARTICLE}`)
  })

  it('a link with anything else in the paste (a line break, a second block) is not a lone link', () => {
    const ed = mount([P('')])
    ed.view.pasteHTML(`<p>${ARTICLE}<br>tail</p>`)
    expect(offerOf(ed), 'a break').toBeNull()
    let breaks = 0
    ed.state.doc.descendants((n) => { if (n.type.name === 'hardBreak') breaks += 1 })
    expect(breaks).toBe(1)
    ed.commands.setContent({ type: 'doc', content: [P('')] })
    ed.view.pasteHTML(`<p>${ARTICLE}</p><p>more</p>`)
    expect(offerOf(ed), 'two blocks').toBeNull()
  })

  it('a read-only (locked) note takes no paste at all', () => {
    const ed = mount([P('x')], { editable: false })
    ed.view.pasteText(ARTICLE)
    expect(offerOf(ed)).toBeNull()
  })
})

describe('placing the card or the embed', () => {
  const PREVIEW = { title: 'T', description: 'D', domain: 'news.example.com', image: 'https://news.example.com/i.png' }

  it('a paragraph that is JUST the link becomes the card', () => {
    const ed = mount([P('Intro.'), P('')])
    caret(ed, ed.state.doc.content.size - 1)
    ed.view.pasteText(ARTICLE)
    expect(placeLinkBlock(ed, offerOf(ed), previewCardNode(ed.schema, ARTICLE, PREVIEW))).toBe(true)
    expect(types(ed)).toEqual(['paragraph', 'linkPreview'].concat(types(ed).slice(2)))
    expect(ed.state.doc.child(1).attrs).toEqual({ url: ARTICLE, ...PREVIEW })
    expect(ed.state.doc.textContent).not.toContain(ARTICLE)
    expect(offerOf(ed)).toBeNull()
  })

  it('a link inside a sentence KEEPS its link, and the card goes after the paragraph', () => {
    const ed = mount([P('Read '), P('Next.')])
    caret(ed, at(ed, 'Read ') + 5)
    ed.view.pasteText(ARTICLE)
    ed.commands.command(() => true)
    const offer = offerOf(ed)
    expect(placeLinkBlock(ed, offer, previewCardNode(ed.schema, ARTICLE, PREVIEW))).toBe(true)
    expect(types(ed).slice(0, 3)).toEqual(['paragraph', 'linkPreview', 'paragraph'])
    expect(ed.state.doc.child(0).textContent).toBe(`Read ${ARTICLE}`)
  })

  it('a stale offer (the text moved on) replaces nothing', () => {
    const ed = mount([P('')])
    ed.view.pasteText(ARTICLE)
    const offer = offerOf(ed)
    ed.commands.setContent({ type: 'doc', content: [P('something else entirely here')] })
    const before = ed.state.doc
    expect(placeLinkBlock(ed, offer, previewCardNode(ed.schema, ARTICLE, PREVIEW))).toBe(false)
    expect(ed.state.doc.eq(before)).toBe(true)
  })

  it('the card is built from the server answer with every field re-checked', () => {
    const ed = mount([P('')])
    const node = previewCardNode(ed.schema, ARTICLE, { title: 'x'.repeat(900), image: 'http://insecure.example/i.png', domain: 5 })
    expect(node.attrs.title).toHaveLength(300)
    expect(node.attrs.image).toBeNull()
    expect(node.attrs.domain).toBeNull()
  })
})

describe('<LinkPasteMenu>', () => {
  const PREVIEW = { url: ARTICLE, title: 'NVDA prints a record quarter', description: 'Beat.', domain: 'news.example.com', image: null }

  function pasteAndRender(url, content = [P('')]) {
    const ed = mount(content)
    render(<LinkPasteMenu editor={ed} />)
    act(() => { ed.view.pasteText(url) })
    return ed
  }

  it('offers Link · Preview card · Embed for a YouTube link, and only Link · Preview card for an article', () => {
    const ed = pasteAndRender(YT)
    const bar = screen.getByRole('toolbar', { name: 'Pasted link' })
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Link', 'Preview card', 'Embed'])
    act(() => { ed.commands.insertContent(' ') })
    expect(screen.queryByRole('toolbar', { name: 'Pasted link' })).toBeNull()
    act(() => { ed.view.pasteText(ARTICLE) })
    expect([...screen.getByRole('toolbar', { name: 'Pasted link' }).querySelectorAll('button')].map((b) => b.textContent.trim()))
      .toEqual(['Link', 'Preview card'])
  })

  it('Preview card asks the server ONCE for this link and places the card from its answer', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => PREVIEW })
    const ed = pasteAndRender(ARTICLE)
    fireEvent.click(screen.getByRole('button', { name: 'Preview card' }))
    await waitFor(() => expect(types(ed)[0]).toBe('linkPreview'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe(`/api/j2/link-preview?url=${encodeURIComponent(ARTICLE)}`)
    expect(ed.state.doc.child(0).attrs.title).toBe(PREVIEW.title)
    expect(screen.queryByRole('toolbar', { name: 'Pasted link' })).toBeNull()
  })

  it('no preview (server refusal, offline) says so and KEEPS the link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'That link is not a web page.' }) })
    const ed = pasteAndRender(ARTICLE)
    fireEvent.click(screen.getByRole('button', { name: 'Preview card' }))
    expect(await screen.findByText('That link is not a web page. Kept as a link.')).toBeTruthy()
    expect(types(ed)[0]).toBe('paragraph')
    expect(ed.state.doc.textContent).toBe(ARTICLE)
  })

  it('Embed places the allowlisted player; Link keeps the link and closes', () => {
    const ed = pasteAndRender(YT)
    fireEvent.click(screen.getByRole('button', { name: 'Embed' }))
    expect(types(ed)[0]).toBe('webEmbed')
    expect(ed.state.doc.child(0).attrs).toEqual({ provider: 'youtube', ref: 'dQw4w9WgXcQ', url: YT })

    act(() => { ed.commands.setContent({ type: 'doc', content: [P('')] }) })
    act(() => { ed.view.pasteText(YT) })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(screen.queryByRole('toolbar', { name: 'Pasted link' })).toBeNull()
    expect(ed.state.doc.textContent).toBe(YT)
  })

  it('the buttons never take the caret (mousedown is held)', () => {
    pasteAndRender(ARTICLE)
    const btn = screen.getByRole('button', { name: 'Preview card' })
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})

describe('fetchLinkPreview', () => {
  it('encodes the link and surfaces the server reason', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: "Couldn't reach that page." }) })
    await expect(fetchLinkPreview('https://e.example/a?b=1&c=2', f)).rejects.toThrow("Couldn't reach that page.")
    expect(f.mock.calls[0][0]).toBe('/api/j2/link-preview?url=https%3A%2F%2Fe.example%2Fa%3Fb%3D1%26c%3D2')
  })
})
