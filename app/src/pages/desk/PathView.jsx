// app/src/pages/desk/PathView.jsx
// The course syllabus page — rendered by VideosSection when ?path=<slug>
// matches a loaded path. A quiet dossier in the house register: kind eyebrow,
// name, blurb, "n of M · ~Xh Ym left", ONE gold CTA (Start/Continue/Rewatch),
// then the lesson ledger — consecutive module_label runs become quiet group
// seams (the landing's zone-seam vocabulary), each lesson a numbered row with
// a gold check when done or a thin gold progress bar while in progress.
//
// Playback: every click routes through onPlay(path.videos, index) with the
// FULL course-order list, so the theater's Up Next walks the syllabus. This
// component never autoplays — the ?v= deep-link effect in VideosSection keeps
// sole ownership of autoplay.
import { useMemo } from 'react'
import UIcon from '../../components/ui/UIcon'
import { SkeletonLine, SkeletonPill } from '../../components/Skeleton'
// Deliberate module cycle (VideosSection ⇄ PathView): the helpers are only
// called at render time, long after both modules finish evaluating — and the
// landing tests pin these exports to VideosSection, so they stay there.
import { parseDuration, fmtCourseDuration, DURATION_COVERAGE_MIN } from './VideosSection'
import p from './PathView.module.css'

export default function PathView({ path, stats, progress, onBack, onPlay }) {
  // Pair each resolved video with its authoring step (module_label / note).
  // path.videos is exactly path.steps resolved in order minus unknown ids, so
  // one pointer walk reconstructs the pairing — duplicates included, and a
  // step whose video didn't resolve is skipped without consuming a video.
  const lessons = useMemo(() => {
    const videos = path.videos || []
    const out = []
    let vi = 0
    for (const st of path.steps || []) {
      const v = videos[vi]
      if (v && v.youtube_id === st.youtube_id) {
        out.push({ video: v, step: st, index: vi })
        vi += 1
      }
    }
    // Defensive: a path without steps (shouldn't happen) still lists lessons.
    return out.length || !videos.length
      ? out
      : videos.map((v, i) => ({ video: v, step: {}, index: i }))
  }, [path])

  // Consecutive runs of the same module_label form a group; a null label is a
  // headerless run (never merged INTO a labeled neighbor — runs stay intact).
  const groups = useMemo(() => {
    const gs = []
    for (const lesson of lessons) {
      const label = lesson.step.module_label || null
      const last = gs[gs.length - 1]
      if (last && last.label === label) last.lessons.push(lesson)
      else gs.push({ label, lessons: [lesson] })
    }
    return gs
  }, [lessons])

  const done = stats?.done ?? 0
  const total = lessons.length
  const allDone = total > 0 && done >= total

  // "~Xh Ym left" = the durations of not-done lessons, shown ONLY under the
  // same ≥70% coverage rule the course cards use (a mostly-unknown remainder
  // would be a lie) and never once everything is done.
  const remainingLabel = useMemo(() => {
    if (allDone || !total) return ''
    const parsed = lessons.map((l) => parseDuration(l.video.duration))
    if (parsed.filter((x) => x != null).length / total < DURATION_COVERAGE_MIN) return ''
    const secs = lessons.reduce(
      (sum, l, i) =>
        !progress[l.video.youtube_id]?.done && parsed[i] != null ? sum + parsed[i] : sum,
      0,
    )
    return secs > 0 ? `${fmtCourseDuration(secs)} left` : ''
  }, [lessons, progress, total, allDone])

  // CTA: all done → Rewatch from the top; started → Continue at the resume
  // step (courseStats.nextIndex — most recent in-progress, else first
  // not-done); untouched → Start at lesson 1.
  const ctaLabel = allDone ? 'Rewatch' : stats?.started ? 'Continue' : 'Start'
  const resumeIndex =
    allDone || stats == null || stats.nextIndex < 0 ? 0 : stats.nextIndex

  return (
    <section className={p.page} aria-label={path.name}>
      <button className={p.back} onClick={onBack}>
        <span className={p.flipX} aria-hidden="true">
          <UIcon name="chevronRight" size={14} gold={false} />
        </span>
        Back to videos
      </button>

      <header className={p.head}>
        <div className={`${p.kind} ${path.kind === 'course' ? p.kindCourse : ''}`}>
          {path.kind === 'course' ? 'COURSE' : 'TRACK'}
        </div>
        <h2 className={p.name}>{path.name}</h2>
        {path.blurb && <p className={p.blurb}>{path.blurb}</p>}
        <div className={p.actions}>
          <button
            className={p.cta}
            onClick={() => onPlay(path.videos, resumeIndex)}
          >
            <UIcon name="play" size={12} gold={false} />
            {ctaLabel}
          </button>
          <span className={p.meta}>
            {done} of {total}
            {remainingLabel ? ` · ${remainingLabel}` : ''}
          </span>
        </div>
      </header>

      <div className={p.syllabus}>
        {groups.map((g, gi) => (
          <div key={gi} className={p.group}>
            {g.label && (
              <div className={p.groupHead}>
                <h3 className={p.groupLabel}>{g.label}</h3>
                <span className={p.groupRule} aria-hidden="true" />
              </div>
            )}
            <ol className={p.rows} aria-label={g.label || `${path.name} lessons`}>
              {g.lessons.map((lesson) => (
                <LessonRow
                  key={`${lesson.index}-${lesson.video.youtube_id}`}
                  lesson={lesson}
                  videos={path.videos}
                  progress={progress}
                  onPlay={onPlay}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}

// One lesson row — a full-width button (44px touch): course-wide index, state
// slot (gold check when done), title, dim AI headline, italic per-step note,
// thin gold progress bar while in progress, duration on the right.
function LessonRow({ lesson, videos, progress, onPlay }) {
  const { video: v, step, index } = lesson
  const e = progress[v.youtube_id]
  const isDone = !!e?.done
  const active = !isDone && !!e && e.t >= 8 // the store's own resume threshold
  const pct =
    active && e.d > 0 ? Math.min(100, Math.max(4, Math.round((e.t / e.d) * 100))) : 4

  return (
    <li className={p.rowItem}>
      <button
        className={p.row}
        aria-label={`Play ${v.title}`}
        onClick={() => onPlay(videos, index)}
      >
        <span className={p.rowIndex} aria-hidden="true">
          {index + 1}
        </span>
        <span className={p.rowState} aria-hidden="true">
          {isDone && (
            <UIcon name="check" size={15} className={p.rowCheck} data-lesson-state="done" />
          )}
        </span>
        <span className={p.rowBody}>
          <span className={`${p.rowTitle} ${isDone ? p.rowTitleDone : ''}`}>{v.title}</span>
          {v.headline ? <span className={p.rowHeadline}>{v.headline}</span> : null}
          {step.note ? <span className={p.rowNote}>{step.note}</span> : null}
          {active && (
            <span className={p.rowBar} data-lesson-state="active">
              <span className={p.rowBarFill} style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
        {v.duration ? <span className={p.rowDuration}>{v.duration}</span> : null}
      </button>
    </li>
  )
}

// Quiet loading shape for a direct ?path= load while GET /paths is still in
// flight — the syllabus silhouette (header bars + a few ledger rows) instead
// of a landing flash. Same role="status" register as DeskSectionSkeleton.
export function PathViewSkeleton() {
  return (
    <div className={p.skeleton} role="status" aria-busy="true">
      <span className={p.srOnly}>Loading course</span>
      <div aria-hidden="true">
        <SkeletonLine width={110} height={12} />
        <div className={p.skelGap} />
        <SkeletonLine width={56} height={10} />
        <SkeletonLine width={240} height={20} />
        <SkeletonLine width={330} height={13} />
        <div className={p.skelGap} />
        <SkeletonPill width={116} height={36} />
        <div className={p.skelRows}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={p.skelRow}>
              <SkeletonLine width={16} height={12} />
              <SkeletonLine width={i % 2 ? '46%' : '58%'} height={13} />
              <SkeletonLine width={36} height={11} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
