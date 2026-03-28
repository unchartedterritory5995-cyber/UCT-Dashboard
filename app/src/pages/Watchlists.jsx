import { useState, useMemo } from 'react'
import useSWR from 'swr'
import useLivePrices from '../hooks/useLivePrices'
import { useFlagged } from '../hooks/useFlagged'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import { SkeletonTileContent } from '../components/Skeleton'
import styles from './Watchlists.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function FlaggedView({ flagged, remove }) {
  const { prices } = useLivePrices(flagged)

  if (!flagged.length) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>⚑</div>
        <div className={styles.emptyText}>
          Nothing flagged yet.<br />
          Open any ticker chart and press <strong>Shift+F</strong> to flag it.
        </div>
      </div>
    )
  }

  return (
    <TileCard title={`${flagged.length} Flagged`}>
      <table className={styles.itemsTable}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th className={styles.thPrice}>Price</th>
            <th className={styles.thChange}>Chg%</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {flagged.map(sym => {
            const q = prices[sym]
            const price = q?.price ?? null
            const changePct = q?.change_pct ?? null
            return (
              <tr key={sym}>
                <td className={styles.itemSym}><TickerPopup sym={sym} /></td>
                <td className={styles.itemPrice}>
                  {price != null ? `$${price.toFixed(2)}` : '—'}
                </td>
                <td className={`${styles.itemChange} ${changePct != null ? (changePct >= 0 ? styles.gain : styles.loss) : ''}`}>
                  {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%` : '—'}
                </td>
                <td>
                  <button className={styles.removeBtn} onClick={() => remove(sym)} title="Remove from Flagged">✕</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TileCard>
  )
}

export default function Watchlists() {
  const [tab, setTab] = useState('mine')
  const { flagged, remove: removeFlagged } = useFlagged()
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_public: false })
  const [selectedId, setSelectedId] = useState(null)
  const [addSym, setAddSym] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher, { refreshInterval: 60000 })
  const { data: publicLists, mutate: mutatePublic } = useSWR('/api/watchlists/public', fetcher, { refreshInterval: 60000 })
  const { data: detail, mutate: mutateDetail } = useSWR(
    selectedId ? `/api/watchlists/${selectedId}` : null, fetcher
  )

  const lists = tab === 'mine' ? myLists : publicLists

  // Extract all tickers from current detail view for live pricing
  const allTickers = useMemo(() => {
    if (!detail?.items) return []
    return detail.items.map(item => item.sym).filter(Boolean)
  }, [detail])

  const { prices } = useLivePrices(allTickers)

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
        mutatePublic()
      }
    } finally { setSaving(false) }
  }

  async function handleAddItem(e) {
    e.preventDefault()
    if (!addSym.trim()) return
    await fetch(`/api/watchlists/${selectedId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym: addSym.trim(), notes: addNotes }),
    })
    setAddSym('')
    setAddNotes('')
    mutateDetail()
    mutateMine()
  }

  async function handleRemoveItem(itemId) {
    await fetch(`/api/watchlists/${selectedId}/items/${itemId}`, { method: 'DELETE' })
    mutateDetail()
    mutateMine()
  }

  async function togglePublic() {
    if (!detail) return
    await fetch(`/api/watchlists/${selectedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: !detail.is_public }),
    })
    mutateDetail()
    mutateMine()
    mutatePublic()
  }

  async function handleDeleteList() {
    await fetch(`/api/watchlists/${selectedId}`, { method: 'DELETE' })
    setSelectedId(null)
    mutateMine()
    mutatePublic()
  }

  // Flagged detail view
  if (selectedId === '__flagged__') {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => setSelectedId(null)}>← Back to Watchlists</button>
        <div className={styles.detailHeader}>
          <span className={styles.detailName}>⚑ Flagged</span>
          <span className={styles.privateBadge}>PRIVATE</span>
        </div>
        <FlaggedView flagged={flagged} remove={removeFlagged} />
      </div>
    )
  }

  // Regular detail view
  if (selectedId && detail) {
    const isOwner = myLists?.some(w => w.id === selectedId)
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => setSelectedId(null)}>← Back to Watchlists</button>
        <div className={styles.detailHeader}>
          <span className={styles.detailName}>{detail.name}</span>
          <span className={detail.is_public ? styles.publicBadge : styles.privateBadge}>
            {detail.is_public ? 'PUBLIC' : 'PRIVATE'}
          </span>
          {detail.owner_name && <span className={styles.ownerTag}>by {detail.owner_name}</span>}
          {isOwner && (
            <div className={styles.detailActions}>
              <button className={styles.toggleBtn} onClick={togglePublic}>
                {detail.is_public ? 'Make Private' : 'Make Public'}
              </button>
              <button className={styles.deleteWlBtn} onClick={handleDeleteList}>Delete</button>
            </div>
          )}
        </div>
        {detail.description && <p className={styles.cardDesc}>{detail.description}</p>}

        {isOwner && (
          <form className={styles.addRow} onSubmit={handleAddItem}>
            <input className={`${styles.input} ${styles.inputSym}`} placeholder="TICKER"
              value={addSym} onChange={e => setAddSym(e.target.value.toUpperCase())} />
            <input className={`${styles.input} ${styles.inputNotes}`} placeholder="Notes (optional)"
              value={addNotes} onChange={e => setAddNotes(e.target.value)} />
            <button type="submit" className={styles.addItemBtn}>+ Add</button>
          </form>
        )}

        <TileCard title={`${detail.items?.length || 0} Symbols`}>
          {(!detail.items || detail.items.length === 0) ? (
            <div className={styles.empty}>
              <div className={styles.emptyText}>No symbols yet. Add one above.</div>
            </div>
          ) : (
            <table className={styles.itemsTable}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className={styles.thPrice}>Price</th>
                  <th className={styles.thChange}>Chg%</th>
                  <th>Notes</th>
                  <th>Added</th>
                  {isOwner && <th></th>}
                </tr>
              </thead>
              <tbody>
                {detail.items.map(item => {
                  const q = prices[item.sym]
                  const price = q?.price ?? null
                  const changePct = q?.change_pct ?? null
                  return (
                    <tr key={item.id}>
                      <td className={styles.itemSym}><TickerPopup sym={item.sym} /></td>
                      <td className={styles.itemPrice}>
                        {price != null ? `$${price.toFixed(2)}` : '—'}
                      </td>
                      <td className={`${styles.itemChange} ${changePct != null ? (changePct >= 0 ? styles.gain : styles.loss) : ''}`}>
                        {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%` : '—'}
                      </td>
                      <td className={styles.itemNotes}>{item.notes || '—'}</td>
                      <td className={styles.itemDate}>{item.added_at ? new Date(item.added_at).toLocaleDateString() : '—'}</td>
                      {isOwner && (
                        <td><button className={styles.removeBtn} onClick={() => handleRemoveItem(item.id)}>✕</button></td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </TileCard>
      </div>
    )
  }

  // List view
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Watchlists</h1>
        <div className={styles.headerRight}>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${tab === 'mine' ? styles.tabActive : ''}`}
              onClick={() => setTab('mine')}>My Lists</button>
            <button className={`${styles.tab} ${tab === 'community' ? styles.tabActive : ''}`}
              onClick={() => setTab('community')}>Community</button>
          </div>
          <button className={styles.addBtn} onClick={() => setShowCreate(true)}>+ New List</button>
        </div>
      </div>

      {!lists ? (
        <SkeletonTileContent lines={4} />
      ) : lists.length === 0 && tab !== 'mine' ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🌐</div>
          <div className={styles.emptyText}>No public watchlists shared yet.</div>
        </div>
      ) : (
        <div className={styles.grid}>
          {/* Pinned Flagged card — always first in My Lists */}
          {tab === 'mine' && (
            <div className={`${styles.card} ${styles.flaggedCard}`} onClick={() => setSelectedId('__flagged__')}>
              <div className={styles.cardHeader}>
                <span className={styles.cardName}>⚑ Flagged</span>
                <div className={styles.cardMeta}>
                  <span className={styles.cardCount}>{flagged.length} symbols</span>
                  <span className={styles.privateBadge}>PRIVATE</span>
                </div>
              </div>
              <div className={styles.cardDesc}>Your personally flagged tickers. Press Shift+F on any chart.</div>
              {flagged.length > 0 && (
                <div className={styles.cardSymbols}>
                  {flagged.slice(0, 8).map(sym => (
                    <span key={sym} className={styles.symChip}>{sym}</span>
                  ))}
                  {flagged.length > 8 && <span className={styles.symChip}>+{flagged.length - 8}</span>}
                </div>
              )}
            </div>
          )}
          {lists.map(wl => (
            <div key={wl.id} className={styles.card} onClick={() => setSelectedId(wl.id)}>
              <div className={styles.cardHeader}>
                <span className={styles.cardName}>{wl.name}</span>
                <div className={styles.cardMeta}>
                  <span className={styles.cardCount}>{wl.item_count || wl.items?.length || 0} symbols</span>
                  <span className={wl.is_public ? styles.publicBadge : styles.privateBadge}>
                    {wl.is_public ? 'PUBLIC' : 'PRIVATE'}
                  </span>
                </div>
              </div>
              {wl.description && <div className={styles.cardDesc}>{wl.description}</div>}
              {wl.items && wl.items.length > 0 && (
                <div className={styles.cardSymbols}>
                  {wl.items.slice(0, 8).map(item => (
                    <span key={item.id} className={styles.symChip}>{item.sym}</span>
                  ))}
                  {wl.items.length > 8 && <span className={styles.symChip}>+{wl.items.length - 8}</span>}
                </div>
              )}
              {tab === 'community' && wl.owner_name && (
                <div className={styles.ownerTag}>by {wl.owner_name}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className={styles.modalBackdrop} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Watchlist</div>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Name</span>
                <input className={`${styles.input} ${styles.inputFull}`} value={createForm.name}
                  onChange={e => setCreateForm(f => ({...f, name: e.target.value}))} required autoFocus />
              </div>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Description</span>
                <input className={`${styles.input} ${styles.inputFull}`} value={createForm.description}
                  onChange={e => setCreateForm(f => ({...f, description: e.target.value}))} placeholder="Optional" />
              </div>
              <div className={styles.checkRow}>
                <input type="checkbox" id="wl-public" checked={createForm.is_public}
                  onChange={e => setCreateForm(f => ({...f, is_public: e.target.checked}))} />
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
