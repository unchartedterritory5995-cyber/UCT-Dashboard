// app/src/components/chart/dateWarm.js
//
// ⭐ THE DATE IS WARMED DIGIT BY DIGIT (2026-11-28, zero-network plan PR 1.2). A member typing a date into the chart's
// date box ("3/14/2006", then Enter) sends an intraday chart to the window ending at that date, which reads the history
// lake (PR 1.1: historyFeed `windowBars`). The read's index and pieces cost one edge hop (~40-60 ms) AFTER Enter; the
// date is known a keystroke earlier, as soon as its year is whole. So each draft the box parses to a whole date primes
// the lake for that window (the store facade's `primeLake`: index + the pieces that read takes, into the page's HTTP
// cache), for the front symbol and the list's next row on either side (neighborFrames `scanNeighborsFor`: ahead[0],
// behind[0]), on every intraday timeframe the chart's colour group shows (the linked charts' own windows).
//   - A newer text aborts the older (one AbortController per date): a date typed past is never warmed to the end.
//   - Enter, a blur or the same date again keep the warm (the jump reads what it brought in).
//   - Nothing on the touch tier (≤1024 px: no hardware keyboard to type ahead on, and a phone's data is the member's),
//     at the present (a date at or past today reads the plain key), on D/W/M, or with the bar store off.
import { BARSTORE } from './barStoreSwitch'
import { viewWindowOfDate } from './viewWindow'
import { isIntradayTf } from '../../data/barStore/types'
import { getBarStore } from '../../data/barStore'
import { viewKeyFor } from '../../data/barStore/prefetch'
import { etDateLabel } from './barTime'

/** The list rows warmed beside the front symbol (ahead[0] and behind[0] of scanNeighborsFor's order). */
export const DATE_WARM_NEIGHBORS = 2

const _touchTier = () => {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1024px)')?.matches } catch { return false }
}

/**
 * @param {object} [o]
 * @param {() => object} [o.store] the bar store (default: the app's)
 * @param {boolean} [o.enabled] default: the bar store is on
 * @param {() => boolean} [o.touch] the touch tier test
 * @param {() => number} [o.now] ms (the present's date)
 */
export function createDateWarm({ store = getBarStore, enabled = BARSTORE, touch = _touchTier, now = Date.now } = {}) {
  let cur = null   // { sig, ac }
  const stop = () => { if (cur) { try { cur.ac?.abort() } catch { /* aborted */ } cur = null } }
  return {
    /**
     * The date box's draft parsed (`ms`: UTC midnight of a whole date, null while it is not one).
     * @param {number|null} ms the draft's date (chart/dateText parseDate(text, {whole: true}): the date Enter goes to)
     * @param {{sym: string, neighbors?: string[], tfs?: Iterable<string>, showExtended?: boolean}} ctx
     * @returns {string[]} the keys primed (none when nothing was due)
     */
    draft(ms, { sym, neighbors = [], tfs = [], showExtended = false } = {}) {
      if (!enabled || !sym || touch()) { stop(); return [] }
      const iso = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null
      if (!iso || iso >= etDateLabel(Math.floor(now() / 1000))) { stop(); return [] }
      const syms = [...new Set([sym, ...neighbors.slice(0, DATE_WARM_NEIGHBORS)].map((s) => String(s || '').toUpperCase()).filter(Boolean))]
      const frames = [...new Set([...tfs].map(String))].filter((tf) => isIntradayTf(tf))
      const sig = `${iso}|${syms.join(',')}|${frames.join(',')}|${showExtended ? 1 : 0}`
      if (cur?.sig === sig) return []
      stop()
      if (!frames.length) return []
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
      cur = { sig, ac }
      const s = store()
      const keys = []
      for (const tf of frames) {
        const window = viewWindowOfDate(iso, tf)
        if (!window) continue
        for (const sy of syms) {
          const key = viewKeyFor(sy, tf, { showExtended, window })
          if (!key) continue
          keys.push(key)
          try { s?.primeLake?.(key, ac ? { signal: ac.signal } : undefined) } catch { /* a warm only */ }
        }
      }
      return keys
    },
    /** Give the warm in flight up (a text that is no date any more). */
    cancel: stop,
  }
}
