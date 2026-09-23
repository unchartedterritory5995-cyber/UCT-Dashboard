import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import useSavedScreens from '../hooks/useSavedScreens'
import styles from './ScannerShell.module.css'

// One-click preset-scan chips from the firm's starters. Clicking a chip applies
// that preset's spec; `applySpec` preserves the chosen pool, so a preset runs
// WITHIN the selected Global / UCT / Watchlist / Combo. The active chip is the
// one whose conditions are on screen.
//
// ⭐ THE MEMBER PICKS WHICH SCANS SHOW. `screener_preset_chips` (a pref) holds the
// starter ids to display; the "Edit" popover adds/removes them. Never set → all
// show, so nobody has to opt in to see anything.
//
// ⛔ POOL-BLIND MATCH. A preset is pool-agnostic (RS/price/structure, never
// `universe`/`list`), and the current spec has the member's pool merged in, so
// the active test compares BOTH specs with the pool keys stripped.
const CHIPS_KEY = 'screener_preset_chips'
const POOL = new Set(['universe', 'list', 'scan'])
const keyOf = (spec) => JSON.stringify({
  f: [...(spec?.filters || [])]
    .filter((x) => x && !POOL.has(x.key))
    .map(({ key, op, value, values, min, max }) => ({ key, op, value, values, min, max }))
    .sort((a, b) => (a.key < b.key ? -1 : 1)),
  view: spec?.view ?? null,
  rank: spec?.rank ?? null,
})

export default function PresetChips({ currentSpec, onApply }) {
  const { starters } = useSavedScreens()
  const { prefs, setPrefMerged } = usePreferences()
  const [manageOpen, setManageOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!manageOpen) return undefined
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setManageOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [manageOpen])

  if (!starters?.length) return null

  const saved = parsePref(prefs[CHIPS_KEY], null)
  const selectedIds = Array.isArray(saved) ? new Set(saved.filter((x) => typeof x === 'string')) : null
  const shown = selectedIds ? starters.filter((s) => selectedIds.has(s.id)) : starters
  const isShown = (id) => (selectedIds ? selectedIds.has(id) : true)

  // The selection materialises from "all" on the first edit, so unchecking one
  // hides only that chip (not every chip that had never been explicitly chosen).
  const toggleChip = (id) => setPrefMerged(CHIPS_KEY, (cur) => {
    const base = Array.isArray(cur) ? cur.filter((x) => typeof x === 'string') : starters.map((s) => s.id)
    return base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
  })

  const cur = keyOf(currentSpec)
  return (
    <div className={styles.presetChips} role="group" aria-label="Preset scans" ref={wrapRef}>
      {shown.map((s) => {
        const active = keyOf(s.spec) === cur
        return (
          <button key={s.id} type="button"
            className={`${styles.presetChip} ${active ? styles.presetChipOn : ''}`}
            aria-pressed={active}
            onClick={() => onApply(s.spec)}>
            {s.name}
          </button>
        )
      })}
      <span className={styles.presetManageWrap}>
        <button type="button" className={styles.presetManageBtn} aria-label="Choose which preset scans show"
          aria-expanded={manageOpen} onClick={() => setManageOpen((o) => !o)}>
          <UIcon name="sliders" size={12} gold={false} /> Edit
        </button>
        {manageOpen && (
          <div className={styles.presetManageMenu} role="menu">
            <div className={styles.uMenuHd}>Show these preset scans</div>
            {starters.map((s) => (
              <label key={s.id} className={styles.presetManageItem}>
                <input type="checkbox" checked={isShown(s.id)} onChange={() => toggleChip(s.id)} />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        )}
      </span>
    </div>
  )
}
