// Study — the panel at the top of Courses (spec §4.1, §13.7 D3/D16/D18).
//
// Eyebrow STUDY + streak chip (flame · count · seven week-dots) · "Today's
// Study" with "10 questions · about 4 min" (or "6 left · about 2 min" on a
// resume, or the done line) · ONE gold button Start / Continue / Practise ·
// "Up next on the trail" with a 24px nine-rung ring · the XP bar and the
// rank line. Simplicity rule (§4.1): one primary button, no settings to
// begin, one obvious next action.
//
// Data: /api/study/today (+ profile inline), /api/study/map (for Up next),
// /api/study/leaderboard (for the rank line). Null today ⇒ skeleton (T13).
// The buttons fire callbacks — the integrator wires the drill.
import { useMemo } from 'react'
import UIcon from '../../components/ui/UIcon'
import ProgressRing from './ProgressRing'
import LoadFailed from '../journal-2-0/components/LoadFailed'
import { useStudyToday, useStudyMap, useStudyLeaderboard } from './useStudy'
import {
  skillsById, recommendUnit, todayState, minutesFor, ordinal, weekDots,
  WEEKDAY_LETTERS, WEEKDAY_NAMES,
} from './studyMap'
import s from './StudyPanel.module.css'

export function StudyPanelSkeleton() {
  return (
    <section className={`${s.panel} ${s.skeleton}`} aria-label="Study" aria-busy="true">
      <div className={s.eyebrowRow}>
        <span className={s.eyebrow}>STUDY</span>
      </div>
      <span className={`${s.bone} ${s.boneTitle}`} />
      <span className={`${s.bone} ${s.boneSub}`} />
      <span className={`${s.bone} ${s.boneBtn}`} />
      <span className={`${s.bone} ${s.boneRow}`} />
    </section>
  )
}

function StreakChip({ streak, dots }) {
  const n = Math.max(0, Number(streak) || 0)
  const doneNames = dots.map((d, i) => (d ? WEEKDAY_NAMES[i] : null)).filter(Boolean)
  const label = n === 0
    ? 'No streak yet'
    : `${n}-day streak. This week: ${doneNames.length ? doneNames.join(', ') : 'nothing yet'}`
  return (
    <span className={s.streak} role="img" aria-label={label}>
      <UIcon name="flame" size={14} gold={n > 0} />
      <span className={s.streakCount}>{n}</span>
      <span className={s.dots} aria-hidden="true">
        {dots.map((done, i) => (
          <span key={i} className={`${s.dot} ${done ? s.dotDone : ''}`}>{WEEKDAY_LETTERS[i]}</span>
        ))}
      </span>
    </span>
  )
}

export default function StudyPanel({ onStart, onPractise, onOpenUnit }) {
  const { data: today, error, mutate: retryToday } = useStudyToday()
  const { data: mapData } = useStudyMap()
  const { data: board } = useStudyLeaderboard()

  const profile = today?.profile || {}
  const state = useMemo(() => todayState(today), [today])
  const dots = useMemo(
    () => weekDots(today?.day_et, profile.last_done_day, profile.streak),
    [today?.day_et, profile.last_done_day, profile.streak],
  )
  const upNext = useMemo(() => {
    const curricula = mapData?.map?.curricula
    if (!Array.isArray(curricula) || !curricula.length) return null
    const byId = skillsById(mapData?.skills)
    for (const curriculum of curricula) {
      const rec = recommendUnit(curriculum, byId)
      if (rec) return { ...rec, curriculum }
    }
    return { complete: true }
  }, [mapData])

  // A failed read (a 429, a 5xx) is SAID, with Try again: a skeleton here
  // would read as "still loading" forever. A 404 (Study off) resolves to null
  // in the fetcher and keeps the skeleton.
  if (error) {
    return (
      <section className={s.panel} aria-label="Study">
        <div className={s.eyebrowRow}>
          <span className={s.eyebrow}>STUDY</span>
        </div>
        <LoadFailed what="today's Study" error={error} onRetry={() => retryToday?.()} />
      </section>
    )
  }
  if (today == null) return <StudyPanelSkeleton />

  const streak = Number(profile.streak) || 0
  const xp = Number(profile.xp) || 0
  const zero = streak === 0 && xp === 0 && state.answered === 0 && !state.finished
  const { total, left, finished } = state
  const partial = !finished && state.answered > 0

  let title = "Today's Study"
  let sub = `${total} questions · about ${minutesFor(total)} min`
  let button = 'Start'
  let onPrimary = () => onStart?.(today.session_id)
  if (zero) {
    button = "Start today's Study"
  } else if (partial) {
    sub = `${left} left · about ${minutesFor(left)} min`
    button = 'Continue'
  } else if (finished) {
    title = "Today's Study is done"
    sub = `${total} of ${total} · streak kept`
    button = 'Practise'
    onPrimary = () => onPractise?.()
  }

  const goal = Number(profile.daily_goal) || 50
  const xpToday = Number.isFinite(Number(today?.xp_today)) ? Number(today.xp_today)
    : Number.isFinite(Number(profile.xp_today)) ? Number(profile.xp_today) : null
  const you = board?.you
  const rankLine = you?.rank
    ? `${ordinal(you.rank)} this week`
    : (finished || xp > 0 ? 'Not on the board yet this week' : "Finish a set to join this week's board")

  return (
    <section className={s.panel} aria-label="Study">
      <div className={s.eyebrowRow}>
        <span className={s.eyebrow}>STUDY</span>
        <StreakChip streak={streak} dots={dots} />
      </div>

      <h3 className={s.title}>{title}</h3>
      <p className={s.sub}>{sub}</p>
      {zero && (
        <p className={s.lead}>Ten quick questions, no setup. Your trail starts here.</p>
      )}

      <button type="button" className={s.primary} onClick={onPrimary}>
        {button}
      </button>

      {upNext && !upNext.complete && (
        <button
          type="button"
          className={s.upNext}
          onClick={() => onOpenUnit?.(upNext.unit.id, upNext.curriculum.id)}
        >
          <ProgressRing size={24} done={upNext.progress.rungs} />
          <span className={s.upNextText}>
            <span className={s.upNextLabel}>Up next on the trail</span>
            <span className={s.upNextTitle}>{upNext.unit.title}</span>
            <span className={s.upNextMeta}>{upNext.track.title} · {upNext.curriculum.title}</span>
          </span>
          <UIcon name="chevronRight" size={14} gold={false} className={s.chev} />
        </button>
      )}
      {upNext?.complete && (
        <p className={s.upNextDone}>Trail complete — practise anything from the map.</p>
      )}

      <div className={s.xpRow}>
        {xpToday != null ? (
          <>
            <span className={s.bar} role="progressbar" aria-label="XP today" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(goal, xpToday)}>
              <span className={s.barFill} style={{ width: `${Math.min(100, (xpToday / goal) * 100)}%` }} />
            </span>
            <span className={s.xpText}>{xpToday} of {goal} XP today</span>
          </>
        ) : (
          <span className={s.xpText}>{xp} XP</span>
        )}
        <span className={s.rank}>{rankLine}</span>
      </div>
    </section>
  )
}
