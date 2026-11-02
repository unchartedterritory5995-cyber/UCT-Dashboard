// Plan B Task 2: media references -- one IMAGE_EXT, `data:` images become uploadable media
// items, remote and unresolvable images become refs, media is lifted out of links.
import { describe, it, expect } from 'vitest'
import SparkMD5 from 'spark-md5'
import {
  IMAGE_EXT,
  MEDIA_SOURCE_MAX_BYTES,
  extractDataUriImages,
  collectRemoteImages,
  liftMediaOutOfLinks,
} from './mediaRefs'
import { NOTICE_REASONS } from '../importNoticeText'

const dom = (html) => new DOMParser().parseFromString(html, 'text/html').body

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))
const pngMd5 = SparkMD5.ArrayBuffer.hash(pngBytes.buffer).toLowerCase()
const md5Text = (s) => SparkMD5.hash(s).toLowerCase()

describe('IMAGE_EXT', () => {
  it('covers avif, tif, tiff, heif', () => {
    ;['a.avif', 'a.tif', 'a.TIFF', 'a.heif'].forEach((n) => expect(IMAGE_EXT.test(n)).toBe(true))
  })
  it('covers the classic set and svg, and refuses documents', () => {
    ;['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.bmp', 'a.heic'].forEach((n) => expect(IMAGE_EXT.test(n)).toBe(true))
    ;['a.pdf', 'a.png.txt', 'png', 'a.tiffx'].forEach((n) => expect(IMAGE_EXT.test(n)).toBe(false))
  })
})

describe('extractDataUriImages', () => {
  it('decodes a base64 data: image into an uploadable media item', async () => {
    const b = dom(`<p><img src="data:image/png;base64,${PNG_B64}"></p>`)
    const media = []
    extractDataUriImages(b, media)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ ref: `data-${pngMd5}`, kind: 'image', mime: 'image/png', name: 'image.png' })
    expect(b.querySelector('img').getAttribute('src')).toBe(`import-ref://${media[0].ref}`)
    expect(await media[0].vfile.bytes()).toEqual(pngBytes)
    expect(media[0].vfile.size).toBe(pngBytes.length)
    expect(media[0].failed).toBeUndefined()
  })

  it('reads the scheme case-insensitively and tolerates leading whitespace and line breaks', async () => {
    const wrapped = PNG_B64.replace(/(.{20})/g, '$1\n')
    const b = dom(`<p><img src=" DATA:Image/PNG;Base64,${wrapped}"></p>`)
    const media = []
    extractDataUriImages(b, media)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ ref: `data-${pngMd5}`, mime: 'image/png', name: 'image.png' })
    expect(await media[0].vfile.bytes()).toEqual(pngBytes)
  })

  it('one media item per distinct image; repeats share the ref', () => {
    const src = `data:image/png;base64,${PNG_B64}`
    const b = dom(`<p><img src="${src}"><img src="${src}"></p>`)
    const media = []
    extractDataUriImages(b, media)
    expect(media).toHaveLength(1)
    const srcs = [...b.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs).toEqual([`import-ref://data-${pngMd5}`, `import-ref://data-${pngMd5}`])
  })

  it('decodes a percent-encoded svg (UTF-8) and names it by the mime', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">é</svg>'
    const b = dom(`<p><img src="data:image/svg+xml,${encodeURIComponent(svg)}"></p>`)
    const media = []
    extractDataUriImages(b, media)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ kind: 'image', mime: 'image/svg+xml', name: 'image.svg' })
    expect(new TextDecoder().decode(await media[0].vfile.bytes())).toBe(svg)
    expect(media[0].ref).toBe(`data-${md5Text(svg)}`)
  })

  it('percent-decodes to BYTES, so binary that is not UTF-8 survives', async () => {
    const b = dom('<p><img src="data:image/gif,%89%FF%00A"></p>')
    const media = []
    extractDataUriImages(b, media)
    expect(media).toHaveLength(1)
    expect(Array.from(await media[0].vfile.bytes())).toEqual([0x89, 0xff, 0x00, 0x41])
    expect(media[0].name).toBe('image.gif')
  })

  it('names jpeg as jpg and an unknown image subtype by its sanitised subtype', () => {
    const b = dom(`<p><img src="data:image/jpeg;base64,${PNG_B64}"><img src="data:image/x-Foo.bar;base64,QUJD"></p>`)
    const media = []
    extractDataUriImages(b, media)
    expect(media.map((m) => m.name)).toEqual(['image.jpg', 'image.xfoobar'])
  })

  it('marks an undecodable data: image as failed in place', () => {
    const b = dom('<p><img src="data:image/png;base64,@@not base64@@" alt="x"></p>')
    const media = []
    extractDataUriImages(b, media)
    expect(media).toEqual([{ ref: 'bad-data-1', kind: 'image', name: null, failed: { reason: 'decode_failed', sourceUrl: null } }])
    const img = b.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe('import-ref://bad-data-1')
  })

  it('marks a non-image and a malformed data: URI as failed, never left inline and never dropped', () => {
    const b = dom('<p><img src="data:text/html;base64,PGI+"><img src="data:image/png;base64"></p>')
    const media = []
    extractDataUriImages(b, media)
    expect(media.map((m) => [m.ref, m.failed.reason])).toEqual([['bad-data-1', 'decode_failed'], ['bad-data-2', 'decode_failed']])
    const srcs = [...b.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs).toEqual(['import-ref://bad-data-1', 'import-ref://bad-data-2'])
    expect(b.innerHTML).not.toContain('data:')
  })

  it('numbers failures past those already in the media list, so a second pass never collides', () => {
    const media = []
    extractDataUriImages(dom('<p><img src="data:text/plain,x"></p>'), media)
    extractDataUriImages(dom('<p><img src="data:text/plain,y"></p>'), media)
    expect(media.map((m) => m.ref)).toEqual(['bad-data-1', 'bad-data-2'])
  })

  const tooLarge = (src) => {
    const b = dom('<p></p>')
    const img = b.ownerDocument.createElement('img')
    img.setAttribute('src', src)
    b.firstChild.appendChild(img)
    const media = []
    extractDataUriImages(b, media)
    expect(media).toEqual([{ ref: 'bad-data-1', kind: 'image', name: null, failed: { reason: 'too_large', sourceUrl: null } }])
    expect(img.getAttribute('src')).toBe('import-ref://bad-data-1')
  }

  it('a URI longer than the server data_uri_max_chars is too_large before any decode (as the server)', () => {
    expect(MEDIA_SOURCE_MAX_BYTES).toBe(25 * 1024 * 1024)
    // Whitespace padding: it would decode to 4 bytes, yet the server refuses it on length alone.
    const padded = 'QUJD' + ' '.repeat(Math.floor((MEDIA_SOURCE_MAX_BYTES * 4) / 3) + 4096)
    tooLarge(`data:image/png;base64,${padded}`)
  })

  it('a URI under the length cap that still decodes past 25 MB is too_large', () => {
    // Under data_uri_max_chars (25 MB * 4/3 + 4096) but over 25 MB decoded.
    const b64 = 'A'.repeat(Math.ceil((MEDIA_SOURCE_MAX_BYTES * 4) / 3) + 400)
    tooLarge(`data:image/png;base64,${b64}`)
  })

  it('every failure reason is a notice reason', () => {
    expect(NOTICE_REASONS).toContain('decode_failed')
    expect(NOTICE_REASONS).toContain('too_large')
    expect(NOTICE_REASONS).toContain('unresolvable_src')
  })

  it('leaves non-data images alone', () => {
    const b = dom('<p><img src="https://x.example/a.png"><img src="import-ref://k"></p>')
    const media = []
    extractDataUriImages(b, media)
    expect(media).toEqual([])
    expect(b.innerHTML).toBe('<p><img src="https://x.example/a.png"><img src="import-ref://k"></p>')
  })
})

describe('collectRemoteImages', () => {
  it('turns http, https and protocol-relative hotlinks into one remote item per URL', () => {
    const b = dom(
      '<p><img src="https://cdn.example.com/a/chart.png"><img src="https://cdn.example.com/a/chart.png">' +
        '<img src="http://old.example.com/b.gif"><img src="//cdn2.example.com/x/y.jpg"></p>',
    )
    const media = []
    collectRemoteImages(b, media)
    expect(media.map((m) => m.remoteUrl)).toEqual([
      'https://cdn.example.com/a/chart.png',
      'http://old.example.com/b.gif',
      'https://cdn2.example.com/x/y.jpg',
    ])
    expect(media[0]).toEqual({
      ref: `remote-${md5Text('https://cdn.example.com/a/chart.png')}`,
      kind: 'image',
      name: 'chart.png',
      remoteUrl: 'https://cdn.example.com/a/chart.png',
    })
    expect(media[1].name).toBe('b.gif')
    const srcs = [...b.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs[0]).toBe(srcs[1])
    expect(srcs.map((s) => s.replace(/^import-ref:\/\//, ''))).toEqual([media[0].ref, media[0].ref, media[1].ref, media[2].ref])
  })

  it('a URL with no file segment has a null name', () => {
    const media = []
    collectRemoteImages(dom('<p><img src="https://img.example.com/"></p>'), media)
    expect(media[0]).toMatchObject({ name: null, remoteUrl: 'https://img.example.com/' })
  })

  it('resolves a root-relative clip image against the source URL', () => {
    const b = dom('<p><img src="/relative/x.jpg"></p>')
    const media = []
    collectRemoteImages(b, media, 'https://news.example.com/story/1')
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ remoteUrl: 'https://news.example.com/relative/x.jpg', name: 'x.jpg' })
  })

  it('marks a root-relative image with no source URL as unresolvable, never a UCT-relative src', () => {
    const b = dom('<p><img src="/relative/x.jpg"><img src="assets/y.png"></p>')
    const media = []
    collectRemoteImages(b, media)
    expect(media).toEqual([
      { ref: 'unresolvable-1', kind: 'image', name: '/relative/x.jpg', failed: { reason: 'unresolvable_src', sourceUrl: null } },
      { ref: 'unresolvable-2', kind: 'image', name: 'assets/y.png', failed: { reason: 'unresolvable_src', sourceUrl: null } },
    ])
    const srcs = [...b.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs).toEqual(['import-ref://unresolvable-1', 'import-ref://unresolvable-2'])
  })

  it('an unsafe, app or non-web src is unresolvable, never kept', () => {
    const b = dom('<p><img src="javascript:alert(1)"><img src="file:///c/x.png"><img src="/journal/x.png"><img src="ftp://h/x.png"></p>')
    const media = []
    collectRemoteImages(b, media, 'https://news.example.com/')
    expect(media.map((m) => m.failed && m.failed.reason)).toEqual(['unresolvable_src', 'unresolvable_src', 'unresolvable_src', 'unresolvable_src'])
    expect([...b.querySelectorAll('img')].every((i) => i.getAttribute('src').startsWith('import-ref://unresolvable-'))).toBe(true)
  })

  it('skips refs already ours and stored attachments', () => {
    const html = '<p><img src="import-ref://data-abc"><img src="/api/j2/notes/attachments/u/1.png"></p>'
    const b = dom(html)
    const media = []
    collectRemoteImages(b, media)
    expect(media).toEqual([])
    expect(b.innerHTML).toBe(html)
  })
})

describe('liftMediaOutOfLinks', () => {
  it('lifts an image out of a web link and leaves the link as its own line after it', () => {
    const b = dom('<div><a href="https://tv.com/x/abc/"><img src="import-ref://h"></a></div>')
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe('<div><img src="import-ref://h"><a href="https://tv.com/x/abc/">https://tv.com/x/abc/</a></div>')
  })

  it('keeps the link text when the link has text of its own, and keeps media order', () => {
    const b = dom('<p><a href="https://x.example/"><img src="import-ref://1"> chart <b><img src="import-ref://2"></b></a></p>')
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe('<p><img src="import-ref://1"><img src="import-ref://2"><a href="https://x.example/"> chart <b></b></a></p>')
  })

  it('lifts an attachment chip, and the chip moves whole', () => {
    const b = dom('<p><a href="https://x.example/f"><span data-type="attachmentChip" data-ref="r"><img src="import-ref://icon"></span></a></p>')
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe(
      '<p><span data-type="attachmentChip" data-ref="r"><img src="import-ref://icon"></span><a href="https://x.example/f">https://x.example/f</a></p>',
    )
  })

  it('lifts an adapter-shaped chip (itself an <a href="import-ref://…">) out of a web link; a chip is never a link to lift from', () => {
    // ENML `<a href><en-media/></a>` becomes this nesting in the live DOM (an HTML parse cannot nest anchors).
    const b = dom('<p></p>')
    const doc = b.ownerDocument
    const web = doc.createElement('a')
    web.setAttribute('href', 'https://x.example/f')
    const chip = doc.createElement('a')
    chip.setAttribute('data-type', 'attachmentChip')
    chip.setAttribute('href', 'import-ref://h')
    chip.innerHTML = '<img src="import-ref://icon">report.pdf'
    web.appendChild(chip)
    b.firstChild.appendChild(web)
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe(
      '<p><a data-type="attachmentChip" href="import-ref://h"><img src="import-ref://icon">report.pdf</a><a href="https://x.example/f">https://x.example/f</a></p>',
    )
  })

  it('lifts media out of an Evernote note link and drops the now-empty link', () => {
    const b = dom('<p><a href="evernote:///view/1/s1/abc/abc/" data-evernote-link="abc"><img src="import-ref://h"></a></p>')
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe('<p><img src="import-ref://h"></p>')
  })

  it('an Evernote note link with a title keeps its text and its anchor', () => {
    const b = dom('<p><a data-evernote-link="abc">Trade plan<img src="import-ref://h"></a></p>')
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe('<p><img src="import-ref://h"><a data-evernote-link="abc">Trade plan</a></p>')
  })

  it('leaves links without media, and media outside links, untouched (a second pass is a no-op)', () => {
    const html = '<p><a href="https://x.example/">x</a><img src="import-ref://h"></p>'
    const b = dom(html)
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe(html)
    liftMediaOutOfLinks(b)
    expect(b.innerHTML).toBe(html)
  })
})

describe('every adapter reads the one IMAGE_EXT (R8: Google Keep too)', () => {
  const vf = (path, text) => {
    const bytes = new TextEncoder().encode(text)
    return { path, size: bytes.length, lastModified: null, bytes: async () => bytes }
  }
  it('a Keep heif / avif / tiff / svg attachment is an image, never a chip', async () => {
    const { keepAdapter } = await import('./adapters/keep')
    const names = ['a.heif', 'b.avif', 'c.tiff', 'd.svg']
    const note = {
      title: 'n',
      textContent: 'x',
      userEditedTimestampUsec: 1700000000000000,
      attachments: names.map((n) => ({ filePath: n, mimetype: 'image/*' })),
    }
    const files = [vf('Takeout/Keep/n.json', JSON.stringify(note)), ...names.map((n) => vf(`Takeout/Keep/${n}`, 'img'))]
    const { docs } = await keepAdapter.parse(files)
    expect(docs).toHaveLength(1)
    expect(docs[0].media.map((m) => m.kind)).toEqual(['image', 'image', 'image', 'image'])
    expect(docs[0].html).not.toContain('attachmentChip')
  })
})
