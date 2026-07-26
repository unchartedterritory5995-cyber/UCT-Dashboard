// app/src/pages/desk/Shelf.jsx
// YouTube-library building blocks for the Desk Videos landing.
//   YTCard  — borderless card: plain YouTube thumbnail (i.ytimg hqdefault) with
//             a duration pill + thin gold progress baseline, then title + one
//             dim meta line directly on the page background. No surfaces, no
//             borders, no poster logic (AI posters live only in the theater).
//             Fresh videos (<5 days) carry a gold-outline NEW tag; finished
//             ones dim the thumb + carry a Watched tag.
//   Shelf   — plain section header (bold name + dim count + "View all") over
//             ONE snap-scrolling row; "View all" expands the shelf to a grid.
//             On hover-capable pointers the row gets floating circular paddles
//             that page it by ~80% of the visible width.
// Every play routes through onPlay(list, index) with the shelf's display-order
// list so the theater's Up-Next rail keeps working.
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
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

// NEW = published within the last 5 days (pure frontend off created_at).
const NEW_WINDOW_SECS = 5 * 86400
export const isNewVideo = (createdAt, nowMs = Date.now()) =>
  !!createdAt && createdAt > nowMs / 1000 - NEW_WINDOW_SECS

// Watched = full bar (the YouTube convention) + dimmed thumb + Watched tag.
export const progressPct = (progress, video) => {
  const e = progress?.[video.youtube_id]
  if (!e) return 0
  if (e.done) return 100
  if (!(e.t >= 8) || !(e.d > 0)) return 0
  return Math.min(100, Math.round((e.t / e.d) * 100))
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Tracks whether a horizontal scroll box has content hidden past either edge.
// Takes the ELEMENT (from a callback ref → state), not a ref object: the row
// mounts only after the catalog loads, so a ref-object effect would run once
// against null and never re-arm. jsdom reports zero scrollWidth, so both
// edges read false in tests (paddles simply don't render there — exactly
// like an unoverflowed row in production).
// contentKey: pass anything that changes when the row's CONTENT changes (e.g.
// item count) — a content swap can move scrollWidth without resizing the box,
// which ResizeObserver can't see.
export function useScrollEdges(el, contentKey = 0) {
  const [edges, setEdges] = useState({ left: false, right: false })
  useEffect(() => {
    if (!el) {
      setEdges((prev) => (prev.left || prev.right ? { left: false, right: false } : prev))
      return
    }
    let dead = false
    const update = () => {
      if (dead) return
      const max = el.scrollWidth - el.clientWidth
      const next = { left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 }
      setEdges((prev) =>
        prev.left === next.left && prev.right === next.right ? prev : next,
      )
    }
    update()
    // Late web-font swaps change chip/card widths without resizing the box.
    document.fonts?.ready?.then?.(update)
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      dead = true
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [el])
  return edges
}

// Smooth-page a scroll box by a fraction of its visible width (±1 direction).
export const pageScroller = (el, dir, fraction) => {
  if (!el) return
  el.scrollBy?.({
    left: dir * el.clientWidth * fraction,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
}

// One borderless YouTube-style card. kind='show' → meta is the publish date;
// anything else → duration (already pinned on the thumb, so meta may be empty).
export function YTCard({ video, onClick, progress, kind, deskThreads, isAdmin, onEdit, onDelete }) {
  const pct = progressPct(progress, video)
  const watched = !!progress?.[video.youtube_id]?.done
  const isNew = isNewVideo(video.created_at)
  const thread = deskThreads?.[String(video.id)]
  const meta = kind === 'show' ? fmtShortDate(video.created_at) : ''
  return (
    <article className={s.card}>
      <button className={s.thumbBtn} onClick={onClick} aria-label={`Play ${video.title}`}>
        <img
          className={`${s.thumb} ${watched ? s.thumbWatched : ''}`}
          src={ytThumb(video.youtube_id)}
          alt=""
          loading="lazy"
        />
        {isNew && !watched && <span className={s.newBadge}>NEW</span>}
        {watched && <span className={s.watchedTag}>Watched</span>}
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
  name, entries, onPlay, progress, deskThreads, isAdmin, onEdit, onDelete,
  expandable = true, showCount = true,
}) {
  const [expanded, setExpanded] = useState(false)
  const [rowEl, setRowEl] = useState(null)
  const edges = useScrollEdges(rowEl, entries.length)
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
        {showCount && <span className={s.shelfCount}>{entries.length}</span>}
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
        <div className={s.shelfRowWrap}>
          <div className={s.shelfRow} ref={setRowEl} role="list" aria-label={name}>
            {entries.map((en) => (
              <div role="listitem" key={en.video.id} className={s.shelfItem}>
                {card(en)}
              </div>
            ))}
          </div>
          {edges.left && (
            <button
              className={`${s.shelfNav} ${s.shelfNavL}`}
              aria-label={`Scroll ${name} back`}
              onClick={() => pageScroller(rowEl,-1, 0.8)}
            >
              <span className={s.flipX} aria-hidden="true">
                <UIcon name="chevronRight" size={18} gold={false} />
              </span>
            </button>
          )}
          {edges.right && (
            <button
              className={`${s.shelfNav} ${s.shelfNavR}`}
              aria-label={`Scroll ${name} forward`}
              onClick={() => pageScroller(rowEl,1, 0.8)}
            >
              <UIcon name="chevronRight" size={18} gold={false} />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
