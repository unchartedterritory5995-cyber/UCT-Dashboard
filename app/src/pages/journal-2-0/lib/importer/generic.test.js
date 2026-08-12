import { describe, it, expect, vi } from 'vitest'
import { genericAdapter, dataUriMimeToExt } from './adapters/generic'

const vf = (path, text) => ({
  path, size: text.length, lastModified: 1710000000000,
  bytes: async () => new TextEncoder().encode(text),
})

describe('generic adapter', () => {
  it('converts a markdown tree into docs with folderPath + importKey', async () => {
    const { docs } = await genericAdapter.parse([
      vf('Vault/Trading/vcp.md', '# VCP\n\n- [x] done\n- [ ] todo\n\n|a|b|\n|-|-|\n|1|2|'),
      vf('Vault/notes.txt', 'line one\n\nline two'),
    ])
    const vcp = docs.find((d) => d.importKey === 'file:Vault/Trading/vcp.md')
    expect(vcp.title).toBe('VCP')
    expect(vcp.folderPath).toEqual(['Vault', 'Trading'])
    // mdToHtml emits GFM checkbox <input>s; the DOWNSTREAM converter maps them
    // to taskItems (next test). Here just assert the checkbox survived markdown:
    expect(vcp.html).toContain('type="checkbox"')
    expect(vcp.html).toContain('<table>')
  })

  it('markdown checklists reach convert.htmlToNote as real taskItems (integration)', async () => {
    const { docs } = await genericAdapter.parse([vf('a.md', '- [x] done\n- [ ] todo')])
    const { htmlToNote } = await import('./convert')
    const { bodyJson } = htmlToNote(docs[0].html)
    expect(bodyJson.content[0].type).toBe('taskList')
    expect(bodyJson.content[0].content[0].attrs.checked).toBe(true)
  })

  it('resolves relative image refs to media placeholders', async () => {
    const png = { path: 'Vault/img/a.png', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await genericAdapter.parse([vf('Vault/note.md', '![alt](img/a.png)'), png])
    const doc = docs.find((d) => d.importKey === 'file:Vault/note.md')
    expect(doc.html).toContain('import-ref://Vault/img/a.png')
    expect(doc.media[0]).toMatchObject({ ref: 'Vault/img/a.png', kind: 'image' })
  })

  it('flags the Apple Notes FallbackImage.png bulk-export bug', async () => {
    const { docs, warnings } = await genericAdapter.parse([
      vf('n1.md', '![](FallbackImage.png)'), vf('n2.md', '![](FallbackImage.png)'),
      { path: 'FallbackImage.png', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) },
    ])
    expect(warnings.join(' ')).toMatch(/FallbackImage/)
    expect(docs.every((d) => d.media.length === 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Supplementary coverage beyond the brief's Step-1 test text — the brief's
// "Generic behaviors" prose describes .html passthrough, .docx (via mammoth),
// TextBundle folding, per-doc media dedup, and date propagation, none of
// which the four tests above exercise directly.
// ---------------------------------------------------------------------------

describe('generic adapter — title/date fallbacks', () => {
  it('falls back to the filename (sans extension) when there is no <h1>', async () => {
    const { docs } = await genericAdapter.parse([vf('Vault/no-heading.md', 'just a paragraph')])
    expect(docs[0].title).toBe('no-heading')
  })

  it('propagates lastModified to both createdAt and updatedAt as ISO strings', async () => {
    const { docs } = await genericAdapter.parse([vf('a.md', 'hi')])
    expect(docs[0].createdAt).toBe(new Date(1710000000000).toISOString())
    expect(docs[0].updatedAt).toBe(docs[0].createdAt)
  })

  it('omits dates entirely when lastModified is null', async () => {
    const { docs } = await genericAdapter.parse([
      { path: 'a.md', size: 2, lastModified: null, bytes: async () => new TextEncoder().encode('hi') },
    ])
    expect(docs[0].createdAt).toBeUndefined()
    expect(docs[0].updatedAt).toBeUndefined()
  })
})

describe('generic adapter — .txt', () => {
  it('escapes HTML and splits on blank lines into paragraphs', async () => {
    const { docs } = await genericAdapter.parse([vf('journal/entry.txt', '<b>bold</b> text\n\nsecond para')])
    const doc = docs[0]
    expect(doc.html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(doc.html.match(/<p>/g)).toHaveLength(2)
  })
})

describe('generic adapter — .html', () => {
  it('keeps the body as-is and resolves a relative image inside it', async () => {
    const png = { path: 'site/img/hero.png', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const html = '<html><head><title>ignored</title></head><body><h1>Hero Post</h1>' +
      '<img src="img/hero.png"></body></html>'
    const { docs } = await genericAdapter.parse([vf('site/page.html', html), png])
    const doc = docs[0]
    expect(doc.title).toBe('Hero Post')
    expect(doc.html).toContain('import-ref://site/img/hero.png')
    expect(doc.html).not.toContain('<title>')
    expect(doc.media).toEqual([{ ref: 'site/img/hero.png', vfile: png, kind: 'image', name: 'hero.png' }])
  })
})

describe('generic adapter — non-image attachments', () => {
  it('turns a relative link to a local non-image file into an attachment chip', async () => {
    const pdf = { path: 'Vault/report.pdf', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await genericAdapter.parse([vf('Vault/note.md', '[report](report.pdf)'), pdf])
    const doc = docs[0]
    expect(doc.html).toContain('data-type="attachmentChip"')
    expect(doc.html).toContain('data-import-ref="Vault/report.pdf"')
    // AttachmentChip.parseHTML (Task 5, lib/attachmentChip.js) reads `href` /
    // `data-name` / `data-size` — NOT `data-import-ref` — so the placeholder
    // must also land in href or it never reaches bodyJson at all.
    expect(doc.html).toContain('href="import-ref://Vault/report.pdf"')
    expect(doc.media[0]).toMatchObject({ ref: 'Vault/report.pdf', kind: 'file', name: 'report.pdf' })
  })

  it('reaches convert.htmlToNote as a real attachmentChip node with a resolvable href (pipeline)', async () => {
    const pdf = { path: 'Vault/report.pdf', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await genericAdapter.parse([vf('Vault/note.md', '[report](report.pdf)'), pdf])
    const { htmlToNote } = await import('./convert')
    const { bodyJson } = htmlToNote(docs[0].html)
    const chip = findNode(bodyJson, (n) => n.type === 'attachmentChip')
    expect(chip).toBeTruthy()
    expect(chip.attrs.href).toBe('import-ref://Vault/report.pdf')
    expect(chip.attrs.name).toBe('report.pdf')
  })

  it('leaves a relative link to another importable doc (.md) as an inert anchor, not an attachment chip', async () => {
    const other = vf('Vault/other.md', '# Other')
    const { docs } = await genericAdapter.parse([vf('Vault/note.md', '[see also](other.md)'), other])
    const doc = docs.find((d) => d.importKey === 'file:Vault/note.md')
    expect(doc.html).not.toContain('data-type="attachmentChip"')
    expect(doc.media).toHaveLength(0)
  })
})

function findNode(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (pred(node)) return node
  for (const child of node.content || []) {
    const found = findNode(child, pred)
    if (found) return found
  }
  return null
}

describe('generic adapter — media dedup', () => {
  it('references the same image twice in one doc but only lists it once', async () => {
    const png = { path: 'Vault/a.png', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await genericAdapter.parse([
      vf('Vault/note.md', '![one](a.png)\n\n![two](a.png)'),
      png,
    ])
    expect(docs[0].media).toHaveLength(1)
  })
})

describe('generic adapter — TextBundle', () => {
  it('folds a .textbundle dir into one doc named after the bundle, with assets resolved', async () => {
    const asset = {
      path: 'Vault/Idea.textbundle/assets/pic.png',
      size: 1, lastModified: null, bytes: async () => new Uint8Array([1]),
    }
    const textVf = vf('Vault/Idea.textbundle/text.md', 'Body text\n\n![](assets/pic.png)')
    const { docs } = await genericAdapter.parse([textVf, asset])
    expect(docs).toHaveLength(1)
    const doc = docs[0]
    expect(doc.importKey).toBe('file:Vault/Idea.textbundle')
    expect(doc.title).toBe('Idea')
    expect(doc.folderPath).toEqual(['Vault'])
    expect(doc.html).toContain('import-ref://Vault/Idea.textbundle/assets/pic.png')
    expect(doc.media[0]).toMatchObject({ ref: 'Vault/Idea.textbundle/assets/pic.png', kind: 'image' })
  })
})

describe('generic adapter — .docx', () => {
  it('converts via mammoth and lifts a base64 embedded image into a media entry named with its real extension', async () => {
    vi.doMock('mammoth', () => ({
      convertToHtml: vi.fn(async () => ({
        value: '<h1>From Word</h1><p>hello</p>' +
          '<img src="data:image/png;base64,AAAA">',
        messages: [],
      })),
    }))
    const docxVf = { path: 'Vault/report.docx', size: 4, lastModified: null, bytes: async () => new Uint8Array([1, 2, 3, 4]) }
    const { docs } = await genericAdapter.parse([docxVf])
    const doc = docs[0]
    expect(doc.title).toBe('From Word')
    // vfile path, media ref/name, and the import-ref:// URL must all agree
    expect(doc.html).toContain('import-ref://docx-img-1.png')
    expect(doc.html).not.toContain('data:image')
    expect(doc.media[0]).toMatchObject({ ref: 'docx-img-1.png', name: 'docx-img-1.png', kind: 'image' })
    expect(doc.media[0].vfile.path).toBe('docx-img-1.png')
    vi.doUnmock('mammoth')
  })

  it('keeps the bare synthetic name when the data-URI MIME is not a recognized image type', async () => {
    vi.doMock('mammoth', () => ({
      convertToHtml: vi.fn(async () => ({
        value: '<img src="data:application/octet-stream;base64,AAAA">',
        messages: [],
      })),
    }))
    const docxVf = { path: 'Vault/weird.docx', size: 4, lastModified: null, bytes: async () => new Uint8Array([1, 2, 3, 4]) }
    const { docs } = await genericAdapter.parse([docxVf])
    expect(docs[0].html).toContain('import-ref://docx-img-1"')
    expect(docs[0].media[0]).toMatchObject({ ref: 'docx-img-1', name: 'docx-img-1' })
    vi.doUnmock('mammoth')
  })
})

describe('dataUriMimeToExt', () => {
  it('maps known image MIME types to extensions', () => {
    expect(dataUriMimeToExt('image/png')).toBe('png')
    expect(dataUriMimeToExt('image/jpeg')).toBe('jpg')
    expect(dataUriMimeToExt('image/gif')).toBe('gif')
    expect(dataUriMimeToExt('image/webp')).toBe('webp')
    expect(dataUriMimeToExt('IMAGE/PNG')).toBe('png') // case-insensitive
  })

  it('returns null for an unknown or missing MIME type', () => {
    expect(dataUriMimeToExt('application/octet-stream')).toBeNull()
    expect(dataUriMimeToExt('')).toBeNull()
    expect(dataUriMimeToExt(undefined)).toBeNull()
  })
})
