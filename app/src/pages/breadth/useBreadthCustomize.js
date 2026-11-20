/**
 * Breadth Monitor columns — templates, localStorage-backed.
 *
 * Storage shape (key: `uct.breadth.customize.v1`, unchanged so members' saved state resolves):
 *   { activePreset: string,
 *     presets: { [name]: { hidden: string[], order?: string[] } },
 *     draft?: { hidden: string[], order: string[] | null } }
 *
 * ⭐ TEMPLATES (owner 2026-11-19, the "Columns" menu, design A simplified):
 *   - ONE built-in, "UCT Core". Its stored id stays `Default` (DEFAULT_PRESET) so every
 *     member's saved `activePreset: 'Default'` still resolves; only the label changed
 *     (`templateLabel`). It is computed from the caller's `defaults` and NEVER written.
 *   - Editing the built-in applies to the table at once and lives in `draft`: an unsaved
 *     working state ("UCT Core · edited"). `revertDraft` drops it; `savePreset` turns it
 *     into the member's own template. Switching to another template keeps the draft, so
 *     coming back shows it again (still marked edited) until it is reverted or saved.
 *   - The member's own templates autosave: every write goes straight to `presets`.
 *
 * `order` (2026-11-17, the column-header menu): the column order, as metric keys. Optional;
 * keys it does not name (new metrics) follow in code order. `hidden` (vs `visible`) means a
 * new metric appears in every saved template.
 *
 * Migration (load time, then written back): a stored `Default` entry is dropped (reserved id);
 * a member template that collides with a built-in label ("UCT Core") is renamed
 * "UCT Core (mine)" so nothing is lost; non-string keys are dropped; a malformed draft is
 * ignored.
 *
 * See docs/superpowers/specs/2026-04-24-breadth-customize-design.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const STORAGE_KEY = 'uct.breadth.customize.v1'
/** The built-in template's STORED id. Never shown: the member sees BUILTIN_LABEL. */
export const DEFAULT_PRESET = 'Default'
export const BUILTIN_LABEL = 'UCT Core'
export const NAME_MAX = 40

/** What the member sees for a template id. */
export const templateLabel = (id) => (id === DEFAULT_PRESET ? BUILTIN_LABEL : id)

const RESERVED = [DEFAULT_PRESET, BUILTIN_LABEL].map(s => s.toLowerCase())
const isReserved = (name) => RESERVED.includes(name.trim().toLowerCase())

const EMPTY_STATE = { activePreset: DEFAULT_PRESET, presets: {}, draft: null }

const strings = (arr) => [...new Set(arr.filter(k => typeof k === 'string'))]

function uniqueName(base, taken) {
  const has = (n) => taken.some(t => t.toLowerCase() === n.toLowerCase()) || isReserved(n)
  if (!has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`
    if (!has(n)) return n
  }
}

/** Old (or hand-edited) stored state → the current shape, losing no member template. */
export function migrateStored(parsed) {
  const presets = {}
  let active = typeof parsed?.activePreset === 'string' ? parsed.activePreset : DEFAULT_PRESET
  if (parsed && typeof parsed.presets === 'object' && parsed.presets) {
    for (const [rawName, val] of Object.entries(parsed.presets)) {
      if (rawName === DEFAULT_PRESET) continue
      if (!val || !Array.isArray(val.hidden)) continue
      let name = rawName
      if (isReserved(rawName) || !rawName.trim()) {
        name = uniqueName(`${rawName.trim() || 'Untitled'} (mine)`, Object.keys(presets))
        if (active === rawName) active = name
      }
      const hidden = strings(val.hidden)
      presets[name] = Array.isArray(val.order) ? { hidden, order: strings(val.order) } : { hidden }
    }
  }
  const d = parsed?.draft
  const draft = d && Array.isArray(d.hidden)
    ? { hidden: strings(d.hidden), order: Array.isArray(d.order) ? strings(d.order) : null }
    : null
  const validActive = active === DEFAULT_PRESET || presets[active] ? active : DEFAULT_PRESET
  return { activePreset: validActive, presets, draft }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_STATE
    return migrateStored(JSON.parse(raw))
  } catch {
    return EMPTY_STATE
  }
}

function writeToStorage(state) {
  try {
    const out = { activePreset: state.activePreset, presets: state.presets }
    if (state.draft) out.draft = state.draft
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
  } catch {
    // Quota / private mode — silent. Prefs are best-effort.
  }
}

export function validatePresetName(name, existingNames) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'Name cannot be empty.'
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`
  if (isReserved(trimmed)) return `"${trimmed}" is a built-in template.`
  if (existingNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) return 'A template with that name already exists.'
  return null
}

const sameSet = (a, b) => a.size === b.size && [...a].every(k => b.has(k))
/** The columns a member actually sees, in order (a hidden column's position is invisible). */
function visibleSeq(hidden, order) {
  return order ? order.filter(k => !hidden.has(k)) : null
}
function sameView(hiddenA, orderA, hiddenB, orderB) {
  if (!sameSet(hiddenA, hiddenB)) return false
  const a = visibleSeq(hiddenA, orderA), b = visibleSeq(hiddenB, orderB)
  if (a == null || b == null) return a == null && b == null
  return a.length === b.length && a.every((k, i) => k === b[i])
}

/**
 * Hook returns:
 *   activePreset           string — the active template's id ('Default' = UCT Core)
 *   activeLabel            string — what the member sees for it
 *   hidden                 Set<string> — keys hidden right now
 *   order                  string[] | null — the column order right now
 *   presetNames            string[] — ['Default', ...the member's templates, alphabetical]
 *   isDefaultActive        boolean — the built-in is active
 *   isEdited               boolean — the built-in has unsaved edits (draft)
 *   differsFromDefault     boolean — what shows is not UCT Core (Reset is meaningful)
 *   toggleHidden(key)      flip one column (built-in → draft; own template → autosave)
 *   setHiddenSet(keys)     replace the hidden set (same rule)
 *   setOrder(keys)         replace the order (same rule)
 *   revertDraft()          drop the built-in's unsaved edits
 *   savePreset(name, hidden?, order?)  new template (default: what shows now), made active
 *   renamePreset(old, new) rename one of the member's templates
 *   duplicatePreset(name)  copy a template ("<name> copy"), made active; returns the new name
 *   deletePreset(name)     delete one; if it was active, UCT Core becomes active
 *   switchPreset(name)     make a template active
 *   resetActive()          back to UCT Core (built-in: revert; own template: overwrite)
 */
const NO_DEFAULTS = Object.freeze({ hidden: Object.freeze([]), order: null })

export default function useBreadthCustomize({ defaults = NO_DEFAULTS } = {}) {
  const [state, setState] = useState(() => loadFromStorage())
  // Fixed for the life of the hook: the built-in is code, not member state.
  const [{ hidden: defaultHidden, order: defaultOrder }] = useState(() => ({
    hidden: defaults.hidden ?? [],
    order: defaults.order ?? null,
  }))
  const defaultHiddenSet = useMemo(() => new Set(defaultHidden), [defaultHidden])

  // Debounce writes so rapid checkbox toggles don't thrash storage.
  // stateRef lets the unmount flush always see the current value.
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

  const { activePreset, presets, draft } = state
  const isDefaultActive = activePreset === DEFAULT_PRESET

  const hidden = useMemo(() => {
    if (isDefaultActive) return new Set(draft ? draft.hidden : defaultHidden)
    return new Set(presets[activePreset]?.hidden ?? [])
  }, [isDefaultActive, draft, presets, activePreset, defaultHidden])

  const order = useMemo(() => {
    if (isDefaultActive) return draft ? draft.order : defaultOrder
    return presets[activePreset]?.order ?? null
  }, [isDefaultActive, draft, presets, activePreset, defaultOrder])

  const isEdited = isDefaultActive && draft != null
  const differsFromDefault = useMemo(
    () => !sameView(hidden, order, defaultHiddenSet, defaultOrder),
    [hidden, order, defaultHiddenSet, defaultOrder],
  )

  const presetNames = useMemo(() => {
    const customs = Object.keys(presets).sort((a, b) => a.localeCompare(b))
    return [DEFAULT_PRESET, ...customs]
  }, [presets])

  // ONE writer for "change what shows": the built-in's edits go to the draft (dropped again
  // when they come back to UCT Core exactly); the member's own template saves as it goes.
  const writeView = useCallback((fn) => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) {
        const base = prev.draft ?? { hidden: [...defaultHidden], order: defaultOrder ? [...defaultOrder] : null }
        const next = fn(base)
        const pristine = sameView(new Set(next.hidden), next.order, defaultHiddenSet, defaultOrder)
        return { ...prev, draft: pristine ? null : { hidden: next.hidden, order: next.order ?? null } }
      }
      const cur = prev.presets[prev.activePreset]
      if (!cur) return prev
      return { ...prev, presets: { ...prev.presets, [prev.activePreset]: { ...cur, ...fn(cur) } } }
    })
  }, [defaultHidden, defaultOrder, defaultHiddenSet])

  const setHiddenSet = useCallback((keys) => {
    const arr = strings([...keys])
    writeView(cur => ({ ...cur, hidden: arr }))
  }, [writeView])

  const setOrder = useCallback((keys) => {
    const arr = strings([...keys])
    writeView(cur => ({ ...cur, order: arr }))
  }, [writeView])

  const toggleHidden = useCallback((key) => {
    writeView(cur => {
      const s = new Set(cur.hidden)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return { ...cur, hidden: [...s] }
    })
  }, [writeView])

  const revertDraft = useCallback(() => {
    setState(prev => (prev.draft ? { ...prev, draft: null } : prev))
  }, [])

  const savePreset = useCallback((name, hiddenKeys, orderKeys) => {
    const trimmed = (name ?? '').trim()
    setState(prev => {
      if (validatePresetName(trimmed, Object.keys(prev.presets))) return prev  // caller validates first
      // Default: what shows now (the built-in's draft, or the active template).
      let curHidden, curOrder
      if (prev.activePreset === DEFAULT_PRESET) {
        curHidden = prev.draft ? prev.draft.hidden : defaultHidden
        curOrder = prev.draft ? prev.draft.order : defaultOrder
      } else {
        curHidden = prev.presets[prev.activePreset]?.hidden ?? []
        curOrder = prev.presets[prev.activePreset]?.order ?? null
      }
      const h = strings([...(hiddenKeys ?? curHidden)])
      const o = orderKeys === undefined ? curOrder : orderKeys
      const entry = Array.isArray(o) ? { hidden: h, order: strings(o) } : { hidden: h }
      return {
        activePreset: trimmed,
        presets: { ...prev.presets, [trimmed]: entry },
        // Saving from the built-in turns its edits into the new template.
        draft: prev.activePreset === DEFAULT_PRESET ? null : prev.draft,
      }
    })
  }, [defaultHidden, defaultOrder])

  const renamePreset = useCallback((oldName, newName) => {
    const trimmed = (newName ?? '').trim()
    setState(prev => {
      if (!prev.presets[oldName]) return prev
      const others = Object.keys(prev.presets).filter(n => n !== oldName)
      if (validatePresetName(trimmed, others)) return prev
      const next = {}
      for (const [n, v] of Object.entries(prev.presets)) next[n === oldName ? trimmed : n] = v
      return {
        ...prev,
        activePreset: prev.activePreset === oldName ? trimmed : prev.activePreset,
        presets: next,
      }
    })
  }, [])

  const duplicatePreset = useCallback((name) => {
    const src = stateRef.current.presets[name]
    if (!src) return null
    const copy = uniqueName(`${name} copy`.slice(0, NAME_MAX), Object.keys(stateRef.current.presets))
    setState(prev => {
      const from = prev.presets[name]
      if (!from || prev.presets[copy]) return prev
      return {
        ...prev,
        activePreset: copy,
        presets: { ...prev.presets, [copy]: { ...from, hidden: [...from.hidden], ...(from.order ? { order: [...from.order] } : {}) } },
      }
    })
    return copy
  }, [])

  const deletePreset = useCallback((name) => {
    setState(prev => {
      if (!prev.presets[name]) return prev
      const next = { ...prev.presets }
      delete next[name]
      return {
        ...prev,
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

  // "Reset to UCT Core": the built-in drops its edits; the member's own template is put back
  // to the core set and its order (it autosaves, so this is a write).
  const resetActive = useCallback(() => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev.draft ? { ...prev, draft: null } : prev
      const entry = defaultOrder
        ? { hidden: [...defaultHidden], order: [...defaultOrder] }
        : { hidden: [...defaultHidden] }
      return { ...prev, presets: { ...prev.presets, [prev.activePreset]: entry } }
    })
  }, [defaultHidden, defaultOrder])

  return {
    activePreset,
    activeLabel: templateLabel(activePreset),
    hidden,
    presetNames,
    presets,
    isDefaultActive,
    isEdited,
    differsFromDefault,
    toggleHidden,
    setHiddenSet,
    order,
    setOrder,
    revertDraft,
    savePreset,
    renamePreset,
    duplicatePreset,
    deletePreset,
    switchPreset,
    resetActive,
  }
}
