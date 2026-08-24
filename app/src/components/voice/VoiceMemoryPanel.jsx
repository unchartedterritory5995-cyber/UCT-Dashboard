import { useState } from 'react'
import useVoiceMemory from '../../hooks/useVoiceMemory'
import styles from './VoiceMemoryPanel.module.css'

const CATEGORIES = [
  { value: 'preference', label: 'Preference' },
  { value: 'account_alias', label: 'Account alias' },
  { value: 'style', label: 'Trading style' },
  { value: 'fact', label: 'Fact' },
  { value: 'general', label: 'General' },
]

export default function VoiceMemoryPanel() {
  const { facts, summaries, loading, errorMsg, addFact, deleteFact } = useVoiceMemory()
  const [newText, setNewText] = useState('')
  const [newCategory, setNewCategory] = useState('general')

  const onAdd = async (e) => {
    e.preventDefault()
    const text = newText.trim()
    if (!text) return
    const ok = await addFact(text, newCategory)
    if (ok) {
      setNewText('')
      setNewCategory('general')
    }
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>What UCT remembers about you</h3>
      <p className={styles.subtitle}>
        Facts you teach the assistant get injected into every future conversation.
        It can also save these itself when you say "remember that…".
      </p>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}

      <form className={styles.addRow} onSubmit={onAdd}>
        <input
          type="text"
          className={styles.input}
          placeholder="e.g. I trade small caps under $5B market cap"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <select
          className={styles.select}
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="submit" className={styles.addBtn} disabled={!newText.trim()}>
          Add
        </button>
      </form>

      <div className={styles.factsList}>
        {loading && <div className={styles.empty}>Loading…</div>}
        {!loading && facts.length === 0 && (
          <div className={styles.empty}>
            No saved facts yet. Try saying "remember that I trade small caps" in a voice session.
          </div>
        )}
        {facts.map((f) => (
          <div key={f.id} className={styles.factRow}>
            <span className={styles.factCategory}>{f.category}</span>
            <span className={styles.factText}>{f.text}</span>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => deleteFact(f.id)}
              aria-label="Delete fact"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <h4 className={styles.subhead}>Recent conversation summaries</h4>
      <div className={styles.summariesList}>
        {summaries.length === 0 && (
          <div className={styles.empty}>No summaries yet. Have a conversation with UCT and one will appear here.</div>
        )}
        {summaries.slice(0, 10).map((s) => (
          <div key={s.id} className={styles.summaryRow}>
            <div className={styles.summaryText}>{s.summary_text}</div>
            {Array.isArray(s.key_topics) && s.key_topics.length > 0 && (
              <div className={styles.summaryTopics}>
                {s.key_topics.map((t, i) => <span key={i} className={styles.topic}>{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
