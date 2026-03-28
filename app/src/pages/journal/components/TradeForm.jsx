// app/src/pages/journal/components/TradeForm.jsx
import { useState, useCallback } from 'react'
import styles from './TradeForm.module.css'

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

const SESSIONS = ['pre-market', 'regular', 'after-hours', 'overnight']
const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5]

const EMPTY_FORM = {
  sym: '',
  direction: 'long',
  setup: '',
  entry_date: new Date().toISOString().slice(0, 10),
  entry_time: '',
  entry_price: '',
  stop_price: '',
  target_price: '',
  exit_price: '',
  exit_date: '',
  exit_time: '',
  shares: '',
  size_pct: '',
  risk_dollars: '',
  fees: '',
  account: 'default',
  thesis: '',
  market_context: '',
  confidence: '',
  session: '',
  strategy: '',
  tags: '',
  status: 'open',
}

export default function TradeForm({ initial, onSave, onCancel, isEdit = false }) {
  const [form, setForm] = useState(() => {
    if (initial) {
      return {
        sym: initial.sym || '',
        direction: initial.direction || 'long',
        setup: initial.setup || '',
        entry_date: initial.entry_date || '',
        entry_time: initial.entry_time || '',
        entry_price: initial.entry_price ?? '',
        stop_price: initial.stop_price ?? '',
        target_price: initial.target_price ?? '',
        exit_price: initial.exit_price ?? '',
        exit_date: initial.exit_date || '',
        exit_time: initial.exit_time || '',
        shares: initial.shares ?? '',
        size_pct: initial.size_pct ?? '',
        risk_dollars: initial.risk_dollars ?? '',
        fees: initial.fees ?? '',
        account: initial.account || 'default',
        thesis: initial.thesis || '',
        market_context: initial.market_context || '',
        confidence: initial.confidence ?? '',
        session: initial.session || '',
        strategy: initial.strategy || '',
        tags: initial.tags || '',
        status: initial.status || 'open',
      }
    }
    return { ...EMPTY_FORM }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = useCallback((key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.sym.trim()) return

    setSaving(true)
    setError(null)
    try {
      const body = {
        sym: form.sym.trim(),
        direction: form.direction,
        setup: form.setup,
        entry_date: form.entry_date || new Date().toISOString().slice(0, 10),
        entry_time: form.entry_time || null,
        entry_price: form.entry_price !== '' ? parseFloat(form.entry_price) : null,
        stop_price: form.stop_price !== '' ? parseFloat(form.stop_price) : null,
        target_price: form.target_price !== '' ? parseFloat(form.target_price) : null,
        exit_price: form.exit_price !== '' ? parseFloat(form.exit_price) : null,
        exit_date: form.exit_date || null,
        exit_time: form.exit_time || null,
        shares: form.shares !== '' ? parseFloat(form.shares) : null,
        size_pct: form.size_pct !== '' ? parseFloat(form.size_pct) : null,
        risk_dollars: form.risk_dollars !== '' ? parseFloat(form.risk_dollars) : null,
        fees: form.fees !== '' ? parseFloat(form.fees) : null,
        account: form.account || 'default',
        thesis: form.thesis,
        market_context: form.market_context,
        confidence: form.confidence !== '' ? parseInt(form.confidence) : null,
        session: form.session || null,
        strategy: form.strategy,
        tags: form.tags,
        status: form.status,
      }

      const url = isEdit && initial?.id ? `/api/journal/${initial.id}` : '/api/journal'
      const method = isEdit && initial?.id ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to save trade')
      }
      if (onSave) onSave()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Compute R:R preview
  const entryP = parseFloat(form.entry_price)
  const stopP = parseFloat(form.stop_price)
  const targetP = parseFloat(form.target_price)
  let rrPreview = null
  if (entryP && stopP && targetP && entryP !== stopP) {
    const risk = Math.abs(entryP - stopP)
    const reward = form.direction === 'short'
      ? entryP - targetP
      : targetP - entryP
    if (risk > 0) rrPreview = (reward / risk).toFixed(1)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {/* Section 1: Core */}
      <div className={styles.sectionLabel}>Trade Details</div>
      <div className={styles.row}>
        <div className={styles.group}>
          <label className={styles.label}>Ticker</label>
          <input
            className={styles.input}
            value={form.sym}
            onChange={e => set('sym', e.target.value.toUpperCase())}
            placeholder="AAPL"
            maxLength={10}
            required
            autoFocus
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Direction</label>
          <div className={styles.dirToggle}>
            <button
              type="button"
              className={`${styles.dirBtn} ${form.direction === 'long' ? styles.dirBtnLongActive : ''}`}
              onClick={() => set('direction', 'long')}
            >LONG</button>
            <button
              type="button"
              className={`${styles.dirBtn} ${form.direction === 'short' ? styles.dirBtnShortActive : ''}`}
              onClick={() => set('direction', 'short')}
            >SHORT</button>
          </div>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Setup</label>
          <select className={styles.input} value={form.setup} onChange={e => set('setup', e.target.value)}>
            <option value="">Select...</option>
            {SETUP_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.setups.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Status</label>
          <select className={styles.input} value={form.status}
            onChange={e => setForm(f => ({...f, status: e.target.value}))}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Entry Date</label>
          <input
            className={styles.input}
            type="date"
            value={form.entry_date}
            onChange={e => set('entry_date', e.target.value)}
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Entry Time</label>
          <input
            className={`${styles.input} ${styles.inputNarrow}`}
            type="time"
            value={form.entry_time}
            onChange={e => set('entry_time', e.target.value)}
          />
        </div>
      </div>

      {/* Section 2: Prices */}
      <div className={styles.sectionLabel}>Prices</div>
      <div className={styles.row}>
        <div className={styles.group}>
          <label className={styles.label}>Entry $</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.entry_price}
            onChange={e => set('entry_price', e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Stop $</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.stop_price}
            onChange={e => set('stop_price', e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Target $</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.target_price}
            onChange={e => set('target_price', e.target.value)}
            placeholder="0.00"
          />
        </div>
        {rrPreview != null && (
          <div className={styles.rrPreview}>
            <span className={styles.rrLabel}>R:R</span>
            <span className={styles.rrValue}>{rrPreview}:1</span>
          </div>
        )}
        <div className={styles.group}>
          <label className={styles.label}>Exit $</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.exit_price}
            onChange={e => set('exit_price', e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Exit Date</label>
          <input
            className={styles.input}
            type="date"
            value={form.exit_date}
            onChange={e => set('exit_date', e.target.value)}
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Exit Time</label>
          <input
            className={`${styles.input} ${styles.inputNarrow}`}
            type="time"
            value={form.exit_time}
            onChange={e => set('exit_time', e.target.value)}
          />
        </div>
      </div>

      {/* Section 3: Position */}
      <div className={styles.sectionLabel}>Position</div>
      <div className={styles.row}>
        <div className={styles.group}>
          <label className={styles.label}>Shares</label>
          <input
            className={styles.input}
            type="number"
            step="1"
            value={form.shares}
            onChange={e => set('shares', e.target.value)}
            placeholder="100"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Size %</label>
          <input
            className={styles.input}
            type="number"
            step="0.5"
            value={form.size_pct}
            onChange={e => set('size_pct', e.target.value)}
            placeholder="5.0"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Risk $</label>
          <input
            className={styles.input}
            type="number"
            step="1"
            value={form.risk_dollars}
            onChange={e => set('risk_dollars', e.target.value)}
            placeholder="250"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Fees</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.fees}
            onChange={e => set('fees', e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Account</label>
          <input
            className={styles.input}
            type="text"
            value={form.account}
            onChange={e => set('account', e.target.value)}
            placeholder="default"
            maxLength={50}
          />
        </div>
      </div>

      {/* Section 4: Context */}
      <div className={styles.sectionLabel}>Context</div>
      <div className={styles.contextRow}>
        <div className={styles.group}>
          <label className={styles.label}>Confidence</label>
          <div className={styles.confidencePills}>
            {CONFIDENCE_LEVELS.map(level => (
              <button
                key={level}
                type="button"
                className={`${styles.confPill} ${parseInt(form.confidence) === level ? styles.confPillActive : ''}`}
                onClick={() => set('confidence', parseInt(form.confidence) === level ? '' : level)}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Session</label>
          <select className={styles.input} value={form.session} onChange={e => set('session', e.target.value)}>
            <option value="">--</option>
            {SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Strategy</label>
          <input
            className={styles.input}
            type="text"
            value={form.strategy}
            onChange={e => set('strategy', e.target.value)}
            placeholder="Momentum"
            maxLength={100}
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Tags</label>
          <input
            className={styles.input}
            type="text"
            value={form.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="earnings, sector-rotation"
            maxLength={500}
          />
        </div>
      </div>
      <div className={styles.textareaRow}>
        <div className={styles.textareaGroup}>
          <label className={styles.label}>Thesis</label>
          <textarea
            className={styles.textarea}
            value={form.thesis}
            onChange={e => set('thesis', e.target.value)}
            placeholder="Entry thesis and rationale..."
            maxLength={5000}
          />
        </div>
        <div className={styles.textareaGroup}>
          <label className={styles.label}>Market Context</label>
          <textarea
            className={styles.textarea}
            value={form.market_context}
            onChange={e => set('market_context', e.target.value)}
            placeholder="Market regime, sector conditions..."
            maxLength={2000}
          />
        </div>
      </div>

      {/* Error + Actions */}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button className={styles.submitBtn} type="submit" disabled={saving || !form.sym.trim()}>
          {saving ? 'Saving...' : isEdit ? 'Update Trade' : 'Add Trade'}
        </button>
        {onCancel && (
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
