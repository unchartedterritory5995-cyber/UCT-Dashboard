// ⛔⛔ THE SHARED TRANSPORT'S OWN GUARDS, RAILED WHERE THEY LIVE.
//
// `openDocumentPage` is what every Ask host reaches for a cited document page.
// The final wave-4 review found two of its guards could not fail: removing
// either left every host suite green. Each case below names the guard it holds,
// and each has a control proving the same call CAN go the other way -- a rail
// that could only ever answer one thing would prove nothing.
//
//   - a captured web row is never a viewer target (`resolveDocumentPage`);
//   - a host with its own door for a row gets the FRESH row, whatever its kind;
//   - a listed row with no file is `missing`, not a page to preview;
//   - a host never "opens" the note that is already open (`hereNoteId`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  openDocumentPage, resolveDocumentPage, DOCUMENT_GONE, SOURCE_NOWHERE,
  citedPassage, passageNavigationState, passageFromNavigationState, openSpanningCitation,
} from './openCitation'

const PDF_ROW = {
  id: 'd1', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/q3.pdf', name: 'Q3 10-Q',
  sourceKind: 'attachment', capturePassages: [],
}
const WEB_ROW = {
  id: 'dw', attachmentUrl: 'web:3f2a', name: 'Reuters: NVDA margins',
  sourceKind: 'web', capturePassages: [{ pageNumber: 1, excerptId: 'exw' }],
}
const NO_FILE_ROW = { id: 'dn', name: 'Still uploading', status: 'processing' }

function listAnswers(documents) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ documents }) }))
}
const nav = (document_id, page_number = 3, note_id = 'n1') => ({ kind: 'document', document_id, page_number, note_id })

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

describe('resolveDocumentPage — a captured web row is never a viewer target', () => {
  it('a captured row comes back as `web`, with the row and page, and no target', async () => {
    listAnswers([PDF_ROW, WEB_ROW])
    const r = await resolveDocumentPage(nav('dw', 1))
    expect(r).toEqual({ kind: 'web', doc: WEB_ROW, page: 1 })
    expect(r.target).toBeUndefined()
  })

  it('CONTROL: a PDF row comes back as a viewer target at its page', async () => {
    listAnswers([PDF_ROW, WEB_ROW])
    const r = await resolveDocumentPage(nav('d1', 3))
    expect(r.kind).toBe('document')
    expect(r.target).toEqual({ href: PDF_ROW.attachmentUrl, name: 'Q3 10-Q', documentId: 'd1', page: 3 })
    expect(r.doc).toBe(PDF_ROW)
  })
})

describe('openDocumentPage — a host with no door for a row', () => {
  it('a captured row opens its NOTE -- the viewer is never handed `web:<sha256>`', async () => {
    listAnswers([WEB_ROW])
    const openDocument = vi.fn()
    const openNote = vi.fn()
    expect(await openDocumentPage(nav('dw', 1, 'n2'), { openDocument, openNote })).toBeNull()
    expect(openDocument).not.toHaveBeenCalled()
    expect(openNote).toHaveBeenCalledWith({ id: 'n2' })
  })

  it('a captured row it cannot open anywhere says so -- never the viewer', async () => {
    listAnswers([WEB_ROW])
    const openDocument = vi.fn()
    expect(await openDocumentPage(nav('dw', 1), { openDocument })).toBe(SOURCE_NOWHERE)
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('CONTROL: a PDF row opens the viewer at its page', async () => {
    listAnswers([PDF_ROW])
    const openDocument = vi.fn()
    const openNote = vi.fn()
    expect(await openDocumentPage(nav('d1', 3), { openDocument, openNote })).toBeNull()
    expect(openDocument).toHaveBeenCalledWith(expect.objectContaining({ href: PDF_ROW.attachmentUrl, page: 3 }))
    expect(openNote).not.toHaveBeenCalled()
  })
})

describe('openDocumentPage — a host with its own door for a row gets the FRESH row', () => {
  it('a captured row goes to the door, with its page -- never the viewer', async () => {
    listAnswers([PDF_ROW, WEB_ROW])
    const openRow = vi.fn(() => 'said by the door')
    const openDocument = vi.fn()
    expect(await openDocumentPage(nav('dw', 1), { openDocument, openRow })).toBe('said by the door')
    expect(openRow).toHaveBeenCalledWith(WEB_ROW, { page: 1 })
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('a PDF row goes to the same door -- one door, whatever the kind', async () => {
    listAnswers([PDF_ROW, WEB_ROW])
    const openRow = vi.fn(() => null)
    const openDocument = vi.fn()
    expect(await openDocumentPage(nav('d1', 3), { openDocument, openRow })).toBeNull()
    expect(openRow).toHaveBeenCalledWith(PDF_ROW, { page: 3 })
    expect(openDocument).not.toHaveBeenCalled()
  })
})

// ⛔ M-3, guard 1: a listed row with no file is `missing` -- the note answered,
// but holds nothing the viewer can show. Without the guard the viewer opened
// with `href` undefined.
describe('openDocumentPage — a listed row with NO file is not a page to preview', () => {
  it('opens its note when the host can', async () => {
    listAnswers([NO_FILE_ROW])
    const openDocument = vi.fn()
    const openNote = vi.fn()
    expect(await openDocumentPage(nav('dn', 2, 'n2'), { openDocument, openNote })).toBeNull()
    expect(openDocument).not.toHaveBeenCalled()
    expect(openNote).toHaveBeenCalledWith({ id: 'n2' })
  })

  it('says the document is no longer available when it cannot', async () => {
    listAnswers([NO_FILE_ROW])
    const openDocument = vi.fn()
    expect(await openDocumentPage(nav('dn', 2), { openDocument })).toBe(DOCUMENT_GONE)
    expect(openDocument).not.toHaveBeenCalled()
  })
})

// ⛔ M-3, guard 2: the note already open is never "opened" -- that changes
// nothing on screen, a silent click. It says the document left instead.
describe('openDocumentPage — the note already open is never "opened"', () => {
  it('a document that left the note already open says so, and opens nothing', async () => {
    listAnswers([PDF_ROW])
    const openNote = vi.fn()
    const openDocument = vi.fn()
    expect(await openDocumentPage(nav('dz', 3, 'n1'), { openDocument, openNote, hereNoteId: 'n1' }))
      .toBe(DOCUMENT_GONE)
    expect(openNote).not.toHaveBeenCalled()
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('a captured row of the note already open says it cannot open it here, and opens nothing', async () => {
    listAnswers([WEB_ROW])
    const openNote = vi.fn()
    const openDocument = vi.fn()
    expect(await openDocumentPage(nav('dw', 1, 'n1'), { openDocument, openNote, hereNoteId: 'n1' }))
      .toBe(SOURCE_NOWHERE)
    expect(openNote).not.toHaveBeenCalled()
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('CONTROL: the same document leaving ANOTHER note opens that note', async () => {
    listAnswers([PDF_ROW])
    const openNote = vi.fn()
    expect(await openDocumentPage(nav('dz', 3, 'n1'), { openDocument: vi.fn(), openNote, hereNoteId: 'n9' }))
      .toBeNull()
    expect(openNote).toHaveBeenCalledWith({ id: 'n1' })
  })
})

// ⛔⛔ Fin walk 8.3 — a NOTE citation from a spanning scope carries its passage to
// the note it opens, and ONLY to that note. The guards here are the ones the
// end-to-end rail (NotebookTab.citationLanding.test.jsx) cannot drive through the
// UI: a state addressed to another note, and a source that names no passage.
const NOTE_SOURCE = {
  n: 1, type: 'note', label: 'CRWD plan', citation: 'exact',
  snippet: 'CRWD breakout plan. Planned entry 412.50 on a close above the base high.',
  navigation: { kind: 'note', note_id: 'n1' },
  location: { from: 29, to: 34, fingerprint: 'f:1', snippet_start: 28, snippet_end: 33, text: 'entry' },
}

describe('citedPassage — what a note citation hands the note it opens', () => {
  it('a located note citation names its note, its range and the text AT the range (not the snippet)', () => {
    expect(citedPassage(NOTE_SOURCE)).toEqual({ noteId: 'n1', location: NOTE_SOURCE.location, text: 'entry' })
  })

  it('a packet without the range\'s own text (an older server, "This note") verifies on its snippet', () => {
    const { text: _dropped, ...loc } = NOTE_SOURCE.location
    expect(citedPassage({ ...NOTE_SOURCE, location: loc }).text).toBe(NOTE_SOURCE.snippet)
  })

  it('a note-level source (no range) names no passage -- the note opens as before', () => {
    expect(citedPassage({ ...NOTE_SOURCE, citation: 'note_only', location: {} })).toBeNull()
    expect(citedPassage({ ...NOTE_SOURCE, location: null })).toBeNull()
  })

  it('a range with nothing to verify it names no passage; an atom needs no text', () => {
    expect(citedPassage({ ...NOTE_SOURCE, snippet: '', location: { from: 1, to: 6 } })).toBeNull()
    const atom = { from: 1, to: 2, atom: { type: 'documentExcerpt', id: 'ex1' } }
    expect(citedPassage({ ...NOTE_SOURCE, snippet: '', location: atom })).toEqual({ noteId: 'n1', location: atom, text: '' })
  })

  it('a citation that is not a note names no passage, whatever its location says', () => {
    expect(citedPassage({ ...NOTE_SOURCE, navigation: { kind: 'excerpt', excerpt_id: 'ex1' } })).toBeNull()
    expect(citedPassage({ ...NOTE_SOURCE, navigation: { kind: 'note' } })).toBeNull()
  })
})

describe('passageFromNavigationState — addressed to ONE note', () => {
  const passage = citedPassage(NOTE_SOURCE)
  const state = passageNavigationState(passage)

  it('answers for the note the passage names', () => {
    expect(passageFromNavigationState(state, 'n1')).toBe(passage)
  })

  it('⛔ answers NOTHING for any other note -- a state that outlives its entry cannot scroll an unrelated open', () => {
    expect(passageFromNavigationState(state, 'n2')).toBeNull()
    expect(passageFromNavigationState(state, null)).toBeNull()
  })

  it('a bare entry (no state, or some other state) carries no passage', () => {
    expect(passageFromNavigationState(null, 'n1')).toBeNull()
    expect(passageFromNavigationState(undefined, 'n1')).toBeNull()
    expect(passageFromNavigationState({ somethingElse: 1 }, 'n1')).toBeNull()
  })
})

describe('openSpanningCitation — a note citation opens its note WITH the passage', () => {
  it('hands the host\'s openNote the passage in NotebookTab\'s own third argument', () => {
    const openNote = vi.fn()
    expect(openSpanningCitation(NOTE_SOURCE, { openNote })).toBeNull()
    expect(openNote).toHaveBeenCalledWith({ id: 'n1' }, null, { passage: citedPassage(NOTE_SOURCE) })
  })

  it('CONTROL: a note-level citation opens the note exactly as before -- no passage, no third argument', () => {
    const openNote = vi.fn()
    expect(openSpanningCitation({ ...NOTE_SOURCE, citation: 'note_only', location: {} }, { openNote })).toBeNull()
    expect(openNote).toHaveBeenCalledWith({ id: 'n1' })
    expect(openNote.mock.calls[0]).toHaveLength(1)
  })

  it('with no host door, it says so', () => {
    expect(openSpanningCitation(NOTE_SOURCE, {})).toBe(SOURCE_NOWHERE)
  })
})
