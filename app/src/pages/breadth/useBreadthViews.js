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
import usePreferences from '../../hooks/usePreferences'

export const STORAGE_KEY = 'uct.breadth.views.v2'
export const V1_KEY = 'uct.breadth.views.v1'
export const DEFAULT_PRESET = 'Default'
export const DEFAULT_STYLE = 'treemap'
export const NAME_MAX = 40
export const PREF_KEY = 'breadth_views_config'
export { STYLES }

const isStyle = (s) => STYLES.includes(s)
const emptyByView = () => Object.fromEntries(STYLES.map(s => [s, { activePreset: DEFAULT_PRESET, presets: {} }]))
const emptyState = () => ({ viewStyle: DEFAULT_STYLE, byView: emptyByView() })

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
    return { viewStyle, byView }
  } catch {
    return null
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const viewStyle = isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE
      return { viewStyle, byView: sanitizeByView(parsed?.byView) }
    }
    const migrated = migrateV1()
    if (migrated) return migrated
    return emptyState()
  } catch {
    return emptyState()
  }
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
  return { viewStyle: state.viewStyle, byView }
}

function writeToStorage(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state))) } catch { /* best-effort */ }
}

export default function useBreadthViews(allMetrics = [], usePrefs = usePreferences) {
  const [state, setState] = useState(() => loadFromStorage())
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
      setState({ viewStyle, byView: sanitizeByView(remote.byView) })
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

  const defaultVisible = useMemo(() => resolveDefaultVisible(viewStyle, allMetrics), [viewStyle, allMetrics])

  // Resolve the active preset's visible set. Migrated presets carry `hidden`
  // (eligible minus hidden); materialized presets carry an explicit `visible`.
  const visibleKeys = useMemo(() => {
    if (isDefaultActive) return defaultVisible
    const preset = view.presets[activePreset]
    if (!preset) return defaultVisible
    const eligible = new Set(VIEW_CONFIG[viewStyle].eligibleKeys(allMetrics).map(m => m.key))
    if (preset.visible) return new Set(preset.visible.filter(k => eligible.has(k)))
    const hidden = new Set(preset.hidden ?? [])
    return new Set([...eligible].filter(k => !hidden.has(k)))
  }, [isDefaultActive, view, activePreset, viewStyle, allMetrics, defaultVisible])

  const options = useMemo(() => {
    const base = optionDefaults(viewStyle)
    if (isDefaultActive) return base
    return { ...base, ...(view.presets[activePreset]?.options ?? {}) }
  }, [viewStyle, isDefaultActive, view, activePreset])

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
  }
}
