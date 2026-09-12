/**
 * ⛔⛔ THE REAL COMPONENT, NOT A MODEL.
 *
 * The property rail proves the MECHANISM: a door that records its landed
 * revision does not fork the member's note. It cannot prove this component
 * calls it. That gap is exactly how `hero` hid for the whole of Wave Q1 — the
 * door list was derived from what the canary drove, and no canary ever drove a
 * hero upload, so every rail stayed green while the door stayed silent.
 *
 * ⭐ These drive the REAL `HeroImagePicker` through the REAL file input and the
 * REAL remove button, with `fetch` stubbed at the network edge only.
 *
 * ⚰️ AND THEY USED TO ASSERT THE WRONG THING. The first version spied on
 * `settleNoteWrite` and asserted the ARGUMENT it was handed — so the rail was
 * really a test of how this component extracts a note from a response, and it
 * went red the day that extraction moved INTO the helper (where it belongs,
 * because `.json().catch()` does not catch a missing `json`). A rail that
 * breaks when a correct refactor lands was measuring the wrong layer.
 *
 * ⭐ So the REAL `settleNoteWrite` runs, and the stub sits at the BOTTOM of the
 * stack: `recordLandedRevision`, the one call that puts a revision in the ring.
 * The assertion is the product property — THIS REVISION LANDED — and it holds
 * whether the door hands over a Response, a `{note}` envelope, or a note.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import HeroImagePicker from './HeroImagePicker'
import { setCurrentAccountId } from '../../lib/offline/currentAccount'
import { recordLandedRevision } from '../../lib/offline/useDurableNote'

vi.mock('../../lib/offline/useDurableNote', () => ({
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

const T1 = '2026-09-12T14:00:00.000000+00:00'
const NOTE = { id: 'n1', updatedAt: T1, heroImageUrl: '/i/1.png' }

/** Every revision this browser recorded, in order. */
const landed = () => recordLandedRevision.mock.calls.map(([a]) => a.updatedAt)

beforeEach(() => {
  vi.clearAllMocks()
  setCurrentAccountId('acct-A')
})
afterEach(() => { vi.unstubAllGlobals(); setCurrentAccountId(null) })

const pngFile = () => new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' })

describe('⛔⛔ HeroImagePicker LANDS ITS REVISION — both doors, real component', () => {
  it('SET: uploading a hero records the revision the server returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ heroImageUrl: '/i/1.png', note: NOTE }),
    })))
    const onChange = vi.fn()
    const { container } = render(<HeroImagePicker noteId="n1" value={null} onChange={onChange} />)
    const input = container.querySelector('input[type="file"]')
    expect(input, 'the file input the member actually uses').toBeTruthy()
    fireEvent.change(input, { target: { files: [pngFile()] } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/i/1.png'))
    await waitFor(() => expect(landed(), '⛔ the SET door did not land its revision').toEqual([T1]))
    expect(recordLandedRevision.mock.calls[0][0].noteId).toBe('n1')
  })

  it('REMOVE: clearing a hero records the revision too — it is an update_note, not a delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, note: { ...NOTE, heroImageUrl: null } }),
    })))
    const onChange = vi.fn()
    render(<HeroImagePicker noteId="n1" value="/i/1.png" onChange={onChange} />)
    fireEvent.click(screen.getByTitle('Remove'))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
    await waitFor(() => expect(landed(), '⛔ the REMOVE door did not land its revision').toEqual([T1]))
  })

  it('⭐ CONTROL — a FAILED upload lands nothing: there is no revision to land', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({ detail: 'boom' }),
    })))
    const { container } = render(<HeroImagePicker noteId="n1" value={null} onChange={vi.fn()} />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [pngFile()] } })

    await waitFor(() => expect(screen.getByText(/Couldn't upload/i)).toBeInTheDocument())
    expect(landed(), 'a failed write must not land a revision').toEqual([])
  })

  it('⭐ CONTROL — a rejected file never reaches the network, so nothing lands', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { container } = render(<HeroImagePicker noteId="n1" value={null} onChange={vi.fn()} />)
    const tooBig = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [tooBig] } })

    await waitFor(() => expect(screen.getByText(/< 5 MB/i)).toBeInTheDocument())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(landed()).toEqual([])
  })

  it('⛔ CONTROL — signed out, the door lands NOTHING rather than writing to the wrong store', async () => {
    // ⛔ The registry is the only thing that says which member's database this
    // is. Empty means no store may be opened at all — a revision recorded under
    // the previous member's account is worse than one not recorded.
    setCurrentAccountId(null)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ heroImageUrl: '/i/1.png', note: NOTE }),
    })))
    const onChange = vi.fn()
    const { container } = render(<HeroImagePicker noteId="n1" value={null} onChange={onChange} />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [pngFile()] } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/i/1.png'))
    expect(landed(), 'no account ⇒ no write').toEqual([])
  })
})
