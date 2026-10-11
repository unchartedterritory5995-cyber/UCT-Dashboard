import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import AgentHistory from './AgentHistory'

// History panel: grouped list (pinned first), rename in place, delete asks in place first,
// and a search hit opens its chat AT that message.
const now = Math.floor(Date.now() / 1000)
const convs = [
  { id: 'a', title: 'Pinned chat', updated_at: now - 86400 * 40, pinned_at: now },
  { id: 'b', title: 'Today chat', updated_at: now },
]
let calls
beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push([init?.method || 'GET', url, init?.body ? JSON.parse(init.body) : null])
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/agent/search')) return json({ results: [{ id: 7, conversation_id: 'b', title: 'Today chat', role: 'member', text: 'why is NVDA up', created_at: now }] })
    return json({ conversation: {}, deleted: 'b' })
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const view = (props = {}) => render(<AgentHistory conversations={convs} loading={false} currentId="b" member={{ id: null, name: 'Rev' }}
  onOpen={() => {}} onRefresh={() => {}} onDeleted={() => {}} onClose={() => {}} {...props} />)

describe('History', () => {
  it('pinned first, then by day; a row opens its chat', () => {
    const onOpen = vi.fn()
    view({ onOpen })
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Pinned', 'Today'])
    fireEvent.click(screen.getByTitle('Today chat'))
    expect(onOpen).toHaveBeenCalledWith('b')
  })
  it('rename edits in place and saves on Enter', async () => {
    const onRefresh = vi.fn()
    view({ onRefresh })
    fireEvent.click(screen.getByLabelText('Rename Today chat'))
    const input = screen.getByLabelText('Chat name')
    fireEvent.change(input, { target: { value: 'NVDA notes' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(calls).toContainEqual(['PATCH', '/api/agent/conversations/b', { title: 'NVDA notes' }])
    expect(onRefresh).toHaveBeenCalled()
  })
  it('delete asks first; Cancel deletes nothing; Delete deletes', async () => {
    const onDeleted = vi.fn()
    view({ onDeleted })
    fireEvent.click(screen.getByLabelText('Delete Today chat'))
    const ask = screen.getByRole('alertdialog')
    fireEvent.click(within(ask).getByText('Cancel'))
    expect(calls.some(c => c[0] === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByLabelText('Delete Today chat'))
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete')) })
    expect(calls).toContainEqual(['DELETE', '/api/agent/conversations/b', null])
    expect(onDeleted).toHaveBeenCalledWith('b')
  })
  it('search: hits grouped under their chat; a hit opens that chat at the message', async () => {
    const onOpen = vi.fn()
    view({ onOpen })
    fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'nvda' } })
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(screen.getByText(/1 result in 1 chat/)).toBeTruthy()
    expect(screen.getByText('NVDA').tagName).toBe('MARK')
    fireEvent.click(screen.getByRole('option'))
    expect(onOpen).toHaveBeenCalledWith('b', 'h7')
  })
})
