/**
 * ChartDetailDock — the Company Intelligence panel that docks onto the right of a
 * chart. One panel, one tab bar (Overview · Financials · Earnings · Ownership ·
 * News) plus an in-header Search. Visibility is owned by the toolbar toggle
 * (ChartPanelsButton, which replaces Share-to-Floor) — the panel has no close X.
 *
 * The chart (StockChart, autoSize) sits in .dockChartCol; opening the panel steals
 * width so the chart reflows automatically. State persists via opts.dock.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import DockProfile from './DockProfile'
import DockNews from './DockNews'
import DockFinancials from './DockFinancials'
import DockEarnings from './DockEarnings'
import DockOwnership from './DockOwnership'
import CompanySearch from './CompanySearch'
import { COMPANY_TABS, MIN_RIGHT_W, DEFAULT_RIGHT_W } from './chartDock'
import styles from './ChartDetailDock.module.css'

/* ── Toolbar toggle (replaces Share to Floor) ────────────────────────────────
   A single, direct action: open/close the Company Intelligence panel. No menu,
   no panel picker — the button IS the panel's on/off, with a clear active state. */
export function ChartPanelsButton({ dock, setDock, btnClassName }) {
  const open = !!dock.open
  // Opening always resets to the designed default width, so the panel looks
  // identical every time (the owner's "consistent default size" requirement);
  // in-session resizing still works, it just doesn't carry across a close/reopen.
  return (
    <button
      type="button"
      className={btnClassName}
      onClick={() => setDock(d => (d.open ? { ...d, open: false } : { ...d, open: true, rightW: DEFAULT_RIGHT_W }))}
      title={open ? 'Hide company info' : 'Company info'}
      aria-label="Company info panel"
      aria-pressed={open}
      style={open ? { color: 'var(--accent, #c9a84c)' } : undefined}
    >
      <UIcon name="columns" size={15} gold={open} />
    </button>
  )
}

// Drag the divider to resize the panel width. Kept in local state during the drag
// (smooth chart reflow), committed to opts on release.
function useDockResize(current, commit, rootRef, min) {
  const [live, setLive] = useState(null)
  const startRef = useRef(null)
  const onDown = useCallback((e) => {
    e.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect()
    startRef.current = { pos: e.clientX, size: current, max: rect ? rect.width * 0.62 : 9999 }
    setLive(current)
    const onMove = (ev) => {
      const s = startRef.current
      if (!s) return
      setLive(Math.max(min, Math.min(s.max, s.size + (s.pos - ev.clientX))))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      startRef.current = null
      setLive(v => { if (v != null) commit(v); return null })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [current, commit, rootRef, min])
  return { size: live == null ? current : live, onDown }
}

export default function ChartDetailDock({ sym, dock, setDock, onPickSymbol, children }) {
  const rootRef = useRef(null)
  const commitRightW = useCallback((w) => setDock(d => ({ ...d, rightW: Math.round(w) })), [setDock])
  const rightResize = useDockResize(dock.rightW, commitRightW, rootRef, MIN_RIGHT_W)
  const setTab = useCallback((key) => setDock(d => ({ ...d, tab: key })), [setDock])
  const setNewsFilter = useCallback((f) => setDock(d => ({ ...d, newsFilter: f })), [setDock])

  const rightOpen = !!dock.open
  const tab = dock.tab

  // ── Search (Ctrl/⌘+K) — an inline exploration mode, not navigation ──────────
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient search when the panel is closed
    if (!rightOpen) { setSearchOpen(false); return undefined }
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rightOpen])

  return (
    <div className={styles.dockRoot} ref={rootRef}>
      <div className={styles.dockUpper}>
        <div className={styles.dockChartCol}>{children}</div>

        {rightOpen && (
          <div className={styles.dockRight} style={{ width: rightResize.size }}>
            <div className={styles.resizerV} onPointerDown={rightResize.onDown} />
            <div className={styles.rdHeader}>
              <div className={styles.rdTabs}>
                {COMPANY_TABS.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    className={`${styles.rdTab}${tab === t.key ? ' ' + styles.rdTabOn : ''}`}
                    onClick={() => setTab(t.key)}
                  >{t.label}</button>
                ))}
              </div>
              <button
                type="button"
                className={`${styles.rdSearch}${searchOpen ? ' ' + styles.rdSearchOn : ''}`}
                onClick={() => setSearchOpen(true)}
                title="Search company information (Ctrl+K)"
                aria-label="Search company information"
              >
                <UIcon name="search" size={14} gold={false} />
              </button>
            </div>
            <div className={styles.dockBody}>
              {tab === 'overview' && <DockProfile sym={sym} onPickSymbol={onPickSymbol} />}
              {tab === 'financials' && <DockFinancials sym={sym} />}
              {tab === 'earnings' && <DockEarnings sym={sym} />}
              {tab === 'ownership' && <DockOwnership sym={sym} />}
              {tab === 'news' && <DockNews sym={sym} filter={dock.newsFilter} onFilter={setNewsFilter} />}
              {searchOpen && <CompanySearch sym={sym} onClose={() => setSearchOpen(false)} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
