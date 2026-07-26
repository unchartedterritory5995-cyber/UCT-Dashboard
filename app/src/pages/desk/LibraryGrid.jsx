// app/src/pages/desk/LibraryGrid.jsx
// The evergreen library — quiet shelf register under the gold show rails.
// A tag-chip filter row (union of video.tags across the library, top 18 by
// frequency) sits above per-category blocks; selecting a tag filters every
// block and blocks with zero matches hide. Cards reuse the legacy grid/card
// classes via VideoCard (which carries the admin Edit/Delete + Discussion).
import { useMemo } from 'react'
import UIcon from '../../components/ui/UIcon'
import { VideoCard } from './ShowRail'
import styles from '../EducationalVideos.module.css'
import s from './VideosSection.module.css'

const MAX_TAGS = 18

export default function LibraryGrid({
  categories, activeTag, onTagChange, onPlay, progress, deskThreads, isAdmin, onEdit, onDelete,
}) {
  // Tag universe: union of video.tags across all library videos, with counts,
  // capped to the most frequent (ties break alphabetically for stability).
  const tags = useMemo(() => {
    const counts = new Map()
    for (const cat of categories) {
      for (const v of cat.videos || []) {
        for (const t of v.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_TAGS)
  }, [categories])

  // Per-block filtered views; empty blocks hide.
  const blocks = useMemo(
    () =>
      categories
        .map((cat) => ({
          ...cat,
          videos: !activeTag
            ? cat.videos
            : (cat.videos || []).filter((v) => (v.tags || []).includes(activeTag)),
        }))
        .filter((cat) => (cat.videos || []).length > 0),
    [categories, activeTag],
  )

  if (!categories.length) return null

  return (
    <div className={s.library}>
      <span className={s.libraryHead}>
        <UIcon name="library" size={13} />
        The Library
      </span>

      {tags.length > 0 && (
        <div className={s.tagRow} role="group" aria-label="Filter the library by tag">
          <span className={s.tagRowIcon} aria-hidden="true"><UIcon name="tag" size={13} /></span>
          <button
            className={`${s.tagChip} ${!activeTag ? s.tagChipActive : ''}`}
            aria-pressed={!activeTag}
            onClick={() => onTagChange(null)}
          >
            All
          </button>
          {tags.map(([tag, count]) => (
            <button
              key={tag}
              className={`${s.tagChip} ${activeTag === tag ? s.tagChipActive : ''}`}
              aria-pressed={activeTag === tag}
              onClick={() => onTagChange(activeTag === tag ? null : tag)}
            >
              {tag} <span className={s.tagCount}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {activeTag && blocks.length === 0 && (
        <div className={styles.note}>No library videos tagged “{activeTag}”.</div>
      )}

      {blocks.map((cat) => (
        <section key={cat.name} className={s.libBlock}>
          <div className={s.libBlockHead}>
            <span className={s.libBlockIcon} aria-hidden="true"><UIcon name="book" size={15} /></span>
            <h2 className={s.libBlockName}>{cat.name}</h2>
            <span className={s.libBlockCount}>{cat.videos.length}</span>
            {cat.blurb && <span className={s.libBlockBlurb}>{cat.blurb}</span>}
          </div>
          <div className={styles.grid}>
            {cat.videos.map((v, i) => (
              <VideoCard
                key={v.id}
                video={v}
                onClick={() => onPlay(cat.videos, i)}
                progress={progress}
                deskThreads={deskThreads}
                isAdmin={isAdmin}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
