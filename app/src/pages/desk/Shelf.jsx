// app/src/pages/desk/Shelf.jsx
// YouTube-library building blocks for the Desk Videos landing.
//   YTCard  — borderless card: plain YouTube thumbnail (i.ytimg hqdefault) with
//             a duration pill + thin gold progress baseline, then title + one
//             dim meta line directly on the page background. No surfaces, no
//             borders, no poster logic (AI posters live only in the theater).
//   Shelf   — plain section header (bold name + dim count + "View all") over
//             ONE snap-scrolling row; "View all" expands the shelf to a grid.
// Every play routes through onPlay(list, index) with the shelf's display-order
// list so the theater's Up-Next rail keeps working.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import s from './VideosSection.module.css'

export const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export const fmtShortDate = (epoch) => {
  if (!epoch) return ''
  try {
    return new Date(epoch * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return ''
  }
}

// Watched = full bar (the YouTube convention) — no badge.
export const progressPct = (progress, video) => {
  const e = progress?.[video.youtube_id]
  if (!e) return 0
  if (e.done) return 100
  if (!(e.t >= 8) || !(e.d > 0)) return 0
  return Math.min(100, Math.round((e.t / e.d) * 100))
}

// One borderless YouTube-style card. kind='show' → meta is the publish date;
// anything else → duration (already pinned on the thumb, so meta may be empty).
export function YTCard({ video, onClick, progress, kind, deskThreads, isAdmin, onEdit, onDelete }) {
  const pct = progressPct(progress, video)
  const thread = deskThreads?.[String(video.id)]
  const meta = kind === 'show' ? fmtShortDate(video.created_at) : ''
  return (
    <article className={s.card}>
      <button className={s.thumbBtn} onClick={onClick} aria-label={`Play ${video.title}`}>
        <img className={s.thumb} src={ytThumb(video.youtube_id)} alt="" loading="lazy" />
        {video.duration && <span className={s.duration}>{video.duration}</span>}
        {pct > 0 && (
          <span className={s.progress} aria-hidden="true">
            <span className={s.progressFill} style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      <div className={s.cardBody}>
        <div className={s.cardTitle}>{video.title}</div>
        {(meta || thread) && (
          <div className={s.cardMeta}>
            {meta && <span>{meta}</span>}
            {thread && (
              <Link
                to={`/community/${thread.thread_id}`}
                className={s.cardMetaLink}
                onClick={(e) => e.stopPropagation()}
              >
                Discussion ({thread.reply_count})
              </Link>
            )}
          </div>
        )}
        {isAdmin && (
          <div className={s.cardAdmin}>
            <button className={s.adminLink} onClick={() => onEdit(video)}>Edit</button>
            <button className={`${s.adminLink} ${s.adminDanger}`} onClick={() => onDelete(video)}>
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

// entries: [{ video, list, index, kind }] in display order — list/index is the
// exact playVideo target so Continue Watching can point each card into its own
// category while category shelves point at their own display-order list.
export default function Shelf({
  name, entries, onPlay, progress, deskThreads, isAdmin, onEdit, onDelete, expandable = true,
}) {
  const [expanded, setExpanded] = useState(false)
  if (!entries.length) return null

  const card = (en) => (
    <YTCard
      video={en.video}
      kind={en.kind}
      onClick={() => onPlay(en.list, en.index)}
      progress={progress}
      deskThreads={deskThreads}
      isAdmin={isAdmin}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  )

  return (
    <section className={s.shelf}>
      <div className={s.shelfHead}>
        <h2 className={s.shelfName}>{name}</h2>
        <span className={s.shelfCount}>{entries.length}</span>
        {expandable && (
          <button
            className={s.viewAll}
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'View all'}
          </button>
        )}
      </div>
      {expanded ? (
        <div className={s.shelfGrid}>
          {entries.map((en) => <div key={en.video.id}>{card(en)}</div>)}
        </div>
      ) : (
        <div className={s.shelfRow} role="list" aria-label={name}>
          {entries.map((en) => (
            <div role="listitem" key={en.video.id} className={s.shelfItem}>
              {card(en)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
