import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VideoPlayer from './VideoPlayer'
import { __reset } from './videoProgress'

// Pretend the IFrame API is ready immediately.
vi.mock('./useYouTubeApi', () => ({ useYouTubeApi: () => true }))

let lastPlayer
let lastOnStateChange

beforeEach(() => {
  __reset()
  lastPlayer = null
  lastOnStateChange = null
  // Minimal YT.Player stub: capture the state-change handler + loadVideoById.
  // Must be a real constructor (the component calls `new window.YT.Player(...)`).
  window.YT = {
    Player: class {
      constructor(mount, opts) {
        lastOnStateChange = opts.events?.onStateChange
        this.loadVideoById = vi.fn()
        this.destroy = vi.fn()
        lastPlayer = this
      }
    },
  }
})

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First Video', description: 'one' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second Video' },
  { id: 3, youtube_id: 'ccccccccccc', title: 'Third Video' },
]

describe('VideoPlayer', () => {
  it('shows the Up Next rail with the upcoming videos in the section', () => {
    render(<VideoPlayer list={LIST} startIndex={0} onClose={() => {}} />)
    expect(screen.getByText('Up next in this section')).toBeInTheDocument()
    expect(screen.getByText('Second Video')).toBeInTheDocument()
    expect(screen.getByText('Third Video')).toBeInTheDocument()
  })

  it('switches videos in-place when an Up Next item is clicked (no off-site nav)', () => {
    render(<VideoPlayer list={LIST} startIndex={0} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Second Video'))
    expect(lastPlayer.loadVideoById).toHaveBeenCalledWith({
      videoId: 'bbbbbbbbbbb',
      startSeconds: 0,
    })
  })

  it('shows a "Next up" card when a video ends instead of YouTube’s end screen', () => {
    render(<VideoPlayer list={LIST} startIndex={0} onClose={() => {}} />)
    act(() => lastOnStateChange({ data: 0 })) // 0 === ENDED
    expect(screen.getByText('Next up')).toBeInTheDocument()
    expect(screen.getByText('Play now')).toBeInTheDocument()
  })

  it('the last video shows an end-of-section card, not a next card', () => {
    render(<VideoPlayer list={LIST} startIndex={2} onClose={() => {}} />)
    act(() => lastOnStateChange({ data: 0 }))
    expect(screen.getByText(/reached the end of this section/i)).toBeInTheDocument()
  })
})
