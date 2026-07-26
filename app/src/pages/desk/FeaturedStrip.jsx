// app/src/pages/desk/FeaturedStrip.jsx
// Slim YouTube-channel-style "featured" strip for the latest episode of the
// flagship show (replaces the old cinematic hero). One quiet surface: small
// 16:9 YouTube thumb on the left, title + date + a Resume/Play button beside
// it. No backdrop image, no giant type — the gold accent lives ONLY on the
// button and the progress baseline. Plays through onPlay(list, index).
import UIcon from '../../components/ui/UIcon'
import { ytThumb, fmtShortDate, progressPct } from './Shelf'
import s from './VideosSection.module.css'

export default function FeaturedStrip({ video, list, index, onPlay, progress, showName }) {
  if (!video) return null
  const entry = progress?.[video.youtube_id]
  const resumable = !!entry && !entry.done && entry.t >= 8
  const pct = progressPct(progress, video)
  const dateText = fmtShortDate(video.created_at)
  const play = () => onPlay(list, index)

  return (
    <section className={s.featured} aria-label={`Latest: ${video.title}`}>
      <button className={s.featuredThumbBtn} onClick={play} aria-label={`Play ${video.title}`}>
        <img className={s.thumb} src={ytThumb(video.youtube_id)} alt="" />
        {video.duration && <span className={s.duration}>{video.duration}</span>}
        {pct > 0 && (
          <span className={s.progress} aria-hidden="true">
            <span className={s.progressFill} style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      <div className={s.featuredBody}>
        <div className={s.featuredLabel}>Latest — {showName}</div>
        <div className={s.featuredTitle}>{video.title}</div>
        {dateText && <div className={s.featuredDate}>{dateText}</div>}
        <button className={s.featuredCta} onClick={play}>
          <UIcon name="play" size={13} gold={false} />
          {resumable ? `Resume${pct ? ` · ${pct}%` : ''}` : 'Play'}
        </button>
      </div>
    </section>
  )
}
