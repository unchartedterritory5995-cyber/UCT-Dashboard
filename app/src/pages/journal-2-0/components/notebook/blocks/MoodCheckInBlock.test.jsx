// app/src/pages/journal-2-0/components/notebook/blocks/MoodCheckInBlock.test.jsx
//
// P2 Tier 3 Task 3: the mood and focus check-in body. Its ONE write is the setter BlockNodeView hands it
// (useBlockParams's return, one editor transaction per press); it reads nothing and fetches nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/calendar', async (orig) => ({ ...(await orig()), todayET: () => '2026-10-17' }))
import MoodCheckInBlock from './MoodCheckInBlock'

const EMPTY = { mood: '', focus: '', day: '' }
let fetchSpy

beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('no fetch') }) })
afterEach(() => { cleanup(); fetchSpy.mockRestore() })

describe('MoodCheckInBlock', () => {
  it('pressing Good calls setParams once with mood 4 and the ET day', async () => {
    const setParams = vi.fn(() => true)
    render(<MoodCheckInBlock params={EMPTY} setParams={setParams} editable />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mood: Good' }))
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ mood: '4', focus: '', day: '2026-10-17' })
  })

  it('pressing Good again clears it (and the day, since focus is unpicked)', async () => {
    const setParams = vi.fn(() => true)
    render(<MoodCheckInBlock params={{ mood: '4', focus: '', day: '2026-10-16' }} setParams={setParams} editable />)
    const good = screen.getByRole('button', { name: 'Mood: Good' })
    expect(good.getAttribute('aria-pressed')).toBe('true')
    await userEvent.setup().click(good)
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ mood: '', focus: '', day: '' })
  })

  it('a focus pick after a mood pick keeps the first day', async () => {
    const setParams = vi.fn(() => true)
    render(<MoodCheckInBlock params={{ mood: '2', focus: '', day: '2026-10-16' }} setParams={setParams} editable />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Focus: Steady' }))
    expect(setParams).toHaveBeenCalledWith({ mood: '2', focus: '3', day: '2026-10-16' })
  })

  it('no fetch is ever called: not on mount, not on a press', async () => {
    const setParams = vi.fn(() => true)
    render(<MoodCheckInBlock params={EMPTY} setParams={setParams} editable />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Mood: Great' }))
    await user.click(screen.getByRole('button', { name: 'Focus: Locked in' }))
    expect(setParams).toHaveBeenCalledTimes(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('read-only renders the chosen words as text and no buttons', () => {
    render(<MoodCheckInBlock params={{ mood: '4', focus: '3', day: '2026-10-17' }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Mood: Good · Focus: Steady')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('read-only with nothing picked says so, with no buttons', () => {
    render(<MoodCheckInBlock params={EMPTY} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('No check-in yet.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('every button has an accessible name: two rows of five, each pressed state said', () => {
    render(<MoodCheckInBlock params={{ mood: '', focus: '3', day: '2026-10-17' }} setParams={vi.fn()} editable />)
    for (const w of ['Rough', 'Low', 'Okay', 'Good', 'Great']) {
      expect(screen.getByRole('button', { name: `Mood: ${w}` }).getAttribute('aria-pressed')).toBe('false')
    }
    for (const w of ['Scattered', 'Distracted', 'Focused', 'Locked in']) {
      expect(screen.getByRole('button', { name: `Focus: ${w}` }).getAttribute('aria-pressed')).toBe('false')
    }
    expect(screen.getByRole('button', { name: 'Focus: Steady' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('button')).toHaveLength(10)
    expect(screen.getByRole('group', { name: 'Mood' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Focus' })).toBeTruthy()
  })

  it('the muted line: a prompt before the first pick, the day after it', () => {
    const { rerender } = render(<MoodCheckInBlock params={EMPTY} setParams={vi.fn()} editable />)
    expect(screen.getByText('Pick how you feel and how focused you are.')).toBeTruthy()
    rerender(<MoodCheckInBlock params={{ mood: '5', focus: '', day: '2026-10-17' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Checked in for Oct 17')).toBeTruthy()
    expect(screen.queryByText('Pick how you feel and how focused you are.')).toBeNull()
  })

  it('a press the editor refuses is said, never swallowed', async () => {
    render(<MoodCheckInBlock params={EMPTY} setParams={vi.fn(() => false)} editable />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mood: Low' }))
    expect(screen.getByRole('status').textContent).toBe("That choice couldn't be saved. Nothing was changed.")
  })
})
