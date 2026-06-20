// app/src/pages/desk/VideosSection.jsx
// The Educational Videos library — now the "Videos" section of The Desk hub.
// Videos live unlisted on YouTube; we embed via youtube-nocookie.com. Admins
// manage the catalog inline (add/edit/remove) — no code edits to add a video.
import { useState, useMemo, useCallback, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from '../../components/mobile/Sheet'
import { GraduationIcon, PlayIcon, PlusIcon, SearchIcon } from '../education/icons'
import VideoPlayer from './VideoPlayer'
import { subscribe, getSnapshot } from './videoProgress'
import styles from '../EducationalVideos.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

// Curated learning-path order for the firm's library sections. Categories not
// listed here fall to the end, alphabetically (the API returns them A→Z).
const CATEGORY_ORDER = [
  'Mindset & Psychology',
  'Market Analysis & Breadth',
  'Setups & Strategies',
  'Technical Analysis & Relative Strength',
  'Risk & Trade Management',
  'Scanning, Watchlists & Stock Selection',
  'Options & Flow',
  'Workshops & Fireside Chats',
  'Interviews',
  'Post-Market Recaps',
  'Live Sessions',
]
const orderRank = (name) => {
  const i = CATEGORY_ORDER.indexOf(name)
  return i === -1 ? CATEGORY_ORDER.length : i
}

export default function VideosSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data, error, isLoading, mutate } = useSWR('/api/education/videos', fetcher)
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState(null) // null = All
  const [playing, setPlaying] = useState(null)
  const [editing, setEditing] = useState(null)
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Categories in curated learning-path order.
  const categories = useMemo(() => {
    const cats = data?.categories || []
    return [...cats].sort(
      (a, b) => orderRank(a.name) - orderRank(b.name) || a.name.localeCompare(b.name),
    )
  }, [data])
  const total = data?.total ?? 0

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

      {!isLoading && continueWatching.length > 0 && (
        <div className={styles.continueRow}>
          <div className={styles.continueHead}>Continue watching</div>
          <div className={styles.upNextRail}>
            {continueWatching.map((cw) => (
              <button
                key={cw.video.youtube_id}
                className={styles.upNextItem}
                onClick={() => setPlaying({ list: cw.list, index: cw.index })}
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

      {isLoading && <div className={styles.note}>Loading…</div>}
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
                  onClick={() => setPlaying({ list: cat.videos, index: vi })}
                  aria-label={`Play ${v.title}`}
                >
                  <img className={styles.thumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
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

      {playing && (
        <VideoPlayer
          list={playing.list}
          startIndex={playing.index}
          onClose={() => setPlaying(null)}
        />
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
