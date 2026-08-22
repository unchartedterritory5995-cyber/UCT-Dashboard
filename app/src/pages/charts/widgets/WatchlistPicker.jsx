// app/src/pages/charts/widgets/WatchlistPicker.jsx
//
// The "pick a watchlist" landing menu shown when a Watchlist widget is first added
// (no list chosen yet). Redesigned as a tabbed browser — Prebuilt (admin-curated UCT
// lists) · Community (shared) · My Lists (Flagged + the user's own lists) — with a
// search that scopes to the active tab and a quick inline "New watchlist" create
// (optionally seeded from a saved look Template). Picking a list persists a `watchKey`
// into the widget's opts so the widget then scopes to that single list. Styled to the
// UCT OLED-black chart theme.
import { useState, useCallback, useMemo, useRef } from 'react'
import useSWR from 'swr'
import { useFlagged } from '../../../hooks/useFlagged'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import UIcon from '../../../components/ui/UIcon'
import { useWatchlistTemplates } from '../../watchlist/watchlistTemplates'
import WatchlistSettingsPanel from '../../watchlist/WatchlistSettingsPanel'
import { WATCHLIST_SETTINGS_KEY, WATCHLIST_DEFAULTS, mergeWatchlistSettings, watchlistStyleVars, watchlistDefaultsForTheme } from '../../watchlist/watchlistSettings'
import { menuThemeVars } from '../../../utils/dividerColor'
import { aliasKey } from '../../watchlist/communityPick'
import styles from './WatchlistPicker.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : []))
const countOf = wl => wl?.item_count ?? wl?.count ?? (Array.isArray(wl?.symbols) ? wl.symbols.length : (Array.isArray(wl?.items) ? wl.items.length : null))

const TABS = [
  { key: 'prebuilt', label: 'Prebuilt', icon: 'star' },
  { key: 'community', label: 'Community', icon: 'community' },
  { key: 'mine', label: 'My Lists', icon: 'library' },
]

export default function WatchlistPicker({ onPick, settingsOverride = null, onSettingsPersist = null, initialTab = null }) {
  const { flagged, flaggedName } = useFlagged()

  // Match the widget's own watchlist appearance (canvas / colors), and expose the
  // SAME ⚙ settings panel used inside a picked list, so the landing page is styled
  // and configurable exactly like the list view that follows it.
  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  // Always widget context — ignore the legacy global pref so the picker follows the
  // app theme (white on light) unless this widget has its own saved override.
  const wlSettings = useMemo(
    () => mergeWatchlistSettings(settingsOverride ?? watchlistDefaultsForTheme(placedTheme)),
    [settingsOverride, prefs],
  )
  // The picker's OWN CHROME (tab bar, count badges, search) always follows the APP THEME,
  // NOT the widget's saved list-appearance override — otherwise applying a dark list
  // template turned the nav bar + count badges black. `wlSettings` above still drives the
  // ⚙ panel (which edits the widget's real list settings).
  const chromeSettings = useMemo(
    () => mergeWatchlistSettings(watchlistDefaultsForTheme(placedTheme)),
    [prefs],
  )
  const wlStyle = useMemo(() => watchlistStyleVars(chromeSettings), [chromeSettings])
  const menuVars = useMemo(() => {
    const canvas = chromeSettings.bgMode === 'gradient' ? (chromeSettings.bgGradient?.top || chromeSettings.bg) : chromeSettings.bg
    return menuThemeVars(canvas) || {}
  }, [chromeSettings])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback((patch) => onSettingsPersist?.({ ...wlSettings, ...patch }), [wlSettings, onSettingsPersist])
  const resetSettings = useCallback(() => onSettingsPersist?.({ ...WATCHLIST_DEFAULTS }), [onSettingsPersist])

  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher)
  const { data: communityLists } = useSWR('/api/watchlists/public', fetcher)
  const { data: prebuiltLists } = useSWR('/api/watchlists/prebuilt', fetcher)
  const { templates } = useWatchlistTemplates()

  const [tab, setTab] = useState(initialTab || 'mine')   // restore the tab the user left from
  // Every pick carries its source tab so the widget can reopen the picker on it (and know
  // whether the list is prebuilt, for the always-reset-columns behavior).
  const handlePick = useCallback((sel) => onPick?.({ ...sel, tab }), [onPick, tab])
  const [q, setQ] = useState('')

  // Inline create state
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [tplId, setTplId] = useState('')
  const [busy, setBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const query = q.trim().toLowerCase()
  const match = name => !query || String(name || '').toLowerCase().includes(query)

  const flaggedLabel = flaggedName || 'Flagged'
  const showFlagged = match(flaggedLabel)
  // The admin account OWNS every prebuilt (UCT-curated) list, so the owner's own fetch
  // returns ~30 UCT names — including the 12 dated Sunday Scans issues — as "his".
  // They have their own tab; My Lists is for lists a person curates themselves.
  const mine = (Array.isArray(myLists) ? myLists : []).filter(wl => !wl?.is_prebuilt && match(wl.name))
  const community = (Array.isArray(communityLists) ? communityLists : []).filter(wl => match(wl.name))
  const prebuilt = (Array.isArray(prebuiltLists) ? prebuiltLists : []).filter(wl => match(wl.name))
  // Prebuilt lists render grouped under section headers (their `category` from the config —
  // e.g. "UCT ETF Lists"). Category order is first-seen. Within a section, DATED lists (the
  // server tags each Sunday Scans issue list with `issue_date`) come first, newest first —
  // A→Z would scramble April < August < July — and a dated section renders as ONE column so
  // the full dated name stays readable (the two-column cell ellipsizes exactly the date off
  // the end). Everything else sorts A→Z in the compact two-column grid.
  const prebuiltGroups = (() => {
    const order = []
    const byCat = new Map()
    for (const wl of prebuilt) {
      const cat = wl.category || 'UCT ETF Lists'
      if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat) }
      byCat.get(cat).push(wl)
    }
    const byIssueThenName = (a, b) => {
      const da = a.issue_date || '', db = b.issue_date || ''
      if (da !== db) return !da ? 1 : !db ? -1 : db.localeCompare(da)
      return (a.name || '').localeCompare(b.name || '')
    }
    order.forEach(c => byCat.get(c).sort(byIssueThenName))
    // A row carrying a stable `alias` (the newest Sunday Scans issue) ALSO offers a
    // "follows each issue" cell, pinned first: picking it stores community:alias:<alias>,
    // which resolves to whichever row carries the alias when the next issue lands — a
    // dated pick stays on its date. (Synthetic row: same count, its own pick key.)
    return order.map(c => {
      const lists = byCat.get(c)
      const follow = lists.filter(l => l.alias).map(l => ({
        ...l, id: `alias:${l.alias}`, name: l.alias_label || `${l.name} (latest)`,
        pickKey: aliasKey(l.alias), hint: `Always the newest issue — today ${l.name}`,
      }))
      return { category: c, lists: [...follow, ...lists], dated: lists.some(l => !!l.issue_date) }
    })
  })()

  const closeCreate = useCallback(() => { setCreating(false); setNewName(''); setCreateErr('') }, [])

  const submitCreate = useCallback(async (e) => {
    e?.preventDefault?.()
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    setCreateErr('')
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const wl = await res.json()
      // A 2xx with no id is still a FAILED create — picking it would scope the
      // widget to `user:undefined`, a phantom list that can never load.
      if (!wl?.id) throw new Error('no id')
      mutateMine()
      const tpl = templates.find(t => t.id === tplId)
      // Seed the new list's look from the chosen template (appearance + columns).
      handlePick({ key: `user:${wl.id}`, name: wl.name, settings: tpl?.settings, cols: tpl?.cols })
    } catch {
      // Never fail silently: the user typed a name and pressed Create, so a dead
      // button with no message reads as the app being broken.
      setCreateErr('Could not create that list.')
    } finally {
      setBusy(false)
    }
  }, [newName, busy, templates, tplId, mutateMine, onPick])

  const handleDelete = useCallback(async (wl) => {
    if (deletingId) return
    if (!window.confirm(`Delete watchlist "${wl.name}"? This can't be undone.`)) return
    setDeletingId(wl.id)
    try {
      const res = await fetch(`/api/watchlists/${wl.id}`, { method: 'DELETE', credentials: 'include' })
      if (res.ok) mutateMine()
    } finally {
      setDeletingId(null)
    }
  }, [deletingId, mutateMine])

  const Row = ({ wl, icon, onClick, hideOwner = false }) => (
    <button type="button" className={styles.row} onClick={onClick}>
      {icon && <span className={styles.rowIcon}><UIcon name={icon} size={13} gold={false} /></span>}
      <span className={styles.rowName}>{wl.name}</span>
      {!hideOwner && wl.owner_name && <span className={styles.rowMeta}>{wl.owner_name}</span>}
      {countOf(wl) != null && <span className={styles.rowCount}>{countOf(wl)}</span>}
    </button>
  )

  // Compact 2-column prebuilt cell: gold name + plain count, hairline grid, hover highlight.
  const PrebuiltCell = ({ wl, onClick }) => (
    <button type="button" className={styles.pCell} title={wl.hint || wl.name} onClick={onClick}>
      <span className={styles.pCellName}>{wl.name}</span>
      {countOf(wl) != null && <span className={styles.pCellCount}>{countOf(wl)}</span>}
    </button>
  )

  return (
    <div className={styles.picker} ref={rootRef} style={wlStyle}>
      {settingsOpen && onSettingsPersist && (
        <WatchlistSettingsPanel
          settings={wlSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.title}>Add a Watchlist</div>
          {onSettingsPersist && (
            <button
              ref={settingsBtnRef}
              type="button"
              className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
              onClick={() => setSettingsOpen(o => !o)}
              title="Watchlist settings"
              aria-label="Watchlist settings"
            ><UIcon name="gear" size={13} /></button>
          )}
        </div>

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
          ) : prebuiltGroups.map(g => (
            <div key={g.category} className={styles.catGroup}>
              <div className={styles.catHeader}>
                <span>{g.category}</span>
                <span className={styles.catCount}>{g.lists.length} lists</span>
              </div>
              <div className={g.dated ? styles.pList : styles.pGrid}>
                {g.lists.map(wl => (
                  <PrebuiltCell key={`p${wl.id}`} wl={wl}
                    onClick={() => handlePick({ key: wl.pickKey || `community:${wl.id}`, name: wl.name })} />
                ))}
              </div>
            </div>
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
              onClick={() => handlePick({ key: `community:${wl.id}`, name: wl.name })} />
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
                  aria-label="New watchlist name"
                  value={newName}
                  maxLength={60}
                  autoFocus
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') closeCreate() }}
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
                {createErr && <div className={styles.createErr} role="alert">{createErr}</div>}
                <div className={styles.createActions}>
                  <button type="button" className={styles.createCancel} onClick={closeCreate}>Cancel</button>
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
              <button type="button" className={styles.row} onClick={() => handlePick({ key: 'flagged', name: flaggedLabel })}>
                <span className={styles.rowIcon}><UIcon name="flag" size={13} gold={false} /></span>
                <span className={styles.rowName}>{flaggedLabel}</span>
                {flagged?.length != null && <span className={styles.rowCount}>{flagged.length}</span>}
              </button>
            )}
            {mine.map(wl => (
              <div key={`m${wl.id}`} className={styles.mineRow}>
                <button type="button" className={styles.row} onClick={() => handlePick({ key: `user:${wl.id}`, name: wl.name })}>
                  <span className={styles.rowIcon}><UIcon name="library" size={13} gold={false} /></span>
                  <span className={styles.rowName}>{wl.name}</span>
                  {countOf(wl) != null && <span className={styles.rowCount}>{countOf(wl)}</span>}
                </button>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  title={`Delete ${wl.name}`}
                  aria-label={`Delete ${wl.name}`}
                  disabled={deletingId === wl.id}
                  onClick={() => handleDelete(wl)}
                >
                  <UIcon name="trash" size={12} gold={false} />
                </button>
              </div>
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
