// app/src/pages/charts/widgets/WatchlistPicker.jsx
//
// The "pick a watchlist" landing menu shown when a Watchlist widget is first added
// (no list chosen yet). Redesigned as a tabbed browser — Prebuilt (admin-curated UCT
// lists) · Community (shared) · My Lists (Flagged + the user's own lists) — with a
// search that scopes to the active tab and a quick inline "New watchlist" create
// (optionally seeded from a saved look Template). Picking a list persists a `watchKey`
// into the widget's opts so the widget then scopes to that single list. Styled to the
// UCT OLED-black chart theme.
import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { useFlagged } from '../../../hooks/useFlagged'
import { useAuth } from '../../../context/AuthContext'
import UIcon from '../../../components/ui/UIcon'
import { useWatchlistTemplates } from '../../watchlist/watchlistTemplates'
import styles from './WatchlistPicker.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : []))
const countOf = wl => wl?.item_count ?? wl?.count ?? (Array.isArray(wl?.symbols) ? wl.symbols.length : (Array.isArray(wl?.items) ? wl.items.length : null))

const TABS = [
  { key: 'prebuilt', label: 'Prebuilt', icon: 'star' },
  { key: 'community', label: 'Community', icon: 'community' },
  { key: 'mine', label: 'My Lists', icon: 'library' },
]

export default function WatchlistPicker({ onPick }) {
  const { user } = useAuth()
  const { flagged, flaggedName } = useFlagged()
  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher)
  const { data: communityLists } = useSWR('/api/watchlists/public', fetcher)
  const { data: prebuiltLists } = useSWR('/api/watchlists/prebuilt', fetcher)
  const { templates } = useWatchlistTemplates()

  const [tab, setTab] = useState('mine')   // default to the actionable tab
  const [q, setQ] = useState('')

  // Inline create state
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [tplId, setTplId] = useState('')
  const [busy, setBusy] = useState(false)

  const query = q.trim().toLowerCase()
  const match = name => !query || String(name || '').toLowerCase().includes(query)

  const flaggedLabel = flaggedName || `Flagged (${user?.display_name || 'You'})`
  const showFlagged = match(flaggedLabel)
  const mine = (Array.isArray(myLists) ? myLists : []).filter(wl => match(wl.name))
  const community = (Array.isArray(communityLists) ? communityLists : []).filter(wl => match(wl.name))
  const prebuilt = (Array.isArray(prebuiltLists) ? prebuiltLists : []).filter(wl => match(wl.name))

  const submitCreate = useCallback(async (e) => {
    e?.preventDefault?.()
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      })
      if (!res.ok) return
      const wl = await res.json()
      mutateMine()
      const tpl = templates.find(t => t.id === tplId)
      // Seed the new list's look from the chosen template (appearance + columns).
      onPick({ key: `user:${wl.id}`, name: wl.name, settings: tpl?.settings, cols: tpl?.cols })
    } finally {
      setBusy(false)
    }
  }, [newName, busy, templates, tplId, mutateMine, onPick])

  const Row = ({ wl, icon, onClick }) => (
    <button type="button" className={styles.row} onClick={onClick}>
      <span className={styles.rowIcon}><UIcon name={icon} size={13} gold={false} /></span>
      <span className={styles.rowName}>{wl.name}</span>
      {wl.owner_name && <span className={styles.rowMeta}>{wl.owner_name}</span>}
      {countOf(wl) != null && <span className={styles.rowCount}>{countOf(wl)}</span>}
    </button>
  )

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <div className={styles.title}>Add a Watchlist</div>

        {/* Segmented tab control */}
        <div className={styles.tabs} role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tab}${tab === t.key ? ' ' + styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              <UIcon name={t.icon} size={12} gold={false} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.searchWrap}>
          <UIcon name="search" size={13} gold={false} />
          <input
            className={styles.search}
            placeholder="Search watchlists…"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className={styles.body}>
        {/* ── Prebuilt ── */}
        {tab === 'prebuilt' && (
          prebuilt.length === 0 ? (
            <div className={styles.emptyWrap}>
              <UIcon name="star" size={22} gold />
              <div className={styles.emptyTitle}>Curated UCT lists</div>
              <div className={styles.emptyText}>
                {query ? 'No matches.' : 'Hand-picked watchlists from Uncharted Territory are coming soon.'}
              </div>
            </div>
          ) : prebuilt.map(wl => (
            <Row key={`p${wl.id}`} wl={wl} icon="star"
              onClick={() => onPick({ key: `community:${wl.id}`, name: wl.name })} />
          ))
        )}

        {/* ── Community ── */}
        {tab === 'community' && (
          community.length === 0 ? (
            <div className={styles.emptyWrap}>
              <UIcon name="community" size={22} gold />
              <div className={styles.emptyTitle}>Community lists</div>
              <div className={styles.emptyText}>{query ? 'No matches.' : 'No shared lists yet.'}</div>
            </div>
          ) : community.map(wl => (
            <Row key={`c${wl.id}`} wl={wl} icon="community"
              onClick={() => onPick({ key: `community:${wl.id}`, name: wl.name })} />
          ))
        )}

        {/* ── My Lists ── */}
        {tab === 'mine' && (
          <>
            {/* Quick inline create */}
            {creating ? (
              <form className={styles.createForm} onSubmit={submitCreate}>
                <input
                  className={styles.createInput}
                  placeholder="Watchlist name…"
                  value={newName}
                  maxLength={60}
                  autoFocus
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
                />
                {templates.length > 0 && (
                  <label className={styles.createTplRow}>
                    <span className={styles.createTplLabel}>Template</span>
                    <select className={styles.createSelect} value={tplId} onChange={e => setTplId(e.target.value)}>
                      <option value="">None</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                )}
                <div className={styles.createActions}>
                  <button type="button" className={styles.createCancel} onClick={() => { setCreating(false); setNewName('') }}>Cancel</button>
                  <button type="submit" className={styles.createBtn} disabled={!newName.trim() || busy}>{busy ? 'Creating…' : 'Create'}</button>
                </div>
              </form>
            ) : (
              <button type="button" className={styles.newBtn} onClick={() => setCreating(true)}>
                <UIcon name="plus" size={14} gold={false} />
                <span>New watchlist</span>
              </button>
            )}

            {showFlagged && (
              <button type="button" className={styles.row} onClick={() => onPick({ key: 'flagged', name: flaggedLabel })}>
                <span className={styles.rowIcon}><UIcon name="flag" size={13} gold={false} /></span>
                <span className={styles.rowName}>{flaggedLabel}</span>
                {flagged?.length != null && <span className={styles.rowCount}>{flagged.length}</span>}
              </button>
            )}
            {mine.map(wl => (
              <Row key={`m${wl.id}`} wl={wl} icon="library"
                onClick={() => onPick({ key: `user:${wl.id}`, name: wl.name })} />
            ))}
            {mine.length === 0 && !showFlagged && (
              <div className={styles.empty}>{query ? 'No matches' : 'No custom lists yet — create one above.'}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
