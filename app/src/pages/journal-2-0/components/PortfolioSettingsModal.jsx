/**
 * Portfolio Settings Modal — Journal 2.0.
 * Spec §5.
 */

import { useEffect, useState, useCallback, useId } from 'react'
import styles from './PortfolioSettingsModal.module.css'
import NoTradeWindowsEditor from './NoTradeWindowsEditor'

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

const STANDARD_MISTAKES = [
  'overtrading', 'FOMO', 'chasing', 'early_exit', 'late_entry',
  'no_stop', 'oversized', 'countertrend', 'revenge', 'ignored_thesis',
  'added_to_loser', 'cut_winner', 'broke_loss_rule', 'broke_size_rule',
  'broke_checklist', 'boredom', 'hesitation',
]

const STANDARD_EMOTIONS = [
  'confident', 'anxious', 'greedy', 'fearful', 'calm', 'frustrated',
  'euphoric', 'bored', 'disciplined', 'impulsive', 'patient', 'rushed',
  'focused', 'distracted', 'revenge-driven',
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

export default function PortfolioSettingsModal({ settings, onSave, onClose, accountName, isAllAccounts }) {
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
  const [shareJournalData, setShareJournalData] = useState(
    !!settings?.shareJournalData,
  )
  const [tradingMode, setTradingMode] = useState(settings?.tradingMode ?? 'both')
  const [defaultSizePct, setDefaultSizePct] = useState(
    settings?.defaultSizePct == null ? '' : String(settings.defaultSizePct),
  )
  const [defaultRMultipleTarget, setDefaultRMultipleTarget] = useState(
    settings?.defaultRMultipleTarget == null ? '' : String(settings.defaultRMultipleTarget),
  )
  const [maxRiskPerTradePct, setMaxRiskPerTradePct] = useState(
    settings?.maxRiskPerTradePct == null ? '' : String(settings.maxRiskPerTradePct),
  )
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(
    settings?.dailyLossLimitPct == null ? '' : String(settings.dailyLossLimitPct),
  )
  const [coolingOffMinutesAfterLoss, setCoolingOffMinutesAfterLoss] = useState(
    settings?.coolingOffMinutesAfterLoss == null ? '' : String(settings.coolingOffMinutesAfterLoss),
  )
  const [noTradeWindowsET, setNoTradeWindowsET] = useState(
    Array.isArray(settings?.noTradeWindowsET) ? settings.noTradeWindowsET : [],
  )
  const [aPlusSetups, setAPlusSetups] = useState(
    Array.isArray(settings?.aPlusSetups) ? settings.aPlusSetups : [],
  )
  const [aPlusRiskMultiplier, setAPlusRiskMultiplier] = useState(
    settings?.aPlusRiskMultiplier == null ? '' : String(settings.aPlusRiskMultiplier),
  )
  const [regimeSizeMultipliers, setRegimeSizeMultipliers] = useState(() => {
    const seed = settings?.regimeSizeMultipliers || {}
    return {
      green: seed.green == null ? '' : String(seed.green),
      amber: seed.amber == null ? '' : String(seed.amber),
      orange: seed.orange == null ? '' : String(seed.orange),
      red: seed.red == null ? '' : String(seed.red),
    }
  })

  const [mistakeTags, setMistakeTags] = useState(settings?.mistakeTags ?? [])
  const [emotionTags, setEmotionTags] = useState(settings?.emotionTags ?? [])
  const [newMistake, setNewMistake] = useState('')
  const [newEmotion, setNewEmotion] = useState('')

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

  const addMistake = useCallback(() => {
    const s = newMistake.trim()
    if (!s) return
    if (mistakeTags.includes(s)) { setNewMistake(''); return }
    setMistakeTags((prev) => [...prev, s])
    setNewMistake('')
  }, [newMistake, mistakeTags])

  const removeMistake = useCallback((s) => {
    setMistakeTags((prev) => prev.filter((x) => x !== s))
  }, [])

  const seedMistakes = useCallback(() => {
    setMistakeTags((prev) => {
      const next = [...prev]
      for (const s of STANDARD_MISTAKES) if (!next.includes(s)) next.push(s)
      return next
    })
  }, [])

  const addEmotion = useCallback(() => {
    const s = newEmotion.trim()
    if (!s) return
    if (emotionTags.includes(s)) { setNewEmotion(''); return }
    setEmotionTags((prev) => [...prev, s])
    setNewEmotion('')
  }, [newEmotion, emotionTags])

  const removeEmotion = useCallback((s) => {
    setEmotionTags((prev) => prev.filter((x) => x !== s))
  }, [])

  const seedEmotions = useCallback(() => {
    setEmotionTags((prev) => {
      const next = [...prev]
      for (const s of STANDARD_EMOTIONS) if (!next.includes(s)) next.push(s)
      return next
    })
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
      shareJournalData,
      tradingMode,
      defaultSizePct: defaultSizePct === '' ? null : Number(defaultSizePct),
      defaultRMultipleTarget: defaultRMultipleTarget === '' ? null : Number(defaultRMultipleTarget),
      maxRiskPerTradePct: maxRiskPerTradePct === '' ? null : Number(maxRiskPerTradePct),
      dailyLossLimitPct: dailyLossLimitPct === '' ? null : Number(dailyLossLimitPct),
      coolingOffMinutesAfterLoss: coolingOffMinutesAfterLoss === '' ? null : parseInt(coolingOffMinutesAfterLoss, 10),
      noTradeWindowsET,
      aPlusSetups,
      aPlusRiskMultiplier: aPlusRiskMultiplier === '' ? null : Number(aPlusRiskMultiplier),
      regimeSizeMultipliers: Object.fromEntries(
        Object.entries(regimeSizeMultipliers)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [k, Number(v)])
      ),
      mistakeTags,
      emotionTags,
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
    shareJournalData,
    tradingMode,
    defaultSizePct,
    defaultRMultipleTarget,
    maxRiskPerTradePct,
    dailyLossLimitPct,
    coolingOffMinutesAfterLoss,
    noTradeWindowsET,
    aPlusSetups,
    aPlusRiskMultiplier,
    regimeSizeMultipliers,
    mistakeTags,
    emotionTags,
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
            Settings{accountName ? ` — ${accountName}` : ''}
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
        {isAllAccounts && (
          <div style={{
            margin: '12px 20px 0', padding: '10px 14px',
            background: 'var(--warn-bg)', border: '1px solid var(--warn-border)',
            color: 'var(--warn)', borderRadius: 8, fontSize: 12,
          }}>
            <strong>All Accounts mode</strong> — showing the Default account's
            settings as a fallback. Switch to a single account in the header
            selector to edit settings.
          </div>
        )}

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

          {/* TRADE TYPES — show/hide options vs shares surfaces per account */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>TRADE TYPES</h3>
            <p className={styles.helper}>
              Choose what this account trades. Hides the inactive surface's
              tabs, forms, and Add buttons throughout Journal 2.0. Existing
              data is never deleted — switch back to <strong>Both</strong> any
              time.
            </p>
            <div className={styles.radioCards} role="radiogroup" aria-label="Trade types">
              {[
                { mode: 'shares', title: 'Shares only', subtitle: 'Equity positions and trades' },
                { mode: 'options', title: 'Options only', subtitle: 'Multi-leg option strategies' },
                { mode: 'both', title: 'Both', subtitle: 'Shares + options side-by-side' },
              ].map((opt) => (
                <label
                  key={opt.mode}
                  className={`${styles.radioCard} ${tradingMode === opt.mode ? styles.radioCardActive : ''}`}
                >
                  <input
                    type="radio"
                    name="tradingMode"
                    value={opt.mode}
                    checked={tradingMode === opt.mode}
                    onChange={() => setTradingMode(opt.mode)}
                    className={styles.radioInput}
                  />
                  <div className={styles.radioBody}>
                    <div className={styles.radioTitle}>{opt.title}</div>
                    <div className={styles.radioSubtitle}>{opt.subtitle}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* ENTRY DEFAULTS & GUARDS — Phase A */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>ENTRY DEFAULTS & GUARDS</h3>
            <p className={styles.helper}>
              Auto-fill the Add Position form and warn when implied risk
              exceeds your cap. Leave any field blank to disable that guard.
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Default Position Size (% of account)</span>
              <input
                type="number"
                min="0.1"
                max="99.9"
                step="0.1"
                value={defaultSizePct}
                onChange={(e) => setDefaultSizePct(e.target.value)}
                placeholder="e.g. 5"
                className={styles.numberInput}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Default Target (R multiple)</span>
              <input
                type="number"
                min="0.1"
                max="20"
                step="0.1"
                value={defaultRMultipleTarget}
                onChange={(e) => setDefaultRMultipleTarget(e.target.value)}
                placeholder="e.g. 2"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              Display only — Add Position will show a suggested target line
              computed from entry, stop, and this multiple.
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Max Risk Per Trade (% of account)</span>
              <input
                type="number"
                min="0.05"
                max="50"
                step="0.05"
                value={maxRiskPerTradePct}
                onChange={(e) => setMaxRiskPerTradePct(e.target.value)}
                placeholder="e.g. 1"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              Add Position will block save with a red banner when implied
              $ risk exceeds this cap (Override available).
            </p>
          </section>

          {/* SESSION DISCIPLINE — Phase B */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>SESSION DISCIPLINE</h3>
            <p className={styles.helper}>
              Lock new trade entries when you've hit a daily loss, just took
              a losing trade, or are inside a no-trade time window. Each
              guard is independent — leave any field blank to disable it.
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Daily Loss Limit (% of account)</span>
              <input
                type="number"
                min="0.05"
                max="50"
                step="0.05"
                value={dailyLossLimitPct}
                onChange={(e) => setDailyLossLimitPct(e.target.value)}
                placeholder="e.g. 2"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              When today's realized P&amp;L drops below this %, Add Position
              and Add Trade are blocked (Override available).
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Cooling-Off After Loss (minutes)</span>
              <input
                type="number"
                min="1"
                max="240"
                step="1"
                value={coolingOffMinutesAfterLoss}
                onChange={(e) => setCoolingOffMinutesAfterLoss(e.target.value)}
                placeholder="e.g. 15"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              After any losing trade exit, lock new entries for this many
              minutes. Forces a walk-away after a loss.
            </p>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>No-Trade Time Windows (ET)</span>
              <NoTradeWindowsEditor
                value={noTradeWindowsET}
                onChange={setNoTradeWindowsET}
              />
            </div>
            <p className={styles.helper}>
              Block entries during specific time windows (e.g. lunch chop or
              the volatile open). Times are 24-hour Eastern.
            </p>
          </section>

          {/* SETUP-AWARE COACHING — Phase C */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>SETUP-AWARE COACHING</h3>
            <p className={styles.helper}>
              Mark setups as <strong>A+</strong> to allow them to exceed your
              Max Risk Per Trade cap by the multiplier below. Forces you to
              commit ahead of time which patterns deserve full size.
            </p>

            {setups.length === 0 ? (
              <p className={styles.helper}>
                Add some setups in the TRADE SETUPS section above first.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
                {setups.map((s) => {
                  const active = aPlusSetups.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setAPlusSetups((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                        )
                      }}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        background: active ? 'var(--ut-gold, #c9a84c)' : 'transparent',
                        color: active ? 'var(--bg, #000)' : 'var(--text-bright)',
                        border: `1px solid ${active ? 'var(--ut-gold, #c9a84c)' : 'var(--border)'}`,
                        borderRadius: 999,
                        cursor: 'pointer',
                      }}
                      aria-pressed={active}
                    >
                      {active ? '★ ' : ''}{s}
                    </button>
                  )
                })}
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>A+ Risk Multiplier</span>
              <input
                type="number"
                min="1.05"
                max="10"
                step="0.05"
                value={aPlusRiskMultiplier}
                onChange={(e) => setAPlusRiskMultiplier(e.target.value)}
                placeholder="e.g. 1.5"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              Effective cap on an A+ setup = Max Risk Per Trade × this
              multiplier. Leave blank to keep all setups at the same cap.
            </p>
          </section>

          {/* REGIME-AWARE SIZING — Phase D */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>REGIME-AWARE SIZING</h3>
            <p className={styles.helper}>
              Auto-scale Default Position Size based on UCT regime. Multiplier
              of <code>0.5</code> = 50% normal size, <code>0</code> = skip
              entries in that regime. Leave blank to skip scaling for any
              regime.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '8px 0' }}>
              {[
                { key: 'green', label: 'GREEN', tint: '#22c55e', placeholder: '1.0' },
                { key: 'amber', label: 'AMBER', tint: '#fbbf24', placeholder: '0.75' },
                { key: 'orange', label: 'ORANGE', tint: '#fb923c', placeholder: '0.5' },
                { key: 'red', label: 'RED', tint: '#ef4444', placeholder: '0' },
              ].map(({ key, label, tint, placeholder }) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: tint }}>
                    {label}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.05"
                    value={regimeSizeMultipliers[key]}
                    onChange={(e) =>
                      setRegimeSizeMultipliers((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className={styles.numberInput}
                  />
                </label>
              ))}
            </div>
          </section>

          {/* MISTAKES TAXONOMY — Phase E */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>MISTAKES TAXONOMY</h3>
            <p className={styles.helper}>
              Tag closed trades with the mistakes you made. Build your own
              list, or seed the standard 17 to start.
            </p>
            <div className={styles.addRow}>
              <input
                type="text"
                value={newMistake}
                onChange={(e) => setNewMistake(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addMistake() }
                }}
                className={styles.textInput}
                placeholder="New mistake tag"
                aria-label="New mistake tag"
              />
              <button type="button" className={styles.addBtn} onClick={addMistake} disabled={!newMistake.trim()}>
                Add
              </button>
              <button
                type="button"
                className={styles.addBtn}
                onClick={seedMistakes}
                style={{ marginLeft: 8 }}
                aria-label="Seed standard 17 mistakes"
              >
                + Seed standard 17
              </button>
            </div>
            {mistakeTags.length > 0 && (
              <div className={styles.chips} role="list" aria-label="Mistake tags">
                {mistakeTags.map((s) => (
                  <span key={s} className={styles.chip} role="listitem">
                    {s}
                    <button type="button" className={styles.chipClose} onClick={() => removeMistake(s)} aria-label={`Remove ${s}`}>×</button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* EMOTIONS TAXONOMY — Phase E */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>EMOTIONS TAXONOMY</h3>
            <p className={styles.helper}>
              Tag closed trades with the emotional state you traded in. Build
              your own list, or seed the standard 15 to start.
            </p>
            <div className={styles.addRow}>
              <input
                type="text"
                value={newEmotion}
                onChange={(e) => setNewEmotion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addEmotion() }
                }}
                className={styles.textInput}
                placeholder="New emotion tag"
                aria-label="New emotion tag"
              />
              <button type="button" className={styles.addBtn} onClick={addEmotion} disabled={!newEmotion.trim()}>
                Add
              </button>
              <button
                type="button"
                className={styles.addBtn}
                onClick={seedEmotions}
                style={{ marginLeft: 8 }}
                aria-label="Seed standard 15 emotions"
              >
                + Seed standard 15
              </button>
            </div>
            {emotionTags.length > 0 && (
              <div className={styles.chips} role="list" aria-label="Emotion tags">
                {emotionTags.map((s) => (
                  <span key={s} className={styles.chip} role="listitem">
                    {s}
                    <button type="button" className={styles.chipClose} onClick={() => removeEmotion(s)} aria-label={`Remove ${s}`}>×</button>
                  </span>
                ))}
              </div>
            )}
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

          {/* POSITION CLOSING — kept at the bottom (advanced/rarely-changed) */}
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
            disabled={saving || isAllAccounts}
            title={isAllAccounts ? 'Select a single account to save settings' : ''}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
