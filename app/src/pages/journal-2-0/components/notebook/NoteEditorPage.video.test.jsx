import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const NOTE = {
  id: 'n1', title: 'AAPL session — Notes', subtitle: '', folderId: null,
  ticker: 'AAPL', tags: [],
  heroImageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  bodyJson: {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: '[1:15] ' },
        { type: 'text', text: 'Breakout retest' },
      ],
    }],
  },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  window.YT = { Player: class { constructor() { this.seekTo = vi.fn(); this.playVideo = vi.fn(); this.destroy = vi.fn() } } }
})
afterEach(() => { delete window.YT; vi.clearAllMocks() })

describe('NoteEditorPage video timestamps', () => {
  it('upgrades a legacy bold [MM:SS] note into a clickable chip', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<NoteEditorPage noteId="n1" onBack={() => {}} />)
    const chip = document.querySelector('[data-video-ts]')
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('data-video-ts')).toBe('75')
    expect(chip.textContent).toBe('[1:15]')
  })
})
