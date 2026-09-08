import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import useStaggeredMount from '../grid/useStaggeredMount'
import ReviewFeedCard from './ReviewFeedCard'
import { feedWindow, centreFrom, FEED_MAX_LIVE } from './feedWindow'
import { captureSnapshot, makeSnapshotStore } from './feedSnapshot'
import styles from './ReviewFeed.module.css'

/* ─── THE REVIEW FEED — the whole ordered set, as charts ────────────────────
 *
 * ⛔ WHAT IT REPLACES, and why the old answer was wrong for most reviews. The
 * position chip's "open list" used to reach for the WATCHLIST WIDGET, which is
 * the list a watchlist review came from and has nothing to do with a review
 * that came from a scan or a screener — those have no phone surface at all, so
 * the gesture either showed an unrelated list or fell through to a menu.
 *
 * ⭐ ONE GESTURE, ONE ANSWER, FOR EVERY SOURCE. This shows THE REVIEW'S OWN
 * list, in the review's own order, whatever produced it — and it is a better
 * answer than the row list even for a watchlist, because a review is a visual
 * task and rows are not. The watchlist page is unchanged and still one tap away
 * through its widget; going back to it is a different intent (leaving the
 * review) from looking across the set (staying in it).
 *
 * ⛔ THE BUDGET IS ENFORCED IN TWO LAYERS AND BOTH ARE LOAD-BEARING:
 *   1. `feedWindow` picks at most three ids that MAY be live — the ceiling on
 *      mounted charts, and the only thing standing between a 50-symbol scan and
 *      the +63 MB/16-cell number the desktop grid measured;
 *   2. `useStaggeredMount` then admits those in order, bounding concurrent bar
 *      fetches to the same three. It is an admission queue and by its own
 *      contract NEVER unmounts, so it cannot be the ceiling — feeding it all
 *      fifty ids would mount all fifty, three at a time, every check green on
 *      the way to the incident.
 *
 * ⛔ AND THE FEED AND THE TRANSPORT SHARE ONE MODEL. Tapping a card moves the
 * REVIEW SESSION to that index; it does not open a private viewer. Two ways to
 * be "at" a symbol is how "12 / 47" and the chart start disagreeing.
 */

const DENSITY_KEY = 'uct.review.feed.density'

/** ⭐ THE A/B IS A TOGGLE, NOT AN EXPERIMENT. The question — how many charts a
 *  reviewer wants per screen — is answered by a trader scrolling a real list on
 *  a real phone, and a toggle lets the same person feel both within a second.
 *  A bucketed experiment would need traffic this surface does not have yet. */
export const DENSITIES = ['tall', 'dense']

function readDensity() {
  try {
    const v = localStorage.getItem(DENSITY_KEY)
    return DENSITIES.includes(v) ? v : 'tall'
  } catch { return 'tall' }
}

/**
 * @param {object}   props.session   the review session (symbols + index).
 * @param {string}   props.tf        the timeframe the cards draw.
 * @param {function} props.onOpen    (index) => void — move the review there.
 * @param {function} props.onClose   dismiss the feed.
 */
export default function ReviewFeed({ session, tf = 'D', onOpen, onClose }) {
  const symbols = useMemo(
    () => (session && Array.isArray(session.symbols) ? session.symbols : []),
    [session])
  const reviewed = useMemo(
    () => new Set((session && session.reviewed) || []),
    [session])

  // Open ON the symbol the review is at — a feed that opened at the top would
  // make "where am I" the first thing a member has to solve.
  const [centre, setCentre] = useState(() => (session ? session.index || 0 : 0))
  const [density, setDensity] = useState(readDensity)
  const dense = density === 'dense'

  const windowIds = useMemo(() => feedWindow(symbols, centre), [symbols, centre])
  const { mountedIds, release } = useStaggeredMount(windowIds, { limit: FEED_MAX_LIVE })

  /* ── snapshots ──────────────────────────────────────────────────────────
   * The store lives in a ref (writing it must not re-render the list) with a
   * counter beside it for the one moment a re-render IS wanted: a card that
   * just went dark and now has a frame to show. */
  const shotsRef = useRef(null)
  if (!shotsRef.current) shotsRef.current = makeSnapshotStore()
  const [, bumpShots] = useState(0)
  const onSnapshot = useCallback((sym, el) => {
    const url = captureSnapshot(el)
    if (!url) return                       // no context, never painted — skeleton
    shotsRef.current.put(sym, url)
    bumpShots((n) => n + 1)
  }, [])

  /* ── per-card slot release, with a STABLE identity per symbol ────────────
   * `ReviewFeedCard` is memoised; a fresh arrow per render would defeat it and
   * re-render every live chart on every scroll callback. */
  const readyRef = useRef(new Map())
  const readyFor = useCallback((sym) => {
    const m = readyRef.current
    if (!m.has(sym)) m.set(sym, () => release(sym))
    return m.get(sym)
  }, [release])

  /* ── the observer ───────────────────────────────────────────────────────
   * ⛔ IT ONLY REPORTS A CENTRE. Every decision that follows is `feedWindow`'s,
   * which is a pure function precisely because an observer needs layout and
   * jsdom has none — a policy tangled with the observer could only be checked
   * by hand on a device. */
  const scrollRef = useRef(null)
  const ratiosRef = useRef(new Map())
  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = Number(e.target.getAttribute('data-feed-index'))
        if (Number.isFinite(i)) ratiosRef.current.set(i, e.intersectionRatio)
      }
      const seen = [...ratiosRef.current.entries()].map(([index, ratio]) => ({ index, ratio }))
      setCentre((prev) => centreFrom(seen, prev))
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] })
    for (const el of root.querySelectorAll('[data-feed-index]')) io.observe(el)
    return () => io.disconnect()
  }, [symbols.length])

  // Land on the current symbol's card. `block: 'start'` rather than 'nearest':
  // opening the feed should put that card AT the top, not leave it wherever the
  // browser thinks is least work.
  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    const el = scrollRef.current?.querySelector(`[data-feed-index="${centre}"]`)
    try { el?.scrollIntoView({ block: 'start' }) } catch { /* jsdom has no layout */ }
  }, [centre])

  /* ⭐ THE INSTRUMENT, because "≤3 live charts" is a claim about a device and
   * this file cannot make it from a test. It records the PEAK, not the current
   * value — a budget is only broken once, and a readout that reported "3 now"
   * would look healthy a frame after mounting nine. */
  const peakRef = useRef(0)
  useEffect(() => {
    if (mountedIds.size > peakRef.current) peakRef.current = mountedIds.size
    try {
      window.__uctReviewFeed = {
        total: symbols.length,
        centre,
        live: mountedIds.size,
        peakLive: peakRef.current,
        budget: FEED_MAX_LIVE,
        snapshots: shotsRef.current.size(),
        density,
        heapMB: window.performance && window.performance.memory
          ? Math.round(window.performance.memory.usedJSHeapSize / 1048576) : null,
      }
    } catch { /* an instrument never breaks the surface it measures */ }
  }, [mountedIds, centre, symbols.length, density])

  const toggleDensity = useCallback(() => {
    setDensity((d) => {
      const next = d === 'tall' ? 'dense' : 'tall'
      try { localStorage.setItem(DENSITY_KEY, next) } catch { /* private mode */ }
      return next
    })
  }, [])

  const label = (session && session.label) || 'Review'

  return (
    <Sheet
      open
      onClose={onClose}
      variant="fullscreen"
      title={`${label} — ${symbols.length} charts`}
      ariaLabel={`${label} review feed`}
    >
      <div className={styles.wrap}>
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.densityBtn}
            data-testid="feed-density"
            aria-pressed={dense}
            onClick={toggleDensity}
          >
            {dense ? 'Two up' : 'One up'}
          </button>
        </div>
        <ul className={styles.scroll} ref={scrollRef} data-testid="feed-scroll">
          {symbols.map((sym, i) => (
            <ReviewFeedCard
              key={sym}
              sym={sym}
              index={i}
              total={symbols.length}
              live={mountedIds.has(sym)}
              seen={reviewed.has(sym)}
              tf={tf}
              dense={dense}
              onOpen={onOpen}
              onBarsReady={readyFor(sym)}
              onSnapshot={onSnapshot}
              snapshot={shotsRef.current.get(sym)}
            />
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
