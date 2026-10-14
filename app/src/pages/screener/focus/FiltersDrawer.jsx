import { useEffect, useRef, useState } from 'react'
import FilterRail from '../shell/FilterRail'
import CriteriaBox from '../shell/CriteriaBox'
import Menu, { MenuItem } from './Menu'
import { chipLabel } from '../chipLabel'
import { compact } from './whyItsHere'
import useDescribe from './useDescribe'

// Pill text from the shared chipLabel carries raw numbers; any run of 5+ digits reads compactly.
const compactDigits = s => String(s).replace(/\d{5,}(?:\.\d+)?/g, m => compact(Number(m)) ?? m)
import styles from './FocusScreener.module.css'

function universeLabel(filters) {
  if (filters?.list) return filters.list.label || 'Watchlist'
  if (filters?.universe?.value === 'uct') return 'UCT Universe'
  return 'All stocks'
}

// The compile route's explanation is an outline of {depth, text}; the drawer shows one line.
const explainLine = ex => (Array.isArray(ex) ? ex.map(x => x?.text).filter(t => t && !t.endsWith(':')).join('; ') : String(ex || ''))

// Left drawer holding every filter. A modal dialog: focus moves in on open,
// Escape (handled on the dialog, no document listener) closes it, and focus goes
// back to whatever opened it (or `returnFocusRef`, when the opener is remounted).
export default function FiltersDrawer({ open, onClose, meta, filters = {}, logic, onSetFilter, onClear, onSetLogic, count, countLoading, lists = [], returnFocusRef }) {
  const panel = useRef(null)
  const describe = useDescribe(open)
  const [text, setText] = useState('')
  const [explain, setExplain] = useState('')
  // Captured in a ref so a new ref identity while open cannot re-run the effect and steal focus.
  const returnRef = useRef(returnFocusRef)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read only inside the open/close effect
  returnRef.current = returnFocusRef
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    const first = panel.current?.querySelector('input,button')
    ;(first || panel.current)?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      ;(returnRef.current?.current || opener)?.focus?.()
    }
  }, [open])
  if (!open) return null
  const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
  const pills = Object.entries(filters).filter(([k, v]) => v && k !== 'universe' && k !== 'list')
  const setPool = choice => {
    if (choice === 'all') { onSetFilter('universe', null); onSetFilter('list', null) }
    else if (choice === 'uct') { onSetFilter('list', null); onSetFilter('universe', { op: 'eq', value: 'uct', label: 'UCT Universe' }) }
    else { onSetFilter('universe', null); onSetFilter('list', { op: 'in', value: choice.value, label: choice.label }) }
  }
  const submitDescribe = async e => {
    e.preventDefault()
    if (!text.trim() || describe.busy) return
    const out = await describe.run(text.trim())
    if (!out) { setExplain(''); return }
    if (Array.isArray(out.filters) && out.filters.length) {
      // The member's universe choice is not part of a described setup: keep it.
      const { universe, list } = filters
      onClear()
      onSetLogic(null)
      for (const { key, ...rest } of out.filters) onSetFilter(key, rest)
      if (universe) onSetFilter('universe', universe)
      if (list) onSetFilter('list', list)
    } else if (out.logic) {
      onSetLogic(out.logic)
    } else {
      setExplain("Couldn't turn that into filters. Try different words.")
      return
    }
    setExplain(explainLine(out.explanation))
  }
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    const list = [...panel.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter(el => el.tabIndex >= 0)
    if (!list.length) { e.preventDefault(); return }
    const firstEl = list[0], lastEl = list[list.length - 1]
    const at = document.activeElement
    if (e.shiftKey && (at === firstEl || at === panel.current)) { e.preventDefault(); lastEl.focus() }
    else if (!e.shiftKey && at === lastEl) { e.preventDefault(); firstEl.focus() }
  }
  return (
    <div className={styles.drawerScrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="Filters" className={styles.drawer}
        tabIndex={-1} onKeyDown={onKeyDown}>
        <header className={styles.drawerHead}>
          <h2 className={styles.drawerTitle}>Filters</h2>
          <span className={styles.drawerCount} aria-live="polite">{countLoading ? 'Counting…' : `${(count ?? 0).toLocaleString('en-US')} matches`}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.iconBtn} aria-label="Close filters" onClick={onClose}>×</button>
        </header>
        {describe.available && (
          <form className={styles.drawerSection} onSubmit={submitDescribe}>
            <label htmlFor="focus-describe" className={styles.describeLabel}>Describe a setup</label>
            <input id="focus-describe" className={styles.describeInput} value={text} onChange={e => setText(e.target.value)}
              placeholder="e.g. liquid tech leaders near highs" disabled={describe.busy} />
            {describe.error && <p className={styles.describeNote} role="alert">{describe.error}</p>}
            {!describe.error && explain && <p className={styles.describeNote} role="status">{explain}</p>}
          </form>
        )}
        <div className={styles.drawerSection}>
          <div className={styles.pillRow}>
            <Menu label={`Universe: ${universeLabel(filters)}`} trigger={<><span className={styles.pillKey}>Universe</span> {universeLabel(filters)} ▾</>} triggerClassName={styles.pill} width={240}>
              <MenuItem onSelect={() => setPool('all')}>All stocks</MenuItem>
              <MenuItem onSelect={() => setPool('uct')}>UCT Universe</MenuItem>
              {lists.map(l => <MenuItem key={l.value} onSelect={() => setPool(l)}>{l.label}</MenuItem>)}
            </Menu>
            {pills.map(([k, v]) => {
              const text = compactDigits(chipLabel(defs[k] || { key: k, label: k, presets: [] }, v) || k)
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
