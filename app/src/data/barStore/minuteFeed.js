// app/src/data/barStore/minuteFeed.js — PLACEHOLDER (rails-first commit). The names the rails import, with NO
// behaviour: nothing is read from the network and nothing is appended. The next commit replaces this file.

export const FEED_TF = '1'
export const RING_MINUTES = 30
export const FAIL_PAUSE_MS = 2 * 60_000
export const REFUSED_PAUSE_MS = 10 * 60_000

export function createMinuteFeeder() {
  return {
    sink: { upsert() {}, gap() {}, reset() {}, frameDone() {} },
    accept: () => false,
    settled: () => Promise.resolve(),
    stop() {},
    stats: () => ({ frames: 0, breaks: 0, appended: 0, corrected: 0, refused: 0, symbols: 0, chainFrom: null, chainTo: null }),
  }
}

export function createPageMinuteFeed() {
  const feeder = createMinuteFeeder()
  return {
    feeder,
    gate: () => false,
    start() {},
    stop() {},
    running: () => false,
    status: () => ({ running: false, stopped: null, requests: 0, answered: 0, refused: 0, pausedUntil: 0, pauses: 0, ...feeder.stats() }),
  }
}
