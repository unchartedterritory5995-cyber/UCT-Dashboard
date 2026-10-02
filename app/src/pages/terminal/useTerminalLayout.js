// UCT Terminal — the panel grid's state, and the security LINK between panels.
//
// ⭐ THE LINK IS THE /charts COLOUR GROUP, NOT A SECOND ONE. A panel carries a group letter
// from the same vocabulary `WidgetHeader.jsx` cycles (`A B C D` + `N` = not linked), and a
// linked panel's security is read from and written to the SAME preference /charts owns —
// `charts_workspace_groups` (`useAppFocus.FOCUS_PREF_KEY`). So `NVDA` typed into a Group-A
// panel moves every Group-A panel, the /charts Group-A widgets, and the app focus (owner
// call 2026-08-14: "charts Group A IS the app focus") — one value, no second authority.
// Only an `N` panel keeps its own security, inside this shell's layout preference.
//
// ⭐ THE LAYOUT PREFERENCE IS ONE NEW, ADDITIONS-ONLY KEY: `terminal_layout`, a versioned
// JSON blob. No existing key is renamed or re-shaped (coexistence §4 / MG-4); the key is
// allow-listed in `api/routers/auth.py::_PREFERENCE_KEYS` and re-derived from this call
// site by `tests/test_preference_key_validation.py`.
import { useCallback, useMemo } from 'react'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import { FOCUS_PREF_KEY } from '../../hooks/useAppFocus'

export const TERMINAL_LAYOUT_PREF = 'terminal_layout'
export const LAYOUT_VERSION = 1
export const PANEL_COUNTS = [1, 2, 4]
/** The /charts colour-group vocabulary (WidgetHeader.jsx `COLORS`); pinned by test. */
export const LINK_GROUPS = ['A', 'B', 'C', 'D', 'N']
/** The /charts group dot colours (ChartTabStrip.jsx `GROUP_DOT`); pinned by test. */
export const GROUP_DOT = { A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc', N: '#6b7280' }

export const DEFAULT_LAYOUT = Object.freeze({
  v: LAYOUT_VERSION,
  count: 1,
  focus: 0,
  panels: [
    { code: 'CAL', group: 'A', sym: null, args: [] },
    { code: 'DES', group: 'A', sym: null, args: [] },
    { code: 'GP', group: 'A', sym: null, args: [] },
    { code: 'CN', group: 'B', sym: null, args: [] },
  ],
})

export function nextGroup(g) {
  const i = LINK_GROUPS.indexOf(g)
  return LINK_GROUPS[(i + 1) % LINK_GROUPS.length]
}

/** Pure: coerce whatever the preference holds into a valid layout. A bad or foreign blob
 *  falls back to the default rather than crashing the shell (parsePref's own contract). */
export function normalizeLayout(raw) {
  const v = raw && typeof raw === 'object' ? raw : null
  if (!v || v.v !== LAYOUT_VERSION || !Array.isArray(v.panels)) return DEFAULT_LAYOUT
  const count = PANEL_COUNTS.includes(v.count) ? v.count : 1
  const panels = DEFAULT_LAYOUT.panels.map((d, i) => {
    const p = v.panels[i] && typeof v.panels[i] === 'object' ? v.panels[i] : {}
    return {
      code: typeof p.code === 'string' && p.code ? p.code : d.code,
      group: LINK_GROUPS.includes(p.group) ? p.group : d.group,
      sym: typeof p.sym === 'string' && p.sym ? p.sym : null,
      args: Array.isArray(p.args) ? p.args.filter((a) => typeof a === 'string') : [],
    }
  })
  const focus = Number.isInteger(v.focus) && v.focus >= 0 && v.focus < count ? v.focus : 0
  return { v: LAYOUT_VERSION, count, focus, panels }
}

/** Pure: the security a panel shows — its group's linked symbol, or its own when `N`. */
export function panelSym(panel, groups) {
  if (!panel) return null
  if (panel.group && panel.group !== 'N') {
    const s = groups?.[panel.group]
    return typeof s === 'string' && s ? s.toUpperCase() : null
  }
  return panel.sym || null
}

export default function useTerminalLayout() {
  const { prefs, setPref, setPrefMerged, loading } = usePreferences()
  const layout = useMemo(() => normalizeLayout(parsePref(prefs?.[TERMINAL_LAYOUT_PREF], null)),
    [prefs])
  const groups = useMemo(() => parsePref(prefs?.[FOCUS_PREF_KEY], null) || {}, [prefs])

  const save = useCallback((next) => {
    setPref(TERMINAL_LAYOUT_PREF, JSON.stringify(normalizeLayout(next)))
  }, [setPref])

  const setGroupSym = useCallback((group, sym) => {
    const s = String(sym || '').trim().toUpperCase()
    if (!s || !group || group === 'N') return
    // Merge, never replace: the other letters are /charts' live comparison slots.
    setPrefMerged(FOCUS_PREF_KEY, (cur) => {
      const base = cur && typeof cur === 'object' ? cur : {}
      if (base[group] === s) return undefined          // no-op writes cost a POST
      return { ...base, [group]: s }
    })
  }, [setPrefMerged])

  return { layout, groups, save, setGroupSym, loading }
}
