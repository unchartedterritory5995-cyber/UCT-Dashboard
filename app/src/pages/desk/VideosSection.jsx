// app/src/pages/desk/VideosSection.jsx
// The Educational Videos library — the "Videos" section of The Desk hub, laid
// out as a clean custom-YouTube library: one chip bar (+ a Filters toggle for
// tag chips), a slim featured strip for the latest flagship episode, then one
// shelf per category (Continue Watching first). Plain YouTube thumbnails
// everywhere on the landing — AI recap posters appear only inside the theater.
// Videos live unlisted on YouTube; we embed via youtube-nocookie.com. Admins
// manage the catalog inline (add/edit/remove) — no code edits to add a video.
import { useState, useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import DeskSectionSkeleton from './DeskSectionSkeleton'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from '../../components/mobile/Sheet'
import { GraduationIcon, PlusIcon, SearchIcon } from '../education/icons'
import VideoDockSlot from '../../components/video/VideoDockSlot'
import { play as playVideo } from '../../components/video/videoStore'
import { subscribe, getSnapshot, hydrateFromServer } from './videoProgress'
import { LEARNING_PATHS } from './learningPaths'
import FeaturedStrip from './FeaturedStrip'
import Shelf, { YTCard } from './Shelf'
import UIcon from '../../components/ui/UIcon'
import styles from '../EducationalVideos.module.css'
import s from './VideosSection.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const MAX_TAGS = 18

export default function VideosSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data, error, isLoading, mutate } = useSWR('/api/education/videos', fetcher)
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState(null) // null = All
  const [activeTag, setActiveTag] = useState(null) // library tag-chip filter
  const [filtersOpen, setFiltersOpen] = useState(false) // tag row visibility
  const [editing, setEditing] = useState(null)
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Pull cross-device watch progress once on mount (merges into the local store).
  useEffect(() => { hydrateFromServer() }, [])

  // Server-ordered categories — shows first, then library, each by sort_order
  // (see api/routers/education.py). No client re-sort; render verbatim.
  const categories = useMemo(() => data?.categories || [], [data])
  const shows = useMemo(() => categories.filter((c) => c.kind === 'show'), [categories])
  const library = useMemo(() => categories.filter((c) => c.kind !== 'show'), [categories])
  const total = data?.total ?? 0

  // Featured strip = the newest episode of the first (flagship) show. Sessions
  // append chronologically, so newest = highest id. It plays against the same
  // newest-first list its shelf renders, keeping Up-Next coherent.
  const heroShow = shows[0] || null
  const heroList = useMemo(
    () => (heroShow ? [...(heroShow.videos || [])].sort((a, b) => b.id - a.id) : []),
    [heroShow],
  )
  const heroVideo = heroList[0] || null

  // Deep link: /desk?section=videos&v=<youtube_id> auto-plays that video once
  // the catalog loads (session-recap links in Discord/email point here). Fires
  // at most once per mount so it can't re-hijack the player after the user
  // closes it or picks something else.
  const [searchParams] = useSearchParams()
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current || !categories.length) return
    const ytid = searchParams.get('v')
    if (!ytid) { deepLinkDone.current = true; return }
    for (const cat of categories) {
      const vi = (cat.videos || []).findIndex((v) => v.youtube_id === ytid)
      if (vi !== -1) { playVideo(cat.videos, vi); break }
    }
    deepLinkDone.current = true
  }, [categories, searchParams])

  // Community "Discussion" links: one batch lookup of desk-seeded threads for
  // every video on the page. Flag-off → endpoint 503s → fetcher returns null →
  // no links render (the desired dark behavior).
  const allVideoIds = useMemo(
    () => (categories || []).flatMap((c) => c.videos.map((v) => v.id)).filter(Boolean),
    [categories],
  )
  const { data: deskThreads } = useSWR(
    allVideoIds.length ? `/api/community/desk-threads?ids=${allVideoIds.join(',')}` : null,
    fetcher,
  )

  // "Continue watching": started-but-unfinished videos, newest first. Each opens
  // the player inside its own category so the Up Next rail keeps working.
  const continueEntries = useMemo(() => {
    const items = []
    for (const cat of categories) {
      cat.videos.forEach((v, i) => {
        const e = progress[v.youtube_id]
        if (e && !e.done && e.t >= 8) {
          items.push({
            video: v, list: cat.videos, index: i,
            kind: cat.kind === 'show' ? 'show' : 'library',
            at: e.at || 0,
          })
        }
      })
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 8)
  }, [categories, progress])

  // Show shelves display (and play against) newest-first lists.
  const showShelves = useMemo(
    () =>
      shows.map((show) => {
        const list = [...(show.videos || [])].sort((a, b) => b.id - a.id)
        return {
          name: show.name,
          entries: list.map((v, i) => ({ video: v, list, index: i, kind: 'show' })),
        }
      }),
    [shows],
  )

  // Tag universe: union of video.tags across the library, with counts, capped
  // to the most frequent (ties break alphabetically for stability).
  const tags = useMemo(() => {
    const counts = new Map()
    for (const cat of library) {
      for (const v of cat.videos || []) {
        for (const t of v.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_TAGS)
  }, [library])

  // Library shelves keep server order; the tag filter narrows each shelf and
  // hides shelves with zero matches.
  const libraryShelves = useMemo(
    () =>
      library
        .map((cat) => {
          const list = !activeTag
            ? cat.videos || []
            : (cat.videos || []).filter((v) => (v.tags || []).includes(activeTag))
          return {
            name: cat.name,
            entries: list.map((v, i) => ({ video: v, list, index: i, kind: 'library' })),
          }
        })
        .filter((shelf) => shelf.entries.length > 0),
    [library, activeTag],
  )

  // Resolve curated learning paths against the loaded library (skip unknown ids).
  const paths = useMemo(() => {
    const byId = {}
    for (const cat of categories) for (const v of cat.videos) byId[v.youtube_id] = v
    return LEARNING_PATHS
      .map((p) => ({ ...p, videos: p.steps.map((id) => byId[id]).filter(Boolean) }))
      .filter((p) => p.videos.length >= 2)
  }, [categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return categories
      .filter((c) => !activeCat || c.name === activeCat)
      .map((c) => ({
        ...c,
        videos: !q
          ? c.videos
          : c.videos.filter(
              (v) =>
                (v.title || '').toLowerCase().includes(q) ||
                (v.description || '').toLowerCase().includes(q) ||
                (c.name || '').toLowerCase().includes(q),
            ),
      }))
      .filter((c) => c.videos.length > 0)
  }, [categories, query, activeCat])

  const handleDelete = useCallback(
    async (video) => {
      if (!window.confirm(`Remove "${video.title}"?`)) return
      await fetch(`/api/education/videos/${video.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      mutate()
    },
    [mutate],
  )

  // Landing = no search text and no category chip → featured strip + shelves.
  // Any query or category filter swaps in the flat filtered grid (as before).
  const landing = !query.trim() && !activeCat

  // Continue Watching — the first shelf, same card language as everything else.
  const continueShelf = !isLoading && continueEntries.length > 0 && (
    <Shelf
      name="Continue watching"
      entries={continueEntries}
      onPlay={playVideo}
      progress={progress}
      deskThreads={deskThreads}
      isAdmin={isAdmin}
      onEdit={setEditing}
      onDelete={handleDelete}
      expandable={false}
    />
  )

  return (
    <div className={styles.page}>
      <VideoDockSlot />
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <span className={styles.headerIcon} aria-hidden="true">
            <GraduationIcon />
          </span>
          <div>
            <div className={styles.eyebrow}>UCT INTELLIGENCE</div>
            <h1 className={styles.title}>Educational Videos</h1>
            <div className={styles.subtitle}>
              {total > 0
                ? `${total} video${total === 1 ? '' : 's'} across ${categories.length} ${
                    categories.length === 1 ? 'category' : 'categories'
                  }`
                : 'The firm’s trading education library'}
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          {total > 0 && (
            <label className={styles.searchWrap}>
              <span className={styles.searchIcon} aria-hidden="true"><SearchIcon /></span>
              <input
                className={styles.search}
                type="search"
                placeholder="Search videos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search educational videos"
              />
            </label>
          )}
          {isAdmin && (
            <button className={styles.addBtn} onClick={() => setEditing({})}>
              <PlusIcon /> Add video
            </button>
          )}
        </div>
      </div>

      {/* One chip bar: All + categories in a single scrollable row, with the
          Filters toggle (tag chips, default hidden) pinned at the right end. */}
      {!isLoading && total > 0 && categories.length > 1 && (
        <>
          <div className={s.chipBar}>
            <div className={s.chips} role="tablist" aria-label="Filter videos by category">
              <button
                className={`${s.chip} ${!activeCat ? s.chipActive : ''}`}
                onClick={() => setActiveCat(null)}
                role="tab"
                aria-selected={!activeCat}
              >
                All <span className={s.chipCount}>{total}</span>
              </button>
              {categories.map((c) => (
                <button
                  key={c.name}
                  className={`${s.chip} ${activeCat === c.name ? s.chipActive : ''}`}
                  onClick={() => setActiveCat(activeCat === c.name ? null : c.name)}
                  role="tab"
                  aria-selected={activeCat === c.name}
                >
                  {c.name} <span className={s.chipCount}>{c.videos.length}</span>
                </button>
              ))}
            </div>
            {landing && tags.length > 0 && (
              <button
                className={`${s.chip} ${s.filtersBtn} ${activeTag ? s.chipActive : ''}`}
                onClick={() => setFiltersOpen((o) => !o)}
                aria-expanded={filtersOpen}
              >
                <UIcon name="screener" size={13} gold={false} />
                Filters
              </button>
            )}
          </div>
          {landing && filtersOpen && tags.length > 0 && (
            <div className={s.tagRow} role="group" aria-label="Filter the library by tag">
              <button
                className={`${s.chip} ${!activeTag ? s.chipActive : ''}`}
                aria-pressed={!activeTag}
                onClick={() => setActiveTag(null)}
              >
                All
              </button>
              {tags.map(([tag, count]) => (
                <button
                  key={tag}
                  className={`${s.chip} ${activeTag === tag ? s.chipActive : ''}`}
                  aria-pressed={activeTag === tag}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                >
                  {tag} <span className={s.chipCount}>{count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {isLoading && <DeskSectionSkeleton cards={8} />}
      {error && <div className={styles.note}>Couldn’t load videos. Try again shortly.</div>}

      {!isLoading && total === 0 && (
        <EmptyState isAdmin={isAdmin} onAdd={() => setEditing({})} />
      )}

      {/* ── Landing: featured strip → Continue Watching → one shelf per
             category (shows, then library) → learning paths. ── */}
      {!isLoading && total > 0 && landing && (
        <>
          {heroVideo && (
            <FeaturedStrip
              video={heroVideo}
              list={heroList}
              index={0}
              onPlay={playVideo}
              progress={progress}
              showName={heroShow.name}
            />
          )}

          {continueShelf}

          {showShelves.map((shelf) => (
            <Shelf
              key={shelf.name}
              name={shelf.name}
              entries={shelf.entries}
              onPlay={playVideo}
              progress={progress}
              deskThreads={deskThreads}
              isAdmin={isAdmin}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          ))}

          {activeTag && libraryShelves.length === 0 && (
            <div className={styles.note}>No library videos tagged “{activeTag}”.</div>
          )}

          {libraryShelves.map((shelf) => (
            <Shelf
              key={shelf.name}
              name={shelf.name}
              entries={shelf.entries}
              onPlay={playVideo}
              progress={progress}
              deskThreads={deskThreads}
              isAdmin={isAdmin}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          ))}

          {paths.length > 0 && (
            <section className={s.shelf}>
              <div className={s.shelfHead}>
                <h2 className={s.shelfName}>Learning paths</h2>
                <span className={s.shelfCount}>{paths.length}</span>
              </div>
              <div className={s.pathsGrid}>
                {paths.map((p) => (
                  <button
                    key={p.id}
                    className={s.pathCard}
                    onClick={() => playVideo(p.videos, 0)}
                  >
                    <span className={s.pathName}>{p.name}</span>
                    <span className={s.pathBlurb}>{p.blurb}</span>
                    <span className={s.pathMeta}>
                      <UIcon name="play" size={12} gold={false} />
                      Start path · {p.videos.length} videos
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Search / category filter active: flat filtered grid, same cards. ── */}
      {!isLoading && total > 0 && !landing && (
        <>
          {continueShelf}

          {filtered.length === 0 && (
            <div className={styles.note}>No videos match “{query}”.</div>
          )}

          {filtered.map((cat) => (
            <section key={cat.name} className={s.shelf}>
              <div className={s.shelfHead}>
                <h2 className={s.shelfName}>{cat.name}</h2>
                <span className={s.shelfCount}>{cat.videos.length}</span>
              </div>
              <div className={s.shelfGrid}>
                {cat.videos.map((v, vi) => (
                  <YTCard
                    key={v.id}
                    video={v}
                    kind={cat.kind === 'show' ? 'show' : 'library'}
                    onClick={() => playVideo(cat.videos, vi)}
                    progress={progress}
                    deskThreads={deskThreads}
                    isAdmin={isAdmin}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {editing && (
        <VideoForm
          video={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            mutate()
          }}
          knownCategories={categories.map((c) => c.name)}
        />
      )}
    </div>
  )
}

function EmptyState({ isAdmin, onAdd }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true"><GraduationIcon /></span>
      <div className={styles.emptyTitle}>The video library is coming together</div>
      <div className={styles.emptyText}>
        {isAdmin
          ? 'Add your first educational video — paste a YouTube link, give it a title and category, and it shows up here for members.'
          : 'Our educational content is being loaded in. Check back shortly — there’s a lot on the way.'}
      </div>
      {isAdmin && (
        <button className={styles.addBtn} onClick={onAdd}>
          <PlusIcon /> Add the first video
        </button>
      )}
    </div>
  )
}

function VideoForm({ video, onClose, onSaved, knownCategories }) {
  const isNew = !video?.id
  const [form, setForm] = useState({
    youtube_url: video?.youtube_id ? `https://youtu.be/${video.youtube_id}` : '',
    title: video?.title || '',
    description: video?.description || '',
    category: video?.category || (knownCategories[0] || 'Getting Started'),
    duration: video?.duration || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      const url = isNew ? '/api/education/videos' : `/api/education/videos/${video.id}`
      const method = isNew ? 'POST' : 'PATCH'
      const r = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Save failed')
      }
      onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} variant="auto" title={isNew ? 'Add video' : 'Edit video'}>
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>YouTube link or video ID</span>
          <input
            className={styles.input}
            value={form.youtube_url}
            onChange={set('youtube_url')}
            placeholder="https://youtu.be/…"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input className={styles.input} value={form.title} onChange={set('title')} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Category</span>
          <input
            className={styles.input}
            value={form.category}
            onChange={set('category')}
            list="edu-categories"
            placeholder="e.g. Getting Started"
          />
          <datalist id="edu-categories">
            {knownCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Duration (optional)</span>
          <input
            className={styles.input}
            value={form.duration}
            onChange={set('duration')}
            placeholder="12:34"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Description (optional)</span>
          <textarea
            className={styles.textarea}
            value={form.description}
            onChange={set('description')}
            rows={3}
          />
        </label>
        {err && <div className={styles.formErr}>{err}</div>}
        <div className={styles.formActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add video' : 'Save changes'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
