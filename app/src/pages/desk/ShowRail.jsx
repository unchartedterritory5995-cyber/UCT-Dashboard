// app/src/pages/desk/ShowRail.jsx
// One show = one horizontal rail of episode cards, newest-first, with a gold
// marquee header. "View all" swaps the rail for the full grid (legacy card
// classes) where the per-card admin Edit/Delete + Discussion links live.
// Every play routes through onPlay(list, index) with the rail's display-order
// list so the theater's Up-Next rail keeps working.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import BrandBadge from '../../components/video/BrandBadge'
import { PlayIcon } from '../education/icons'
import styles from '../EducationalVideos.module.css'
import s from './VideosSection.module.css'

// Poster-first card image: /poster 404s until generated → onError falls back
// to the YouTube thumb. Shared by rail cards, grid cards, and the library.
export function CardImage({ video, className }) {
  const [src, setSrc] = useState(`/api/education/videos/${video.id}/poster`)
  return (
    <img
      className={className || s.cardImg}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setSrc(`https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`)}
    />
  )
}

const pctFor = (progress, video) => {
  const e = progress?.[video.youtube_id]
  if (!e || e.done || !(e.t >= 8) || !(e.d > 0)) return 0
  return Math.min(100, Math.round((e.t / e.d) * 100))
}

// Full-size grid card (legacy theater-era classes) — used by the expanded
// show view and the library blocks. Admin affordances live here.
export function VideoCard({ video, onClick, progress, deskThreads, isAdmin, onEdit, onDelete }) {
  const pct = pctFor(progress, video)
  const done = !!progress?.[video.youtube_id]?.done
  const thread = deskThreads?.[String(video.id)]
  return (
    <article className={styles.card}>
      <button className={styles.thumbBtn} onClick={onClick} aria-label={`Play ${video.title}`}>
        <CardImage video={video} className={styles.thumb} />
        <BrandBadge />
        <span className={styles.playOverlay} aria-hidden="true"><PlayIcon /></span>
        {video.duration && <span className={styles.duration}>{video.duration}</span>}
        {done && <span className={styles.watchedBadge} aria-label="Watched">✓ Watched</span>}
        {!done && pct > 0 && (
          <span className={styles.progressBar}>
            <span className={styles.progressFill} style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{video.title}</div>
        {(video.headline || video.description) && (
          <div className={styles.cardDesc}>{video.headline || video.description}</div>
        )}
        {thread && (
          <Link
            to={`/community/${thread.thread_id}`}
            className={styles.discussLink}
            onClick={(e) => e.stopPropagation()}
          >
            Discussion ({thread.reply_count})
          </Link>
        )}
      </div>
      {isAdmin && (
        <div className={styles.cardAdmin}>
          <button className={styles.adminLink} onClick={() => onEdit(video)}>Edit</button>
          <button className={styles.adminLinkDanger} onClick={() => onDelete(video)}>Delete</button>
        </div>
      )}
    </article>
  )
}

export default function ShowRail({ show, onPlay, progress, deskThreads, isAdmin, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  // Sessions append chronologically → newest = highest id.
  const videos = useMemo(() => [...(show.videos || [])].sort((a, b) => b.id - a.id), [show.videos])
  if (!videos.length) return null

  return (
    <section className={s.showSection}>
      <div className={s.showHead}>
        <div className={s.showHeadText}>
          <div className={s.showHeadMain}>
            <span className={s.showIcon} aria-hidden="true"><UIcon name="play" size={13} /></span>
            <h2 className={s.showName}>{show.name}</h2>
            <span className={s.showCount}>
              {videos.length} {videos.length === 1 ? 'episode' : 'episodes'}
            </span>
          </div>
          {show.blurb && <p className={s.showBlurb}>{show.blurb}</p>}
        </div>
        <button
          className={s.viewAllBtn}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse' : `View all (${videos.length})`}
        </button>
      </div>

      {!expanded ? (
        <div className={s.rail} role="list" aria-label={show.name}>
          {videos.map((v, i) => {
            const pct = pctFor(progress, v)
            const done = !!progress?.[v.youtube_id]?.done
            return (
              <div role="listitem" key={v.id} className={s.railItem}>
                <button
                  className={s.railCard}
                  onClick={() => onPlay(videos, i)}
                  aria-label={`Play ${v.title}`}
                >
                  <span className={s.railThumbWrap}>
                    <CardImage video={v} />
                    {v.duration && <span className={s.railDuration}>{v.duration}</span>}
                    {done && <span className={s.railWatched}>✓ Watched</span>}
                    {!done && pct > 0 && (
                      <span className={s.railProgress}>
                        <span className={s.railProgressFill} style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </span>
                  <span className={s.railTitle}>{v.title}</span>
                  {v.headline && <span className={s.railSub}>{v.headline}</span>}
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className={styles.grid}>
          {videos.map((v, i) => (
            <VideoCard
              key={v.id}
              video={v}
              onClick={() => onPlay(videos, i)}
              progress={progress}
              deskThreads={deskThreads}
              isAdmin={isAdmin}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  )
}
