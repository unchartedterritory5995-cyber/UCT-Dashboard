// app/src/pages/desk/Desk.jsx
// "The Desk" — unified first-party content hub. One paid tab with four
// sub-sections: Videos · Articles · Posts · Team.
import { lazy, Suspense, useState, useEffect } from 'react'
import { preload } from 'swr'
import DeskSectionSkeleton from './DeskSectionSkeleton'
import { useSearchParams } from 'react-router-dom'
import { GraduationIcon, CourseIcon, ArticleIcon, PostIcon, TeamIcon } from '../education/icons'
import UIcon from '../../components/ui/UIcon'
import styles from './Desk.module.css'

const VideosSection = lazy(() => import('./VideosSection'))
const CoursesSection = lazy(() => import('./CoursesSection'))
const ArticlesSection = lazy(() => import('./ArticlesSection'))
const PostsSection = lazy(() => import('./PostsSection'))
const TeamSection = lazy(() => import('./TeamSection'))

const SECTIONS = [
  { key: 'videos', label: 'Videos', Icon: GraduationIcon, Comp: VideosSection },
  { key: 'courses', label: 'Courses', Icon: CourseIcon, Comp: CoursesSection },
  { key: 'articles', label: 'Articles', Icon: ArticleIcon, Comp: ArticlesSection },
  { key: 'posts', label: 'Posts', Icon: PostIcon, Comp: PostsSection },
  { key: 'team', label: 'Team', Icon: TeamIcon, Comp: TeamSection },
]

const STORAGE_KEY = 'desk_section'

// Videos and Courses both read the video library. Start that request with the
// page instead of after the section's lazy chunk has downloaded (~2-3s later on
// a cold load); the section's useSWR picks up the same in-flight promise.
const VIDEOS_KEY = '/api/education/videos'
const VIDEO_LIBRARY_SECTIONS = new Set(['videos', 'courses'])
const videosFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

function warmVideoLibrary(section) {
  if (!VIDEO_LIBRARY_SECTIONS.has(section)) return
  try {
    // The section awaits this same promise; the no-op handler only stops an
    // UNTAKEN failed head start being reported as unhandled.
    preload(VIDEOS_KEY, videosFetcher)?.catch?.(() => {})
  } catch {
    // A head start must never break the page.
  }
}

export default function Desk() {
  const [params, setParams] = useSearchParams()
  const initial =
    params.get('section') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) ||
    'videos'
  const [active, setActive] = useState(
    SECTIONS.some((s) => s.key === initial) ? initial : 'videos',
  )
  // Before paint, not in an effect: an effect runs after the section's lazy
  // import has already been kicked off by render.
  useState(() => warmVideoLibrary(active))

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, active) } catch { /* ignore */ }
    // keep ?section= in sync without stacking history entries
    if (params.get('section') !== active) {
      const next = new URLSearchParams(params)
      next.set('section', active)
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const Active = SECTIONS.find((s) => s.key === active) || SECTIONS[0]

  return (
    <div className={styles.hub}>
      <nav className={styles.tabBar} role="tablist" aria-label="The Desk sections">
        <div className={styles.brandRow}>
          <span className={styles.brandTag}><UIcon name="desk" size={18} style={{ verticalAlign: '-3px', marginRight: 8 }} />The Desk</span>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={active === s.key}
            className={[styles.tab, active === s.key ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => { warmVideoLibrary(s.key); setActive(s.key) }}
          >
            <span className={styles.tabIcon} aria-hidden="true"><s.Icon size={18} /></span>
            <span className={styles.tabLabel}>{s.label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.body}>
        <Suspense fallback={<DeskSectionSkeleton cards={8} />}>
          <Active.Comp />
        </Suspense>
      </div>
    </div>
  )
}
