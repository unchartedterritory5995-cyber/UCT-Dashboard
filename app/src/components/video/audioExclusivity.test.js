import { describe, it, expect, vi } from 'vitest'
import { pauseOtherAudio } from './audioExclusivity'

describe('pauseOtherAudio', () => {
  it('pauses playing audio elements and leaves paused ones alone', () => {
    const playing = document.createElement('audio')
    Object.defineProperty(playing, 'paused', { value: false })
    playing.pause = vi.fn()
    const stopped = document.createElement('audio')
    Object.defineProperty(stopped, 'paused', { value: true })
    stopped.pause = vi.fn()
    document.body.append(playing, stopped)

    pauseOtherAudio()

    expect(playing.pause).toHaveBeenCalledTimes(1)
    expect(stopped.pause).not.toHaveBeenCalled()
    playing.remove(); stopped.remove()
  })
})
