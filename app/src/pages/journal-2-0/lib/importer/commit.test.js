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

  it('records a failure and continues the run when the final PUT returns a 5xx', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/images')) return new Response(JSON.stringify({ url: '/img/1.png' }))
      if (opts?.method === 'PUT') return new Response(JSON.stringify({ detail: 'boom' }), { status: 500 })
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
    // The whole run resolves (does not reject) with a summary.
    expect(summary.created).toBe(1)
    expect(summary.failures).toEqual([{ name: 'A', reason: expect.stringContaining('500') }])
    expect(calls.some((c) => c.url === '/api/j2/notes/n1' && c.method === 'PUT')).toBe(true)
  })

  it('records a failure and still commits a later note when the final PUT throws a network error', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [
            { importKey: 'file:a.md', id: 'n1' },
            { importKey: 'file:b.md', id: 'n2' },
          ], updated: [], skipped: [] }))
      }
      if (url.includes('/images')) return new Response(JSON.stringify({ url: '/img/1.png' }))
      if (url === '/api/j2/notes/n1' && opts?.method === 'PUT') throw new TypeError('network down')
      return new Response(JSON.stringify({ ok: true }))
    }))
    const mkDoc = (key, ref) => ({
      importKey: key, title: key, tags: [], folderPath: [],
      bodyJson: doc([img(`import-ref://${ref}.png`)]), bodyPlain: 'x',
      media: [{ ref: `${ref}.png`, kind: 'image', name: `${ref}.png`,
                vfile: { bytes: async () => new Uint8Array([1]), path: `${ref}.png` } }],
      links: [],
    })
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [mkDoc('file:a.md', 'a'), mkDoc('file:b.md', 'b')],
      onProgress: () => {},
    })
    expect(summary.created).toBe(2)
    expect(summary.failures).toEqual([{ name: 'file:a.md', reason: expect.stringContaining('network down') }])
    // the SECOND note's full media + PUT sequence still ran despite the first note's PUT throwing
    expect(calls.some((c) => c.url === '/api/j2/notes/n2/images')).toBe(true)
    expect(calls.some((c) => c.url === '/api/j2/notes/n2' && c.method === 'PUT')).toBe(true)
  })

  it('stops the run on a confirm batch failure but keeps processing the earlier successful batch', async () => {
    const calls = []
    const docs = []
    for (let i = 0; i < 201; i++) {
      const key = `file:${i}.md`
      if (i === 0) {
        docs.push({
          importKey: key, title: 'First', tags: [], folderPath: [],
          bodyJson: doc([img('import-ref://first.png')]), bodyPlain: 'x',
          media: [{ ref: 'first.png', kind: 'image', name: 'first.png',
                    vfile: { bytes: async () => new Uint8Array([1]), path: 'first.png' } }],
          links: [],
        })
      } else {
        docs.push({ importKey: key, title: key, tags: [], folderPath: [],
                    bodyJson: doc([]), bodyPlain: '', media: [], links: [] })
      }
    }
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        const payload = JSON.parse(opts.body)
        if (payload.notes.length === 200) {
          return new Response(JSON.stringify({
            created: payload.notes.map((n, idx) => ({ importKey: n.importKey, id: `n${idx}` })),
            updated: [], skipped: [],
          }))
        }
        // the second (1-note) batch fails
        return new Response(JSON.stringify({ detail: 'db down' }), { status: 500 })
      }
      if (url.includes('/images')) return new Response(JSON.stringify({ url: '/img/1.png' }))
      return new Response(JSON.stringify({ ok: true }))
    }))

    const summary = await runImport({ source: 'file', destFolderId: null, docs, onProgress: () => {} })

    expect(summary.created).toBe(200)
    expect(summary.failedBatch).toEqual({
      index: 1,
      notes: 1,
      reason: 'HTTP 500',
      message: expect.stringContaining('Batch 2 failed'),
    })
    expect(summary.failedBatch.message).toMatch(/resumes where it stopped/)
    // the first, successfully-confirmed batch's note with media still got its media/link phase
    expect(calls.some((c) => c.url === '/api/j2/notes/n0/images')).toBe(true)
    expect(calls.some((c) => c.url === '/api/j2/notes/n0' && c.method === 'PUT')).toBe(true)
  })

  it('makes exactly one fetch call for a note the server reports as skipped', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [], updated: [], skipped: [{ importKey: 'file:a.md', id: 'n1' }] }))
      }
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
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/j2/notes/import/confirm')
    expect(summary.skipped).toBe(1)
    expect(summary.created).toBe(0)
  })

  it('retries a persistently-failing media upload 3 times, records the failure, and still PUTs the note', async () => {
    const calls = []
    let imageAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/images')) {
        imageAttempts += 1
        return new Response(JSON.stringify({ detail: 'boom' }), { status: 500 })
      }
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
    expect(imageAttempts).toBe(3)
    expect(summary.failures).toEqual([{ name: 'a.png', reason: expect.stringContaining('500') }])
    expect(calls.filter((c) => c.url === '/api/j2/notes/n1' && c.method === 'PUT')).toHaveLength(1)
  })
})
