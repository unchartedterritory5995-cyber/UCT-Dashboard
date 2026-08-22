// ─── WHAT THE USER IS LOOKING AT, APP-WIDE ──────────────────────────────────
//
// The app had no shared notion of "current symbol". /charts had a rich one
// (WorkspaceContext color groups) that stopped at the edge of that page; the
// only app-level contexts were auth and voice. So charting AMD and then
// opening the notebook told the notebook nothing.
//
// ⭐ THIS ADDS NO STATE. Owner's call (2026-08-14): charts **Group A IS the
// app focus**. The storage is the pref ChartsWorkspace already owns and
// persists — `charts_workspace_groups`.A — read here through the same
// app-wide usePreferences/SWR cache. There is exactly ONE value, so there is
// no second authority to drift: any surface reading focus is reading the
// charts group, and any surface setting it is setting the charts group.
//
// ⚠️ KNOWN LIMIT, deliberately not hacked around: ChartsWorkspace hydrates
// its in-memory groups from this pref ONCE per mount ("so it never clobbers a
// live in-session ticker change"). A focus change made on another surface
// while /charts is already mounted therefore lands on the next /charts mount,
// not instantly. Navigating between surfaces — the case this exists for —
// unmounts and remounts, so it is applied. Making it live would mean removing
// that one-shot guard, which exists for a real reason.
//
// ⚠️ Focus is a SYMBOL only (the ceiling of this model). Date anchors and
// trade refs still travel by explicit link (lib/chartDeepLink.js).

import { useCallback } from 'react'
import usePreferences, { parsePref } from './usePreferences'

/** The pref that stores the color groups — spelled to match ChartsWorkspace.
 *  Pinned by useAppFocus.test.js, which reads the key out of that file's
 *  SOURCE rather than trusting this copy. */
export const FOCUS_PREF_KEY = 'charts_workspace_groups'
/** Group A is the focus slot; B/C/D stay charts-local comparison slots. */
export const FOCUS_GROUP = 'A'

export default function useAppFocus() {
  const { prefs, setPref, loading } = usePreferences()
  const groups = parsePref(prefs?.[FOCUS_PREF_KEY], null) || {}
  const symbol = typeof groups[FOCUS_GROUP] === 'string' && groups[FOCUS_GROUP]
    ? groups[FOCUS_GROUP].toUpperCase()
    : null

  const setSymbol = useCallback((next) => {
    const s = String(next || '').trim().toUpperCase()
    if (!s) return
    const cur = parsePref(prefs?.[FOCUS_PREF_KEY], null) || {}
    if (cur[FOCUS_GROUP] === s) return          // no-op writes cost a POST
    // Merge, never replace: B/C/D are the user's comparison slots and a
    // focus change from another surface must not clear them.
    setPref(FOCUS_PREF_KEY, JSON.stringify({ ...cur, [FOCUS_GROUP]: s }))
  }, [prefs, setPref])

  return { symbol, setSymbol, loading }
}
