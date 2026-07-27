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
import FeaturedStrip from './FeaturedStrip'
import PathView, { PathViewSkeleton } from './PathView'
import Shelf, { YTCard, useScrollEdges, pageScroller, showGlyphName, ytThumb } from './Shelf'
import UIcon from '../../components/ui/UIcon'
import styles from '../EducationalVideos.module.css'
import s from './VideosSection.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const MAX_TAGS = 18

/* ── Deep library search — "Found inside videos" (r6) ──────────────────────
   Content matches (headline / chapter / transcript, plus any title matches
   the flat grid didn't surface) from GET /api/education/search, rendered as
   quiet rows below the title-match grid. Query < 3 chars → nothing. */

const DEEP_MIN_CHARS = 3
const DEEP_MAX_ROWS = 12
const DEEP_DEBOUNCE_MS = 400

// "14:32" / "1:02:05" for the seek chip (t = integer seconds).
export const fmtSeekTime = (t) => {
  const s = Math.max(0, Math.floor(Number(t) || 0))
  const two = (n) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

/* ── Courses (DB-backed paths) — duration helpers ───────────────────────────
   Video durations are display strings ("12:34" / "1:02:11"). A course card
   shows a "~Xh Ym" total only when enough of its lessons carry a parseable
   one — a mostly-unknown total would be a lie, so below the threshold the
   meta line quietly shows the lesson count alone. */

export const DURATION_COVERAGE_MIN = 0.7 // ≥70% of resolved steps must parse

// "mm:ss" or "h:mm:ss" → seconds; anything else → null (never NaN).
export const parseDuration = (str) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(str || '').trim())
  if (!m) return null
  const [, h, mm, ss] = m
  if (+ss > 59 || (h != null && +mm > 59)) return null
  return (h ? +h * 3600 : 0) + +mm * 60 + +ss
}

// Total seconds → "~2h 5m" / "~2h" / "~45m" (floored at 1 minute).
export const fmtCourseDuration = (secs) => {
  const mins = Math.max(1, Math.round((Number(secs) || 0) / 60))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return m > 0 ? `~${h}h ${m}m` : `~${h}h`
  return `~${m}m`
}

// Course name → kebab slug ("Tape Reading 101" → "tape-reading-101"). Must
// land inside the backend's _SLUG_RE (^[a-z0-9]+(-[a-z0-9]+)*$): lowercase,
// accents folded, every non-alphanumeric run collapsed to one hyphen, no
// leading/trailing hyphens. The slug is IMMUTABLE after create, so the New
// sheet shows it and keeps it editable until the POST.
export const slugifyPathName = (name) =>
  String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const PATH_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

// The backend wraps matched terms in literal <b>…</b> markers. We parse those
// markers OURSELVES and emit React nodes — every non-marker fragment becomes a
// plain text node React escapes, so no dangerouslySetInnerHTML and no reliance
// on upstream HTML-escaping (education_search._snippet does not escape).
export const renderSnippet = (snippet) =>
  String(snippet || '')
    .split(/<b>(.*?)<\/b>/g)
    .map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))

// Debounced (400ms) + AbortController'd fetch — never per-keystroke. Errors,
// non-OK responses and malformed payloads all clear to [] (fail-silent: title
// search keeps working, the deep section just doesn't render) — a genuine
// failure must never leave a PREVIOUS query's rows standing under new text.
// Only an abort (superseded keystroke / unmount) keeps the current rows, so
// mid-typing there's no clear-then-repaint flicker.
function useDeepSearch(query) {
  const [results, setResults] = useState([])
  const q = query.trim()
  const active = q.length >= DEEP_MIN_CHARS
  useEffect(() => {
    if (!active) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/education/search?q=${encodeURIComponent(q)}&limit=30`, {
        credentials: 'include',
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null)) // non-OK → null → [] below
        .then((j) => setResults(Array.isArray(j?.results) ? j.results : []))
        .catch((e) => {
          // Abort = superseded or unmounted → keep what's rendered.
          // Anything else is a real failure → drop stale rows.
          if (e?.name !== 'AbortError') setResults([])
        })
    }, DEEP_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q, active])
  return active ? results : []
}

export default function VideosSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data, error, isLoading, mutate } = useSWR('/api/education/videos', fetcher)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState(null) // library tag-chip filter
  const [filtersOpen, setFiltersOpen] = useState(false) // tag row visibility
  const [editing, setEditing] = useState(null)
  // Admin course management (Task 6): the New/Delete sheets on the landing +
  // the slug PathView should open in edit mode (set right after a create).
  const [newPathOpen, setNewPathOpen] = useState(false)
  const [managePathsOpen, setManagePathsOpen] = useState(false)
  const [editSlug, setEditSlug] = useState(null)
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Pull cross-device watch progress once on mount (merges into the local store).
  useEffect(() => { hydrateFromServer() }, [])

  // Server-ordered categories — shows first, then library, each by sort_order
  // (see api/routers/education.py). No client re-sort; render verbatim.
  const categories = useMemo(() => data?.categories || [], [data])
  const shows = useMemo(() => categories.filter((c) => c.kind === 'show'), [categories])
  const library = useMemo(() => categories.filter((c) => c.kind !== 'show'), [categories])
  const total = data?.total ?? 0

  // Chip-row overflow edges. Callback-ref STATE (not a ref object): the chip
  // row mounts only after the catalog loads, so edge detection must re-arm
  // when the element actually appears.
  const [chipRowEl, setChipRowEl] = useState(null)
  // Content key = the joined names (chip widths are name-driven, so a rename
  // at equal count still moves scrollWidth).
  const chipEdges = useScrollEdges(chipRowEl, categories.map((c) => c.name).join(','))

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
  const [searchParams, setSearchParams] = useSearchParams()
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

  // Category filter lives in the URL: ?cat=<name> (URL-decoded by
  // URLSearchParams). The URL is the single source of truth — no shadow state
  // to drift. An unknown/stale name is ignored gracefully (reads as All).
  // Coexists with ?v= (deep-link above, untouched) and ?section= (Desk.jsx).
  const catParam = searchParams.get('cat')
  const activeCat = useMemo(
    () => (catParam && categories.some((c) => c.name === catParam) ? catParam : null),
    [catParam, categories],
  )
  // Chip writes MERGE into the existing params (never clobber section=/v=)
  // with replace:true — chip clicks are a view filter, not navigation, so they
  // deliberately create NO history entries (Back leaves the page, it doesn't
  // replay every chip the member tried).
  const setActiveCat = useCallback(
    (name) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (name) next.set('cat', name)
          else next.delete('cat')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // `/` focuses the search input (YouTube's own shortcut) and suppresses the
  // browser quick-find. Guards: never while typing in an input/textarea/
  // contenteditable (the search box itself included — a typed "/" must land as
  // a character) and never while the admin VideoForm sheet is open. Reads
  // `editing` through a ref so the window listener registers exactly once per
  // mount — and is ALWAYS removed on unmount (a leaked listener would stack
  // one per route change).
  const searchRef = useRef(null)
  const editingRef = useRef(null)
  editingRef.current = !!editing || newPathOpen || managePathsOpen
  useEffect(() => {
    const onSlash = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (editingRef.current) return // Sheet/modal open (VideoForm / New / Delete)
      if (!searchRef.current) return // no catalog yet → no search input
      e.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener('keydown', onSlash)
    return () => window.removeEventListener('keydown', onSlash)
  }, [])

  // Escape inside the search input is two-stage: clear the query first, blur
  // second. Both stages stop propagation so the window-level Escape handlers
  // (theater close, intro skip) never double-act on the same press — Escape
  // behavior everywhere else is untouched.
  const onSearchKeyDown = useCallback((e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (e.currentTarget.value) setQuery('')
    else e.currentTarget.blur()
  }, [])

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

  // "Recently added": the 10 newest videos by created_at across ALL categories
  // — a cross-cut view (no dedupe against other shelves by design). Clicking a
  // card plays within the recently-added list itself so Up Next walks the same
  // newest-first cross-section the member is looking at.
  const recentEntries = useMemo(() => {
    const all = []
    for (const cat of categories) {
      const kind = cat.kind === 'show' ? 'show' : 'library'
      for (const v of cat.videos || []) {
        if (v.created_at) all.push({ video: v, kind })
      }
    }
    all.sort((a, b) => (b.video.created_at || 0) - (a.video.created_at || 0))
    const top = all.slice(0, 10)
    const list = top.map((e) => e.video)
    return top.map((e, i) => ({ video: e.video, list, index: i, kind: e.kind }))
  }, [categories])

  // Show shelves display (and play against) newest-first lists. updatedAt =
  // the newest episode's created_at → "· updated Jul 24" header micro-meta.
  const showShelves = useMemo(
    () =>
      shows.map((show) => {
        const list = [...(show.videos || [])].sort((a, b) => b.id - a.id)
        return {
          name: show.name,
          updatedAt: list.reduce((m, v) => Math.max(m, v.created_at || 0), 0),
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

  // Courses/tracks come from the DB now (GET /api/education/paths, seeded with
  // the six old Learning Paths on day one). Steps resolve against the loaded
  // library exactly as the old hardcoded memo did: unknown youtube_ids are
  // skipped, and a path that resolves fewer than 2 lessons is hidden from
  // MEMBERS. Admins additionally see the unfiltered set (resolvedPaths) — the
  // editor must reach brand-new/sub-2-lesson paths, and the Delete sheet must
  // list them.
  const { data: pathsData, error: pathsError, mutate: mutatePaths } = useSWR('/api/education/paths', fetcher)
  const resolvedPaths = useMemo(() => {
    const list = Array.isArray(pathsData?.paths) ? pathsData.paths : []
    if (!list.length || !categories.length) return []
    const byId = {}
    for (const cat of categories) for (const v of cat.videos || []) byId[v.youtube_id] = v
    return list.map((p) => ({
      ...p,
      videos: (p.steps || []).map((st) => byId[st.youtube_id]).filter(Boolean),
    }))
  }, [pathsData, categories])
  const paths = useMemo(
    () => resolvedPaths.filter((p) => p.videos.length >= 2),
    [resolvedPaths],
  )

  // Flat catalog for the editor's add-lesson search (steps may reference any
  // loaded video — shows included, exactly like the seeded paths do).
  const allVideos = useMemo(
    () => categories.flatMap((c) => c.videos || []),
    [categories],
  )

  // New paths land after the current highest sort_order (course-first display
  // ordering is the server's; sort_order only breaks ties within a kind).
  const nextSortOrder = useMemo(
    () =>
      resolvedPaths.reduce(
        (m, p) => Math.max(m, Number.isFinite(p.sort_order) ? p.sort_order : -1),
        -1,
      ) + 1,
    [resolvedPaths],
  )

  // Per-path progress + duration stats, all client-side from the existing
  // progress store (done flag, t/d per youtube_id). "In progress" = t≥8 and
  // not done (the store's own resume threshold). next = the most recently
  // touched in-progress lesson if any, else the first not-done one — the
  // truest "where I left off" in course order.
  const courseStats = useMemo(
    () =>
      paths.map((p) => {
        let done = 0
        let lastAt = 0
        let firstNotDone = -1
        let nextInProgress = -1
        let nextInProgressAt = -1
        p.videos.forEach((v, i) => {
          const e = progress[v.youtube_id]
          if (e?.done) {
            done += 1
            lastAt = Math.max(lastAt, e.at || 0)
            return
          }
          if (firstNotDone === -1) firstNotDone = i
          if (e && e.t >= 8) {
            lastAt = Math.max(lastAt, e.at || 0)
            if ((e.at || 0) > nextInProgressAt) {
              nextInProgressAt = e.at || 0
              nextInProgress = i
            }
          }
        })
        const total = p.videos.length
        const started = done > 0 || nextInProgress !== -1
        const parsed = p.videos.map((v) => parseDuration(v.duration)).filter((x) => x != null)
        return {
          path: p,
          done,
          total,
          started,
          mid: started && done < total, // some progress, not finished
          nextIndex: nextInProgress !== -1 ? nextInProgress : firstNotDone,
          lastAt,
          pct: total ? Math.round((done / total) * 100) : 0,
          durLabel:
            total > 0 && parsed.length / total >= DURATION_COVERAGE_MIN
              ? fmtCourseDuration(parsed.reduce((a, b) => a + b, 0))
              : '',
        }
      }),
    [paths, progress],
  )

  // The continue-strip surfaces ONE course: the most recently touched
  // mid-progress path (ties keep list order — course-first, then sort_order).
  const continueCourse = useMemo(() => {
    let best = null
    for (const cs of courseStats) {
      if (!cs.mid || cs.nextIndex === -1) continue
      if (!best || cs.lastAt > best.lastAt) best = cs
    }
    return best
  }, [courseStats])

  // Course open lives in the URL: ?path=<slug>. DELIBERATE contrast with
  // ?cat's replace:true — a chip is a view filter (no history), but opening a
  // course is a NAVIGATION, so replace:false gives it a history entry and
  // Back returns to the landing. Both writes MERGE via the functional
  // setSearchParams form (section=/v=/cat= are never clobbered).
  const pathParam = searchParams.get('path')
  // Members resolve against the ≥2-lesson set (unchanged); admins resolve
  // against ALL paths so a just-created empty course opens for editing.
  const openablePaths = isAdmin ? resolvedPaths : paths
  const activePath = useMemo(
    () => (pathParam ? openablePaths.find((p) => p.slug === pathParam) || null : null),
    [pathParam, openablePaths],
  )
  const openPath = useCallback(
    (slug) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('path', slug)
          return next
        },
        { replace: false },
      )
    },
    [setSearchParams],
  )
  const closePath = useCallback(() => {
    setEditSlug(null) // a reopened course starts in view mode
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('path')
        return next
      },
      { replace: false },
    )
  }, [setSearchParams])

  // PathView reuses the card stats (resume target, done count) — one source
  // of truth for the progress math.
  const activeStats = useMemo(
    () =>
      activePath ? courseStats.find((cs) => cs.path.slug === activePath.slug) || null : null,
    [courseStats, activePath],
  )

  // ?path is set but GET /paths hasn't resolved yet (data === undefined; a
  // failed fetch resolves to null and falls open to the landing). Rendering
  // the landing here would flash-and-swap once the course arrives — show the
  // PathView skeleton instead and suppress the landing chrome. The !pathsError
  // guard keeps the skeleton from sticking forever if the fetcher ever changes
  // to THROW on failure instead of resolving null — either failure shape now
  // falls open to the landing.
  const pathPending =
    !!pathParam && !activePath && pathsData === undefined && !pathsError

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

  // Deep results, minus anything the title-match grid is already showing
  // (no dupes), capped to a quiet dozen. Empty on landing (query gate).
  const deepResults = useDeepSearch(query)
  const deepRows = useMemo(() => {
    if (!deepResults.length) return []
    const visible = new Set()
    for (const c of filtered) for (const v of c.videos) visible.add(v.id)
    return deepResults.filter((r) => !visible.has(r.id)).slice(0, DEEP_MAX_ROWS)
  }, [deepResults, filtered])

  // Flat-grid result count — one dim line over the search results ("3 videos"
  // / "1 video"). Query-only: a bare category chip's section header already
  // carries its own count.
  const resultCount = filtered.reduce((n, c) => n + c.videos.length, 0)

  // Continue Watching — the first shelf, same card language as everything else.
  // Cards show remaining time ("23 min left") instead of a date/percent.
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
      timeLeftMeta
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
                ref={searchRef}
                className={styles.search}
                type="search"
                placeholder="Search videos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
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

      {/* One chip bar: All + categories in a single scrollable row (filled
          YouTube-style chips — counts live in the shelf headers, not here),
          edge-faded with paddle buttons when overflowed, and the Filters
          toggle (tag chips, default hidden) pinned at the right end.
          Hidden while a course (?path) is open — that's its own page — and
          while ?path is waiting on /paths (no landing-chrome flash). */}
      {!isLoading && total > 0 && categories.length > 1 && !activePath && !pathPending && (
        <>
          <div className={s.chipBar}>
            <div className={s.chipScroll}>
              <div
                className={[
                  s.chips,
                  chipEdges.left ? s.chipsFadeL : '',
                  chipEdges.right ? s.chipsFadeR : '',
                ].join(' ')}
                ref={setChipRowEl}
                role="tablist"
                aria-label="Filter videos by category"
              >
                <button
                  className={`${s.chip} ${!activeCat ? s.chipActive : ''}`}
                  onClick={() => setActiveCat(null)}
                  role="tab"
                  aria-selected={!activeCat}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c.name}
                    className={`${s.chip} ${activeCat === c.name ? s.chipActive : ''}`}
                    onClick={() => setActiveCat(activeCat === c.name ? null : c.name)}
                    role="tab"
                    aria-selected={activeCat === c.name}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              {chipEdges.left && (
                <button
                  className={`${s.chipNav} ${s.chipNavL}`}
                  aria-label="Scroll categories back"
                  onClick={() => pageScroller(chipRowEl, -1, 0.5)}
                >
                  <span className={s.flipX} aria-hidden="true">
                    <UIcon name="chevronRight" size={15} gold={false} />
                  </span>
                </button>
              )}
              {chipEdges.right && (
                <button
                  className={`${s.chipNav} ${s.chipNavR}`}
                  aria-label="Scroll categories forward"
                  onClick={() => pageScroller(chipRowEl, 1, 0.5)}
                >
                  <UIcon name="chevronRight" size={15} gold={false} />
                </button>
              )}
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
              {tags.map(([tag]) => (
                <button
                  key={tag}
                  className={`${s.chip} ${activeTag === tag ? s.chipActive : ''}`}
                  aria-pressed={activeTag === tag}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* While the catalog itself loads, a ?path deep-link gets the course
          silhouette instead of the card grid — the page keeps its shape. */}
      {isLoading && (pathParam ? <PathViewSkeleton /> : <DeskSectionSkeleton cards={8} />)}
      {error && <div className={styles.note}>Couldn’t load videos. Try again shortly.</div>}

      {!isLoading && total === 0 && (
        <EmptyState isAdmin={isAdmin} onAdd={() => setEditing({})} />
      )}

      {/* ── ?path=<slug> — a course is open: the PathView syllabus. The dock
             slot above stays the first child; PathView never autoplays (the
             ?v= effect keeps sole autoplay ownership). ── */}
      {!isLoading && total > 0 && activePath && (
        <PathView
          key={activePath.slug}
          path={activePath}
          stats={activeStats}
          progress={progress}
          onBack={closePath}
          onPlay={playVideo}
          isAdmin={isAdmin}
          allVideos={allVideos}
          onSaved={(saved) => {
            setEditSlug(null) // consumed — a later reopen starts in view mode
            // Optimistic close: paint the just-saved meta + steps into the
            // /paths cache immediately (the syllabus re-renders from it — no
            // one-round-trip stale flash), then revalidate to server truth.
            if (saved) {
              return mutatePaths(
                (cur) =>
                  cur && Array.isArray(cur.paths)
                    ? {
                        ...cur,
                        paths: cur.paths.map((row) =>
                          row.id === saved.id ? { ...row, ...saved } : row,
                        ),
                      }
                    : cur,
                { revalidate: true },
              )
            }
            return mutatePaths()
          }}
          initialEdit={isAdmin && editSlug === activePath.slug}
        />
      )}

      {/* ?path set, /paths still in flight → the course silhouette, never a
          landing flash (Task 4's known gap). */}
      {!isLoading && total > 0 && !activePath && pathPending && <PathViewSkeleton />}

      {/* ── Landing: featured strip → continue-your-course → Continue
             Watching → one shelf per category (shows, then library) →
             courses. ── */}
      {!isLoading && total > 0 && !activePath && !pathPending && landing && (
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

          {/* Continue-your-course — one quiet surface, only while a course is
              mid-progress (something done or in progress, not everything).
              Resume plays the next lesson against the full course list so the
              theater's Up Next keeps walking the syllabus. */}
          {continueCourse && (
            <section className={s.courseStrip} aria-label="Continue your course">
              <div className={s.courseStripBody}>
                <span className={s.courseStripEyebrow}>Continue your course</span>
                <span className={s.courseStripLine}>
                  <span className={s.courseStripName}>{continueCourse.path.name}</span>
                  <span className={s.courseStripNext}>
                    Next: {continueCourse.path.videos[continueCourse.nextIndex].title}
                  </span>
                </span>
              </div>
              <button
                className={s.courseStripResume}
                onClick={() =>
                  playVideo(continueCourse.path.videos, continueCourse.nextIndex)
                }
              >
                <UIcon name="play" size={12} gold={false} />
                Resume
              </button>
            </section>
          )}

          {continueShelf}

          {recentEntries.length > 0 && (
            <Shelf
              name="Recently added"
              entries={recentEntries}
              onPlay={playVideo}
              progress={progress}
              deskThreads={deskThreads}
              isAdmin={isAdmin}
              onEdit={setEditing}
              onDelete={handleDelete}
              expandable={false}
              showCount={false}
            />
          )}

          {showShelves.some((sh) => sh.entries.length > 0) && (
            <ZoneMarker label="SHOWS" />
          )}

          {showShelves.map((shelf) => (
            <Shelf
              key={shelf.name}
              name={shelf.name}
              icon={showGlyphName(shelf.name)}
              entries={shelf.entries}
              updatedAt={shelf.updatedAt}
              onPlay={playVideo}
              progress={progress}
              deskThreads={deskThreads}
              isAdmin={isAdmin}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          ))}

          {(libraryShelves.length > 0 || (activeTag && library.length > 0)) && (
            <ZoneMarker label="LIBRARY" />
          )}

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

          {/* Courses — the Learning Paths block's successor, same landing
              position. Quiet hairline cards: kind eyebrow (gold ONLY for the
              flagship 'course' kind — information, not decoration), name,
              one-line blurb, lesson count (+ ~total when enough durations
              parse), and a thin gold bar + "n of M" once started. Click
              navigates to the course (?path=<slug>) — it does NOT autoplay. */}
          {(courseStats.length > 0 || isAdmin) && (
            <section className={s.shelf}>
              <div className={s.shelfHead}>
                <h2 className={s.shelfName}>Courses</h2>
                {courseStats.length > 0 && (
                  <span className={s.shelfCount}>{courseStats.length}</span>
                )}
                {/* Admin course management — quiet hairline pills; members
                    never see them (the section itself only renders for
                    members when publishable cards exist, as before). */}
                {isAdmin && (
                  <span className={s.shelfAdminActions}>
                    <button
                      className={s.shelfAdminBtn}
                      onClick={() => setNewPathOpen(true)}
                    >
                      <UIcon name="plus" size={12} gold={false} />
                      New course
                    </button>
                    {resolvedPaths.length > 0 && (
                      <button
                        className={s.shelfAdminBtn}
                        onClick={() => setManagePathsOpen(true)}
                      >
                        Delete path
                      </button>
                    )}
                  </span>
                )}
              </div>
              {courseStats.length === 0 && isAdmin && (
                <div className={s.pathsEmptyNote}>
                  A course appears to members once it holds at least two
                  library lessons.
                </div>
              )}
              <div className={s.pathsGrid}>
                {courseStats.map(({ path: p, done, total: count, started, pct, durLabel }) => (
                  <button
                    key={p.slug}
                    className={s.pathCard}
                    onClick={() => openPath(p.slug)}
                  >
                    <span
                      className={`${s.pathKind} ${p.kind === 'course' ? s.pathKindCourse : ''}`}
                    >
                      {p.kind === 'course' ? 'COURSE' : 'TRACK'}
                    </span>
                    <span className={s.pathName}>{p.name}</span>
                    {p.blurb && <span className={s.pathBlurb}>{p.blurb}</span>}
                    <span className={s.pathMeta}>
                      {count} lesson{count === 1 ? '' : 's'}
                      {durLabel ? ` · ${durLabel}` : ''}
                    </span>
                    {started && (
                      <span className={s.pathProgressRow}>
                        <span className={s.pathBar} aria-hidden="true">
                          <span className={s.pathBarFill} style={{ width: `${pct}%` }} />
                        </span>
                        <span className={s.pathCount}>
                          {done} of {count}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Search / category filter active: flat filtered grid, same cards. ── */}
      {!isLoading && total > 0 && !activePath && !pathPending && !landing && (
        <>
          {continueShelf}

          {query.trim() && resultCount > 0 && (
            <div className={s.resultCount}>
              {resultCount} video{resultCount === 1 ? '' : 's'}
            </div>
          )}

          {filtered.length === 0 && (
            <div className={styles.note}>No videos match “{query}”.</div>
          )}

          {filtered.map((cat) => {
            const glyph = cat.kind === 'show' ? showGlyphName(cat.name) : null
            return (
            <section key={cat.name} className={s.shelf}>
              <div className={s.shelfHead}>
                <h2 className={s.shelfName}>
                  {glyph && (
                    <UIcon name={glyph} size={16} className={s.shelfGlyph} data-glyph={glyph} />
                  )}
                  {cat.name}
                </h2>
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
            )
          })}

          {/* Deep content matches live ONLY here (flat/search mode) — the
              landing branch above is untouched. */}
          <DeepResults rows={deepRows} onPlay={playVideo} />
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

      {isAdmin && newPathOpen && (
        <NewPathSheet
          onClose={() => setNewPathOpen(false)}
          nextSortOrder={nextSortOrder}
          onCreated={async (created) => {
            setNewPathOpen(false)
            await mutatePaths() // the new path must resolve before ?path opens
            setEditSlug(created.slug)
            openPath(created.slug)
          }}
        />
      )}

      {isAdmin && managePathsOpen && (
        <DeletePathsSheet
          paths={resolvedPaths}
          onClose={() => setManagePathsOpen(false)}
          onDeleted={() => mutatePaths()}
        />
      )}
    </div>
  )
}

// "Found inside videos" — quiet ROWS (not cards) under the same shelf-header
// register: small 16:9 thumb, one-line title, one snippet line with the match
// emphasized, and a dim seek chip when the match carries a timestamp. Clicking
// a row plays the video from the top (the theater's transcript panel already
// owns search-and-seek); the minimal video object is all the player needs.
function DeepResults({ rows, onPlay }) {
  if (!rows.length) return null
  return (
    <section className={s.shelf} aria-label="Found inside videos">
      <div className={s.shelfHead}>
        <h2 className={s.shelfName}>Found inside videos</h2>
        <span className={s.shelfCount}>{rows.length}</span>
      </div>
      <div className={s.deepList}>
        {rows.map((r) => (
          <button
            key={r.id}
            className={s.deepRow}
            aria-label={`Play ${r.title}`}
            onClick={() =>
              onPlay([{ id: r.id, youtube_id: r.youtube_id, title: r.title, category: r.category }], 0)
            }
          >
            <img className={s.deepThumb} src={ytThumb(r.youtube_id)} alt="" loading="lazy" />
            <span className={s.deepBody}>
              <span className={s.deepTitle}>{r.title}</span>
              <span className={s.deepSnippetLine}>
                {r.t != null && <span className={s.deepTime}>{fmtSeekTime(r.t)}</span>}
                <span className={s.deepSnippet}>{renderSnippet(r.snippet)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// Quiet zone seam — house eyebrow (11px letter-spaced gold) + a hairline rule
// fading right. Marks where the shows zone ends and the library begins, the way
// YouTube seams a channel page. Cross-cut shelves (Continue watching, Recently
// added) deliberately float ABOVE the first seam: they're views, not zones.
function ZoneMarker({ label }) {
  return (
    <div className={s.zoneMark}>
      <span className={s.zoneLabel}>{label}</span>
      <span className={s.zoneRule} aria-hidden="true" />
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

// New course/track — the VideoForm idiom (Sheet + inline error + busy). The
// slug auto-kebabs from the name until the admin touches it (it's the course
// URL and IMMUTABLE after create, so it stays visible and editable here).
// Create POSTs, then the parent revalidates /paths and opens ?path=<slug> in
// edit mode so lessons can be added immediately.
function NewPathSheet({ onClose, onCreated, nextSortOrder }) {
  const [form, setForm] = useState({ name: '', slug: '', kind: 'course', blurb: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const slugOk = PATH_SLUG_RE.test(form.slug)

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/education/paths', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: form.slug,
          name: form.name.trim(),
          blurb: form.blurb.trim() || null,
          kind: form.kind,
          sort_order: nextSortOrder,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Create failed')
      }
      onCreated(await r.json())
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} variant="auto" title="New course or track">
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            value={form.name}
            onChange={(e) => {
              const name = e.target.value
              setForm((f) => ({
                ...f,
                name,
                slug: slugTouched ? f.slug : slugifyPathName(name),
              }))
            }}
            placeholder="e.g. Tape Reading 101"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Slug — the course URL; permanent after create</span>
          <input
            className={styles.input}
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true)
              setForm((f) => ({ ...f, slug: e.target.value }))
            }}
            placeholder="tape-reading-101"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Kind</span>
          <select
            className={styles.input}
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
          >
            <option value="course">Course</option>
            <option value="track">Track</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Blurb (optional)</span>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.blurb}
            onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))}
          />
        </label>
        {err && <div className={styles.formErr}>{err}</div>}
        <div className={styles.formActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={styles.saveBtn}
            onClick={submit}
            disabled={busy || !form.name.trim() || !slugOk}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// Delete a path — a confirm-gated list of EVERY path (including sub-2-lesson
// drafts members never see), each row name + kind + authored-step count.
// window.confirm mirrors the handleDelete idiom; the sheet stays open so
// several drafts can be cleared in one visit.
function DeletePathsSheet({ paths, onClose, onDeleted }) {
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState('')

  const del = async (path) => {
    if (
      !window.confirm(
        `Delete “${path.name}”? Members lose the course page — the videos stay in the library.`,
      )
    )
      return
    setBusyId(path.id)
    setErr('')
    try {
      const r = await fetch(`/api/education/paths/${path.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Delete failed')
      }
      onDeleted()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Sheet open onClose={onClose} variant="auto" title="Delete a path">
      <div className={styles.form}>
        {paths.length === 0 && (
          <div className={s.pathsEmptyNote}>No courses or tracks yet.</div>
        )}
        {paths.map((path) => (
          <div key={path.id} className={s.manageRow}>
            <span className={s.manageRowBody}>
              <span className={s.manageRowName}>{path.name}</span>
              <span className={s.manageRowMeta}>
                {path.kind === 'course' ? 'Course' : 'Track'} ·{' '}
                {(path.steps || []).length} lesson
                {(path.steps || []).length === 1 ? '' : 's'}
              </span>
            </span>
            <button
              className={s.manageRowDelete}
              onClick={() => del(path)}
              disabled={busyId != null}
              aria-label={`Delete ${path.name}`}
            >
              Delete
            </button>
          </div>
        ))}
        {err && <div className={styles.formErr}>{err}</div>}
      </div>
    </Sheet>
  )
}
