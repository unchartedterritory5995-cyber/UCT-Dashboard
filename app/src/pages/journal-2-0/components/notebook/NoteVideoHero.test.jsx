import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NoteVideoHero from './NoteVideoHero'

let lastPlayer
beforeEach(() => {
  lastPlayer = null
  window.YT = {
    Player: class {
      constructor(el, opts) {
        this.opts = opts
        this.seekTo = vi.fn()
        this.playVideo = vi.fn()
        this.destroy = vi.fn()
        lastPlayer = this
      }
    },
  }
})
afterEach(() => { delete window.YT })

describe('NoteVideoHero', () => {
  it('renders nothing without a youtubeId', () => {
    const { container } = render(<NoteVideoHero youtubeId="" watchUrl="x" />)
    expect(container.firstChild).toBeNull()
  })

  it('instantiates a YT.Player for the video', () => {
    render(<NoteVideoHero youtubeId="abcdefghijk" watchUrl="https://youtu.be/abcdefghijk" />)
    expect(lastPlayer).toBeTruthy()
    expect(lastPlayer.opts.videoId).toBe('abcdefghijk')
  })

  it('seeks and plays on uct:video-seek', () => {
    render(<NoteVideoHero youtubeId="abcdefghijk" watchUrl="x" />)
    act(() => {
      window.dispatchEvent(new CustomEvent('uct:video-seek', { detail: { seconds: 42 } }))
    })
    expect(lastPlayer.seekTo).toHaveBeenCalledWith(42, true)
    expect(lastPlayer.playVideo).toHaveBeenCalled()
  })
})
