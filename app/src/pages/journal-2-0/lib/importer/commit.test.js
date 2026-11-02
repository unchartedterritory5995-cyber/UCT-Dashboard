import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rewriteBody, runImport } from './commit'
import { importNoticeText, MEDIA_RETRY_MAX_ATTEMPTS } from '../importNoticeText'

const img = (src) => ({ type: 'image', attrs: { src } })
const doc = (content) => ({ type: 'doc', content })
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const chip = (href, name) => ({ type: 'attachmentChip', attrs: { href, name } })

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
    // Task 4: the unresolved image is never dropped in silence: a notice holds its place.
    expect(out.content[2].type).toBe('importNotice')
    expect(droppedMedia).toEqual(['v/missing.png'])
  })

  it('keeps an unresolved link mark as an import-link placeholder for the heal pass', () => {
    const mark = { type: 'link', attrs: { href: 'import-link://obsidian:gone.md' } }
    const body = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'ghost', marks: [mark] }] }])
    const { body: out, keptLinks } = rewriteBody(body, { mediaUrls: {}, idByKey: {} })
    expect(out.content[0].content[0].marks).toEqual([mark])
    expect(out.content[0].content[0].text).toBe('ghost')
    expect(keptLinks).toEqual([{ key: 'obsidian:gone.md', text: 'ghost' }])
  })

  it('keeps an Evernote title placeholder raw, and still resolves a sibling that did import', () => {
    const body = doc([{ type: 'paragraph', content: [
      { type: 'text', text: 'Trade plan', marks: [{ type: 'link', attrs: { href: 'import-link://evernote-title:Trade plan' } }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href: 'import-link://obsidian:b.md' } }] },
    ] }])
    const { body: out, keptLinks } = rewriteBody(body, { idByKey: { 'obsidian:b.md': 'n9' } })
    expect(out.content[0].content[0].marks[0].attrs.href).toBe('import-link://evernote-title:Trade plan')
    expect(out.content[0].content[2].marks[0].attrs.href).toBe('/journal?j2tab=notebook&note=n9')
    expect(keptLinks).toEqual([{ key: 'evernote-title:Trade plan', text: 'Trade plan' }])
  })

  it('replaces a failed image with an importNotice in the same position', () => {
    const body = doc([para('a'), img('import-ref://r1'), para('b')])
    const { body: out, notices, droppedMedia } = rewriteBody(body, { mediaResults: {
      r1: { ok: false, reason: 'fetch_failed', name: 'c.png', sourceUrl: 'https://cdn.com/c.png' } } })
    expect(out.content.map((n) => n.type)).toEqual(['paragraph', 'importNotice', 'paragraph'])
    // R3: a file-import notice is FINAL, so `fetch_failed` never reads "retrying on the next sync".
    expect(out.content[1].attrs).toEqual({ reason: 'fetch_failed', name: 'c.png',
      sourceUrl: 'https://cdn.com/c.png', ref: 'r1', attempts: MEDIA_RETRY_MAX_ATTEMPTS })
    expect(importNoticeText(out.content[1].attrs)).toBe("Couldn't copy c.png")
    expect(droppedMedia).toEqual(['r1'])
    expect(notices).toEqual([{ ref: 'r1', reason: 'fetch_failed', name: 'c.png', sourceUrl: 'https://cdn.com/c.png' }])
  })

  it('a placeholder with no result at all becomes a missing_resource notice, never vanishes', () => {
    const body = doc([img('import-ref://gone.png'), chip('import-ref://f.pdf', 'f.pdf')])
    const { body: out, droppedMedia, notices } = rewriteBody(body, {})
    expect(out.content.map((n) => n.type)).toEqual(['importNotice', 'importNotice'])
    expect(out.content[0].attrs.reason).toBe('missing_resource')
    // a nameless failure keeps name null: the copy table's fallback reads it, never an empty string
    expect(out.content[0].attrs.name).toBeNull()
    expect(importNoticeText(out.content[0].attrs)).toBe("This item couldn't be found, so it wasn't copied")
    expect(out.content[1].attrs.name).toBe('f.pdf')
    expect(droppedMedia).toEqual(['gone.png', 'f.pdf'])
    expect(notices).toHaveLength(2)
  })

  it('a door storage refusal is written as the final storage_full, never the "will be copied" promise', () => {
    const body = doc([img('import-ref://big.png')])
    const { body: out } = rewriteBody(body, { mediaResults: { 'big.png': { ok: false, reason: 'storage_limit', name: 'big.png' } } })
    expect(out.content[0].attrs.reason).toBe('storage_full')
    expect(importNoticeText(out.content[0].attrs)).toMatch(/import again/)
  })

  it('a failure name that is blank or not a string is written as null, and a non-http sourceUrl is dropped', () => {
    const body = doc([img('import-ref://x')])
    const { body: out } = rewriteBody(body, { mediaResults: { x: { ok: false, reason: 'decode_failed', name: '  ', sourceUrl: 'javascript:alert(1)' } } })
    expect(out.content[0].attrs.name).toBeNull()
    expect(out.content[0].attrs.sourceUrl).toBeNull()
  })

  it('an image the server stored as a file becomes an attachment chip', () => {
    const body = doc([img('import-ref://logo.svg')])
    const { body: out, droppedMedia } = rewriteBody(body, { mediaResults: {
      'logo.svg': { ok: true, src: '/api/j2/notes/attachments/u/n/f/logo.svg', kind: 'file', name: 'logo.svg' } } })
    expect(out.content).toEqual([{ type: 'attachmentChip',
      attrs: { href: '/api/j2/notes/attachments/u/n/f/logo.svg', name: 'logo.svg' } }])
    expect(droppedMedia).toEqual([])
  })

  it('an image the server stored as an image keeps its own attrs with the new src', () => {
    const body = doc([{ type: 'image', attrs: { src: 'import-ref://a.png', alt: 'chart' } }])
    const { body: out } = rewriteBody(body, { mediaResults: { 'a.png': { ok: true, src: '/i/a.png', kind: 'image', name: 'a.png' } } })
    expect(out.content).toEqual([{ type: 'image', attrs: { src: '/i/a.png', alt: 'chart' } }])
  })

  it('a kept original rides as a chip right after its converted image', () => {
    const body = doc([para('x'), img('import-ref://p.heic'), para('y')])
    const { body: out } = rewriteBody(body, { mediaResults: { 'p.heic': { ok: true, src: '/i/p.jpg', kind: 'image', name: 'p.jpg',
      original: { src: '/f/p.heic', name: 'p.heic' } } } })
    expect(out.content.map((n) => n.type)).toEqual(['paragraph', 'image', 'attachmentChip', 'paragraph'])
    expect(out.content[1].attrs.src).toBe('/i/p.jpg')
    expect(out.content[2].attrs).toEqual({ href: '/f/p.heic', name: 'p.heic' })
  })

  it('a null original adds no chip (the server sends null, not a missing key)', () => {
    const body = doc([img('import-ref://a.png')])
    const { body: out } = rewriteBody(body, { mediaResults: { 'a.png': { ok: true, src: '/i/a.png', kind: 'image', name: 'a.png', original: null } } })
    expect(out.content.map((n) => n.type)).toEqual(['image'])
  })

  it('an attachment chip swaps its href and takes the stored name', () => {
    const body = doc([chip('import-ref://r.pdf', 'r.pdf')])
    const { body: out } = rewriteBody(body, { mediaResults: { 'r.pdf': { ok: true, src: '/f/r.pdf', kind: 'file', name: 'report.pdf' } } })
    expect(out.content[0]).toEqual({ type: 'attachmentChip', attrs: { href: '/f/r.pdf', name: 'report.pdf' } })
  })

  it('replaces a failed image inside a table cell and a list item', () => {
    const cell = { type: 'tableCell', content: [img('import-ref://t.png')] }
    const body = doc([
      { type: 'table', content: [{ type: 'tableRow', content: [cell] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('i'), img('import-ref://l.png')] }] },
    ])
    const input = JSON.parse(JSON.stringify(body))
    const { body: out, droppedMedia } = rewriteBody(body, { mediaResults: {
      't.png': { ok: false, reason: 'too_large', name: 't.png' }, 'l.png': { ok: false, reason: 'upload_failed', name: 'l.png' } } })
    expect(out.content[0].content[0].content[0].content[0]).toMatchObject({ type: 'importNotice', attrs: { reason: 'too_large', ref: 't.png' } })
    expect(out.content[1].content[0].content.map((n) => n.type)).toEqual(['paragraph', 'importNotice'])
    expect(droppedMedia).toEqual(['t.png', 'l.png'])
    expect(body).toEqual(input) // never mutates its input
  })

  it('still accepts the legacy mediaUrls map', () => {
    const body = doc([img('import-ref://a.png'), chip('import-ref://b.pdf', 'b.pdf')])
    const { body: out, notices } = rewriteBody(body, { mediaUrls: { 'a.png': '/i/a.png', 'b.pdf': '/f/b.pdf' } })
    expect(out.content.map((n) => n.type)).toEqual(['image', 'attachmentChip'])
    expect(out.content[0].attrs.src).toBe('/i/a.png')
    expect(out.content[1].attrs.href).toBe('/f/b.pdf')
    expect(notices).toEqual([])
  })

  // ⛔⛔ 2026-09-02 adversarial audit: every test above walks a 1-3 node
  // toy tree. `rewriteBody` deep-walks tables/lists/nested blocks on a REAL
  // note, and nothing here ever exercised that at the scale/shape a real
  // conversion produces -- a long meeting-log body (nested bulletList/
  // listItem + taskList/taskItem, hundreds of items each) with a batch of
  // inline images scattered through it, roughly half resolvable and half
  // not (interleaved, so an off-by-one in the walk shows up as a wrong
  // NAME, not just a wrong count).
  it('correctly rewrites/drops refs across a realistically large, deeply-nested tree (hundreds of bullets/checkboxes + many inline images)', () => {
    const N = 500
    const bulletItems = Array.from({ length: N }, (_, i) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `Discussed item ${i} with the team` }] }],
    }))
    const taskItems = Array.from({ length: N }, (_, i) => ({
      type: 'taskItem',
      attrs: { checked: i % 2 === 0 },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `Follow up on action item ${i}` }] }],
    }))
    const N_IMAGES = 40
    const imageNodes = Array.from({ length: N_IMAGES }, (_, i) => img(`import-ref://shot-${i}.png`))
    const mediaUrls = {}
    for (let i = 0; i < N_IMAGES; i += 2) {
      mediaUrls[`shot-${i}.png`] = `/api/j2/notes/attachments/u/n/inline/shot-${i}.png`
    }

    const body = doc([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Daily Notes' }] },
      { type: 'bulletList', content: bulletItems },
      { type: 'taskList', content: taskItems },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Screenshots' }] },
      ...imageNodes,
    ])

    const { body: out, droppedMedia } = rewriteBody(body, { mediaUrls, idByKey: {} })

    // the whole bullet/checkbox log survives the walk, in order, untouched
    expect(out.content[1].content).toHaveLength(N)
    expect(out.content[1].content[N - 1].content[0].content[0].text).toBe(`Discussed item ${N - 1} with the team`)
    expect(out.content[2].content).toHaveLength(N)
    expect(out.content[2].content[7].attrs.checked).toBe(taskItems[7].attrs.checked)

    // exactly the resolvable images were rewritten to their real URL, the
    // rest dropped -- checked by NAME (order-sensitive), not just a count,
    // so a walk that resolves the wrong half still fails this.
    // Task 4: an unresolved image is now an importNotice IN ITS PLACE, so the images
    // are read out of the tail by type, and the notices are checked by ref, in order.
    const tail = out.content.slice(4)
    expect(tail).toHaveLength(N_IMAGES)
    const survivingImages = tail.filter((n) => n.type === 'image')
    expect(survivingImages).toHaveLength(N_IMAGES / 2)
    expect(tail.filter((n) => n.type === 'importNotice').map((n) => n.attrs.ref)).toEqual(
      Array.from({ length: N_IMAGES / 2 }, (_, k) => `shot-${k * 2 + 1}.png`))
    expect(survivingImages.map((n) => n.attrs.src)).toEqual(
      Array.from({ length: N_IMAGES / 2 }, (_, k) => `/api/j2/notes/attachments/u/n/inline/shot-${k * 2}.png`))
    expect(droppedMedia).toEqual(
      Array.from({ length: N_IMAGES / 2 }, (_, k) => `shot-${k * 2 + 1}.png`))
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

  it('reports importMediaPending on the final PUT: true when a media upload failed, false when it fully resolved (audit B5)', async () => {
    // audit B5: a note whose media upload failed must not silently look
    // "done" to the server -- runImport must tell import_confirm's
    // media-pending gate the truth about whether THIS note's media/link
    // phase actually finished clean, so a re-import can retry it instead
    // of matching its fingerprint and skipping forever.
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [
            { importKey: 'file:ok.md', id: 'n1' },
            { importKey: 'file:bad.md', id: 'n2' },
          ], updated: [], skipped: [] }))
      }
      if (url === '/api/j2/notes/n1/images') return new Response(JSON.stringify({ url: '/img/ok.png' }))
      if (url === '/api/j2/notes/n2/images') return new Response('fail', { status: 500 })
      return new Response(JSON.stringify({ ok: true }))
    }))
    const mkDoc = (key, ref) => ({
      importKey: key, title: key, tags: [], folderPath: [],
      bodyJson: doc([img(`import-ref://${ref}.png`)]), bodyPlain: 'x',
      media: [{ ref: `${ref}.png`, kind: 'image', name: `${ref}.png`,
                vfile: { bytes: async () => new Uint8Array([1]), path: `${ref}.png` } }],
      links: [],
    })
    await runImport({
      source: 'file', destFolderId: null,
      docs: [mkDoc('file:ok.md', 'ok'), mkDoc('file:bad.md', 'bad')],
      onProgress: () => {},
    })
    // Asserted OUTSIDE the mock's response-building callback -- reading
    // fetch.mock.calls here, not inside a json()/Response body, is the
    // point: a wire that silently dropped this field would still pass if
    // checked only from inside the mock.
    const putCalls = vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === 'PUT')
    const okPut = putCalls.find((c) => c[0] === '/api/j2/notes/n1')
    const badPut = putCalls.find((c) => c[0] === '/api/j2/notes/n2')
    expect(JSON.parse(okPut[1].body).importMediaPending).toBe(false)
    expect(JSON.parse(badPut[1].body).importMediaPending).toBe(true)
    // Task 4: the failed upload is an upload_failed notice IN PLACE in the PUT body, not a gap.
    expect(JSON.parse(badPut[1].body).bodyJson.content).toEqual([{ type: 'importNotice',
      attrs: { reason: 'upload_failed', name: 'bad.png', sourceUrl: null, ref: 'bad.png', attempts: MEDIA_RETRY_MAX_ATTEMPTS } }])
  })

  it('continues past a failed confirm batch instead of stopping the run (session-audit.md A2)', async () => {
    // Three batches (200 + 200 + 1): the FIRST batch succeeds, the SECOND
    // fails at the HTTP level, and the THIRD -- past the failure -- must
    // still get its own confirm attempt. Before the fix, `commit.js:285`'s
    // `break` meant a failed batch permanently blocked every batch after
    // it, index-ordered, on every re-run: a 5,000-note import with one bad
    // note at index 250 could never import notes 201-5,000.
    const calls = []
    const docs = []
    for (let i = 0; i < 401; i++) {
      const key = `file:${i}.md`
      if (i === 0) {
        docs.push({
          importKey: key, title: 'First', tags: [], folderPath: [],
          bodyJson: doc([img('import-ref://first.png')]), bodyPlain: 'x',
          media: [{ ref: 'first.png', kind: 'image', name: 'first.png',
                    vfile: { bytes: async () => new Uint8Array([1]), path: 'first.png' } }],
          links: [],
        })
      } else if (i === 400) {
        docs.push({
          importKey: key, title: 'Last', tags: [], folderPath: [],
          bodyJson: doc([img('import-ref://last.png')]), bodyPlain: 'x',
          media: [{ ref: 'last.png', kind: 'image', name: 'last.png',
                    vfile: { bytes: async () => new Uint8Array([1]), path: 'last.png' } }],
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
        if (payload.notes[0].importKey === 'file:0.md') {
          return new Response(JSON.stringify({
            created: payload.notes.map((n, idx) => ({ importKey: n.importKey, id: `n${idx}` })),
            updated: [], skipped: [],
          }))
        }
        if (payload.notes[0].importKey === 'file:200.md') {
          // the SECOND batch fails at the HTTP level
          return new Response(JSON.stringify({ detail: 'db down' }), { status: 500 })
        }
        // the THIRD batch, past the failed one -- must still be attempted
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:400.md', id: 'nlast' }], updated: [], skipped: [],
        }))
      }
      if (url.includes('/images')) return new Response(JSON.stringify({ url: '/img/1.png' }))
      return new Response(JSON.stringify({ ok: true }))
    }))

    const summary = await runImport({ source: 'file', destFolderId: null, docs, onProgress: () => {} })

    // Batch 1's 200 + batch 3's 1 -- only the failed middle batch's own
    // notes are missing, never anything past it.
    expect(summary.created).toBe(201)
    expect(summary.failedBatches).toEqual([{
      index: 1,
      notes: 200,
      // the server's {detail: "db down"} body must surface, not just the
      // bare status code
      reason: 'HTTP 500: db down',
      message: expect.stringContaining('Batch 2 failed'),
    }])
    expect(summary.failedBatches[0].message).toMatch(/continued with the remaining batches/)
    expect(summary.failedBatches[0].message).not.toMatch(/resumes where it stopped/)
    // the first, successfully-confirmed batch's note with media still got its media/link phase
    expect(calls.some((c) => c.url === '/api/j2/notes/n0/images')).toBe(true)
    expect(calls.some((c) => c.url === '/api/j2/notes/n0' && c.method === 'PUT')).toBe(true)
    // the fix, proven directly: all THREE batches got a confirm attempt,
    // including the one after the failure.
    expect(calls.filter((c) => c.url === '/api/j2/notes/import/confirm')).toHaveLength(3)
    expect(calls.some((c) => c.url === '/api/j2/notes/nlast' && c.method === 'PUT')).toBe(true)
  })

  it('reports a per-note storage failure from an otherwise-successful batch without discarding its siblings (session-audit.md A1)', async () => {
    // The server now isolates ONE oversized/malformed note into a `failed`
    // bucket instead of failing the whole confirm call -- this must show
    // up as a named failure, not silently vanish, and must not be counted
    // as created/updated/skipped.
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:ok.md', id: 'n1' }],
          updated: [], skipped: [],
          failed: [{ importKey: 'file:huge.md', error: 'body_json too large (>1MB)' }],
        }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [
        { importKey: 'file:ok.md', title: 'OK Note', tags: [], folderPath: [],
          bodyJson: doc([]), bodyPlain: '', media: [], links: [] },
        { importKey: 'file:huge.md', title: 'Huge Note', tags: [], folderPath: [],
          bodyJson: doc([]), bodyPlain: '', media: [], links: [] },
      ],
      onProgress: () => {},
    })
    expect(summary.created).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(summary.failedBatches).toEqual([])
    expect(summary.failures).toEqual([
      { name: 'Huge Note', reason: 'body_json too large (>1MB)' },
    ])
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

  it('names the reason the server gave when a file is refused for its size (413), not a bare status', async () => {
    // The upload doors cap the body while it is read and answer 413 with a
    // sentence a member can act on. "Upload failed (HTTP 413)" told them nothing.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/attachments')) {
        return new Response(JSON.stringify({ detail: 'File must be < 25 MB' }), { status: 413 })
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([img('import-ref://big.pdf')]), bodyPlain: 'x',
               media: [{ ref: 'big.pdf', kind: 'file', name: 'big.pdf',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'big.pdf' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(summary.failures).toEqual([{ name: 'big.pdf', reason: 'File must be < 25 MB' }])
  })

  // ── the confirm step is sent as several requests, bounded by bytes and by count ──

  // A stand-in for the confirm door with the two properties the real one has:
  // a request over `capBytes` is refused whole (413), and a note is matched by
  // its importKey, so sending it again never creates a second one.
  function fakeConfirmServer({ capBytes, failRequest = null, tooLongKeys = [] }) {
    const stored = new Map()
    const requests = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (!String(url).endsWith('/import/confirm')) return new Response(JSON.stringify({ ok: true }))
      const bytes = new TextEncoder().encode(opts.body).length
      const notes = JSON.parse(opts.body).notes
      requests.push({ bytes, keys: notes.map((n) => n.importKey) })
      if (bytes > capBytes) {
        return new Response(JSON.stringify({
          detail: 'That batch of notes is too large for one request. Send the notes in smaller batches.',
        }), { status: 413 })
      }
      if (failRequest === requests.length) {
        return new Response(JSON.stringify({ detail: 'the database is busy' }), { status: 503 })
      }
      const out = { created: [], updated: [], skipped: [], failed: [] }
      for (const n of notes) {
        if (tooLongKeys.includes(n.importKey)) {
          out.failed.push({
            importKey: n.importKey,
            error: 'This note is too long to save as one page. Split it into two or more notes and try again.',
          })
        } else if (stored.has(n.importKey)) {
          out.skipped.push({ importKey: n.importKey, id: stored.get(n.importKey) })
        } else {
          stored.set(n.importKey, `id-${stored.size + 1}`)
          out.created.push({ importKey: n.importKey, id: stored.get(n.importKey) })
        }
      }
      return new Response(JSON.stringify(out))
    }))
    return { stored, requests }
  }

  const bigDoc = (i, chars) => ({
    importKey: `file:${i}.md`, title: `Note ${i}`, tags: [], folderPath: [],
    bodyJson: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(chars) }] }]),
    bodyPlain: 'x', media: [], links: [],
  })

  it('sends a large import as several requests, each under the byte limit, and totals them', async () => {
    // 7 notes of ~1,000 bytes with a 2,600-byte limit per request: 2 notes fit, 3 do not.
    const server = fakeConfirmServer({ capBytes: 8192 })
    const progress = []
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: Array.from({ length: 7 }, (_, i) => bigDoc(i, 1000)),
      limits: { maxBytes: 4096 + 2600, maxNotes: 200 },
      onProgress: (p) => { if (p.phase === 'confirm') progress.push(p.done) },
    })
    expect(server.requests.map((r) => r.keys.length)).toEqual([2, 2, 2, 1])
    expect(server.requests.every((r) => r.bytes <= 4096 + 2600)).toBe(true)
    expect(summary.created).toBe(7)
    expect(summary.failures).toEqual([])
    expect(summary.failedBatches).toEqual([])
    expect(server.stored.size).toBe(7)
    // progress the member can see: one step per note, ending at the total
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('also splits by count when every note is small', async () => {
    const server = fakeConfirmServer({ capBytes: 1e9 })
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: Array.from({ length: 5 }, (_, i) => bigDoc(i, 5)),
      limits: { maxNotes: 2 },
      onProgress: () => {},
    })
    expect(server.requests.map((r) => r.keys.length)).toEqual([2, 2, 1])
    expect(summary.created).toBe(5)
  })

  it('never sends a request the server would refuse for its size with the real limits', async () => {
    // The default byte limit is under the server\'s, so the 413 below is never met.
    const server = fakeConfirmServer({ capBytes: 32 * 1024 * 1024 })
    const summary = await runImport({
      source: 'file', destFolderId: null,
      // 40 notes of ~1 MB: 40 MB in all, more than one request may carry
      docs: Array.from({ length: 40 }, (_, i) => bigDoc(i, 1_000_000)),
      onProgress: () => {},
    })
    expect(server.requests.length).toBeGreaterThan(1)
    expect(Math.max(...server.requests.map((r) => r.bytes))).toBeLessThanOrEqual(24 * 1024 * 1024)
    expect(summary.created).toBe(40)
    expect(summary.failedBatches).toEqual([])
  })

  it('a note too large for any request is not sent, and is named with its own sentence', async () => {
    const server = fakeConfirmServer({ capBytes: 8192 })
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [bigDoc(0, 500), { ...bigDoc(1, 9000), title: 'The huge one' }, bigDoc(2, 500)],
      limits: { maxBytes: 4096 + 2600 },
      onProgress: () => {},
    })
    expect(server.requests.flatMap((r) => r.keys)).toEqual(['file:0.md', 'file:2.md'])
    expect(summary.created).toBe(2)
    expect(summary.failures).toEqual([{
      name: 'The huge one',
      reason: 'This note is too large to import (0.0 MB). Split it into smaller notes and import again.',
    }])
    expect(summary.outcomes['file:1.md']).toBe('failed')
  })

  it('a note the server finds too long comes back named, with the sentence the server gave', async () => {
    fakeConfirmServer({ capBytes: 1e9, tooLongKeys: ['file:1.md'] })
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [bigDoc(0, 10), bigDoc(1, 10), bigDoc(2, 10)],
      onProgress: () => {},
    })
    expect(summary.created).toBe(2)
    expect(summary.failures).toEqual([{
      name: 'Note 1',
      reason: 'This note is too long to save as one page. Split it into two or more notes and try again.',
    }])
  })

  it('a request that fails mid-import reports what did land, and a second run finishes without duplicates', async () => {
    const docs = Array.from({ length: 6 }, (_, i) => bigDoc(i, 1000))
    const limits = { maxBytes: 4096 + 2600 }
    const server = fakeConfirmServer({ capBytes: 8192, failRequest: 2 })
    const first = await runImport({ source: 'file', destFolderId: null, docs, limits, onProgress: () => {} })
    // requests 1 and 3 landed (4 notes); request 2 (notes 2 and 3) did not
    expect(first.created).toBe(4)
    expect(first.failedBatches).toHaveLength(1)
    expect(first.failedBatches[0].notes).toBe(2)
    expect(first.failedBatches[0].message).toBe(
      'Batch 2 failed (HTTP 503: the database is busy). The import continued with the ' +
      "remaining batches — this batch's notes were not imported. Running the import again " +
      'will retry them; already-imported notes are safe and will not be duplicated.')
    expect(first.outcomes['file:2.md']).toBe('batch_failed')
    expect(first.outcomes['file:0.md']).toBe('created')

    // the member runs the import again: the four are skipped, the two are created
    const second = await runImport({ source: 'file', destFolderId: null, docs, limits, onProgress: () => {} })
    expect(second.created).toBe(2)
    expect(second.skipped).toBe(4)
    expect(second.failedBatches).toEqual([])
    expect(server.stored.size).toBe(6)
  })

  it('uploads media with a MIME type derived from the file name (server enforces a MIME allowlist)', async () => {
    let capturedFile = null
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/images')) {
        capturedFile = opts.body.get('file')
        return new Response(JSON.stringify({ url: '/img/1.png' }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([img('import-ref://chart.png')]), bodyPlain: 'x',
               media: [{ ref: 'chart.png', kind: 'image', name: 'chart.png',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'chart.png' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(capturedFile).toBeTruthy()
    expect(capturedFile.type).toBe('image/png')
    expect(capturedFile.name).toBe('chart.png')
  })

  it('derives the real xlsx MIME (spreadsheetml.sheet, not .document)', async () => {
    let capturedFile = null
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/attachments')) {
        capturedFile = opts.body.get('file')
        return new Response(JSON.stringify({ url: '/files/1', name: 'book.xlsx', size: 1 }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([{ type: 'attachmentChip', attrs: { href: 'import-ref://book.xlsx', name: 'book.xlsx' } }]),
               bodyPlain: 'x',
               media: [{ ref: 'book.xlsx', kind: 'file', name: 'book.xlsx',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'book.xlsx' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(capturedFile).toBeTruthy()
    expect(capturedFile.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('falls back to the vfile path extension when the media item name has none', async () => {
    let capturedFile = null
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/attachments')) {
        capturedFile = opts.body.get('file')
        return new Response(JSON.stringify({ url: '/files/1', name: 'report', size: 1 }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([{ type: 'attachmentChip', attrs: { href: 'import-ref://report', name: 'report' } }]),
               bodyPlain: 'x',
               media: [{ ref: 'report', kind: 'file', name: 'report',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'notes/report.pdf' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(capturedFile).toBeTruthy()
    expect(capturedFile.type).toBe('application/pdf')
  })
})

// ---------------------------------------------------------------------------
// `outcomes` / `importedNoteIds` / `attentionKeys` — the arrival screen (§9)
// and the enrichment offer (§8.1) both read these DERIVED fields instead of
// re-deriving their own view of what happened. These tests exist to prove
// each field actually tracks what the server said, not the preview's guess.
// ---------------------------------------------------------------------------
describe('runImport — outcomes/importedNoteIds/attentionKeys (arrival + enrichment)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('outcomes records created/updated/skipped/failed per importKey, and importedNoteIds holds only the written ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'a', id: 'n-a' }],
          updated: [{ importKey: 'b', id: 'n-b' }],
          skipped: [{ importKey: 'c', id: 'n-c' }],
          failed: [{ importKey: 'd', error: 'too big' }],
        }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [
        { importKey: 'a', title: 'A', tags: [], folderPath: [], bodyJson: doc([]), media: [], links: [] },
        { importKey: 'b', title: 'B', tags: [], folderPath: [], bodyJson: doc([]), media: [], links: [] },
        { importKey: 'c', title: 'C', tags: [], folderPath: [], bodyJson: doc([]), media: [], links: [] },
        { importKey: 'd', title: 'D', tags: [], folderPath: [], bodyJson: doc([]), media: [], links: [] },
      ],
      onProgress: () => {},
    })
    expect(summary.outcomes).toEqual({ a: 'created', b: 'updated', c: 'skipped', d: 'failed' })
    expect(summary.importedNoteIds.sort()).toEqual(['n-a', 'n-b'])
  })

  it('a whole-batch HTTP failure marks every note in that batch batch_failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'x', title: 'X', tags: [], folderPath: [], bodyJson: doc([]), media: [], links: [] }],
      onProgress: () => {},
    })
    expect(summary.outcomes).toEqual({ x: 'batch_failed' })
    expect(summary.importedNoteIds).toEqual([])
  })

  it('a note whose final PUT 500s is created/updated AND flagged for attention — it is in the notebook, just not fully clean', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'a', id: 'n-a' }], updated: [], skipped: [] }))
      }
      if (opts?.method === 'PUT') return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'a', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([img('import-ref://a.png')]),
               media: [{ ref: 'a.png', kind: 'image', name: 'a.png',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'a.png' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(summary.outcomes.a).toBe('created')
    expect(summary.importedNoteIds).toEqual(['n-a'])
    expect(summary.attentionKeys).toEqual(['a'])
  })

  it('a clean note with no media/links is created and never appears in attentionKeys', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'a', id: 'n-a' }], updated: [], skipped: [] }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'a', title: 'A', tags: [], folderPath: [], bodyJson: doc([]), media: [], links: [] }],
      onProgress: () => {},
    })
    expect(summary.attentionKeys).toEqual([])
  })
})
