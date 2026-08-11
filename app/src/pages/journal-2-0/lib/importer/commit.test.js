import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rewriteBody, runImport } from './commit'

const img = (src) => ({ type: 'image', attrs: { src } })
const doc = (content) => ({ type: 'doc', content })

describe('rewriteBody', () => {
  it('swaps media refs, resolves links, drops failed media by name', () => {
    const body = doc([
      img('import-ref://v/a.png'),
      { type: 'paragraph', content: [{ type: 'text', text: 'go',
        marks: [{ type: 'link', attrs: { href: 'import-link://obsidian:v/b.md' } }] }] },
      img('import-ref://v/missing.png'),
    ])
    const { body: out, droppedMedia } = rewriteBody(body, {
      mediaUrls: { 'v/a.png': '/api/j2/notes/attachments/u/n/inline/x.png' },
      idByKey: { 'obsidian:v/b.md': 'note42' },
    })
    expect(out.content[0].attrs.src).toBe('/api/j2/notes/attachments/u/n/inline/x.png')
    expect(out.content[1].content[0].marks[0].attrs.href)
      .toBe('/journal?j2tab=notebook&note=note42')
    expect(out.content.filter((n) => n.type === 'image')).toHaveLength(1)
    expect(droppedMedia).toEqual(['v/missing.png'])
  })

  it('removes link marks whose target did not import, keeping the text', () => {
    const body = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'ghost',
      marks: [{ type: 'link', attrs: { href: 'import-link://obsidian:gone.md' } }] }] }])
    const { body: out } = rewriteBody(body, { mediaUrls: {}, idByKey: {} })
    expect(out.content[0].content[0].marks ?? []).toHaveLength(0)
    expect(out.content[0].content[0].text).toBe('ghost')
  })
})

describe('runImport', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('confirms, uploads media, rewrites bodies, and reports the summary', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/images')) return new Response(JSON.stringify({ url: '/img/1.png' }))
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([img('import-ref://a.png')]), bodyPlain: 'x',
               media: [{ ref: 'a.png', kind: 'image', name: 'a.png',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'a.png' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(calls.map((c) => c.url)).toEqual([
      '/api/j2/notes/import/confirm', '/api/j2/notes/n1/images', '/api/j2/notes/n1',
    ])
    expect(summary.created).toBe(1)
    expect(summary.failures).toEqual([])
  })
})
