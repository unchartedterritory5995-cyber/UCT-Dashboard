import { useEffect, useRef } from 'react'
import { useYouTubeApi } from '../../../desk/useYouTubeApi'
import styles from './NoteEditorPage.module.css'

// Seekable replacement for the Notebook's bare hero iframe. Mounts a YouTube
// IFrame-API player so clickable [MM:SS] chips (videoTimestamp nodes) can jump
// the video via the `uct:video-seek` event. Falls back to a plain iframe until
// the API is ready (or if it fails to load) so the video always shows.
export default function NoteVideoHero({ youtubeId, watchUrl }) {
  const ready = useYouTubeApi()
  const mountRef = useRef(null)
  const playerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!ready || !youtubeId || !mountRef.current) return
    if (!(window.YT && window.YT.Player)) return
    const player = new window.YT.Player(mountRef.current, {
      videoId: youtubeId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1 },
    })
    playerRef.current = player
    return () => {
      try { player.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }, [ready, youtubeId])

  useEffect(() => {
    const onSeek = (e) => {
      const secs = Math.max(0, Math.floor(Number(e.detail?.seconds) || 0))
      try { wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } catch { /* ignore */ }
      const p = playerRef.current
      if (p && typeof p.seekTo === 'function') {
        try { p.seekTo(secs, true); p.playVideo() } catch { /* ignore */ }
      }
    }
    window.addEventListener('uct:video-seek', onSeek)
    return () => window.removeEventListener('uct:video-seek', onSeek)
  }, [])

  if (!youtubeId) return null

  return (
    <div className={styles.videoHero} ref={wrapRef}>
      <div className={styles.videoHeroFrame}>
        {ready ? (
          <div ref={mountRef} />
        ) : (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&playsinline=1`}
            title="Session video"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
      </div>
      <a className={styles.videoHeroLink} href={watchUrl} target="_blank" rel="noreferrer">
        Watch on YouTube ↗
      </a>
    </div>
  )
}
