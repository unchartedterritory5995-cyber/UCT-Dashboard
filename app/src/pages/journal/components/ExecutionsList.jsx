// app/src/pages/journal/components/ExecutionsList.jsx
import { useState, useMemo } from 'react'
import styles from './ExecutionsList.module.css'

const EXEC_TYPES = [
  { value: 'entry', label: 'ENTRY', color: 'var(--gain)' },
  { value: 'add', label: 'ADD', color: 'var(--gain)' },
  { value: 'trim', label: 'TRIM', color: 'var(--warn)' },
  { value: 'exit', label: 'EXIT', color: 'var(--loss)' },
  { value: 'stop', label: 'STOP', color: 'var(--loss)' },
]

const EXEC_COLORS = {
  entry: { bg: 'rgba(74,222,128,0.1)', color: 'var(--gain)' },
  add: { bg: 'rgba(74,222,128,0.1)', color: 'var(--gain)' },
  trim: { bg: 'var(--warn-bg)', color: 'var(--warn)' },
  exit: { bg: 'rgba(248,113,113,0.1)', color: 'var(--loss)' },
  stop: { bg: 'rgba(248,113,113,0.1)', color: 'var(--loss)' },
}

const EMPTY_EXEC = {
  exec_type: 'entry',
  exec_date: new Date().toISOString().slice(0, 10),
  exec_time: '',
  price: '',
  shares: '',
  fees: '',
  notes: '',
}

export default function ExecutionsList({ tradeId, executions, mutateExecs, mutateTrade }) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_EXEC })
  const [saving, setSaving] = useState(false)

  // Compute VWAP
  const vwap = useMemo(() => {
    if (!executions || executions.length === 0) return null

    let entryShares = 0, entryDollarVol = 0
    let exitShares = 0, exitDollarVol = 0
    let totalFees = 0

    executions.forEach(ex => {
      const shares = Math.abs(ex.shares || 0)
      const dollars = shares * (ex.price || 0)
      totalFees += ex.fees || 0

      if (['entry', 'add'].includes(ex.exec_type)) {
        entryShares += shares
        entryDollarVol += dollars
      } else {
        exitShares += shares
        exitDollarVol += dollars
      }
    })

    return {
      avgEntry: entryShares > 0 ? entryDollarVol / entryShares : null,
      avgExit: exitShares > 0 ? exitDollarVol / exitShares : null,
      netShares: entryShares - exitShares,
      totalFees,
    }
  }, [executions])

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleAddExecution(e) {
    e.preventDefault()
    if (!form.price || !form.shares) return

    setSaving(true)
    try {
      const res = await fetch(`/api/journal/${tradeId}/executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exec_type: form.exec_type,
          exec_date: form.exec_date,
          exec_time: form.exec_time || null,
          price: parseFloat(form.price),
          shares: parseFloat(form.shares),
          fees: form.fees ? parseFloat(form.fees) : 0,
          notes: form.notes,
        }),
      })
      if (res.ok) {
        setForm({ ...EMPTY_EXEC })
        setShowAdd(false)
        mutateExecs()
        mutateTrade()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(execId) {
    if (!window.confirm('Are you sure? This cannot be undone.')) return
    try {
      await fetch(`/api/journal/${tradeId}/executions/${execId}`, { method: 'DELETE' })
      mutateExecs()
      mutateTrade()
    } catch (err) {
      console.error('Delete execution failed:', err)
    }
  }

  if (executions.length === 0 && !showAdd) {
    return (
      <div className={styles.emptyWrap}>
        <div className={styles.emptyIcon}>&#x25CB;</div>
        <div className={styles.emptyTitle}>Simple Mode</div>
        <div className={styles.emptyText}>
          This trade uses a single entry/exit. Add executions to track scale-in/scale-out events with VWAP computation.
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Execution
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Executions table */}
      {executions.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Type</th>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Time</th>
                <th className={styles.th}>Price</th>
                <th className={styles.th}>Shares</th>
                <th className={styles.th}>Fees</th>
                <th className={styles.th}>Notes</th>
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {executions.map(ex => {
                const typeStyle = EXEC_COLORS[ex.exec_type] || EXEC_COLORS.entry
                return (
                  <tr key={ex.id} className={styles.row}>
                    <td>
                      <span
                        className={styles.typeBadge}
                        style={{ background: typeStyle.bg, color: typeStyle.color }}
                      >
                        {ex.exec_type.toUpperCase()}
                      </span>
                    </td>
                    <td className={styles.dateCell}>{ex.exec_date}</td>
                    <td className={styles.timeCell}>{ex.exec_time || '--'}</td>
                    <td className={styles.numCell}>${Number(ex.price).toFixed(2)}</td>
                    <td className={styles.numCell}>{ex.shares}</td>
                    <td className={styles.feeCell}>{ex.fees ? `$${ex.fees.toFixed(2)}` : '--'}</td>
                    <td className={styles.notesCell}>{ex.notes || '--'}</td>
                    <td>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(ex.id)}
                        title="Remove execution"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* VWAP summary */}
      {vwap && (
        <div className={styles.vwapBar}>
          <div className={styles.vwapItem}>
            <span className={styles.vwapLabel}>Avg Entry</span>
            <span className={styles.vwapValue}>
              {vwap.avgEntry != null ? `$${vwap.avgEntry.toFixed(2)}` : '--'}
            </span>
          </div>
          <div className={styles.vwapDivider} />
          <div className={styles.vwapItem}>
            <span className={styles.vwapLabel}>Avg Exit</span>
            <span className={styles.vwapValue}>
              {vwap.avgExit != null ? `$${vwap.avgExit.toFixed(2)}` : '--'}
            </span>
          </div>
          <div className={styles.vwapDivider} />
          <div className={styles.vwapItem}>
            <span className={styles.vwapLabel}>Net Shares</span>
            <span className={styles.vwapValue}>{vwap.netShares}</span>
          </div>
          <div className={styles.vwapDivider} />
          <div className={styles.vwapItem}>
            <span className={styles.vwapLabel}>Total Fees</span>
            <span className={styles.vwapValue}>${vwap.totalFees.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Add execution form */}
      {showAdd ? (
        <form className={styles.addForm} onSubmit={handleAddExecution}>
          <div className={styles.addRow}>
            <select
              className={styles.addInput}
              value={form.exec_type}
              onChange={e => setField('exec_type', e.target.value)}
            >
              {EXEC_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              className={styles.addInput}
              type="date"
              value={form.exec_date}
              onChange={e => setField('exec_date', e.target.value)}
            />
            <input
              className={`${styles.addInput} ${styles.addInputNarrow}`}
              type="time"
              value={form.exec_time}
              onChange={e => setField('exec_time', e.target.value)}
            />
            <input
              className={styles.addInput}
              type="number"
              step="0.01"
              placeholder="Price"
              value={form.price}
              onChange={e => setField('price', e.target.value)}
              required
            />
            <input
              className={styles.addInput}
              type="number"
              step="1"
              placeholder="Shares"
              value={form.shares}
              onChange={e => setField('shares', e.target.value)}
              required
            />
            <input
              className={`${styles.addInput} ${styles.addInputNarrow}`}
              type="number"
              step="0.01"
              placeholder="Fees"
              value={form.fees}
              onChange={e => setField('fees', e.target.value)}
            />
          </div>
          <div className={styles.addRow}>
            <input
              className={`${styles.addInput} ${styles.addInputWide}`}
              type="text"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              maxLength={500}
            />
            <button className={styles.addSubmit} type="submit" disabled={saving}>
              {saving ? '...' : 'Add'}
            </button>
            <button
              className={styles.addCancel}
              type="button"
              onClick={() => { setShowAdd(false); setForm({ ...EMPTY_EXEC }) }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Execution
        </button>
      )}
    </div>
  )
}
