// app/src/pages/desk/CurriculumLessons.jsx
// TERM-091 — the curriculum's TEXT lessons on the Desk's Courses section. A
// lesson kind inside the existing section, not a new tab: it reads
// GET /api/education/lessons, which is DARK behind EDU_CURRICULUM_ENABLED — while
// the flag is off the route is a 404, the fetcher returns null, and this renders
// nothing at all.
//
// ⛔ OWNER RULING 2026-09-29: no third-party credit line is shown on any lesson.
// The server no longer returns `attribution` (education_curriculum
// SHOW_THIRD_PARTY_CREDIT = False), and this card renders none even if a payload
// carries one. No originality claim is printed either way.
import { useState } from 'react'
import useSWR from 'swr'
import cs from './CoursesSection.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export const VERDICT_LABEL = {
  verified: 'verified against real bars',
  corrected: 'corrected against real bars',
  replaced: 'replaced — the claimed pattern was not in the data',
  no_data_needed: 'no chart data needed',
}

function CensusLine({ census }) {
  if (!census || !census.total) return null
  return (
    <p className={cs.lessonCensus} data-testid="curriculum-census">
      {census.total} chart examples checked against real price history:{' '}
      {census.verified} verified · {census.corrected} corrected ·{' '}
      {census.replaced} replaced · {census.no_data_needed} needed no data
    </p>
  )
}

function LessonBody({ lessonKey, kind }) {
  const { data, error } = useSWR(
    `/api/education/lessons/${encodeURIComponent(lessonKey)}`,
    fetcher,
  )
  if (error) return <p className={cs.lessonMuted}>Could not load this lesson.</p>
  if (!data) return <p className={cs.lessonMuted}>Loading…</p>
  if (kind === 'artifact') {
    const sections = data.body?.sections || []
    return (
      <div className={cs.lessonBody}>
        {sections.map((s, i) => (
          <div key={i}>
            <h5 className={cs.lessonSubhead}>{s.heading}</h5>
            <ul className={cs.lessonList}>
              {(s.items || []).map((it, j) => (
                <li key={j}>{String(it)}</li>
              ))}
            </ul>
          </div>
        ))}
        {data.body?.footer_rule && <p className={cs.lessonMuted}>{data.body.footer_rule}</p>}
      </div>
    )
  }
  const chapters = data.chapters || []
  return (
    <ol className={cs.lessonList}>
      {chapters.map((ch, i) => (
        <li key={i}>
          {ch.marker}
          {ch.spec_verdict && (
            <span className={cs.lessonVerdict}>
              {' '}— example {VERDICT_LABEL[ch.spec_verdict] || ch.spec_verdict}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function LessonItem({ lesson }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={cs.lessonItem}>
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={cs.lessonTitle}>
          {lesson.title}
          {lesson.minutes ? <span className={cs.lessonMuted}> · {lesson.minutes} min</span> : null}
        </summary>
        {lesson.note && <p className={cs.lessonNote}>{lesson.note}</p>}
        {open && <LessonBody lessonKey={lesson.lesson_key} kind={lesson.kind} />}
      </details>
    </li>
  )
}

export default function CurriculumLessons() {
  const { data } = useSWR('/api/education/lessons', fetcher)
  const lessons = Array.isArray(data?.lessons) ? data.lessons : []
  if (lessons.length === 0) return null

  const modules = []
  const byModule = new Map()
  const artifacts = []
  for (const l of lessons) {
    if (l.kind === 'artifact') {
      artifacts.push(l)
      continue
    }
    const label = l.module_label || 'Lessons'
    if (!byModule.has(label)) {
      byModule.set(label, [])
      modules.push(label)
    }
    byModule.get(label).push(l)
  }
  const course = lessons[0]?.course

  return (
    <section className={cs.lessons} aria-labelledby="curriculum-lessons-heading">
      <h3 id="curriculum-lessons-heading" className={cs.lessonsHeading}>
        Lesson notes{course ? ` — ${course}` : ''}
      </h3>
      <p className={cs.sub}>
        {data.counts?.lessons ?? lessons.length - artifacts.length} written lessons
        {artifacts.length ? ` · ${artifacts.length} printable tools` : ''}
      </p>
      <CensusLine census={data.census} />
      {modules.map((m) => (
        <div key={m} className={cs.lessonModule}>
          <h4 className={cs.lessonModuleLabel}>{m}</h4>
          <ul className={cs.lessonUl}>
            {byModule.get(m).map((l) => (
              <LessonItem key={l.lesson_key} lesson={l} />
            ))}
          </ul>
        </div>
      ))}
      {artifacts.length > 0 && (
        <div className={cs.lessonModule}>
          <h4 className={cs.lessonModuleLabel}>Printable toolkit</h4>
          <ul className={cs.lessonUl}>
            {artifacts.map((l) => (
              <LessonItem key={l.lesson_key} lesson={l} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
