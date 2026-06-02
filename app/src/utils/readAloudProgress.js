/**
 * Tiny pub/sub for read-aloud playback progress.
 *
 * The AudioPlayerBar owns the <audio> element and publishes time/duration here;
 * the page being read (e.g. Morning Wire) subscribes to drive follow-along
 * highlighting. Kept out of React context so 4-per-second time updates don't
 * re-render every voice consumer.
 */

let state = { trackId: null, currentTime: 0, duration: 0, playing: false }
const subscribers = new Set()

export function setProgress(patch) {
  state = { ...state, ...patch }
  subscribers.forEach((fn) => {
    try { fn(state) } catch { /* ignore subscriber errors */ }
  })
}

export function getProgress() {
  return state
}

export function subscribeProgress(fn) {
  subscribers.add(fn)
  fn(state)
  return () => subscribers.delete(fn)
}
