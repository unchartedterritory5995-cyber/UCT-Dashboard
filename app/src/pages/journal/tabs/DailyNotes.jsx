// app/src/pages/journal/tabs/DailyNotes.jsx
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import styles from './DailyNotes.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const SECTIONS = [
  {
    key: 'premarket',
    label: 'PRE-MARKET',
    fields: [
      { key: 'premarket_thesis', label: 'Market Thesis', type: 'textarea', placeholder: 'What is your thesis for today? Key levels, expected range, catalysts...' },
      { key: 'focus_list', label: 'Focus List', type: 'text', placeholder: 'AAPL, NVDA, SMCI...' },
      { key: 'a_plus_setups', label: 'A+ Setups', type: 'textarea', placeholder: 'Best setups identified pre-market...' },
      { key: 'risk_plan', label: 'Risk Plan', type: 'textarea', placeholder: 'Max loss, position sizing rules, conditions to stop trading...' },
    ],
  },
  {
    key: 'market',
    label: 'MARKET NOTES',
    fields: [
      { key: 'market_regime', label: 'Regime Note', type: 'textarea', placeholder: 'Bull/bear/chop, breadth reading, sector rotation...' },
      { key: 'emotional_state', label: 'Emotional Baseline', type: 'text', placeholder: 'How are you feeling before the bell?' },
      { key: 'energy_rating', label: 'Energy Rating', type: 'rating', max: 5 },
    ],
  },
  {
    key: 'midday',
    label: 'MIDDAY CHECK-IN',
    fields: [
      { key: 'midday_notes', label: 'Adjustments', type: 'textarea', placeholder: 'Midday observations, adjustments, intraday regime shifts...' },
    ],
  },
  {
    key: 'eod',
    label: 'END OF DAY',
    fields: [
      { key: 'eod_recap', label: 'Recap', type: 'textarea', placeholder: 'How did the day go overall?' },
      { key: 'did_well', label: 'Did Well', type: 'textarea', placeholder: 'What went right today...' },
      { key: 'did_poorly', label: 'Did Poorly', type: 'textarea', placeholder: 'What went wrong today...' },
      { key: 'learned', label: 'Learned', type: 'textarea', placeholder: 'Key takeaway from today...' },
      { key: 'tomorrow_focus', label: 'Tomorrow Focus', type: 'text', placeholder: 'Focus for next session...' },
      { key: 'discipline_score', label: 'Discipline Score', type: 'slider', min: 0, max: 100 },
    ],
  },
]

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`
}

function formatDateHeading(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function getLast30Days() {
  const dates = []
  const today = new Date()
  for (let i = 0; i < 30; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

function getTimeHighlight() {
  const hour = new Date().getHours()
  if (hour < 9) return 'premarket'
  if (hour < 12) return 'midday'
  if (hour >= 16) return 'eod'
  return null
}

export default function DailyNotes({ onOpenTrade }) {
  const today = new Date().toISOString().slice(0, 10)
  const [selectedDate, setSelectedDate] = useState(today)
  const [expanded, setExpanded] = useState({ premarket: true, market: true, midday: false, eod: true })
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef(null)

  // Get 30-day date range
  const last30 = useMemo(() => getLast30Days(), [])
  const dateFrom = last30[last30.length - 1]
  const dateTo = last30[0]

  // Fetch list of daily journals for sidebar
  const { data: dateList } = useSWR(
    `/api/journal/daily?date_from=${dateFrom}&date_to=${dateTo}`,
    fetcher,
    { refreshInterval: 120000, dedupingInterval: 30000, revalidateOnFocus: false }
  )

  // Fetch selected day's journal
  const { data: journal, mutate: mutateJournal, isLoading } = useSWR(
    `/api/journal/daily/${selectedDate}`,
    fetcher,
    { dedupingInterval: 5000, revalidateOnFocus: false }
  )

  // Build date entries with status
  const dateEntries = useMemo(() => {
    const journalMap = {}
    if (dateList) {
      for (const dj of dateList) {
        journalMap[dj.date] = dj
      }
    }
    return last30.map(date => {
      const jEntry = journalMap[date]
      return {
        date,
        label: formatDateLabel(date),
        status: jEntry?.review_complete ? 'green' : jEntry?.has_content ? 'amber' : 'gray',
        tradeCount: jEntry?.trade_count || 0,
      }
    })
  }, [last30, dateList])

  const highlight = getTimeHighlight()

  // Auto-save handler
  const handleFieldChange = useCallback((key, value) => {
    // Optimistic update
    mutateJournal(prev => prev ? { ...prev, [key]: value } : prev, false)

    setSaving(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/journal/daily/${selectedDate}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        })
        mutateJournal()
      } catch (err) {
        console.error('Save daily note failed:', err)
      } finally {
        setSaving(false)
      }
    }, 600)
  }, [selectedDate, mutateJournal])

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const toggleSection = useCallback((key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const jumpToToday = useCallback(() => {
    setSelectedDate(today)
  }, [today])

  return (
    <div className={styles.wrap}>
      {/* Date sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Daily Notes</span>
          <button className={styles.todayBtn} onClick={jumpToToday}>Today</button>
        </div>
        <div className={styles.dateList}>
          {dateEntries.map(entry => (
            <button
              key={entry.date}
              className={`${styles.dateItem} ${entry.date === selectedDate ? styles.dateItemActive : ''}`}
              onClick={() => setSelectedDate(entry.date)}
            >
              <div className={styles.dateLeft}>
                <span className={styles.dateLabel}>{entry.label}</span>
                {entry.date === today && <span className={styles.dateSub}>Today</span>}
              </div>
              <div className={styles.dateRight}>
                {entry.tradeCount > 0 && (
                  <span className={styles.tradeBadge}>{entry.tradeCount}</span>
                )}
                <span className={`${styles.dot} ${
                  entry.status === 'green' ? styles.dotGreen :
                  entry.status === 'amber' ? styles.dotAmber :
                  styles.dotGray
                }`} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Form panel */}
      <div className={styles.formPanel}>
        {isLoading && !journal ? (
          <div className={styles.loading}>
            <div className={styles.loadingBar} />
            <span>Loading journal...</span>
          </div>
        ) : (
          <>
            <div className={styles.formDate}>
              {formatDateHeading(selectedDate)}
              {saving && <span className={styles.savingIndicator}>Saving...</span>}
            </div>

            {/* Collapsible sections */}
            {SECTIONS.map(section => (
              <div
                key={section.key}
                className={`${styles.section} ${highlight === section.key ? styles.sectionHighlight : ''}`}
              >
                <div className={styles.sectionHeader} onClick={() => toggleSection(section.key)}>
                  <span className={styles.sectionLabel}>{section.label}</span>
                  <span className={`${styles.sectionToggle} ${expanded[section.key] ? styles.sectionToggleOpen : ''}`}>
                    &#x25B8;
                  </span>
                </div>
                {expanded[section.key] && (
                  <div className={styles.sectionBody}>
                    {section.fields.map(field => (
                      <div key={field.key} className={styles.field}>
                        <label className={styles.fieldLabel}>{field.label}</label>
                        {field.type === 'textarea' && (
                          <textarea
                            className={styles.textarea}
                            defaultValue={journal?.[field.key] || ''}
                            key={`${selectedDate}-${field.key}`}
                            placeholder={field.placeholder}
                            onBlur={e => {
                              if (e.target.value !== (journal?.[field.key] || '')) {
                                handleFieldChange(field.key, e.target.value)
                              }
                            }}
                          />
                        )}
                        {field.type === 'text' && (
                          <input
                            type="text"
                            className={styles.textInput}
                            defaultValue={journal?.[field.key] || ''}
                            key={`${selectedDate}-${field.key}`}
                            placeholder={field.placeholder}
                            onBlur={e => {
                              if (e.target.value !== (journal?.[field.key] || '')) {
                                handleFieldChange(field.key, e.target.value)
                              }
                            }}
                          />
                        )}
                        {field.type === 'rating' && (
                          <div className={styles.ratingRow}>
                            {Array.from({ length: field.max }, (_, i) => i + 1).map(val => (
                              <button
                                key={val}
                                className={`${styles.ratingPill} ${
                                  (journal?.[field.key] || 0) === val ? styles.ratingPillActive : ''
                                }`}
                                onClick={() => handleFieldChange(field.key, val)}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        )}
                        {field.type === 'slider' && (
                          <div className={styles.sliderWrap}>
                            <input
                              type="range"
                              className={styles.slider}
                              min={field.min}
                              max={field.max}
                              value={journal?.[field.key] ?? 50}
                              key={`${selectedDate}-${field.key}`}
                              onChange={e => {
                                const val = parseInt(e.target.value)
                                mutateJournal(prev => prev ? { ...prev, [field.key]: val } : prev, false)
                              }}
                              onMouseUp={e => handleFieldChange(field.key, parseInt(e.target.value))}
                              onTouchEnd={e => handleFieldChange(field.key, parseInt(e.target.value))}
                            />
                            <span className={styles.sliderValue}>{journal?.[field.key] ?? 50}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Linked trades mini-table */}
            {journal?.trades?.length > 0 && (
              <div className={styles.linkedTrades}>
                <div className={styles.linkedHeader}>Trades This Day ({journal.trades.length})</div>
                {journal.trades.map(trade => (
                  <div
                    key={trade.id}
                    className={styles.linkedRow}
                    onClick={() => onOpenTrade && onOpenTrade(trade.id)}
                  >
                    <span className={styles.ltSym}>{trade.sym}</span>
                    <span className={styles.ltDir}>{(trade.direction || 'long').toUpperCase()}</span>
                    <span className={styles.ltSetup}>{trade.setup || '--'}</span>
                    <span className={trade.pnl_pct >= 0 ? styles.ltPnlGain : styles.ltPnlLoss}>
                      {trade.pnl_pct != null
                        ? `${trade.pnl_pct > 0 ? '+' : ''}${Number(trade.pnl_pct).toFixed(2)}%`
                        : '--'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
