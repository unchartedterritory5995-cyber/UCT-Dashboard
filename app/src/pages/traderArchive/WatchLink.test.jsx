// WatchLink — "Watch at m:ss" on an archive call row (the Desk session moment for that call).
// Synthetic data only: the repo is public. The server decides who gets `watch` (paid routes,
// WISDOM_CALL_MOMENTS_ENABLED); this side must render it faithfully and render NOTHING otherwise.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import WatchLink, { watchOf } from './WatchLink'

const URL = 'https://www.youtube.com/watch?v=VIDZZTA0001&t=4500'
const W = { url: URL, at: '1:15:00', session_date: '2026-06-01', confidence_label: 'high' }

describe('WatchLink', () => {
  it('renders the best link with its time, opening the exact second in a new tab', () => {
    render(<WatchLink call={{ call_id: 't1#0', watch: [W, { ...W, url: `${URL}x`, at: '0:10' }] }} />)
    const a = screen.getByRole('link', { name: 'Watch at 1:15:00' })
    expect(a.getAttribute('href')).toBe(URL)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.getAttribute('title')).toContain('Desk session 2026-06-01')
  })

  it('renders nothing when the server sent no watch (gate off, or no session moment)', () => {
    const { container } = render(<WatchLink call={{ call_id: 't1#0', ticker: 'ZZTA' }} />)
    expect(container.innerHTML).toBe('')
    expect(watchOf(null)).toBeNull()
    expect(watchOf({ watch: [] })).toBeNull()
  })

  it('refuses anything that is not a YouTube watch URL', () => {
    for (const url of ['javascript:alert(1)', 'https://evil.example/watch?v=x', '//www.youtube.com/watch?v=x']) {
      const { container } = render(<WatchLink call={{ watch: [{ ...W, url }] }} />)
      expect(container.innerHTML).toBe('')
    }
  })
})
