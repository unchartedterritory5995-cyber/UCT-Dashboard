// Capture-target registry rails.
//
// The load-bearing one is BEHAVIOUR PRESERVATION: ten shipped doors call
// sendCaptureToJournal with no target, and their wire (last-active note →
// inbox fallback, 24h staleness gate, destination named in the toast) must be
// byte-identical after the destination moved into the registry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendCaptureToJournal } from './sendToJournal'
import { CAPTURE_TARGETS, targetsFor, freshLastNote } from './captureTargets'

const H = { calls: [], ok: true }

// A chart capture also fires the bars deep-fill warm (POST /api/bars/warm)
// so the (ticker, tf) history outlives the session — real, load-bearing,
// and NOT a journal call. Sequence assertions look at the journal wire.
const journalCalls = () => H.calls.filter((c) => !c.url.startsWith('/api/bars/'))

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    H.calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body })
    return Promise.resolve({
      ok: H.ok,
      json: () => Promise.resolve({ note: { id: 'new1', title: 'AMD' } }),
    })
  }))
}

beforeEach(() => {
  H.calls = []
  H.ok = true
  localStorage.clear()
  stubFetch()
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => Promise.resolve()) } })
})
afterEach(() => vi.unstubAllGlobals())

const CAP = { symbol: 'AMD', tf: '15' }

describe('default target preserves the shipped door behaviour', () => {
  it('a FRESH last note takes the capture, and the toast names it', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now(), title: 'Tuesday' }))
    const msg = await sendCaptureToJournal('chart', CAP, { label: 'AMD' })
    expect(msg).toBe('AMD sent to “Tuesday”')
    expect(journalCalls()[0].url).toBe('/api/j2/notes/n1/embeds')
    // …and the durability warm still fires for a chart capture.
    expect(H.calls.some((c) => c.url === '/api/bars/warm')).toBe(true)
  })

  it('a STALE last note (>24h) is skipped for the inbox — captures never bury', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({
      id: 'old', ts: Date.now() - 25 * 60 * 60 * 1000, title: 'March post-mortem',
    }))
    const msg = await sendCaptureToJournal('chart', CAP, { label: 'AMD' })
    expect(msg).toBe('AMD captured → Notebook inbox')
    expect(journalCalls().every((c) => !c.url.includes('/notes/old/'))).toBe(true)
    expect(freshLastNote()).toBeNull()
  })

  it('a deleted note (non-ok append) falls through to the inbox', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'gone', ts: Date.now() }))
    H.ok = false
    const msg = await sendCaptureToJournal('chart', CAP, { label: 'AMD' })
    expect(msg).toBe('Capture failed — try again')
    expect(journalCalls().map((c) => c.url)).toEqual(['/api/j2/notes/gone/embeds', '/api/j2/inbox'])
  })
})

describe('new destinations every door gets for free', () => {
  it('newNote creates an entry holding the embed, and re-points the capture target', async () => {
    const msg = await sendCaptureToJournal('chart', CAP, { label: 'AMD', target: 'newNote' })
    expect(msg).toBe('New entry started — “AMD”')
    const post = journalCalls().find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    const body = JSON.parse(post.body)
    expect(body.title).toBe('AMD')
    expect(body.bodyJson.content[0].type).toBe('widgetEmbed')
    expect(body.bodyJson.content[0].attrs.params.symbol).toBe('AMD')
    // The next capture from any widget should land in the entry just started.
    expect(JSON.parse(localStorage.getItem('uct.jw.lastNote')).id).toBe('new1')
  })

  it('copyChartLink copies a link that re-opens the view on /charts', async () => {
    const msg = await sendCaptureToJournal('chart', CAP, { label: 'AMD', target: 'copyChartLink' })
    expect(msg).toBe('Chart link copied')
    const copied = navigator.clipboard.writeText.mock.calls[0][0]
    expect(copied).toContain('/charts?sym=AMD&tf=15')
    // It is a LINK, not a capture — nothing was posted to the journal.
    expect(journalCalls()).toEqual([])
  })

  it('targets advertise where they apply — no "copy chart link" on a breadth capture', () => {
    const chart = targetsFor('chart', { params: { symbol: 'AMD' } }).map((t) => t.id)
    const breadth = targetsFor('breadth', { params: {} }).map((t) => t.id)
    expect(chart).toContain('copyChartLink')
    expect(breadth).not.toContain('copyChartLink')
    // Every capture keeps the universal destinations.
    for (const id of ['note', 'newNote', 'inbox']) {
      expect(breadth).toContain(id)
      expect(chart).toContain(id)
    }
  })

  it('an unknown target falls back to the default rather than dropping the capture', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now(), title: 'T' }))
    const msg = await sendCaptureToJournal('chart', CAP, { label: 'AMD', target: 'nope' })
    expect(msg).toBe('AMD sent to “T”')
  })

  it('a throwing target surfaces the failure instead of a silent no-op', async () => {
    const boom = { ...CAPTURE_TARGETS.note, run: () => { throw new Error('x') } }
    const orig = CAPTURE_TARGETS.note
    CAPTURE_TARGETS.note = boom
    try {
      expect(await sendCaptureToJournal('chart', CAP, { label: 'AMD' })).toBe('Capture failed — try again')
    } finally {
      CAPTURE_TARGETS.note = orig
    }
  })
})
