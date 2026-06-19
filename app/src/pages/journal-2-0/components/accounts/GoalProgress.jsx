/**
 * Goal Progress — per-account Daily/Weekly/Monthly/Yearly targets.
 * Shows current P&L vs target as bar + percent. Edit pencil opens
 * inline number input.
 */

import { useEffect, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import { money, moneySigned } from '../../../../lib/journal-2-0'
import styles from './GoalProgress.module.css'

const PERIODS = [
  { key: 'daily',   label: 'Daily',   defaultTarget: 95.24 },
  { key: 'weekly',  label: 'Weekly',  defaultTarget: 461.89 },
  { key: 'monthly', label: 'Monthly', defaultTarget: 2000 },
  { key: 'yearly',  label: 'Yearly',  defaultTarget: 24000 },
]

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function GoalProgress({ account }) {
  const { mutate } = useSWRConfig()
  const goalsKey = account ? `/api/j2/accounts/${account.id}/goal-progress` : null
  const { data, isLoading } = useSWR(goalsKey, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  })
  const [editing, setEditing] = useState(null) // period key
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)

  const periods = data?.periods || {}
  const goals = account?.goals || {}

  const beginEdit = (key) => {
    setEditing(key)
    setEditVal(String(goals[key] ?? PERIODS.find((p) => p.key === key).defaultTarget))
  }

  const saveEdit = async () => {
    const n = Number(editVal)
    if (!Number.isFinite(n) || n < 0) {
      setEditing(null)
      return
    }
    setSaving(true)
    try {
      const next = { ...goals, [editing]: n }
      await fetch(`/api/j2/accounts/${account.id}/goals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      })
      mutate('/api/j2/accounts')
      mutate(goalsKey)
    } finally {
      setSaving(false)
      setEditing(null)
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <span className={styles.dot}><UIcon name="patterns" size={14} /></span>
        <h3 className={styles.title}>Goal Progress</h3>
        <span className={styles.acct}>{account?.name}</span>
      </div>

      <div className={styles.grid}>
        {PERIODS.map((p) => {
          const period = periods[p.key] || { pnl: 0, target: null, progress: null }
          const target = goals[p.key] ?? p.defaultTarget
          const isDefault = goals[p.key] == null
          const pnl = period.pnl ?? 0
          const pct = target > 0 ? Math.max(0, Math.min(1, pnl / target)) : 0
          return (
            <div key={p.key} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.label}>{p.label}</span>
                {editing === p.key ? (
                  <span className={styles.editCtrls}>
                    <span className={styles.dollarSign}>$</span>
                    <input
                      type="number"
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      className={styles.editInput}
                      min="0"
                      step="any"
                      autoFocus
                      disabled={saving}
                    />
                  </span>
                ) : (
                  <span className={styles.pctLabel}>
                    {target > 0 ? `${Math.round(pct * 100)}%` : '—'}
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => beginEdit(p.key)}
                      aria-label={`Edit ${p.label} target`}
                      title="Edit target"
                    >
                      <UIcon name="edit" size={13} />
                    </button>
                  </span>
                )}
              </div>
              <div className={styles.bar}>
                <div
                  className={`${styles.barFill} ${pnl >= 0 ? styles.fillPos : styles.fillNeg}`}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
              <div className={styles.cardFoot}>
                <span className={`${styles.pnl} ${pnl >= 0 ? styles.pos : styles.neg}`}>
                  {moneySigned(pnl)}
                </span>
                <span className={styles.target}>
                  / {money(target)} {isDefault && <span className={styles.defaultTag}>default</span>}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
