// In-app video player for The Desk → Videos. Uses the YouTube IFrame Player API
// (not a raw iframe) so we own the experience: when a video ends we show OUR
// "Next up" card + autoplay the next video in the category, and an "Up next"
// rail lets users move through the library without ever hitting YouTube's
// off-site end-screen. Keeps users on the page.
import { useEffect, useRef, useState, useCallback } from 'react'
import Sheet from '../../components/mobile/Sheet'
import { PlayIcon } from '../education/icons'
import { useYouTubeApi } from './useYouTubeApi'
import { recordProgress, markWatched, resumeSeconds } from './videoProgress'
import styles from '../EducationalVideos.module.css'

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
const NEXT_COUNTDOWN = 6 // seconds shown on the "Next up" card before auto-advance

export default function VideoPlayer({ list, startIndex, onClose }) {
  const apiReady = useYouTubeApi()
  const [index, setIndex] = useState(startIndex)
  const hostRef = useRef(null)
  const playerRef = useRef(null)
  const currentIdRef = useRef(list[startIndex].youtube_id)
  const [ended, setEnded] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN)

  const current = list[index]
  const next = index + 1 < list.length ? list[index + 1] : null
  const upcoming = list.slice(index + 1)

  useEffect(() => { currentIdRef.current = list[index].youtube_id }, [list, index])

  // Persist the current playback position (best-effort; player may lack methods).
  const saveNow = useCallback(() => {
    const p = playerRef.current
    if (!p || !p.getCurrentTime || !p.getDuration) return
    try {
      const t = p.getCurrentTime()
      const d = p.getDuration()
      if (d > 0) recordProgress(currentIdRef.current, t, d)
    } catch { /* ignore */ }
  }, [])

  // Switch the playing video in-place (no off-site navigation, no player rebuild),
  // resuming from where the viewer left off.
  const playAt = useCallback(
    (i) => {
      if (i < 0 || i >= list.length) return
      saveNow() // checkpoint the outgoing video
      setEnded(false)
      setIndex(i)
      const id = list[i].youtube_id
      currentIdRef.current = id
      const p = playerRef.current
      if (p && p.loadVideoById) {
        p.loadVideoById({ videoId: id, startSeconds: resumeSeconds(id) })
      }
    },
    [list, saveNow],
  )

  // Build the player once the API is ready. We append a child node we own so
  // React never fights YouTube over the element it replaces with an <iframe>.
  useEffect(() => {
    if (!apiReady || !hostRef.current || playerRef.current) return
    const startId = list[startIndex].youtube_id
    const mount = document.createElement('div')
    hostRef.current.appendChild(mount)
    const player = new window.YT.Player(mount, {
      videoId: startId,
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        autoplay: 1,
        start: resumeSeconds(startId) || undefined, // resume where they left off
      },
      events: {
        onStateChange: (e) => {
          if (e.data === 0) {
            // ENDED
            markWatched(currentIdRef.current)
            setEnded(true)
          } else {
            if (e.data === 1) saveNow() // PLAYING — checkpoint duration early
            setEnded(false)
          }
        },
      },
    })
    playerRef.current = player
    // Checkpoint position every 5s so "Continue watching" survives a tab close.
    const ticker = setInterval(saveNow, 5000)
    return () => {
      clearInterval(ticker)
      saveNow()
      try { player.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }, [apiReady, list, startIndex, saveNow])

  // When a video ends and there's a next one, count down then auto-advance.
  useEffect(() => {
    if (!ended || !next) return
    setCountdown(NEXT_COUNTDOWN)
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(id)
          playAt(index + 1)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [ended, next, index, playAt])

  return (
    <Sheet open onClose={onClose} variant="auto" title={current.title}>
      <div className={styles.playerWrap}>
        <div className={styles.playerFrame}>
          <div ref={hostRef} className={styles.playerHost} />
          {!apiReady && <div className={styles.playerLoading}>Loading player…</div>}

          {ended && next && (
            <div className={styles.nextCard} role="dialog" aria-label="Next up">
              <div className={styles.nextLabel}>Next up</div>
              <button
                className={styles.nextThumbBtn}
                onClick={() => playAt(index + 1)}
                aria-label={`Play ${next.title}`}
              >
                <img className={styles.nextThumb} src={thumb(next.youtube_id)} alt="" />
                <span className={styles.nextPlay} aria-hidden="true"><PlayIcon /></span>
              </button>
              <div className={styles.nextTitle}>{next.title}</div>
              <div className={styles.nextActions}>
                <button className={styles.nextPlayBtn} onClick={() => playAt(index + 1)}>
                  Play now
                </button>
                <button className={styles.nextCancelBtn} onClick={() => setEnded(false)}>
                  Cancel ({countdown})
                </button>
              </div>
            </div>
          )}
          {ended && !next && (
            <div className={styles.nextCard}>
              <div className={styles.nextLabel}>You’ve reached the end of this section</div>
              <button className={styles.nextPlayBtn} onClick={onClose}>Back to library</button>
            </div>
          )}
        </div>

        {current.description && <p className={styles.playerDesc}>{current.description}</p>}

        {upcoming.length > 0 && (
          <div className={styles.upNext}>
            <div className={styles.upNextHead}>Up next in this section</div>
            <div className={styles.upNextRail}>
              {upcoming.map((v, i) => (
                <button
                  key={v.id ?? v.youtube_id}
                  className={styles.upNextItem}
                  onClick={() => playAt(index + 1 + i)}
                >
                  <span className={styles.upNextThumbWrap}>
                    <img className={styles.upNextThumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
                    <span className={styles.upNextPlay} aria-hidden="true"><PlayIcon /></span>
                  </span>
                  <span className={styles.upNextTitle}>{v.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
