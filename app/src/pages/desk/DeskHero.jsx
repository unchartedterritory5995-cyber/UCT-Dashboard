// app/src/pages/desk/DeskHero.jsx
// The Desk landing hero — a cinematic "latest episode" band for the newest
// episode of the flagship show. Poster backdrop under a left-to-right ink
// scrim, gold show-name eyebrow, headline (AI recap when present), date line,
// and a gold-gradient Play/Resume CTA. Playback goes through onPlay(list, index)
// (videoStore.play) so the theater's Up-Next rail keeps working.
import { useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import s from './VideosSection.module.css'

const fmtDate = (epoch) => {
  if (!epoch) return ''
  try {
    return new Date(epoch * 1000).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch {
    return ''
  }
}

// Poster-first backdrop: /poster 404s until generated → fall back to the
// YouTube thumb. Eager (not lazy) — it's the above-the-fold image.
function HeroImage({ video }) {
  const [src, setSrc] = useState(`/api/education/videos/${video.id}/poster`)
  return (
    <img
      className={s.heroMedia}
      src={src}
      alt=""
      onError={() => setSrc(`https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`)}
    />
  )
}

export default function DeskHero({ video, list, index, onPlay, progress, showName }) {
  if (!video) return null
  const entry = progress?.[video.youtube_id]
  const resumable = !!entry && !entry.done && entry.t >= 8
  const pct = resumable && entry.d > 0 ? Math.min(100, Math.round((entry.t / entry.d) * 100)) : 0
  const dateText = fmtDate(video.created_at)

  return (
    <section className={s.hero} aria-label={`Latest episode: ${video.title}`}>
      <HeroImage video={video} />
      <div className={s.heroScrim} aria-hidden="true" />
      <div className={s.heroContent}>
        <span className={s.heroEyebrow}>
          <UIcon name="play" size={12} />
          {showName} · Latest episode
        </span>
        <h2 className={s.heroTitle}>{video.headline || video.title}</h2>
        {(dateText || video.duration) && (
          <div className={s.heroDate}>
            {dateText}
            {dateText && video.duration ? ' · ' : ''}
            {video.duration || ''}
          </div>
        )}
        <button className={s.heroCta} onClick={() => onPlay(list, index)}>
          <UIcon name="play" size={15} gold={false} />
          {resumable ? `Resume${pct ? ` · ${pct}%` : ''}` : 'Play episode'}
        </button>
      </div>
      {resumable && pct > 0 && (
        <span className={s.heroProgress} aria-hidden="true">
          <span className={s.heroProgressFill} style={{ width: `${pct}%` }} />
        </span>
      )}
    </section>
  )
}
