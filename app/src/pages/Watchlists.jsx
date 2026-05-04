// app/src/pages/Watchlists.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import { useFlagged } from '../hooks/useFlagged'
import { useAuth } from '../context/AuthContext'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useWatchlistPerformance from '../hooks/useWatchlistPerformance'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import useTagColors from '../hooks/useTagColors'
import StockChart from '../components/StockChart'
import SymbolSearch from '../components/chart/SymbolSearch'
import { prefetchBars, prefetchAllTimeframes } from '../utils/prefetchBars'
import styles from './Watchlists.module.css'

const fetcher = url => fetch(url).then(r => r.json())
const PERIODS = [['1', '1min'], ['5', '5min'], ['15', '15min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']]
const PERF_COLS = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD']]
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

export default function Watchlists() {
  const [activeTab, setActiveTab] = useState('mine')
  const [selectedSym, setSelectedSym] = useState(null)
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

  function handleCopyList(symbols) {
    navigator.clipboard.writeText(symbols.join(', '))
    setCtxMenu(null)
  }

  const { user } = useAuth()
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

  // Keyboard nav within flagged group
  const handleKeyDown = useCallback((e) => {
    if (!expandedLists.has('flagged') || activeTab !== 'mine') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const idx = flagged.indexOf(selectedSym)
      if (idx < 0) return
      e.preventDefault()
      const next = e.key === 'ArrowDown'
        ? Math.min(idx + 1, flagged.length - 1)
        : Math.max(idx - 1, 0)
      if (next >= 0) setSelectedSym(flagged[next])
    }
    if (e.shiftKey && e.key === 'F' && selectedSym && flagged.includes(selectedSym)) {
      removeFlagged(selectedSym)
      setFlagToast('removed')
    }
  }, [activeTab, flagged, selectedSym, removeFlagged, expandedLists])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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
              >{wl.is_public ? '🔓' : '🔒'}</button>
              <button
                className={`${styles.wlActionBtn} ${styles.wlDeleteBtn}`}
                onClick={() => handleDeleteList(wl.id)}
                title="Delete watchlist"
              >×</button>
            </div>
          )}
        </div>

        {open && (() => {
          const sortedItems = sortAndFilterItems(items)
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
                  <div
                    className={`${styles.listRow} ${styles.wlRow}${selectedSym === item.sym ? ' ' + styles.listRowSelected : ''}${dragItemId === item.id ? ' ' + styles.dragging : ''}${dragOverId === item.id ? ' ' + styles.dragOver : ''}`}
                    onClick={() => setSelectedSym(item.sym)}
                    draggable={dragOk}
                    onDragStart={dragOk ? e => { e.dataTransfer.effectAllowed = 'move'; setDragItemId(item.id) } : undefined}
                    onDragOver={dragOk ? e => { e.preventDefault(); setDragOverId(item.id) } : undefined}
                    onDrop={dragOk ? e => { e.preventDefault(); handleDrop(wl.id, items) } : undefined}
                    onDragEnd={() => { setDragItemId(null); setDragOverId(null) }}
                  >
                    {dragOk && <span className={styles.dragHandle}>⠿</span>}
                    <button
                      className={`${styles.starBtn}${isStarred ? ' ' + styles.starBtnActive : ''}`}
                      onClick={e => { e.stopPropagation(); toggleStar(wl.id, item.sym) }}
                      title={isStarred ? 'Unstar' : 'Star'}
                    >{isStarred ? '★' : '☆'}</button>
                    {getTag(item.sym) && (
                      <span className={styles.tagDot} style={{ background: TAG_BY_KEY[getTag(item.sym)]?.hex }} title={TAG_BY_KEY[getTag(item.sym)]?.label} />
                    )}
                    <span className={styles.rowSym} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, id: wl.id, isOwner, symbols: items.map(i => i.sym), sym: item.sym }) }}>{item.sym}</span>
                    {item.notes && <span className={styles.noteIndicator} title="Has notes">...</span>}
                    <div className={styles.rowRight}>
                      {price != null && <span className={styles.rowPrice}>${price.toFixed(2)}</span>}
                      {changePct != null && (
                        <span className={`${styles.rowChange} ${changePct >= 0 ? styles.gain : styles.loss}`}>
                          {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                        </span>
                      )}
                      {PERF_COLS.filter(([k]) => visiblePerf.has(k)).map(([k, label]) => {
                        const val = perfData[item.sym]?.[k]
                        return (
                          <span key={k} className={`${styles.perfCell} ${changePctClass(val)}`} title={label}>
                            {val != null ? `${val > 0 ? '+' : ''}${val.toFixed(1)}%` : '—'}
                          </span>
                        )
                      })}
                      <button
                        className={`${styles.noteBtn}${expandedNote === item.id ? ' ' + styles.noteBtnActive : ''}`}
                        onClick={e => { e.stopPropagation(); toggleNote(item.id, item.notes) }}
                        title="Notes"
                      >✎</button>
                      <button
                        className={`${styles.alertBtn}${hasAlert(item.sym) ? ' ' + styles.alertBtnActive : ''}`}
                        onClick={e => { e.stopPropagation(); setAlertPopover({ sym: item.sym, x: e.clientX, y: e.clientY }); setAlertPrice(''); setAlertDir('above') }}
                        title="Set price alert"
                      >🔔</button>
                      {isOwner && (
                        <button
                          className={styles.removeBtn}
                          onClick={e => { e.stopPropagation(); handleRemoveItem(wl.id, item.id) }}
                          title="Remove"
                        >×</button>
                      )}
                    </div>
                  </div>
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
            >{flaggedName || `⚑ Flagged (${user?.display_name || 'You'})`}</span>
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
              >{isShared ? '🔓' : '🔒'}</button>
            </div>
          )}
        </div>

        {open && (
          <div className={styles.wlItems}>
            {flagged.length === 0 ? (
              <div className={styles.wlEmpty}>No flagged tickers. Press <strong>Shift+F</strong> on any chart.</div>
            ) : flagged.map(sym => {
              const q = prices[sym]
              const price = q?.price ?? null
              const changePct = q?.change_pct ?? null
              const isStarred = starred.has(`flagged:${sym}`)
              return (
                <div
                  key={sym}
                  className={`${styles.listRow} ${styles.wlRow}${selectedSym === sym ? ' ' + styles.listRowSelected : ''}`}
                  onClick={() => setSelectedSym(sym)}
                >
                  <button
                    className={`${styles.starBtn}${isStarred ? ' ' + styles.starBtnActive : ''}`}
                    onClick={e => { e.stopPropagation(); toggleStar('flagged', sym) }}
                    title={isStarred ? 'Unstar' : 'Star'}
                  >{isStarred ? '★' : '☆'}</button>
                  {getTag(sym) && (
                    <span className={styles.tagDot} style={{ background: TAG_BY_KEY[getTag(sym)]?.hex }} title={TAG_BY_KEY[getTag(sym)]?.label} />
                  )}
                  <span className={styles.rowSym}>{sym}</span>
                  <div className={styles.rowRight}>
                    {price != null && <span className={styles.rowPrice}>${price.toFixed(2)}</span>}
                    {changePct != null && (
                      <span className={`${styles.rowChange} ${changePct >= 0 ? styles.gain : styles.loss}`}>
                        {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                      </span>
                    )}
                    {PERF_COLS.filter(([k]) => visiblePerf.has(k)).map(([k, label]) => {
                      const val = perfData[sym]?.[k]
                      return (
                        <span key={k} className={`${styles.perfCell} ${changePctClass(val)}`} title={label}>
                          {val != null ? `${val > 0 ? '+' : ''}${val.toFixed(1)}%` : '—'}
                        </span>
                      )
                    })}
                    <button className={styles.removeBtn} onClick={e => { e.stopPropagation(); removeFlagged(sym) }} title="Remove">×</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.page}>

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Tab bar — 2 tabs */}
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

        {/* Sub-header */}
        <div className={styles.listHeader}>
          {activeTab === 'mine' && (
            <>
              <span className={styles.listMeta}>{(myLists?.length ?? 0) + 1} lists</span>
              <div className={styles.headerActions}>
                <div className={styles.colToggleWrap}>
                  <button className={styles.colToggleBtn} onClick={() => setShowPerfCols(!showPerfCols)} title="Toggle columns">⚙</button>
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

        {/* Body */}
        <div className={styles.listBody}>

          {/* ── My Lists tab — Flagged pinned at top + tag groups + user lists ── */}
          {activeTab === 'mine' && (
            <>
              {renderFlaggedGroup()}
              {TAG_COLORS.map(tc => {
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
                        >{isColorShared(tc.key) ? '🔓' : '🔒'}</button>
                      </div>
                    </div>
                    {open && (
                      <div className={styles.wlItems}>
                        {syms.map(sym => {
                          const q = prices[sym]
                          const price = q?.price ?? null
                          const changePct = q?.change_pct ?? null
                          return (
                            <div
                              key={sym}
                              className={`${styles.listRow} ${styles.wlRow}${selectedSym === sym ? ' ' + styles.listRowSelected : ''}`}
                              onClick={() => setSelectedSym(sym)}
                            >
                              <span className={styles.rowSym}>{sym}</span>
                              <div className={styles.rowRight}>
                                {price != null && <span className={styles.rowPrice}>${price.toFixed(2)}</span>}
                                {changePct != null && (
                                  <span className={`${styles.rowChange} ${changePct >= 0 ? styles.gain : styles.loss}`}>
                                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                                  </span>
                                )}
                                {PERF_COLS.filter(([k]) => visiblePerf.has(k)).map(([k, label]) => {
                                  const val = perfData[sym]?.[k]
                                  return (
                                    <span key={k} className={`${styles.perfCell} ${changePctClass(val)}`} title={label}>
                                      {val != null ? `${val > 0 ? '+' : ''}${val.toFixed(1)}%` : '—'}
                                    </span>
                                  )
                                })}
                                <button className={styles.removeBtn} onClick={e => { e.stopPropagation(); removeTag(sym) }} title="Remove tag">×</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {!myLists ? (
                <div className={styles.loading}>Loading…</div>
              ) : myLists.length === 0 ? (
                <div className={styles.wlEmpty} style={{ padding: '12px 8px', opacity: 0.5 }}>
                  No custom lists yet. Create one above.
                </div>
              ) : myLists.map(wl => renderWatchlistGroup(wl, true))}
            </>
          )}

          {/* ── Community tab ── */}
          {activeTab === 'community' && (
            <>
              {/* Community tag lists */}
              {communityTags.map((ct, i) => {
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
                        {ct.symbols.map(sym => {
                          const q = prices[sym]
                          const price = q?.price ?? null
                          const changePct = q?.change_pct ?? null
                          return (
                            <div key={sym} className={`${styles.listRow} ${styles.wlRow}${selectedSym === sym ? ' ' + styles.listRowSelected : ''}`} onClick={() => setSelectedSym(sym)}>
                              <span className={styles.rowSym}>{sym}</span>
                              <div className={styles.rowRight}>
                                {price != null && <span className={styles.rowPrice}>${price.toFixed(2)}</span>}
                                {changePct != null && (
                                  <span className={`${styles.rowChange} ${changePct >= 0 ? styles.gain : styles.loss}`}>
                                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
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
              ) : communityLists.map(wl => renderWatchlistGroup(wl, false))}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: chart ── */}
      <div className={styles.rightPanel}>
        {selectedSym ? (
          <>
            <div className={styles.chartHeader}>
              <SymbolSearch sym={selectedSym} onSymbolChange={setSelectedSym} />
              {flagToast && (
                <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                  {flagToast === 'added' ? '⚑ Flagged' : '⚑ Removed'}
                </span>
              )}
              <button
                className={`${styles.flagBtn}${isFlagged(selectedSym) ? ' ' + styles.flagBtnActive : ''}`}
                onClick={() => { const willFlag = !isFlagged(selectedSym); toggleFlag(selectedSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                title={isFlagged(selectedSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
              >⚑ {isFlagged(selectedSym) ? 'Flagged' : 'Flag'}</button>
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
      {ctxMenu && (
        <div className={styles.ctxBackdrop} onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }}>
          <div className={styles.ctxMenu} style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
            {ctxMenu.isOwner && (
              <button className={styles.ctxItem} onClick={() => {
                if (ctxMenu.id === 'flagged') {
                  setRenameValue(flaggedName || `⚑ Flagged (${user?.display_name || 'You'})`)
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
          </div>
        </div>
      )}

    </div>
  )
}

