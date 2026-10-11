// ── UCT Agent History: the whole panel becomes the member's chat history ───────────
//
// A full-width "Search history" bar on top (every word, any order, across ALL of the member's
// own chats, server-side); below it the chats — Pinned, Today, Yesterday, Previous 7 days,
// Previous 30 days, Older. A row opens its chat; hover shows Pin, Rename and Delete. Rename edits
// in place; Delete asks in place (no browser dialog). A search hit opens its chat AT that message.

import { useEffect, useRef, useState } from 'react'
import { HeadIcon, AgentAvatar, MemberAvatar, SenderLine, Hl } from './agentUi'
import { groupConversations, whenShort, groupHits } from './historyGroups'
import { snippet } from './chatSearch'
import { renameConversation, pinConversation, deleteConversation, searchHistory } from './agentClient'
import styles from './AgentPanel.module.css'

const SEARCH_DEBOUNCE_MS = 180

function Row({ c, current, onOpen, onChanged, onDeleted }) {
  const [mode, setMode] = useState(null)          // null | 'rename' | 'delete'
  const [name, setName] = useState(c.title)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (mode === 'rename') inputRef.current?.select() }, [mode])

  const saveName = async () => {
    const t = name.trim()
    if (!t || t === c.title) { setMode(null); setName(c.title); return }
    const r = await renameConversation(c.id, t)
    if (r.ok) { setMode(null); setError(''); onChanged() } else setError(r.error)
  }
  const togglePin = async () => { const r = await pinConversation(c.id, !c.pinned_at); if (r.ok) onChanged(); else setError(r.error) }
  const remove = async () => { const r = await deleteConversation(c.id); if (r.ok) onDeleted(c.id); else setError(r.error) }

  if (mode === 'delete') {
    return (
      <div className={`${styles.hRow} ${styles.hConfirm}`} role="alertdialog" aria-label={`Delete ${c.title}?`}>
        <span className={styles.hConfirmText}>Delete <b>{c.title}</b>? This can’t be undone.</span>
        <span className={styles.hConfirmActions}>
          <button type="button" className={styles.ghost} onClick={() => setMode(null)}>Cancel</button>
          <button type="button" className={styles.danger} onClick={remove} autoFocus>Delete</button>
        </span>
      </div>
    )
  }
  if (mode === 'rename') {
    return (
      <div className={`${styles.hRow} ${styles.hEditing}`}>
        <input ref={inputRef} className={styles.hRename} value={name} maxLength={60} aria-label="Chat name"
          onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveName() }
            if (e.key === 'Escape') { e.preventDefault(); setMode(null); setName(c.title) }
          }} />
        {error && <span className={styles.hError}>{error}</span>}
      </div>
    )
  }
  return (
    <div className={`${styles.hRow} ${current ? styles.hCurrent : ''}`}>
      <button type="button" className={styles.hOpen} onClick={() => onOpen(c.id)} title={c.title}>
        {c.pinned_at && <span className={styles.hPinMark} aria-label="Pinned"><HeadIcon name="pin" /></span>}
        <span className={styles.hTitle}>{c.title}</span>
        <span className={styles.hWhen}>{whenShort(c.updated_at)}</span>
      </button>
      <span className={styles.hActions}>
        <button type="button" className={styles.hAct} data-tip={c.pinned_at ? 'Unpin' : 'Pin'} aria-label={c.pinned_at ? `Unpin ${c.title}` : `Pin ${c.title}`} onClick={togglePin}><HeadIcon name={c.pinned_at ? 'unpin' : 'pin'} /></button>
        <button type="button" className={styles.hAct} data-tip="Rename" aria-label={`Rename ${c.title}`} onClick={() => setMode('rename')}><HeadIcon name="edit" /></button>
        <button type="button" className={`${styles.hAct} ${styles.hActDanger}`} data-tip="Delete" aria-label={`Delete ${c.title}`} onClick={() => setMode('delete')}><HeadIcon name="trash" /></button>
      </span>
      {error && <span className={styles.hError}>{error}</span>}
    </div>
  )
}

export default function AgentHistory({ conversations, loading, currentId, member, onOpen, onRefresh, onDeleted, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)     // null = not searching
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  // Server search across every chat, debounced; the newest answer wins.
  useEffect(() => {
    const q = query.trim()
    let live = true
    const t = setTimeout(async () => {
      const r = q ? await searchHistory(q) : null
      if (live) { setResults(r); setActive(0) }
    }, q ? SEARCH_DEBOUNCE_MS : 0)
    return () => { live = false; clearTimeout(t) }
  }, [query])
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  const groups = groupHits(results || [])
  const flat = groups.flatMap(g => g.hits)                  // on-screen order: ↑ ↓ walk the list as drawn
  const order = new Map(flat.map((h, i) => [h.id, i]))
  const pick = (h) => onOpen(h.conversation_id, `h${h.id}`)

  return (
    <div className={styles.historyView} data-testid="agent-history">
      <div className={styles.hSearch}>
        <span className={styles.searchIcon}><HeadIcon name="search" /></span>
        <input ref={inputRef} className={styles.searchInput} value={query} placeholder="Search history" aria-label="Search history"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); if (query) setQuery(''); else onClose() }
            else if (e.key === 'ArrowDown' && flat.length) { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)) }
            else if (e.key === 'ArrowUp' && flat.length) { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); pick(flat[active]) }
          }} />
        {query && <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus() }}><HeadIcon name="close" /></button>}
      </div>

      {results ? (
        flat.length ? (
          <div className={styles.searchResults} ref={listRef} role="listbox" aria-label="History search results">
            <div className={styles.searchCount}>{flat.length} {flat.length === 1 ? 'result' : 'results'} in {groups.length} {groups.length === 1 ? 'chat' : 'chats'}</div>
            {groups.map(g => (
              <div key={g.id} className={styles.hHitGroup}>
                <div className={styles.hHitChat}><HeadIcon name="history" /><span>{g.title}</span></div>
                {g.hits.map(h => {
                  const i = order.get(h.id)
                  const mine = h.role === 'member'
                  return (
                    <button key={h.id} type="button" role="option" aria-selected={i === active} data-idx={i}
                      className={`${styles.searchHit} ${i === active ? styles.searchHitOn : ''}`}
                      onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                      {mine ? <MemberAvatar id={member.id} /> : <AgentAvatar />}
                      <span className={styles.searchBody}>
                        <SenderLine name={mine ? member.name : 'UCT Agent'} at={h.created_at * 1000} />
                        <span className={styles.searchText}><Hl text={snippet(h.text, query)} query={query} /></span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.searchEmpty}><span>Nothing in your history matches “{query.trim()}”</span><small>Try fewer or different words.</small></div>
        )
      ) : loading && !conversations.length ? (
        <div className={styles.searchEmpty}><small>Loading your chats…</small></div>
      ) : !conversations.length ? (
        <div className={styles.searchEmpty}><HeadIcon name="history" /><span>No conversations yet</span><small>Your chats with UCT Agent will show up here.</small></div>
      ) : (
        <div className={styles.hList}>
          {groupConversations(conversations).map(g => (
            <section key={g.label} className={styles.hGroup}>
              <h3 className={styles.hGroupLabel}>{g.label}</h3>
              {g.items.map(c => (
                <Row key={`${c.id}:${c.title}:${c.pinned_at || 0}`} c={c} current={c.id === currentId}
                  onOpen={(id) => onOpen(id)} onChanged={onRefresh} onDeleted={onDeleted} />
              ))}
            </section>
          ))}
        </div>
      )}
      {results && flat.length > 0 && (
        <div className={styles.searchKeys}><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open at message <kbd>esc</kbd> clear</div>
      )}
    </div>
  )
}
