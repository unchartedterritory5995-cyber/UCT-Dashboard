// The TC2000-style tab strip at the top of a Chart widget. Each tab is an
// INDEPENDENT chart profile (own timeframe, indicators, settings, color-group
// link). Renders only when there is ≥1 extra tab, so a single-chart widget is
// visually unchanged. Pure presentational — all state transitions run through
// the chartTabs reducer in the parent (ChartWidget).

import { useEffect, useRef, useState } from 'react'
import styles from '../ChartsWorkspace.module.css'

const GROUP_DOT = { A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc' }

export default function ChartTabStrip({
  tabs,           // [{id, isMain, label, tf}] from chartTabList()
  activeIndex,    // 0 = main, 1..N = extra tabs
  tabColors,      // { [tabId]: 'A'|'B'|'C'|'D' } — color group per EXTRA tab (main omitted)
  onSelect,       // (index) => void
  onAdd,          // () => void
  onClose,        // (tabId) => void
  onRename,       // (tabId, name) => void
  onCycleColor,   // (tabId) => void — click an extra tab's dot to cycle its color group
}) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)  // close-x armed on this tab
  const inputRef = useRef(null)
  const confirmTimer = useRef(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  // Clear the pending timer on unmount.
  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  const cancelConfirm = () => { clearTimeout(confirmTimer.current); setConfirmingId(null) }

  // Two-stage close so a stray click never nukes a tab: first click arms (the ×
  // becomes a red "remove?" check), a second click within 3s actually closes.
  const handleCloseClick = (tabId) => {
    if (confirmingId === tabId) { cancelConfirm(); onClose(tabId); return }
    clearTimeout(confirmTimer.current)
    setConfirmingId(tabId)
    confirmTimer.current = setTimeout(() => setConfirmingId(null), 3000)
  }

  const startRename = (tab) => { cancelConfirm(); setEditingId(tab.id); setDraft(tab.label) }
  const commitRename = () => {
    if (editingId != null) onRename(editingId, draft)
    setEditingId(null)
    setDraft('')
  }

  return (
    <div className={styles.chartTabStrip} role="tablist" aria-label="Chart tabs">
      {tabs.map((tab, i) => {
        const active = i === activeIndex
        const editing = editingId === tab.id
        const dot = !tab.isMain ? GROUP_DOT[tabColors?.[tab.id]] : null
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`${styles.chartTab} ${active ? styles.chartTabActive : ''}`}
            onClick={() => { if (!editing) { cancelConfirm(); onSelect(i) } }}
            onDoubleClick={() => startRename(tab)}
            title={tab.isMain ? 'Main chart — double-click to rename' : 'Double-click to rename'}
          >
            {dot && (
              <span
                className={styles.chartTabDot}
                style={{ background: dot, cursor: 'pointer' }}
                role="button"
                aria-label="Change tab's linked color group"
                title="Click to change symbol-link color group"
                onClick={(e) => { e.stopPropagation(); onCycleColor?.(tab.id) }}
              />
            )}
            {editing ? (
              <input
                ref={inputRef}
                className={styles.chartTabRename}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                  else if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); setDraft('') }
                }}
                onBlur={commitRename}
                maxLength={24}
                placeholder="Name"
              />
            ) : (
              <span className={styles.chartTabLabel}>{tab.label}</span>
            )}
            {!tab.isMain && !editing && (
              <span
                className={`${styles.chartTabClose}${confirmingId === tab.id ? ' ' + styles.chartTabCloseConfirm : ''}`}
                role="button"
                aria-label={confirmingId === tab.id ? `Confirm close ${tab.label} tab` : `Close ${tab.label} tab`}
                title={confirmingId === tab.id ? 'Click again to close tab' : 'Close tab'}
                onClick={(e) => { e.stopPropagation(); handleCloseClick(tab.id) }}
              >{confirmingId === tab.id ? '✓' : '×'}</span>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className={styles.chartTabAdd}
        onClick={onAdd}
        title="New chart tab (loads as UCT Default)"
        aria-label="New chart tab"
      >+</button>
    </div>
  )
}
