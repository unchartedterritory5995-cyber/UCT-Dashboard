import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../lib/followupCreate', async (importOriginal) => ({ ...(await importOriginal()), createFollowupNote: vi.fn() }))
import { createFollowupNote } from '../../lib/followupCreate'
import FollowupOffer, { FAILED_SENTENCE } from './FollowupOffer'

const params = new URLSearchParams('followup=ORCL&reportDate=2026-10-14')

describe('FollowupOffer', () => {
  beforeEach(() => { createFollowupNote.mockReset() })
  it('names the report and makes the note only on the press', async () => {
    createFollowupNote.mockResolvedValue({ id: 'n7' })
    const onCreated = vi.fn()
    render(<FollowupOffer open searchParams={params} onCreated={onCreated} onDismiss={() => {}} />)
    expect(screen.getByRole('region', { name: 'Earnings follow-up' })).toBeTruthy()
    expect(screen.getByText("ORCL reported on Oct 14, 2026. Write what you expected, what happened, and what you'll do differently.")).toBeTruthy()
    expect(createFollowupNote).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))   // a second press while busy
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'n7' }))
    expect(createFollowupNote).toHaveBeenCalledTimes(1)
  })
  it('hands the folder to the create', async () => {
    createFollowupNote.mockResolvedValue({ id: 'n7' })
    render(<FollowupOffer open searchParams={params} folderId="f1" onCreated={() => {}} onDismiss={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(createFollowupNote).toHaveBeenCalledWith({ symbol: 'ORCL', reportDate: '2026-10-14', folderId: 'f1' }))
  })
  it('a failed create says so in words and makes nothing', async () => {
    createFollowupNote.mockRejectedValue(Object.assign(new Error('x'), { status: 500, detail: 'Traceback' }))
    render(<FollowupOffer open searchParams={params} onCreated={() => {}} onDismiss={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_SENTENCE)
    expect(screen.queryByText(/Traceback/)).toBeNull()
  })
  it('after a failure the member can press again', async () => {
    createFollowupNote.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ id: 'n9' })
    const onCreated = vi.fn()
    render(<FollowupOffer open searchParams={params} onCreated={onCreated} onDismiss={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'n9' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('Not now puts focus back on what had it before the card appeared, not on the body', () => {
    const before = document.createElement('button')
    before.textContent = 'a notice link'
    document.body.appendChild(before)
    before.focus()
    render(<FollowupOffer open searchParams={params} onCreated={() => {}} onDismiss={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(document.activeElement).toBe(before)
    before.remove()
  })
  it('Not now, when that element is gone, lands on the Notebook pane heading', () => {
    const pane = document.createElement('div')
    pane.id = 'notebook-pane'
    pane.innerHTML = '<h2 tabindex="-1">Research home</h2>'
    document.body.appendChild(pane)
    const gone = document.createElement('button')
    document.body.appendChild(gone)
    gone.focus()
    render(<FollowupOffer open searchParams={params} onCreated={() => {}} onDismiss={() => {}} />)
    gone.remove()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(document.activeElement).toBe(pane.querySelector('h2'))
    expect(document.activeElement).not.toBe(document.body)
    pane.remove()
  })
  it('Not now leaves without a note; a closed or bad link renders nothing', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<FollowupOffer open searchParams={params} onCreated={() => {}} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDismiss).toHaveBeenCalled()
    expect(createFollowupNote).not.toHaveBeenCalled()
    unmount()
    const { container } = render(<FollowupOffer open searchParams={new URLSearchParams('followup=ORCL')} />)
    expect(container.innerHTML).toBe('')
    const { container: c2 } = render(<FollowupOffer open={false} searchParams={params} />)
    expect(c2.innerHTML).toBe('')
  })
})
