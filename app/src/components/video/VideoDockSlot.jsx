// Placeholder the Desk Videos section renders where the "theater" lives. It
// reserves a 16:9 box (the GlobalVideoLayer host overlays it) and reports that
// box's rect to the store; on unmount (the user navigated away) it clears the
// slot, which flips the store to the floating mini. Also renders the rich
// browsing chrome — current title/description + Up-Next rail — that only makes
// sense on the Desk.
import { useEffect, useRef, useSyncExternalStore, useCallback } from 'react'
import { subscribe, getSnapshot, registerDockSlot, clearDockSlot, playIndex } from './videoStore'
import styles from './VideoDockSlot.module.css'

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export default function VideoDockSlot() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { list, index, mode } = snap
  const active = mode !== 'closed' && list.length > 0
  const boxRef = useRef(null)

  const report = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    registerDockSlot({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    if (!active) return
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
  }, [active, report])

  if (!active) return null

  const current = list[index]
  const upcoming = list.slice(index + 1)

  return (
    <div className={styles.theater}>
      {/* Reserved 16:9 box the fixed player host positions itself over. */}
      <div ref={boxRef} className={styles.dockBox} aria-label={`Now playing: ${current.title}`} />
      <div className={styles.meta}>
        <div className={styles.title}>{current.title}</div>
        {current.description && <p className={styles.desc}>{current.description}</p>}
      </div>
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
