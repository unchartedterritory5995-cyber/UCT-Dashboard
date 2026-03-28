// app/src/pages/journal/components/TradeDrawer.jsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import useSWR from 'swr'
import StockChart from '../../../components/StockChart'
import ExecutionsList from './ExecutionsList'
import ProcessScoreCard from './ProcessScoreCard'
import EmotionSelector from './EmotionSelector'
import MistakeSelector from './MistakeSelector'
import ScreenshotUploader from './ScreenshotUploader'
import ReviewProgress from './ReviewProgress'
import AISummary from './AISummary'
import TradeForm from './TradeForm'
import styles from './TradeDrawer.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const DRAWER_TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'executions', label: 'Executions' },
  { key: 'process', label: 'Process' },
  { key: 'notes', label: 'Notes' },
  { key: 'mistakes', label: 'Mistakes' },
]

const CHART_TFS = [
  { key: 'D', label: 'Daily' },
  { key: 'W', label: 'Weekly' },
]

const REVIEW_COLORS = {
  draft: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)', border: 'var(--border)' },
  logged: { bg: 'rgba(107,163,190,0.12)', color: 'var(--info)', border: 'var(--info-border)' },
  partial: { bg: 'var(--warn-bg)', color: 'var(--warn)', border: 'var(--warn-border)' },
  reviewed: { bg: 'var(--gain-bg)', color: 'var(--gain)', border: 'var(--gain-border)' },
  flagged: { bg: 'var(--loss-bg)', color: 'var(--loss)', border: 'var(--loss-border)' },
  follow_up: { bg: 'var(--warn-bg)', color: 'var(--ut-gold)', border: 'var(--warn-border)' },
}

export default function TradeDrawer({ tradeId, onClose, onTradeUpdated }) {
  const [activeTab, setActiveTab] = useState('summary')
  const [chartTf, setChartTf] = useState('D')
  const [expanded, setExpanded] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const saveTimerRef = useRef(null)
  const textareaRefsMap = useRef({})

  const { data: trade, mutate: mutateTrade } = useSWR(
    tradeId ? `/api/journal/${tradeId}` : null,
    async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(res.status)
      return res.json()
    },
    { dedupingInterval: 5000, revalidateOnFocus: false }
  )

  const { data: execData, mutate: mutateExecs } = useSWR(
    tradeId ? `/api/journal/${tradeId}/executions` : null,
    fetcher,
    { dedupingInterval: 10000, revalidateOnFocus: false }
  )

  const executions = Array.isArray(execData) ? execData : []

  const { data: screenshotData } = useSWR(
    tradeId ? `/api/journal/${tradeId}/screenshots` : null,
    fetcher,
    { dedupingInterval: 10000, revalidateOnFocus: false }
  )
  const screenshotCount = Array.isArray(screenshotData) ? screenshotData.length : 0

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Build chart markers from trade data
  const chartMarkers = useMemo(() => {
    if (!trade) return []
    const markers = []
    if (trade.entry_price && trade.entry_date) {
      markers.push({
        time: trade.entry_date,
        position: 'belowBar',
        color: '#3cb868',
        shape: 'arrowUp',
        text: trade.direction === 'short' ? 'SHORT' : 'BUY',
      })
    }
    if (trade.exit_price && trade.exit_date) {
      markers.push({
        time: trade.exit_date,
        position: 'aboveBar',
        color: '#e74c3c',
        shape: 'arrowDown',
        text: trade.status === 'stopped' ? 'STOP' : (trade.direction === 'short' ? 'COVER' : 'SELL'),
      })
    }
    executions.forEach(ex => {
      const isEntry = ['entry', 'add'].includes(ex.exec_type)
      markers.push({
        time: ex.exec_date,
        position: isEntry ? 'belowBar' : 'aboveBar',
        color: isEntry ? '#3cb868' : '#e74c3c',
        shape: isEntry ? 'arrowUp' : 'arrowDown',
        text: ex.exec_type.toUpperCase(),
      })
    })
    return markers
  }, [trade, executions])

  // Build price lines
  const priceLines = useMemo(() => {
    if (!trade) return []
    const lines = []
    if (trade.stop_price) {
      lines.push({
        price: trade.stop_price,
        color: '#e74c3c',
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: 'STOP',
      })
    }
    if (trade.target_price) {
      lines.push({
        price: trade.target_price,
        color: '#3cb868',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'TARGET',
      })
    }
    if (trade.entry_price) {
      lines.push({
        price: trade.entry_price,
        color: '#c9a84c',
        lineWidth: 1,
        lineStyle: 1, // dotted
        axisLabelVisible: true,
        title: 'ENTRY',
      })
    }
    return lines
  }, [trade])

  // Auto-save handler (debounced)
  const saveField = useCallback((updates) => {
    if (!tradeId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/journal/${tradeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        mutateTrade()
        if (onTradeUpdated) onTradeUpdated()
      } catch (err) {
        console.error('Save failed:', err)
      }
    }, 500)
  }, [tradeId, mutateTrade, onTradeUpdated])

  // Save unsaved textarea content when switching drawer tabs
  useEffect(() => {
    return () => {
      // On tab change, flush any pending textarea values
      const refs = textareaRefsMap.current
      if (!refs || !tradeId) return
      const updates = {}
      Object.entries(refs).forEach(([field, el]) => {
        if (el && el.value !== undefined) {
          const original = trade?.[field] || ''
          if (el.value !== original) {
            updates[field] = el.value
          }
        }
      })
      if (Object.keys(updates).length > 0) {
        // Fire-and-forget save
        fetch(`/api/journal/${tradeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }).then(() => {
          mutateTrade()
          if (onTradeUpdated) onTradeUpdated()
        }).catch(err => console.error('Tab-switch save failed:', err))
      }
    }
  }, [activeTab])

  // Delete trade handler
  const handleDeleteTrade = useCallback(async () => {
    if (!window.confirm('Delete this trade and all its data? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/journal/${tradeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      onClose()
      if (onTradeUpdated) onTradeUpdated()
    } catch (err) {
      console.error('Delete trade failed:', err)
    } finally {
      setDeleting(false)
    }
  }, [tradeId, onClose, onTradeUpdated])

  // Update review status handler
  const handleSetReviewStatus = useCallback(async (status) => {
    try {
      await fetch(`/api/journal/${tradeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: status }),
      })
      mutateTrade()
      if (onTradeUpdated) onTradeUpdated()
    } catch (err) {
      console.error('Review status update failed:', err)
    }
  }, [tradeId, mutateTrade, onTradeUpdated])

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (!trade) {
    return (
      <div className={styles.backdrop} onClick={onClose}>
        <div className={`${styles.drawer} ${expanded ? styles.drawerExpanded : ''}`} onClick={e => e.stopPropagation()}>
          <div className={styles.loadingWrap}>
            <div className={styles.loadingDot} />
            <span>Loading trade...</span>
          </div>
        </div>
      </div>
    )
  }

  const reviewStyle = REVIEW_COLORS[trade.review_status] || REVIEW_COLORS.draft
  const reviewLabel = trade.review_status === 'follow_up' ? 'FOLLOW-UP' : (trade.review_status || 'DRAFT').toUpperCase()

  function fmtPrice(v) {
    if (v == null) return '--'
    return `$${Number(v).toFixed(2)}`
  }

  function fmtR(v) {
    if (v == null) return '--'
    return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}R`
  }

  function fmtHoldingTime(minutes) {
    if (minutes == null) return '--'
    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    const days = Math.floor(minutes / 1440)
    return `${days}d`
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.drawer} ${expanded ? styles.drawerExpanded : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerSym}>{trade.sym}</span>
            <span className={trade.direction === 'short' ? styles.dirShort : styles.dirLong}>
              {(trade.direction || 'long').toUpperCase()}
            </span>
            {trade.pnl_pct != null && (
              <span className={trade.pnl_pct >= 0 ? styles.headerPnlGain : styles.headerPnlLoss}>
                {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(2)}%
              </span>
            )}
            {trade.realized_r != null && (
              <span className={styles.headerR}>{fmtR(trade.realized_r)}</span>
            )}
            <span
              className={styles.headerReview}
              style={{ background: reviewStyle.bg, color: reviewStyle.color, borderColor: reviewStyle.border }}
            >
              {reviewLabel}
            </span>
          </div>
          <div className={styles.headerRight}>
            <button
              className={styles.actionBtnGreen}
              onClick={() => handleSetReviewStatus('reviewed')}
              title="Mark Reviewed"
            >
              Reviewed
            </button>
            <button
              className={styles.actionBtnRed}
              onClick={() => handleSetReviewStatus('flagged')}
              title="Flag for Review"
            >
              Flag
            </button>
            <button
              className={styles.actionBtnEdit}
              onClick={() => setShowEditForm(prev => !prev)}
              title="Edit Trade"
            >
              Edit
            </button>
            <button
              className={styles.actionBtnDelete}
              onClick={handleDeleteTrade}
              disabled={deleting}
              title="Delete Trade"
            >
              {deleting ? '...' : '\u2715'}
            </button>
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded(prev => !prev)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? '\u21E4' : '\u21E5'}
            </button>
            <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">
              \u00D7
            </button>
          </div>
        </div>

        {/* Inline edit form */}
        {showEditForm && (
          <div className={styles.editFormWrap}>
            <TradeForm
              isEdit
              initial={trade}
              onSave={() => {
                setShowEditForm(false)
                mutateTrade()
                if (onTradeUpdated) onTradeUpdated()
              }}
              onCancel={() => setShowEditForm(false)}
            />
          </div>
        )}

        {/* Drawer tabs */}
        <div className={styles.tabBar}>
          {DRAWER_TABS.map(tab => (
            <button
              key={tab.key}
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content + Review progress sidebar */}
        <div className={styles.body}>
          <div className={styles.bodyContent}>
            {/* ── Summary Tab ── */}
            {activeTab === 'summary' && (
              <div className={styles.summaryTab}>
                {/* Chart */}
                <div className={styles.chartWrap}>
                  <div className={styles.chartTfBar}>
                    {CHART_TFS.map(tf => (
                      <button
                        key={tf.key}
                        className={`${styles.chartTfBtn} ${chartTf === tf.key ? styles.chartTfBtnActive : ''}`}
                        onClick={() => setChartTf(tf.key)}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                  {trade.sym && (
                    <StockChart
                      sym={trade.sym}
                      tf={chartTf}
                      height={280}
                      markers={chartMarkers}
                      priceLines={priceLines}
                    />
                  )}
                </div>

                {/* Metrics grid */}
                <div className={styles.metricsGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Entry</span>
                    <span className={styles.metricValue}>{fmtPrice(trade.entry_price)}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Exit</span>
                    <span className={styles.metricValue}>{fmtPrice(trade.exit_price)}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Stop</span>
                    <span className={`${styles.metricValue} ${styles.metricLoss}`}>{fmtPrice(trade.stop_price)}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Target</span>
                    <span className={`${styles.metricValue} ${styles.metricGain}`}>{fmtPrice(trade.target_price)}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Shares</span>
                    <span className={styles.metricValue}>{trade.shares ?? '--'}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Fees</span>
                    <span className={styles.metricValue}>{trade.fees ? `$${trade.fees.toFixed(2)}` : '--'}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Risk $</span>
                    <span className={styles.metricValue}>{trade.risk_dollars ? `$${trade.risk_dollars.toFixed(0)}` : '--'}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>R:R</span>
                    <span className={styles.metricValue}>{trade.planned_r != null ? `${trade.planned_r.toFixed(1)}:1` : '--'}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Holding</span>
                    <span className={styles.metricValue}>{fmtHoldingTime(trade.holding_minutes)}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>P&L $</span>
                    <span className={`${styles.metricValue} ${trade.pnl_dollar > 0 ? styles.metricGain : trade.pnl_dollar < 0 ? styles.metricLoss : ''}`}>
                      {trade.pnl_dollar != null ? `${trade.pnl_dollar >= 0 ? '+' : ''}$${Math.abs(trade.pnl_dollar).toFixed(0)}` : '--'}
                    </span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>P&L %</span>
                    <span className={`${styles.metricValue} ${trade.pnl_pct > 0 ? styles.metricGain : trade.pnl_pct < 0 ? styles.metricLoss : ''}`}>
                      {trade.pnl_pct != null ? `${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(2)}%` : '--'}
                    </span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Account</span>
                    <span className={styles.metricValue}>{trade.account || 'default'}</span>
                  </div>
                </div>

                {/* Thesis */}
                {trade.thesis && (
                  <div className={styles.textSection}>
                    <div className={styles.textLabel}>Thesis</div>
                    <div className={styles.textBody}>{trade.thesis}</div>
                  </div>
                )}

                {/* Market context */}
                {trade.market_context && (
                  <div className={styles.textSection}>
                    <div className={styles.textLabel}>Market Context</div>
                    <div className={styles.textBody}>{trade.market_context}</div>
                  </div>
                )}

                {/* Setup */}
                {trade.setup && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Setup</span>
                    <span className={styles.detailValue}>{trade.setup}</span>
                  </div>
                )}
                {trade.entry_date && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Entry Date</span>
                    <span className={styles.detailValue}>
                      {trade.entry_date}{trade.entry_time ? ` ${trade.entry_time}` : ''}
                    </span>
                  </div>
                )}
                {trade.exit_date && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Exit Date</span>
                    <span className={styles.detailValue}>
                      {trade.exit_date}{trade.exit_time ? ` ${trade.exit_time}` : ''}
                    </span>
                  </div>
                )}

                {/* AI Summary */}
                <AISummary
                  tradeId={tradeId}
                  aiSummary={trade.ai_summary}
                  onUpdated={() => {
                    mutateTrade()
                    if (onTradeUpdated) onTradeUpdated()
                  }}
                />
              </div>
            )}

            {/* ── Executions Tab ── */}
            {activeTab === 'executions' && (
              <ExecutionsList
                tradeId={tradeId}
                executions={executions}
                mutateExecs={mutateExecs}
                mutateTrade={mutateTrade}
              />
            )}

            {/* ── Process Tab ── */}
            {activeTab === 'process' && (
              <div className={styles.processTab}>
                <ProcessScoreCard trade={trade} onUpdate={saveField} />
                <div className={styles.processDivider} />
                <div className={styles.emotionSection}>
                  <div className={styles.sectionLabel}>Emotional State</div>
                  <EmotionSelector
                    selected={trade.emotion_tags || ''}
                    onChange={(val) => saveField({ emotion_tags: val })}
                  />
                </div>
              </div>
            )}

            {/* ── Notes Tab ── */}
            {activeTab === 'notes' && (
              <div className={styles.notesTab}>
                <div className={styles.noteField}>
                  <label className={styles.noteLabel}>Notes</label>
                  <textarea
                    key={`notes-${tradeId}`}
                    ref={el => { textareaRefsMap.current.notes = el }}
                    className={styles.noteTextarea}
                    defaultValue={trade.notes || ''}
                    placeholder="What happened during this trade? What did you observe?"
                    maxLength={5000}
                    onBlur={e => {
                      if (e.target.value !== (trade.notes || '')) {
                        saveField({ notes: e.target.value })
                      }
                    }}
                  />
                </div>
                <div className={styles.noteField}>
                  <label className={styles.noteLabel}>Lesson</label>
                  <textarea
                    key={`lesson-${tradeId}`}
                    ref={el => { textareaRefsMap.current.lesson = el }}
                    className={styles.noteTextarea}
                    defaultValue={trade.lesson || ''}
                    placeholder="If you could trade this again, what would you change?"
                    maxLength={5000}
                    onBlur={e => {
                      if (e.target.value !== (trade.lesson || '')) {
                        saveField({ lesson: e.target.value })
                      }
                    }}
                  />
                </div>
                <div className={styles.noteField}>
                  <label className={styles.noteLabel}>Follow-up</label>
                  <textarea
                    key={`followup-${tradeId}`}
                    ref={el => { textareaRefsMap.current.follow_up = el }}
                    className={`${styles.noteTextarea} ${styles.noteTextareaSmall}`}
                    defaultValue={trade.follow_up || ''}
                    placeholder="Any action items for next time?"
                    maxLength={2000}
                    onBlur={e => {
                      if (e.target.value !== (trade.follow_up || '')) {
                        saveField({ follow_up: e.target.value })
                      }
                    }}
                  />
                </div>
                <div className={styles.screenshotSection}>
                  <div className={styles.sectionLabel}>Screenshots</div>
                  <ScreenshotUploader tradeId={tradeId} />
                </div>
              </div>
            )}

            {/* ── Mistakes Tab ── */}
            {activeTab === 'mistakes' && (
              <div className={styles.mistakesTab}>
                <MistakeSelector
                  selected={trade.mistake_tags || ''}
                  onChange={(val) => saveField({ mistake_tags: val })}
                />
              </div>
            )}

          </div>

          {/* Review progress sidebar */}
          <ReviewProgress trade={{ ...trade, _has_screenshots: screenshotCount > 0 }} />
        </div>
      </div>
    </div>
  )
}
