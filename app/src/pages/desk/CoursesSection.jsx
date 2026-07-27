// app/src/pages/desk/CoursesSection.jsx
// COURSES — a dedicated Desk section for structured course programs
// (kind='course'): full outlines of modules and lessons recorded FOR the
// course, populated over time via planned "to record" slots. Distinct from
// the Videos section's Learning Paths (kind='track'), which curate the
// existing library. Same data rails as Videos: GET /paths (admins ?all=1 for
// drafts), steps resolved against the loaded library, progress client-side,
// playback only via videoStore.play. PathView is reused wholesale — syllabus,
// planned rows, and the admin editor behave identically here.
import { useState, useMemo, useCallback, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import DeskSectionSkeleton from './DeskSectionSkeleton'
import VideoDockSlot from '../../components/video/VideoDockSlot'
import { play as playVideo } from '../../components/video/videoStore'
import { subscribe, getSnapshot } from './videoProgress'
import PathView, { PathViewSkeleton } from './PathView'
import UIcon from '../../components/ui/UIcon'
import {
  computeCourseStats,
  resolvePathRows,
  NewPathSheet,
} from './VideosSection'
import s from './VideosSection.module.css'
import cs from './CoursesSection.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export default function CoursesSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [searchParams, setSearchParams] = useSearchParams()
  const [newOpen, setNewOpen] = useState(false)
  const [editSlug, setEditSlug] = useState(null)

  const { data, isLoading } = useSWR('/api/education/videos', fetcher)
  const { data: pathsData, error: pathsError, mutate: mutatePaths } = useSWR(
    isAdmin ? '/api/education/paths?all=1' : '/api/education/paths',
    fetcher,
  )
  const categories = useMemo(
    () => (Array.isArray(data?.categories) ? data.categories : []),
    [data],
  )

  // kind='course' only — tracks belong to the Videos landing. Members get
  // enabled courses with at least one lesson (recorded or planned); admins
  // see every course, drafts included.
  const courses = useMemo(() => {
    const all = resolvePathRows(pathsData?.paths, categories).filter(
      (p) => p.kind === 'course',
    )
    return isAdmin
      ? all
      : all.filter((p) => p.videos.length + p.plannedCount > 0)
  }, [pathsData, categories, isAdmin])

  const courseStats = useMemo(
    () => computeCourseStats(courses, progress),
    [courses, progress],
  )

  const allVideos = useMemo(
    () => categories.flatMap((c) => c.videos || []),
    [categories],
  )
  const nextSortOrder = useMemo(
    () =>
      courses.reduce(
        (m, p) => Math.max(m, Number.isFinite(p.sort_order) ? p.sort_order : -1),
        -1,
      ) + 1,
    [courses],
  )

  // ?path=<slug> within section=courses — same merge semantics as Videos
  // (a course open is a navigation; Back returns to the course grid).
  const pathParam = searchParams.get('path')
  const activePath = useMemo(
    () => (pathParam ? courses.find((p) => p.slug === pathParam) || null : null),
    [pathParam, courses],
  )
  const activeStats = useMemo(
    () =>
      activePath
        ? courseStats.find((c) => c.path.slug === activePath.slug) || null
        : null,
    [courseStats, activePath],
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
    setEditSlug(null)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('path')
        return next
      },
      { replace: false },
    )
  }, [setSearchParams])

  const pathPending =
    !!pathParam && !activePath && pathsData === undefined && !pathsError

  return (
    <div className={cs.page}>
      <VideoDockSlot />

      {(isLoading || pathPending) && (pathParam ? <PathViewSkeleton /> : <DeskSectionSkeleton cards={4} />)}

      {!isLoading && activePath && (
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
            setEditSlug(null)
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

      {!isLoading && !activePath && !pathPending && (
        <>
          <header className={cs.head}>
            <h2 className={cs.title}>Courses</h2>
            <p className={cs.sub}>
              Structured programs, recorded start to finish — every lesson
              built for its place in the sequence.
            </p>
            {isAdmin && (
              <button className={s.shelfAdminBtn} onClick={() => setNewOpen(true)}>
                <UIcon name="plus" size={12} gold={false} />
                New course outline
              </button>
            )}
          </header>

          {courseStats.length === 0 && (
            <p className={cs.empty}>
              {isAdmin
                ? 'No courses yet — create an outline and populate it as you record.'
                : 'Courses are being produced — check back soon.'}
            </p>
          )}

          <div className={s.pathsGrid}>
            {courseStats.map(({ path: p, done, total: count, started, pct, durLabel }) => (
              <button key={p.slug} className={s.pathCard} onClick={() => openPath(p.slug)}>
                <span className={`${s.pathKind} ${s.pathKindCourse}`}>
                  COURSE
                  {p.enabled === 0 && <span className={s.pathDraft}>DRAFT</span>}
                </span>
                <span className={s.pathName}>{p.name}</span>
                {p.blurb && <span className={s.pathBlurb}>{p.blurb}</span>}
                <span className={s.pathMeta}>
                  {count} lesson{count === 1 ? '' : 's'}
                  {p.plannedCount > 0 ? ` · ${p.plannedCount} to record` : ''}
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
        </>
      )}

      {isAdmin && newOpen && (
        <NewPathSheet
          lockKind="course"
          nextSortOrder={nextSortOrder}
          onClose={() => setNewOpen(false)}
          onCreated={async (created) => {
            setNewOpen(false)
            await mutatePaths()
            setEditSlug(created.slug)
            openPath(created.slug)
          }}
        />
      )}
    </div>
  )
}
