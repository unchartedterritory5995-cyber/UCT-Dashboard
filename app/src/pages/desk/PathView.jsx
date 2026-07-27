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
//
// Admin edit mode (Task 6) — the syllabus UNLOCKED, not a form: inputs keep
// the exact type of the text they replace (underline fields on the page
// background), the ledger keeps its geometry (index column stays; row ops sit
// where the duration sat), and gold stays reserved for Save. The draft is
// LOCAL state: Save = PATCH meta (only-when-changed) + PUT the whole ordered
// step list; any failure shows inline and PRESERVES the draft. Members see
// zero change — every edit affordance is isAdmin-gated.
import { useMemo, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { SkeletonLine, SkeletonPill } from '../../components/Skeleton'
// Deliberate module cycle (VideosSection ⇄ PathView): the helpers are only
// called at render time, long after both modules finish evaluating — and the
// landing tests pin these exports to VideosSection, so they stay there.
import { parseDuration, fmtCourseDuration, DURATION_COVERAGE_MIN } from './VideosSection'
import p from './PathView.module.css'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// The editable draft mirrors path meta + ALL authored steps — including steps
// whose youtube_id doesn't resolve against the loaded library. Dropping those
// on save would silently destroy curation, so they ride along (flagged
// "not in library" in the editor) and land back in the PUT untouched.
const draftFromPath = (path) => ({
  name: path.name || '',
  blurb: path.blurb || '',
  kind: path.kind === 'course' ? 'course' : 'track',
  steps: (path.steps || []).map((st) => ({
    youtube_id: st.youtube_id,
    module_label: st.module_label || '',
    note: st.note || '',
  })),
})

export default function PathView({
  path,
  stats,
  progress,
  onBack,
  onPlay,
  isAdmin = false,
  allVideos = [],
  onSaved,
  initialEdit = false,
}) {
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
    // Multiple headerless runs would all read as "<name> lessons" to assistive
    // tech — number them ("…, part N") only when there is more than one, so
    // the common single-ledger shape keeps its plain accessible name.
    const headerless = gs.filter((g) => !g.label)
    if (headerless.length > 1) headerless.forEach((g, i) => { g.part = i + 1 })
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

  // ── Admin editor state — draft != null IS edit mode ─────────────────────
  const [draft, setDraft] = useState(() =>
    isAdmin && initialEdit ? draftFromPath(path) : null,
  )
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const editing = isAdmin && draft != null

  const videoById = useMemo(() => {
    const m = {}
    for (const v of allVideos) m[v.youtube_id] = v
    return m
  }, [allVideos])

  const beginEdit = () => {
    setSaveErr('')
    setDraft(draftFromPath(path))
  }
  const cancelEdit = () => {
    setDraft(null)
    setSaveErr('')
  }
  const setStep = (i, field, value) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, j) => (j === i ? { ...s, [field]: value } : s)),
    }))
  const moveStep = (i, dir) =>
    setDraft((d) => {
      const j = i + dir
      if (j < 0 || j >= d.steps.length) return d
      const steps = [...d.steps]
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...d, steps }
    })
  const removeStep = (i) =>
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))
  const addStep = (video) =>
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { youtube_id: video.youtube_id, module_label: '', note: '' }],
    }))

  // Save = PATCH meta only when something actually changed (partial body of
  // just the changed fields — slug is immutable and never sent), then PUT the
  // whole ordered step list from the draft. Failure at either stage keeps the
  // draft intact behind an inline error; success closes the editor and lets
  // the parent revalidate /paths.
  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      setSaveErr('Name is required.')
      return
    }
    setBusy(true)
    setSaveErr('')
    try {
      const meta = {}
      if (name !== path.name) meta.name = name
      // Trim BOTH sides: a stored blurb with incidental whitespace must not
      // fire a spurious PATCH on an untouched Save.
      if ((draft.blurb || '').trim() !== (path.blurb || '').trim()) meta.blurb = draft.blurb.trim()
      if (draft.kind !== (path.kind === 'course' ? 'course' : 'track')) meta.kind = draft.kind
      if (Object.keys(meta).length > 0) {
        const r = await fetch(`/api/education/paths/${path.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: JSON_HEADERS,
          body: JSON.stringify(meta),
        })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.detail || 'Save failed')
        }
      }
      const steps = draft.steps.map((s) => ({
        youtube_id: s.youtube_id,
        module_label: s.module_label.trim() || null,
        note: s.note.trim() || null,
      }))
      const r2 = await fetch(`/api/education/paths/${path.id}/steps`, {
        method: 'PUT',
        credentials: 'include',
        headers: JSON_HEADERS,
        body: JSON.stringify({ steps }),
      })
      if (!r2.ok) {
        const j = await r2.json().catch(() => ({}))
        throw new Error(j.detail || 'Save failed')
      }
      setDraft(null)
      // Hand the parent exactly what the server now holds so it can mutate
      // the /paths cache optimistically — the syllabus repaints with the
      // saved values instantly instead of flashing the pre-save data for one
      // revalidation round-trip.
      onSaved?.({
        id: path.id,
        name,
        blurb: draft.blurb.trim() || null,
        kind: draft.kind,
        steps,
      })
    } catch (e) {
      setSaveErr(e.message || 'Save failed') // draft preserved — no data loss
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <section className={p.page} aria-label={`Edit ${path.name}`}>
        <button className={p.back} onClick={onBack}>
          <span className={p.flipX} aria-hidden="true">
            <UIcon name="chevronRight" size={14} gold={false} />
          </span>
          Back to videos
        </button>

        <header className={p.head}>
          <div className={p.kindRow}>
            <select
              className={p.kindSelect}
              value={draft.kind}
              onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
              aria-label="Path kind"
              disabled={busy}
            >
              <option value="course">Course</option>
              <option value="track">Track</option>
            </select>
          </div>
          <input
            className={p.nameInput}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            aria-label="Name"
            placeholder="Course name"
            disabled={busy}
          />
          <textarea
            className={p.blurbInput}
            value={draft.blurb}
            onChange={(e) => setDraft((d) => ({ ...d, blurb: e.target.value }))}
            aria-label="Blurb"
            placeholder="One-line blurb (optional)"
            rows={2}
            disabled={busy}
          />
          <div className={p.editActions}>
            <button
              className={p.cta}
              onClick={save}
              disabled={busy || !draft.name.trim()}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className={p.editCancel} onClick={cancelEdit} disabled={busy}>
              Cancel
            </button>
            {saveErr && (
              <span className={p.editErr} role="alert">
                {saveErr}
              </span>
            )}
          </div>
        </header>

        {/* The draft ledger — one flat ordered list (module seams re-group on
            save; grouping while reordering across seams would mislead). */}
        <ol className={p.rows} aria-label="Lessons (draft order)">
          {draft.steps.map((st, i) => {
            const v = videoById[st.youtube_id]
            const title = v?.title || st.youtube_id
            return (
              <li key={`${st.youtube_id}-${i}`} className={p.rowItem}>
                <div className={p.editRow}>
                  <span className={p.rowIndex} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className={p.editBody}>
                    <span className={p.editTitleLine}>
                      <span className={p.rowTitle}>{title}</span>
                      {v?.duration ? (
                        <span className={p.rowDuration}>{v.duration}</span>
                      ) : null}
                      {!v && <span className={p.editMissing}>not in library</span>}
                    </span>
                    <span className={p.editFields}>
                      <input
                        className={p.editField}
                        value={st.module_label}
                        onChange={(e) => setStep(i, 'module_label', e.target.value)}
                        placeholder="Module"
                        aria-label={`Module for lesson ${i + 1}`}
                        disabled={busy}
                      />
                      <input
                        className={p.editField}
                        value={st.note}
                        onChange={(e) => setStep(i, 'note', e.target.value)}
                        placeholder="Teaching note"
                        aria-label={`Note for lesson ${i + 1}`}
                        disabled={busy}
                      />
                    </span>
                  </span>
                  <span className={p.editOps}>
                    <button
                      type="button"
                      className={p.opBtn}
                      onClick={() => moveStep(i, -1)}
                      disabled={busy || i === 0}
                      aria-label={`Move ${title} up`}
                    >
                      <span className={p.flipY} aria-hidden="true">
                        <UIcon name="chevronDown" size={15} gold={false} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className={p.opBtn}
                      onClick={() => moveStep(i, 1)}
                      disabled={busy || i === draft.steps.length - 1}
                      aria-label={`Move ${title} down`}
                    >
                      <UIcon name="chevronDown" size={15} gold={false} />
                    </button>
                    <button
                      type="button"
                      className={`${p.opBtn} ${p.opDanger}`}
                      onClick={() => removeStep(i)}
                      disabled={busy}
                      aria-label={`Remove ${title}`}
                    >
                      <UIcon name="x" size={14} gold={false} />
                    </button>
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
        {draft.steps.length === 0 && (
          <p className={p.editEmpty}>
            No lessons yet — search the library below to add the first one.
          </p>
        )}
        <AddLessonSearch
          allVideos={allVideos}
          existingIds={new Set(draft.steps.map((s) => s.youtube_id))}
          onAdd={addStep}
          disabled={busy}
        />
      </section>
    )
  }

  return (
    <section className={p.page} aria-label={path.name}>
      <button className={p.back} onClick={onBack}>
        <span className={p.flipX} aria-hidden="true">
          <UIcon name="chevronRight" size={14} gold={false} />
        </span>
        Back to videos
      </button>

      <header className={p.head}>
        {/* The kindRow wrapper exists ONLY for admins (it hosts the Edit
            pill). Members keep the exact pre-Task-6 DOM — the whole container
            is gated, mirroring shelfAdminActions on the landing. */}
        {isAdmin ? (
          <div className={p.kindRow}>
            <div className={`${p.kind} ${path.kind === 'course' ? p.kindCourse : ''}`}>
              {path.kind === 'course' ? 'COURSE' : 'TRACK'}
            </div>
            <button className={p.editBtn} onClick={beginEdit}>
              <UIcon name="edit" size={13} gold={false} />
              Edit
            </button>
          </div>
        ) : (
          <div className={`${p.kind} ${path.kind === 'course' ? p.kindCourse : ''}`}>
            {path.kind === 'course' ? 'COURSE' : 'TRACK'}
          </div>
        )}
        <h2 className={p.name}>{path.name}</h2>
        {path.blurb && <p className={p.blurb}>{path.blurb}</p>}
        {total > 0 && (
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
        )}
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
            <ol
              className={p.rows}
              aria-label={
                g.label ||
                (g.part ? `${path.name} lessons, part ${g.part}` : `${path.name} lessons`)
              }
            >
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

// Predictive add-lesson search — a filtered dropdown over the LOADED library
// (title substring, capped at 8), the same client-side idiom the admin
// VideoForm uses for categories. Picking a match appends it to the draft and
// clears the query; Enter takes the top match; Escape clears (stopPropagation
// so the theater's window-level Escape never double-acts). Duplicates are
// allowed by the data model — an already-in-course match is marked, not
// blocked.
function AddLessonSearch({ allVideos, existingIds, onAdd, disabled }) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return allVideos.filter((v) => (v.title || '').toLowerCase().includes(t)).slice(0, 8)
  }, [q, allVideos])
  const pick = (v) => {
    onAdd(v)
    setQ('')
  }
  return (
    <div className={p.addWrap}>
      <input
        className={p.addInput}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Add a lesson — search the library by title…"
        aria-label="Add a lesson"
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setQ('')
          } else if (e.key === 'Enter' && matches.length > 0) {
            e.preventDefault()
            pick(matches[0])
          }
        }}
      />
      {matches.length > 0 && (
        <div className={p.addMenu}>
          {matches.map((v) => (
            <button
              key={v.youtube_id}
              type="button"
              className={p.addOption}
              onClick={() => pick(v)}
            >
              <span className={p.addOptTitle}>{v.title}</span>
              {existingIds.has(v.youtube_id) && (
                <span className={p.addOptIn}>in course</span>
              )}
              <span className={p.addOptMeta}>
                {[v.duration, v.category].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
