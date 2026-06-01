import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './ModelBook.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const YEARS = Array.from({ length: 12 }, (_, i) => 2026 - i)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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
const SETUPS = SETUP_GROUPS.flatMap(g => g.setups)

const EMPTY_FORM = { sym: '', entry: '', stop: '', target: '', size_pct: '', notes: '', setup: '', date: '' }

function selectedLabel(sel) {
  if (!sel) return 'All Trades'
  if (sel.type === 'year') return String(sel.year)
  if (sel.type === 'month') return `${MONTHS[sel.month]} ${sel.year}`
  if (sel.type === 'setup') return sel.setup
  return 'All Trades'
}

function filterTrades(trades, sel) {
  if (!trades) return []
  if (!sel) return trades
  if (sel.type === 'year') {
    return trades.filter(t => t.date && new Date(t.date).getFullYear() === sel.year)
  }
  if (sel.type === 'month') {
    return trades.filter(t => {
      if (!t.date) return false
      const d = new Date(t.date)
      return d.getFullYear() === sel.year && d.getMonth() === sel.month
    })
  }
  if (sel.type === 'setup') {
    return trades.filter(t => (t.setup || '').toLowerCase() === sel.setup.toLowerCase())
  }
  return trades
}

export default function ModelBook() {
  const { data: trades, mutate } = useSWR('/api/trades', fetcher, { refreshInterval: 60000 })
  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [expandedYears, setExpandedYears] = useState({})
  const [selected, setSelected] = useState(null)

  function toggleYear(year, e) {
    e.stopPropagation()
    setExpandedYears(prev => ({ ...prev, [year]: !prev[year] }))
  }

  function selectYear(year) {
    setSelected({ type: 'year', year })
    setExpandedYears(prev => ({ ...prev, [year]: true }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setAdding(true)
    try {
      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sym: form.sym,
          entry: parseFloat(form.entry),
          stop: parseFloat(form.stop),
          target: parseFloat(form.target),
          size_pct: parseFloat(form.size_pct),
          notes: form.notes,
          setup: form.setup,
          date: form.date || new Date().toISOString().slice(0, 10),
        })
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      mutate()
    } finally {
      setAdding(false)
    }
  }

  const filtered = filterTrades(trades, selected)

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
              <input className={styles.input} placeholder="Date" type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} />
              <select className={styles.input} value={form.setup} onChange={e => setForm(f => ({...f, setup: e.target.value}))}>
                <option value="">Setup…</option>
                {SETUP_GROUPS.map(group => (
                  <optgroup key={group.label} label={group.label}>
                    {group.setups.map(s => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <input className={`${styles.input} ${styles.notesInput}`} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
            <button className={styles.submitBtn} type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add Trade'}</button>
          </form>
        </TileCard>
      )}

      <div className={styles.layout}>
        {/* Left nav — two side-by-side columns */}
        <nav className={styles.navPanel}>
          {/* Column 1: Year / Month */}
          <div className={styles.navCol}>
            <div className={styles.navColHeader}>Year / Month</div>
            {YEARS.map(year => (
              <div key={year} className={styles.treeGroup}>
                <button
                  className={`${styles.treeItem} ${selected?.type === 'year' && selected.year === year ? styles.treeActive : ''}`}
                  onClick={() => selectYear(year)}
                >
                  <span className={styles.treeArrow} onClick={e => toggleYear(year, e)}>
                    {expandedYears[year] ? '▾' : '▸'}
                  </span>
                  {year}
                </button>
                {expandedYears[year] && (
                  <div className={styles.treeChildren}>
                    {MONTHS.map((m, i) => (
                      <button
                        key={m}
                        className={`${styles.treeChild} ${selected?.type === 'month' && selected.year === year && selected.month === i ? styles.treeActive : ''}`}
                        onClick={() => setSelected({ type: 'month', year, month: i })}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Column 2: Setups */}
          <div className={styles.navCol}>
            <div className={styles.navColHeader}>Setups</div>
            {SETUP_GROUPS.map(group => (
              <div key={group.label}>
                <div className={styles.navGroupLabel}>{group.label}</div>
                {group.setups.map(s => (
                  <button
                    key={s}
                    className={`${styles.treeItem} ${selected?.type === 'setup' && selected.setup === s ? styles.treeActive : ''}`}
                    onClick={() => setSelected({ type: 'setup', setup: s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* Right content */}
        <div className={styles.content}>
          <TileCard title={selectedLabel(selected)}>
            {!trades
              ? <p className={styles.loading}>Loading trades…</p>
              : filtered.length === 0
                ? <p className={styles.noTrades}>No trades{selected ? ` for ${selectedLabel(selected)}` : ''}</p>
                : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Setup</th>
                        <th>Date</th>
                        <th>Entry</th>
                        <th>Stop</th>
                        <th>Target</th>
                        <th>Size %</th>
                        <th>R:R</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(trade => {
                        const risk = trade.entry - trade.stop
                        const reward = trade.target - trade.entry
                        const rr = risk > 0 ? (reward / risk).toFixed(1) : '—'
                        return (
                          <tr key={trade.id || trade.sym} className={styles.tradeRow}>
                            <td className={styles.sym}>{trade.sym}</td>
                            <td className={styles.setupChip}>{trade.setup || '—'}</td>
                            <td className={styles.dateCell}>{trade.date || '—'}</td>
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
            }
          </TileCard>
        </div>
      </div>
    </div>
  )
}
