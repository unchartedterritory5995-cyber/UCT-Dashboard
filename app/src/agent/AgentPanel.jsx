// ── UCT Agent panel: the far-right workspace column on /charts ──────────────
//
// Native app chrome: every color is an app token (var(--bg-surface) …), so it
// follows Graphite / OLED / Light / every UCT App Theme with no theme of its own.
//
// Keys typed here never reach the charts: the panel root stops keydown/keyup/
// keypress propagation (the Create Indicator panel's measured lesson — chart
// shortcuts listen at the document and would otherwise eat "B", "W", Delete…).

import { useEffect, useRef, useState } from 'react'
import useAgent from './useAgent'
import { agentConversations } from './agentClient'
import VoiceInputButton from '../pages/journal-2-0/components/VoiceInputButton'
import styles from './AgentPanel.module.css'

const SUGGESTIONS = [
  'Change this chart to bars, switch it to weekly, and hide Volume',
  'What is the difference between an EMA and an SMA?',
  'Why is NVDA moving today?',
]

function Paragraphs({ text }) {
  return String(text || '').split(/\n{2,}/).map((p, i) => (
    <p key={i} className={styles.para}>{p.split('\n').map((l, j) => (j ? [<br key={j} />, l] : l))}</p>
  ))
}

function Item({ it, agent }) {
  switch (it.role) {
    case 'member':
      return <div className={styles.memberRow}><div className={styles.member}>{it.voice && <span className={styles.voiceMark} aria-label="spoken">🎙 </span>}{it.text}</div></div>
    case 'agent':
      return (
        <div className={styles.agent}>
          <Paragraphs text={it.text} />
          {it.sources?.length > 0 && (
            <div className={styles.sources}>
              {it.sources.slice(0, 5).map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noreferrer noopener">{(() => { try { return new URL(s).hostname.replace(/^www\./, '') } catch { return 'source' } })()}</a>
              ))}
            </div>
          )}
        </div>
      )
    case 'question':
      return (
        <div className={styles.agent} data-testid="agent-question">
          <Paragraphs text={it.text} />
          {it.choices?.length > 0 && (
            <div className={styles.choices}>
              {it.choices.map((c, i) => (
                <button key={i} type="button" className={styles.choice}
                  onClick={() => (c.ref ? agent.chooseTarget(c.ref, c.label) : agent.send(c.label, { answering: true }))}>{c.label}</button>
              ))}
            </div>
          )}
        </div>
      )
    case 'proposal':
      return (
        <div className={styles.card} data-testid="agent-proposal" data-status={it.status}>
          <div className={styles.cardHead}>Proposed changes</div>
          <ul className={styles.lines}>{(it.lines || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
          {it.status === 'pending' ? (
            <div className={styles.cardActions}>
              <button type="button" className={styles.primary} onClick={agent.approve}>Apply</button>
              <button type="button" className={styles.ghost} onClick={agent.dismiss}>Dismiss</button>
            </div>
          ) : <div className={styles.cardMeta}>{it.status === 'approved' ? 'Approved' : it.status === 'replaced' ? 'Replaced' : 'Dismissed'}</div>}
        </div>
      )
    case 'receipt':
      return (
        <div className={`${styles.card} ${styles.receipt}`} data-testid="agent-receipt">
          <div className={styles.receiptLines}>{(it.lines || []).join(' · ')}</div>
          {it.notes?.length > 0 && <div className={styles.cardMeta}>{it.notes.join(' · ')}</div>}
          {it.undoId && (it.undone
            ? <div className={styles.cardMeta}>Undone</div>
            : agent.canUndo(it.undoId) && (
              <div className={styles.cardActions}>
                <button type="button" className={styles.ghost} onClick={() => agent.undo(it.undoId)} data-testid="agent-undo">Undo</button>
              </div>
            ))}
        </div>
      )
    case 'refusal':
    case 'error':
      return <div className={styles.refusal} role="status"><Paragraphs text={it.text} /></div>
    default:
      return <div className={styles.outcome}>{it.text}</div>
  }
}

export default function AgentPanel({ host, gridMode, onClose }) {
  const agent = useAgent({ host, gridMode })
  const [text, setText] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState([])
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agent.items.length, agent.busy])

  const submit = () => {
    const t = text.trim()
    if (!t || agent.busy) return
    setText('')
    agent.send(t)
  }

  const openHistory = async () => {
    const n = !historyOpen
    setHistoryOpen(n)
    if (n) setHistory(await agentConversations())
  }

  const stop = (e) => e.stopPropagation()

  return (
    <aside className={styles.panel} aria-label="UCT Agent" data-testid="agent-panel"
      onKeyDown={stop} onKeyUp={stop} onKeyPress={stop}>
      <header className={styles.head}>
        <span className={styles.title}>UCT Agent</span>
        <span className={styles.badge}>Admin preview</span>
        <span className={styles.headSpacer} />
        <button type="button" className={styles.iconBtn} title="New chat" aria-label="New chat"
          onClick={() => { setHistoryOpen(false); agent.newChat(); inputRef.current?.focus() }}>＋</button>
        <button type="button" className={styles.iconBtn} title="Conversation history" aria-label="Conversation history"
          aria-expanded={historyOpen} onClick={openHistory}>☰</button>
        <button type="button" className={styles.iconBtn} title="Close" aria-label="Close UCT Agent" onClick={onClose}>✕</button>
      </header>

      {historyOpen && (
        <div className={styles.history} data-testid="agent-history">
          {history.length === 0 && <div className={styles.outcome}>No conversations yet.</div>}
          {history.map(c => (
            <button key={c.id} type="button" className={`${styles.historyItem} ${c.id === agent.conversationId ? styles.historyActive : ''}`}
              onClick={() => { setHistoryOpen(false); agent.openConversation(c.id) }}>
              <span className={styles.historyTitle}>{c.title}</span>
              <span className={styles.historyWhen}>{new Date(c.updated_at * 1000).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.list} ref={listRef} data-testid="agent-transcript">
        {agent.items.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.para}>Ask a question, or tell me what to change on your charts.</p>
            <div className={styles.choices}>
              {SUGGESTIONS.map(s => <button key={s} type="button" className={styles.choice} onClick={() => agent.send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {agent.items.map(it => <Item key={it.id} it={it} agent={agent} />)}
        {agent.busy && <div className={styles.thinking} aria-live="polite">Working…</div>}
      </div>

      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={2}
          value={text}
          placeholder="Ask or tell UCT Agent…"
          aria-label="Message UCT Agent"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
        <div className={styles.composerRow}>
          <VoiceInputButton
            disabled={agent.busy}
            holdOnFailure
            hintInFlow
            onTranscript={(t) => {
              const said = String(t || '').trim()
              if (said) agent.send(said, { voice: true })
            }}
          />
          <span className={styles.headSpacer} />
          <button type="button" className={styles.primary} disabled={!text.trim() || agent.busy} onClick={submit}>Send</button>
        </div>
      </div>
    </aside>
  )
}
