// Notebook widgets Task 16: the Theme Tracker capture, ONE builder for both doors.
//
// The Theme Tracker's "Send this ranking to Journal" and the Notebook's `/themes` insert both build the
// frozen ranking here: the top 40 themes as ranked, each with its move and its three leading names. The
// slash insert takes the member's DEFAULT board, the one a fresh tracker opens on: the shared theme set,
// ranked by today's move high to low, all themes closed, no search. Its first row is the top theme.
import { DESC } from '../../../../lib/presentation/dataGrid/gridSort'
import { getJson, isOffline, captureFailure } from './captureFetch'

/** The shared tracker's data (a personal set adds `?set=<id>`; the default board has none). */
export const THEMES_URL = '/api/theme-performance'

/** The ranking period and direction a fresh tracker opens on: Today, high to low. */
export const DEFAULT_THEMES_PERIOD = '1d'
export const DEFAULT_THEMES_SORT = DESC

export function avgReturn(holdings, periodKey) {
  // Owner rows only (§4b): engine-overlay members never move the theme number,
  // even on this fallback path (server outage / missing group_return).
  const vals = holdings
    .filter(h => h.source !== 'engine')
    .map(h => h.returns?.[periodKey])
    .filter(v => v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function groupReturn(theme, periodKey) {
  return (theme.group_return?.[periodKey] != null)
    ? theme.group_return[periodKey]
    : avgReturn(theme.holdings, periodKey)
}

/** The leaderboard: themes ranked by their move over the period, blanks last either way. */
export function sortThemes(themes, periodKey, sortDir) {
  if (!themes) return []
  return [...themes].sort((a, b) => {
    const av = groupReturn(a, periodKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
    const bv = groupReturn(b, periodKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
    return sortDir === 'desc' ? bv - av : av - bv
  })
}

/** The frozen ranking. Pure: the shown themes (already ranked and filtered), top 40. */
export function buildThemesCapture(shownThemes, { period, sortDir, openTheme, search }) {
  const rows = shownThemes.slice(0, 40).map((t) => {
    const pct = groupReturn(t, period)
    const top = [...(t.holdings || [])]
      .sort((a, b) => (b.returns?.[period] ?? -Infinity) - (a.returns?.[period] ?? -Infinity))
      .slice(0, 3).map((h) => h.sym).join(' · ')
    return {
      sym: t.ticker,
      note: t.name,
      ...(Number.isFinite(pct) ? { chgPct: pct } : {}),
      ...(top ? { extraValue: top } : {}),
    }
  })
  const q = (search || '').trim()
  return {
    period, sortDir,
    ...(openTheme ? { openTheme } : {}),
    ...(q ? { search: q } : {}),
    rows,
  }
}

/** What a fresh tracker fetches: the shared theme set's performance (same endpoint). A failed read inserts
 *  nothing; a payload still being computed, or with no themes, says so and inserts nothing. Never throws. */
export async function fetchThemesCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const res = await getJson(THEMES_URL)
  if (!res.ok || !res.data || typeof res.data !== 'object') return captureFailure()
  const themes = Array.isArray(res.data.themes) ? res.data.themes : []
  if (!themes.length) {
    return {
      ok: false, reason: 'empty',
      message: res.data.status === 'computing'
        ? 'The theme rankings are still being computed. Try again in a minute.'
        : 'There are no theme rankings to show right now, so nothing was added.',
    }
  }
  return { ok: true, data: { themes } }
}

/** The slash insert: fetch, then build the capture a fresh tracker's Send to Journal would build. */
export async function slashCapture() {
  const res = await fetchThemesCaptureData()
  if (!res.ok) return res
  const shown = sortThemes(res.data.themes, DEFAULT_THEMES_PERIOD, DEFAULT_THEMES_SORT)
  return {
    ok: true,
    payload: buildThemesCapture(shown, { period: DEFAULT_THEMES_PERIOD, sortDir: DEFAULT_THEMES_SORT, openTheme: null, search: '' }),
  }
}
