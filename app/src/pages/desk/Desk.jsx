// app/src/pages/desk/Desk.jsx
// "The Desk" — unified first-party content hub. One paid tab with four
// sub-sections: Videos · Articles · Posts · Team.
import { lazy, Suspense, useState, useEffect } from 'react'
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

export default function Desk() {
  const [params, setParams] = useSearchParams()
  const initial =
    params.get('section') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) ||
    'videos'
  const [active, setActive] = useState(
    SECTIONS.some((s) => s.key === initial) ? initial : 'videos',
  )

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
            onClick={() => setActive(s.key)}
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
