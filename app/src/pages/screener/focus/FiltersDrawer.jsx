import { useEffect, useRef, useState } from 'react'
import FilterRail from '../shell/FilterRail'
import CriteriaBox from '../shell/CriteriaBox'
import Menu, { MenuItem } from './Menu'
import { focusChipLabel } from './plainWords'
import { compactDigits } from './whyItsHere'
import useDescribe from './useDescribe'
import Input from '../../../components/ui/Input'
import FilterControl from '../shell/FilterControl'
import styles from './FocusScreener.module.css'
import own from './FiltersDrawer.module.css'
import { COMMON_FILTERS, choicesOf, isLongEnum } from './drawerFilters'

// The app's select (FilterControl's `select` presentation, i.e. components/ui/Select) with
// a components/ui/Input that narrows its choices. The chosen value is always kept in the
// list, so narrowing can never make the select show a different answer than the one on.
// A choice is "on" when the spec names its value: {op:'eq', value} or an `in` over a list
// (`value: [...]` or the typeset form `values: [...]`).
const isChosen = (p, spec) => {
  if (!spec) return false
  const vals = Array.isArray(spec.values) ? spec.values : Array.isArray(spec.value) ? spec.value : [spec.value]
  return vals.includes(p.value)
}
function LongEnumControl({ filter, value, onChange }) {
  const [q, setQ] = useState('')
  const all = choicesOf(filter)
  const needle = q.trim().toLowerCase()
  const narrowed = needle ? all.filter(p => p.label.toLowerCase().includes(needle) || isChosen(p, value)) : all
  const anyPreset = (filter.presets || []).find(p => p.label === 'Any') || { label: 'Any' }
  return (
    <div className={own.enumWrap}>
      <div className={own.enumSearchRow}>
        {/* FilterControl gives its select this id. */}
        <Input className={own.enumSearch} aria-label={`Narrow ${filter.label} choices`} value={q} aria-controls={`fc_${filter.key}`}
          placeholder={`Type to narrow ${all.length.toLocaleString('en-US')} choices`} onChange={e => setQ(e.target.value)} />
        <span className={own.enumHint} aria-live="polite">{needle ? `${narrowed.length} of ${all.length}` : ''}</span>
      </div>
      <FilterControl filter={{ ...filter, presets: [anyPreset, ...narrowed] }} value={value} onChange={onChange} presentation="select" />
    </div>
  )
}
const drawerControl = (f, value, onChange) => (isLongEnum(f) ? <LongEnumControl filter={f} value={value} onChange={onChange} /> : null)

// The ONE place the drawer words its match count. A count that is not known yet, or that
// failed (S4: `countError`; the count hook keeps its PREVIOUS number on a failure), never reads
// as a number, and a failure says so.
const known = (count, countLoading, countError) => !countLoading && !countError && Number.isFinite(count)
const showLabel = (count, countLoading, countError) => (known(count, countLoading, countError) ? `Show ${count.toLocaleString('en-US')} stocks` : 'Show stocks')
const settledCount = (count, countLoading, countError) => (countError && !countLoading ? 'Count unavailable'
  : known(count, countLoading, countError) ? `${count.toLocaleString('en-US')} matches` : '')

function universeLabel(filters) {
  if (filters?.list) return filters.list.label || 'Watchlist'
  if (filters?.universe?.value === 'uct') return 'UCT Universe'
  return 'All stocks'
}

// The compile route's explanation is an outline of {depth, text}; the drawer shows one line.
// Group headers stay ("Any of the following: A; B") so an OR or NOT never reads as an AND.
// Only the top-level "All of the following:" is dropped, since pills are an AND already.
const explainLine = ex => {
  if (!Array.isArray(ex)) return String(ex || '')
  let out = ''
  ex.forEach((x, i) => {
    const t = x?.text
    if (!t || (i === 0 && t === 'All of the following:')) return
    out += (out && !out.endsWith(': ') ? '; ' : out ? '' : '') + t + (t.endsWith(':') ? ' ' : '')
  })
  return out.trim()
}

// Left drawer holding every filter. A modal dialog: focus moves in on open,
// Escape (handled on the dialog, no document listener) closes it, and focus goes
// back to whatever opened it (or `returnFocusRef`, when the opener is remounted).
export default function FiltersDrawer({ open, onClose, meta, filters = {}, logic, onSetFilter, onClear, onSetLogic, count, countLoading, countError = null, lists = [], returnFocusRef }) {
  const panel = useRef(null)
  const describe = useDescribe(open)
  const [text, setText] = useState('')
  const [explain, setExplain] = useState('')
  // Latest filters, read after the compile await so a universe changed meanwhile is not overwritten.
  const filtersRef = useRef(filters)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read only in the submit handler
  filtersRef.current = filters
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
  // Clear all removes the pill row's own button: focus goes to the panel, never to <body>, so
  // Tab keeps cycling the drawer and Escape still closes it.
  const clearAll = () => { onClear(); panel.current?.focus() }
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
      const { universe, list } = filtersRef.current || {}
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
          <span className={styles.spacer} />
          <button type="button" className={styles.iconBtn} aria-label="Close filters" onClick={onClose}>×</button>
        </header>
        {describe.available && (
          <form className={styles.drawerSection} onSubmit={submitDescribe}>
            <label htmlFor="focus-describe" className={styles.describeLabel}>Describe a setup</label>
            <Input id="focus-describe" className={styles.describeInput} value={text} onChange={e => setText(e.target.value)}
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
              const text = compactDigits(focusChipLabel(defs[k] || { key: k, label: k, presets: [] }, v) || k)
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
            {(pills.length > 0 || logic) && <button type="button" className={styles.linkBtn} onClick={clearAll}>Clear all</button>}
          </div>
        </div>
        <div className={styles.drawerBody}>
          <FilterRail meta={meta} activeFilters={filters} onChange={onSetFilter} onClear={clearAll}
            variant="sheet" presentation="buttons" common={COMMON_FILTERS} startCollapsed
            openStorePrefix="uct.screener.drawer" showClear={false} controlFor={drawerControl} />
        </div>
        <footer className={styles.drawerFoot}>
          <details className={styles.codeBox}>
            <summary className={own.codeLink}>Edit as code</summary>
            <CriteriaBox logic={logic} onApply={onSetLogic} />
          </details>
          <span className={styles.spacer} />
          {countError && !countLoading && <span className={own.countNote} aria-hidden="true" data-testid="drawer-count-note">Count unavailable</span>}
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            {showLabel(count, countLoading, countError)}
          </button>
          {/* Screen readers hear the count once it settles, never the "Show stocks" in between. */}
          <span className="sr-only" role="status">{settledCount(count, countLoading, countError)}</span>
        </footer>
      </aside>
    </div>
  )
}
