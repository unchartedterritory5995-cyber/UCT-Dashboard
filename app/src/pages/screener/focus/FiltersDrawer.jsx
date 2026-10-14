import { useEffect, useRef } from 'react'
import FilterRail from '../shell/FilterRail'
import CriteriaBox from '../shell/CriteriaBox'
import Menu, { MenuItem } from './Menu'
import { chipLabel } from '../chipLabel'
import styles from './FocusScreener.module.css'

function universeLabel(filters) {
  if (filters?.list) return filters.list.label || 'Watchlist'
  if (filters?.universe?.value === 'uct') return 'UCT Universe'
  return 'All stocks'
}

// Left drawer holding every filter. A modal dialog: focus moves in on open,
// Escape (handled on the dialog, no document listener) closes it, and focus goes
// back to whatever opened it (or `returnFocusRef`, when the opener is remounted).
export default function FiltersDrawer({ open, onClose, meta, filters = {}, logic, onSetFilter, onClear, onSetLogic, count, countLoading, lists = [], returnFocusRef }) {
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    panel.current?.querySelector('input,button')?.focus()
    return () => { (returnFocusRef?.current || opener)?.focus?.() }
  }, [open, returnFocusRef])
  if (!open) return null
  const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
  const pills = Object.entries(filters).filter(([k, v]) => v && k !== 'universe' && k !== 'list')
  const setPool = choice => {
    if (choice === 'all') { onSetFilter('universe', null); onSetFilter('list', null) }
    else if (choice === 'uct') { onSetFilter('list', null); onSetFilter('universe', { op: 'eq', value: 'uct', label: 'UCT Universe' }) }
    else { onSetFilter('universe', null); onSetFilter('list', { op: 'in', value: choice.value, label: choice.label }) }
  }
  return (
    <div className={styles.drawerScrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="Filters" className={styles.drawer}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <header className={styles.drawerHead}>
          <h2 className={styles.drawerTitle}>Filters</h2>
          <span className={styles.drawerCount} aria-live="polite">{countLoading ? 'Counting…' : `${(count ?? 0).toLocaleString('en-US')} matches`}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.iconBtn} aria-label="Close filters" onClick={onClose}>×</button>
        </header>
        <div className={styles.drawerSection}>
          <div className={styles.pillRow}>
            <Menu label={`Universe: ${universeLabel(filters)}`} trigger={<><span className={styles.pillKey}>Universe</span> {universeLabel(filters)} ▾</>} triggerClassName={styles.pill} width={240}>
              <MenuItem onSelect={() => setPool('all')}>All stocks</MenuItem>
              <MenuItem onSelect={() => setPool('uct')}>UCT Universe</MenuItem>
              {lists.map(l => <MenuItem key={l.value} onSelect={() => setPool(l)}>{l.label}</MenuItem>)}
            </Menu>
            {pills.map(([k, v]) => {
              const text = chipLabel(defs[k] || { key: k, label: k, presets: [] }, v) || k
              return (
                <span key={k} className={styles.pill}>
                  {text}
                  <button type="button" className={styles.pillX} aria-label={`Remove ${text}`} onClick={() => onSetFilter(k, null)}>×</button>
                </span>
              )
            })}
            {logic && (
              <span className={styles.pill}>Custom criteria
                <button type="button" className={styles.pillX} aria-label="Remove Custom criteria" onClick={() => onSetLogic(null)}>×</button>
              </span>
            )}
            {(pills.length > 0 || logic) && <button type="button" className={styles.linkBtn} onClick={onClear}>Clear all</button>}
          </div>
        </div>
        <div className={styles.drawerBody}>
          <FilterRail meta={meta} activeFilters={filters} onChange={onSetFilter} onClear={onClear}
            variant="sheet" presentation="buttons" matchCount={count} matchCountLoading={countLoading} />
        </div>
        <footer className={styles.drawerFoot}>
          <details className={styles.codeBox}>
            <summary className={styles.linkBtn}>Edit as code</summary>
            <CriteriaBox logic={logic} onApply={onSetLogic} />
          </details>
          <span className={styles.spacer} />
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            {countLoading ? 'Show stocks' : `Show ${(count ?? 0).toLocaleString('en-US')} stocks`}
          </button>
        </footer>
      </aside>
    </div>
  )
}
