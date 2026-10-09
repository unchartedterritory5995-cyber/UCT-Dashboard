// Wave 9 lane 9: re-poll a read whose server answered "warming" (marketRead.isWarmingBody /
// isWarmingError), briefly. A cold cache answers within seconds to a couple of minutes; a poll
// that never stopped would hammer a server that is genuinely stuck, so after `maxTries` the
// panel says so and offers Retry instead.
import { useCallback, useEffect, useRef, useState } from 'react'

export const WARM_POLL_MS = 5000
export const WARM_MAX_TRIES = 24   // about two minutes at the default interval

/**
 * While `active`, call `poll()` every `everyMs`, at most `maxTries` times.
 * Returns `{ gaveUp, retry }`: `gaveUp` is true once the tries are spent and the read still
 * warms; `retry()` starts a fresh round and polls at once.
 */
export default function useWarmingPoll(active, poll, { everyMs = WARM_POLL_MS, maxTries = WARM_MAX_TRIES } = {}) {
  const pollRef = useRef(poll)
  pollRef.current = poll
  const [round, setRound] = useState({ tries: 0, id: 0 })
  useEffect(() => {
    if (!active || round.tries >= maxTries) return undefined
    const t = setTimeout(() => {
      setRound((r) => ({ ...r, tries: r.tries + 1 }))
      pollRef.current?.()
    }, everyMs)
    return () => clearTimeout(t)
  }, [active, round, everyMs, maxTries])
  const retry = useCallback(() => {
    setRound((r) => ({ tries: 0, id: r.id + 1 }))
    pollRef.current?.()
  }, [])
  return { gaveUp: Boolean(active) && round.tries >= maxTries, retry }
}
