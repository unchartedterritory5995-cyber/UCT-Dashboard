import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './ScannerShell.module.css'

// ── UniverseBar — the pool a scan runs against, chosen BEFORE filtering ──
//
// It does NOT add a new API surface. The screener already resolves a member's
// own lists as a universe through the reserved `list` filter: meta exposes them
// as the `list` filter's presets (`{op:'in', value:'wl:<id>'|'flagged'|
// 'tag:<colour>'}`), and `query.py::_list_clauses` resolves the selector
// server-side with the user_id taken from the SESSION, never the spec body. So
// picking a universe is just setting (or clearing) that one filter.
//
// ⛔ INTERSECTION ACROSS LISTS IS NOT EXPRESSIBLE HERE, BY DESIGN. The working
// spec keys filters by their key, so there is exactly ONE `list` slot. A single
// `list` filter with several selectors UNIONS them (server-side), which is what
// Combo does ("any of"). True intersection needs two `list` filters, which the
// single-slot model cannot hold — that stays a backend/model question and is
// deliberately not faked here. `list ∩ scan` (a saved scan) is a separate slot
// and remains available through the normal filter rail.
//
// A signed-out member, or one with no lists, has no `list` filter in meta at
// all (the absence contract in filters.py::_my_lists_entry) — then only the
// full UCT Universe shows, which is the honest state.
export default function UniverseBar({ meta, activeList, onSetFilter, total, isLoading, hasFilters }) {
  const listDef = (meta?.filters || []).find(f => f.key === 'list')
  // Drop the leading "Any" preset — that IS the full-universe case, which the
  // UCT Universe button owns.
  const options = (listDef?.presets || []).filter(p => p && p.value != null)

  const [open, setOpen] = useState(null) // null | 'wl' | 'combo'
  const [comboSel, setComboSel] = useState([])
  const rootRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(null) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Current selection → which segment reads as active + its label.
  const val = activeList?.value
  const isCombo = Array.isArray(val)
  const single = !isCombo && val != null ? options.find(o => o.value === val) : null
  const isUniverse = val == null

  const pickUniverse = () => { onSetFilter('list', null); setOpen(null) }
  const pickList = o => {
    onSetFilter('list', { op: 'in', value: o.value, label: labelName(o.label) })
    setOpen(null)
  }
  const openCombo = () => {
    setComboSel(isCombo ? val : single ? [val] : [])
    setOpen(o => (o === 'combo' ? null : 'combo'))
  }
  const toggleCombo = v =>
    setComboSel(sel => (sel.includes(v) ? sel.filter(x => x !== v) : [...sel, v]))
  const applyCombo = () => {
    if (!comboSel.length) { onSetFilter('list', null) }
    else if (comboSel.length === 1) {
      const o = options.find(x => x.value === comboSel[0])
      onSetFilter('list', { op: 'in', value: comboSel[0], label: labelName(o?.label) })
    } else {
      onSetFilter('list', { op: 'in', value: comboSel, label: `Combo · ${comboSel.length} lists` })
    }
    setOpen(null)
  }

  const hasLists = options.length > 0

  return (
    <div className={styles.universeBar} ref={rootRef}>
      <span className={styles.uEyebrow} title="The pool your filters run against. Pick before you filter.">Universe</span>
      <div className={styles.uSeg}>
        <button type="button" className={styles.uBtn} aria-pressed={isUniverse} onClick={pickUniverse}>
          UCT Universe
        </button>

        {hasLists && (
          <div className={styles.uddWrap}>
            <button type="button" className={styles.uBtn} aria-pressed={!!single}
              aria-haspopup="true" aria-expanded={open === 'wl'}
              onClick={() => setOpen(o => (o === 'wl' ? null : 'wl'))}>
              {single ? labelName(single.label) : 'Watchlist'} <UIcon name="chevronDown" size={11} />
            </button>
            {open === 'wl' && (
              <div className={styles.uMenu} role="menu">
                <div className={styles.uMenuHd}>My lists</div>
                {options.map(o => (
                  <button type="button" role="menuitem" key={o.value}
                    className={`${styles.uMenuItem} ${single?.value === o.value ? styles.uMenuItemOn : ''}`}
                    onClick={() => pickList(o)}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {hasLists && (
          <div className={styles.uddWrap}>
            <button type="button" className={styles.uBtn} aria-pressed={isCombo}
              aria-haspopup="true" aria-expanded={open === 'combo'} onClick={openCombo}>
              {isCombo ? `Combo · ${val.length}` : 'Combo'} <UIcon name="chevronDown" size={11} />
            </button>
            {open === 'combo' && (
              <div className={`${styles.uMenu} ${styles.uMenuCombo}`} role="menu">
                <div className={styles.uMenuHd}>Combine lists <span className={styles.uMenuSub}>any of</span></div>
                {options.map(o => (
                  <label key={o.value} className={styles.uMenuCheck}>
                    <input type="checkbox" checked={comboSel.includes(o.value)}
                      onChange={() => toggleCombo(o.value)} />
                    <span>{o.label}</span>
                  </label>
                ))}
                <div className={styles.uMenuFoot}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={applyCombo}>
                    Apply{comboSel.length ? ` (${comboSel.length})` : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <span className={styles.uBase}>
        {isUniverse ? 'Full market' : single ? labelName(single.label) : isCombo ? `${val.length} lists · any of` : ''}
        {/* Live count of the current selection: with no filters this is the
            pool's own size (names); once filters narrow it, it's the matches. */}
        {total != null && !isLoading && (
          <>{' · '}<b>{total.toLocaleString()}</b>{' '}{hasFilters ? 'matches' : (total === 1 ? 'name' : 'names')}</>
        )}
        {!hasFilters && <span className={styles.uBaseHint}> → add filters to build a scan</span>}
      </span>
    </div>
  )
}

// The list-universe labels arrive as "Momentum plays (42)"; keep the name for a
// chip but let the "(n)" ride along where there is room.
function labelName(label) {
  return typeof label === 'string' ? label.replace(/\s*\(\d[\d,]*\)\s*$/, '') : label
}
