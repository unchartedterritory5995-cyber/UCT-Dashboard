// app/src/components/chart/useDateWindowWarm.js
//
// ⭐ (review of #2947, H2: charts at any date) AT A DATE ON INTRADAY THE NEXT ROWS' WINDOWS ARE WARMED. A chart the date
// box sent to a past date reads the window ending there (`@to=`, chart/viewWindow), never the plain key the list's warms
// prepare, so without this every switch the double buffer's hidden pane did not prepare waited on a cold window. The
// rows the list names next (neighborFrames scanNeighborsFor), again whenever the list republishes; as replay's warm does
// for its cutoff (prefetch.prefetchReplayTimeframes). Nothing at the present, on D/W/M, or with the bar store off.
import { useEffect } from 'react'
import { BARSTORE } from './barStoreSwitch'
import { scanNeighborsFor, subscribeScanNeighbors } from './neighborFrames'
import { viewWindowOfDate } from './viewWindow'
import { prefetchViewWindow } from '../../data/barStore/prefetch'

/**
 * @param {{sym: string|null, tf: string, day: string|null, showExtendedRef?: {current: boolean}}} o  `day`: the date the
 *   member went to ('YYYY-MM-DD'), or null at the present
 */
export function useDateWindowWarm({ sym, tf, day, showExtendedRef = null }) {
  useEffect(() => {
    const vw = BARSTORE && day && sym ? viewWindowOfDate(day, tf) : null
    if (!vw) return undefined
    const warm = () => {
      try { prefetchViewWindow(scanNeighborsFor(sym), tf, vw, { showExtended: showExtendedRef?.current }) } catch { /* a warm only */ }
    }
    warm()
    const c0 = String(sym).toUpperCase()
    return subscribeScanNeighbors((c) => { if (c === c0) warm() })
  }, [sym, tf, day])   // eslint-disable-line react-hooks/exhaustive-deps -- showExtendedRef is a ref
}
