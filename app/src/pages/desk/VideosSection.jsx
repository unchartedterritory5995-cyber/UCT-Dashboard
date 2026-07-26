// app/src/pages/desk/VideosSection.jsx
// The Educational Videos library — now the "Videos" section of The Desk hub.
// Videos live unlisted on YouTube; we embed via youtube-nocookie.com. Admins
// manage the catalog inline (add/edit/remove) — no code edits to add a video.
import { useState, useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import DeskSectionSkeleton from './DeskSectionSkeleton'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from '../../components/mobile/Sheet'
import { GraduationIcon, PlayIcon, PlusIcon, SearchIcon } from '../education/icons'
import VideoDockSlot from '../../components/video/VideoDockSlot'
import BrandBadge from '../../components/video/BrandBadge'
import { play as playVideo } from '../../components/video/videoStore'
import { subscribe, getSnapshot, hydrateFromServer } from './videoProgress'
import { LEARNING_PATHS } from './learningPaths'
import styles from '../EducationalVideos.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export default function VideosSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data, error, isLoading, mutate } = useSWR('/api/education/videos', fetcher)
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState(null) // null = All
  const [editing, setEditing] = useState(null)
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Pull cross-device watch progress once on mount (merges into the local store).
  useEffect(() => { hydrateFromServer() }, [])

  // Server-ordered categories — shows first, then library, each by sort_order
  // (see api/routers/education.py). No client re-sort; render verbatim.
  const categories = useMemo(() => data?.categories || [], [data])
  // Shows/Library split for the Task 6 landing components (kind === 'show' vs
  // everything else). Downstream consumers below keep using `categories`.
  // eslint-disable-next-line no-unused-vars -- consumed by Task 6's landing components
  const shows = useMemo(() => categories.filter((c) => c.kind === 'show'), [categories])
  // eslint-disable-next-line no-unused-vars -- consumed by Task 6's landing components
  const library = useMemo(() => categories.filter((c) => c.kind !== 'show'), [categories])
  const total = data?.total ?? 0

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
  const continueWatching = useMemo(() => {
    const items = []
    for (const cat of categories) {
      cat.videos.forEach((v, i) => {
        const e = progress[v.youtube_id]
        if (e && !e.done && e.t >= 8) {
          items.push({ video: v, list: cat.videos, index: i, at: e.at || 0, pct: e.d ? Math.min(100, Math.round((e.t / e.d) * 100)) : 0 })
        }
      })
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 8)
  }, [categories, progress])

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

      {!isLoading && !activeCat && !query.trim() && paths.length > 0 && (
        <div className={styles.pathsRow}>
          <div className={styles.continueHead}>Learning paths</div>
          <div className={styles.pathsGrid}>
            {paths.map((p) => (
              <button
                key={p.id}
                className={styles.pathCard}
                onClick={() => playVideo(p.videos, 0)}
              >
                <div className={styles.pathName}>{p.name}</div>
                <div className={styles.pathBlurb}>{p.blurb}</div>
                <div className={styles.pathMeta}>
                  <span className={styles.pathPlay} aria-hidden="true"><PlayIcon /></span>
                  Start path · {p.videos.length} videos
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!isLoading && continueWatching.length > 0 && (
        <div className={styles.continueRow}>
          <div className={styles.continueHead}>Continue watching</div>
          <div className={styles.upNextRail}>
            {continueWatching.map((cw) => (
              <button
                key={cw.video.youtube_id}
                className={styles.upNextItem}
                onClick={() => playVideo(cw.list, cw.index)}
              >
                <span className={styles.upNextThumbWrap}>
                  <img className={styles.upNextThumb} src={thumb(cw.video.youtube_id)} alt="" loading="lazy" />
                  <span className={styles.upNextPlay} aria-hidden="true"><PlayIcon /></span>
                  <span className={styles.progressBar}>
                    <span className={styles.progressFill} style={{ width: `${cw.pct}%` }} />
                  </span>
                </span>
                <span className={styles.upNextTitle}>{cw.video.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!isLoading && total > 0 && categories.length > 1 && (
        <div className={styles.catBar} role="tablist" aria-label="Filter videos by category">
          <button
            className={`${styles.catChip} ${!activeCat ? styles.catChipActive : ''}`}
            onClick={() => setActiveCat(null)}
            role="tab"
            aria-selected={!activeCat}
          >
            All <span className={styles.catCount}>{total}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              className={`${styles.catChip} ${activeCat === c.name ? styles.catChipActive : ''}`}
              onClick={() => setActiveCat(activeCat === c.name ? null : c.name)}
              role="tab"
              aria-selected={activeCat === c.name}
            >
              {c.name} <span className={styles.catCount}>{c.videos.length}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading && <DeskSectionSkeleton cards={8} />}
      {error && <div className={styles.note}>Couldn’t load videos. Try again shortly.</div>}

      {!isLoading && total === 0 && (
        <EmptyState isAdmin={isAdmin} onAdd={() => setEditing({})} />
      )}

      {!isLoading && total > 0 && filtered.length === 0 && (
        <div className={styles.note}>No videos match “{query}”.</div>
      )}

      {filtered.map((cat) => (
        <section key={cat.name} className={styles.section}>
          <h2 className={styles.sectionTitle}>{cat.name}</h2>
          <div className={styles.grid}>
            {cat.videos.map((v, vi) => (
              <article key={v.id} className={styles.card}>
                <button
                  className={styles.thumbBtn}
                  onClick={() => playVideo(cat.videos, vi)}
                  aria-label={`Play ${v.title}`}
                >
                  <img className={styles.thumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
                  <BrandBadge />
                  <span className={styles.playOverlay} aria-hidden="true"><PlayIcon /></span>
                  {v.duration && <span className={styles.duration}>{v.duration}</span>}
                  {progress[v.youtube_id]?.done && (
                    <span className={styles.watchedBadge} aria-label="Watched">✓ Watched</span>
                  )}
                  {!progress[v.youtube_id]?.done && progress[v.youtube_id]?.t >= 8 && progress[v.youtube_id]?.d > 0 && (
                    <span className={styles.progressBar}>
                      <span
                        className={styles.progressFill}
                        style={{ width: `${Math.min(100, Math.round((progress[v.youtube_id].t / progress[v.youtube_id].d) * 100))}%` }}
                      />
                    </span>
                  )}
                </button>
                <div className={styles.cardBody}>
                  <div className={styles.cardTitle}>{v.title}</div>
                  {v.description && <div className={styles.cardDesc}>{v.description}</div>}
                  {deskThreads?.[String(v.id)] && (
                    <Link
                      to={`/community/${deskThreads[String(v.id)].thread_id}`}
                      className={styles.discussLink}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Discussion ({deskThreads[String(v.id)].reply_count})
                    </Link>
                  )}
                </div>
                {isAdmin && (
                  <div className={styles.cardAdmin}>
                    <button className={styles.adminLink} onClick={() => setEditing(v)}>Edit</button>
                    <button className={styles.adminLinkDanger} onClick={() => handleDelete(v)}>
                      Delete
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

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
