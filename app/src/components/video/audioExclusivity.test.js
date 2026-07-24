import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pauseOtherAudio } from './audioExclusivity'

beforeEach(() => {
  document.body.innerHTML = ''
  globalThis.speechSynthesis = { cancel: vi.fn() }
})

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
  })

  it('pauses other audio but NOT the tagged video-audio element', () => {
    const other = document.createElement('audio')
    other.pause = vi.fn()
    // Make paused report false so the !el.paused guard allows pause to be called
    Object.defineProperty(other, 'paused', { value: false, configurable: true })
    document.body.appendChild(other)

    const mine = document.createElement('audio')
    mine.setAttribute('data-uct-video-audio', '1')
    mine.pause = vi.fn()
    // Make paused report false so the !el.paused guard would allow pause if not skipped
    Object.defineProperty(mine, 'paused', { value: false, configurable: true })
    document.body.appendChild(mine)

    pauseOtherAudio()

    expect(other.pause).toHaveBeenCalled()
    expect(mine.pause).not.toHaveBeenCalled()
  })
})
