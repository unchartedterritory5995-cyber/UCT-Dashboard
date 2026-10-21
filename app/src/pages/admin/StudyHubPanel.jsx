/**
 * StudyHubPanel — the review hub (owner 2026-10-21: "Can you show me everything
 * here and now so we can go through it all and continue reviewing and
 * structuring each section properly").
 *
 * Two parts on one screen, from `GET /api/study/admin/hub`:
 *
 *  1. Sections — the skill map (curriculum → track → unit) with what members
 *     get (live), what still waits (drafts) and what was cut (rejected), and
 *     the skills the map does not place, so nothing drops off the page because
 *     the map does not name it.
 *  2. Lessons — every candle lesson as members read it (the six parts, taken
 *     from a live example when one carries it), how many examples carry it,
 *     and a door for the owner's verdict on the LESSON: Approve / Needs fix
 *     and a note. It is posted as a screen note on the lessons view
 *     (`POST /api/study/admin/screen-feedback`); nothing is applied to items,
 *     and the ingest records it as a source ruling for the next regeneration.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { studyFetch } from '../study/useStudySession'
import { SCREEN_FEEDBACK_URL } from '../study/screenFeedbackHelpers'
import { lessonParts } from '../study/revealCardHelpers'
import {
  HUB_URL, LESSON_FILTERS, LESSON_VERDICTS, countsLine, filterLessons, lessonVerdictBody, liveExamples,
  livePct, verdictWord,
} from './studyHubHelpers'
import styles from './StudyHubPanel.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

function Meter({ counts }) {
  const pct = livePct(counts)
  return (
    <span className={styles.meter} aria-hidden="true">
      <span className={styles.meterFill} style={{ width: `${pct}%` }} />
    </span>
  )
}

function Sections({ tree, unplaced }) {
  return (
    <section className={styles.block} aria-label="Sections" data-testid="hub-sections">
      <h3 className={styles.blockTitle}>Sections</h3>
      <p className={styles.hint}>
        Live is what members get. Waiting is drafts you have not reviewed. A unit that says nothing yet has no
        questions at all.
      </p>
      {tree.map((cur) => (
        <div key={cur.id} className={styles.curriculum}>
          <p className={styles.curTitle}>
            {cur.title} <span className={styles.muted}>· {countsLine(cur.counts)}</span>
          </p>
          {cur.tracks.map((tr) => (
            <details key={tr.id} className={styles.track} data-testid="hub-track">
              <summary className={styles.trackSummary}>
                <span className={styles.trackName}>{tr.title}</span>
                <Meter counts={tr.counts} />
                <span className={styles.muted}>{countsLine(tr.counts)}</span>
              </summary>
              <ul className={styles.units}>
                {tr.units.map((un) => (
                  <li key={un.id} className={styles.unit} data-empty={un.counts.total ? '0' : '1'}>
                    <span className={styles.unitId}>{un.id}</span>
                    <span className={styles.unitName}>{un.title}</span>
                    <span className={styles.muted}>{countsLine(un.counts)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ))}
      {unplaced.length > 0 && (
        <div className={styles.curriculum}>
          <p className={styles.curTitle}>Not on the course map</p>
          <ul className={styles.units}>
            {unplaced.map((s) => (
              <li key={s.skill_id} className={styles.unit}>
                <span className={styles.unitId}>{s.skill_id || '(none)'}</span>
                <span className={styles.muted}>{countsLine(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function LessonDoor({ lesson, onSaved, post }) {
  const [verdict, setVerdict] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const send = async () => {
    setBusy(true)
    setErr(null)
    try {
      await post(SCREEN_FEEDBACK_URL, { method: 'POST', body: lessonVerdictBody(lesson, verdict, text) })
      setVerdict(null)
      setText('')
      onSaved?.()
    } catch {
      setErr('Could not save that. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.door} data-testid="lesson-door">
      <div className={styles.chips} role="radiogroup" aria-label={`Your verdict on the ${lesson.label} lesson`}>
        {LESSON_VERDICTS.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={verdict === v}
            className={`${styles.chip} ${verdict === v ? styles.chipOn : ''}`}
            onClick={() => setVerdict(verdict === v ? null : v)}>{label}</button>
        ))}
      </div>
      {verdict && (
        <>
          <textarea className={styles.text} aria-label="Your note" rows={2} maxLength={2000}
            placeholder={verdict === 'fix' ? 'What to change, in your words' : 'Anything to add (optional)'}
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className={styles.actions}>
            <button type="button" className={styles.send} disabled={busy || (verdict === 'fix' && !text.trim())}
              onClick={send} data-testid="lesson-door-send">Save</button>
            <button type="button" className={styles.cancel} disabled={busy} onClick={() => setVerdict(null)}>Cancel</button>
            {err && <span className={styles.err} role="alert">{err}</span>}
          </div>
        </>
      )}
    </div>
  )
}

function Lesson({ lesson, open, onToggle, onSaved, post }) {
  const parts = lessonParts({ lesson_parts: lesson.parts })
  const live = liveExamples(lesson)
  const v = lesson.verdict?.verdict || 'todo'
  return (
    <li className={styles.lesson} data-testid="hub-lesson" data-key={lesson.key} data-verdict={v}>
      <button type="button" className={styles.lessonHead} aria-expanded={open} onClick={onToggle}>
        <span className={styles.lessonName}>{lesson.label}</span>
        <span className={styles.muted}>
          {lesson.bars ? `${lesson.bars} bar${lesson.bars === 1 ? '' : 's'}` : ''}
          {' · '}{live} live example{live === 1 ? '' : 's'}
          {lesson.charts?.draft ? ` · ${lesson.charts.draft} waiting` : ''}
        </span>
        <span className={`${styles.verdict} ${styles[`v_${v}`] || ''}`}>{verdictWord(lesson)}</span>
        {lesson.notes_open > 0 && (
          <span className={styles.muted}>{lesson.notes_open} note{lesson.notes_open === 1 ? '' : 's'}</span>
        )}
      </button>
      {open && (
        <div className={styles.lessonBody}>
          {parts ? (
            <dl className={styles.parts}>
              {parts.map((p) => (
                <div key={p.key} className={styles.part}>
                  <dt className={styles.partLabel}>{p.label}</dt>
                  <dd className={styles.partText}>{p.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.muted}>No six-part lesson on this name yet.</p>
          )}
          {lesson.parts_from && lesson.parts_from !== 'approved' && (
            <p className={styles.muted}>Read from a {lesson.parts_from} item: no live example carries it yet.</p>
          )}
          {lesson.verdict && (
            <p className={styles.muted}>
              Your last word: {verdictWord(lesson).toLowerCase()}
              {lesson.verdict.text ? `, "${lesson.verdict.text}"` : ''}
              {lesson.verdict.at ? ` (${String(lesson.verdict.at).slice(0, 10)})` : ''}
            </p>
          )}
          <LessonDoor lesson={lesson} onSaved={onSaved} post={post} />
        </div>
      )}
    </li>
  )
}

export default function StudyHubPanel({ post = studyFetch }) {
  const { data, error, mutate } = useSWR(HUB_URL, fetcher, { revalidateOnFocus: false })
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [openKeys, setOpenKeys] = useState(() => new Set())
  const lessons = useMemo(() => filterLessons(data?.lessons, { filter, q }), [data, filter, q])
  const all = data?.lessons || []
  const reviewed = all.filter((l) => l.verdict).length
  const allOpen = lessons.length > 0 && lessons.every((l) => openKeys.has(l.key))

  const toggle = (key) => setOpenKeys((cur) => {
    const next = new Set(cur)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const setAll = (open) => setOpenKeys(open ? new Set(lessons.map((l) => l.key)) : new Set())

  return (
    <section className={styles.hub} aria-label="Review hub" data-testid="hub-panel">
      {error && <div className={styles.empty}>Could not load the hub ({error.message}).</div>}
      {!error && !data && <div className={styles.empty}>Loading the hub…</div>}
      {data && (
        <>
          <Sections tree={data.tree || []} unplaced={data.unplaced || []} />
          <section className={styles.block} aria-label="Lessons" data-testid="hub-lessons">
            <h3 className={styles.blockTitle}>
              Candle lessons <span className={styles.muted}>· {reviewed} of {all.length} reviewed</span>
            </h3>
            <p className={styles.hint}>
              Each lesson as members read it on the reveal card. Your verdict here is on the lesson, not on any one
              chart; it is saved for the next rebuild of the lessons.
            </p>
            <div className={styles.controls}>
              <select aria-label="Show" className={styles.select} value={filter} onChange={(e) => setFilter(e.target.value)}>
                {LESSON_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input type="search" className={styles.search} aria-label="Find a lesson" placeholder="Find a name"
                value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className={styles.cancel} onClick={() => setAll(!allOpen)}
                disabled={lessons.length === 0}>{allOpen ? 'Close all' : 'Open all'}</button>
            </div>
            {lessons.length === 0 && <div className={styles.empty}>No lesson matches.</div>}
            <ul className={styles.lessons}>
              {lessons.map((l) => (
                <Lesson key={l.key} lesson={l} open={openKeys.has(l.key)} onToggle={() => toggle(l.key)}
                  onSaved={() => mutate()} post={post} />
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  )
}
