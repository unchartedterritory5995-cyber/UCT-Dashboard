/**
 * Breadth Sheet Customization — localStorage-backed presets hook.
 *
 * Storage shape (key: `uct.breadth.customize.v1`):
 *   { activePreset: string, presets: { [name]: { hidden: string[] } } }
 *
 * `Default` is hard-coded ({ hidden: [] }) and never appears in `presets`.
 * Storing `hidden` (vs `visible`) means new metrics added in code auto-appear
 * in every saved preset — users only re-hide them if unwanted.
 *
 * See docs/superpowers/specs/2026-04-24-breadth-customize-design.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const STORAGE_KEY = 'uct.breadth.customize.v1'
export const DEFAULT_PRESET = 'Default'
export const NAME_MAX = 40

const EMPTY_STATE = { activePreset: DEFAULT_PRESET, presets: {} }

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
          presets[name] = { hidden: val.hidden.filter(k => typeof k === 'string') }
        }
      }
    }
    const active = typeof parsed?.activePreset === 'string' ? parsed.activePreset : DEFAULT_PRESET
    const validActive = active === DEFAULT_PRESET || presets[active] ? active : DEFAULT_PRESET
    return { activePreset: validActive, presets }
  } catch {
    return EMPTY_STATE
  }
}

function writeToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota / private mode — silent. Prefs are best-effort.
  }
}

export function validatePresetName(name, existingNames) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'Name cannot be empty.'
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`
  if (trimmed === DEFAULT_PRESET) return `"${DEFAULT_PRESET}" is reserved.`
  if (existingNames.includes(trimmed)) return 'A preset with that name already exists.'
  return null
}

/**
 * Hook returns:
 *   activePreset           string — currently selected preset name
 *   hidden                 Set<string> — keys hidden by the active preset
 *   presetNames            string[] — ['Default', ...alphabetical custom presets]
 *   isDefaultActive        boolean
 *   toggleHidden(key)      flip visibility for key in active preset
 *   setHiddenSet(keys)     replace the active preset's hidden set entirely
 *   savePreset(name, keys) create a new preset and switch to it
 *   renamePreset(old, new) rename a custom preset
 *   deletePreset(name)     delete a custom preset; switch to Default
 *   switchPreset(name)     set active
 *   resetActive()          clear hidden set on the active preset (Default no-op)
 */
export default function useBreadthCustomize() {
  const [state, setState] = useState(() => loadFromStorage())

  // Debounce writes so rapid checkbox toggles don't thrash storage.
  // stateRef lets the unmount flush always see the current value, avoiding
  // a stale-closure bug if the empty-deps effect captured the initial state.
  const stateRef = useRef(state)
  const writeTimer = useRef(null)
  useEffect(() => {
    stateRef.current = state
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => writeToStorage(stateRef.current), 150)
  }, [state])

  // Flush pending write on unmount so the last toggle isn't lost.
  useEffect(() => {
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeToStorage(stateRef.current)
    }
  }, [])

  const { activePreset, presets } = state
  const isDefaultActive = activePreset === DEFAULT_PRESET

  const hidden = useMemo(() => {
    if (isDefaultActive) return new Set()
    return new Set(presets[activePreset]?.hidden ?? [])
  }, [isDefaultActive, presets, activePreset])

  const presetNames = useMemo(() => {
    const customs = Object.keys(presets).sort((a, b) => a.localeCompare(b))
    return [DEFAULT_PRESET, ...customs]
  }, [presets])

  const setHiddenSet = useCallback((keys) => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev  // immutable
      const arr = [...new Set(keys)].filter(k => typeof k === 'string')
      return {
        ...prev,
        presets: { ...prev.presets, [prev.activePreset]: { hidden: arr } },
      }
    })
  }, [])

  const toggleHidden = useCallback((key) => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev  // caller must Save As… first
      const cur = new Set(prev.presets[prev.activePreset]?.hidden ?? [])
      if (cur.has(key)) cur.delete(key)
      else cur.add(key)
      return {
        ...prev,
        presets: { ...prev.presets, [prev.activePreset]: { hidden: [...cur] } },
      }
    })
  }, [])

  const savePreset = useCallback((name, hiddenKeys = []) => {
    const trimmed = (name ?? '').trim()
    setState(prev => {
      const err = validatePresetName(trimmed, Object.keys(prev.presets))
      if (err) return prev  // caller validates first; this is defensive
      const arr = [...new Set(hiddenKeys)].filter(k => typeof k === 'string')
      return {
        activePreset: trimmed,
        presets: { ...prev.presets, [trimmed]: { hidden: arr } },
      }
    })
  }, [])

  const renamePreset = useCallback((oldName, newName) => {
    const trimmed = (newName ?? '').trim()
    setState(prev => {
      if (!prev.presets[oldName]) return prev
      const others = Object.keys(prev.presets).filter(n => n !== oldName)
      const err = validatePresetName(trimmed, others)
      if (err) return prev
      const next = { ...prev.presets }
      next[trimmed] = next[oldName]
      delete next[oldName]
      return {
        activePreset: prev.activePreset === oldName ? trimmed : prev.activePreset,
        presets: next,
      }
    })
  }, [])

  const deletePreset = useCallback((name) => {
    setState(prev => {
      if (!prev.presets[name]) return prev
      const next = { ...prev.presets }
      delete next[name]
      return {
        activePreset: prev.activePreset === name ? DEFAULT_PRESET : prev.activePreset,
        presets: next,
      }
    })
  }, [])

  const switchPreset = useCallback((name) => {
    setState(prev => {
      if (name !== DEFAULT_PRESET && !prev.presets[name]) return prev
      return { ...prev, activePreset: name }
    })
  }, [])

  const resetActive = useCallback(() => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev
      return {
        ...prev,
        presets: { ...prev.presets, [prev.activePreset]: { hidden: [] } },
      }
    })
  }, [])

  return {
    activePreset,
    hidden,
    presetNames,
    presets,
    isDefaultActive,
    toggleHidden,
    setHiddenSet,
    savePreset,
    renamePreset,
    deletePreset,
    switchPreset,
    resetActive,
  }
}
