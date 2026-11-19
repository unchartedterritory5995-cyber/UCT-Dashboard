// UCT Agent — terminal data wave 1: the words and number formats the five capabilities share (pure; reads nothing).
//
// FRESHNESS WORDING (MD-1 §3): none of these kinds is ever `live`, so no sentence built here says live, now, right
// now or real-time. Every answer states the data's own time, or says in plain words why there is none.
// NO-DATA ANSWERS use fixed words keyed on the envelope's status only: an envelope's notes are never echoed (they can
// carry numbers such as a budget count; agent-qa F-20).
import * as agentClient from '../agentClient'
import { formatCompact } from '../../lib/presentation/presentationPrimitives'

/** Is this kind switched on for the Agent on this server (UCT_AGENT_DATA_KINDS, fail closed)? */
export function kindServed(kind) {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(kind)
}

/** An envelope a capability may read figures from. */
export const usable = (envl) => !!envl && (envl.status === 'ok' || envl.status === 'partial') && !!envl.data && typeof envl.data === 'object'

export const NO_TURN = "this needs the Agent's turn, which wasn't available"
const REFUSED = "that request wasn't allowed for this question, so nothing was read"

/** The fixed no-data sentence: `what` could not be read; `why` is this capability's own words for "unavailable". */
export function noRead(what, envl, why, tail) {
  return `I couldn't read ${what}: ${envl?.status === 'refused' ? REFUSED : why}. ${tail}`
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
/** "$1,234.50" (two decimals), or null. */
export const money = (v) => (finite(v) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null)
/** "+1.50%" / "−0.30%" / "0.00%", or null. */
export const pct = (v) => (finite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%` : null)
/** "1,234,567", or null. */
export const whole = (v) => (finite(v) ? Math.round(v).toLocaleString('en-US') : null)
/** The fixed millions unit at one decimal: "$25.0M", "$0.4M", "$1500.0M" (no K or B tier, on purpose). */
const MILLIONS_TIER = Object.freeze([Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 })])
/** A dollar amount in millions: "$25.0M", or null. The suffix is decided by the shared formatter (TERM-066). */
export const millions = (v) => (finite(v) ? formatCompact(v, { tiers: MILLIONS_TIER, prefix: '$', fixedUnit: true, promote: false, absent: null }) : null)
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "2026-11-13" → "Fri, Nov 13, 2026" (a calendar date: noon UTC, so no zone moves it), or null. */
export function dayText(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

/** An ISO instant → its Eastern calendar day, "2026-11-13", or null. */
export function etDayOf(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** The words this wave never uses for periodic or historical data (MD-1 §3); the tests hold every answer to it. */
export const LIVE_WORDS = /\b(?:live|now|right now|real[- ]time|currently)\b/i
