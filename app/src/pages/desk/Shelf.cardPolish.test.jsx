// Card polish: relative dates on show cards and the discussion label.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { YTCard, fmtRelativeDate } from './Shelf'

const NOW = new Date(2026, 9, 14, 15, 0).getTime() // Oct 14 2026, 3pm local
const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime() / 1000

describe('fmtRelativeDate', () => {
  it('reads recency inside a week', () => {
    expect(fmtRelativeDate(at(2026, 9, 14, 9), NOW)).toBe('Today')
    expect(fmtRelativeDate(at(2026, 9, 13, 23), NOW)).toBe('Yesterday')
    expect(fmtRelativeDate(at(2026, 9, 10), NOW)).toBe('4 days ago')
  })
  it('falls back to a short date, with the year only when it differs', () => {
    expect(fmtRelativeDate(at(2026, 8, 2), NOW)).toBe('Sep 2')
    expect(fmtRelativeDate(at(2025, 10, 10), NOW)).toBe('Nov 10, 2025')
  })
  it('renders nothing for a missing timestamp', () => {
    expect(fmtRelativeDate(0, NOW)).toBe('')
  })
})

describe('YTCard discussion label', () => {
  const video = { id: 7, youtube_id: 'abcdefghijk', title: 'Session', created_at: 0 }
  const renderCard = (reply_count) =>
    render(
      <MemoryRouter>
        <YTCard
          video={video}
          kind="library"
          onClick={() => {}}
          progress={{}}
          deskThreads={{ 7: { thread_id: 3, reply_count } }}
        />
      </MemoryRouter>,
    )

  it('says Discuss instead of a zero count', () => {
    renderCard(0)
    expect(screen.getByRole('link', { name: 'Discuss' })).toBeTruthy()
    expect(screen.queryByText(/\(0\)/)).toBeNull()
  })
  it('counts replies when there are some', () => {
    renderCard(1)
    expect(screen.getByRole('link', { name: '1 reply' })).toBeTruthy()
  })
  it('pluralises', () => {
    renderCard(5)
    expect(screen.getByRole('link', { name: '5 replies' })).toBeTruthy()
  })
})
