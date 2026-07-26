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
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import s from './VideosSection.module.css'

export const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

// Per-show header glyph (UIcon name). Curated by show name — matched on a
// normalized key so punctuation/case variants ("Post-Market Recaps" vs "Post
// Market Recap") share one entry. Unknown/future shows fall back to 'play'.
// Library headers stay glyph-free — the glyph IS the shows/library
// differentiator, so never call this for kind !== 'show'.
const _normShow = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const showGlyphName = (name) => {
  const key = _normShow(name)
  if (key.includes('livetrading')) return 'chart' // candlesticks — the live tape
  if (key.includes('mentalgame')) return 'compass' // mind / navigation
  if (key.includes('postmarket')) return 'markets' // trend recap of the day
  if (key.includes('thought')) return 'chat' // spoken thoughts
  if (key.includes('evening')) return 'moon' // evening update
  return 'play'
}

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

// Short "Jul 24" form for header micro-meta (no year — it's always recent).
export const fmtMonthDay = (epoch) => {
  if (!epoch) return ''
  try {
    return new Date(epoch * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    })
  } catch {
    return ''
  }
}

// Continue-Watching meta: minutes remaining from the progress entry. Unknown
// duration → '' (no meta beats a wrong guess); floored at 1 so a nearly-done
// video never reads "0 min left".
export const timeLeftLabel = (progress, video) => {
  const e = progress?.[video?.youtube_id]
  if (!e || !(e.d > 0)) return ''
  const mins = Math.max(1, Math.round((e.d - (e.t || 0)) / 60))
  return `${mins} min left`
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
  }, [el, contentKey])
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
// timeLeftMeta (Continue Watching) swaps the meta line for remaining minutes.
export function YTCard({
  video, onClick, progress, kind, deskThreads, isAdmin, onEdit, onDelete,
  timeLeftMeta = false,
}) {
  const pct = progressPct(progress, video)
  const watched = !!progress?.[video.youtube_id]?.done
  const isNew = isNewVideo(video.created_at)
  const thread = deskThreads?.[String(video.id)]
  const meta = timeLeftMeta
    ? timeLeftLabel(progress, video)
    : kind === 'show' ? fmtShortDate(video.created_at) : ''
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
// updatedAt (show shelves): newest episode created_at → "· updated Jul 24"
// header micro-meta. timeLeftMeta (Continue Watching): cards show minutes left.
// icon (show shelves only): UIcon name rendered 16px gold INSIDE the h2, so it
// rides the name's own ellipsis container — shrink-safe on the tight phone
// expanded header. Cross-cut shelves (Continue/Recently) pass no icon even
// when their first entry happens to be a show video.
export default function Shelf({
  name, entries, onPlay, progress, deskThreads, isAdmin, onEdit, onDelete,
  expandable = true, showCount = true, updatedAt = 0, timeLeftMeta = false,
  icon = null,
}) {
  const [expanded, setExpanded] = useState(false)
  // Expanded-grid sort. Local per expansion (reset on collapse/expand), never
  // persisted. null = the shelf's own default order; shows read that default
  // as Newest (their rail is already newest-first), library keeps server order.
  const [sortDir, setSortDir] = useState(null)
  const [rowEl, setRowEl] = useState(null)
  // Content key = the exact id set, not just the count: a tag filter can swap
  // a row to a different same-size subset without the node remounting.
  const edges = useScrollEdges(rowEl, entries.map((en) => en.video.id).join(','))
  const isShowShelf = entries[0]?.kind === 'show'
  const effSort = sortDir ?? (isShowShelf ? 'new' : null)
  // Sorted view for the expanded grid. Rebuilds list/index so plays route
  // through the order the member is actually looking at (Up Next coherence) —
  // safe because every expandable shelf's entries share one display list.
  const gridEntries = useMemo(() => {
    if (!expanded || !effSort) return entries
    const dir = effSort === 'new' ? -1 : 1
    const vids = [...entries]
      .sort((a, b) => {
        const ka = a.video.created_at || 0
        const kb = b.video.created_at || 0
        return dir * ((ka - kb) || (a.video.id - b.video.id))
      })
      .map((en) => en.video)
    return vids.map((v, i) => ({ video: v, list: vids, index: i, kind: entries[0].kind }))
  }, [entries, expanded, effSort])
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
      timeLeftMeta={timeLeftMeta}
    />
  )

  return (
    <section className={s.shelf}>
      {/* shelfHeadExpanded: phone hides the updated micro-meta while the sort
          toggle occupies the row — one line must always fit at 390px. */}
      <div className={expanded ? `${s.shelfHead} ${s.shelfHeadExpanded}` : s.shelfHead}>
        <h2 className={s.shelfName}>
          {icon && (
            <UIcon name={icon} size={16} className={s.shelfGlyph} data-glyph={icon} />
          )}
          {name}
        </h2>
        {showCount && <span className={s.shelfCount}>{entries.length}</span>}
        {updatedAt > 0 && (
          <span className={s.shelfUpdated}>· updated {fmtMonthDay(updatedAt)}</span>
        )}
        {expandable && expanded && (
          <span className={s.sortToggle} role="group" aria-label={`Sort ${name}`}>
            <button
              className={`${s.sortBtn} ${effSort === 'new' ? s.sortBtnActive : ''}`}
              aria-pressed={effSort === 'new'}
              onClick={() => setSortDir('new')}
            >
              Newest
            </button>
            <span className={s.sortSep} aria-hidden="true">·</span>
            <button
              className={`${s.sortBtn} ${effSort === 'old' ? s.sortBtnActive : ''}`}
              aria-pressed={effSort === 'old'}
              onClick={() => setSortDir('old')}
            >
              Oldest
            </button>
          </span>
        )}
        {expandable && (
          <button
            className={s.viewAll}
            onClick={() => { setExpanded((e) => !e); setSortDir(null) }}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'View all'}
          </button>
        )}
      </div>
      {expanded ? (
        <div className={s.shelfGrid}>
          {gridEntries.map((en) => <div key={en.video.id}>{card(en)}</div>)}
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
              onClick={() => pageScroller(rowEl, -1, 0.8)}
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
              onClick={() => pageScroller(rowEl, 1, 0.8)}
            >
              <UIcon name="chevronRight" size={18} gold={false} />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
