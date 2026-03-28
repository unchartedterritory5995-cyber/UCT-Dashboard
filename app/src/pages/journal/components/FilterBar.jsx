// app/src/pages/journal/components/FilterBar.jsx
import { useState, useMemo } from 'react'
import styles from './FilterBar.module.css'

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

const REVIEW_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'logged', label: 'Logged' },
  { value: 'partial', label: 'Partial' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'follow_up', label: 'Follow-up' },
]

export default function FilterBar({ filters, onChange }) {
  const [expanded, setExpanded] = useState(false)

  const activeCount = useMemo(() => {
    let count = 0
    if (filters.date_from) count++
    if (filters.date_to) count++
    if (filters.symbol) count++
    if (filters.direction) count++
    if (filters.setup) count++
    if (filters.status) count++
    if (filters.review_status) count++
    if (filters.has_screenshots) count++
    if (filters.has_notes) count++
    return count
  }, [filters])

  function setFilter(key, value) {
    onChange({ ...filters, [key]: value || '' })
  }

  function clearAll() {
    onChange({
      date_from: '', date_to: '', symbol: '', direction: '',
      setup: '', status: '', review_status: '',
      has_screenshots: false, has_notes: false,
    })
  }

  return (
    <div className={styles.bar}>
      <button
        className={`${styles.toggle} ${expanded ? styles.toggleExpanded : ''}`}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className={styles.toggleIcon}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.toggleLabel}>Filters</span>
        {activeCount > 0 && (
          <span className={styles.activeCount}>{activeCount}</span>
        )}
      </button>

      {expanded && (
        <div className={styles.grid}>
          {/* Row 1: Dates + Symbol */}
          <div className={styles.group}>
            <label className={styles.label}>From</label>
            <input
              type="date"
              className={styles.input}
              value={filters.date_from || ''}
              onChange={e => setFilter('date_from', e.target.value)}
            />
          </div>
          <div className={styles.group}>
            <label className={styles.label}>To</label>
            <input
              type="date"
              className={styles.input}
              value={filters.date_to || ''}
              onChange={e => setFilter('date_to', e.target.value)}
            />
          </div>
          <div className={styles.group}>
            <label className={styles.label}>Symbol</label>
            <input
              type="text"
              className={styles.input}
              placeholder="AAPL"
              maxLength={10}
              value={filters.symbol || ''}
              onChange={e => setFilter('symbol', e.target.value.toUpperCase())}
            />
          </div>

          {/* Row 2: Direction + Setup + Status */}
          <div className={styles.group}>
            <label className={styles.label}>Direction</label>
            <select
              className={styles.input}
              value={filters.direction || ''}
              onChange={e => setFilter('direction', e.target.value)}
            >
              <option value="">All</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div className={styles.group}>
            <label className={styles.label}>Setup</label>
            <select
              className={styles.input}
              value={filters.setup || ''}
              onChange={e => setFilter('setup', e.target.value)}
            >
              <option value="">All</option>
              {SETUP_GROUPS.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.setups.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className={styles.group}>
            <label className={styles.label}>Status</label>
            <select
              className={styles.input}
              value={filters.status || ''}
              onChange={e => setFilter('status', e.target.value)}
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="stopped">Stopped</option>
            </select>
          </div>

          {/* Row 3: Review + Checkboxes + Clear */}
          <div className={styles.group}>
            <label className={styles.label}>Review</label>
            <select
              className={styles.input}
              value={filters.review_status || ''}
              onChange={e => setFilter('review_status', e.target.value)}
            >
              <option value="">All</option>
              {REVIEW_STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.checkGroup}>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={!!filters.has_screenshots}
                onChange={e => setFilter('has_screenshots', e.target.checked)}
              />
              <span>Has screenshots</span>
            </label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={!!filters.has_notes}
                onChange={e => setFilter('has_notes', e.target.checked)}
              />
              <span>Has notes</span>
            </label>
          </div>
          <div className={styles.clearWrap}>
            {activeCount > 0 && (
              <button className={styles.clearBtn} onClick={clearAll}>
                Clear All
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
