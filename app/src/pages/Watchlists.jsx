// app/src/pages/Watchlists.jsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import { useFlagged } from '../hooks/useFlagged'
import useLivePrices from '../hooks/useLivePrices'
import StockChart from '../components/StockChart'
import styles from './Watchlists.module.css'

const fetcher = url => fetch(url).then(r => r.json())
const PERIODS = [['5', '5min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly']]

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
  const [activeTab, setActiveTab] = useState('flagged')
  const [selectedSym, setSelectedSym] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)
  const [expandedLists, setExpandedLists] = useState(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_public: false })
  const [saving, setSaving] = useState(false)

  const { flagged, remove: removeFlagged } = useFlagged()
  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher, { refreshInterval: 60000 })
  const { data: communityLists, mutate: mutateCommunity } = useSWR('/api/watchlists/public', fetcher, { refreshInterval: 60000 })

  // Collect all visible tickers for live prices
  const allTickers = useMemo(() => {
    if (activeTab === 'flagged') return flagged
    const lists = activeTab === 'mine' ? myLists : communityLists
    if (!lists) return []
    return lists
      .filter(wl => expandedLists.has(wl.id))
      .flatMap(wl => (wl.items || []).map(i => i.sym))
      .filter(Boolean)
  }, [activeTab, flagged, myLists, communityLists, expandedLists])

  const { prices } = useLivePrices(allTickers)

  // Auto-select first flagged when flagged list changes and ticker removed
  useEffect(() => {
    if (activeTab !== 'flagged') return
    if (selectedSym && flagged.includes(selectedSym)) return
    setSelectedSym(flagged[0] ?? null)
  }, [flagged, activeTab])

  // Clear toast
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Keyboard nav (flagged tab)
  const handleKeyDown = useCallback((e) => {
    if (activeTab !== 'flagged') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = flagged.indexOf(selectedSym)
      const next = e.key === 'ArrowDown'
        ? Math.min(idx + 1, flagged.length - 1)
        : Math.max(idx - 1, 0)
      if (next >= 0) setSelectedSym(flagged[next])
    }
    if (e.shiftKey && e.key === 'F' && selectedSym) {
      removeFlagged(selectedSym)
      setFlagToast('removed')
    }
  }, [activeTab, flagged, selectedSym, removeFlagged])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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

  return (
    <div className={styles.page}>

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn}${activeTab === 'flagged' ? ' ' + styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('flagged')}
          >⚑ Flagged</button>
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
          {activeTab === 'flagged' && (
            <>
              <span className={styles.listMeta}>{flagged.length} symbols</span>
              <span className={styles.listHint}>↑↓ · Shift+F remove</span>
            </>
          )}
          {activeTab === 'mine' && (
            <>
              <span className={styles.listMeta}>{myLists?.length ?? 0} lists</span>
              <button className={styles.newListBtn} onClick={() => setShowCreate(true)}>+ New List</button>
            </>
          )}
          {activeTab === 'community' && (
            <span className={styles.listMeta}>{communityLists?.length ?? 0} shared lists</span>
          )}
        </div>

        {/* Body */}
        <div className={styles.listBody}>

          {/* ── Flagged tab ── */}
          {activeTab === 'flagged' && (
            flagged.length === 0 ? (
              <div className={styles.emptyList}>
                <div className={styles.emptyIcon}>⚑</div>
                <div className={styles.emptyText}>No flagged tickers yet.</div>
                <div className={styles.emptyHint}>Open any chart and press <strong>Shift+F</strong></div>
              </div>
            ) : flagged.map(sym => {
              const q = prices[sym]
              const price = q?.price ?? null
              const changePct = q?.change_pct ?? null
              return (
                <div
                  key={sym}
                  className={`${styles.listRow}${selectedSym === sym ? ' ' + styles.listRowSelected : ''}`}
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
                    <button className={styles.removeBtn} onClick={e => { e.stopPropagation(); removeFlagged(sym) }} title="Remove">×</button>
                  </div>
                </div>
              )
            })
          )}

          {/* ── My Lists + Community tabs ── */}
          {(activeTab === 'mine' || activeTab === 'community') && (
            !currentLists ? (
              <div className={styles.loading}>Loading…</div>
            ) : currentLists.length === 0 ? (
              <div className={styles.emptyList}>
                <div className={styles.emptyText}>
                  {activeTab === 'mine'
                    ? 'No watchlists yet. Create one above.'
                    : 'No community lists shared yet.'}
                </div>
              </div>
            ) : currentLists.map(wl => {
              const isOwner = activeTab === 'mine'
              const open = expandedLists.has(wl.id)
              const items = wl.items || []
              return (
                <div key={wl.id} className={styles.wlGroup}>
                  {/* Watchlist header row */}
                  <div className={styles.wlHeader} onClick={() => toggleList(wl.id)}>
                    <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
                    <span className={styles.wlName}>{wl.name}</span>
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

                  {/* Expanded items */}
                  {open && (
                    <div className={styles.wlItems}>
                      {wl.description && (
                        <div className={styles.wlDesc}>{wl.description}</div>
                      )}
                      {items.length === 0 && (
                        <div className={styles.wlEmpty}>No symbols yet.</div>
                      )}
                      {items.map(item => {
                        const q = prices[item.sym]
                        const price = q?.price ?? null
                        const changePct = q?.change_pct ?? null
                        return (
                          <div
                            key={item.id}
                            className={`${styles.listRow} ${styles.wlRow}${selectedSym === item.sym ? ' ' + styles.listRowSelected : ''}`}
                            onClick={() => setSelectedSym(item.sym)}
                          >
                            <span className={styles.rowSym}>{item.sym}</span>
                            <div className={styles.rowRight}>
                              {price != null && <span className={styles.rowPrice}>${price.toFixed(2)}</span>}
                              {changePct != null && (
                                <span className={`${styles.rowChange} ${changePct >= 0 ? styles.gain : styles.loss}`}>
                                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                                </span>
                              )}
                              {isOwner && (
                                <button
                                  className={styles.removeBtn}
                                  onClick={e => { e.stopPropagation(); handleRemoveItem(wl.id, item.id) }}
                                  title="Remove"
                                >×</button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {isOwner && <AddItemRow onAdd={sym => handleAddItem(wl.id, sym)} />}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel: chart ── */}
      <div className={styles.rightPanel}>
        {selectedSym ? (
          <>
            <div className={styles.chartHeader}>
              <span className={styles.chartSym}>{selectedSym}</span>
              {flagToast && (
                <span className={`${styles.flagToast} ${styles.flagToastRemoved}`}>⚑ Removed</span>
              )}
              {activeTab === 'flagged' && (
                <button
                  className={`${styles.flagBtn} ${styles.flagBtnActive}`}
                  onClick={() => { removeFlagged(selectedSym); setFlagToast('removed') }}
                  title="Remove from Flagged (Shift+F)"
                >⚑ Flagged</button>
              )}
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
            <StockChart sym={selectedSym} tf={chartPeriod} />
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

    </div>
  )
}
