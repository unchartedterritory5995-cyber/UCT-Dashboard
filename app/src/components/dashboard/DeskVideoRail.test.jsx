import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const navigateSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }))

let swrData
vi.mock('swr', () => ({ default: () => ({ data: swrData, error: undefined, isLoading: false }) }))

const playSpy = vi.fn()
vi.mock('../video/videoStore', () => ({ play: (...a) => playSpy(...a) }))

let progressData = {}
vi.mock('../../pages/desk/videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => progressData,
  hydrateFromServer: () => {},
}))

import DeskVideoRail from './DeskVideoRail'

const CATS = [{ name: 'A', videos: [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'Alpha', created_at: 100 },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Bravo', created_at: 200 },
] }]

beforeEach(() => {
  navigateSpy.mockClear(); playSpy.mockClear()
  progressData = {}; swrData = undefined
})

describe('DeskVideoRail', () => {
  it('renders nothing when there are no videos', () => {
    swrData = { categories: [], total: 0 }
    const { container } = render(<DeskVideoRail />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a Resume card first when something is in progress', () => {
    progressData = { aaaaaaaaaaa: { t: 30, d: 60, at: 999, done: false } }
    swrData = { categories: CATS, total: 2 }
    render(<DeskVideoRail />)
    const cards = screen.getAllByRole('button', { name: /Play / })
    expect(cards[0]).toHaveAccessibleName('Play Alpha')
    expect(screen.getByText('Resume')).toBeInTheDocument()
  })

  it('clicking a card plays it and navigates to the Desk', () => {
    swrData = { categories: CATS, total: 2 }
    render(<DeskVideoRail />)
    fireEvent.click(screen.getByLabelText('Play Bravo'))
    expect(playSpy).toHaveBeenCalledWith(CATS[0].videos, 1)
    expect(navigateSpy).toHaveBeenCalledWith('/desk?section=videos')
  })
})
