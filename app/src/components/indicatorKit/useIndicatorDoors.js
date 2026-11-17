// app/src/components/indicatorKit/useIndicatorDoors.js
//
// The charts page's half of `indicatorDoors.js`: when a door has been asked for,
// open it on a chart as soon as one can answer. It asks a bounded number of
// times and then stops; a request that outlives its time is dropped, never
// opened late. No timer runs while nothing is parked.

import { useEffect } from 'react'
import {
  PENDING_TTL_MS, clearPendingIndicatorDoor, onIndicatorDoor, peekPendingIndicatorDoor,
  pickChartApi, runIndicatorDoor,
} from './indicatorDoors'

export const RETRY_MS = 250

export default function useIndicatorDoors(chartApiByIdRef, activeChartRef) {
  useEffect(() => {
    let timer = null
    let tries = 0
    const maxTries = Math.ceil(PENDING_TTL_MS / RETRY_MS)
    const stop = () => { if (timer != null) { clearTimeout(timer); timer = null } }
    const attempt = () => {
      timer = null
      const door = peekPendingIndicatorDoor()
      if (!door) return
      const api = pickChartApi(chartApiByIdRef?.current, activeChartRef?.current)
      const answer = runIndicatorDoor(door, api)
      if (answer === 'opened' || answer === 'refused') { clearPendingIndicatorDoor(); return }
      tries += 1
      if (tries >= maxTries) { clearPendingIndicatorDoor(); return }
      timer = setTimeout(attempt, RETRY_MS)
    }
    const begin = () => { stop(); tries = 0; attempt() }
    begin()
    const off = onIndicatorDoor(begin)
    return () => { off(); stop() }
  }, [chartApiByIdRef, activeChartRef])
}
