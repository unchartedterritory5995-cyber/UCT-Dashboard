// Study — pure helpers over the skill map (`GET /api/study/map`: the
// curricula → tracks → units tree from docs/study/skill_map.json plus this
// member's `study_skill` rows) and the daily set (`GET /api/study/today`).
//
// Everything here is a plain function so StudyPanel, SkillTrail and the
// course cards derive the SAME answer to "where is this member on the trail"
// — one derivation, never three.
//
// ⛔ No React, no fetch, no Date.now(): the ET day comes from the payload
// (`day_et`), never from the browser clock (D14: day = ET).

/** Band thresholds mirror api/services/study_store.py (BAND_PRACTISED /
 *  BAND_PROFICIENT). A unit's nine rungs light in proportion to its skills'
 *  mastery; proficient (>= 80) lights all nine and reads as mastered — the
 *  gold ring and the "units mastered" bar on the course card are one fact. */
export const MASTERED_AT = 80
export const RUNGS = 9

export function skillsById(skills) {
  const out = {}
  for (const s of Array.isArray(skills) ? skills : []) if (s && s.skill_id) out[s.skill_id] = s
  return out
}

/** { rungs, mastered, started, avg } for one unit. A unit with no skills (a
 *  Foundations placeholder) is untouched: 0 rungs, not started. */
export function unitProgress(unit, byId) {
  const ids = Array.isArray(unit?.skills) ? unit.skills : []
  if (!ids.length) return { rungs: 0, mastered: false, started: false, avg: 0 }
  let sum = 0
  let reps = 0
  for (const id of ids) {
    const row = byId?.[id]
    sum += Number(row?.mastery) || 0
    reps += Number(row?.reps) || 0
  }
  const avg = sum / ids.length
  const mastered = avg >= MASTERED_AT
  const rungs = mastered ? RUNGS : Math.min(RUNGS - 1, Math.floor((avg / MASTERED_AT) * RUNGS))
  return { rungs, mastered, started: reps > 0 || rungs > 0, avg }
}

/** Every unit of a curriculum in trail order, each with its track and progress. */
export function flattenUnits(curriculum, byId) {
  const out = []
  for (const track of curriculum?.tracks || []) {
    for (const unit of track.units || []) {
      out.push({ unit, track, progress: unitProgress(unit, byId) })
    }
  }
  return out
}

/** The node the trail recommends: the first unit that is started but not
 *  mastered; failing that the first unmastered unit; null when the trail is
 *  complete or empty. */
export function recommendUnit(curriculum, byId) {
  const all = flattenUnits(curriculum, byId)
  return all.find((e) => e.progress.started && !e.progress.mastered)
    || all.find((e) => !e.progress.mastered)
    || null
}

/** Counts for a curriculum door (D2 meta line + the 3px mastered bar). */
export function curriculumSummary(curriculum, byId) {
  const tracks = (curriculum?.tracks || []).length
  const all = flattenUnits(curriculum, byId)
  const mastered = all.filter((e) => e.progress.mastered).length
  return { tracks, units: all.length, mastered, pct: all.length ? Math.round((mastered / all.length) * 100) : 0 }
}

/** Per-track progress for the Jump-to sheet pills. */
export function trackSummary(track, byId) {
  const units = track?.units || []
  const mastered = units.filter((u) => unitProgress(u, byId).mastered).length
  return { units: units.length, mastered }
}

/** The curriculum a course card opens (D2: the two course cards are the two
 *  curriculum doors). Keyed on the course slug first, the name second. */
export function curriculumIdForCourse(path, curricula) {
  if (!path) return null
  const ids = new Set((curricula || []).map((c) => c.id))
  const slug = String(path.slug || '').toLowerCase()
  const name = String(path.name || '').toLowerCase()
  const pick = (id) => (ids.has(id) ? id : null)
  if (/foundation/.test(slug) || /foundation/.test(name)) return pick('foundations')
  if (/method/.test(slug) || /method/.test(name)) return pick('method')
  return null
}

/** Find a unit (and its curriculum + track) by id across every curriculum. */
export function locateUnit(curricula, unitId) {
  if (!unitId) return null
  for (const curriculum of curricula || []) {
    for (const track of curriculum.tracks || []) {
      const unit = (track.units || []).find((u) => u.id === unitId)
      if (unit) return { curriculum, track, unit }
    }
  }
  return null
}

/** Shape of the daily set for the panel's copy. */
export function todayState(today) {
  const items = Array.isArray(today?.items) ? today.items : []
  const total = items.length || 10
  const answeredIds = Array.isArray(today?.answered_item_ids) ? today.answered_item_ids : []
  const answered = Math.min(total, answeredIds.length)
  const left = total - answered
  const finished = !!today?.finished_at || (answered > 0 && left === 0)
  return { total, answered, left, finished }
}

/** "about N min" for n questions — D6's 10-item set is ~4 min 25 s, and the
 *  spec's own copy rounds 10 → 4 min and 6 → 2 min, i.e. 24 s a question. */
export function minutesFor(questions) {
  return Math.max(1, Math.round((questions * 24) / 60))
}

export function ordinal(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return ''
  const mod100 = v % 100
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`
  switch (v % 10) {
    case 1: return `${v}st`
    case 2: return `${v}nd`
    case 3: return `${v}rd`
    default: return `${v}th`
  }
}

const DAY_MS = 86400000
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** Seven booleans, Monday..Sunday of the week containing `dayEt`: true when
 *  that day is inside the current streak run (streak days back from
 *  last_done_day). Days after today are always false. */
export function weekDots(dayEt, lastDoneDay, streak) {
  const today = parseYmd(dayEt)
  if (today == null) return Array(7).fill(false)
  const dow = (new Date(today).getUTCDay() + 6) % 7 // Mon=0
  const monday = today - dow * DAY_MS
  const last = parseYmd(lastDoneDay)
  const n = Math.max(0, Number(streak) || 0)
  const first = last == null ? null : last - (n - 1) * DAY_MS
  return Array.from({ length: 7 }, (_, i) => {
    const d = monday + i * DAY_MS
    if (d > today || last == null || n === 0) return false
    return d >= first && d <= last
  })
}

export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
