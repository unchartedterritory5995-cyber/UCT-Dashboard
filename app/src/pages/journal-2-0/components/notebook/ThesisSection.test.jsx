import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let summaryResult
let factsResult
let excerptsResult
const useThesisSummarySpy = vi.fn(() => summaryResult)
const useNoteFactsSpy = vi.fn(() => factsResult)
const useNoteExcerptsSpy = vi.fn(() => excerptsResult)
vi.mock('../../hooks/useThesisSummary', () => ({ default: (noteId) => useThesisSummarySpy(noteId) }))
vi.mock('../../hooks/useNoteFacts', () => ({ default: (noteId) => useNoteFactsSpy(noteId) }))
vi.mock('../../hooks/useNoteExcerpts', () => ({ default: (noteId) => useNoteExcerptsSpy(noteId) }))
// ⭐ WAVE N: the evidence PICKER now sources candidates by OWNERSHIP, not from
// the body-refs sidecar `useNoteExcerpts` reads — that sidecar is why a captured
// web passage was never offered. `useNoteExcerpts` is still mocked above because
// the component still uses it for RENDERING an existing evidence row's citation.
let candidatesResult
const useEvidenceCandidatesSpy = vi.fn(() => candidatesResult)
vi.mock('../../hooks/useEvidenceCandidates', () => ({
  default: (noteId, opts) => useEvidenceCandidatesSpy(noteId, opts),
}))

import ThesisSection from './ThesisSection'

function renderIt(note, extraProps = {}) {
  return render(
    <MemoryRouter>
      <ThesisSection noteId="n1" note={note} {...extraProps} />
    </MemoryRouter>,
  )
}

const PLAIN_NOTE = { id: 'n1', title: 'Grocery list', tags: [], propertiesJson: {} }
const THESIS_NOTE_BY_PROPERTY = {
  id: 'n1', title: 'NVDA Thesis', tags: [], propertiesJson: { 'builtin:research_type': 'long_thesis' },
}
const THESIS_NOTE_BY_TAG = { id: 'n1', title: 'NVDA Thesis', tags: ['thesis'], propertiesJson: {} }

beforeEach(() => {
  summaryResult = { evidence: [], changelog: [], isLoading: false, refresh: vi.fn() }
  factsResult = { facts: [] }
  excerptsResult = { excerpts: [] }
  candidatesResult = { candidates: [], isLoading: false, refresh: vi.fn() }
  useThesisSummarySpy.mockClear()
  useNoteFactsSpy.mockClear()
  useNoteExcerptsSpy.mockClear()
  useEvidenceCandidatesSpy.mockClear()
  global.fetch = vi.fn()
  // CollapsibleSection persists open/closed per-id in localStorage -- clear
  // it so one test's toggle can't leak into the next (both tests here use
  // the same noteId, hence the same persisted key).
  window.localStorage.clear()
})

describe('ThesisSection', () => {
  it('renders nothing for an ordinary note (not thesis-shaped)', () => {
    const { container } = renderIt(PLAIN_NOTE)
    expect(container.firstChild).toBeNull()
  })

  it('renders for a note with Research Type set to Long Thesis', () => {
    renderIt(THESIS_NOTE_BY_PROPERTY)
    expect(screen.getByText('Add evidence')).toBeTruthy()
  })

  it('renders for a note carrying the legacy thesis tag, even with no research_type property', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    expect(screen.getByText('Add evidence')).toBeTruthy()
  })

  it('renders once evidence exists, even for an otherwise-plain note', () => {
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'note', targetId: 'n2', stance: 'supports', caption: 'x', removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    renderIt(PLAIN_NOTE)
    expect(screen.getByText('x')).toBeTruthy()
    expect(screen.getByText('Supports')).toBeTruthy()
  })

  it('shows an honest empty state in the changelog, never nothing, once expanded', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Changelog'))
    expect(screen.getByText(/Changes will appear here/)).toBeTruthy()
  })

  it('renders changelog events when present', () => {
    summaryResult = {
      evidence: [], changelog: [{ type: 'thesis_edited', at: '2026-09-01T00:00:00Z', fromVersionId: 'v1', toVersionId: 'v2' }],
      isLoading: false, refresh: vi.fn(),
    }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Changelog'))
    expect(screen.getByText('Thesis edited')).toBeTruthy()
  })

  it('opening the add-evidence picker lets a member choose supports/opposes and note/fact', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    expect(screen.getByText('Supports')).toBeTruthy()
    expect(screen.getByText('Opposes')).toBeTruthy()
    expect(screen.getByText('Note')).toBeTruthy()
    expect(screen.getByText('Captured fact')).toBeTruthy()
  })

  it('adding evidence posts to the evidence endpoint and refreshes', async () => {
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/notes?q=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'n2', title: 'Supporting note' }] }) })
      }
      if (url.includes('/evidence') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ evidence: { id: 'e1' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    const refresh = vi.fn()
    summaryResult = { evidence: [], changelog: [], isLoading: false, refresh }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.change(screen.getByPlaceholderText('Search notes…'), { target: { value: 'support' } })
    await waitFor(() => expect(screen.getByText('Supporting note')).toBeTruthy(), { timeout: 1000 })
    fireEvent.click(screen.getByText('Supporting note'))
    fireEvent.click(screen.getByText('Add evidence'))
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
    expect(postCall[0]).toBe('/api/j2/notes/n1/evidence')
    expect(JSON.parse(postCall[1].body)).toMatchObject({ targetType: 'note', targetId: 'n2', stance: 'supports' })
  })

  it('removing evidence calls the delete endpoint and refreshes', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const refresh = vi.fn()
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'note', targetId: 'n2', stance: 'opposes', caption: null, removedAt: null }],
      changelog: [], isLoading: false, refresh,
    }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByLabelText('Remove evidence'))
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/evidence/e1', expect.objectContaining({ method: 'DELETE' }))
  })
})

// ── Wave J: document excerpt evidence ────────────────────────────────────

describe('ThesisSection — Wave J document excerpt evidence', () => {
  it('the evidence-type picker offers "Document excerpt" alongside Note/Captured fact', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    expect(screen.getByText('Document excerpt')).toBeTruthy()
  })

  it('picking "Document excerpt" lists this note\'s own saved excerpts by citation + quote', () => {
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [{
      id: 'ex1', evidenceType: 'document_excerpt', sourceKind: 'attachment',
      sourceTitle: 'NVDA Investor Deck.pdf', sourceUrl: null, pageNumber: 17,
      text: 'Management expects gross margins to normalize lower',
      annotation: null, alreadyAttached: false,
    }] }
    excerptsResult = {
      excerpts: [{
        id: 'ex1', documentName: 'NVDA Investor Deck.pdf', pageNumber: 17,
        capturedText: 'Management expects gross margins to normalize lower',
      }],
    }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
    expect(screen.getByText(/NVDA Investor Deck\.pdf · p\.17/)).toBeTruthy()
    expect(screen.getByText(/Management expects gross margins/)).toBeTruthy()
  })

  it('shows an honest empty state when the note has no saved excerpts yet', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
    // ⚰️ The copy widened in Wave N: a captured web passage is now an equally
    // valid source of evidence, so "save an excerpt from a PDF" was no longer
    // the whole truth about what the member can do here.
    expect(screen.getByText(/Capture a passage from the web, or save an excerpt/)).toBeTruthy()
  })

  it('adding document_excerpt evidence posts the right targetType/targetId', async () => {
    // ⭐ §35 CONTROL: a real PDF excerpt must still be selectable, keep its REAL
    // page number, and post the same targetType/targetId as before Wave N.
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [{
      id: 'ex1', evidenceType: 'document_excerpt', sourceKind: 'attachment',
      sourceTitle: 'Deck.pdf', sourceUrl: null, pageNumber: 17,
      text: 'margin commentary', annotation: null, alreadyAttached: false,
    }] }
    excerptsResult = {
      excerpts: [{ id: 'ex1', documentName: 'Deck.pdf', pageNumber: 17, capturedText: 'margin commentary' }],
    }
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/evidence') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ evidence: { id: 'e1' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    const refresh = vi.fn()
    summaryResult = { evidence: [], changelog: [], isLoading: false, refresh }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
    fireEvent.click(screen.getByText(/Deck\.pdf · p\.17/))
    fireEvent.click(screen.getByText('Opposes'))
    fireEvent.click(screen.getByText('Add evidence'))
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
    expect(JSON.parse(postCall[1].body)).toMatchObject({
      targetType: 'document_excerpt', targetId: 'ex1', stance: 'opposes',
    })
  })

  it('a document_excerpt evidence row shows its citation and calls onOpenExcerptSource on click', () => {
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'document_excerpt', targetId: 'ex1', stance: 'opposes', caption: null, removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    excerptsResult = {
      excerpts: [{ id: 'ex1', documentName: 'Deck.pdf', pageNumber: 17, capturedText: 'x' }],
    }
    const onOpenExcerptSource = vi.fn()
    renderIt(PLAIN_NOTE, { onOpenExcerptSource })
    expect(screen.getByText(/Deck\.pdf · p\.17/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Deck\.pdf · p\.17/))
    expect(onOpenExcerptSource).toHaveBeenCalledWith('ex1')
  })

  it('shows the caption AND the citation when both exist — the reason never replaces the source', () => {
    // ⛔ This used to assert the caption WON, hiding the citation. Found in a
    // live pass: a thesis with several captioned excerpts then read as a list
    // of sentences with no sources at all -- page-aware citation is the whole
    // point of the wave, and it must not vanish the moment a member explains
    // why a passage matters. The two answer different questions (see
    // ExcerptEvidenceRow) and both are shown, caption first.
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'document_excerpt', targetId: 'ex1', stance: 'opposes', caption: 'Directly weakens my margin thesis', removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    excerptsResult = { excerpts: [{ id: 'ex1', documentName: 'Deck.pdf', pageNumber: 17, capturedText: 'x' }] }
    renderIt(PLAIN_NOTE)
    const row = screen.getByRole('button', { name: /Directly weakens my margin thesis/ })
    expect(row.textContent).toContain('Directly weakens my margin thesis')
    expect(row.textContent).toContain('Deck.pdf · p.17')
  })

  it('a document_excerpt evidence row still opens even when the excerpt is not among this note\'s own excerpts (captured elsewhere)', () => {
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'document_excerpt', targetId: 'ex-from-elsewhere', stance: 'supports', caption: null, removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    excerptsResult = { excerpts: [] } // not locally resolvable
    const onOpenExcerptSource = vi.fn()
    renderIt(PLAIN_NOTE, { onOpenExcerptSource })
    // ⚰️ The fallback label changed in Wave N: "Document excerpt" was a lie for
    // a captured web passage, which reaches this same branch. The INTENT of
    // this test is the OPEN behaviour for a target this note cannot resolve
    // locally, and that is unchanged.
    expect(screen.getByText('Saved evidence')).toBeTruthy() // source-neutral fallback
    fireEvent.click(screen.getByText('Saved evidence'))
    expect(onOpenExcerptSource).toHaveBeenCalledWith('ex-from-elsewhere')
  })
})

describe('⛔⛔ Wave N — a CAPTURED WEB PASSAGE is attachable evidence', () => {
  // ⚰️ THE GAP. The picker listed `useNoteExcerpts`, which joins the body-refs
  // sidecar rebuilt from `documentExcerpt` nodes in the note's prose. A capture
  // never embeds one, so a member who clipped a passage from Reuters could
  // never attach it — while the evidence API accepted it perfectly.
  // BUILT + GREEN + MEMBER-UNREACHABLE.
  const webCandidate = {
    id: 'cap1', evidenceType: 'document_excerpt', sourceKind: 'web',
    sourceTitle: 'Reuters: NVDA margins',
    sourceUrl: 'https://www.reuters.com/markets/nvda',
    pageNumber: null,
    text: 'Gross margin normalizes toward the mid-70s next year.',
    annotation: 'I think that is optimistic given HBM pricing.',
    alreadyAttached: false,
  }

  const openExcerptPicker = () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
  }

  it('the captured passage is OFFERED', () => {
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [webCandidate] }
    openExcerptPicker()
    expect(screen.getByText(/Captured passage/)).toBeTruthy()
    expect(screen.getByText(/reuters\.com/)).toBeTruthy()
  })

  it('⛔ and it is NOT labelled with a page number', () => {
    // Wave M banned rendering a capture ordinal as a page. The picker was the
    // one surface that still formatted `· p.${pageNumber}` itself.
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [webCandidate] }
    openExcerptPicker()
    expect(screen.queryByText(/p\.\d/)).toBeNull()
  })

  it('⛔ SOURCE and YOUR NOTE are shown as two separate things', () => {
    // §19: source claim ≠ member belief ≠ evidence stance. If the picker
    // concatenated them, a member could attach their own opinion to a thesis
    // as though a publisher had said it.
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [webCandidate] }
    openExcerptPicker()
    expect(screen.getByText(/Gross margin normalizes/)).toBeTruthy()
    expect(screen.getByText(/Your note: I think that is optimistic/)).toBeTruthy()
  })

  it('an already-attached candidate says so and cannot be picked again', () => {
    candidatesResult = {
      isLoading: false, refresh: vi.fn(),
      candidates: [{ ...webCandidate, alreadyAttached: true }],
    }
    openExcerptPicker()
    expect(screen.getByText(/already attached/)).toBeTruthy()
    expect(screen.getByText(/Captured passage/).closest('button').disabled).toBe(true)
  })

  it('⭐ CONTROL: a real PDF candidate still shows its real page', () => {
    candidatesResult = {
      isLoading: false, refresh: vi.fn(),
      candidates: [{ ...webCandidate, id: 'ex9', sourceKind: 'attachment',
                     sourceTitle: 'NVDA 10-Q', sourceUrl: null, pageNumber: 47 }],
    }
    openExcerptPicker()
    expect(screen.getByText(/NVDA 10-Q · p\.47/)).toBeTruthy()
  })
})

describe('⛔ Wave N §1 — an ATTACHED web capture is labelled truthfully in the thesis', () => {
  // ⚰️ The attached-evidence row was a FOURTH formatter spelling
  // `${documentName} · p.${pageNumber}`, and it renders inside the THESIS —
  // the most consequential surface. It also fell through to the literal string
  // "Document excerpt" for a capture, because `localExcerpt` comes from the
  // body-refs sidecar a capture is never in. Calling a Reuters clipping a
  // "Document excerpt" is the same category error in words instead of numbers.
  const attached = {
    id: 'e1', targetType: 'document_excerpt', targetId: 'cap1',
    stance: 'opposes', caption: null, removedAt: null,
  }
  const webCandidate = {
    id: 'cap1', evidenceType: 'document_excerpt', sourceKind: 'web',
    sourceTitle: 'Reuters: NVDA margins',
    sourceUrl: 'https://www.reuters.com/markets/nvda',
    pageNumber: null, text: 'Gross margin normalizes toward the mid-70s.',
    annotation: 'I think management is too optimistic.', alreadyAttached: true,
  }

  it('shows what it actually is, with no page and no "Document excerpt"', () => {
    summaryResult = { evidence: [attached], changelog: [], isLoading: false, refresh: vi.fn() }
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [webCandidate] }
    renderIt(PLAIN_NOTE)
    expect(screen.getByText(/Captured passage/)).toBeTruthy()
    expect(screen.queryByText(/p\.\d/)).toBeNull()
    expect(screen.queryByText(/^Document excerpt$/)).toBeNull()
  })

  it('⭐ CONTROL: an attached PDF excerpt still shows its real page', () => {
    summaryResult = {
      evidence: [{ ...attached, targetId: 'ex9', stance: 'supports' }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    candidatesResult = { isLoading: false, refresh: vi.fn(), candidates: [] }
    excerptsResult = {
      excerpts: [{ id: 'ex9', documentName: 'NVDA 10-Q', pageNumber: 47, capturedText: 'x' }],
    }
    renderIt(PLAIN_NOTE)
    expect(screen.getByText(/NVDA 10-Q · p\.47/)).toBeTruthy()
  })

  describe('§10 — a source that no longer exists', () => {
    // ⛔⛔ GHOST EVIDENCE. Purging the note a passage lived in hard-deletes
    // the excerpt; the edge survives deliberately (db.py's cascade comment
    // says it must "degrade via the same 'no longer available' pattern
    // FinancialFactView already established"). It never did: the row showed
    // its caption as if nothing had happened, and clicking it hit a 404 and
    // silently did nothing.
    const gone = {
      id: 'e-gone', targetType: 'document_excerpt', targetId: 'ex-purged',
      stance: 'opposes', caption: 'cuts against the long case',
      targetAvailable: false,
    }

    it('says the source is gone, in words', () => {
      summaryResult = { evidence: [gone], changelog: [], isLoading: false, refresh: vi.fn() }
      renderIt(PLAIN_NOTE)
      expect(screen.getByText(/no longer available/i)).toBeTruthy()
    })

    it("⛔ keeps the member's own reasoning — it is still their judgement", () => {
      summaryResult = { evidence: [gone], changelog: [], isLoading: false, refresh: vi.fn() }
      renderIt(PLAIN_NOTE)
      expect(screen.getByText(/cuts against the long case/)).toBeTruthy()
    })

    it('⛔ is NOT a button, so a dead click is impossible', () => {
      summaryResult = { evidence: [gone], changelog: [], isLoading: false, refresh: vi.fn() }
      const onOpenExcerptSource = vi.fn()
      renderIt(PLAIN_NOTE, { onOpenExcerptSource })
      const buttons = screen.queryAllByRole('button')
        .filter((b) => /cuts against the long case/.test(b.textContent))
      expect(buttons).toHaveLength(0)
      expect(onOpenExcerptSource).not.toHaveBeenCalled()
    })

    it('⭐ and an excerpt in ANOTHER note is still live and clickable', () => {
      // THE CONTROL. From this note, an excerpt captured elsewhere is equally
      // unresolvable locally — the difference is the server's answer, not the
      // client's ability to find a label.
      const elsewhere = {
        id: 'e-else', targetType: 'document_excerpt', targetId: 'ex-elsewhere',
        stance: 'supports', caption: 'from my other research',
        targetAvailable: true,
      }
      summaryResult = { evidence: [elsewhere], changelog: [], isLoading: false, refresh: vi.fn() }
      const onOpenExcerptSource = vi.fn()
      renderIt(PLAIN_NOTE, { onOpenExcerptSource })
      fireEvent.click(screen.getByText(/from my other research/))
      expect(onOpenExcerptSource).toHaveBeenCalledWith('ex-elsewhere')
      expect(screen.queryByText(/no longer available/i)).toBeNull()
    })

    it('⛔ an OLD payload without the field is treated as available', () => {
      // Back-compat: a cached bundle predating the field must not paint every
      // healthy row as a tombstone. Only an explicit `false` degrades.
      const legacy = { ...gone, targetAvailable: undefined }
      summaryResult = { evidence: [legacy], changelog: [], isLoading: false, refresh: vi.fn() }
      renderIt(PLAIN_NOTE)
      expect(screen.queryByText(/no longer available/i)).toBeNull()
    })
  })

  describe('§12 — a picker that shows 50 of 120', () => {
    // ⛔⛔ The endpoint is correctly bounded and fast (~12ms p50 against a
    // 240-capture corpus). The defect was REACHABILITY: a member with more
    // than fifty saved passages in one note could not get to the rest, and
    // nothing on screen said so. The endpoint has taken `q` since step 1 —
    // the picker never offered it.
    const many = (n, from = 0) => Array.from({ length: n }, (_, i) => ({
      id: `c${from + i}`, sourceKind: 'web', sourceTitle: `Reuters ${from + i}`,
      sourceUrl: 'https://www.reuters.com/x', pageNumber: null,
      text: `passage ${from + i}`, annotation: null, alreadyAttached: false,
    }))

    function openExcerptPicker() {
      renderIt(THESIS_NOTE_BY_TAG)
      fireEvent.click(screen.getByText('Add evidence'))
      fireEvent.click(screen.getByText('Document excerpt'))
    }

    it('a short list offers no search and claims no cap', () => {
      candidatesResult = { candidates: many(3), isLoading: false, refresh: vi.fn() }
      openExcerptPicker()
      expect(screen.queryByLabelText(/Search your captured passages/i)).toBeNull()
      expect(screen.queryByText(/most recent/i)).toBeNull()
    })

    it('⛔ a FULL page says so, and offers the way to narrow it', () => {
      candidatesResult = { candidates: many(50), isLoading: false, refresh: vi.fn() }
      openExcerptPicker()
      expect(screen.getByLabelText(/Search your captured passages/i)).toBeTruthy()
      expect(screen.getByText(/Showing your 50 most recent/i)).toBeTruthy()
    })

    it('typing asks the SERVER, rather than filtering fifty rows on the client', () => {
      candidatesResult = { candidates: many(50), isLoading: false, refresh: vi.fn() }
      openExcerptPicker()
      useEvidenceCandidatesSpy.mockClear()
      fireEvent.change(screen.getByLabelText(/Search your captured passages/i),
                       { target: { value: 'margins' } })
      const withQuery = useEvidenceCandidatesSpy.mock.calls
        .filter(([, opts]) => opts && opts.q === 'margins')
      expect(withQuery.length).toBeGreaterThan(0)
    })

    it('⭐ and the UNFILTERED read survives, because it labels the attached rows', () => {
      // THE CONTROL. If searching narrowed the one read, an attached row's
      // citation would vanish the moment the member typed.
      candidatesResult = { candidates: many(50), isLoading: false, refresh: vi.fn() }
      openExcerptPicker()
      useEvidenceCandidatesSpy.mockClear()
      fireEvent.change(screen.getByLabelText(/Search your captured passages/i),
                       { target: { value: 'margins' } })
      const unfiltered = useEvidenceCandidatesSpy.mock.calls
        .filter(([, opts]) => !opts || !opts.q)
      expect(unfiltered.length).toBeGreaterThan(0)
    })

    it('an empty RESULT is not the same sentence as an empty NOTE', () => {
      candidatesResult = { candidates: [], isLoading: false, refresh: vi.fn() }
      renderIt(THESIS_NOTE_BY_TAG)
      fireEvent.click(screen.getByText('Add evidence'))
      fireEvent.click(screen.getByText('Document excerpt'))
      expect(screen.getByText(/Capture a passage from the web/i)).toBeTruthy()
    })
  })
})
