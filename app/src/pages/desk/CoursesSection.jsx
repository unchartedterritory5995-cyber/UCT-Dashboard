// app/src/pages/desk/CoursesSection.jsx
// COURSES — a dedicated Desk section for structured course programs
// (kind='course'): full outlines of modules and lessons recorded FOR the
// course, populated over time via planned "to record" slots. Distinct from
// the Videos section's Learning Paths (kind='track'), which curate the
// existing library. Same data rails as Videos: GET /paths (admins ?all=1 for
// drafts), steps resolved against the loaded library, progress client-side,
// playback only via videoStore.play. PathView is reused wholesale — syllabus,
// planned rows, and the admin editor behave identically here.
//
// STUDY (spec 2026-10-17 §4.1, §13.7 D2/D3, §13.2 T13/T14): the Study panel
// sits above the course cards, and the two course cards are the two
// curriculum DOORS — a 3px gold bar of units mastered plus "N tracks · M
// units · K recorded lessons" — opening that curriculum's trail as a
// sub-view (`?study=map&curriculum=…`, the `?path=` pattern). The recorded
// lessons stay one tap away from the trail (its "K recorded lessons" door
// opens the PathView syllabus). The flat CurriculumLessons list is retired
// from this page while Study is on; the reveal's lesson link replaces it.
//
// URL contract (D4): `?study=today|map|unit|practise&curriculum=<id>
// &unit=<id>&session=<id>`. This file resolves `map` and `unit` to the trail
// and writes `today` / `practise` from the panel's buttons; the drill that
// answers those two is mounted by the integrator, beside the panel.
import { useState, useMemo, useCallback, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import DeskSectionSkeleton from './DeskSectionSkeleton'
import VideoDockSlot from '../../components/video/VideoDockSlot'
import { play as playVideo } from '../../components/video/videoStore'
import { subscribe, getSnapshot } from './videoProgress'
import PathView, { PathViewSkeleton } from './PathView'
import CurriculumLessons from './CurriculumLessons'
import UIcon from '../../components/ui/UIcon'
import StudyPanel from '../study/StudyPanel'
import StudyLanding from '../study/StudyLanding'
import SkillTrail from '../study/SkillTrail'
import DrillPlayer from '../study/DrillPlayer'
import PractiseSheet from '../study/PractiseSheet'
import { useStudyMap, useStudyProfile, useStudyToday } from '../study/useStudy'
import { SESSIONS_URL, studyFetch } from '../study/useStudySession'
import { skillsById, curriculumIdForCourse, curriculumSummary, locateUnit, weekDots } from '../study/studyMap'
import {
  computeCourseStats,
  resolvePathRows,
  NewPathSheet,
} from './VideosSection'
import s from './VideosSection.module.css'
import cs from './CoursesSection.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const STUDY_KEYS = ['study', 'curriculum', 'unit', 'session']

export default function CoursesSection() {
  const { user, studyEnabled } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Kill-switch polarity (T10): only an explicit false from the server hides Study.
  const studyOn = studyEnabled !== false
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [searchParams, setSearchParams] = useSearchParams()
  const [newOpen, setNewOpen] = useState(false)
  const [editSlug, setEditSlug] = useState(null)

  const { data, isLoading } = useSWR('/api/education/videos', fetcher)
  const { data: pathsData, error: pathsError, mutate: mutatePaths } = useSWR(
    isAdmin ? '/api/education/paths?all=1' : '/api/education/paths',
    fetcher,
  )
  const { data: studyMapData } = useStudyMap(studyOn)
  const curricula = useMemo(
    () => (Array.isArray(studyMapData?.map?.curricula) ? studyMapData.map.curricula : []),
    [studyMapData],
  )
  const skillRows = useMemo(() => skillsById(studyMapData?.skills), [studyMapData])

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
          for (const k of STUDY_KEYS) next.delete(k)
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

  // ── Study navigation: one writer for the four study keys ──
  const setStudy = useCallback(
    (entries) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const k of STUDY_KEYS) next.delete(k)
          next.delete('path')
          for (const [k, v] of Object.entries(entries || {})) if (v != null) next.set(k, String(v))
          return next
        },
        { replace: false },
      )
    },
    [setSearchParams],
  )
  const openTrail = useCallback((curriculumId) => setStudy({ study: 'map', curriculum: curriculumId }), [setStudy])
  const openUnit = useCallback((unitId) => setStudy({ study: 'unit', unit: unitId }), [setStudy])
  const closeStudy = useCallback(() => setStudy({}), [setStudy])
  const startToday = useCallback((sessionId) => setStudy({ study: 'today', session: sessionId }), [setStudy])
  const practise = useCallback(() => setStudy({ study: 'practise' }), [setStudy])

  const studyParam = searchParams.get('study')
  const curriculumParam = searchParams.get('curriculum')
  const unitParam = searchParams.get('unit')
  const sessionParam = searchParams.get('session')

  // The drill (a fullscreen Sheet) mounts off `?study=today[&session=]`; the
  // practise sheet off `?study=practise`. A set handed over by the practise
  // sheet or a trail unit is kept in state so the drill opens on it without a
  // second fetch; Today's Study loads itself when nothing was handed over.
  const [handedSet, setHandedSet] = useState(null)
  const { data: studyProfile, mutate: mutateProfile } = useStudyProfile(studyOn)
  const { data: studyToday, mutate: mutateToday } = useStudyToday(studyOn)
  const drillOpen = studyOn && studyParam === 'today'
  const practiseOpen = studyOn && studyParam === 'practise'
  const profileRow = studyProfile?.profile || studyProfile || null
  const dots = useMemo(
    () => weekDots(studyToday?.day_et, profileRow?.last_done_day, profileRow?.streak),
    [studyToday?.day_et, profileRow?.last_done_day, profileRow?.streak],
  )
  const openSet = useCallback(
    (payload) => {
      setHandedSet(payload || null)
      setStudy({ study: 'today', session: payload?.session_id ?? null })
    },
    [setStudy],
  )
  const finishDrill = useCallback(() => {
    setHandedSet(null)
    mutateToday?.()
    mutateProfile?.()
    closeStudy()
  }, [closeStudy, mutateToday, mutateProfile])
  // A trail unit starts a skill set on the unit's first skill (the backend
  // narrows by skill_id); test-out is the same set at the top rung.
  const startUnit = useCallback(
    async (unitId, _rung, kind = 'skill') => {
      const hit = locateUnit(curricula, unitId)
      const skillId = hit?.unit?.skills?.[0] || null
      try {
        const payload = await studyFetch(SESSIONS_URL, { method: 'POST', body: { kind, skill_id: skillId } })
        openSet(payload)
      } catch {
        /* the trail stays open; the member can retry */
      }
    },
    [curricula, openSet],
  )
  const testOutUnit = useCallback((unitId) => startUnit(unitId, 9, 'checkpoint'), [startUnit])
  // The trail sub-view: `map` names its curriculum; `unit` is resolved
  // through the map (the trail shows its skeleton until the map is in).
  const trail = useMemo(() => {
    if (!studyOn) return null
    if (studyParam === 'map' && curriculumParam) return { curriculumId: curriculumParam, unitId: null }
    if (studyParam === 'unit' && unitParam) {
      const hit = locateUnit(curricula, unitParam)
      return { curriculumId: hit?.curriculum?.id || curriculumParam || null, unitId: unitParam }
    }
    return null
  }, [studyOn, studyParam, curriculumParam, unitParam, curricula])

  const curriculumFor = useCallback(
    (p) => (studyOn ? curriculumIdForCourse(p, curricula) : null),
    [studyOn, curricula],
  )
  // The course whose recorded lessons back the open trail (its "K recorded
  // lessons" door opens the syllabus).
  const trailCourse = useMemo(
    () => (trail ? courses.find((p) => curriculumFor(p) === trail.curriculumId) || null : null),
    [trail, courses, curriculumFor],
  )

  const pathPending =
    !!pathParam && !activePath && pathsData === undefined && !pathsError

  const showTrail = !isLoading && !!trail
  const showPath = !isLoading && !trail && !!activePath
  const showGrid = !isLoading && !trail && !activePath && !pathPending

  const grid = (
    <>
      {courseStats.length === 0 && (
        <p className={cs.empty}>
          {isAdmin
            ? 'No courses yet — create an outline and populate it as you record.'
            : 'Courses are being produced — check back soon.'}
        </p>
      )}

      <div className={s.pathsGrid}>
        {courseStats.map(({ path: p, done, total: count, started, pct, durLabel }) => {
          const curriculumId = curriculumFor(p)
          const curriculum = curriculumId ? curricula.find((c) => c.id === curriculumId) : null
          const summary = curriculum ? curriculumSummary(curriculum, skillRows) : null
          return (
            <button
              key={p.slug}
              className={s.pathCard}
              onClick={() => (curriculumId ? openTrail(curriculumId) : openPath(p.slug))}
            >
              <span className={`${s.pathKind} ${s.pathKindCourse}`}>
                COURSE
                {p.enabled === 0 && <span className={s.pathDraft}>DRAFT</span>}
              </span>
              <span className={s.pathName}>{p.name}</span>
              {p.blurb && <span className={s.pathBlurb}>{p.blurb}</span>}
              {summary ? (
                <>
                  <span className={s.pathMeta}>
                    {summary.tracks} track{summary.tracks === 1 ? '' : 's'}
                    {' · '}{summary.units} unit{summary.units === 1 ? '' : 's'}
                    {' · '}{count} recorded lesson{count === 1 ? '' : 's'}
                  </span>
                  <span className={s.pathProgressRow}>
                    <span className={s.pathBar} aria-hidden="true">
                      <span className={s.pathBarFill} style={{ width: `${summary.pct}%` }} />
                    </span>
                    <span className={s.pathCount}>
                      {summary.mastered} of {summary.units} mastered
                    </span>
                  </span>
                </>
              ) : (
                <>
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
                </>
              )}
            </button>
          )
        })}
      </div>
    </>
  )

  return (
    <div className={cs.page}>
      <VideoDockSlot />

      {(isLoading || pathPending) && (pathParam ? <PathViewSkeleton /> : <DeskSectionSkeleton cards={4} />)}

      {drillOpen && (
        <DrillPlayer
          key={sessionParam || 'today'}
          open
          initial={handedSet}
          sessionId={sessionParam}
          profile={profileRow}
          weekDots={dots}
          reviewer={user?.role === 'admin'}
          onClose={finishDrill}
          onFinished={finishDrill}
          onKeepPractising={practise}
        />
      )}
      {practiseOpen && (
        <PractiseSheet
          open
          onClose={closeStudy}
          misses={Number(studyToday?.misses ?? profileRow?.misses ?? 0)}
          stale={Number(studyToday?.stale_skills ?? profileRow?.stale_skills ?? 0)}
          staleSkillId={studyToday?.stale_skill_id || null}
          trailSkillId={studyToday?.next_skill_id || null}
          onStart={openSet}
        />
      )}

      {showTrail && (
        <SkillTrail
          key={`${trail.curriculumId}:${trail.unitId || ''}`}
          curriculumId={trail.curriculumId}
          initialUnitId={trail.unitId}
          onStartUnit={startUnit}
          onTestOut={testOutUnit}
          onBack={closeStudy}
          recordedLessons={trailCourse ? trailCourse.videos.length : 0}
          onOpenLessons={trailCourse ? () => openPath(trailCourse.slug) : undefined}
        />
      )}

      {showPath && (
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

      {showGrid && (
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

          {studyOn && (
            /* The landing hero (docs/study/landing_redesign.md): the trail as a
               chart, the station decks, the badges shelf. Pure props; the
               action card below keeps the one primary button. */
            <StudyLanding
              curricula={curricula}
              byId={skillRows}
              badges={Array.isArray(studyProfile?.badges) ? studyProfile.badges : []}
              onOpenUnit={openUnit}
              onOpenTrail={openTrail}
            />
          )}
          {studyOn ? (
            <div className={cs.studyLayout}>
              <div className={cs.studyAside}>
                {/* ?study=today|practise: the panel's buttons write the URL; the
                    integrator mounts the drill (a fullscreen Sheet) off those two
                    values beside this panel. */}
                <StudyPanel onStart={startToday} onPractise={practise} onOpenUnit={openUnit} />
              </div>
              <div className={cs.studyMain}>{grid}</div>
            </div>
          ) : (
            <>
              {grid}
              {/* TERM-091: curriculum text lessons — only while Study is off
                  (D2 retires the flat list from this page when Study ships). */}
              <CurriculumLessons />
            </>
          )}
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
