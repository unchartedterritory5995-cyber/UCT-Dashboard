// app/src/pages/Watchlists.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useSWR from 'swr'
import UIcon from '../components/ui/UIcon'
import CompanyLogo from '../components/CompanyLogo'
import { useFlagged } from '../hooks/useFlagged'
import { useAuth } from '../context/AuthContext'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useWatchlistPerformance from '../hooks/useWatchlistPerformance'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import useTagColors from '../hooks/useTagColors'
import StockChart from '../components/StockChart'
import SymbolSearch from '../components/chart/SymbolSearch'
import { prefetchBars, prefetchBarsToIDB, prefetchAllTimeframes, prefetchBarOnIntent } from '../utils/prefetchBars'
import { useIsTouch } from '../hooks/useBreakpoint'
import Sheet from '../components/mobile/Sheet'
import styles from './Watchlists.module.css'
import { useChartsSym } from './charts/ChartsSymContext'

const fetcher = url => fetch(url).then(r => r.json())
const PERIODS = [['1', '1min'], ['5', '5min'], ['15', '15min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']]
const PERF_COLS = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD']]
// Configurable columns (right-click a header to hide/show, drag a gridline to resize).
// Flag + Sym are fixed (star + identity). Persisted per-user in localStorage.
const OPTIONAL_COLS = [  // hideable via right-click
  { key: 'price', label: 'Price', def: 62, min: 44 },
  { key: 'vol', label: 'Vol', def: 56, min: 40 },
  { key: 'chg', label: '% Chg', def: 68, min: 50 },
]
// Every real column is a FIXED px width (incl. Sym) so its gridlines sit at the same
// x in the header and every row (a flexible column would drift with scrollbar/subpixel
// rounding and misalign). A trailing minmax(0,1fr) filler absorbs any leftover width.
const COL_META = { flag: { def: 30, min: 16 }, sym: { def: 96, min: 56 }, price: { def: 62, min: 44 }, vol: { def: 56, min: 40 }, chg: { def: 68, min: 50 } }
const DEFAULT_COL_ORDER = ['flag', 'sym', 'price', 'vol', 'chg']   // reorderable by dragging a header
// [full label, abbreviation] + the min column width to still show the full word.
const COL_LABELS = { flag: ['', ''], sym: ['Symbol', 'Sym'], price: ['Price', 'Price'], vol: ['Volume', 'Vol'], chg: ['% Change', '% Chg'] }
const COL_FULL_MINW = { sym: 62, price: 46, vol: 60, chg: 80 }
const WL_COLS_LS = 'uct.watchlist.cols'
const COL_PRESETS = {
  'Price View': new Set(),
  'Performance': new Set(['1d', '1w', '1m', '3m', 'ytd']),
  'Short-Term': new Set(['1d', '1w', '1m']),
}

function changePctClass(val) {
  if (val == null) return ''
  if (val > 5) return styles.cellDeepGreen
  if (val > 0) return styles.cellGreen
  if (val < -5) return styles.cellDeepRed
  if (val < 0) return styles.cellRed
  return ''
}

function AddItemRow({ onAdd }) {
  const [sym, setSym] = useState('')
  return (
    <form
      className={styles.addItemRow}
      onSubmit={e => { e.preventDefault(); if (sym.trim()) { onAdd(sym.trim()); setSym('') } }}
    >
      <input
        className={styles.addItemInput}
        placeholder="+ Ticker"
        value={sym}
        onChange={e => setSym(e.target.value.toUpperCase())}
        maxLength={10}
      />
      <button type="submit" className={styles.addItemBtn}>Add</button>
    </form>
  )
}

export default function Watchlists({ embedded = false, pickList = null, pickName = null, onExitPick = null }) {
  const [activeTab, setActiveTab] = useState('mine')
  const [selectedSym, setSelectedSym] = useState(null)
  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  useEffect(() => {
    if (hubSym && hubSym !== selectedSym) setSelectedSym(hubSym)
  }, [hubSym]) // intentionally do NOT depend on selectedSym (avoid feedback loop)

  // Single-list "pick" mode (widget scoped to one chosen list): force the right
  // tab + force the picked group expanded so it opens straight to the tickers.
  useEffect(() => {
    if (!pickList) return
    setActiveTab(pickList.startsWith('community:') ? 'community' : 'mine')
    let key = null
    if (pickList === 'flagged') key = 'flagged'
    else if (pickList.startsWith('user:')) key = pickList.slice(5)
    else if (pickList.startsWith('community:')) key = pickList.slice(10)
    else if (pickList.startsWith('tag:')) key = pickList
    if (key != null) {
      setExpandedLists(prev => {
        const n = new Set(prev)
        n.add(key)
        const num = Number(key)
        if (!Number.isNaN(num)) n.add(num)   // list ids may be numeric
        return n
      })
    }
  }, [pickList])
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)
  const [expandedLists, setExpandedLists] = useState(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_public: false })
  const [saving, setSaving] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, id, isOwner, symbols, sym? }
  const [starred, setStarred] = useState(new Set()) // "listId:SYM" keys
  const [expandedNote, setExpandedNote] = useState(null) // item ID with note open
  const [noteText, setNoteText] = useState('')
  const [dragItemId, setDragItemId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [importListId, setImportListId] = useState(null)
  const [importText, setImportText] = useState('')
  const [showPerfCols, setShowPerfCols] = useState(false)
  const [visiblePerf, setVisiblePerf] = useState(new Set())
  const [sortBy, setSortBy] = useState(null) // null | 'sym' | 'price' | 'change' | '1d' | '1w' | '1m' | '3m' | 'ytd'
  const [sortDir, setSortDir] = useState('desc')
  const [filterText, setFilterText] = useState('')

  function toggleStar(listId, sym) {
    const key = `${listId}:${sym}`
    setStarred(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function getStarredSyms(listId) {
    const prefix = `${listId}:`
    return [...starred].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
  }

  async function handleRemoveStarred(listId) {
    const syms = getStarredSyms(listId)
    if (!syms.length) return
    if (listId === 'flagged') {
      syms.forEach(s => removeFlagged(s))
    } else {
      const wl = myLists?.find(w => w.id === listId)
      if (!wl) return
      for (const sym of syms) {
        const item = wl.items?.find(i => i.sym === sym)
        if (item) await fetch(`/api/watchlists/${listId}/items/${item.id}`, { method: 'DELETE' })
      }
      mutateMine()
    }
    // Clear stars for this list
    setStarred(prev => {
      const n = new Set(prev)
      for (const k of prev) { if (k.startsWith(`${listId}:`)) n.delete(k) }
      return n
    })
    setCtxMenu(null)
  }

  function handleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }
  function sortIndicator(col) { return sortBy !== col ? '' : sortDir === 'desc' ? ' ▾' : ' ▴' }

  // sortAndFilterItems is defined further down — after `prices` and `perfData`
  // are in scope. Defining it here would TDZ on those `const` deps.

  function exportCSV(wl) {
    const items = wl.items || []
    const rows = [['Symbol', 'Notes'], ...items.map(i => [i.sym, (i.notes || '').replace(/"/g, '""')])]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${wl.name.replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setCtxMenu(null)
  }

  function parseImportText(text) {
    return text.split(/[\n,]+/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{1,10}$/.test(s))
  }

  async function handleImport() {
    const syms = parseImportText(importText)
    if (!syms.length || !importListId) return
    await fetch(`/api/watchlists/${importListId}/items/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: syms }),
    })
    setImportListId(null)
    setImportText('')
    mutateMine()
  }

  function handleDrop(wlId, items) {
    if (!dragItemId || !dragOverId || dragItemId === dragOverId) { setDragItemId(null); setDragOverId(null); return }
    const ids = items.map(i => i.id)
    const fromIdx = ids.indexOf(dragItemId)
    const toIdx = ids.indexOf(dragOverId)
    if (fromIdx < 0 || toIdx < 0) { setDragItemId(null); setDragOverId(null); return }
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, dragItemId)
    setDragItemId(null)
    setDragOverId(null)
    fetch(`/api/watchlists/${wlId}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: ids }),
    }).then(() => mutateMine()).catch(() => {})
  }

  function saveNote(wlId, itemId, text) {
    fetch(`/api/watchlists/${wlId}/items/${itemId}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: text }),
    }).then(() => mutateMine()).catch(() => {})
  }

  function toggleNote(itemId, currentNotes) {
    if (expandedNote === itemId) { setExpandedNote(null); return }
    setExpandedNote(itemId)
    setNoteText(currentNotes || '')
  }

  function handleContextMenu(e, id, isOwner, symbols) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 220)
    const y = Math.min(e.clientY, window.innerHeight - 300)
    setCtxMenu({ x, y, id, isOwner, symbols })
  }

  // Touch long-press → open the same context menu (mouse uses native right-click).
  // Returns props to spread onto a trigger element. `build(e)` should return the
  // ctxMenu payload to set; reads clientX/clientY from the originating event.
  const lpTimer = useRef(null)
  const lpStart = useRef({ x: 0, y: 0 })
  const lpFiredAt = useRef(0)
  function longPressMenu(build) {
    const clear = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }
    return {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse') return
        lpStart.current = { x: e.clientX, y: e.clientY }
        clear()
        lpTimer.current = setTimeout(() => {
          try { navigator.vibrate?.(10) } catch { /* noop */ }
          lpFiredAt.current = e.timeStamp || performance.now()
          setCtxMenu(build({ clientX: e.clientX, clientY: e.clientY }))
        }, 450)
      },
      onPointerMove: (e) => {
        if (!lpTimer.current) return
        if (Math.abs(e.clientX - lpStart.current.x) > 10 || Math.abs(e.clientY - lpStart.current.y) > 10) clear()
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      // Swallow the click that follows a long-press so the row/name's own
      // onClick (toggle list / select sym) doesn't also fire.
      onClickCapture: (e) => {
        const now = e.timeStamp || performance.now()
        if (now - lpFiredAt.current < 600) { e.preventDefault(); e.stopPropagation() }
      },
    }
  }

  function handleCopyList(symbols) {
    navigator.clipboard.writeText(symbols.join(', '))
    setCtxMenu(null)
  }

  const { user } = useAuth()
  const isTouch = useIsTouch()
  const { flagged, toggle: toggleFlag, remove: removeFlagged, isFlagged, isShared, toggleShare, flaggedName, renameFlagged } = useFlagged()
  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher, { refreshInterval: 60000 })
  const { data: communityLists, mutate: mutateCommunity } = useSWR('/api/watchlists/public', fetcher, { refreshInterval: 60000 })
  const { tagColors: TAG_COLORS, tagByKey: TAG_BY_KEY } = useTagColors()
  const { tags, setTag, removeTag, getTag, isColorShared, toggleShareColor, communityTags } = useTickerTags()
  const { createAlert, deleteAlert, getAlertsForSym, hasAlert } = useWatchlistAlerts()
  const [alertPopover, setAlertPopover] = useState(null) // { sym, x, y }
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')

  // Collect all visible tickers for live prices
  const allTickers = useMemo(() => {
    const tickers = []
    if (activeTab === 'mine' && expandedLists.has('flagged')) {
      tickers.push(...flagged)
    }
    if (activeTab === 'mine') {
      TAG_COLORS.forEach(tc => {
        if (expandedLists.has(`tag:${tc.key}`)) {
          Object.entries(tags).filter(([, c]) => c === tc.key).forEach(([s]) => tickers.push(s))
        }
      })
    }
    const lists = activeTab === 'mine' ? myLists : communityLists
    if (lists) {
      lists
        .filter(wl => expandedLists.has(wl.id))
        .forEach(wl => (wl.items || []).forEach(i => { if (i.sym) tickers.push(i.sym) }))
    }
    return tickers
  }, [activeTab, flagged, tags, myLists, communityLists, expandedLists])

  const { prices } = useRealtimePrices(allTickers)
  const { perfData } = useWatchlistPerformance(visiblePerf.size > 0 ? allTickers : [])

  // Moved here from earlier in the file — depends on `prices` and `perfData`,
  // which are declared above. Putting it earlier hits a TDZ on those consts
  // when the deps array evaluates, crashing the page on mount.
  const sortAndFilterItems = useCallback((items) => {
    let filtered = items
    if (filterText) {
      const q = filterText.toUpperCase()
      filtered = filtered.filter(i => (i.sym || i).toString().toUpperCase().includes(q))
    }
    if (!sortBy) return filtered
    return [...filtered].sort((a, b) => {
      const symA = a.sym || a, symB = b.sym || b
      let va, vb
      if (sortBy === 'sym') { va = symA; vb = symB }
      else if (sortBy === 'price') { va = prices[symA]?.price; vb = prices[symB]?.price }
      else if (sortBy === 'change') { va = prices[symA]?.change_pct; vb = prices[symB]?.change_pct }
      else { va = perfData[symA]?.[sortBy]; vb = perfData[symB]?.[sortBy] }
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (sortBy === 'sym') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [sortBy, sortDir, filterText, prices, perfData])

  function togglePerfCol(key) {
    setVisiblePerf(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // Clear toast
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Build a flat, deduped, top-to-bottom list of every sym currently visible
  // across expanded watchlists / flagged / color-tag auto-lists. Arrow keys
  // navigate through this flat list so the user can move row-by-row no matter
  // which list contains the selected ticker.
  const visibleSymsFlat = useMemo(() => {
    const seen = new Set()
    const out = []
    const push = (s) => { if (s && !seen.has(s)) { seen.add(s); out.push(s) } }

    // Flagged group first (matches visual order on "mine" tab)
    if (activeTab === 'mine' && expandedLists.has('flagged')) {
      flagged.forEach(push)
    }
    // Color-tag auto-lists
    if (activeTab === 'mine') {
      TAG_COLORS.forEach(tc => {
        if (expandedLists.has(`tag:${tc.key}`)) {
          Object.entries(tags).filter(([, c]) => c === tc.key).forEach(([s]) => push(s))
        }
      })
    }
    // User / community watchlists (whichever tab is active)
    const lists = activeTab === 'mine' ? myLists : communityLists
    if (lists) {
      lists.filter(wl => expandedLists.has(wl.id)).forEach(wl => {
        (wl.items || []).forEach(i => push(i.sym))
      })
    }
    return out
  }, [activeTab, expandedLists, flagged, tags, TAG_COLORS, myLists, communityLists])

  // Keyboard nav: arrow up/down moves through every expanded list.
  const handleKeyDown = useCallback((e) => {
    // Don't hijack arrows while user is typing in an input/textarea/contenteditable
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Derive the order straight from the DOM (the actual on-screen order) so arrow
      // nav ALWAYS matches the displayed rows — including any active column sort.
      // Falls back to visibleSymsFlat if the DOM isn't reachable.
      let flat = []
      const root = pageRef.current
      if (root) {
        const seen = new Set()
        root.querySelectorAll('[data-watch-sym]').forEach(el => {
          const s = el.getAttribute('data-watch-sym')
          if (s && !seen.has(s)) { seen.add(s); flat.push(s) }
        })
      }
      if (!flat.length) flat = visibleSymsFlat
      if (!flat.length) return
      const idx = selectedSym ? flat.indexOf(selectedSym) : -1
      // If selection is set but not in THIS widget's list, don't navigate —
      // another widget (Themes, etc.) owns the selection and its own handler responds.
      if (idx < 0 && selectedSym) return
      e.preventDefault()
      // This widget owns the arrow now — stop other window keydown listeners
      // (e.g. the Theme Tracker, which shares the color group) from ALSO grabbing
      // the selection when we run off the end of the list.
      e.stopImmediatePropagation()
      const len = flat.length
      let next
      if (idx < 0) {
        next = e.key === 'ArrowDown' ? 0 : len - 1
      } else {
        // WRAP at the ends: off the bottom → top, off the top → bottom.
        next = e.key === 'ArrowDown' ? (idx + 1) % len : (idx - 1 + len) % len
      }
      const nextSym = flat[next]
      if (nextSym) {
        if (nextSym !== selectedSym) setSelectedSym(nextSym)
        setHubSym(nextSym)   // always re-assert so this widget wins the color group
      }
    }
    if (e.shiftKey && e.key === 'F' && selectedSym && flagged.includes(selectedSym)) {
      removeFlagged(selectedSym)
      setFlagToast('removed')
    }
  }, [visibleSymsFlat, selectedSym, flagged, removeFlagged, setHubSym])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Scroll the active row into view when selection changes via keyboard.
  const pageRef = useRef(null)
  useEffect(() => {
    if (!selectedSym || !pageRef.current) return
    const row = pageRef.current.querySelector(`[data-watch-sym="${CSS.escape(selectedSym)}"]`)
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [selectedSym])

  // Durable warm of the WHOLE visible list into IndexedDB, so arrowing through it
  // with the keyboard (faster than hover-prefetch can react) is instant — and stays
  // instant across page reloads. Bounded + idle-deferred inside prefetchBarsToIDB,
  // and it skips already-warm tickers, so a big list doesn't hammer the network.
  useEffect(() => {
    if (!visibleSymsFlat.length) return
    prefetchBarsToIDB(visibleSymsFlat, chartPeriod)
    if (chartPeriod !== 'D') prefetchBarsToIDB(visibleSymsFlat, 'D')
  }, [visibleSymsFlat, chartPeriod])

  // Prefetch all timeframes for current ticker + adjacent flagged tickers
  useEffect(() => {
    if (!selectedSym) return
    prefetchAllTimeframes(selectedSym)
    if (!flagged.length) return
    const idx = flagged.indexOf(selectedSym)
    if (idx < 0) return
    const upcoming = flagged.slice(idx + 1, idx + 6)
    prefetchBars(upcoming, chartPeriod)
  }, [selectedSym, flagged, chartPeriod])

  function toggleList(id) {
    setExpandedLists(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      if (res.ok) {
        setShowCreate(false)
        setCreateForm({ name: '', description: '', is_public: false })
        mutateMine()
        mutateCommunity()
      }
    } finally { setSaving(false) }
  }

  async function handleDeleteList(id) {
    if (!confirm('Delete this watchlist?')) return
    await fetch(`/api/watchlists/${id}`, { method: 'DELETE' })
    setExpandedLists(prev => { const n = new Set(prev); n.delete(id); return n })
    mutateMine()
    mutateCommunity()
  }

  async function handleRename(id, newName) {
    const trimmed = newName.trim()
    if (!trimmed) { setRenamingId(null); return }
    await fetch(`/api/watchlists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    setRenamingId(null)
    mutateMine()
    mutateCommunity()
  }

  async function handleTogglePublic(wl) {
    await fetch(`/api/watchlists/${wl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: !wl.is_public }),
    })
    mutateMine()
    mutateCommunity()
  }

  async function handleAddItem(listId, sym) {
    await fetch(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym, notes: '' }),
    })
    mutateMine()
  }

  async function handleRemoveItem(listId, itemId) {
    await fetch(`/api/watchlists/${listId}/items/${itemId}`, { method: 'DELETE' })
    mutateMine()
  }

  const currentLists = activeTab === 'mine' ? myLists : communityLists

  // ── Configurable + sortable columns (persisted per-user in localStorage) ──
  const [colCfg, setColCfg] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WL_COLS_LS)) || {} } catch { return {} }
  })
  const saveColCfg = useCallback((next) => {
    setColCfg(next)
    try { localStorage.setItem(WL_COLS_LS, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])
  const [liveResize, setLiveResize] = useState(null)   // {key,width} during a drag
  const [colMenu, setColMenu] = useState(null)         // {x,y} right-click menu
  const resizingRef = useRef(false)                    // suppress the header sort-click after a resize
  const dragColRef = useRef(null)                      // key of the header column being drag-reordered
  const colHidden = colCfg.hidden || {}
  const colSort = colCfg.sort || null                  // {key, dir} | null
  const colWidth = (k) => {
    if (liveResize?.key === k) return liveResize.width
    return colCfg.widths?.[k] ?? COL_META[k]?.def
  }
  // Columns in the user's chosen ORDER; flag + sym always shown, price/vol/chg unless hidden.
  const colOrder = (Array.isArray(colCfg.order) && colCfg.order.length ? colCfg.order : DEFAULT_COL_ORDER).filter(k => COL_META[k])
  const orderedKeys = (() => {
    const ks = colOrder.filter(k => (k === 'flag' || k === 'sym') || !colHidden[k])
    DEFAULT_COL_ORDER.forEach(k => { if ((k === 'flag' || k === 'sym') && !ks.includes(k)) ks.unshift(k) })  // never lose flag/sym
    return ks
  })()
  const visibleOptional = OPTIONAL_COLS.filter(c => !colHidden[c.key])
  const gridTemplate = [...orderedKeys.map(k => `${colWidth(k)}px`), 'minmax(0, 1fr)'].join(' ')

  // Drag a header column onto another to reorder the columns.
  const moveColumn = (fromKey, toKey) => {
    if (!fromKey || fromKey === toKey) return
    const order = [...colOrder]
    DEFAULT_COL_ORDER.forEach(k => { if (!order.includes(k)) order.push(k) })
    const from = order.indexOf(fromKey)
    const to = order.indexOf(toKey)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, fromKey)
    saveColCfg({ ...colCfg, order })
  }

  // Drag a gridline (an independent divider overlaid on the header, NOT tied to a
  // header cell — so dragging never sorts/selects the column) to resize the column to
  // its LEFT. Every column (Flag included) is resizable; the filler absorbs the change.
  const startColResize = (e, key) => {
    e.preventDefault(); e.stopPropagation()
    resizingRef.current = true
    const startX = e.clientX
    const startW = colWidth(key)
    const min = COL_META[key]?.min || 40
    const calc = (ev) => Math.max(min, Math.round(startW + (ev.clientX - startX)))
    const onMove = (ev) => setLiveResize({ key, width: calc(ev) })
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const w = calc(ev)
      setLiveResize(null)
      saveColCfg({ ...colCfg, widths: { ...(colCfg.widths || {}), [key]: w } })
      setTimeout(() => { resizingRef.current = false }, 0)   // let the trailing click be swallowed first
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const toggleColHidden = (key) => saveColCfg({ ...colCfg, hidden: { ...colHidden, [key]: !colHidden[key] } })
  const handleColSort = (key) => {
    if (resizingRef.current) return   // a drag just ended — don't treat the trailing click as a sort
    const next = (!colSort || colSort.key !== key)
      ? { key, dir: key === 'sym' ? 'asc' : 'desc' }   // first click: sym A→Z, numbers high→low
      : { key, dir: colSort.dir === 'asc' ? 'desc' : 'asc' }
    saveColCfg({ ...colCfg, sort: next })
  }
  // Sort an array of symbols by the active column (used by every list render + arrow nav).
  const applyColSort = useCallback((syms) => {
    if (!colSort) return syms
    const { key, dir } = colSort
    const mul = dir === 'asc' ? 1 : -1
    const num = (s) => {
      const q = prices[s]
      if (key === 'price') return q?.price ?? -Infinity
      if (key === 'vol') return q?.volume ?? -Infinity
      if (key === 'chg') return q?.change_pct ?? -Infinity
      return 0
    }
    return [...syms].sort((a, b) => key === 'sym'
      ? mul * String(a).localeCompare(String(b))
      : mul * (num(a) - num(b)))
  }, [colSort, prices])

  // Column header. Labels click to sort / right-click to hide-show. Gridlines are
  // SEPARATE draggable dividers overlaid on the header (positioned at each column
  // boundary), so dragging a gridline only resizes — never sorts/selects a column.
  const _gridDividers = (() => {
    let acc = 8  // header padding-left
    return orderedKeys.map(key => { acc += colWidth(key); return { key, x: acc } })
  })()
  const headerDragProps = (key) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; dragColRef.current = key },
    onDragOver: (e) => { e.preventDefault() },
    onDrop: (e) => { e.preventDefault(); moveColumn(dragColRef.current, key); dragColRef.current = null },
    onDragEnd: () => { dragColRef.current = null },
  })
  const labelFor = (key) => {
    const [full, abbr] = COL_LABELS[key] || [key, key]
    return colWidth(key) >= (COL_FULL_MINW[key] ?? 0) ? full : abbr
  }
  const renderHeaderCell = (key) => {
    if (key === 'flag') return <span key="flag" className={styles.hFlag} {...headerDragProps('flag')} />
    const active = colSort?.key === key
    const label = labelFor(key)
    return (
      <span
        key={key}
        className={`${key === 'sym' ? styles.hSym : styles.hCol}${active ? ' ' + styles.hSortActive : ''}`}
        onClick={() => handleColSort(key)}
        {...headerDragProps(key)}
      >{label}</span>
    )
  }
  const columnHeader = (
    <div className={styles.gridHead} onContextMenu={e => { e.preventDefault(); setColMenu({ x: e.clientX, y: e.clientY }) }}>
      {orderedKeys.map(renderHeaderCell)}
      {_gridDividers.map(d => (
        <i
          key={`div-${d.key}`}
          className={styles.gridDivider}
          style={{ left: `${d.x}px` }}
          onMouseDown={e => startColResize(e, d.key)}
          title="Drag to resize column"
        />
      ))}
    </div>
  )

  // Compact volume: 24.0M / 205K / 1.2B.
  const fmtVol = (v) => {
    if (v == null || !Number.isFinite(v)) return '—'
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K'
    return String(v)
  }

  // Shared columnar ticker row: Flag(star) | Symbol(logo) | Price | Volume | % Change.
  // The star reflects + toggles Flagged-list membership. Owner rows reveal notes +
  // alert icons on hover (overlaid at the right). name/isOwner/notes are optional.
  function renderTickerRow({ sym, name = null, isOwner = false, itemId = null, notes = null, onCtx = null, onRemove = null }) {
    const q = prices[sym]
    const price = q?.price ?? null
    const changePct = q?.change_pct ?? null
    const volume = q?.volume ?? null
    const flg = isFlagged(sym)
    const selected = selectedSym === sym
    // One cell per key, rendered in the user's column order.
    const cellFor = (key) => {
      if (key === 'flag') return (
        <button
          key="flag"
          className={`${styles.flagStar}${flg ? ' ' + styles.flagStarActive : ''}`}
          onClick={e => { e.stopPropagation(); toggleFlag(sym) }}
          title={flg ? 'Remove from Flagged' : 'Add to Flagged (Shift+F)'}
        >{flg ? <UIcon name="star-fill" size={13} /> : <UIcon name="star" size={13} />}</button>
      )
      if (key === 'sym') return (
        <span key="sym" className={styles.symCell} onContextMenu={onCtx || undefined}>
          <span className={styles.rowLogo}><CompanyLogo sym={sym} name={name} size={16} round /></span>
          <span className={styles.rowSym}>{sym}</span>
        </span>
      )
      if (key === 'price') return <span key="price" className={styles.priceCell}>{price != null ? price.toFixed(2) : '—'}</span>
      if (key === 'vol') return <span key="vol" className={styles.volCell}>{fmtVol(volume)}</span>
      if (key === 'chg') return (
        <span key="chg" className={`${styles.changeCell} ${changePct != null ? (changePct >= 0 ? styles.gain : styles.loss) : ''}`}>
          {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
        </span>
      )
      return null
    }
    return (
      <div
        key={sym}
        data-watch-sym={sym}
        className={`${styles.listRow} ${styles.wlRow}${selected ? ' ' + styles.listRowSelected : ''}`}
        onClick={() => { setSelectedSym(sym); setHubSym(sym) }}
        onPointerEnter={() => prefetchBarOnIntent(sym, 'D')}
        onFocus={() => prefetchBarOnIntent(sym, 'D')}
      >
        {orderedKeys.map(cellFor)}
        {isOwner && (
          <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
            <button
              className={`${styles.noteBtn}${expandedNote === itemId ? ' ' + styles.noteBtnActive : ''}`}
              onClick={() => toggleNote(itemId, notes)}
              title="Notes"
            ><UIcon name="edit" size={12} /></button>
            <button
              className={`${styles.alertBtn}${hasAlert(sym) ? ' ' + styles.alertBtnActive : ''}`}
              onClick={e => { setAlertPopover({ sym, x: e.clientX, y: e.clientY }); setAlertPrice(''); setAlertDir('above') }}
              title="Set price alert"
            ><UIcon name="bell" size={12} /></button>
            {onRemove && (
              <button className={styles.removeBtn} onClick={onRemove} title="Remove from this list">×</button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render a watchlist accordion group ──
  function renderWatchlistGroup(wl, isOwner) {
    const open = expandedLists.has(wl.id)
    const items = wl.items || []
    return (
      <div key={wl.id} className={styles.wlGroup}>
        <div className={styles.wlHeader} onClick={() => toggleList(wl.id)}>
          <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
          {renamingId === wl.id ? (
            <input
              className={styles.renameInput}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename(wl.id, renameValue)
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => handleRename(wl.id, renameValue)}
              onClick={e => e.stopPropagation()}
              autoFocus
              maxLength={60}
            />
          ) : (
            <span
              className={styles.wlName}
              onContextMenu={e => handleContextMenu(e, wl.id, isOwner, items.map(i => i.sym))}
              {...longPressMenu(e => ({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), id: wl.id, isOwner, symbols: items.map(i => i.sym) }))}
            >{wl.name}</span>
          )}
          <span className={styles.wlCount}>{items.length}</span>
          {wl.is_public && <span className={styles.pubBadge}>PUB</span>}
          {!isOwner && wl.owner_name && (
            <span className={styles.ownerTag}>{wl.owner_name}</span>
          )}
          {isOwner && (
            <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
              <button
                className={`${styles.wlActionBtn}${wl.is_public ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={() => handleTogglePublic(wl)}
                title={wl.is_public ? 'Make Private' : 'Share with community'}
              >{wl.is_public ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
              <button
                className={`${styles.wlActionBtn} ${styles.wlDeleteBtn}`}
                onClick={() => handleDeleteList(wl.id)}
                title="Delete watchlist"
              >×</button>
            </div>
          )}
        </div>

        {open && (() => {
          let sortedItems = sortAndFilterItems(items)
          if (colSort) {
            const order = applyColSort(sortedItems.map(i => i.sym))
            sortedItems = order.map(s => sortedItems.find(i => i.sym === s)).filter(Boolean)
          }
          const dragOk = isOwner && !sortBy
          return (
          <div className={styles.wlItems}>
            {wl.description && <div className={styles.wlDesc}>{wl.description}</div>}
            {items.length > 0 && (
              <div className={styles.colHeaderRow}>
                <input className={styles.filterInput} placeholder="Filter..." value={filterText} onChange={e => setFilterText(e.target.value)} onClick={e => e.stopPropagation()} />
                <span className={styles.colH} onClick={() => handleSort('sym')}>Sym{sortIndicator('sym')}</span>
                <span className={styles.colH} onClick={() => handleSort('price')}>Price{sortIndicator('price')}</span>
                <span className={styles.colH} onClick={() => handleSort('change')}>Chg%{sortIndicator('change')}</span>
                {PERF_COLS.filter(([k]) => visiblePerf.has(k)).map(([k, label]) => (
                  <span key={k} className={styles.colH} onClick={() => handleSort(k)}>{label}{sortIndicator(k)}</span>
                ))}
                {sortBy && <button className={styles.resetSortBtn} onClick={() => setSortBy(null)}>Reset</button>}
              </div>
            )}
            {sortedItems.length === 0 && <div className={styles.wlEmpty}>{items.length === 0 ? 'No symbols yet.' : 'No matches.'}</div>}
            {sortedItems.map(item => {
              const q = prices[item.sym]
              const price = q?.price ?? null
              const changePct = q?.change_pct ?? null
              const isStarred = starred.has(`${wl.id}:${item.sym}`)
              return (
                <React.Fragment key={item.id}>
                  {renderTickerRow({
                    sym: item.sym,
                    name: item.name,
                    isOwner,
                    itemId: item.id,
                    notes: item.notes,
                    onCtx: e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, id: wl.id, isOwner, symbols: items.map(i => i.sym), sym: item.sym }) },
                    onRemove: isOwner ? (e => { e.stopPropagation(); handleRemoveItem(wl.id, item.id) }) : null,
                  })}
                  {expandedNote === item.id && (
                    <div className={styles.noteRow}>
                      {isOwner ? (
                        <textarea
                          className={styles.noteTextarea}
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          onBlur={() => saveNote(wl.id, item.id, noteText)}
                          placeholder="Add a note..."
                          rows={2}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <div className={styles.noteReadonly}>{item.notes || 'No notes'}</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
            )
            })}
            {isOwner && <AddItemRow onAdd={sym => handleAddItem(wl.id, sym)} />}
          </div>
          )})()}
      </div>
    )
  }

  // ── Flagged as a pseudo-watchlist group ──
  function renderFlaggedGroup() {
    const open = expandedLists.has('flagged')
    return (
      <div className={styles.wlGroup}>
        <div className={styles.wlHeader} onClick={() => toggleList('flagged')}>
          <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
          {renamingId === 'flagged' ? (
            <input
              className={styles.renameInput}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { renameFlagged(renameValue); setRenamingId(null) }
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => { renameFlagged(renameValue); setRenamingId(null) }}
              onClick={e => e.stopPropagation()}
              autoFocus
              maxLength={60}
            />
          ) : (
            <span
              className={styles.wlName}
              onContextMenu={e => handleContextMenu(e, 'flagged', true, [...flagged])}
              {...longPressMenu(e => ({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), id: 'flagged', isOwner: true, symbols: [...flagged] }))}
            >{flaggedName || `Flagged (${user?.display_name || 'You'})`}</span>
          )}
          <span className={styles.wlCount}>{flagged.length}</span>
          {isShared && <span className={styles.pubBadge}>PUB</span>}
          <span className={styles.flaggedHint}>Shift+F</span>
          {user && (
            <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
              <button
                className={`${styles.wlActionBtn}${isShared ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={toggleShare}
                title={isShared ? 'Make Private' : 'Share with community'}
              >{isShared ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
            </div>
          )}
        </div>

        {open && (
          <div className={styles.wlItems}>
            {flagged.length === 0 ? (
              <div className={styles.wlEmpty}>No flagged tickers. Press <strong>Shift+F</strong> on any chart.</div>
            ) : applyColSort(flagged).map(sym => renderTickerRow({ sym }))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={pageRef} className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`}>

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Pick mode (widget scoped to one list) shows a back header instead of the
            My Lists / Community tabs. */}
        {pickList ? (
          <div className={styles.pickHeader}>
            <button className={styles.pickBackBtn} onClick={() => onExitPick?.()} title="Choose a different list">‹ Lists</button>
            <span className={styles.pickTitle}>{pickName || 'Watchlist'}</span>
            {/* Share/lock toggle moved up from the (now hidden) group header, right-aligned. */}
            {pickList === 'flagged' && user && (
              <button
                className={`${styles.wlActionBtn}${isShared ? ' ' + styles.wlActionBtnActive : ''}`}
                style={{ marginLeft: 'auto' }}
                onClick={toggleShare}
                title={isShared ? 'Make Private' : 'Share with community'}
              >{isShared ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
            )}
            {pickList.startsWith('user:') && (() => {
              const pwl = (myLists || []).find(w => `user:${w.id}` === pickList)
              if (!pwl) return null
              return (
                <button
                  className={`${styles.wlActionBtn}${pwl.is_public ? ' ' + styles.wlActionBtnActive : ''}`}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => handleTogglePublic(pwl)}
                  title={pwl.is_public ? 'Make Private' : 'Share with community'}
                >{pwl.is_public ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
              )
            })()}
          </div>
        ) : (
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBtn}${activeTab === 'mine' ? ' ' + styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('mine')}
            >My Lists</button>
            <button
              className={`${styles.tabBtn}${activeTab === 'community' ? ' ' + styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('community')}
            >Community</button>
          </div>
        )}

        {/* Sub-header (hidden in single-list pick mode) */}
        {!pickList && (
        <div className={styles.listHeader}>
          {activeTab === 'mine' && (
            <>
              <span className={styles.listMeta}>{(myLists?.length ?? 0) + 1} lists</span>
              <div className={styles.headerActions}>
                <div className={styles.colToggleWrap}>
                  <button className={styles.colToggleBtn} onClick={() => setShowPerfCols(!showPerfCols)} title="Toggle columns"><UIcon name="gear" size={14} /></button>
                  {showPerfCols && (
                    <div className={styles.colPopover}>
                      <div className={styles.presetRow}>
                        {Object.entries(COL_PRESETS).map(([name, cols]) => (
                          <button key={name} className={styles.presetBtn} onClick={() => setVisiblePerf(new Set(cols))}>{name}</button>
                        ))}
                      </div>
                      {PERF_COLS.map(([key, label]) => (
                        <label key={key} className={styles.colCheckRow}>
                          <input type="checkbox" checked={visiblePerf.has(key)} onChange={() => togglePerfCol(key)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <button className={styles.newListBtn} onClick={() => setShowCreate(true)}>+ New List</button>
              </div>
            </>
          )}
          {activeTab === 'community' && (
            <span className={styles.listMeta}>{communityLists?.length ?? 0} shared lists</span>
          )}
        </div>
        )}

        {/* Body */}
        <div className={`${styles.listBody}${pickList ? ' ' + styles.pickMode : ''}`} style={{ '--wl-grid': gridTemplate }}>

          {columnHeader}

          {/* ── My Lists tab — Flagged pinned at top + tag groups + user lists ── */}
          {activeTab === 'mine' && (
            <>
              {(!pickList || pickList === 'flagged') && renderFlaggedGroup()}
              {!pickList && TAG_COLORS.map(tc => {
                const syms = Object.entries(tags).filter(([, c]) => c === tc.key).map(([s]) => s)
                if (!syms.length) return null
                const open = expandedLists.has(`tag:${tc.key}`)
                return (
                  <div key={tc.key} className={styles.wlGroup}>
                    <div className={styles.wlHeader} onClick={() => toggleList(`tag:${tc.key}`)}>
                      <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
                      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: tc.hex, marginRight: 6 }} />
                      <span className={styles.wlName}>{tc.label}</span>
                      <span className={styles.wlCount}>{syms.length}</span>
                      {isColorShared(tc.key) && <span className={styles.pubBadge}>PUB</span>}
                      <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
                        <button
                          className={`${styles.wlActionBtn}${isColorShared(tc.key) ? ' ' + styles.wlActionBtnActive : ''}`}
                          onClick={() => toggleShareColor(tc.key)}
                          title={isColorShared(tc.key) ? 'Make Private' : 'Share with community'}
                        >{isColorShared(tc.key) ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
                      </div>
                    </div>
                    {open && (
                      <div className={styles.wlItems}>
                        {applyColSort(syms).map(sym => renderTickerRow({ sym }))}
                      </div>
                    )}
                  </div>
                )
              })}
              {!myLists ? (
                (!pickList || pickList.startsWith('user:')) && <div className={styles.loading}>Loading…</div>
              ) : (() => {
                const shown = pickList
                  ? myLists.filter(wl => pickList === `user:${wl.id}`)
                  : myLists
                if (!pickList && myLists.length === 0) {
                  return (
                    <div className={styles.wlEmpty} style={{ padding: '12px 8px', opacity: 0.5 }}>
                      No custom lists yet. Create one above.
                    </div>
                  )
                }
                return shown.map(wl => renderWatchlistGroup(wl, true))
              })()}
            </>
          )}

          {/* ── Community tab ── */}
          {activeTab === 'community' && (
            <>
              {/* Community tag lists */}
              {!pickList && communityTags.map((ct, i) => {
                const tagKey = `pub:${ct.user_id}:${ct.color}`
                const open = expandedLists.has(tagKey)
                const tc = TAG_BY_KEY[ct.color]
                if (!tc) return null
                return (
                  <div key={tagKey} className={styles.wlGroup}>
                    <div className={styles.wlHeader} onClick={() => toggleList(tagKey)}>
                      <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
                      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: tc.hex, marginRight: 6 }} />
                      <span className={styles.wlName}>{tc.label}</span>
                      <span className={styles.wlCount}>{ct.symbols.length}</span>
                      <span className={styles.ownerTag}>{ct.owner_name}</span>
                    </div>
                    {open && (
                      <div className={styles.wlItems}>
                        {applyColSort(ct.symbols).map(sym => renderTickerRow({ sym }))}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Community watchlists */}
              {!communityLists ? (
                <div className={styles.loading}>Loading…</div>
              ) : communityLists.length === 0 && communityTags.length === 0 ? (
                <div className={styles.emptyList}>
                  <div className={styles.emptyText}>No community lists shared yet.</div>
                </div>
              ) : (pickList
                  ? communityLists.filter(wl => pickList === `community:${wl.id}`)
                  : communityLists
                ).map(wl => renderWatchlistGroup(wl, false))}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: chart ── */}
      {!embedded && (
        <div className={styles.rightPanel}>
          {selectedSym ? (
            <>
              <div className={styles.chartHeader}>
                <SymbolSearch sym={selectedSym} onSymbolChange={setSelectedSym} />
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    <UIcon name="flag" size={12} style={{verticalAlign:'-1px',marginRight:3}} />{flagToast === 'added' ? 'Flagged' : 'Removed'}
                  </span>
                )}
                <button
                  className={`${styles.flagBtn}${isFlagged(selectedSym) ? ' ' + styles.flagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(selectedSym); toggleFlag(selectedSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(selectedSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                ><UIcon name="flag" size={13} style={{verticalAlign:'-2px',marginRight:4}} />{isFlagged(selectedSym) ? 'Flagged' : 'Flag'}</button>
                <div className={styles.chartPeriodTabs}>
                  {PERIODS.map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn}${chartPeriod === p ? ' ' + styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <StockChart sym={selectedSym} tf={chartPeriod} onSymbolChange={setSelectedSym} />
            </>
          ) : (
            <div className={styles.chartEmpty}>
              <div className={styles.chartEmptyIcon}>◳</div>
              <div className={styles.chartEmptyText}>Select a ticker to view chart</div>
            </div>
          )}
        </div>
      )}

      {/* ── Create watchlist modal ── */}
      {showCreate && (
        <div className={styles.modalBackdrop} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Watchlist</div>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Name</span>
                <input
                  className={styles.input}
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                  placeholder="e.g. Momentum Plays"
                />
              </div>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Description</span>
                <input
                  className={styles.input}
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className={styles.checkRow}>
                <input
                  type="checkbox"
                  id="wl-public"
                  checked={createForm.is_public}
                  onChange={e => setCreateForm(f => ({ ...f, is_public: e.target.checked }))}
                />
                <label htmlFor="wl-public" className={styles.checkLabel}>Share with community</label>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={saving}>
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import modal ── */}
      {importListId && (
        <div className={styles.modalBackdrop} onClick={() => setImportListId(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Import Tickers</div>
            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Paste tickers (comma or newline separated)</span>
              <textarea
                className={`${styles.input} ${styles.importTextarea}`}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={"AAPL, MSFT, NVDA\nor one per line"}
                rows={5}
                autoFocus
              />
            </div>
            {importText && (
              <div className={styles.importPreview}>
                {parseImportText(importText).length} tickers found
              </div>
            )}
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setImportListId(null)}>Cancel</button>
              <button
                className={styles.submitBtn}
                disabled={!parseImportText(importText).length}
                onClick={handleImport}
              >Import</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column right-click menu (hide/show columns) ── */}
      {colMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 2999 }} onClick={() => setColMenu(null)} onContextMenu={e => { e.preventDefault(); setColMenu(null) }} />
          <div className={styles.colMenu} style={{ left: Math.min(colMenu.x, window.innerWidth - 170), top: Math.min(colMenu.y, window.innerHeight - 180) }}>
            <div style={{ padding: '4px 10px 6px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)' }}>Columns</div>
            {OPTIONAL_COLS.map(c => (
              <button key={c.key} type="button" className={styles.colMenuItem} onClick={() => toggleColHidden(c.key)}>
                <span className={styles.colMenuCheck}>{!colHidden[c.key] ? <UIcon name="check" size={11} /> : null}</span>
                {c.label}
              </button>
            ))}
            <div className={styles.colMenuDivider} />
            <button type="button" className={styles.colMenuItem} onClick={() => { saveColCfg({}); setColMenu(null) }}>Reset columns</button>
          </div>
        </>
      )}

      {/* ── Alert popover ── */}
      {alertPopover && (
        <div className={styles.ctxBackdrop} onClick={() => setAlertPopover(null)}>
          <div className={styles.alertPopover} style={{ top: alertPopover.y, left: alertPopover.x }} onClick={e => e.stopPropagation()}>
            <div className={styles.alertPopTitle}>Alert for {alertPopover.sym}</div>
            <div className={styles.alertForm}>
              <select className={styles.alertSelect} value={alertDir} onChange={e => setAlertDir(e.target.value)}>
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input
                className={styles.alertInput}
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={alertPrice}
                onChange={e => setAlertPrice(e.target.value)}
                autoFocus
              />
              <button
                className={styles.alertSubmit}
                disabled={!alertPrice || parseFloat(alertPrice) <= 0}
                onClick={() => {
                  createAlert(alertPopover.sym, parseFloat(alertPrice), alertDir)
                  setAlertPopover(null)
                }}
              >Set</button>
            </div>
            {getAlertsForSym(alertPopover.sym).length > 0 && (
              <div className={styles.alertList}>
                {getAlertsForSym(alertPopover.sym).map(a => (
                  <div key={a.id} className={styles.alertItem}>
                    <span>{a.direction} ${a.target_price.toFixed(2)}</span>
                    <button className={styles.alertDeleteBtn} onClick={() => deleteAlert(a.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (() => {
        const ctxBody = (
          <>
            {ctxMenu.isOwner && (
              <button className={styles.ctxItem} onClick={() => {
                if (ctxMenu.id === 'flagged') {
                  setRenameValue(flaggedName || `Flagged (${user?.display_name || 'You'})`)
                } else {
                  const wl = myLists?.find(w => w.id === ctxMenu.id)
                  setRenameValue(wl?.name || '')
                }
                setRenamingId(ctxMenu.id)
                setCtxMenu(null)
              }}>Rename</button>
            )}
            <button className={styles.ctxItem} onClick={() => handleCopyList(ctxMenu.symbols)}>
              Copy list to clipboard
            </button>
            {ctxMenu.isOwner && ctxMenu.id !== 'flagged' && (
              <button className={styles.ctxItem} onClick={() => {
                const wl = myLists?.find(w => w.id === ctxMenu.id)
                if (wl) exportCSV(wl)
              }}>Export CSV</button>
            )}
            {ctxMenu.isOwner && ctxMenu.id !== 'flagged' && (
              <button className={styles.ctxItem} onClick={() => {
                setImportListId(ctxMenu.id)
                setImportText('')
                setCtxMenu(null)
              }}>Import tickers</button>
            )}
            {ctxMenu.isOwner && getStarredSyms(ctxMenu.id).length > 0 && (
              <button className={`${styles.ctxItem} ${styles.ctxItemDanger}`} onClick={() => handleRemoveStarred(ctxMenu.id)}>
                Remove starred ({getStarredSyms(ctxMenu.id).length})
              </button>
            )}
            {ctxMenu.sym && (
              <div className={styles.ctxTagSection}>
                <span className={styles.ctxTagLabel}>Tag {ctxMenu.sym}</span>
                <div className={styles.tagSwatches}>
                  {TAG_COLORS.map(tc => (
                    <button
                      key={tc.key}
                      className={`${styles.tagSwatch}${getTag(ctxMenu.sym) === tc.key ? ' ' + styles.tagSwatchActive : ''}`}
                      style={{ background: tc.hex }}
                      title={tc.label}
                      onClick={() => {
                        if (getTag(ctxMenu.sym) === tc.key) removeTag(ctxMenu.sym)
                        else setTag(ctxMenu.sym, tc.key)
                        setCtxMenu(null)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )
        // Touch → bottom sheet with big tap targets; desktop → anchored popover.
        if (isTouch) {
          return (
            <Sheet open onClose={() => setCtxMenu(null)} variant="bottom-sheet" title={ctxMenu.sym || 'List'}>
              <div className={styles.ctxSheetBody}>{ctxBody}</div>
            </Sheet>
          )
        }
        return (
          <div className={styles.ctxBackdrop} onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }}>
            <div className={styles.ctxMenu} style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
              {ctxBody}
            </div>
          </div>
        )
      })()}

    </div>
  )
}

