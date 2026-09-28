// app/src/pages/journal-2-0/a11y/silentFailures.test.jsx
//
// ⛔⛔ Wave 10 follow-up F7, Part A (clause 5d): every failure a member can see is said.
//
// The proof walk of 26e03bbe8 forced each Notebook endpoint to fail and found two WRITES that a
// member believes saved with nothing on screen to say otherwise -- the tag write (its sentence
// faded after 2.4 s, gone by the time the walk looked, at 6 s) and the favorite write (the star
// was put back without a word) -- and panels that rendered EMPTY when their read failed. These
// rails render the REAL NoteEditorPage and the REAL FolderSidebar with only the network faked
// (fixtures.jsx), fail one request, and assert the sentence a member reads.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers, NOTES, noteDetail } from './fixtures'
import NoteEditorPage, { NoteLinkedTradeChips } from '../components/notebook/NoteEditorPage'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NoteBacklinksSection from '../components/notebook/NoteBacklinksSection'
import NoteGraphView from '../components/notebook/NoteGraphView'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const FAIL = [500, { detail: 'zqproofraw forced failure' }]

async function renderEditor() {
  render(
    <Providers route="/journal/notebook?note=n1">
      <NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} />
    </Providers>,
  )
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
  await settle()
}

beforeEach(() => { latchWave8Flags(true) })

describe('a failed WRITE is said, and stays said', () => {
  it('favorite: the star goes back AND a sentence says the note was not added', async () => {
    installFetch([[/^\/api\/j2\/notes\/[^/]+\/favorite$/, FAIL]])
    await renderEditor()
    const star = screen.getByRole('button', { name: 'Add to Favorites' })
    fireEvent.click(star)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't add this note to Favorites. Nothing changed.")
    expect(screen.getByRole('button', { name: 'Add to Favorites' })).toHaveAttribute('aria-pressed', 'false')
    // it outlives the old 2.4 s chrome message -- the proof walk read the page at 6 s
    await act(async () => { await new Promise((r) => setTimeout(r, 3000)) })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't add this note to Favorites.")
    // and never shows the server's raw text
    expect(document.body.textContent).not.toContain('zqproofraw')
  }, 15_000)

  it('add-tag: a sentence says the tag was not added, and the typed tag is given back', async () => {
    installFetch([[/^\/api\/j2\/notes\/[^/]+\/tags$/, FAIL]])
    await renderEditor()
    const box = screen.getByLabelText('Add a tag to this note')
    fireEvent.change(box, { target: { value: 'prooftag' } })
    fireEvent.submit(box.closest('form'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't add that tag. Nothing changed.")
    await waitFor(() => expect(screen.getByLabelText('Add a tag to this note')).toHaveValue('prooftag'))
    await act(async () => { await new Promise((r) => setTimeout(r, 3000)) })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't add that tag.")
    expect(document.body.textContent).not.toContain('zqproofraw')
  }, 15_000)
})

describe('a failed READ is said where its data would have shown', () => {
  it('a note side read (attachments) -> one sentence in the note, with Try again', async () => {
    installFetch([[/^\/api\/j2\/notes\/[^/]+\/documents$/, FAIL]])
    await renderEditor()
    const status = await screen.findByText("Couldn't load this note's attachments.")
    expect(within(status.closest('[role="status"]')).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('the folders panel: a failed folder read is not "you have no folders"', async () => {
    installFetch([[/^\/api\/j2\/note-folders$/, FAIL]])
    render(
      <Providers>
        <FolderSidebar notes={NOTES} notesTotal={NOTES.length} activeFolderId={null}
          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />
      </Providers>,
    )
    expect(await screen.findByText("Couldn't load your folders.")).toBeInTheDocument()
  })
})

// ⛔ Five fetchers used to ANSWER a failed status with an empty payload (`{ links: [] }`,
// `{ count: 0, notes: [] }`, an empty graph, `null`), so no consumer could ever see an error:
// a 500 read as "nothing links here". The consumer-level rails above mock nothing but the
// network, and so do these -- each renders the real component over its real hook, fails the
// one request, and asserts the sentence. (Mutation run of F7: turning the backlinks fetcher
// back into `{ count: 0, notes: [] }` on a non-OK status left every other rail green.)
describe('a failed read is an ERROR, never an empty answer (the five fetchers that swallowed it)', () => {
  const renderIn = (ui) => render(<Providers>{ui}</Providers>)

  it('backlinks: "Couldn\'t load the notes that link here." and Try again asks again', async () => {
    let fail = true
    const spy = installFetch()
    // a status per call: 500 first, then the fixture's healthy answer
    const healthy = { count: 1, notes: [{ id: 'n2', title: 'Weekly plan', context: 'see the plan', refs: 1 }] }
    spy.mockImplementation((input) => {
      const path = String(typeof input === 'string' ? input : input?.url || '').split('?')[0]
      const bl = /\/backlinks$/.test(path)
      const status = bl && fail ? 500 : 200
      const body = bl ? healthy : (/\/related-from$/.test(path) ? { count: 0, notes: [] } : {})
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => null }, json: () => Promise.resolve(body) })
    })
    renderIn(<NoteBacklinksSection noteId="n1" />)
    const status = await screen.findByText("Couldn't load the notes that link here.")
    fail = false
    fireEvent.click(within(status.closest('[role="status"]')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load the notes that link here.")).toBeNull())
    expect(await screen.findByText(/Linked from/)).toBeInTheDocument()
  })

  it('related-from: "Couldn\'t load the notes related to this one."', async () => {
    installFetch([
      [/^\/api\/j2\/notes\/[^/]+\/related-from$/, FAIL],
      [/^\/api\/j2\/notes\/[^/]+\/backlinks$/, { count: 0, notes: [] }],
    ])
    renderIn(<NoteBacklinksSection noteId="n1" />)
    expect(await screen.findByText("Couldn't load the notes related to this one.")).toBeInTheDocument()
  })

  it('trade-ref/resolve: "Couldn\'t load this note\'s linked trades."', async () => {
    installFetch([[/^\/api\/j2\/notes\/[^/]+\/trade-ref\/resolve$/, FAIL]])
    renderIn(<NoteLinkedTradeChips noteId="n1" />)
    expect(await screen.findByText("Couldn't load this note's linked trades.")).toBeInTheDocument()
  })

  it('CONTROL: a healthy empty answer is still nothing at all (no sentence stands in for "none")', async () => {
    installFetch([
      [/^\/api\/j2\/notes\/[^/]+\/trade-ref\/resolve$/, { links: [] }],
      [/^\/api\/j2\/notes\/[^/]+\/backlinks$/, { count: 0, notes: [] }],
      [/^\/api\/j2\/notes\/[^/]+\/related-from$/, { count: 0, notes: [] }],
    ])
    const { container } = renderIn(<><NoteLinkedTradeChips noteId="n1" /><NoteBacklinksSection noteId="n1" /></>)
    await settle(60)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).not.toMatch(/Couldn't/)
  })

  it('the note graph: "Couldn\'t load your note graph.", never "No notes yet"', async () => {
    installFetch([[/^\/api\/j2\/notes\/graph$/, FAIL]])
    renderIn(<NoteGraphView onOpenNote={() => {}} />)
    expect(await screen.findByText("Couldn't load your note graph.")).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/No notes yet/i)
  })
})

// ⛔ F7 fix round 1 (review I2): each write path has its OWN sentence. One shared slot let a
// successful favorite toggle erase an unresolved "Couldn't add that tag" while the field still
// held the unsaved tag -- the only signal that nothing changed, gone. Both directions railed.
describe("one write's success never erases the other write's failure", () => {
  const TAG_SENTENCE = "Couldn't add that tag. Nothing changed."
  const FAV_SENTENCE = "Couldn't add this note to Favorites. Nothing changed."
  const alertTexts = () => screen.queryAllByRole('alert').map((a) => a.textContent)

  it('a failed tag add, then a SUCCESSFUL favorite toggle: the tag sentence and the typed tag stay', async () => {
    installFetch([[/^\/api\/j2\/notes\/[^/]+\/tags$/, FAIL]])
    await renderEditor()
    const box = screen.getByLabelText('Add a tag to this note')
    fireEvent.change(box, { target: { value: 'prooftag' } })
    fireEvent.submit(box.closest('form'))
    await waitFor(() => expect(alertTexts().join('|')).toContain(TAG_SENTENCE))
    await waitFor(() => expect(screen.getByLabelText('Add a tag to this note')).toHaveValue('prooftag'))
    // the favorite write LANDS
    fireEvent.click(screen.getByRole('button', { name: 'Add to Favorites' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from Favorites' }))
      .toHaveAttribute('aria-pressed', 'true'))
    await settle(60)
    expect(alertTexts().join('|')).toContain(TAG_SENTENCE)
    expect(screen.getByLabelText('Add a tag to this note')).toHaveValue('prooftag')
  }, 15_000)

  it('the reverse: a failed favorite, then a SUCCESSFUL tag add: the favorite sentence stays', async () => {
    installFetch([
      [/^\/api\/j2\/notes\/[^/]+\/favorite$/, FAIL],
      // the tag write's real answer shape: the server's note, carrying the new tag
      [/^\/api\/j2\/notes\/[^/]+\/tags$/, { changed: false, note: noteDetail({ tags: ['semis', 'goodtag'] }) }],
    ])
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Favorites' }))
    await waitFor(() => expect(alertTexts().join('|')).toContain(FAV_SENTENCE))
    // the tag write LANDS
    const box = screen.getByLabelText('Add a tag to this note')
    fireEvent.change(box, { target: { value: 'goodtag' } })
    fireEvent.submit(box.closest('form'))
    const tagPatches = () => global.fetch.mock.calls
      .filter(([u, init = {}]) => /\/tags$/.test(String(u)) && String(init.method || '').toUpperCase() === 'PATCH')
    await waitFor(() => expect(tagPatches().length).toBe(1))
    await settle(60)
    expect(screen.getByPlaceholderText('Title')).toBeInTheDocument() // the note is still on screen
    expect(alertTexts().join('|')).not.toContain(TAG_SENTENCE)
    expect(alertTexts().join('|')).toContain(FAV_SENTENCE)
  }, 15_000)

  it('both can show at once, each with its own Dismiss', async () => {
    installFetch([[/^\/api\/j2\/notes\/[^/]+\/tags$/, FAIL], [/^\/api\/j2\/notes\/[^/]+\/favorite$/, FAIL]])
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Favorites' }))
    await waitFor(() => expect(alertTexts().join('|')).toContain(FAV_SENTENCE))
    const box = screen.getByLabelText('Add a tag to this note')
    fireEvent.change(box, { target: { value: 'prooftag' } })
    fireEvent.submit(box.closest('form'))
    await waitFor(() => expect(alertTexts().join('|')).toContain(TAG_SENTENCE))
    expect(alertTexts().join('|')).toContain(FAV_SENTENCE)
    // dismissing one leaves the other
    const tagAlert = screen.getAllByRole('alert').find((a) => a.textContent.includes(TAG_SENTENCE))
    fireEvent.click(within(tagAlert).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(alertTexts().join('|')).not.toContain(TAG_SENTENCE))
    expect(alertTexts().join('|')).toContain(FAV_SENTENCE)
  }, 15_000)
})

