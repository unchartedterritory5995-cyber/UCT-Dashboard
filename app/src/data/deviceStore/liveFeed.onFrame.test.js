// @vitest-environment node
// liveFeed `onFrame` (2026-11-24): the device store's worker tells the pages when a minute file is in the browser's
// cache (lib/minuteFrames/applied.js; workerCore). The hook sits AFTER the overlay and can never cost it a frame.
//   L1 told each frame the live consumer applied, with the consumer's own info, after the overlay took it
//   L2 a listener that throws: the overlay still has the frame, and nothing is thrown
//   L3 a stopped (or replaced) consumer's late frame tells nobody, as it reaches no overlay
//   L4 without the option the feed is what it was
import { describe, it, expect, vi } from 'vitest'
import { createLiveFeed } from './liveFeed'

function overlayOf() {
  const order = []
  return {
    order,
    sink: {
      upsert: vi.fn(), stale: vi.fn(), reset: vi.fn(), gap: vi.fn(), daily: vi.fn(),
      frameDone: vi.fn(() => order.push('overlay')),
    },
    clear: vi.fn(), state: () => ({}),
  }
}
function consumers() {
  const made = []
  const load = async () => ({
    createMinuteFrameConsumer: (opts) => { const c = { opts, start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({}) }; made.push(c); return c },
  })
  return { made, load }
}
const INFO = { day: '2026-11-10', seq: 362, minute: 29_905_382, withAv: false, dailyOk: false, file: true }

describe('liveFeed onFrame', () => {
  it('L1 told each applied frame, with the consumer own info, after the overlay took it', async () => {
    const overlay = overlayOf()
    const { made, load } = consumers()
    const onFrame = vi.fn(() => overlay.order.push('told'))
    const feed = createLiveFeed({ overlay, load, onFrame })
    await feed.start()
    made[0].opts.sink.frameDone(INFO)
    expect(overlay.sink.frameDone).toHaveBeenCalledWith(INFO)
    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(onFrame).toHaveBeenCalledWith(INFO)
    expect(overlay.order).toEqual(['overlay', 'told'])
  })

  it('L2 a listener that throws: the overlay still has the frame, and nothing is thrown', async () => {
    const overlay = overlayOf()
    const { made, load } = consumers()
    const onFrame = vi.fn(() => { throw new Error('listener') })
    const feed = createLiveFeed({ overlay, load, onFrame })
    await feed.start()
    expect(() => made[0].opts.sink.frameDone(INFO)).not.toThrow()
    expect(overlay.sink.frameDone).toHaveBeenCalledTimes(1)
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('L3 a stopped consumer late frame tells nobody, as it reaches no overlay', async () => {
    const overlay = overlayOf()
    const { made, load } = consumers()
    const onFrame = vi.fn()
    const feed = createLiveFeed({ overlay, load, onFrame })
    await feed.start()
    feed.stop()
    made[0].opts.sink.frameDone(INFO)
    expect(overlay.sink.frameDone).not.toHaveBeenCalled()
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('L4 without the option the feed is what it was', async () => {
    const overlay = overlayOf()
    const { made, load } = consumers()
    const feed = createLiveFeed({ overlay, load })
    await feed.start()
    expect(() => made[0].opts.sink.frameDone(INFO)).not.toThrow()
    expect(overlay.sink.frameDone).toHaveBeenCalledWith(INFO)
  })
})
