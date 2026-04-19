/**
 * Portfolio Settings Modal — Journal 2.0.
 * Spec §5.
 *
 * Six sections: Account, Default Stop, Position Closing, Breakeven
 * Range, Trade Setups, Journal Columns. Cancel discards; Save persists
 * via the useJ2Settings hook. Local form state; initialized from the
 * hook's `settings` on open.
 */

import { useEffect, useState, useCallback, useId } from 'react'
import styles from './PortfolioSettingsModal.module.css'

const INDEX_OPTIONS = ['NYA', 'SPX', 'COMPQ', 'IWM', 'DJI']
const BREADTH_OPTIONS = [
  'NASI RSI',
  'NYSI RSI',
  '% Above 50MA',
  '% Above 200MA',
  'NH-NL',
  'Breadth Score',
]

const STOP_MODES = [
  {
    mode: 'custom',
    title: 'Custom',
    subtitle: 'No auto-fill — you enter the stop manually',
  },
  {
    mode: 'bar_low_high',
    title: 'Bar Low / High',
    subtitle: "Long: bar's low minus buffer • Short: bar's high plus buffer",
  },
  {
    mode: 'fixed_dollar_risk',
    title: 'Fixed $ Risk',
    subtitle: 'Stop placed so total risk = the $ amount below',
  },
  {
    mode: 'fixed_percent_distance',
    title: 'Fixed % Distance',
    subtitle: 'Stop placed this % from entry price',
  },
]

/**
 * Build a canonical defaultStop object from the form's working values.
 */
function buildDefaultStop(mode, barBuffer, barBufferUnit, fixedAmount, fixedPercent) {
  switch (mode) {
    case 'custom':
      return { mode: 'custom' }
    case 'bar_low_high':
      return {
        mode: 'bar_low_high',
        buffer: Number(barBuffer) || 0,
        bufferUnit: barBufferUnit,
      }
    case 'fixed_dollar_risk':
      return { mode: 'fixed_dollar_risk', amount: Number(fixedAmount) || 0 }
    case 'fixed_percent_distance':
      return {
        mode: 'fixed_percent_distance',
        percent: Number(fixedPercent) || 0,
      }
    default:
      return { mode: 'custom' }
  }
}

export default function PortfolioSettingsModal({ settings, onSave, onClose }) {
  // Local form state seeded from props.settings. Saving writes this
  // back through useJ2Settings.save(). Cancel discards local state.
  const [accountSize, setAccountSize] = useState(settings?.accountSize ?? 100_000)
  const [stopMode, setStopMode] = useState(settings?.defaultStop?.mode ?? 'custom')
  const [barBuffer, setBarBuffer] = useState(
    settings?.defaultStop?.mode === 'bar_low_high' ? settings.defaultStop.buffer : 0,
  )
  const [barBufferUnit, setBarBufferUnit] = useState(
    settings?.defaultStop?.mode === 'bar_low_high' ? settings.defaultStop.bufferUnit : '$',
  )
  const [fixedAmount, setFixedAmount] = useState(
    settings?.defaultStop?.mode === 'fixed_dollar_risk' ? settings.defaultStop.amount : 250,
  )
  const [fixedPercent, setFixedPercent] = useState(
    settings?.defaultStop?.mode === 'fixed_percent_distance'
      ? settings.defaultStop.percent
      : 7,
  )
  const [closing, setClosing] = useState(settings?.positionClosing ?? 'FIFO')
  const [beUnit, setBeUnit] = useState(settings?.breakevenRange?.unit ?? '$')
  const [beValue, setBeValue] = useState(settings?.breakevenRange?.value ?? 0)
  const [setups, setSetups] = useState(settings?.setups ?? [])
  const [newSetup, setNewSetup] = useState('')
  const [marketNavIndex, setMarketNavIndex] = useState(
    settings?.journalColumns?.marketNavIndex ?? 'NYA',
  )
  const [breadthMetric, setBreadthMetric] = useState(
    settings?.journalColumns?.breadthMetric ?? 'NASI RSI',
  )
  const [shareJournalData, setShareJournalData] = useState(
    !!settings?.shareJournalData,
  )

  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Focus-trap basics + Esc to close.
  const titleId = useId()
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addSetup = useCallback(() => {
    const s = newSetup.trim()
    if (!s) return
    if (setups.includes(s)) {
      setNewSetup('')
      return
    }
    setSetups((prev) => [...prev, s])
    setNewSetup('')
  }, [newSetup, setups])

  const removeSetup = useCallback((s) => {
    setSetups((prev) => prev.filter((x) => x !== s))
  }, [])

  const handleSave = useCallback(async () => {
    setErrorMsg('')
    const payload = {
      accountSize: Number(accountSize),
      defaultStop: buildDefaultStop(
        stopMode,
        barBuffer,
        barBufferUnit,
        fixedAmount,
        fixedPercent,
      ),
      positionClosing: closing,
      breakevenRange: {
        // enabled is recomputed server-side from value != 0, but we mirror
        // the rule here for an accurate preview before saving.
        enabled: Number(beValue) !== 0,
        unit: beUnit,
        value: Number(beValue),
      },
      setups,
      journalColumns: {
        marketNavIndex,
        breadthMetric,
      },
      shareJournalData,
    }
    setSaving(true)
    try {
      await onSave(payload)
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }, [
    accountSize,
    stopMode,
    barBuffer,
    barBufferUnit,
    fixedAmount,
    fixedPercent,
    closing,
    beUnit,
    beValue,
    setups,
    marketNavIndex,
    breadthMetric,
    shareJournalData,
    onSave,
    onClose,
  ])

  const beDisabled = Number(beValue) === 0

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Portfolio Settings
          </h2>
          <button
            type="button"
            className={styles.xBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          {/* 5.1 ACCOUNT */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>ACCOUNT</h3>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Account Size</span>
              <div className={styles.prefixInput}>
                <span className={styles.prefix}>$</span>
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={accountSize}
                  onChange={(e) => setAccountSize(e.target.value)}
                  className={styles.numberInput}
                />
              </div>
            </label>
          </section>

          {/* 5.2 DEFAULT STOP */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>DEFAULT STOP PLACEMENT</h3>
            <div className={styles.radioCards} role="radiogroup" aria-label="Default stop placement">
              {STOP_MODES.map((opt) => (
                <label
                  key={opt.mode}
                  className={`${styles.radioCard} ${stopMode === opt.mode ? styles.radioCardActive : ''}`}
                >
                  <input
                    type="radio"
                    name="stopMode"
                    value={opt.mode}
                    checked={stopMode === opt.mode}
                    onChange={() => setStopMode(opt.mode)}
                    className={styles.radioInput}
                  />
                  <div className={styles.radioBody}>
                    <div className={styles.radioTitle}>{opt.title}</div>
                    <div className={styles.radioSubtitle}>{opt.subtitle}</div>
                  </div>
                </label>
              ))}
            </div>

            {stopMode === 'bar_low_high' && (
              <div className={styles.stopSub}>
                <label className={styles.inline}>
                  <span>Buffer</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={barBuffer}
                    onChange={(e) => setBarBuffer(e.target.value)}
                    className={styles.numberInputSmall}
                  />
                </label>
                <select
                  value={barBufferUnit}
                  onChange={(e) => setBarBufferUnit(e.target.value)}
                  className={styles.select}
                  aria-label="Buffer unit"
                >
                  <option value="$">$</option>
                  <option value="%">%</option>
                </select>
                <span className={styles.helperInline}>beyond the low / high</span>
              </div>
            )}

            {stopMode === 'fixed_dollar_risk' && (
              <div className={styles.stopSub}>
                <label className={styles.inline}>
                  <span>Amount</span>
                  <div className={styles.prefixInput}>
                    <span className={styles.prefix}>$</span>
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={fixedAmount}
                      onChange={(e) => setFixedAmount(e.target.value)}
                      className={styles.numberInput}
                    />
                  </div>
                </label>
              </div>
            )}

            {stopMode === 'fixed_percent_distance' && (
              <div className={styles.stopSub}>
                <label className={styles.inline}>
                  <span>Percent</span>
                  <input
                    type="number"
                    min={0.01}
                    max={99.99}
                    step="0.1"
                    value={fixedPercent}
                    onChange={(e) => setFixedPercent(e.target.value)}
                    className={styles.numberInputSmall}
                  />
                  <span>%</span>
                </label>
              </div>
            )}
          </section>

          {/* 5.3 POSITION CLOSING */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>POSITION CLOSING</h3>
            <div
              className={styles.pillToggle}
              role="radiogroup"
              aria-label="Position closing method"
            >
              {['FIFO', 'LIFO'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.pill} ${closing === mode ? styles.pillActive : ''}`}
                  onClick={() => setClosing(mode)}
                  aria-pressed={closing === mode}
                >
                  {mode === 'FIFO' ? 'FIFO — First In, First Out' : 'LIFO — Last In, First Out'}
                </button>
              ))}
            </div>
            <p className={styles.helper}>
              {closing === 'FIFO'
                ? 'Oldest positions are closed first when selling same-symbol shares.'
                : 'Newest positions are closed first when selling same-symbol shares.'}
            </p>
          </section>

          {/* 5.4 BREAKEVEN RANGE */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>BREAKEVEN RANGE</h3>
            <p className={styles.helper}>
              Trades within this range are counted as <strong>BE</strong> instead of Win or
              Loss, and are excluded from Avg Win / Avg Loss stats. Set to 0 to disable.
            </p>
            <div className={styles.beRow}>
              <div
                className={styles.unitToggle}
                role="radiogroup"
                aria-label="Breakeven range unit"
              >
                <button
                  type="button"
                  className={`${styles.unitBtn} ${beUnit === '$' ? styles.unitBtnActive : ''}`}
                  onClick={() => setBeUnit('$')}
                  aria-pressed={beUnit === '$'}
                >
                  $ Dollar
                </button>
                <button
                  type="button"
                  className={`${styles.unitBtn} ${beUnit === '%' ? styles.unitBtnActive : ''}`}
                  onClick={() => setBeUnit('%')}
                  aria-pressed={beUnit === '%'}
                >
                  % Return
                </button>
              </div>
              <input
                type="number"
                min={0}
                step="any"
                value={beValue}
                onChange={(e) => setBeValue(e.target.value)}
                className={styles.numberInput}
                aria-label="Breakeven range value"
              />
            </div>
            <p className={`${styles.helper} ${beDisabled ? styles.helperMuted : ''}`}>
              {beDisabled
                ? 'disabled'
                : `trades within ±${beUnit === '$' ? '$' : ''}${beValue}${beUnit === '%' ? '%' : ''} P&L are BE`}
            </p>
          </section>

          {/* 5.5 TRADE SETUPS */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>TRADE SETUPS</h3>
            <p className={styles.helper}>
              Define setup types for your trades (e.g. Breakout, Pullback, Gap-up).
            </p>
            <div className={styles.addRow}>
              <input
                type="text"
                value={newSetup}
                onChange={(e) => setNewSetup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSetup()
                  }
                }}
                className={styles.textInput}
                placeholder="New setup name"
                aria-label="New setup name"
              />
              <button
                type="button"
                className={styles.addBtn}
                onClick={addSetup}
                disabled={!newSetup.trim()}
              >
                Add
              </button>
            </div>
            {setups.length > 0 && (
              <div className={styles.chips} role="list" aria-label="Trade setups">
                {setups.map((s) => (
                  <span key={s} className={styles.chip} role="listitem">
                    {s}
                    <button
                      type="button"
                      className={styles.chipClose}
                      onClick={() => removeSetup(s)}
                      aria-label={`Remove ${s}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 5.6 JOURNAL COLUMNS */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>JOURNAL COLUMNS</h3>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Market Nav Index</span>
              <select
                value={marketNavIndex}
                onChange={(e) => setMarketNavIndex(e.target.value)}
                className={styles.select}
              >
                {INDEX_OPTIONS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Breadth Metric</span>
              <select
                value={breadthMetric}
                onChange={(e) => setBreadthMetric(e.target.value)}
                className={styles.select}
              >
                {BREADTH_OPTIONS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.helper}>
              Changing these changes the snapshot name for future positions only.
              Existing Positions/Trades keep their captured snapshot.
            </p>
          </section>

          {/* COMMUNITY SHARING */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>COMMUNITY SHARING</h3>
            <label
              className={styles.field}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={shareJournalData}
                onChange={(e) => setShareJournalData(e.target.checked)}
                style={{ accentColor: 'var(--ut-gold)', marginTop: 3 }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--text-bright)', fontWeight: 500 }}>
                  Share my closed trades with the community
                </span>
                <span className={styles.helper}>
                  When on, your closed trades appear in the <strong>Community</strong> tab
                  next to Trade Journal so other users can learn from them.
                  Your <strong>account size, share count, and $ P&amp;L are NEVER shared</strong> —
                  only symbol, side, entry/exit prices, setup, R-multiple,
                  and percent return. You can turn this off anytime.
                </span>
              </span>
            </label>
          </section>

          {errorMsg && (
            <div className={styles.errorBanner} role="alert" aria-live="polite">
              {errorMsg}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
