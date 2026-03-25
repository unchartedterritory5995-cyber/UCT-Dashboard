import { useState, useEffect } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './Journal.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const SETUP_GROUPS = [
  {
    label: 'Swing',
    setups: [
      'High Tight Flag (Powerplay)', 'Classic Flag/Pullback', 'VCP',
      'Flat Base Breakout', 'IPO Base', 'Parabolic Short', 'Parabolic Long',
      'Wedge Pop', 'Wedge Drop', 'Episodic Pivot', '2B Reversal',
      'Kicker Candle', 'Power Earnings Gap', 'News Gappers',
      '4B Setup (Stan Weinstein)', 'Failed H&S/Rounded Top',
      'Classic U&R', 'Launchpad', 'Go Signal', 'HVC',
      'Wick Play', 'Slingshot', 'Oops Reversal', 'News Failure',
      'Remount', 'Red to Green',
    ],
  },
  {
    label: 'Intraday',
    setups: [
      'Opening Range Breakout', 'Opening Range Breakdown',
      'Red to Green (Intraday)', 'Green to Red',
      '30min Pivot', 'Mean Reversion L/S',
    ],
  },
]

const EMPTY_FORM = {
  sym: '', direction: 'long', setup: '', entry_price: '', exit_price: '',
  stop_price: '', target_price: '', size_pct: '', entry_date: '', exit_date: '',
  notes: '', status: 'open', rating: 0,
}

function Stars({ value, onChange, readOnly }) {
  return (
    <div className={styles.stars}>
      {[1,2,3,4,5].map(i => (
        <span
          key={i}
          className={`${styles.star} ${i <= value ? styles.starFilled : ''}`}
          onClick={readOnly ? undefined : () => onChange(i === value ? 0 : i)}
        >★</span>
      ))}
    </div>
  )
}

export default function Journal() {
  const [tab, setTab] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [closeModal, setCloseModal] = useState(null) // entry being closed
  const [closeForm, setCloseForm] = useState({ exit_price: '', exit_date: '', rating: 0 })

  const statusParam = tab === 'all' ? '' : `?status=${tab}`
  const { data: entries, mutate } = useSWR(`/api/journal${statusParam}`, fetcher, { refreshInterval: 60000 })
  const { data: stats, mutate: mutateStats } = useSWR('/api/journal/stats', fetcher, { refreshInterval: 60000 })

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowForm(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        sym: form.sym,
        direction: form.direction,
        setup: form.setup,
        entry_price: form.entry_price ? parseFloat(form.entry_price) : null,
        exit_price: form.exit_price ? parseFloat(form.exit_price) : null,
        stop_price: form.stop_price ? parseFloat(form.stop_price) : null,
        target_price: form.target_price ? parseFloat(form.target_price) : null,
        size_pct: form.size_pct ? parseFloat(form.size_pct) : null,
        entry_date: form.entry_date || new Date().toISOString().slice(0, 10),
        exit_date: form.exit_date || null,
        notes: form.notes,
        status: form.status,
        rating: form.rating || null,
      }

      const url = editId ? `/api/journal/${editId}` : '/api/journal'
      const method = editId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return
      resetForm()
      mutate()
      mutateStats()
    } finally {
      setSaving(false)
    }
  }

  function startEdit(entry) {
    setForm({
      sym: entry.sym || '',
      direction: entry.direction || 'long',
      setup: entry.setup || '',
      entry_price: entry.entry_price ?? '',
      exit_price: entry.exit_price ?? '',
      stop_price: entry.stop_price ?? '',
      target_price: entry.target_price ?? '',
      size_pct: entry.size_pct ?? '',
      entry_date: entry.entry_date || '',
      exit_date: entry.exit_date || '',
      notes: entry.notes || '',
      status: entry.status || 'open',
      rating: entry.rating || 0,
    })
    setEditId(entry.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openCloseModal(entry) {
    setCloseModal(entry)
    setCloseForm({
      exit_price: entry.exit_price ?? '',
      exit_date: entry.exit_date || new Date().toISOString().slice(0, 10),
      rating: entry.rating || 0,
    })
  }

  async function handleCloseTrade(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch(`/api/journal/${closeModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exit_price: parseFloat(closeForm.exit_price),
          exit_date: closeForm.exit_date,
          status: 'closed',
          rating: closeForm.rating || null,
        }),
      })
      setCloseModal(null)
      mutate()
      mutateStats()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await fetch(`/api/journal/${id}`, { method: 'DELETE' })
    mutate()
    mutateStats()
  }

  const riskReward = (entry, stop, target) => {
    if (!entry || !stop || !target) return '—'
    const risk = Math.abs(entry - stop)
    const reward = Math.abs(target - entry)
    return risk > 0 ? `${(reward / risk).toFixed(1)}:1` : '—'
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Trade Journal</h1>
        <div className={styles.headerRight}>
          <div className={styles.tabs}>
            {[['all','All'],['open','Open'],['closed','Closed'],['stopped','Stopped']].map(([key, label]) => (
              <button key={key} className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
                onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          <button className={styles.addBtn} onClick={() => showForm ? resetForm() : setShowForm(true)}>
            {showForm ? 'Cancel' : '+ New Trade'}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && stats.total_trades > 0 && (
        <div className={styles.statsStrip}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Win Rate</div>
            <div className={styles.statValue}>{stats.win_rate}%</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Profit Factor</div>
            <div className={styles.statValue}>{stats.profit_factor}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Avg Win</div>
            <div className={`${styles.statValue} ${styles.statGain}`}>+{stats.avg_win_pct}%</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Avg Loss</div>
            <div className={`${styles.statValue} ${styles.statLoss}`}>-{stats.avg_loss_pct}%</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Total P&L</div>
            <div className={`${styles.statValue} ${stats.total_pnl_pct >= 0 ? styles.statGain : styles.statLoss}`}>
              {stats.total_pnl_pct >= 0 ? '+' : ''}{stats.total_pnl_pct}%
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Open</div>
            <div className={styles.statValue}>{stats.open_trades}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Closed</div>
            <div className={styles.statValue}>{stats.total_trades}</div>
          </div>
        </div>
      )}

      {/* Top setups */}
      {stats && stats.top_setups && stats.top_setups.length > 0 && (
        <div className={styles.setupsGrid}>
          {stats.top_setups.map(s => (
            <div key={s.setup} className={styles.setupCard}>
              <div className={styles.setupName}>{s.setup}</div>
              <div className={styles.setupStat}>{s.win_rate}% WR · {s.total} trades · {s.avg_pnl >= 0 ? '+' : ''}{s.avg_pnl}%</div>
            </div>
          ))}
        </div>
      )}

      {/* New / Edit trade form */}
      {showForm && (
        <div className={styles.formCard}>
          <TileCard title={editId ? 'Edit Trade' : 'New Trade'}>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Ticker</span>
                  <input className={styles.input} value={form.sym}
                    onChange={e => setForm(f => ({...f, sym: e.target.value.toUpperCase()}))} required />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Direction</span>
                  <div className={styles.dirToggle}>
                    <button type="button" className={`${styles.dirBtn} ${form.direction === 'long' ? styles.dirBtnActive : ''}`}
                      onClick={() => setForm(f => ({...f, direction: 'long'}))}>LONG</button>
                    <button type="button" className={`${styles.dirBtn} ${styles.dirBtnShort} ${form.direction === 'short' ? styles.dirBtnActive : ''}`}
                      onClick={() => setForm(f => ({...f, direction: 'short'}))}>SHORT</button>
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Setup</span>
                  <select className={styles.input} value={form.setup} onChange={e => setForm(f => ({...f, setup: e.target.value}))}>
                    <option value="">Select…</option>
                    {SETUP_GROUPS.map(group => (
                      <optgroup key={group.label} label={group.label}>
                        {group.setups.map(s => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Entry Date</span>
                  <input className={styles.input} type="date" value={form.entry_date}
                    onChange={e => setForm(f => ({...f, entry_date: e.target.value}))} />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Entry $</span>
                  <input className={styles.input} type="number" step="0.01" value={form.entry_price}
                    onChange={e => setForm(f => ({...f, entry_price: e.target.value}))} />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Stop $</span>
                  <input className={styles.input} type="number" step="0.01" value={form.stop_price}
                    onChange={e => setForm(f => ({...f, stop_price: e.target.value}))} />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Target $</span>
                  <input className={styles.input} type="number" step="0.01" value={form.target_price}
                    onChange={e => setForm(f => ({...f, target_price: e.target.value}))} />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Size %</span>
                  <input className={styles.input} type="number" step="0.5" value={form.size_pct}
                    onChange={e => setForm(f => ({...f, size_pct: e.target.value}))} />
                </div>
              </div>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Notes</span>
                <textarea className={`${styles.input} ${styles.notesInput}`} value={form.notes}
                  onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Trade thesis, observations, lessons learned…" />
              </div>
              <div className={styles.formActions}>
                <button className={styles.submitBtn} type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editId ? 'Update Trade' : 'Add Trade'}
                </button>
                <button type="button" className={styles.cancelBtn} onClick={resetForm}>Cancel</button>
              </div>
            </form>
          </TileCard>
        </div>
      )}

      {/* Trade list */}
      <TileCard title={`${tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)} Trades`}>
        {!entries ? (
          <p className={styles.loading}>Loading…</p>
        ) : entries.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📓</div>
            <div className={styles.emptyText}>
              {tab === 'all' ? 'No trades yet. Click "+ New Trade" to log your first trade.' : `No ${tab} trades.`}
            </div>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Dir</th>
                  <th>Setup</th>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Stop</th>
                  <th>Target</th>
                  <th>R:R</th>
                  <th>Exit</th>
                  <th>P&L</th>
                  <th>Rating</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className={styles.tradeRow} onClick={() => startEdit(entry)}>
                    <td className={styles.sym}>{entry.sym}</td>
                    <td>
                      <span className={entry.direction === 'short' ? styles.shortBadge : styles.longBadge}>
                        {(entry.direction || 'long').toUpperCase()}
                      </span>
                    </td>
                    <td className={styles.setupChip}>{entry.setup || '—'}</td>
                    <td className={styles.dateCell}>{entry.entry_date || '—'}</td>
                    <td className={styles.num}>{entry.entry_price != null ? `$${entry.entry_price}` : '—'}</td>
                    <td className={styles.num} style={{color:'var(--loss)'}}>{entry.stop_price != null ? `$${entry.stop_price}` : '—'}</td>
                    <td className={styles.num} style={{color:'var(--gain)'}}>{entry.target_price != null ? `$${entry.target_price}` : '—'}</td>
                    <td className={styles.num}>{riskReward(entry.entry_price, entry.stop_price, entry.target_price)}</td>
                    <td className={styles.num}>{entry.exit_price != null ? `$${entry.exit_price}` : '—'}</td>
                    <td>
                      {entry.pnl_pct != null ? (
                        <span className={entry.pnl_pct >= 0 ? styles.pnlGain : styles.pnlLoss}>
                          {entry.pnl_pct >= 0 ? '+' : ''}{entry.pnl_pct}%
                        </span>
                      ) : '—'}
                    </td>
                    <td><Stars value={entry.rating || 0} readOnly /></td>
                    <td>
                      {entry.status === 'open' ? (
                        <button className={styles.statusOpen} onClick={e => { e.stopPropagation(); openCloseModal(entry) }}>
                          OPEN
                        </button>
                      ) : entry.status === 'stopped' ? (
                        <span className={styles.statusStopped}>STOPPED</span>
                      ) : (
                        <span className={styles.statusClosed}>CLOSED</span>
                      )}
                    </td>
                    <td>
                      <button className={styles.deleteBtn} onClick={e => { e.stopPropagation(); handleDelete(entry.id) }}
                        title="Delete">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TileCard>

      {/* Close trade modal */}
      {closeModal && (
        <div className={styles.modalBackdrop} onClick={() => setCloseModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Close {closeModal.sym}</div>
            <form onSubmit={handleCloseTrade}>
              <div className={styles.modalRow}>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Exit Price</span>
                  <input className={styles.input} type="number" step="0.01" value={closeForm.exit_price}
                    onChange={e => setCloseForm(f => ({...f, exit_price: e.target.value}))} required autoFocus />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Exit Date</span>
                  <input className={styles.input} type="date" value={closeForm.exit_date}
                    onChange={e => setCloseForm(f => ({...f, exit_date: e.target.value}))} />
                </div>
              </div>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Rating</span>
                <Stars value={closeForm.rating} onChange={v => setCloseForm(f => ({...f, rating: v}))} />
              </div>
              {closeForm.exit_price && closeModal.entry_price && (
                <div style={{ marginTop: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
                  {(() => {
                    const pnl = closeModal.direction === 'short'
                      ? ((closeModal.entry_price - parseFloat(closeForm.exit_price)) / closeModal.entry_price * 100)
                      : ((parseFloat(closeForm.exit_price) - closeModal.entry_price) / closeModal.entry_price * 100)
                    return <span style={{ color: pnl >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
                      P&L: {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
                    </span>
                  })()}
                </div>
              )}
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setCloseModal(null)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={saving}>
                  {saving ? 'Closing…' : 'Close Trade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
