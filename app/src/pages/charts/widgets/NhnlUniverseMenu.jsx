// The NH/NL scanner's universe picker — a grouped, searchable dropdown styled like
// the app's other menus. You pick what the leaderboard scans over:
//   • UCT Universe (the whole tradable US-stock universe)
//   • Group by Sector / Industry / Theme (a breadth overview that expands per group)
//   • an ETF (its holdings) — a curated set of index + sector SPDRs that actually hold
//     stocks (no GLD/TLT-style commodity/bond funds)
//   • one Industry directly (Banks - Regional, Biotechnology, …) → a flat leaderboard
//     of that industry's stocks
//   • one of your own Watchlists → a flat leaderboard of its symbols
// Selection is a small descriptor; the widget turns it into the right /api/nhnl/live query.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useSWR from 'swr'
import styles from './NhnlDropdown.module.css'

const fetcher = (u) => fetch(u, { credentials: 'include' }).then(r => (r.ok ? r.json() : null))

const GROUP_BY = [
  { key: 'sector', label: 'Sector' },
  { key: 'industry', label: 'Industry' },
  { key: 'theme', label: 'Theme' },
]
// Curated ETF universes — every one holds equities (so its NH/NL leaderboard is real).
// Index funds carry a friendly label; sector SPDRs go by ticker.
const INDEX_ETFS = [
  { etf: 'SPY', label: 'S&P 500' },
  { etf: 'QQQ', label: 'Nasdaq 100' },
  { etf: 'OEF', label: 'S&P 100' },
  { etf: 'IWM', label: 'Russell 2000' },
  { etf: 'DIA', label: 'Dow 30' },
]
const SECTOR_ETFS = ['XLV', 'XLE', 'XLF', 'XLK', 'XLI', 'XLU', 'XLB', 'XLY', 'XLP', 'XLC', 'XLRE']
  .map(t => ({ etf: t, label: t }))
const toItem = (e) => ({ key: `etf:${e.etf}`, label: e.label, etf: e.etf })
const INDEX_ITEMS = INDEX_ETFS.map(toItem)   // S&P 500 / Nasdaq 100 / S&P 100 / Russell 2000 / Dow 30
const ETF_ITEMS = SECTOR_ETFS.map(toItem)    // the 11 sector SPDRs

// The stable key for the currently-selected universe (matches the item keys below).
function selKey(sel) {
  if (sel?.etf) return `etf:${sel.etf}`
  if (sel?.watchlist) return `wl:${sel.watchlist}`
  if (sel?.value) return `cat:${sel.scope}:${sel.value}`
  const s = sel?.scope || 'all'
  return s === 'all' ? 'all' : s
}

export default function NhnlUniverseMenu({ selection, onPick }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const [q, setQ] = useState('')
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const searchRef = useRef(null)

  // Load the lists once the menu is opened.
  const { data: wlData } = useSWR(open ? '/api/watchlists' : null, fetcher, { revalidateOnFocus: false, dedupingInterval: 60000 })
  const { data: dimData } = useSWR(open ? '/api/nhnl/dims' : null, fetcher, { revalidateOnFocus: false, dedupingInterval: 600000 })
  const watchlists = useMemo(() => (Array.isArray(wlData) ? wlData : (wlData?.watchlists || [])), [wlData])
  const industries = useMemo(() => (Array.isArray(dimData?.industries) ? dimData.industries : []), [dimData])

  const key = selKey(selection)
  const triggerLabel = selection?.etf
    ? (selection.label || selection.etf)
    : selection?.watchlist
      ? (selection.label || 'Watchlist')
      : selection?.value
        ? (selection.label || selection.value)
        : (GROUP_BY.find(g => g.key === selection?.scope)?.label || 'UCT Universe')

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = (label) => !needle || label.toLowerCase().includes(needle)
    const out = []

    const universe = [{ key: 'all', label: 'UCT Universe' }].filter(i => match(i.label))
    if (universe.length) out.push({ label: 'Universe', items: universe })

    const groupBy = GROUP_BY.filter(i => match(i.label)).map(i => ({ key: i.key, label: i.label }))
    if (groupBy.length) out.push({ label: 'Group by', items: groupBy })

    const idx = INDEX_ITEMS.filter(i => match(i.label))
    if (idx.length) out.push({ label: 'Indices', items: idx })

    const etfs = ETF_ITEMS.filter(i => match(i.label))
    if (etfs.length) out.push({ label: 'ETFs', items: etfs })

    const inds = industries
      .filter(name => match(name))
      .slice(0, needle ? 60 : 200)
      .map(name => ({ key: `cat:industry:${name}`, label: name, scope: 'industry', value: name }))
    if (inds.length) out.push({ label: 'Industries', items: inds })

    const wls = watchlists
      .filter(w => match(w.name || ''))
      .map(w => ({ key: `wl:${w.id}`, label: w.name || 'Untitled', watchlist: String(w.id), pickLabel: w.name || 'Untitled' }))
    if (wls.length) out.push({ label: 'My Watchlists', items: wls })

    return out
  }, [q, watchlists, industries])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const place = () => {
      const r = btnRef.current.getBoundingClientRect()
      const w = Math.max(r.width, 200)
      let left = r.left
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w)
      const below = window.innerHeight - r.bottom
      const openUp = below < 260 && r.top > below
      setPos({
        left: Math.round(left),
        top: openUp ? undefined : Math.round(r.bottom + 4),
        bottom: openUp ? Math.round(window.innerHeight - r.top + 4) : undefined,
        width: Math.round(w),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => { if (open) requestAnimationFrame(() => searchRef.current?.focus()) }, [open])

  const choose = (item) => {
    if (item.etf) onPick({ etf: item.etf, label: item.label })
    else if (item.watchlist) onPick({ watchlist: item.watchlist, label: item.pickLabel })
    else if (item.value) onPick({ scope: item.scope, value: item.value, label: item.label })
    else onPick({ scope: item.key })
    setOpen(false)
    setQ('')
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        style={{ maxWidth: 200 }}
        title="Choose what the scanner scans"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          role="listbox"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, width: 230 }}
        >
          <div className={styles.searchWrap}>
            <input
              ref={searchRef}
              className={styles.searchInput}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search groups, ETFs, industries…"
            />
          </div>
          {groups.length === 0
            ? <div className={styles.menuEmpty}>No matches</div>
            : groups.map(g => (
              <div key={g.label} className={styles.group}>
                <div className={styles.groupLabel}>{g.label}</div>
                {g.items.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={item.key === key}
                    className={`${styles.item} ${item.key === key ? styles.itemOn : ''}`}
                    onClick={() => choose(item)}
                  >
                    <span className={styles.itemLabel}>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
        </div>,
        document.body,
      )}
    </>
  )
}
