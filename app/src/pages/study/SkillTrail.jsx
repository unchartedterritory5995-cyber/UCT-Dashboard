// Study — the trail sub-view (spec §13.7 D1/D4/D17): one curriculum per
// view, tracks as collapsed seams (PathView's register) with only the
// current track open on arrival, auto-scroll to the recommended node which
// alone pulses gold, a sticky 44px bar with the track name and a "Jump to"
// bottom sheet (tracks with a progress pill each). Nodes are 56px nine-rung
// rings with the title under; tapping one opens a bottom sheet with the
// 3×3 rung grid, "Replay intro", ONE gold "Start rung N" and a ghost "Test
// out" — test-out lives here, never on the trail.
//
// The UI never shows a skill tree (D1): `skill_id` stays a data key.
// Callbacks are props; the integrator wires the drill.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Sheet from '../../components/mobile/Sheet'
import UIcon from '../../components/ui/UIcon'
import ProgressRing from './ProgressRing'
import { useStudyMap } from './useStudy'
import LoadFailed from '../journal-2-0/components/LoadFailed'
import {
  skillsById, unitProgress, recommendUnit, trackSummary, locateUnit, RUNGS,
} from './studyMap'
import s from './SkillTrail.module.css'

export function SkillTrailSkeleton() {
  return (
    <section className={s.page} aria-label="Study trail" aria-busy="true">
      <span className={`${s.bone} ${s.boneBack}`} />
      <span className={`${s.bone} ${s.boneTitle}`} />
      <span className={`${s.bone} ${s.boneBar}`} />
      <div className={s.boneNodes}>
        {[0, 1, 2].map((i) => <span key={i} className={`${s.bone} ${s.boneNode}`} />)}
      </div>
    </section>
  )
}

const reducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function TrailSeg({ done }) {
  // A dashed vertical segment between two nodes; brightens (400ms, CSS) when
  // the node above is mastered. Decorative only.
  return (
    <svg className={`${s.seg} ${done ? s.segDone : ''}`} width="4" height="28" viewBox="0 0 4 28" aria-hidden="true" focusable="false">
      <line x1="2" y1="0" x2="2" y2="28" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
    </svg>
  )
}

function RungGrid({ rungs }) {
  const next = rungs < RUNGS ? rungs + 1 : null
  return (
    <ol className={s.rungGrid} aria-label={`${rungs} of ${RUNGS} rungs`}>
      {Array.from({ length: RUNGS }, (_, i) => {
        const n = i + 1
        const done = n <= rungs
        const isNext = n === next
        return (
          <li
            key={n}
            className={`${s.rung} ${done ? s.rungDone : ''} ${isNext ? s.rungNext : ''}`}
            aria-current={isNext ? 'step' : undefined}
            aria-label={`Rung ${n}${done ? ', done' : isNext ? ', next' : ''}`}
          >
            {done ? <UIcon name="check" size={14} /> : <span aria-hidden="true">{n}</span>}
          </li>
        )
      })}
    </ol>
  )
}

export default function SkillTrail({
  curriculumId,
  initialUnitId = null,
  onBack,
  onStartUnit,
  onTestOut,
  onReplayIntro,
  recordedLessons = 0,
  onOpenLessons,
}) {
  const { data: mapData, error, mutate: retryMap } = useStudyMap()
  const curricula = mapData?.map?.curricula
  const curriculum = useMemo(
    () => (Array.isArray(curricula) ? curricula.find((c) => c.id === curriculumId) || null : null),
    [curricula, curriculumId],
  )
  const byId = useMemo(() => skillsById(mapData?.skills), [mapData])
  const recommended = useMemo(() => (curriculum ? recommendUnit(curriculum, byId) : null), [curriculum, byId])
  const initial = useMemo(() => (initialUnitId ? locateUnit(curricula, initialUnitId) : null), [curricula, initialUnitId])

  const currentTrackId = initial?.track?.id || recommended?.track?.id || curriculum?.tracks?.[0]?.id || null

  // Only the current track is open on arrival; the member opens the rest.
  const [openTracks, setOpenTracks] = useState(null)
  const opened = openTracks ?? new Set(currentTrackId ? [currentTrackId] : [])
  const [activeTrackId, setActiveTrackId] = useState(null)
  const barTrackId = activeTrackId || currentTrackId
  const barTrack = curriculum?.tracks?.find((t) => t.id === barTrackId) || null

  const [jumpOpen, setJumpOpen] = useState(false)
  const [sheetUnitId, setSheetUnitId] = useState(initialUnitId || null)
  const sheetEntry = useMemo(() => (sheetUnitId ? locateUnit(curricula, sheetUnitId) : null), [curricula, sheetUnitId])

  const nodeRefs = useRef({})
  const headRefs = useRef({})

  // Auto-scroll to the recommended node once the map is in (D4). jsdom has no
  // scrollIntoView, so it is guarded; reduced motion jumps instead of gliding.
  const recId = recommended?.unit?.id || null
  useEffect(() => {
    if (!recId || initialUnitId) return
    const el = nodeRefs.current[recId]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
  }, [recId, initialUnitId])

  const toggleTrack = useCallback((id) => {
    setOpenTracks((prev) => {
      const next = new Set(prev ?? (currentTrackId ? [currentTrackId] : []))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setActiveTrackId(id)
  }, [currentTrackId])

  const jumpTo = useCallback((id) => {
    setOpenTracks((prev) => {
      const next = new Set(prev ?? (currentTrackId ? [currentTrackId] : []))
      next.add(id)
      return next
    })
    setActiveTrackId(id)
    setJumpOpen(false)
    const el = headRefs.current[id]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
  }, [currentTrackId])

  // A failed read is SAID, with Try again and the way back (a blank page is
  // not a notice). A 404 (Study off) resolves to null and keeps the skeleton.
  if (error) {
    return (
      <section className={s.page} aria-label="Study trail">
        <button type="button" className={s.back} onClick={onBack}>
          <span className={s.flipX} aria-hidden="true"><UIcon name="chevronRight" size={14} gold={false} /></span>
          Back to courses
        </button>
        <LoadFailed what="the Study trail" error={error} onRetry={() => retryMap?.()} />
      </section>
    )
  }
  if (mapData == null) return <SkillTrailSkeleton />
  if (!curriculum) {
    return (
      <section className={s.page} aria-label="Study trail">
        <button type="button" className={s.back} onClick={onBack}>
          <span className={s.flipX} aria-hidden="true"><UIcon name="chevronRight" size={14} gold={false} /></span>
          Back to courses
        </button>
        <p className={s.empty}>This curriculum is not on the map yet.</p>
      </section>
    )
  }

  const sheetProgress = sheetEntry ? unitProgress(sheetEntry.unit, byId) : null
  const sheetNextRung = sheetProgress ? Math.min(RUNGS, sheetProgress.rungs + 1) : 1

  return (
    <section className={s.page} aria-label={`${curriculum.title} trail`}>
      <button type="button" className={s.back} onClick={onBack}>
        <span className={s.flipX} aria-hidden="true"><UIcon name="chevronRight" size={14} gold={false} /></span>
        Back to courses
      </button>

      <header className={s.head}>
        <span className={s.kind}>CURRICULUM</span>
        <h2 className={s.name}>{curriculum.title}</h2>
        {recordedLessons > 0 && onOpenLessons && (
          <button type="button" className={s.lessonsLink} onClick={onOpenLessons}>
            <UIcon name="play" size={12} />
            {recordedLessons} recorded lesson{recordedLessons === 1 ? '' : 's'}
          </button>
        )}
      </header>

      <div className={s.bar}>
        <span className={s.barLabel}>{barTrack ? barTrack.title : 'Trail'}</span>
        <button type="button" className={s.jump} onClick={() => setJumpOpen(true)}>
          Jump to
          <UIcon name="chevronRight" size={12} gold={false} className={s.jumpChev} />
        </button>
      </div>

      {curriculum.tracks.map((track) => {
        const isOpen = opened.has(track.id)
        const summary = trackSummary(track, byId)
        const units = track.units || []
        return (
          <section key={track.id} className={s.track} ref={(el) => { headRefs.current[track.id] = el }}>
            <button
              type="button"
              className={s.groupHead}
              onClick={() => toggleTrack(track.id)}
              aria-expanded={isOpen}
              aria-controls={`study-track-${track.id}`}
            >
              <span className={s.groupLabel}>{track.title}</span>
              <span className={s.groupRule} aria-hidden="true" />
              <span className={s.pill}>{summary.mastered}/{summary.units}</span>
              <span className={`${s.chevWrap} ${isOpen ? s.chevOpen : ''}`} aria-hidden="true">
                <UIcon name="chevronRight" size={12} gold={false} />
              </span>
            </button>

            {isOpen && (
              <ol className={s.nodes} id={`study-track-${track.id}`}>
                {units.length === 0 && (
                  <li className={s.noUnits}>No units on this track yet.</li>
                )}
                {units.map((unit, i) => {
                  const progress = unitProgress(unit, byId)
                  const prev = i > 0 ? unitProgress(units[i - 1], byId) : null
                  const isRec = unit.id === recId
                  return (
                    <li key={unit.id} className={s.node}>
                      {i > 0 && <TrailSeg done={!!prev?.mastered} />}
                      <button
                        type="button"
                        ref={(el) => { nodeRefs.current[unit.id] = el }}
                        className={`${s.nodeBtn} ${isRec ? s.pulse : ''} ${progress.mastered ? s.nodeMastered : ''}`}
                        onClick={() => setSheetUnitId(unit.id)}
                        aria-label={`${unit.title}, ${progress.rungs} of ${RUNGS} rungs${isRec ? ', recommended' : ''}`}
                        data-recommended={isRec ? '' : undefined}
                      >
                        <ProgressRing size={56} done={progress.rungs} label="">
                          {isRec
                            ? <UIcon name="compass" size={22} />
                            : progress.mastered
                              ? <UIcon name="star" size={18} />
                              : <span className={s.nodeNum}>{i + 1}</span>}
                        </ProgressRing>
                      </button>
                      <span className={s.nodeTitle}>{unit.title}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )
      })}

      <Sheet open={jumpOpen} onClose={() => setJumpOpen(false)} variant="bottom-sheet" title="Jump to" labelledByTitle>
        <ul className={s.jumpList}>
          {curriculum.tracks.map((track) => {
            const summary = trackSummary(track, byId)
            return (
              <li key={track.id}>
                <button type="button" className={s.jumpRow} onClick={() => jumpTo(track.id)}>
                  <span className={s.jumpTitle}>{track.title}</span>
                  <span className={`${s.pill} ${summary.units && summary.mastered === summary.units ? s.pillDone : ''}`}>
                    {summary.mastered}/{summary.units}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Sheet>

      <Sheet
        open={!!sheetEntry}
        onClose={() => setSheetUnitId(null)}
        variant="bottom-sheet"
        title={sheetEntry ? sheetEntry.unit.title : ''}
        labelledByTitle
      >
        {sheetEntry && (
          <div className={s.unitSheet}>
            <span className={s.eyebrow}>{sheetEntry.track.title}</span>
            <RungGrid rungs={sheetProgress.rungs} />
            <div className={s.sheetActions}>
              <button type="button" className={s.primary} onClick={() => onStartUnit?.(sheetEntry.unit.id, sheetNextRung)}>
                {sheetProgress.mastered ? 'Practise again' : `Start rung ${sheetNextRung}`}
              </button>
              <div className={s.ghostRow}>
                <button type="button" className={s.ghost} onClick={() => onReplayIntro?.(sheetEntry.unit.id)}>
                  <UIcon name="play" size={12} gold={false} />
                  Replay intro
                </button>
                {!sheetProgress.mastered && (
                  <button type="button" className={s.ghost} onClick={() => onTestOut?.(sheetEntry.unit.id)}>
                    <UIcon name="bolt" size={12} gold={false} />
                    Test out
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </section>
  )
}
