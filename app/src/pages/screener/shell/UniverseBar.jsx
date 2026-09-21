import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './ScannerShell.module.css'

// ── What each pool actually IS ──────────────────────────────────────────────
// The rules here MIRROR the server. All Market = the screener's OWN universe
// (`screener_universe.py`): every US-listed common stock + ADR that trades, NO
// price/market-cap floor (ETFs, funds and buyout targets excluded). UCT Universe
// applies the two liquidity gates in `query.py::_universe_clauses` (UCT_MIN_PRICE
// $5, UCT_MIN_DOLLAR_VOL $20M). `short` rides inline beside the count; `body`
// fills the ⓘ popover. Kept beside the buttons so a member can see WHY UCT is a
// smaller number than All Market without leaving the row.
const UNIVERSE_INFO = {
  all: {
    name: 'All Market',
    short: 'US common + ADR · no price floor',
    body: 'Every US-listed common stock and ADR that trades — no price or market-cap floor. ETFs, funds, and buyout / acquisition targets are excluded.',
  },
  uct: {
    name: 'UCT Universe',
    short: 'price ≥ $5 · 30-day $-vol ≥ $20M',
    body: 'All Market, then narrowed to the liquid, tradeable subset: price ≥ $5 and 30-day average dollar-volume ≥ $20M.',
  },
}

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
export default function UniverseBar({ meta, activeList, activeUniverse, onSetFilter, total, isLoading, hasFilters }) {
  const listDef = (meta?.filters || []).find(f => f.key === 'list')
  // Drop the leading "Any" preset — that IS the full-market case, which the
  // All Market button owns.
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

  // Current selection → which segment reads as active + its label. Exactly one
  // base is active: a watchlist/combo (`list`), the curated UCT universe
  // (`universe: uct`), or All Market (neither). A list selection wins the label.
  const val = activeList?.value
  const isCombo = Array.isArray(val)
  const single = !isCombo && val != null ? options.find(o => o.value === val) : null
  const isUCT = !activeList && activeUniverse?.value === 'uct'
  const isAllMarket = !activeList && !isUCT
  // The firm pools carry a fixed rule to show inline; a member's own list does not.
  const activeCriteria = isAllMarket ? UNIVERSE_INFO.all.short : isUCT ? UNIVERSE_INFO.uct.short : null

  // Selecting any base clears the others so they stay mutually exclusive.
  const pickAllMarket = () => { onSetFilter('universe', null); onSetFilter('list', null); setOpen(null) }
  const pickUCT = () => {
    onSetFilter('universe', { op: 'eq', value: 'uct', label: 'UCT Universe' })
    onSetFilter('list', null); setOpen(null)
  }
  const pickList = o => {
    onSetFilter('universe', null)
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
    onSetFilter('universe', null)
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
      {/* ⓘ — the criteria for BOTH pools, spelled out, so 3,745 vs 2,097 is
          explained in place rather than guessed at. */}
      <div className={styles.uddWrap}>
        <button type="button" className={styles.uInfoBtn} aria-label="Universe criteria"
          aria-haspopup="true" aria-expanded={open === 'info'}
          onClick={() => setOpen(o => (o === 'info' ? null : 'info'))}>
          <UIcon name="info" size={12} />
        </button>
        {open === 'info' && (
          <div className={`${styles.uMenu} ${styles.uInfoMenu}`} role="menu">
            <div className={styles.uMenuHd}>What each pool means</div>
            {[UNIVERSE_INFO.all, UNIVERSE_INFO.uct].map(u => (
              <div key={u.name} className={styles.uInfoRow}>
                <div className={styles.uInfoName}>
                  {u.name}<span className={styles.uInfoRule}>{u.short}</span>
                </div>
                <div className={styles.uInfoBody}>{u.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.uSeg}>
        <button type="button" className={styles.uBtn} aria-pressed={isAllMarket} onClick={pickAllMarket}>
          All Market
        </button>
        <button type="button" className={styles.uBtn} aria-pressed={isUCT} onClick={pickUCT}
          title="Curated, tradeable subset — price ≥ $5 and 30-day $-volume ≥ $20M">
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

      {/* The active pool's rule, in place — so the criteria driving the count
          are visible without opening the ⓘ. Only the two firm pools have a fixed
          rule; a member's own list does not. */}
      {activeCriteria && <span className={styles.uCriteria}>{activeCriteria}</span>}

      {/* Reset the pool to All Market. Shown only when something narrows it —
          All Market IS the cleared state, so there is nothing to clear there. */}
      {!isAllMarket && (
        <button type="button" className={styles.uClear} onClick={pickAllMarket}
          title="Reset the pool to All Market">
          Clear
        </button>
      )}

      <span className={styles.uBase}>
        {isAllMarket ? 'All Market' : isUCT ? 'UCT Universe' : single ? labelName(single.label) : isCombo ? `${val.length} lists · any of` : ''}
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
