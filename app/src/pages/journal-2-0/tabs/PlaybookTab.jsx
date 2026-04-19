/**
 * Playbook / Stock Observation Library — user-saved interesting
 * stocks with screenshots, thesis, levels, status.
 */

import { useMemo, useState } from 'react'
import useJ2Playbook from '../hooks/useJ2Playbook'
import PlaybookEntryModal from '../components/playbook/PlaybookEntryModal'
import styles from './PlaybookTab.module.css'

const STATUS_ORDER = ['watching', 'triggered', 'traded', 'passed', 'dead']
const STATUS_LABEL = {
  watching: '👀 Watching',
  triggered: '⚡ Triggered',
  traded: '📈 Traded',
  passed: '⏭ Passed',
  dead: '💀 Dead',
}

export default function PlaybookTab() {
  const [filterStatus, setFilterStatus] = useState('all')
  const [symbolQuery, setSymbolQuery] = useState('')
  const [editTarget, setEditTarget] = useState(null) // entry object, or 'new'

  const { entries, isLoading, error, refresh } = useJ2Playbook({
    status: filterStatus === 'all' ? null : filterStatus,
  })

  const filtered = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase()
    return q ? entries.filter((e) => e.symbol.startsWith(q)) : entries
  }, [entries, symbolQuery])

  const counts = useMemo(() => {
    const c = { all: entries.length }
    for (const s of STATUS_ORDER) c[s] = 0
    for (const e of entries) if (c[e.status] != null) c[e.status] += 1
    return c
  }, [entries])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Playbook Library</h2>
          <p className={styles.subtitle}>
            Save interesting stocks you see — screenshots, thesis, levels,
            status. Turn ideas into trades when they trigger.
          </p>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={() => setEditTarget('new')}
        >
          + New Entry
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Couldn't load playbook: {String(error.message || error)}
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          type="text"
          value={symbolQuery}
          onChange={(e) => setSymbolQuery(e.target.value)}
          placeholder="Search by symbol…"
          className={styles.searchInput}
        />
        <div className={styles.statusPills}>
          <button
            type="button"
            className={`${styles.statusPill} ${filterStatus === 'all' ? styles.statusPillActive : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            All ({counts.all})
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.statusPill} ${filterStatus === s ? styles.statusPillActive : ''}`}
              onClick={() => setFilterStatus(s)}
            >
              {STATUS_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>
      </div>

      {isLoading && entries.length === 0 ? (
        <p className={styles.hint}>Loading playbook…</p>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {entries.length === 0 ? (
            <>
              <p>No playbook entries yet.</p>
              <p className={styles.emptyHint}>
                Click <strong>+ New Entry</strong> to save your first interesting
                stock, or right-click any chart anywhere in the dashboard → "Save
                to Playbook".
              </p>
            </>
          ) : (
            <p>No entries match your filter.</p>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((e) => (
            <EntryCard key={e.id} entry={e} onClick={() => setEditTarget(e)} />
          ))}
        </div>
      )}

      {editTarget && (
        <PlaybookEntryModal
          entry={editTarget === 'new' ? null : editTarget}
          onClose={() => { setEditTarget(null); refresh() }}
        />
      )}
    </div>
  )
}

function EntryCard({ entry, onClick }) {
  const firstImage = entry.attachments.find((a) => a.kind === 'image')
  const levelParts = []
  if (entry.levels?.trigger) levelParts.push(`T ${entry.levels.trigger}`)
  if (entry.levels?.stop) levelParts.push(`S ${entry.levels.stop}`)
  if (entry.levels?.target) levelParts.push(`✓ ${entry.levels.target}`)
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      {firstImage ? (
        <div className={styles.thumb}>
          <img src={firstImage.url} alt="" />
        </div>
      ) : (
        <div className={styles.thumbPlaceholder}>
          <span>{entry.symbol}</span>
        </div>
      )}
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.cardSymbol}>{entry.symbol}</span>
          <span className={`${styles.cardStatus} ${styles[`status_${entry.status}`]}`}>
            {STATUS_LABEL[entry.status]}
          </span>
        </div>
        <div className={styles.cardMeta}>
          {entry.observedDate} {entry.setup ? `· ${entry.setup}` : ''}
        </div>
        {entry.thesis && (
          <p className={styles.cardThesis}>{entry.thesis}</p>
        )}
        {levelParts.length > 0 && (
          <div className={styles.cardLevels}>{levelParts.join(' · ')}</div>
        )}
      </div>
    </button>
  )
}
