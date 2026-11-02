/**
 * Plan B Task 12 (spec §10): the messy EVERNOTE corpus, through the real client import path
 * (`__tests__/corpora.harness.js`), asserted on the STORED body (the PUT) and the RENDERED DOM, raw.
 *
 * Corpus: `__fixtures__/corpora/evernote/` -- `Messy Clips.enex` (a web clip with a source URL,
 * nameless / `quote.ashx` / `clip-image` resources, HEIC + SVG + PDF resources, data: images,
 * hotlinked images on hosts the scripted fetch door copies, refuses, times out and 404s, note
 * links by title in every Evernote href form, a hash-mismatched en-media paired 1:1 and an
 * ambiguous pair that is not) and `Archive.enex` (a title a link in the other file names).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  importCorpus, folderDrop, fixtureBytes, renderBody, destroyEditors, renderedLinks, renderedImgs,
  renderedChips, renderedNotices, storedLinks, storedText, nodes, noteHref, assertCorpusInvariants, ATTACH,
  FIRST_BACKOFF_MS, makeServer,
} from './__tests__/corpora.harness'
import { MEDIA_RETRY_MAX_ATTEMPTS } from '../importNoticeText'

let run
const resources = new Map() // file-name (or `nameless`) -> {bytes, mime}

beforeAll(async () => {
  run = await importCorpus(folderDrop('evernote'), { expectAdapter: 'evernote' })
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(fixtureBytes('evernote/Messy Clips.enex')), 'text/xml')
  for (const r of xml.querySelectorAll('resource')) {
    const b64 = r.querySelector('data').textContent.replace(/\s+/g, '')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const name = r.querySelector('file-name')?.textContent || 'nameless'
    resources.set(name, { bytes, mime: r.querySelector('mime').textContent })
  }
})
afterEach(destroyEditors)

const key = (title) => {
  const hits = run.docs.filter((d) => d.title === title)
  expect(hits, title).toHaveLength(1)
  return hits[0].importKey
}
const id = (title) => run.idOf(key(title))
const uploadsNamed = (name) => run.server.uploads.filter((u) => u.name === name && u.status === 200)
const paragraphLinks = (root, startsWith) => {
  const p = [...root.querySelectorAll('p')].find((x) => x.textContent.startsWith(startsWith))
  expect(p, startsWith).toBeTruthy()
  return renderedLinks(p)
}

describe('Evernote corpus: the whole run', () => {
  it('imports every note of both .enex files, with nothing failed and the ambiguous title named', () => {
    expect(run.docs.map((d) => d.title).sort()).toEqual(['Duplicate title', 'Duplicate title', 'Hash mismatch ambiguous',
      'Hash mismatch paired', 'Links to notes', 'Media mess', 'Trade plan', 'Watchlist', 'Web clip: semis rally'])
    expect(run.summary.created).toBe(9)
    expect(run.summary.failures).toEqual([])
    expect(run.summary.failedBatches).toEqual([])
    expect(run.warnings).toEqual(['Link "Duplicate title" in "Links to notes" was kept as text: more than one note is titled "Duplicate title".'])
  })

  it('every written note holds the corpus-wide invariants (stored + rendered)', () => {
    expect(assertCorpusInvariants(run)).toBe(9)
  })

  it('each door met ONE 429 and its retry landed (images, attachments, fetch, heal)', () => {
    const first = (pred) => run.server.calls.filter(pred).slice(0, 2).map((c) => c.status)
    expect(first((c) => c.url.endsWith('/images'))).toEqual([429, 200])
    expect(first((c) => c.url.endsWith('/attachments'))).toEqual([429, 200])
    expect(first((c) => c.url.endsWith('/media/fetch'))).toEqual([429, 200])
    expect(first((c) => c.url.endsWith('/heal-links'))).toEqual([429, 200])
    // No Retry-After (the real doors send none): each 429 took commit.js's OWN back-off branch
    expect(run.sleeps).toEqual([FIRST_BACKOFF_MS, FIRST_BACKOFF_MS, FIRST_BACKOFF_MS, FIRST_BACKOFF_MS])
    expect(run.server.calls.filter((c) => c.status === 429)).toHaveLength(4)
  })

  it('the summary lists exactly what did not come over, once each', () => {
    expect(run.summary.notices.map((n) => [n.note, n.reason, n.name, n.sourceUrl])).toEqual([
      ['Web clip: semis rally', 'fetch_failed', 'p.png', 'https://blocked.example.org/p.png'],
      ['Media mess', 'decode_failed', null, null],
      ['Media mess', 'fetch_failed', 's.png', 'https://slow.example.com/s.png'],
      ['Media mess', 'fetch_failed', 'g.png', 'https://gone.example.com/g.png'],
      ['Hash mismatch ambiguous', 'missing_resource', null, null],
      ['Hash mismatch ambiguous', 'missing_resource', null, null],
    ])
  })
})

describe('Evernote corpus: the web clip', () => {
  it('web-clip relative link opens the source site', () => {
    const body = run.bodyOf('Web clip: semis rally')
    const want = [
      { text: 'story', href: 'https://news.example.com/markets/x' },
      { text: 'anchor', href: 'https://news.example.com/markets/semis.html#top' },
      { text: 'protocol-relative', href: 'https://cdn.example.com/proto' },
    ]
    for (const w of want) expect(storedLinks(body)).toContainEqual(w)
    const root = renderBody(body)
    expect(paragraphLinks(root, 'Relative').map(({ text, href }) => ({ text, href }))).toEqual(want)
  })

  it('the clip source is the first line and a working link', () => {
    const body = run.bodyOf('Web clip: semis rally')
    const root = renderBody(body)
    expect(root.firstElementChild.textContent).toBe('Source: https://news.example.com/markets/semis.html')
    expect(renderedLinks(root.firstElementChild)).toEqual([
      { text: 'https://news.example.com/markets/semis.html', href: 'https://news.example.com/markets/semis.html', plain: false }])
  })

  it('bare URL is a link, URL in code is not; tickers and dotted names stay text; CJK cuts the URL', () => {
    const body = run.bodyOf('Web clip: semis rally')
    const links = storedLinks(body)
    expect(links).toContainEqual({ text: 'https://example.com/path', href: 'https://example.com/path' })
    expect(links).toContainEqual({ text: 'www.example.com/a', href: 'https://www.example.com/a' })
    expect(links).toContainEqual({ text: 'https://example.com/路径', href: 'https://example.com/路径' })
    expect(links.some((l) => /in-code|NVDA|BRK/.test(l.href))).toBe(false)
    const root = renderBody(body)
    const code = root.querySelector('code')
    expect(code.textContent).toBe('https://example.com/in-code')
    expect(code.querySelector('a')).toBeNull()
    expect(paragraphLinks(root, 'Read').map((l) => l.href)).toEqual(['https://example.com/path', 'https://www.example.com/a'])
    expect([...root.querySelectorAll('p')].find((p) => p.textContent.startsWith('Read')).textContent)
      .toBe('Read https://example.com/path. Also www.example.com/a, NVDA.US and BRK.B are tickers.')
    expect(paragraphLinks(root, '见')).toEqual([{ text: 'https://example.com/路径', href: 'https://example.com/路径', plain: false }])
  })

  it('tel: and mailto: are kept; javascript:, java<TAB>script:, vbscript:, file:, data: become their text', () => {
    const root = renderBody(run.bodyOf('Web clip: semis rally'))
    expect(paragraphLinks(root, 'call desk')).toEqual([
      { text: 'call desk', href: 'tel:+15550100', plain: false },
      { text: 'mail desk', href: 'mailto:desk@example.com', plain: false },
    ])
    const p = [...root.querySelectorAll('p')].find((x) => x.textContent.startsWith('js'))
    expect(p.textContent).toBe('js tabbed vb local datalink')
    expect(p.querySelector('a')).toBeNull()
  })

  it('nameless web-clip image uploads with its declared type and renders', () => {
    const [up] = uploadsNamed('attachment.png')
    expect(up.type).toBe('image/png')
    expect([...up.bytes]).toEqual([...resources.get('nameless').bytes])
    // `quote.ashx` and `clip-image` carry no image extension: the DECLARED <mime> is what is sent
    expect(uploadsNamed('quote.ashx').map((u) => u.type)).toEqual(['image/gif'])
    expect([...uploadsNamed('quote.ashx')[0].bytes]).toEqual([...resources.get('quote.ashx').bytes])
    expect(uploadsNamed('clip-image').map((u) => u.type)).toEqual(['image/jpeg'])
    const body = run.bodyOf('Web clip: semis rally')
    const srcs = nodes(body, 'image').map((i) => i.attrs.src)
    expect(srcs.slice(0, 3)).toEqual([
      `${ATTACH}${id('Web clip: semis rally')}/inline/2-attachment.png`,
      `${ATTACH}${id('Web clip: semis rally')}/inline/3-quote.ashx`,
      `${ATTACH}${id('Web clip: semis rally')}/inline/4-clip-image`,
    ])
    expect(renderedImgs(renderBody(body)).slice(0, 3)).toEqual(srcs.slice(0, 3))
  })

  it('remote image is copied in, never hotlinked (a relative one resolves against the clip source)', () => {
    const body = run.bodyOf('Web clip: semis rally')
    expect(run.server.fetches.filter((f) => f.status === 200).map((f) => f.url)).toEqual([
      'https://cdn.example.com/r.png', 'https://news.example.com/img/move.png'])
    for (const img of nodes(body, 'image')) expect(img.attrs.src.startsWith('http')).toBe(false)
    expect(nodes(body, 'image').map((i) => i.attrs.src).slice(3)).toEqual([
      `${ATTACH}${id('Web clip: semis rally')}/inline/fetched-r.png`,
      `${ATTACH}${id('Web clip: semis rally')}/inline/fetched-move.png`,
    ])
  })

  it('failed remote image is a notice with the original URL, in its place', () => {
    const body = run.bodyOf('Web clip: semis rally')
    const types = body.content.map((n) => n.type)
    const at = types.indexOf('importNotice')
    expect(body.content[at - 1].content[0].text).toBe(' blocked:')
    expect(body.content[at].attrs).toEqual({ reason: 'fetch_failed', name: 'p.png', sourceUrl: 'https://blocked.example.org/p.png',
      ref: expect.stringMatching(/^remote-/), attempts: MEDIA_RETRY_MAX_ATTEMPTS })
    expect(renderedNotices(renderBody(body))).toEqual([
      { text: "Couldn't copy p.png — open the original", href: 'https://blocked.example.org/p.png' }])
  })
})

describe('Evernote corpus: media', () => {
  it('HEIC renders the converted image and keeps the original as a chip', () => {
    const [up] = uploadsNamed('IMG_0001.HEIC')
    expect(up.type).toBe('image/heic')
    expect([...up.bytes]).toEqual([...resources.get('IMG_0001.HEIC').bytes])
    const body = run.bodyOf('Media mess')
    const n = id('Media mess')
    expect(body.content.slice(1, 3)).toEqual([
      { type: 'image', attrs: expect.objectContaining({ src: `${ATTACH}${n}/inline/5-IMG_0001.jpg` }) },
      { type: 'attachmentChip', attrs: { href: `${ATTACH}${n}/files/5-IMG_0001.HEIC`, name: 'IMG_0001.HEIC' } },
    ])
    const root = renderBody(body)
    expect(renderedImgs(root)[0]).toBe(`${ATTACH}${n}/inline/5-IMG_0001.jpg`)
    expect(renderedChips(root)[0]).toEqual({ href: `${ATTACH}${n}/files/5-IMG_0001.HEIC`, name: 'IMG_0001.HEIC' })
  })

  it('SVG is kept as a downloadable file, never an <img> of a stored SVG', () => {
    expect(uploadsNamed('logo.svg').map((u) => [u.door, u.type])).toEqual([['images', 'image/svg+xml']])
    const body = run.bodyOf('Media mess')
    const n = id('Media mess')
    expect(nodes(body, 'attachmentChip').map((c) => c.attrs.href)).toContain(`${ATTACH}${n}/files/6-logo.svg`)
    const root = renderBody(body)
    expect(renderedChips(root)).toContainEqual({ href: `${ATTACH}${n}/files/6-logo.svg`, name: 'logo.svg' })
    expect(renderedImgs(root).some((s) => s.endsWith('.svg'))).toBe(false)
  })

  it('link around an image and around a PDF survives as a link line, the media just before it', () => {
    const body = run.bodyOf('Media mess')
    const n = id('Media mess')
    const types = body.content.map((x) => x.type)
    const pdf = body.content.findIndex((x) => x.type === 'attachmentChip' && x.attrs.name === 'report.pdf')
    expect(body.content[pdf + 1]).toMatchObject({ type: 'paragraph', content: [{ text: 'https://example.com/report',
      marks: [{ type: 'link', attrs: { href: 'https://example.com/report' } }] }] })
    const chart = body.content.findIndex((x) => x.type === 'image' && x.attrs.src === `${ATTACH}${n}/inline/9-chart.png`)
    expect(chart).toBeGreaterThan(pdf)
    expect(body.content[chart + 1]).toMatchObject({ type: 'paragraph', content: [{ text: 'https://example.com/chart',
      marks: [{ type: 'link', attrs: { href: 'https://example.com/chart' } }] }] })
    expect(uploadsNamed('report.pdf').map((u) => [u.door, u.type])).toEqual([['attachments', 'application/pdf']])
    expect(types.length).toBeGreaterThan(chart + 1)
    const root = renderBody(body)
    expect(renderedLinks(root).map((l) => l.href)).toEqual(['https://example.com/report', 'https://example.com/chart'])
  })

  it('data: image is uploaded (base64 and percent-encoded); a malformed one is a notice', () => {
    const n = id('Media mess')
    const pngs = run.server.uploads.filter((u) => u.noteId === n && u.name === 'image.png' && u.status === 200)
    expect(pngs.map((u) => u.type)).toEqual(['image/png'])
    // the percent-encoded SVG is uploaded as declared and comes back a FILE (a chip)
    const svg = run.server.uploads.filter((u) => u.noteId === n && u.name === 'image.svg')
    expect(svg.map((u) => [u.type, new TextDecoder().decode(u.bytes)])).toEqual([
      ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>']])
    const body = run.bodyOf('Media mess')
    expect(nodes(body, 'image').map((i) => i.attrs.src)).toContain(`${ATTACH}${n}/inline/10-image.png`)
    expect(nodes(body, 'attachmentChip').map((c) => c.attrs.name)).toContain('image.svg')
    expect(nodes(body, 'importNotice').map((x) => x.attrs.reason)).toEqual(['decode_failed', 'fetch_failed', 'fetch_failed'])
    expect(JSON.stringify(body)).not.toMatch(/"(src|href)":"\s*data:/i)
  })

  it('a door that never answers is stopped and named; a dead upstream (the door\'s 422) is fetch_failed with the URL kept', () => {
    expect(run.server.fetches.filter((f) => f.url.includes('slow.example.com')).map((f) => f.status)).toEqual(['aborted'])
    expect(run.server.fetches.filter((f) => f.url.includes('gone.example.com')).map((f) => f.status)).toEqual([422])
    const notices = nodes(run.bodyOf('Media mess'), 'importNotice').slice(1)
    expect(notices.map((x) => [x.attrs.reason, x.attrs.name, x.attrs.sourceUrl])).toEqual([
      ['fetch_failed', 's.png', 'https://slow.example.com/s.png'],
      ['fetch_failed', 'g.png', 'https://gone.example.com/g.png'],
    ])
  })

  it('hash-mismatched image stays in place when the pairing is unambiguous (1 : 1)', () => {
    const body = run.bodyOf('Hash mismatch paired')
    expect(body.content[0].content.map((x) => x.text)).toEqual(['Before'])
    expect(body.content[1]).toMatchObject({ type: 'image', attrs: { src: `${ATTACH}${id('Hash mismatch paired')}/inline/13-reencoded.png` } })
    expect(body.content[2].content.map((x) => x.text)).toEqual([' after'])
    expect(nodes(body, 'importNotice')).toEqual([])
    expect([...uploadsNamed('reencoded.png')[0].bytes]).toEqual([...resources.get('reencoded.png').bytes])
  })

  it('an ambiguous mismatch is a notice in place, never a guess, and no bytes are lost', () => {
    const body = run.bodyOf('Hash mismatch ambiguous')
    const n = id('Hash mismatch ambiguous')
    expect(body.content.map((x) => x.type)).toEqual(['paragraph', 'importNotice', 'paragraph', 'importNotice', 'paragraph', 'image', 'image'])
    expect(nodes(body, 'importNotice').map((x) => x.attrs.reason)).toEqual(['missing_resource', 'missing_resource'])
    expect(nodes(body, 'image').map((i) => i.attrs.src)).toEqual([`${ATTACH}${n}/inline/14-first.png`, `${ATTACH}${n}/inline/15-second.png`])
    expect(renderedNotices(renderBody(body)).map((x) => x.text)).toEqual([
      "This item couldn't be found, so it wasn't copied", "This item couldn't be found, so it wasn't copied"])
  })
})

describe('Evernote corpus: links between notes', () => {
  const linksIn = (startsWith) => paragraphLinks(renderBody(run.bodyOf('Links to notes')), startsWith)

  it('note link by title is a real internal link (app, shard and share forms; across .enex files)', () => {
    const plan = noteHref(id('Trade plan'))
    expect(linksIn('App link')).toEqual([{ text: 'Trade plan', href: plan, plain: false }])
    expect(linksIn('Share link')).toEqual([{ text: 'Watchlist', href: noteHref(id('Watchlist')), plain: false }])
    expect(storedLinks(run.bodyOf('Links to notes'))).toContainEqual({ text: 'Watchlist', href: noteHref(id('Watchlist')) })
  })

  it('bold inside a note link survives, and the link is one target', () => {
    const body = run.bodyOf('Links to notes')
    const para = body.content.find((p) => (p.content || [])[0]?.text === 'Shard link: ')
    expect(para.content.slice(1)).toEqual([
      { type: 'text', text: 'Trade', marks: [expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: noteHref(id('Trade plan')) }) }), { type: 'bold' }] },
      { type: 'text', text: ' plan', marks: [expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: noteHref(id('Trade plan')) }) })] },
    ])
    const root = renderBody(body)
    const a = [...root.querySelectorAll('a')].find((x) => x.textContent === 'Trade plan' && x.querySelector('strong'))
    expect(a.getAttribute('href')).toBe(noteHref(id('Trade plan')))
    expect(a.querySelector('strong').textContent).toBe('Trade')
  })

  it('image inside a note link survives, and the link keeps its target', () => {
    const body = run.bodyOf('Links to notes')
    const at = body.content.findIndex((x) => x.type === 'image')
    expect(body.content[at].attrs.src).toBe(`${ATTACH}${id('Links to notes')}/inline/12-thumb.png`)
    expect(body.content[at + 1]).toMatchObject({ type: 'paragraph', content: [{ text: 'Trade plan',
      marks: [{ type: 'link', attrs: { href: noteHref(id('Trade plan')) } }] }] })
    expect([...uploadsNamed('thumb.png')[0].bytes]).toEqual([...resources.get('thumb.png').bytes])
  })

  it('ambiguous title stays text and the summary says so', () => {
    const root = renderBody(run.bodyOf('Links to notes'))
    const p = [...root.querySelectorAll('p')].find((x) => x.textContent.startsWith('Ambiguous'))
    expect(p.textContent).toBe('Ambiguous: Duplicate title')
    expect(p.querySelector('a')).toBeNull()
    expect(run.warnings.some((w) => w.includes('more than one note is titled "Duplicate title"'))).toBe(true)
  })

  it('missing title is a healable placeholder and listed as not connected', () => {
    const body = run.bodyOf('Links to notes')
    expect(storedLinks(body)).toContainEqual({ text: 'Missing note', href: 'import-link://evernote-title:Missing note' })
    expect(linksIn('Shared')).toEqual([{ text: 'Missing note', href: 'import-link://evernote-title:Missing note', plain: true }])
    expect(run.summary.unconnectedLinks).toContainEqual({ note: 'Links to notes', text: 'Missing note' })
    // the heal door was asked about exactly the note that kept links
    expect(run.server.heals.map((h) => h.noteIds)).toEqual([[id('Links to notes')], [id('Links to notes')]])
  })

  it('a >300-character title keys on the server\'s 300-code-point cut, the text stays whole', () => {
    const long = 'L'.repeat(320)
    expect(storedLinks(run.bodyOf('Links to notes'))).toContainEqual({ text: long, href: `import-link://evernote-title:${'L'.repeat(300)}` })
    expect(run.summary.unconnectedLinks).toContainEqual({ note: 'Links to notes', text: long })
  })

  it('an evernote.com page that is not a note is an ordinary web link', () => {
    expect(linksIn('Not a note')).toEqual([{ text: 'pricing', href: 'https://evernote.com/pricing', plain: false }])
  })

  it('the stored text of the links note reads as written', () => {
    expect(storedText(run.bodyOf('Links to notes'))).toBe(['App link: Trade plan', 'Shard link: Trade plan', 'Share link: Watchlist',
      'Shared: Missing note', 'Ambiguous: Duplicate title', 'Picture link:', 'Trade plan', `Long: ${'L'.repeat(320)}`,
      'Not a note: pricing'].join(''))
  })
})

describe('Evernote corpus: a title link heals against an EARLIER import (link_keys.resolve_link_keys)', () => {
  const MISSING = 'import-link://evernote-title:Missing note'
  const earlier = (id, title) => ({ id, title, source: 'Evernote',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From an earlier import.' }] }] } })

  it('ONE earlier Evernote note of that (whitespace-normalised) title: the heal door rewrites the link to it', async () => {
    const server = makeServer({ existing: { 'evernote:Old book/Missing note/20250101T000000Z': earlier('old1', '  Missing   note ') } })
    const healedRun = await importCorpus(folderDrop('evernote'), { server })
    const body = healedRun.bodyOf('Links to notes')
    expect(storedLinks(body)).toContainEqual({ text: 'Missing note', href: noteHref('old1') })
    expect(storedLinks(body).map((l) => l.href)).not.toContain(MISSING)
    const [a] = paragraphLinks(renderBody(body), 'Shared')
    expect(a).toEqual({ text: 'Missing note', href: noteHref('old1'), plain: false })
    expect(healedRun.summary.unconnectedLinks.map((u) => u.text)).toEqual(['L'.repeat(320)])
    // the PUT still carried the placeholder: it was the HEAL that connected it, not the client
    const put = healedRun.server.putsRaw.find((p) => p.id === healedRun.idOf(healedRun.docs.find((d) => d.title === 'Links to notes').importKey))
    expect(storedLinks(put.bodyJson)).toContainEqual({ text: 'Missing note', href: MISSING })
  })

  it('TWO earlier notes of that title: never a guess, the link stays a placeholder and is listed', async () => {
    const server = makeServer({ existing: {
      'evernote:Old book/Missing note/20250101T000000Z': earlier('old1', 'Missing note'),
      'evernote:Old book/Missing note/20250202T000000Z': earlier('old2', 'Missing note'),
    } })
    const ambiguousRun = await importCorpus(folderDrop('evernote'), { server })
    const body = ambiguousRun.bodyOf('Links to notes')
    expect(storedLinks(body)).toContainEqual({ text: 'Missing note', href: MISSING })
    expect(paragraphLinks(renderBody(body), 'Shared')).toEqual([{ text: 'Missing note', href: MISSING, plain: true }])
    expect(ambiguousRun.summary.unconnectedLinks.map((u) => u.text)).toEqual(['Missing note', 'L'.repeat(320)])
  })
})
