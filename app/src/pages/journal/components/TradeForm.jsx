// app/src/pages/journal/components/TradeForm.jsx
import { useState, useCallback, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import styles from './TradeForm.module.css'

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

const SESSIONS = ['pre-market', 'regular', 'after-hours', 'overnight']
const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5]

const EMPTY_FORM = {
  sym: '',
  direction: 'long',
  setup: '',
  playbook_id: '',
  entry_date: new Date().toISOString().slice(0, 10),
  entry_time: '',
  entry_price: '',
  stop_price: '',
  target_price: '',
  exit_price: '',
  exit_date: '',
  exit_time: '',
  shares: '',
  fees: '',
  account: '',
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
        playbook_id: initial.playbook_id ?? '',
        entry_date: initial.entry_date || '',
        entry_time: initial.entry_time || '',
        entry_price: initial.entry_price ?? '',
        stop_price: initial.stop_price ?? '',
        target_price: initial.target_price ?? '',
        exit_price: initial.exit_price ?? '',
        exit_date: initial.exit_date || '',
        exit_time: initial.exit_time || '',
        shares: initial.shares ?? '',
        fees: initial.fees ?? '',
        account: initial.account || '',
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
  const [exitOpen, setExitOpen] = useState(() => {
    return initial ? (initial.status !== 'open' || !!initial.exit_price) : false
  })

  // Fetch accounts
  const { data: accountsData } = useSWR('/api/journal/accounts', fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60000,
  })
  const accounts = accountsData || []

  // Fetch playbooks
  const { data: playbooksData } = useSWR('/api/journal/playbooks', fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60000,
  })
  const playbooks = (playbooksData?.playbooks || playbooksData || [])

  // Pre-select default account
  useEffect(() => {
    if (!form.account && accounts.length > 0) {
      const def = accounts.find(a => a.is_default) || accounts[0]
      if (def) setForm(prev => ({ ...prev, account: def.name }))
    }
  }, [accounts])

  const set = useCallback((key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  // Auto-calculations
  const calc = useMemo(() => {
    const entry = parseFloat(form.entry_price)
    const stop = parseFloat(form.stop_price)
    const target = parseFloat(form.target_price)
    const shares = parseFloat(form.shares)
    const isShort = form.direction === 'short'

    let riskPerShare = null
    let rewardPerShare = null
    let riskDollar = null
    let rewardDollar = null
    let plannedR = null
    let positionValue = null
    let sizePct = null

    if (entry && stop) {
      riskPerShare = Math.abs(entry - stop)
    }
    if (entry && target) {
      rewardPerShare = isShort ? (entry - target) : (target - entry)
    }
    if (riskPerShare && shares) {
      riskDollar = riskPerShare * shares
    }
    if (rewardPerShare && shares) {
      rewardDollar = rewardPerShare * shares
    }
    if (riskPerShare > 0 && rewardPerShare != null) {
      plannedR = rewardPerShare / riskPerShare
    }
    if (entry && shares) {
      positionValue = entry * shares
    }

    // Size % requires account balance
    const selectedAccount = accounts.find(a => a.name === form.account)
    const balance = selectedAccount?.balance
    if (positionValue && balance && balance > 0) {
      sizePct = (positionValue / balance) * 100
    }

    return { riskPerShare, rewardPerShare, riskDollar, rewardDollar, plannedR, positionValue, sizePct }
  }, [form.entry_price, form.stop_price, form.target_price, form.shares, form.direction, form.account, accounts])

  // Risk/Reward bar proportions
  const rrBar = useMemo(() => {
    if (calc.riskDollar == null || calc.rewardDollar == null) return null
    const risk = Math.abs(calc.riskDollar)
    const reward = Math.max(0, calc.rewardDollar)
    const total = risk + reward
    if (total === 0) return null
    return { riskPct: (risk / total) * 100, rewardPct: (reward / total) * 100 }
  }, [calc.riskDollar, calc.rewardDollar])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.sym.trim()) return
    if (!form.entry_price) return
    if (!form.entry_date) return

    setSaving(true)
    setError(null)
    try {
      const body = {
        sym: form.sym.trim().toUpperCase(),
        direction: form.direction,
        setup: form.setup || null,
        playbook_id: form.playbook_id ? parseInt(form.playbook_id) : null,
        entry_date: form.entry_date,
        entry_time: form.entry_time || null,
        entry_price: parseFloat(form.entry_price),
        stop_price: form.stop_price !== '' ? parseFloat(form.stop_price) : null,
        target_price: form.target_price !== '' ? parseFloat(form.target_price) : null,
        exit_price: form.exit_price !== '' ? parseFloat(form.exit_price) : null,
        exit_date: form.exit_date || null,
        exit_time: form.exit_time || null,
        shares: form.shares !== '' ? parseFloat(form.shares) : null,
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

  function fmtDollar(v) {
    if (v == null || isNaN(v)) return '--'
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '--'
    return `${v.toFixed(1)}%`
  }

  function fmtR(v) {
    if (v == null || isNaN(v)) return '--'
    return `1:${v.toFixed(1)}`
  }

  const hasRiskReward = calc.riskDollar != null || calc.plannedR != null || calc.sizePct != null

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {/* Section 1: Trade Info */}
      <div className={styles.sectionLabel}>Trade Info</div>
      <div className={styles.row}>
        <div className={styles.group}>
          <label className={styles.label}>Ticker *</label>
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
          <label className={styles.label}>Account</label>
          <select
            className={`${styles.input} ${styles.inputWide}`}
            value={form.account}
            onChange={e => set('account', e.target.value)}
          >
            <option value="">Select account...</option>
            {accounts.map(a => (
              <option key={a.name} value={a.name}>
                {a.name}{a.balance ? ` \u2014 $${Number(a.balance).toLocaleString()}` : ''}
              </option>
            ))}
            {accounts.length === 0 && (
              <option value="default">Default Account</option>
            )}
          </select>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Entry Date *</label>
          <input
            className={styles.input}
            type="date"
            value={form.entry_date}
            onChange={e => set('entry_date', e.target.value)}
            required
          />
        </div>
      </div>

      {/* Section 2: Execution */}
      <div className={styles.sectionLabel}>Execution</div>
      <div className={styles.row}>
        <div className={styles.group}>
          <label className={styles.label}>Entry Price *</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.entry_price}
            onChange={e => set('entry_price', e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Stop Price</label>
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
          <label className={styles.label}>Target Price</label>
          <input
            className={styles.input}
            type="number"
            step="0.01"
            value={form.target_price}
            onChange={e => set('target_price', e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Risk/Reward Panel */}
      {hasRiskReward && (
        <div className={styles.rrPanel}>
          <div className={styles.rrStats}>
            <div className={styles.rrStat}>
              <span className={styles.rrStatLabel}>Risk</span>
              <span className={`${styles.rrStatValue} ${styles.rrStatRisk}`}>
                {fmtDollar(calc.riskDollar)}
              </span>
            </div>
            <div className={styles.rrDivider} />
            <div className={styles.rrStat}>
              <span className={styles.rrStatLabel}>Reward</span>
              <span className={`${styles.rrStatValue} ${styles.rrStatReward}`}>
                {calc.rewardDollar != null ? fmtDollar(calc.rewardDollar) : '--'}
              </span>
            </div>
            <div className={styles.rrDivider} />
            <div className={styles.rrStat}>
              <span className={styles.rrStatLabel}>R:R</span>
              <span className={`${styles.rrStatValue} ${styles.rrStatRR}`}>
                {fmtR(calc.plannedR)}
              </span>
            </div>
            <div className={styles.rrDivider} />
            <div className={styles.rrStat}>
              <span className={styles.rrStatLabel}>Size</span>
              <span className={styles.rrStatValue}>
                {fmtPct(calc.sizePct)}
              </span>
            </div>
          </div>
          {rrBar && (
            <div className={styles.rrBarWrap}>
              <div className={styles.rrBar}>
                <div className={styles.rrBarRisk} style={{ width: `${rrBar.riskPct}%` }} />
                <div className={styles.rrBarReward} style={{ width: `${rrBar.rewardPct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

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
        {calc.positionValue != null && (
          <div className={styles.calcReadout}>
            <span className={styles.calcLabel}>Value</span>
            <span className={styles.calcValue}>{fmtDollar(calc.positionValue)}</span>
          </div>
        )}
        {calc.riskDollar != null && (
          <div className={styles.calcReadout}>
            <span className={styles.calcLabel}>Risk $</span>
            <span className={`${styles.calcValue} ${styles.calcRisk}`}>{fmtDollar(calc.riskDollar)}</span>
          </div>
        )}
        {calc.sizePct != null && (
          <div className={styles.calcReadout}>
            <span className={styles.calcLabel}>Size %</span>
            <span className={styles.calcValue}>{fmtPct(calc.sizePct)}</span>
          </div>
        )}
      </div>

      {/* Section 4: Context */}
      <div className={styles.sectionLabel}>Context</div>
      <div className={styles.contextRow}>
        <div className={styles.group}>
          <label className={styles.label}>Setup</label>
          <select className={`${styles.input} ${styles.inputWide}`} value={form.setup} onChange={e => set('setup', e.target.value)}>
            <option value="">Select setup...</option>
            {SETUP_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.setups.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className={styles.group}>
          <label className={styles.label}>Playbook</label>
          <select
            className={`${styles.input} ${styles.inputWide}`}
            value={form.playbook_id}
            onChange={e => set('playbook_id', e.target.value)}
          >
            <option value="">No playbook</option>
            {Array.isArray(playbooks) && playbooks.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
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
      </div>
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
          <label className={styles.label}>Tags</label>
          <input
            className={`${styles.input} ${styles.inputWide}`}
            type="text"
            value={form.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="earnings, sector-rotation"
            maxLength={500}
          />
        </div>
      </div>

      {/* Section 5: Notes */}
      <div className={styles.sectionLabel}>Notes</div>
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

      {/* Section 6: Exit (collapsible) */}
      <div
        className={styles.exitToggle}
        onClick={() => setExitOpen(prev => !prev)}
      >
        <span className={styles.exitToggleIcon}>{exitOpen ? '\u25BE' : '\u25B8'}</span>
        <span className={styles.sectionLabel} style={{ margin: 0, border: 'none', paddingBottom: 0 }}>
          Exit Details
        </span>
        {form.status !== 'open' && (
          <span className={styles.exitBadge}>{form.status.toUpperCase()}</span>
        )}
      </div>
      {exitOpen && (
        <div className={styles.row}>
          <div className={styles.group}>
            <label className={styles.label}>Exit Price</label>
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
        </div>
      )}

      {/* Error + Actions */}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          className={styles.submitBtn}
          type="submit"
          disabled={saving || !form.sym.trim() || !form.entry_price || !form.entry_date}
        >
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
