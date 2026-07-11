import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import VideoDockSlot from './VideoDockSlot'
import { MemoryRouter } from 'react-router-dom'
import * as store from './videoStore'

vi.mock('../../hooks/useVideoNotes', () => ({
  useVideoNotes: () => ({
    notes: [{ id: 1, t_seconds: 75, text: 'Breakout retest' }],
    add: vi.fn(),
    remove: vi.fn(),
  }),
}))

beforeEach(() => { store.__reset() })
afterEach(() => { vi.restoreAllMocks() })

const LIST = [{ id: 1, youtube_id: 'abcdefghijk', title: 'AAPL session' }]

describe('saveToNotebook emits videoTimestamp chips', () => {
  it('posts a bodyJson with a videoTimestamp node per note', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    act(() => store.play(LIST, 0))
    render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    const btn = await screen.findByRole('button', { name: /notebook/i })
    await act(async () => { fireEvent.click(btn) })
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/j2/notes'))
    expect(post).toBeTruthy()
    const body = JSON.parse(post[1].body)
    const firstPara = body.bodyJson.content[0]
    expect(firstPara.content[0]).toEqual({ type: 'videoTimestamp', attrs: { seconds: 75 } })
    expect(firstPara.content[1].text).toBe(' Breakout retest')
  })
})
