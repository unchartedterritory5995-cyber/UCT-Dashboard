// app/src/pages/charts/widgets/WatchlistPicker.jsx
//
// The "pick a watchlist" menu shown when a Watchlist widget is first added (no
// list chosen yet). Search + three sections — Prebuilt (curated, coming soon),
// Community (shared), and My Lists (Flagged + the user's own lists). Picking a
// list persists a `watchKey` into the widget's opts so the widget then scopes to
// that single list. Styled to match the UCT dark chart theme.
import { useState } from 'react'
import useSWR from 'swr'
import { useFlagged } from '../../../hooks/useFlagged'
import { useAuth } from '../../../context/AuthContext'
import UIcon from '../../../components/ui/UIcon'
import styles from './WatchlistPicker.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : []))
const countOf = wl => wl?.item_count ?? wl?.count ?? (Array.isArray(wl?.symbols) ? wl.symbols.length : (Array.isArray(wl?.items) ? wl.items.length : null))

export default function WatchlistPicker({ onPick }) {
  const { user } = useAuth()
  const { flagged, flaggedName } = useFlagged()
  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher)
  const { data: communityLists } = useSWR('/api/watchlists/public', fetcher)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [createErr, setCreateErr] = useState('')

  // Creating a list belongs HERE, on the "add a watchlist" screen — once the
  // widget scopes to a single list there is nowhere for a new one to appear.
  // Create → immediately pick it, so the user lands in the empty list with the
  // add bar ready to fill it.
  async function createList() {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    setCreateErr('')
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: '', is_public: false }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const created = await res.json()
      if (!created?.id) throw new Error('no id')
      mutateMine()
      onPick({ key: `user:${created.id}`, name: created.name })
    } catch {
      setCreateErr('Could not create that list.')
    } finally {
      setSaving(false)
    }
  }

  const query = q.trim().toLowerCase()
  const match = name => !query || String(name || '').toLowerCase().includes(query)

  const flaggedLabel = flaggedName || `Flagged (${user?.display_name || 'You'})`
  const showFlagged = match(flaggedLabel)
  const mine = (Array.isArray(myLists) ? myLists : []).filter(wl => match(wl.name))
  const community = (Array.isArray(communityLists) ? communityLists : []).filter(wl => match(wl.name))

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <div className={styles.title}>Add a Watchlist</div>
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
        {/* Prebuilt — curated lists, coming soon */}
        <div className={styles.section}>Prebuilt</div>
        <div className={styles.comingSoon}>Curated lists coming soon.</div>

        {/* Community */}
        <div className={styles.section}>Community</div>
        {community.length === 0 ? (
          <div className={styles.empty}>{query ? 'No matches' : 'No shared lists yet'}</div>
        ) : community.map(wl => (
          <button key={`c${wl.id}`} type="button" className={styles.row} onClick={() => onPick({ key: `community:${wl.id}`, name: wl.name })}>
            <span className={styles.rowIcon}><UIcon name="community" size={13} gold={false} /></span>
            <span className={styles.rowName}>{wl.name}</span>
            {wl.owner_name && <span className={styles.rowMeta}>{wl.owner_name}</span>}
            {countOf(wl) != null && <span className={styles.rowCount}>{countOf(wl)}</span>}
          </button>
        ))}

        {/* My Lists */}
        <div className={styles.section}>My Lists</div>
        {user && (creating ? (
          <div className={styles.newRow}>
            <input
              className={styles.newInput}
              value={newName}
              maxLength={60}
              autoFocus
              placeholder="List name"
              aria-label="New watchlist name"
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); createList() }
                if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setNewName(''); setCreateErr('') }
              }}
            />
            <button
              type="button"
              className={styles.newGo}
              disabled={!newName.trim() || saving}
              onClick={createList}
            >{saving ? '…' : 'Create'}</button>
          </div>
        ) : (
          <button type="button" className={`${styles.row} ${styles.newRowBtn}`} onClick={() => setCreating(true)}>
            <span className={styles.rowIcon}><UIcon name="plus" size={13} gold={false} /></span>
            <span className={styles.rowName}>New list…</span>
          </button>
        ))}
        {createErr && <div className={styles.createErr}>{createErr}</div>}
        {showFlagged && (
          <button type="button" className={styles.row} onClick={() => onPick({ key: 'flagged', name: flaggedLabel })}>
            <span className={styles.rowIcon}><UIcon name="flag" size={13} gold={false} /></span>
            <span className={styles.rowName}>{flaggedLabel}</span>
            {flagged?.length != null && <span className={styles.rowCount}>{flagged.length}</span>}
          </button>
        )}
        {mine.map(wl => (
          <button key={`m${wl.id}`} type="button" className={styles.row} onClick={() => onPick({ key: `user:${wl.id}`, name: wl.name })}>
            <span className={styles.rowIcon}><UIcon name="library" size={13} gold={false} /></span>
            <span className={styles.rowName}>{wl.name}</span>
            {countOf(wl) != null && <span className={styles.rowCount}>{countOf(wl)}</span>}
          </button>
        ))}
        {mine.length === 0 && !showFlagged && <div className={styles.empty}>{query ? 'No matches' : 'No custom lists yet'}</div>}
      </div>
    </div>
  )
}
