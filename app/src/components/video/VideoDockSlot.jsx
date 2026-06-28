// Placeholder the Desk Videos section renders where the "theater" lives.
//
// When DOCKED, it reserves a 16:9 box (the GlobalVideoLayer host overlays it),
// reports that box's rect to the store, and shows the rich browsing chrome
// (title/description + Up-Next rail). Leaving the docked box — by navigating
// away OR by the user intentionally minimizing — clears the slot, which floats
// the player as a corner mini.
//
// When MINIMIZED (the user parked the player in the corner but is still on the
// Desk), it shows a slim "restore to theater" strip instead of fighting the
// user by yanking the video back into the theater.
import { useEffect, useRef, useSyncExternalStore, useCallback } from 'react'
import { subscribe, getSnapshot, registerDockSlot, clearDockSlot, playIndex, expand, seekTo } from './videoStore'
import { useVideoInsights } from '../../hooks/useVideoInsights'
import styles from './VideoDockSlot.module.css'

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

const fmtT = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`
}

export default function VideoDockSlot() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { list, index, mode } = snap
  const active = mode !== 'closed' && list.length > 0
  const docked = mode === 'docked'
  const boxRef = useRef(null)
  // Chapters + ticker-moments for the now-playing video (empty for non-session
  // videos or before generation). Hook runs unconditionally (pre early-return).
  const { chapters, tickerMoments } = useVideoInsights(active ? list[index]?.id : null)

  const report = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    registerDockSlot({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  // Only track the rect while the theater box is on screen (docked). Leaving
  // docked — minimize OR navigate-away (unmount) — runs the cleanup → clearDockSlot.
  useEffect(() => {
    if (!docked) return
    report()
    const onScrollOrResize = () => report()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null
    if (ro && boxRef.current) ro.observe(boxRef.current)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      if (ro) ro.disconnect()
      clearDockSlot()
    }
  }, [docked, report])

  if (!active) return null

  const current = list[index]

  // Minimized while still on the Desk → slim restore affordance, not the theater.
  if (!docked) {
    return (
      <button className={styles.restoreStrip} onClick={() => expand()} aria-label="Restore to theater">
        <span className={styles.restoreThumbWrap}>
          <img className={styles.restoreThumb} src={thumb(current.youtube_id)} alt="" />
        </span>
        <span className={styles.restoreText}>
          <span className={styles.restoreEyebrow}>Playing in mini-player</span>
          <span className={styles.restoreTitle}>{current.title}</span>
        </span>
        <span className={styles.restoreCta}>Restore to theater</span>
      </button>
    )
  }

  const upcoming = list.slice(index + 1)

  return (
    <div className={styles.theater}>
      {/* Reserved 16:9 box the fixed player host positions itself over. */}
      <div ref={boxRef} className={styles.dockBox} aria-label={`Now playing: ${current.title}`} />
      <div className={styles.meta}>
        <div className={styles.title}>{current.title}</div>
        {current.description && <p className={styles.desc}>{current.description}</p>}
      </div>

      {tickerMoments.length > 0 && (
        <div className={styles.tickersWrap}>
          <div className={styles.insHead}>Tickers covered</div>
          <div className={styles.tickerRow}>
            {tickerMoments.map((tm, i) => (
              <button
                key={`${tm.ticker}-${tm.t}-${i}`}
                className={styles.tickerChip}
                onClick={() => seekTo(tm.t)}
                title={tm.note ? `${tm.note} — jump to ${fmtT(tm.t)}` : `Jump to ${fmtT(tm.t)}`}
              >
                <span className={styles.tickerSym}>{tm.ticker}</span>
                <span className={styles.tickerTime}>{fmtT(tm.t)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {chapters.length > 0 && (
        <div className={styles.chaptersWrap}>
          <div className={styles.insHead}>Chapters</div>
          <ol className={styles.chapterList}>
            {chapters.map((c, i) => (
              <li key={`${c.t}-${i}`}>
                <button className={styles.chapterRow} onClick={() => seekTo(c.t)}>
                  <span className={styles.chapterTime}>{fmtT(c.t)}</span>
                  <span className={styles.chapterTitle}>{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className={styles.upNext}>
          <div className={styles.upNextHead}>Up next in this section</div>
          <div className={styles.upNextRail}>
            {upcoming.map((v, i) => (
              <button
                key={v.id ?? v.youtube_id}
                className={styles.upNextItem}
                onClick={() => playIndex(index + 1 + i)}
              >
                <span className={styles.upNextThumbWrap}>
                  <img className={styles.upNextThumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
                </span>
                <span className={styles.upNextTitle}>{v.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
