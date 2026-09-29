/**
 * TERM-077 / FB-A12-03 — the member CHOOSES copy or link at import, and the
 * list says honestly what it is afterwards.
 *
 * ⛔ The dialog must not preselect a mode: a guessed default is wrong half the
 * time and silently so. Save stays disabled until the member picks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SaveListDialog, { ListOrigin } from './SaveListDialog'
import { originLine, isLinkedList } from './watchlistOrigin'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const SOURCE = { id: 'src1', name: 'Russell Leaders', items: [{ sym: 'NVDA' }] }

describe('SaveListDialog — the choice is asked, never guessed', () => {
  it('opens with NEITHER mode selected and Save disabled', () => {
    render(<SaveListDialog source={SOURCE} onClose={() => {}} onSaved={() => {}} />)
    const copy = screen.getByRole('radio', { name: /copy/i })
    const link = screen.getByRole('radio', { name: /link/i })
    expect(copy.checked).toBe(false)
    expect(link.checked).toBe(false)
    expect(screen.getByRole('button', { name: /^save$/i }).disabled).toBe(true)
  })

  it.each([['copy'], ['link']])('posts exactly the chosen mode (%s)', async (mode) => {
    const saved = { id: 'new1', name: 'Russell Leaders', items: [], origin: { mode } }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => saved })
    const onSaved = vi.fn()
    render(<SaveListDialog source={SOURCE} onClose={() => {}} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(mode, 'i') }))
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/watchlists/src1/save-as')
    expect(JSON.parse(init.body).mode).toBe(mode)
  })

  it('shows the server refusal instead of pretending it saved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'mode must be chosen' }) })
    const onSaved = vi.fn()
    render(<SaveListDialog source={SOURCE} onClose={() => {}} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('radio', { name: /copy/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('mode must be chosen')
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('originLine — provenance and staleness said in words', () => {
  const at = '2026-09-01T14:00:00+00:00'
  it('a copy names its source and says it is independent', () => {
    const t = originLine({ mode: 'copy', source_name: 'Leaders', created_at: at, synced_at: at, state: 'independent' }).text
    expect(t).toMatch(/copied from Leaders/i)
    expect(t).toMatch(/snapshot/i)
  })
  it('a current link says it follows the source', () => {
    const l = originLine({ mode: 'link', source_name: 'Leaders', created_at: at, synced_at: at, state: 'current' })
    expect(l.text).toMatch(/linked to Leaders/i)
    expect(l.text).toMatch(/follows the source/i)
    expect(l.stale).toBe(false)
  })
  it('an unavailable source is reported as stale, with the as-of time', () => {
    const l = originLine({ mode: 'link', source_name: 'Leaders', created_at: at, synced_at: at, state: 'source_unavailable' })
    expect(l.text).toMatch(/source unavailable/i)
    expect(l.text).toMatch(/as of/i)
    expect(l.stale).toBe(true)
  })
  it('a paused link says it is not following, and is still a LINK', () => {
    const l = originLine({ mode: 'link', source_name: 'Leaders', created_at: at, synced_at: at, state: 'paused_edited' })
    expect(l.text).toMatch(/linked to Leaders/i)
    expect(l.text).toMatch(/not following/i)
    expect(l.stale).toBe(true)
  })
  it('no origin renders nothing, so an ordinary list is unchanged', () => {
    expect(originLine(undefined)).toBeNull()
    const { container } = render(<ListOrigin origin={undefined} />)
    expect(container.innerHTML).toBe('')
  })
  it('isLinkedList is true only for a link', () => {
    expect(isLinkedList({ origin: { mode: 'link' } })).toBe(true)
    expect(isLinkedList({ origin: { mode: 'copy' } })).toBe(false)
    expect(isLinkedList({})).toBe(false)
    expect(isLinkedList(undefined)).toBe(false)
  })
})
