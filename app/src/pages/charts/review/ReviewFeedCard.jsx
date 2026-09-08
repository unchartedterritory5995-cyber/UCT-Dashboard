import { memo, useEffect, useRef } from 'react'
import StockChart from '../../../components/StockChart'
import styles from './ReviewFeed.module.css'

/* ONE CARD OF THE REVIEW FEED.
 *
 * ⛔ IT DOES NOT DECIDE WHETHER IT IS LIVE. `live` arrives from the feed, which
 * owns the window and the mount queue; a card that decided for itself would be
 * the fiftieth independent opinion about a budget that only means anything
 * globally.
 *
 * ⛔ AND THE CHART IS THE GRID CELL'S RECIPE, not a new one. `backgroundWarm`
 * stays FALSE — flipping it re-runs StockChart's per-instance all-timeframe
 * warm chain, which does direct fetches and is precisely the herd the bounded
 * `_idbQueue` exists to prevent. Drawing tools, patterns, replay and compare are
 * off: this is a chart to RECOGNISE, and the full surface is one tap away.
 *
 * ⭐ `onBarsReady` RELEASES THE MOUNT SLOT, so a dead ticker cannot starve the
 * queue — StockChart fires it on a fatal error too, deliberately.
 */
function ReviewFeedCard({
  sym, index, total, live, seen, tf, dense,
  onOpen, onBarsReady, onSnapshot, snapshot,
}) {
  const bodyRef = useRef(null)

  /* SNAPSHOT ON THE WAY OUT. The effect's cleanup runs while the chart's
   * canvases are still in the DOM — one tick later they are gone and there is
   * nothing left to copy. ⛔ It must NOT run on every render, only when this
   * card stops being live, or a scroll would pay for a canvas read per frame. */
  useEffect(() => {
    if (!live) return undefined
    const el = bodyRef.current
    return () => { onSnapshot(sym, el) }
  }, [live, sym, onSnapshot])

  return (
    /* ⛔ `data-feed-index` LIVES ON THE CARD ITSELF, not on a wrapper. The feed's
       IntersectionObserver observes these elements, and a `<div>` wrapper inside
       a `<ul>` is invalid markup that jsdom accepts and a screen reader does
       not — the list would stop being a list. */
    <li
      className={`${styles.card} ${dense ? styles.cardDense : ''}`}
      data-feed-index={index}
      data-testid={`feed-card-${sym}`}
    >
      <button
        type="button"
        className={styles.cardHead}
        onClick={() => onOpen(index)}
        /* ⚠️ THE WHOLE HEAD IS THE TAP TARGET, and its name carries the
           position: a feed of forty identical "Open" buttons is unusable with a
           screen reader and untestable by role. */
        aria-label={`Open ${sym}, ${index + 1} of ${total}`}
      >
        <span className={styles.cardPos}>{index + 1}</span>
        <span className={styles.cardSym}>{sym}</span>
        {/* ⭐ THE ONLY BADGE THIS SURFACE CAN HONESTLY DRAW. The session records
            which symbols have been VISITED; it carries no per-symbol scan
            metadata, and inventing a signal badge here would put a second
            authority beside the surface that actually computed one. */}
        {seen && <span className={styles.cardSeen} data-testid={`feed-seen-${sym}`}>seen</span>}
      </button>

      <div className={styles.cardBody} ref={bodyRef} data-testid={`feed-body-${sym}`}>
        {live ? (
          <StockChart
            sym={sym}
            tf={tf}
            showDrawingTools={false}
            showSavedDrawings
            hideReplay
            hidePatterns
            hideCompare
            hideCountdown
            disablePatterns
            backgroundWarm={false}
            onBarsReady={onBarsReady}
            liveUpdates
            boldCandles
            userCandleColors
            colorByNetChange
            candlesOnTop
            markVolumeExtremes
            hidePriceLine
            hideWatermark
            hideJournalOverlay
            verticalLegend
            rightPadBars={4}
            dailyDefaultBars={dense ? 90 : 126}
            volumeSeparatePane
            volumePaneHeightPct={9}
            priceScaleTopMargin={0.12}
            priceScaleBottomMargin={0.10}
          />
        ) : snapshot ? (
          /* ⭐ THE LAST FRAME THIS CARD PAINTED. Not decoration: it is what makes
             a bounded feed read as continuous, so the member scrolls at reading
             speed instead of waiting for charts to catch up. */
          <img className={styles.cardShot} src={snapshot} alt="" aria-hidden="true"
            data-testid={`feed-shot-${sym}`} />
        ) : (
          <div className={styles.cardSkeleton} data-testid={`feed-skeleton-${sym}`} aria-hidden="true" />
        )}
      </div>
    </li>
  )
}

/* ⭐ MEMOISED, AND THE FEED HANDS EVERY PROP A STABLE IDENTITY. Scrolling
 * re-renders the feed constantly; without this, every card in a forty-symbol
 * list would re-render on each observer callback and the live charts would be
 * re-rendered along with them. Same contract as `GridChartCell`. */
export default memo(ReviewFeedCard)
