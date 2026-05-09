import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import AudioPlayerBar from './AudioPlayerBar'

describe('AudioPlayerBar', () => {
  it('renders only a hidden <audio> when idle', () => {
    const { container } = render(
      <VoiceProvider><AudioPlayerBar /></VoiceProvider>
    )
    expect(container.querySelector('audio')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })
})
