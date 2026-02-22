import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './ModelBook.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function ModelBook() {
  const { data: trades, mutate } = useSWR('/api/trades', fetcher, { refreshInterval: 60000 })
  const [form, setForm] = useState({ sym: '', entry: '', stop: '', target: '', size_pct: '', notes: '' })
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setAdding(true)
    await fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sym: form.sym,
        entry: parseFloat(form.entry),
        stop: parseFloat(form.stop),
        target: parseFloat(form.target),
        size_pct: parseFloat(form.size_pct),
        notes: form.notes
      })
    })
    setForm({ sym: '', entry: '', stop: '', target: '', size_pct: '', notes: '' })
    setAdding(false)
    setShowForm(false)
    mutate()
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Model Book</h1>
        <button className={styles.addBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Add Trade'}
        </button>
      </div>

      {showForm && (
        <TileCard title="New Trade">
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.formRow}>
              <input className={styles.input} placeholder="Ticker" value={form.sym} onChange={e => setForm(f => ({...f, sym: e.target.value.toUpperCase()}))} required />
              <input className={styles.input} placeholder="Entry" type="number" step="0.01" value={form.entry} onChange={e => setForm(f => ({...f, entry: e.target.value}))} required />
              <input className={styles.input} placeholder="Stop" type="number" step="0.01" value={form.stop} onChange={e => setForm(f => ({...f, stop: e.target.value}))} required />
              <input className={styles.input} placeholder="Target" type="number" step="0.01" value={form.target} onChange={e => setForm(f => ({...f, target: e.target.value}))} required />
              <input className={styles.input} placeholder="Size %" type="number" step="0.5" value={form.size_pct} onChange={e => setForm(f => ({...f, size_pct: e.target.value}))} required />
            </div>
            <input className={`${styles.input} ${styles.notesInput}`} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
            <button className={styles.submitBtn} type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add Trade'}</button>
          </form>
        </TileCard>
      )}

      <TileCard title="Open Positions">
        {trades
          ? trades.length > 0
            ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Entry</th>
                    <th>Stop</th>
                    <th>Target</th>
                    <th>Size %</th>
                    <th>R:R</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(trade => {
                    const risk = trade.entry - trade.stop
                    const reward = trade.target - trade.entry
                    const rr = risk > 0 ? (reward / risk).toFixed(1) : '—'
                    return (
                      <tr key={trade.id || trade.sym} className={styles.tradeRow}>
                        <td className={styles.sym}>{trade.sym}</td>
                        <td className={styles.num}>{trade.entry}</td>
                        <td className={styles.num} style={{color:'var(--loss)'}}>{trade.stop}</td>
                        <td className={styles.num} style={{color:'var(--gain)'}}>{trade.target}</td>
                        <td className={styles.num}>{trade.size_pct}%</td>
                        <td className={styles.num}>{rr}:1</td>
                        <td><span className={trade.status === 'open' ? styles.open : styles.closed}>{trade.status}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
            : <p className={styles.noTrades}>No open positions</p>
          : <p className={styles.loading}>Loading trades…</p>
        }
      </TileCard>
    </div>
  )
}
