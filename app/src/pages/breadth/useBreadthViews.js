/**
 * Breadth Views customization — localStorage-backed presets that store BOTH the
 * chosen visualization style and which metrics are hidden.
 *
 * Storage shape (key: `uct.breadth.views.v1`):
 *   { activePreset, viewStyle, presets: { [name]: { viewStyle, hidden: string[] } } }
 *
 * Separate storage key from the Monitor sheet (`uct.breadth.customize.v1`) because
 * the metric universe differs. Mirrors useBreadthCustomize idioms.
 *
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const STORAGE_KEY = 'uct.breadth.views.v1'
export const DEFAULT_PRESET = 'Default'
export const STYLES = ['treemap', 'rings', 'tug', 'meters']
export const DEFAULT_STYLE = 'treemap'
export const NAME_MAX = 40

const EMPTY_STATE = { activePreset: DEFAULT_PRESET, viewStyle: DEFAULT_STYLE, presets: {} }
const isStyle = (s) => STYLES.includes(s)

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw)
    const presets = {}
    if (parsed && typeof parsed.presets === 'object' && parsed.presets) {
      for (const [name, val] of Object.entries(parsed.presets)) {
        if (name === DEFAULT_PRESET) continue
        if (val && Array.isArray(val.hidden)) {
          presets[name] = {
            viewStyle: isStyle(val.viewStyle) ? val.viewStyle : DEFAULT_STYLE,
            hidden: val.hidden.filter(k => typeof k === 'string'),
          }
        }
      }
    }
    const active = typeof parsed?.activePreset === 'string' ? parsed.activePreset : DEFAULT_PRESET
    const validActive = active === DEFAULT_PRESET || presets[active] ? active : DEFAULT_PRESET
    const viewStyle = validActive === DEFAULT_PRESET
      ? (isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE)
      : presets[validActive].viewStyle
    return { activePreset: validActive, viewStyle, presets }
  } catch {
    return EMPTY_STATE
  }
}

function writeToStorage(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* best-effort */ }
}

export function validatePresetName(name, existingNames) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'Name cannot be empty.'
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`
  if (trimmed === DEFAULT_PRESET) return `"${DEFAULT_PRESET}" is reserved.`
  if (existingNames.includes(trimmed)) return 'A preset with that name already exists.'
  return null
}

export default function useBreadthViews() {
  const [state, setState] = useState(() => loadFromStorage())

  const stateRef = useRef(state)
  const writeTimer = useRef(null)
  useEffect(() => {
    stateRef.current = state
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => writeToStorage(stateRef.current), 150)
  }, [state])
  useEffect(() => () => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeToStorage(stateRef.current)
  }, [])

  const { activePreset, viewStyle, presets } = state
  const isDefaultActive = activePreset === DEFAULT_PRESET

  const hidden = useMemo(() => {
    if (isDefaultActive) return new Set()
    return new Set(presets[activePreset]?.hidden ?? [])
  }, [isDefaultActive, presets, activePreset])

  const presetNames = useMemo(() => {
    const customs = Object.keys(presets).sort((a, b) => a.localeCompare(b))
    return [DEFAULT_PRESET, ...customs]
  }, [presets])

  const setViewStyle = useCallback((style) => {
    if (!isStyle(style)) return
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return { ...prev, viewStyle: style }
      return {
        ...prev,
        viewStyle: style,
        presets: {
          ...prev.presets,
          [prev.activePreset]: { ...prev.presets[prev.activePreset], viewStyle: style },
        },
      }
    })
  }, [])

  const toggleHidden = useCallback((key) => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev
      const cur = new Set(prev.presets[prev.activePreset]?.hidden ?? [])
      cur.has(key) ? cur.delete(key) : cur.add(key)
      return {
        ...prev,
        presets: {
          ...prev.presets,
          [prev.activePreset]: { ...prev.presets[prev.activePreset], hidden: [...cur] },
        },
      }
    })
  }, [])

  const savePreset = useCallback((name, hiddenKeys = []) => {
    const trimmed = (name ?? '').trim()
    setState(prev => {
      if (validatePresetName(trimmed, Object.keys(prev.presets))) return prev
      const arr = [...new Set(hiddenKeys)].filter(k => typeof k === 'string')
      return {
        activePreset: trimmed,
        viewStyle: prev.viewStyle,
        presets: { ...prev.presets, [trimmed]: { viewStyle: prev.viewStyle, hidden: arr } },
      }
    })
  }, [])

  const renamePreset = useCallback((oldName, newName) => {
    const trimmed = (newName ?? '').trim()
    setState(prev => {
      if (!prev.presets[oldName]) return prev
      const others = Object.keys(prev.presets).filter(n => n !== oldName)
      if (validatePresetName(trimmed, others)) return prev
      const next = { ...prev.presets }
      next[trimmed] = next[oldName]
      delete next[oldName]
      return {
        activePreset: prev.activePreset === oldName ? trimmed : prev.activePreset,
        viewStyle: prev.viewStyle,
        presets: next,
      }
    })
  }, [])

  const deletePreset = useCallback((name) => {
    setState(prev => {
      if (!prev.presets[name]) return prev
      const next = { ...prev.presets }
      delete next[name]
      const goingToDefault = prev.activePreset === name
      return {
        activePreset: goingToDefault ? DEFAULT_PRESET : prev.activePreset,
        viewStyle: goingToDefault ? DEFAULT_STYLE : prev.viewStyle,
        presets: next,
      }
    })
  }, [])

  const switchPreset = useCallback((name) => {
    setState(prev => {
      if (name !== DEFAULT_PRESET && !prev.presets[name]) return prev
      const style = name === DEFAULT_PRESET ? DEFAULT_STYLE : prev.presets[name].viewStyle
      return { ...prev, activePreset: name, viewStyle: style }
    })
  }, [])

  const resetActive = useCallback(() => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev
      return {
        ...prev,
        presets: {
          ...prev.presets,
          [prev.activePreset]: { ...prev.presets[prev.activePreset], hidden: [] },
        },
      }
    })
  }, [])

  return {
    activePreset, viewStyle, hidden, presetNames, presets, isDefaultActive,
    setViewStyle, toggleHidden, savePreset, renamePreset, deletePreset,
    switchPreset, resetActive,
  }
}
