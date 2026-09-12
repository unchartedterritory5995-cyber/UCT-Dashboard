/**
 * ⛔⛔ ONE RAIL PER DOOR FAMILY — DRIVEN THROUGH THE REAL MODULE.
 *
 * The enumeration rail proves a settle EXISTS near every door. That is a
 * structural claim about source text: it cannot tell a settle that runs from a
 * settle that is skipped by a branch, nor a settle that lands the right
 * revision from one that lands `undefined`. These drive the real functions and
 * assert the one thing that matters — WHICH REVISION ENDED UP IN THE RING.
 *
 * ⭐ THE STUB IS AT THE BOTTOM OF THE STACK. `recordLandedRevision` is the only
 * call that puts a revision in the ring, so stubbing it leaves the whole of
 * `settleNoteWrite` — the account gate, the baseline authority, the response
 * read — running for real. Stubbing `settleNoteWrite` itself would prove only
 * that somebody called something.
 *
 * ⛔ EVERY FAMILY IS PAIRED WITH ITS NEGATIVE. A rail that only shows a
 * revision landing cannot distinguish this code from `() => record(anything)`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setCurrentAccountId } from './currentAccount'
import { recordLandedRevision } from './useDurableNote'

vi.mock('./useDurableNote', () => ({
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

const T2 = '2026-09-12T14:00:00.000000+00:00'
const NOTE = { id: 'n1', updatedAt: T2, title: 'n1' }

/** Every revision this browser recorded, in order. */
const landed = () => recordLandedRevision.mock.calls.map(([a]) => a.updatedAt)
const landedFor = () => recordLandedRevision.mock.calls.map(([a]) => a.noteId)

/** A fetch stub that answers every call with one body. */
function answering(body, { ok = true, status = 200 } = {}) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setCurrentAccountId('acct-A')
})
afterEach(() => { vi.unstubAllGlobals(); setCurrentAccountId(null); localStorage.clear() })

describe('append_widget_embed — Send to Journal', () => {
  it('landing the revision is what stops the fork', async () => {
    const { sendCaptureToJournal } = await import('../sendToJournal')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    answering({ note: NOTE })

    await sendCaptureToJournal('chart', { widgetId: 'chart', params: { symbol: 'AMD' } }, { label: 'AMD' })
    expect(landed()).toEqual([T2])
    expect(landedFor()).toEqual(['n1'])
  })

  it('⛔ CONTROL — an append the server REFUSED lands nothing', async () => {
    const { sendCaptureToJournal } = await import('../sendToJournal')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    answering({}, { ok: false, status: 404 })

    await sendCaptureToJournal('chart', { widgetId: 'chart', params: { symbol: 'AMD' } }, { label: 'AMD' })
    expect(landed(), 'a write that did not happen has no revision').toEqual([])
  })

  it('⛔ CONTROL — a server that returns no note lands nothing rather than a guess', async () => {
    const { sendCaptureToJournal } = await import('../sendToJournal')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    answering({ ok: true })            // 200, but the note never came back

    await sendCaptureToJournal('chart', { widgetId: 'chart', params: { symbol: 'AMD' } }, { label: 'AMD' })
    expect(landed(), 'a browser cannot record a revision it was never told').toEqual([])
  })
})

describe('append_financial_fact — a price saved from outside the editor', () => {
  it('the insert lands the revision, and the member is told it worked', async () => {
    const { capturePriceToNotebook } = await import('../captureFinancialFact')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    answering({ fact: { id: 'f1' }, note: NOTE })

    const msg = await capturePriceToNotebook('NVDA')
    // ⚰️ This assertion is here because the settle BROKE this message once:
    // `(await res.json().catch(...)).note` throws synchronously on a response
    // with no `json`, straight past the guard, and a successful capture
    // reported "Capture failed — try again".
    expect(msg).toBe('NVDA price captured to Notebook')
    expect(landed()).toEqual([T2])
  })

  it('⛔ CONTROL — a refused insert lands nothing', async () => {
    const { capturePriceToNotebook } = await import('../captureFinancialFact')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    const fetchMock = vi.fn(async (url) => (String(url).includes('/insert')
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ fact: { id: 'f1' } }) }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await capturePriceToNotebook('NVDA')).toBe('Capture failed — try again')
    expect(landed()).toEqual([])
  })
})

describe('update_note — the enrichment doors', () => {
  it('addChartEmbed lands the revision of every note it enriches', async () => {
    const { addChartEmbed } = await import('../importer/enrichment')
    answering({ note: { ...NOTE, bodyJson: { type: 'doc', content: [] } } })

    await addChartEmbed('n1', 'AMD')
    expect(landed()).toEqual([T2])
  })

  it('revertChartEmbed lands too — an undo is a write like any other', async () => {
    const { revertChartEmbed } = await import('../importer/enrichment')
    answering({ note: NOTE })

    await revertChartEmbed('n1', { type: 'doc', content: [{ type: 'widgetEmbed' }] })
    expect(landed()).toEqual([T2])
  })

  it('⛔ CONTROL — a failed enrichment throws and lands nothing', async () => {
    const { addChartEmbed } = await import('../importer/enrichment')
    answering({ detail: 'nope' }, { ok: false, status: 400 })

    await expect(addChartEmbed('n1', 'AMD')).rejects.toThrow()
    expect(landed()).toEqual([])
  })
})

describe('update_note — a note created with properties', () => {
  it('the properties PUT lands its revision before the editor opens on it', async () => {
    const { createNoteViaApi } = await import('../noteCreation')
    answering({ note: NOTE })

    await createNoteViaApi({ title: 'x', properties: { 'builtin:research_type': 'long_thesis' } })
    expect(landed()).toEqual([T2])
  })

  it('⛔ CONTROL — with NO properties there is no second write, so nothing lands', async () => {
    const { createNoteViaApi } = await import('../noteCreation')
    answering({ note: NOTE })

    await createNoteViaApi({ title: 'x' })
    expect(landed(), 'the POST that creates a note is not a door — there was nothing queued against it').toEqual([])
  })
})

describe('update_note — restoring an old version', () => {
  it('a version restore lands its revision', async () => {
    const { restoreNoteVersion } = await import('../../hooks/useJ2NoteVersions')
    answering({ note: NOTE })

    await restoreNoteVersion('n1', 'v9', 'T1')
    expect(landed()).toEqual([T2])
  })

  it('⛔ CONTROL — a 409 restore throws and lands nothing', async () => {
    const { restoreNoteVersion } = await import('../../hooks/useJ2NoteVersions')
    answering({ detail: 'note changed' }, { ok: false, status: 409 })

    await expect(restoreNoteVersion('n1', 'v9', 'T1')).rejects.toThrow()
    expect(landed()).toEqual([])
  })
})

describe('⛔ the account gate holds at every door', () => {
  it('signed out, a real door lands NOTHING rather than writing to the wrong store', async () => {
    setCurrentAccountId(null)
    const { sendCaptureToJournal } = await import('../sendToJournal')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    answering({ note: NOTE })

    await sendCaptureToJournal('chart', { widgetId: 'chart', params: { symbol: 'AMD' } }, { label: 'AMD' })
    expect(landed(), 'a revision recorded under the previous member is worse than none').toEqual([])
  })

  it('⛔ and an EMPTY-STRING revision is not a revision', async () => {
    const { sendCaptureToJournal } = await import('../sendToJournal')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'n1', ts: Date.now() }))
    answering({ note: { ...NOTE, updatedAt: '' } })

    await sendCaptureToJournal('chart', { widgetId: 'chart', params: { symbol: 'AMD' } }, { label: 'AMD' })
    // `''` reads as present to a producer and absent to a consumer — the exact
    // defect `baseline.js` exists to kill. It must never reach the ring.
    expect(landed()).toEqual([])
  })
})

describe('update_note — the SHARED note PUT every surface goes through', () => {
  it('⭐ the hook settles, so every caller of `update` lands its revision by construction', async () => {
    const { renderHook, act, waitFor } = await import('@testing-library/react')
    const { createElement } = await import('react')
    const { SWRConfig } = await import('swr')
    const { useJ2Note } = await import('../../hooks/useJ2Notes')
    answering({ note: NOTE })

    const wrapper = ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map() } }, children)
    const { result } = renderHook(() => useJ2Note('n1'), { wrapper })
    await waitFor(() => expect(result.current.update).toBeTypeOf('function'))
    await act(async () => { await result.current.update({ title: 'renamed' }) })

    // ⛔ This is the one that covers the surfaces with no rail of their own:
    // PropertiesSection's folder/ticker/tags, the editor's body save, and any
    // future caller. A settle at N call sites is N chances to add the N+1th
    // without one; this is the single place they all pass through.
    await waitFor(() => expect(landed()).toEqual([T2]))
    expect(landedFor()).toEqual(['n1'])
  })

  it('⛔ CONTROL — a REFUSED PUT lands nothing', async () => {
    const { renderHook, act, waitFor } = await import('@testing-library/react')
    const { createElement } = await import('react')
    const { SWRConfig } = await import('swr')
    const { useJ2Note } = await import('../../hooks/useJ2Notes')
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return calls === 1
        ? { ok: true, status: 200, json: async () => ({ note: NOTE }) }        // the SWR read
        : { ok: false, status: 409, json: async () => ({ detail: 'changed' }) } // the PUT
    }))

    const wrapper = ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map() } }, children)
    const { result } = renderHook(() => useJ2Note('n1'), { wrapper })
    await waitFor(() => expect(result.current.update).toBeTypeOf('function'))
    await act(async () => {
      await expect(result.current.update({ title: 'renamed' })).rejects.toThrow()
    })
    expect(landed()).toEqual([])
  })
})

describe('update_note — the importer rewriting media links', () => {
  it('the media-rewrite PUT lands its revision, once per imported note', async () => {
    const { runImport } = await import('../importer/commit')
    // ⛔ The follow-up PUT only happens for a note with MEDIA OR LINKS to
    // rewrite — a doc with neither never reaches the door, so a fixture
    // without media would pass this rail by never exercising it.
    const bodyJson = { type: 'doc', content: [{ type: 'image', attrs: { src: 'import-ref://a.png' } }] }
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const u = String(url)
      const m = opts.method || 'GET'
      seen.push(`${m} ${u}`)
      if (u.endsWith('/import/confirm')) {
        // the real response shape: created[] carries `id`, not `noteId`
        return { ok: true, json: async () => ({ created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }) }
      }
      if (u.endsWith('/images')) return { ok: true, json: async () => ({ url: '/i/a.png' }) }
      if (m === 'PUT') return { ok: true, json: async () => ({ note: NOTE }) }
      return { ok: true, json: async () => ({}) }
    }))

    await runImport({
      source: 'file',
      destFolderId: null,
      docs: [{
        importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
        bodyJson, bodyPlain: 'x',
        media: [{ ref: 'a.png', kind: 'image', name: 'a.png', vfile: { bytes: async () => new Uint8Array([1]), path: 'a.png' } }],
        links: [],
      }],
      onProgress: () => {},
    })

    // ⭐ Non-vacuity: the door must actually have been reached.
    expect(seen.some((c) => c === 'PUT /api/j2/notes/n1'), 'the rewrite PUT never fired — the fixture does not reach the door').toBe(true)
    // ⛔ An import runs over MANY notes, so an unlanded revision here is not one
    // fork — it is one per imported note the member had unsent work in.
    expect(landed()).toEqual([T2])
  })
})
