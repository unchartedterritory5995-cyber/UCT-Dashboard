// app/src/pages/journal/tabs/Playbooks.jsx
import { useState, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
import StatCard from '../components/StatCard'
import ResourceEditor from '../components/ResourceEditor'
import styles from './Playbooks.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const FORM_FIELDS = [
  { key: 'description', label: 'Description', type: 'textarea', placeholder: 'What is this setup? When does it occur?', full: true },
  { key: 'market_condition', label: 'Market Condition', type: 'textarea', placeholder: 'What market conditions favor this setup?' },
  { key: 'trigger_criteria', label: 'Trigger Criteria', type: 'textarea', placeholder: 'What must happen to trigger an entry?' },
  { key: 'invalidations', label: 'Invalidations', type: 'textarea', placeholder: 'What would invalidate this setup?' },
  { key: 'entry_model', label: 'Entry Model', type: 'textarea', placeholder: 'How exactly do you enter? Limit/market, timing...' },
  { key: 'exit_model', label: 'Exit Model', type: 'textarea', placeholder: 'How do you manage exits? Trailing stops, targets...' },
  { key: 'sizing_rules', label: 'Sizing Rules', type: 'textarea', placeholder: 'Position sizing: % of account, max risk per trade...' },
  { key: 'common_mistakes', label: 'Common Mistakes', type: 'textarea', placeholder: 'Pitfalls you have experienced with this setup...' },
  { key: 'best_practices', label: 'Best Practices', type: 'textarea', placeholder: 'Key rules that make this setup work best...' },
  { key: 'ideal_time', label: 'Ideal Time', type: 'text', placeholder: 'e.g., First 30min, midday, power hour...' },
  { key: 'ideal_volatility', label: 'Ideal Volatility', type: 'text', placeholder: 'e.g., Low VIX, expanding range, quiet tape...' },
]

export default function Playbooks({ onOpenTrade }) {
  const [view, setView] = useState('playbooks') // 'playbooks' | 'resources'
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef(null)

  const { data: playbooks, error, isLoading, mutate: mutateList } = useSWR(
    '/api/journal/playbooks',
    fetcher,
    { refreshInterval: 120000, dedupingInterval: 30000, revalidateOnFocus: false }
  )

  // Fetch selected playbook detail
  const { data: detail, mutate: mutateDetail } = useSWR(
    selectedId ? `/api/journal/playbooks/${selectedId}` : null,
    fetcher,
    { dedupingInterval: 5000, revalidateOnFocus: false }
  )

  // Fetch linked trades for selected playbook
  const { data: linkedTrades } = useSWR(
    selectedId ? `/api/journal/playbooks/${selectedId}/trades` : null,
    fetcher,
    { dedupingInterval: 15000, revalidateOnFocus: false }
  )

  // Auto-save handler
  const handleFieldChange = useCallback((key, value) => {
    if (!selectedId) return

    // Optimistic update
    mutateDetail(prev => prev ? { ...prev, [key]: value } : prev, false)

    setSaving(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/journal/playbooks/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        })
        mutateDetail()
        mutateList()
      } catch (err) {
        console.error('Save playbook field failed:', err)
      } finally {
        setSaving(false)
      }
    }, 600)
  }, [selectedId, mutateDetail, mutateList])

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Create new playbook
  const handleCreate = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/journal/playbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Playbook' }),
      })
      if (!res.ok) throw new Error(res.status)
      const pb = await res.json()
      mutateList()
      setSelectedId(pb.id)
    } catch (err) {
      console.error('Create playbook failed:', err)
    } finally {
      setCreating(false)
    }
  }, [mutateList])

  // Delete playbook
  const handleDelete = useCallback(async () => {
    if (!selectedId) return
    if (!window.confirm('Are you sure? This cannot be undone.')) return
    try {
      await fetch(`/api/journal/playbooks/${selectedId}`, { method: 'DELETE' })
      setSelectedId(null)
      mutateList()
    } catch (err) {
      console.error('Delete playbook failed:', err)
    }
  }, [selectedId, mutateList])

  const pbList = playbooks || []
  const trades = Array.isArray(linkedTrades) ? linkedTrades : (linkedTrades?.trades || [])

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>
          Failed to load playbooks. Check your connection.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Sub-tab toggle: Playbooks | Resources */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.viewBtn} ${view === 'playbooks' ? styles.viewBtnActive : ''}`}
          onClick={() => setView('playbooks')}
        >
          Playbooks
        </button>
        <button
          className={`${styles.viewBtn} ${view === 'resources' ? styles.viewBtnActive : ''}`}
          onClick={() => setView('resources')}
        >
          Resources
        </button>
      </div>

      {/* Resources view */}
      {view === 'resources' && (
        <div className={styles.resourcesPanel}>
          <ResourceEditor />
        </div>
      )}

      {/* Playbooks view */}
      {view === 'playbooks' && <>
      {/* Left sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Playbooks</span>
          <button
            className={styles.newBtn}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? '...' : '+ New'}
          </button>
        </div>

        <div className={styles.pbList}>
          {isLoading && !playbooks ? (
            <div className={styles.loading}>
              <div className={styles.loadingBar} />
            </div>
          ) : pbList.length === 0 ? (
            <div style={{ padding: '20px 14px' }}>
              <div className={styles.emptyText}>
                No playbooks yet. Create one to define your trading setups.
              </div>
            </div>
          ) : (
            pbList.map(pb => (
              <button
                key={pb.id}
                className={`${styles.pbItem} ${
                  pb.id === selectedId ? styles.pbItemActive : ''
                } ${!pb.is_active ? styles.pbItemInactive : ''}`}
                onClick={() => setSelectedId(pb.id)}
              >
                <span className={styles.pbName}>{pb.name}</span>
                <div className={styles.pbMeta}>
                  <span>{pb.trade_count || 0} trades</span>
                  {pb.win_rate != null && (
                    <span className={pb.win_rate >= 50 ? styles.pbMetaGain : ''}>
                      {pb.win_rate.toFixed(0)}% WR
                    </span>
                  )}
                  {pb.avg_r != null && (
                    <span>{pb.avg_r >= 0 ? '+' : ''}{pb.avg_r.toFixed(2)}R</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className={styles.detailPanel}>
        {!selectedId ? (
          <div className={styles.emptyDetail}>
            <div className={styles.emptyIcon}>&#x25CB;</div>
            <div className={styles.emptyTitle}>Select a playbook</div>
            <div className={styles.emptyText}>
              Choose a playbook from the list or create a new one to define your trading setup.
            </div>
          </div>
        ) : !detail ? (
          <div className={styles.loading}>
            <div className={styles.loadingBar} />
            <span>Loading playbook...</span>
          </div>
        ) : (
          <>
            {/* Header with name + actions */}
            <div className={styles.detailHeader}>
              <input
                className={styles.nameInput}
                defaultValue={detail.name || ''}
                key={`name-${selectedId}`}
                placeholder="Playbook Name"
                onBlur={e => {
                  if (e.target.value !== (detail.name || '')) {
                    handleFieldChange('name', e.target.value)
                  }
                }}
              />
              <div className={styles.detailActions}>
                <button className={styles.deleteBtn} onClick={handleDelete}>Delete</button>
              </div>
            </div>

            {saving && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Saving...
              </div>
            )}

            {/* Stats */}
            <div className={styles.pbStats}>
              <StatCard label="Trades" value={detail.trade_count || 0} format="number" accent="neutral" />
              <StatCard label="Win Rate" value={detail.win_rate} format="pct" accent="neutral" />
              <StatCard label="Avg R" value={detail.avg_r} format="r" accent="auto" />
            </div>

            {/* Form fields */}
            <div className={styles.formSection}>
              <div className={styles.formSectionLabel}>Setup Definition</div>
              <div className={styles.formGrid}>
                {FORM_FIELDS.map(field => (
                  <div
                    key={field.key}
                    className={`${styles.formField} ${field.full ? styles.formFieldFull : ''}`}
                  >
                    <label className={styles.fieldLabel}>{field.label}</label>
                    {field.type === 'textarea' ? (
                      <textarea
                        className={styles.textarea}
                        defaultValue={detail[field.key] || ''}
                        key={`${selectedId}-${field.key}`}
                        placeholder={field.placeholder}
                        onBlur={e => {
                          if (e.target.value !== (detail[field.key] || '')) {
                            handleFieldChange(field.key, e.target.value)
                          }
                        }}
                      />
                    ) : (
                      <input
                        type="text"
                        className={styles.textInput}
                        defaultValue={detail[field.key] || ''}
                        key={`${selectedId}-${field.key}`}
                        placeholder={field.placeholder}
                        onBlur={e => {
                          if (e.target.value !== (detail[field.key] || '')) {
                            handleFieldChange(field.key, e.target.value)
                          }
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Linked trades */}
            <div className={styles.linkedTrades}>
              <div className={styles.linkedHeader}>
                Linked Trades ({trades.length})
              </div>
              {trades.length === 0 ? (
                <div className={styles.noLinkedTrades}>
                  No trades linked to this playbook yet. Assign trades by setting their playbook in the trade detail drawer.
                </div>
              ) : (
                trades.map(trade => (
                  <div
                    key={trade.id}
                    className={styles.linkedRow}
                    onClick={() => onOpenTrade && onOpenTrade(trade.id)}
                  >
                    <span className={styles.ltSym}>{trade.sym}</span>
                    <span className={styles.ltDate}>{trade.entry_date || '--'}</span>
                    <span className={trade.pnl_pct >= 0 ? styles.ltPnlGain : styles.ltPnlLoss}>
                      {trade.pnl_pct != null
                        ? `${trade.pnl_pct > 0 ? '+' : ''}${Number(trade.pnl_pct).toFixed(2)}%`
                        : '--'}
                    </span>
                    <span className={styles.ltR}>
                      {trade.realized_r != null
                        ? `${trade.realized_r >= 0 ? '+' : ''}${Number(trade.realized_r).toFixed(2)}R`
                        : '--'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
      </>}
    </div>
  )
}
