/**
 * Breadth Views customization — v2 per-view model. Each style keeps its own
 * active preset + named presets; each preset stores an explicit `visible` key
 * list and a view-specific `options` object. "Default" is implicit per view
 * (resolved from viewMetricConfig). Migrates the v1 global-hidden blob forward.
 *
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-per-view-customize-design.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STYLES, VIEW_CONFIG, resolveDefaultVisible, optionDefaults,
} from './views/viewMetricConfig'
import { DEFAULT_LAYOUT, LAYOUTS, defaultQuad, normalizeQuad, pickIntoQuad } from './compareQuad'
import usePreferences from '../../hooks/usePreferences'

export const STORAGE_KEY = 'uct.breadth.views.v2'
export const V1_KEY = 'uct.breadth.views.v1'
export const DEFAULT_PRESET = 'Default'
export const DEFAULT_STYLE = 'treemap'
// Re-exported from `compareQuad.js`, which owns them.
export { DEFAULT_LAYOUT, LAYOUTS }
export const NAME_MAX = 40
export const PREF_KEY = 'breadth_views_config'
export { STYLES }

const isStyle = (s) => STYLES.includes(s)
const isLayout = (l) => LAYOUTS.includes(l)
const emptyByView = () => Object.fromEntries(STYLES.map(s => [s, { activePreset: DEFAULT_PRESET, presets: {} }]))
const emptyState = () => ({
  viewStyle: DEFAULT_STYLE, byView: emptyByView(),
  // Compare mode rides in the SAME preference blob as everything else on this
  // tab (spec §3: "persists alongside the existing view preferences"), so it
  // survives a reload and follows the account, with no second store to keep in
  // step. `compare` is always a legal quad — `compareQuad.js` owns that rule.
  layout: DEFAULT_LAYOUT, compare: defaultQuad(),
})

export function validatePresetName(name, existingNames) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'Name cannot be empty.'
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`
  if (trimmed === DEFAULT_PRESET) return `"${DEFAULT_PRESET}" is reserved.`
  if (existingNames.includes(trimmed)) return 'A preset with that name already exists.'
  return null
}

// A preset is either materialized (`{ visible, options }`) or migrated-from-v1
// (`{ hidden, options }`, resolved against the eligible set at read time). The
// dual shape survives write→reload because both fields are preserved here.
function sanitizeByView(raw) {
  const out = emptyByView()
  if (!raw || typeof raw !== 'object') return out
  for (const s of STYLES) {
    const v = raw[s]
    if (!v || typeof v !== 'object') continue
    const presets = {}
    if (v.presets && typeof v.presets === 'object') {
      for (const [name, p] of Object.entries(v.presets)) {
        if (name === DEFAULT_PRESET || !p || typeof p !== 'object') continue
        const out2 = { options: (p.options && typeof p.options === 'object') ? { ...p.options } : {} }
        if (Array.isArray(p.visible)) out2.visible = p.visible.filter(k => typeof k === 'string')
        if (Array.isArray(p.hidden)) out2.hidden = p.hidden.filter(k => typeof k === 'string')
        if (!out2.visible && !out2.hidden) out2.visible = []
        presets[name] = out2
      }
    }
    const active = typeof v.activePreset === 'string' && (v.activePreset === DEFAULT_PRESET || presets[v.activePreset])
      ? v.activePreset : DEFAULT_PRESET
    out[s] = { activePreset: active, presets }
  }
  return out
}

function migrateV1() {
  try {
    const raw = localStorage.getItem(V1_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const byView = emptyByView()
    const viewStyle = isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE
    if (parsed?.presets && typeof parsed.presets === 'object') {
      for (const [name, p] of Object.entries(parsed.presets)) {
        if (name === DEFAULT_PRESET || !p) continue
        const vs = isStyle(p.viewStyle) ? p.viewStyle : DEFAULT_STYLE
        const hidden = Array.isArray(p.hidden) ? p.hidden.filter(k => typeof k === 'string') : []
        // Stored as a `hidden` preset; the eligible-set intersection is applied
        // at read time (so the metric universe need not be known at load).
        byView[vs].presets[name] = { hidden, options: {} }
      }
    }
    // v1 predates compare mode entirely; a migrated blob gets the fresh-install
    // layout rather than an `undefined` that would reach the grid.
    return { viewStyle, byView, layout: DEFAULT_LAYOUT, compare: defaultQuad() }
  } catch {
    return null
  }
}

/** A stored blob predates compare mode, so both keys are optional and both
 *  fall back to the same values a fresh install gets. */
const sanitizeLayout = (v) => (isLayout(v) ? v : DEFAULT_LAYOUT)
const sanitizeQuad = (v) => normalizeQuad(v) ?? defaultQuad()

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const viewStyle = isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE
      return {
        viewStyle, byView: sanitizeByView(parsed?.byView),
        layout: sanitizeLayout(parsed?.layout), compare: sanitizeQuad(parsed?.compare),
      }
    }
    const migrated = migrateV1()
    if (migrated) return migrated
    return emptyState()
  } catch {
    return emptyState()
  }
}

/**
 * ⭐ THE URL WINS OVER STORED PREFERENCES (spec §5) — and that has to be
 * enforced HERE, not in an effect at the call site.
 *
 * The server blob arrives asynchronously and `setState`s the whole thing, so a
 * "apply the URL once on mount" effect in the container would be silently
 * stomped a tick later by hydration. Overrides are therefore applied to BOTH
 * the initial state and the hydrated state, from one function, so there is no
 * moment at which the stored preference is on screen and the link's is not.
 */
function applyUrlOverrides(state, o) {
  if (!o) return state
  const next = { ...state }
  if (isStyle(o.viewStyle)) next.viewStyle = o.viewStyle
  if (Array.isArray(o.compareQuad)) next.compare = sanitizeQuad(o.compareQuad)
  if (isLayout(o.layout)) next.layout = o.layout
  return next
}

function serializeState(state) {
  const byView = {}
  for (const s of STYLES) {
    const v = state.byView[s]
    const presets = {}
    for (const [name, p] of Object.entries(v.presets)) {
      const out = { options: p.options ?? {} }
      if (p.visible) out.visible = p.visible
      else if (p.hidden) out.hidden = p.hidden
      else out.visible = []
      presets[name] = out
    }
    byView[s] = { activePreset: v.activePreset, presets }
  }
  return {
    viewStyle: state.viewStyle, byView,
    layout: sanitizeLayout(state.layout), compare: sanitizeQuad(state.compare),
  }
}

function writeToStorage(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state))) } catch { /* best-effort */ }
}

export default function useBreadthViews(allMetrics = [], usePrefs = usePreferences, urlOverrides = null) {
  // Captured on the first render and never re-read: the URL is an ENTRY
  // condition, not a live input, so a later write-back cannot re-apply itself
  // over a choice the user has since made.
  const overridesRef = useRef(urlOverrides)
  const [state, setState] = useState(() => applyUrlOverrides(loadFromStorage(), overridesRef.current))
  const { prefs, setPref, loading } = usePrefs()

  const stateRef = useRef(state)
  const hydratedRef = useRef(false)
  const writeTimer = useRef(null)

  // Persist on change: localStorage always; server once hydrated.
  useEffect(() => {
    stateRef.current = state
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      writeToStorage(stateRef.current)
      if (hydratedRef.current) {
        try { setPref(PREF_KEY, serializeState(stateRef.current)) } catch { /* best-effort */ }
      }
    }, 150)
  }, [state, setPref])

  // Flush local on unmount (server flush skipped to avoid post-unmount writes).
  useEffect(() => () => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeToStorage(stateRef.current)
  }, [])

  // Hydrate once from the server (server wins); else migrate local presets up.
  useEffect(() => {
    if (hydratedRef.current || loading) return
    hydratedRef.current = true
    const remote = prefs?.[PREF_KEY]
    if (remote && typeof remote === 'object' && remote.byView) {
      const viewStyle = isStyle(remote.viewStyle) ? remote.viewStyle : DEFAULT_STYLE
      setState(applyUrlOverrides({
        viewStyle, byView: sanitizeByView(remote.byView),
        layout: sanitizeLayout(remote.layout), compare: sanitizeQuad(remote.compare),
      }, overridesRef.current))
    } else {
      const serial = serializeState(stateRef.current)
      const hasCustom = STYLES.some(s => Object.keys(serial.byView[s].presets).length > 0)
      if (hasCustom) { try { setPref(PREF_KEY, serial) } catch { /* best-effort */ } }
    }
  }, [loading, prefs, setPref])

  const viewStyle = state.viewStyle
  const view = state.byView[viewStyle] ?? { activePreset: DEFAULT_PRESET, presets: {} }
  const activePreset = view.activePreset
  const isDefaultActive = activePreset === DEFAULT_PRESET

  /**
   * ⭐ PER-STYLE, NOT PER-ACTIVE-STYLE — this is what makes compare mode nearly
   * free. Resolving "what is visible / what are the options for style X" used
   * to be two memos hardwired to `state.viewStyle`; a 2×2 grid needs the same
   * answer for four styles at once, and the spec's ruling is that a pane shows
   * "Radar's options, wherever it sits". So the resolvers take the style, and
   * the ACTIVE style's values are just `resolveX(viewStyle)` — one
   * implementation, so a pane and the single view can never disagree about what
   * a style's preset says.
   *
   * Migrated presets carry `hidden` (eligible minus hidden); materialized ones
   * carry an explicit `visible`.
   */
  const visibleKeysFor = useCallback((style) => {
    if (!isStyle(style)) return new Set()
    const v = state.byView[style] ?? { activePreset: DEFAULT_PRESET, presets: {} }
    const preset = v.activePreset === DEFAULT_PRESET ? null : v.presets[v.activePreset]
    if (!preset) return resolveDefaultVisible(style, allMetrics)
    const eligible = new Set(VIEW_CONFIG[style].eligibleKeys(allMetrics).map(m => m.key))
    if (preset.visible) return new Set(preset.visible.filter(k => eligible.has(k)))
    const hidden = new Set(preset.hidden ?? [])
    return new Set([...eligible].filter(k => !hidden.has(k)))
  }, [state.byView, allMetrics])

  const optionsFor = useCallback((style) => {
    if (!isStyle(style)) return {}
    const v = state.byView[style] ?? { activePreset: DEFAULT_PRESET, presets: {} }
    const base = optionDefaults(style)
    if (v.activePreset === DEFAULT_PRESET) return base
    return { ...base, ...(v.presets[v.activePreset]?.options ?? {}) }
  }, [state.byView])

  const visibleKeys = useMemo(() => visibleKeysFor(viewStyle), [visibleKeysFor, viewStyle])
  const options = useMemo(() => optionsFor(viewStyle), [optionsFor, viewStyle])

  const presetNames = useMemo(
    () => [DEFAULT_PRESET, ...Object.keys(view.presets).sort((a, b) => a.localeCompare(b))],
    [view.presets],
  )

  const eligibleMetrics = useCallback(
    () => VIEW_CONFIG[viewStyle].eligibleKeys(allMetrics).filter(m => !m.isHeader),
    [viewStyle, allMetrics],
  )

  // --- mutators (all operate on the ACTIVE view) ---
  const patchView = (prev, fn) => ({
    ...prev,
    byView: { ...prev.byView, [prev.viewStyle]: fn(prev.byView[prev.viewStyle]) },
  })

  const setViewStyle = useCallback((style) => {
    if (!isStyle(style)) return
    setState(prev => ({ ...prev, viewStyle: style }))
  }, [])

  const setLayout = useCallback((next) => {
    if (!isLayout(next)) return
    setState(prev => (prev.layout === next ? prev : { ...prev, layout: next }))
  }, [])

  // The pick goes through `pickIntoQuad`, so "already showing elsewhere" is a
  // SWAP rather than a duplicate — see the ruling at the top of compareQuad.js.
  const setComparePane = useCallback((i, style) => {
    setState(prev => {
      const next = pickIntoQuad(prev.compare, i, style)
      return next === prev.compare ? prev : { ...prev, compare: next }
    })
  }, [])

  // Resolve a preset's current visible array (used when an edit materializes a
  // migrated `hidden` preset into an explicit `visible` one). Editing Default is
  // blocked by the callers, so this only runs for custom presets.
  const materializeActive = (prev) => {
    const v = prev.byView[prev.viewStyle]
    // Saving / editing from Default starts from the view's curated default set,
    // not the full eligible board.
    if (v.activePreset === DEFAULT_PRESET) return [...resolveDefaultVisible(prev.viewStyle, allMetrics)]
    const eligible = new Set(VIEW_CONFIG[prev.viewStyle].eligibleKeys(allMetrics).map(m => m.key))
    const p = v.presets[v.activePreset]
    if (!p) return [...eligible]
    if (p.visible) return p.visible.filter(k => eligible.has(k))
    const hidden = new Set(p.hidden ?? [])
    return [...eligible].filter(k => !hidden.has(k))
  }

  const toggleVisible = useCallback((key) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (v.activePreset === DEFAULT_PRESET) return prev  // immutable
      return patchView(prev, (vv) => {
        const cur = new Set(materializeActive(prev))
        cur.has(key) ? cur.delete(key) : cur.add(key)
        const p = vv.presets[vv.activePreset]
        return {
          ...vv,
          presets: { ...vv.presets, [vv.activePreset]: { visible: [...cur], options: p.options ?? {} } },
        }
      })
    })
  }, [allMetrics])

  const setOption = useCallback((name, value) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (v.activePreset === DEFAULT_PRESET) return prev
      return patchView(prev, (vv) => {
        const p = vv.presets[vv.activePreset]
        return {
          ...vv,
          presets: { ...vv.presets, [vv.activePreset]: { visible: materializeActive(prev), options: { ...(p.options ?? {}), [name]: value } } },
        }
      })
    })
  }, [allMetrics])

  const savePreset = useCallback((name) => {
    const trimmed = (name ?? '').trim()
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (validatePresetName(trimmed, Object.keys(v.presets))) return prev
      const visible = materializeActive(prev)
      const options = v.activePreset === DEFAULT_PRESET ? {} : { ...(v.presets[v.activePreset]?.options ?? {}) }
      return patchView(prev, (vv) => ({
        activePreset: trimmed,
        presets: { ...vv.presets, [trimmed]: { visible, options } },
      }))
    })
  }, [allMetrics])

  const renamePreset = useCallback((oldName, newName) => {
    const trimmed = (newName ?? '').trim()
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (!v.presets[oldName]) return prev
      if (validatePresetName(trimmed, Object.keys(v.presets).filter(n => n !== oldName))) return prev
      return patchView(prev, (vv) => {
        const next = { ...vv.presets }
        next[trimmed] = next[oldName]; delete next[oldName]
        return { activePreset: vv.activePreset === oldName ? trimmed : vv.activePreset, presets: next }
      })
    })
  }, [])

  const deletePreset = useCallback((name) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (!v.presets[name]) return prev
      return patchView(prev, (vv) => {
        const next = { ...vv.presets }; delete next[name]
        return { activePreset: vv.activePreset === name ? DEFAULT_PRESET : vv.activePreset, presets: next }
      })
    })
  }, [])

  const switchPreset = useCallback((name) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (name !== DEFAULT_PRESET && !v.presets[name]) return prev
      return patchView(prev, (vv) => ({ ...vv, activePreset: name }))
    })
  }, [])

  const resetActive = useCallback(() => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (v.activePreset === DEFAULT_PRESET) return prev
      const visible = [...resolveDefaultVisible(prev.viewStyle, allMetrics)]
      return patchView(prev, (vv) => ({
        ...vv,
        presets: { ...vv.presets, [vv.activePreset]: { visible, options: {} } },
      }))
    })
  }, [allMetrics])

  return {
    viewStyle, activePreset, isDefaultActive, visibleKeys, options, presetNames,
    eligibleMetrics, setViewStyle, toggleVisible, setOption, savePreset,
    renamePreset, deletePreset, switchPreset, resetActive,
    // compare mode (spec §3)
    layout: state.layout, compareQuad: state.compare, setLayout, setComparePane,
    visibleKeysFor, optionsFor,
  }
}
