// Phase 4D-4C.2: the `extra` passthrough (tradeRef, caption) added to
// buildCapture/sendCaptureToJournal — every existing door (no `extra` passed)
// must stay byte-identical; captureTargets.test.js covers that contract.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildCapture, sendCaptureToJournal } from './sendToJournal'

const H = { calls: [] }
const journalCalls = () => H.calls.filter((c) => !c.url.startsWith('/api/bars/'))

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    H.calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body })
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ note: { id: 'new1', title: 'AMD trade' } }),
    })
  }))
}

beforeEach(() => {
  H.calls = []
  localStorage.clear()
  stubFetch()
})
afterEach(() => vi.unstubAllGlobals())

describe('buildCapture extra passthrough', () => {
  it('with no extra, tradeRef is null — byte-identical to every existing door', () => {
    const attrs = buildCapture('chart', { symbol: 'AMD', tf: 'D' })
    expect(attrs.tradeRef).toBeNull()
  })

  it('an explicit tradeRef rides the built attrs', () => {
    const attrs = buildCapture('chart', { symbol: 'AMD', tf: 'D' }, { tradeRef: 'id:t1' })
    expect(attrs.tradeRef).toBe('id:t1')
  })
})

describe('sendCaptureToJournal extra passthrough (Phase 4D-4C.2)', () => {
  it('an explicit tradeRef reaches the POST body when starting a new entry', async () => {
    const msg = await sendCaptureToJournal('chart', { symbol: 'TQQQ', tf: 'D' }, {
      label: 'TQQQ trade', target: 'newNote',
      extra: { tradeRef: 'id:t1', caption: 'TQQQ — Long trade' },
    })
    expect(msg).toBe('New entry started — “TQQQ trade”')
    const post = journalCalls().find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    const body = JSON.parse(post.body)
    const attrs = body.bodyJson.content[0].attrs
    expect(attrs.tradeRef).toBe('id:t1')
    expect(attrs.caption).toBe('TQQQ — Long trade')
    expect(attrs.params.symbol).toBe('TQQQ')
  })

  it('an explicit tradeRef reaches the POST body appending to the current note', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now(), title: 'Today' }))
    await sendCaptureToJournal('chart', { symbol: 'TQQQ', tf: 'D' }, {
      label: 'TQQQ trade', extra: { tradeRef: 'ext:bk:xyz' },
    })
    const post = journalCalls().find((c) => c.url === '/api/j2/notes/n1/embeds')
    const body = JSON.parse(post.body)
    expect(body.attrs.tradeRef).toBe('ext:bk:xyz')
  })

  it('omitting extra never crashes and never fabricates a tradeRef', async () => {
    const msg = await sendCaptureToJournal('chart', { symbol: 'TQQQ', tf: 'D' }, {
      label: 'TQQQ trade', target: 'newNote',
    })
    expect(msg).toBe('New entry started — “TQQQ trade”')
    const post = journalCalls().find((c) => c.url === '/api/j2/notes')
    const body = JSON.parse(post.body)
    expect(body.bodyJson.content[0].attrs.tradeRef).toBeNull()
  })
})
