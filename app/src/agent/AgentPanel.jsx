// ── UCT Agent panel: the far-right workspace column on /charts ──────────────
//
// Native app chrome: every color is an app token (var(--bg-surface) …), so it
// follows Graphite / OLED / Light / every UCT App Theme with no theme of its own.
//
// Keys typed here never reach the charts: the panel root stops keydown/keyup/
// keypress propagation (the Create Indicator panel's measured lesson — chart
// shortcuts listen at the document and would otherwise eat "B", "W", Delete…).

import { useContext, useEffect, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import useAgent from './useAgent'
import { AuthContext } from '../context/AuthContext'
import { readLocal, writeLocal } from './agentFlag'
import { quickReplies } from './quickReplies'
import { continues } from './chatTime'
import { searchChat, snippet } from './chatSearch'
import { agentConversations } from './agentClient'
import AgentHistory from './AgentHistory'
import VoiceInputButton from '../pages/journal-2-0/components/VoiceInputButton'
import compassMark from '../components/intro/assets/compass-mark.png'
import { HeadIcon, AgentAvatar, MemberAvatar, SenderLine, Hl } from './agentUi'
import styles from './AgentPanel.module.css'

// Welcome: the Agent's first text — a moment of "typing", then a left-side bubble stamped with
// the time the chat opened, and a few quick replies (a tap sends that text as-is).
const readCharts = (host) => { try { return host?.charts?.list?.() || [] } catch { return [] } }
const TYPING_MS = 900
const SHORT_TYPING_MS = 600
// The full welcome plays ONCE per account on this browser; after that a new chat gets a short,
// personal greeting. (Per browser: a new device sees the full welcome once more.)
const welcomedKey = (memberId) => `uct.agent.welcomed.${memberId ?? 'anon'}`
function dayGreeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

// ⚠ FUTURE-FACING BY OWNER DECISION (2026-10-10): the welcome describes the FINISHED Agent —
// every roadmap stage (docs/agent/ROADMAP.md: history, backtesting, screenshot rebuilds,
// similar-chart search, all of UCT) plus owner-named goals (trade review), owner-written copy 2026-10-10, not only what
// ships today. Members see it only once the
// Agent is complete, so it is written for that day. Do NOT trim it to today's abilities;
// before member rollout, check each line is true.
const CAN_DO = [
  ['Research & Analyze', 'Explore stocks, market trends, technical setups, and price action.'],
  ['Scan & Discover', 'Find trading opportunities based on your own criteria.'],
  ['Build Indicators', 'Create and customize indicators using plain English.'],
  ['Develop & Backtest', 'Turn trading ideas into strategies and test them against historical data.'],
  ['Manage Your Workspace', 'Customize charts, layouts, watchlists, and settings.'],
  ['Monitor & Alert', 'Track stocks, market conditions, and important price levels.'],
  ['Review & Improve', 'Analyze your trades and uncover ways to improve your trading.'],
]

// The member's side of the thread: their display name and profile photo (Settings → avatar).
// /api/auth/avatar/<id> answers a 1×1 transparent pixel when none is set, so a ≤2 px image falls
// back to the default avatar. No AuthProvider (isolated tests) = "User" + default avatar.
function useMember() {
  const user = useContext(AuthContext)?.user
  return { id: user?.id ?? null, name: (user?.display_name || '').trim() || 'User' }
}

function AgentSays({ children, testId, at, cont }) {
  return (
    <div className={`${styles.agentRow} ${cont ? styles.cont : ''}`} data-testid={testId}>
      {cont ? <span className={styles.avatarGap} aria-hidden="true" /> : <AgentAvatar />}
      <div className={styles.agentCol}>
        {!cont && <SenderLine name="UCT Agent" at={at} />}
        {children}
      </div>
    </div>
  )
}

function Welcome({ host, quiet, empty, onPick, full, animate, firstName, onShown, onTyping }) {
  const [at] = useState(() => new Date())
  const [replies, setReplies] = useState(() => quickReplies(readCharts(host)))
  // Charts register a moment after the panel mounts: re-read until the board has one (≤ 5 s).
  useEffect(() => {
    if (readCharts(host).length) { setReplies(quickReplies(readCharts(host))); return undefined }
    let n = 0
    const t = setInterval(() => {
      const c = readCharts(host)
      if (c.length || ++n >= 10) { clearInterval(t); setReplies(quickReplies(c)) }
    }, 500)
    return () => clearInterval(t)
  }, [host])
  const [typing, setTyping] = useState(() => !!animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (!typing) return undefined
    const t = setTimeout(() => setTyping(false), full ? TYPING_MS : SHORT_TYPING_MS)
    return () => clearTimeout(t)
  }, [typing, full])
  useEffect(() => { onTyping?.(typing) }, [typing]) // eslint-disable-line react-hooks/exhaustive-deps
  // Seen once it's on screen (not when it merely started typing).
  useEffect(() => { if (!typing) onShown?.() }, [typing]) // eslint-disable-line react-hooks/exhaustive-deps
  // While "typing", the line above the composer says so; the bubble arrives whole.
  if (typing) return null
  return (
    <div className={styles.welcome} data-testid="agent-welcome">
      <div className={styles.agentRow}>
        <AgentAvatar />
        <div className={styles.agentCol}>
          <SenderLine name="UCT Agent" at={at.getTime()} />
          {(
            <>
              {full ? (
                <div className={styles.bubble}>
                  <p className={styles.para}><b className={styles.lead}>Hey, I’m UCT Agent. 👋</b></p>
                  <p className={styles.para}>Think of me as your personal, full-time trading assistant. I’m here to help you research, analyze, build, and manage your trading workflow—all in one place.</p>
                  <p className={styles.para}><b className={styles.lead}>Here’s what I can help you with:</b></p>
                  <ul className={styles.canDo}>{CAN_DO.map(([lead, text]) => <li key={lead}><b>{lead}</b> — {text}</li>)}</ul>
                  <p className={styles.para}><b className={styles.lead}>You focus on trading. I’ll handle the heavy lifting.</b></p>
                  <p className={styles.para}>What can I help you with today?</p>
                </div>
              ) : (
                <div className={styles.bubble}>
                  <p className={styles.para}>{dayGreeting(at)}{firstName ? `, ${firstName}` : ''}. What can I help you with?</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {empty && (
        <div className={`${styles.quick} ${quiet ? styles.quickQuiet : ''}`} aria-hidden={quiet || undefined}>
          {replies.map(q => <button key={q} type="button" className={styles.quickReply} tabIndex={quiet ? -1 : undefined} onClick={() => onPick(q)}>{q}</button>)}
        </div>
      )}
    </div>
  )
}

function Paragraphs({ text }) {
  return String(text || '').split(/\n{2,}/).map((p, i) => (
    <p key={i} className={styles.para}>{p.split('\n').map((l, j) => (j ? [<br key={j} />, l] : l))}</p>
  ))
}

// A feature's structured result (e.g. Screener rows): exactly the rows it returned.
function ResultTable({ table }) {
  return (
    <div className={styles.resultWrap} data-testid="agent-result-table">
      <table className={styles.resultTable}>
        <thead><tr>{table.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={r[table.columns[0].key] ?? i}>{table.columns.map(c => <td key={c.key}>{r[c.key] ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Where the result lives in UCT (an in-app route); a plain link outside a router.
function OpenLink({ link }) {
  const inRouter = useInRouterContext()
  return inRouter
    ? <Link className={styles.openLink} to={link.href} data-testid="agent-open-link">{link.label}</Link>
    : <a className={styles.openLink} href={link.href} data-testid="agent-open-link">{link.label}</a>
}

function Item({ it, agent, member, at, cont }) {
  switch (it.role) {
    case 'member':
      return (
        <div className={`${styles.memberRow} ${cont ? styles.cont : ''}`}>
          <div className={styles.memberCol}>
            {!cont && <SenderLine name={member.name} at={at} right />}
            <div className={styles.member}>{it.voice && <span className={styles.voiceMark} aria-label="spoken">🎙 </span>}{it.text}</div>
          </div>
          {cont ? <span className={styles.avatarGap} aria-hidden="true" /> : <MemberAvatar id={member.id} />}
        </div>
      )
    case 'agent':
      return (
        <AgentSays at={at} cont={cont}>
          <div className={styles.bubble}><Paragraphs text={it.text} /></div>
          {it.table && <ResultTable table={it.table} />}
          {it.link && <OpenLink link={it.link} />}
          {it.sources?.length > 0 && (
            <div className={styles.sources}>
              {it.sources.slice(0, 5).map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noreferrer noopener">{(() => { try { return new URL(s).hostname.replace(/^www\./, '') } catch { return 'source' } })()}</a>
              ))}
            </div>
          )}
        </AgentSays>
      )
    case 'question':
      return (
        <AgentSays testId="agent-question" at={at} cont={cont}>
          <div className={styles.bubble}><Paragraphs text={it.text} /></div>
          {it.choices?.length > 0 && (
            <div className={styles.choices}>
              {it.choices.map((c, i) => (
                <button key={i} type="button" className={styles.choice} disabled={agent.busy}
                  onClick={() => (c.ref ? agent.chooseTarget(c.ref, c.label) : agent.send(c.label, { answering: true }))}>{c.label}</button>
              ))}
            </div>
          )}
        </AgentSays>
      )
    case 'proposal':
      return (
        <AgentSays at={at} cont={cont}>
        <div className={`${styles.bubble} ${styles.cardBubble}`} data-testid="agent-proposal" data-status={it.status}>
          <div className={styles.cardHead}>Proposed changes</div>
          <ul className={styles.lines}>{(it.lines || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
          {it.status === 'pending' ? (
            <div className={styles.cardActions}>
              <button type="button" className={styles.primary} onClick={agent.approve} disabled={agent.busy}>Apply</button>
              <button type="button" className={styles.ghost} onClick={agent.dismiss} disabled={agent.busy}>Dismiss</button>
            </div>
          ) : <div className={styles.cardMeta}>{it.status === 'approved' ? 'Approved' : it.status === 'replaced' ? 'Replaced' : it.status === 'expired' ? 'Expired — ask again' : 'Dismissed'}</div>}
        </div>
        </AgentSays>
      )
    case 'receipt':
      return (
        <AgentSays at={at} cont={cont}>
        <div className={`${styles.bubble} ${styles.cardBubble}`} data-testid="agent-receipt">
          <div className={styles.receiptLines}>{(it.lines || []).join(' · ')}</div>
          {it.notes?.length > 0 && <div className={styles.cardMeta}>{it.notes.join(' · ')}</div>}
          {it.undoId && (it.undone
            ? <div className={styles.cardMeta}>Undone</div>
            : agent.canUndo(it.undoId) && (
              <div className={styles.cardActions}>
                <button type="button" className={styles.ghost} onClick={() => agent.undo(it.undoId)} disabled={agent.busy} data-testid="agent-undo">Undo</button>
              </div>
            ))}
        </div>
        </AgentSays>
      )
    case 'refusal':
    case 'error':
      return <AgentSays at={at} cont={cont}><div className={`${styles.bubble} ${styles.refusal}`} role="status"><Paragraphs text={it.text} /></div></AgentSays>
    default:
      return <AgentSays at={at} cont={cont}><div className={styles.bubble}><Paragraphs text={it.text} /></div></AgentSays>
  }
}

function SearchResults({ results, query, active, setActive, onPick, member }) {
  const listRef = useRef(null)
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])
  if (!query.trim()) {
    return <div className={styles.searchEmpty}><HeadIcon name="search" /><span>Search this conversation</span><small>Find any word in your messages, the Agent’s replies, and its change cards.</small></div>
  }
  if (!results.length) {
    return <div className={styles.searchEmpty}><span>No messages match “{query.trim()}”</span><small>Try fewer or different words.</small></div>
  }
  return (
    <div className={styles.searchResults} ref={listRef} role="listbox" aria-label="Search results" data-testid="agent-search-results">
      <div className={styles.searchCount}>{results.length} {results.length === 1 ? 'result' : 'results'}</div>
      {results.map(({ it, text }, i) => {
        const mine = it.role === 'member'
        return (
          <button key={it.id} type="button" role="option" aria-selected={i === active} data-idx={i}
            className={`${styles.searchHit} ${i === active ? styles.searchHitOn : ''}`}
            onMouseEnter={() => setActive(i)} onClick={() => onPick(it.id)}>
            {mine ? <MemberAvatar id={member.id} /> : <AgentAvatar />}
            <span className={styles.searchBody}>
              <SenderLine name={mine ? member.name : 'UCT Agent'} at={it.at} />
              <span className={styles.searchText}><Hl text={snippet(text, query)} query={query} /></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function AgentPanel({ host, gridMode, onClose }) {
  const member = useMember()
  // A new chat greets afresh (typing, new timestamp); messages after the greeting keep it.
  const [chatEpoch, setChatEpoch] = useState(0)
  const [greetingTyping, setGreetingTyping] = useState(false)
  // First time ever (this account, this browser) → the full welcome, typed out. Afterwards a new
  // chat types a short greeting; reopening the panel shows the greeting at once (no replay).
  const [firstTime] = useState(() => readLocal(welcomedKey(member.id)) !== '1')
  const firstName = member.name === 'User' ? '' : member.name.split(/\s+/)[0]
  const agent = useAgent({ host, gridMode })
  const [text, setText] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const jumpRef = useRef(null)
  const searchRef = useRef(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const el = listRef.current
    if (el && !jumpRef.current) el.scrollTop = el.scrollHeight
  }, [agent.items.length, agent.busy])

  const results = searchOpen ? searchChat(agent.items, query) : []
  const closeSearch = () => { setSearchOpen(false); setQuery(''); setActive(0) }
  const openSearch = () => { setHistoryOpen(false); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0) }
  const pick = (id) => { jumpRef.current = id; closeSearch() }
  // Jump: once the transcript is back, centre the line and flash it.
  useEffect(() => {
    const id = jumpRef.current
    if (searchOpen || historyOpen || !id) return
    const el = listRef.current?.querySelector(`[data-item-id="${CSS.escape(id)}"]`)
    if (!el) return                                   // the chat is still loading: try again when it lands
    jumpRef.current = null
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove(styles.flash); void el.offsetWidth; el.classList.add(styles.flash)
  }, [searchOpen, historyOpen, agent.items])

  const submit = () => {
    const t = text.trim()
    if (!t || agent.busy) return
    setText('')
    agent.send(t)
  }

  const refreshHistory = async () => {
    setHistoryLoading(true)
    setHistory(await agentConversations())
    setHistoryLoading(false)
  }
  const openHistory = () => {
    const n = !historyOpen
    setHistoryOpen(n)
    if (n) { closeSearch(); refreshHistory() }
  }
  // Open a chat from History; with `jump`, land on that message (the transcript scrolls to it once loaded).
  const openFromHistory = (id, jump) => {
    setHistoryOpen(false)
    jumpRef.current = jump || null
    const here = id === agent.conversationId && (!jump || listRef.current?.querySelector(`[data-item-id="${CSS.escape(jump)}"]`))
    if (!here) agent.openConversation(id)
  }
  const historyDeleted = (id) => {
    refreshHistory()
    if (id === agent.conversationId) { agent.newChat(); setChatEpoch(n => n + 1) }
  }

  // The composer grows with what's typed (one line → at most ~6), then scrolls.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  const stop = (e) => e.stopPropagation()

  return (
    <aside className={styles.panel} aria-label="UCT Agent" data-testid="agent-panel"
      onKeyDown={stop} onKeyUp={stop} onKeyPress={stop}>
      {/* Contact row, like the top of a text thread: who you're talking to, and that they're there. */}
      <header className={styles.contact}>
        <span className={styles.avatar} aria-hidden="true"><img src={compassMark} alt="" /><i className={styles.online} /></span>
        <span className={styles.contactText}>
          <span className={styles.contactName}>UCT Agent</span>
          <span className={styles.contactStatus} aria-live="polite">
            {(agent.busy || greetingTyping)
              ? <span className={styles.typingNow}>typing<i /><i /><i /></span>
              : <span className={styles.onlineWord}>Online</span>}
          </span>
        </span>
        <span className={styles.headSpacer} />
        <button type="button" className={`${styles.iconBtn} ${searchOpen ? styles.iconOn : ''}`} data-tip="Search" aria-label="Search this chat"
          aria-expanded={searchOpen} onClick={() => (searchOpen ? closeSearch() : (setHistoryOpen(false), openSearch()))}><HeadIcon name="search" /></button>
        <button type="button" className={styles.iconBtn} data-tip="New chat" aria-label="New chat"
          onClick={() => { setHistoryOpen(false); closeSearch(); agent.newChat(); setChatEpoch(n => n + 1); inputRef.current?.focus() }}><HeadIcon name="new" /></button>
        <button type="button" className={`${styles.iconBtn} ${historyOpen ? styles.iconOn : ''}`} data-tip="History" aria-label="Conversation history"
          aria-expanded={historyOpen} onClick={openHistory}><HeadIcon name="history" /></button>
        <button type="button" className={styles.iconBtn} data-tip="Close" aria-label="Close UCT Agent" onClick={onClose}><HeadIcon name="close" /></button>
      </header>

      {searchOpen && !historyOpen && (
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}><HeadIcon name="search" /></span>
          <input ref={searchRef} className={styles.searchInput} value={query} placeholder="Search this chat…" aria-label="Search this chat"
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(results.length - 1, 0))) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
              else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active].it.id) }
            }} />
          {query && <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus() }}><HeadIcon name="close" /></button>}
        </div>
      )}

      {historyOpen && (
        <AgentHistory conversations={history} loading={historyLoading} currentId={agent.conversationId} member={member}
          onOpen={openFromHistory} onRefresh={refreshHistory} onDeleted={historyDeleted} onClose={() => setHistoryOpen(false)} />
      )}

      <div className={styles.stage} hidden={historyOpen}>
      <div className={styles.list} ref={listRef} data-testid="agent-transcript">
        {agent.restoring && <div className={styles.thinking} aria-live="polite" data-testid="agent-restoring">Loading this conversation…</div>}
        {/* The greeting opens every chat started here; a reopened past conversation starts at its own history. */}
        {!agent.restoring && !agent.items[0]?.history && (
          <Welcome key={chatEpoch} host={host} quiet={!!text.trim()} empty={agent.items.length === 0} onPick={(p) => agent.send(p)}
            full={firstTime && chatEpoch === 0} animate={firstTime || chatEpoch > 0} firstName={firstName}
            onShown={() => writeLocal(welcomedKey(member.id), '1')} onTyping={setGreetingTyping} />
        )}
        {agent.items.map((it, i) => (
          <div key={it.id} data-item-id={it.id} className={styles.itemWrap}>
            <Item it={it} agent={agent} member={member} at={it.at} cont={continues(agent.items[i - 1], it)} />
          </div>
        ))}
      </div>
      {searchOpen && (
        <div className={styles.searchLayer}>
          <SearchResults results={results} query={query} active={active} setActive={setActive} onPick={pick} member={member} />
          {results.length > 0 && (
            <div className={styles.searchKeys}><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> jump to message <kbd>esc</kbd> close</div>
          )}
        </div>
      )}
      </div>

      {/* iMessage-style composer: one rounded bar — the text grows from one line, mic and send inside. */}
      <div className={styles.composer} hidden={historyOpen}>
        {/* Discord-style: who's typing, just above the bar (never shifts the layout). */}
        {(agent.busy || greetingTyping) && (
          <div className={styles.typingLine} role="status" aria-live="polite" data-testid="agent-typing">
            <span className={styles.typingDots} aria-hidden="true"><i /><i /><i /></span>
            <span><b>UCT Agent</b> is typing…</span>
          </div>
        )}
        <div className={styles.bar}>
          <textarea
            ref={inputRef}
            className={styles.input}
            rows={1}
            value={text}
            placeholder="Ask or tell UCT Agent…"
            aria-label="Message UCT Agent"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
          />
          <span className={styles.micSlot}>
            <VoiceInputButton
              disabled={agent.busy}
              holdOnFailure
              onTranscript={(t) => {
                const said = String(t || '').trim()
                if (said) agent.send(said, { voice: true })
              }}
            />
          </span>
          <button type="button" className={styles.sendBtn} aria-label="Send" title="Send (Enter)"
            disabled={!text.trim() || agent.busy} onClick={submit}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
          </button>
        </div>
        <div className={styles.hint}>Enter to send · Shift + Enter for a new line</div>
      </div>
    </aside>
  )
}
