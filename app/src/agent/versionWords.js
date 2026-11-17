// #1248 AUDIT T2 (words must cover the target): which saved version of the board a restore's RELATIVE / TIME / POINTER
// words mean — read against the history the plan was made on (the effect carries it: `base`, `history`, `offered`).
// Pure: the clock is passed in. The state rail licenses a restore only when these words resolve to EXACTLY the planned
// version; anything else fails closed (nothing written, no card).
//
//   resolved  "previous / the last save / the one before / before this one / N saves back"  → the newest usable version
//             strictly older than the current base (tombstones skipped), or the Nth;  "yesterday / this morning /
//             N hours ago / N days ago / as it was on <date>"  → every usable version (not the current one) whose
//             createdAt falls in that window. Several resolvers in one clause must agree (their intersection).
//   pointer   "it / that one / this one": only the ONE version the Agent last listed / offered in this conversation.
//   ask       "earlier / an older one / a while ago / an old version / how it was / …": no single version — asked, with
//             the recent versions as choices. Never applied.
//   none      no version words at all.

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const NUM = String.raw`(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`
const numOf = (w) => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[String(w).toLowerCase()] ?? null)
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// ── New York wall clock (the Version history panel shows ET) ──
function etParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))
  const g = (t) => Number(parts.find(p => p.type === t)?.value)
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') }
}
/** Epoch ms of a New York wall-clock moment (day / hour may overflow: Date.UTC normalises). */
function etMs(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0)
  const p = etParts(guess)
  const off = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - guess
  const first = guess - off
  // (across a DST change the offset at the answer can differ from the guess's: one more pass)
  const p2 = etParts(first)
  const off2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.mi, p2.s) - first
  return guess - off2
}
const dayWindow = (y, m, d) => [etMs(y, m, d), etMs(y, m, d + 1)]

/** The time window the words name → [startMs, endMs) or null (none named). `bad` → named but unreadable. */
export function timeWindowOf(clause, nowMs) {
  const c = String(clause || '').toLowerCase()
  const t = etParts(nowMs)
  const ago = new RegExp(String.raw`\b${NUM}\s+(minute|min|hour|hr|day|week)s?\s+ago\b`).exec(c)
  if (ago) {
    const n = numOf(ago[1])
    if (!(n >= 1)) return { bad: true }
    const u = ago[2]
    if (u === 'minute' || u === 'min') { const at = nowMs - n * 60_000, slack = Math.max(2, n / 2) * 60_000; return { win: [at - slack, at + slack] } }
    if (u === 'hour' || u === 'hr') { const at = nowMs - n * 3_600_000; return { win: [at - 1_800_000, at + 1_800_000] } }
    return { win: dayWindow(t.y, t.m, t.d - n * (u === 'week' ? 7 : 1)) }
  }
  if (/\byesterday\b/.test(c)) {
    if (/\byesterday (?:morning)\b/.test(c)) return { win: [etMs(t.y, t.m, t.d - 1, 0), etMs(t.y, t.m, t.d - 1, 12)] }
    if (/\byesterday (?:afternoon)\b/.test(c)) return { win: [etMs(t.y, t.m, t.d - 1, 12), etMs(t.y, t.m, t.d - 1, 18)] }
    if (/\byesterday (?:evening)\b/.test(c)) return { win: [etMs(t.y, t.m, t.d - 1, 18), etMs(t.y, t.m, t.d)] }
    return { win: dayWindow(t.y, t.m, t.d - 1) }
  }
  if (/\bthis morning\b/.test(c)) return { win: [etMs(t.y, t.m, t.d, 0), etMs(t.y, t.m, t.d, 12)] }
  if (/\bthis afternoon\b/.test(c)) return { win: [etMs(t.y, t.m, t.d, 12), etMs(t.y, t.m, t.d, 18)] }
  if (/\b(?:this evening|tonight)\b/.test(c)) return { win: [etMs(t.y, t.m, t.d, 18), etMs(t.y, t.m, t.d + 1)] }
  if (/\blast night\b/.test(c)) return { win: [etMs(t.y, t.m, t.d - 1, 18), etMs(t.y, t.m, t.d, 6)] }
  if (/\b(?:earlier )?today\b/.test(c)) return { win: dayWindow(t.y, t.m, t.d) }
  // dates: 2026-11-13 · 11/13[/2026] · Nov 13[th][, 2026] · 13 Nov[ 2026]
  let y = null, m = null, d = null
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(c)
  const us = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(c)
  const md = new RegExp(String.raw`\b(${MONTHS.join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`).exec(c)
  const dm = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS.join('|')})[a-z]*\b(?:,?\s+(\d{4}))?`).exec(c)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), us[3] ? Number(us[3].length === 2 ? `20${us[3]}` : us[3]) : null]
  else if (md) [m, d, y] = [MONTHS.indexOf(md[1]) + 1, Number(md[2]), md[3] ? Number(md[3]) : null]
  else if (dm) [d, m, y] = [Number(dm[1]), MONTHS.indexOf(dm[2]) + 1, dm[3] ? Number(dm[3]) : null]
  else return null
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return { bad: true }
  return { win: dayWindow(y ?? t.y, m, d) }
}

// "previous" / "prior" / "the last save" / "the one before" / "before this one" / "before I changed it": ONE save back
const PREV = /\b(?:previous|prior)\b|\b(?:the |my )?last (?:save|saved(?: version| board| layout)?|version|one)\b|\b(?:the )?(?:one|version|save)\s+before\b|\bbefore (?:this|that|the current|the last|my last|now)\b|\bbefore (?:i|my|we) (?:last )?(?:chang|sav|edit|mess|touch|broke|restor)\w*/i
// "2 saves back" / "back three versions" / "one version ago"
const STEPS = new RegExp(String.raw`\b${NUM}\s+(?:saves?|versions?|steps?)\s+(?:back|ago|earlier|before)\b|\bback\s+${NUM}\s+(?:saves?|versions?|steps?)\b`, 'i')
// a version with no single meaning: asked, never applied
const AMBIG = /\b(?:earlier|older|old|oldest|while|ago|some time|before|history|backup|saved?|versions?|how it (?:was|looked)|as it was|the way it was|last week|last month|original|good one|working one)\b/i
const POINTER = /\b(?:it|that|this|those)(?:\s+(?:one|version|save))?\b/i

/** The board's usable versions older than the current one (newest first), from the history the plan carries. */
export function olderVersions(e) {
  const base = Number(e?.base)
  return (Array.isArray(e?.history) ? e.history : []).filter(v => v && !v.tombstone && Number.isFinite(Number(v.version)) && (!Number.isFinite(base) || Number(v.version) < base))
    .sort((a, b) => Number(b.version) - Number(a.version))
}

/**
 * What a restore clause's words point at → { kind: 'resolved', versions } | { kind: 'pointer', offered } | { kind: 'ask' }
 * | { kind: 'none' }. Without the history on the effect a relative / time word resolves to NOTHING (fails closed).
 */
export function restoreWordsTarget(clause, e, nowMs) {
  const c = String(clause || '')
  const older = olderVersions(e)
  const sets = []
  const steps = STEPS.exec(c)
  if (steps) {
    const k = numOf(steps[1] || steps[2])
    sets.push(k >= 1 && older[k - 1] ? [Number(older[k - 1].version)] : [])
  } else if (PREV.test(c)) sets.push(older[0] ? [Number(older[0].version)] : [])
  let tw = null
  try { tw = timeWindowOf(c, nowMs) } catch { tw = { bad: true } }
  if (tw) {
    if (tw.bad || !tw.win) sets.push([])
    else {
      const base = Number(e?.base)
      const inWin = (Array.isArray(e?.history) ? e.history : []).filter(v => v && !v.tombstone && Number(v.version) !== base && Number.isFinite(Number(v.createdAt))
        && Number(v.createdAt) * 1000 >= tw.win[0] && Number(v.createdAt) * 1000 < tw.win[1] && Number(v.createdAt) * 1000 <= nowMs)
      sets.push(inWin.map(v => Number(v.version)))
    }
  }
  if (sets.length) return { kind: 'resolved', versions: sets.reduce((a, b) => a.filter(x => b.includes(x))) }
  if (POINTER.test(c.replace(/\b(?:put|take|bring|turn|set|roll|switch)\s+(?:it|this|that)\b/gi, ' ').replace(/\b(?:how|as|the way)\s+it\b/gi, ' '))) return { kind: 'pointer', offered: Array.isArray(e?.offered) ? e.offered.map(Number) : [] }
  if (AMBIG.test(c)) return { kind: 'ask' }
  return { kind: 'none' }
}

const etStamp = (sec) => {
  try {
    return new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
  } catch { return '' }
}
/** "version 4 (Nov 12, 3:04 PM ET)" */
export const versionLabel = (v) => `version ${v.version}${Number.isFinite(Number(v.createdAt)) ? ` (${etStamp(Number(v.createdAt))})` : ''}`
