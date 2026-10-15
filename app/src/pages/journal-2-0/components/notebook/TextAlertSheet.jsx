// app/src/pages/journal-2-0/components/notebook/TextAlertSheet.jsx
/**
 * Tier 2 part A, item 8 / R-T2A-4 -- the sheet the "Set alert" chip opens, FILLED IN from the
 * sentence. Every field stays editable and nothing is set until "Set alert" is pressed.
 * It holds no create logic of its own (R-T2A-4, R-T2A-5):
 *   closes  -> createIndicatorAlert({sym, indicator:'close', condition, threshold, tf})  (closed bar)
 *   trades  -> alertCommand.setAlert({sym, price, direction})                           (intraday)
 * Both paths pass the same typo guard (MAX_DISTANCE) before anything is sent.
 *
 * ⛔ The two products behave differently AFTER they fire, and the sheet says which one the member
 * picked: a watchlist alert is fire-once (`is_active = 0` on trigger); an indicator alert is NOT --
 * it goes quiet after a fire and re-arms when a bar closes back on the other side
 * (indicator_alert_service.py, `_rearm`). "Rings once" is true for one and false for the other.
 *
 * ⛔ Every sentence shown on a failure is either fixed here, or the alert routes' own member
 * sentence (`setAlert`'s `memberText`, `createIndicatorAlert`'s `error`) -- never a raw exception.
 */
import { useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { MAX_DISTANCE, currentPrice, money, setAlert } from '../../../terminal/alertCommand'
import { createIndicatorAlert, useIndicatorAlertCatalog } from '../../../../hooks/useIndicatorAlerts'
import styles from './TextAlertSheet.module.css'

const WHEN = [
  { id: 'close-below', mode: 'close', direction: 'below', label: 'Closes below' },
  { id: 'close-above', mode: 'close', direction: 'above', label: 'Closes above' },
  { id: 'trade-below', mode: 'intraday', direction: 'below', label: 'Trades below' },
  { id: 'trade-above', mode: 'intraday', direction: 'above', label: 'Trades above' },
  { id: 'trade-reach', mode: 'intraday', direction: null, label: 'Reaches (above or below)' },
]

/** Can the catalog create a closed-bar `close` alert in both directions? (V12: entries carry `plots`,
 *  each plot an address in `value` with its `conditions`, each condition's id in `value`.) */
function closeAvailable(catalog) {
  for (const entry of catalog || []) {
    const plot = (entry?.plots || []).find((p) => p?.value === 'close')
    if (!plot) continue
    const have = new Set((plot.conditions || []).map((c) => c?.value ?? c))
    if (have.has('below') && have.has('above')) return true
  }
  return false
}

/** The "When" choice a sentence starts on. '' means "the sentence did not say which way": the member
 *  chooses, rather than the sheet guessing a direction on a price alert. */
function startWhen(initial, canClose) {
  if (initial?.mode === 'close' && canClose) return initial.direction ? `close-${initial.direction}` : ''
  if (!initial?.direction) return 'trade-reach'
  return `trade-${initial.direction}`
}

export default function TextAlertSheet({ open, initial, onClose, onDone }) {
  const { catalog, isLoading } = useIndicatorAlertCatalog()
  const canClose = closeAvailable(catalog)
  const closeOk = isLoading || canClose // optimistic while the catalog loads; the create route stays the authority
  const [symbol, setSymbol] = useState(initial?.symbol || '')
  const [when, setWhen] = useState(() => startWhen(initial, true))
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '')
  const [tf, setTf] = useState(initial?.tf === 'W' ? 'W' : 'D')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  useEffect(() => {
    if (!isLoading && !canClose && (when === '' || when.startsWith('close'))) {
      setWhen(startWhen({ ...initial, mode: 'intraday' }, false))
    }
  }, [isLoading, canClose]) // eslint-disable-line react-hooks/exhaustive-deps -- once, when the catalog answers

  const choice = WHEN.find((w) => w.id === when) || null
  const options = WHEN.filter((w) => closeOk || w.mode !== 'close')
  const closing = choice ? choice.mode === 'close' : true // '' only ever means an undecided close

  const submit = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    const sym = symbol.trim().replace(/^\$/, '').toUpperCase()
    const p = Number(price)
    if (!sym) { setSaid('Type a ticker.'); return }
    if (!Number.isFinite(p) || p <= 0) { setSaid('Type a price above zero.'); return }
    if (!choice) { setSaid('Choose when the alert should ring: Closes above or Closes below.'); return }
    setBusy(true); setSaid('')
    try {
      if (choice.mode === 'close') {
        const now = await currentPrice(sym)
        if (now && (p > now * MAX_DISTANCE || p < now / MAX_DISTANCE)) {
          setSaid(`${money(p)} is more than ${MAX_DISTANCE} times away from ${sym}'s price (${money(now)}), so it looks like a typo. Nothing was set.`)
          return
        }
        const out = await createIndicatorAlert({ sym, indicator: 'close', condition: choice.direction, threshold: p, tf })
        if (!out.ok) { setSaid(out.error); return }
        onDone(`Alert set: ${sym} closes ${choice.direction} ${money(p)} on the ${tf === 'W' ? 'weekly' : 'daily'} chart. It rings the bell, and sends email or Discord if you have those on.`)
      } else {
        const out = await setAlert({ sym, price: p, direction: choice.direction })
        onDone(out.text)
      }
    } catch (err) {
      setSaid(err?.memberText || `The alert for ${sym} could not be saved just now. Nothing was set; try again.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Set an alert" variant="auto" labelledByTitle>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>Ticker
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className={styles.field}>When
          <select value={when} onChange={(e) => setWhen(e.target.value)}>
            {when === '' && <option value="" disabled>Choose…</option>}
            {options.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Price
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </label>
        {closing && (
          <label className={styles.field}>Chart
            <select value={tf} onChange={(e) => setTf(e.target.value)}>
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
            </select>
          </label>
        )}
        {!isLoading && !canClose && <p className={styles.note}>Close alerts are not available right now.</p>}
        <p className={styles.note}>
          {closing
            ? 'Rings after a bar closes beyond your price. Then it stays quiet until a bar closes back on the other side, and can ring again after that.'
            : 'Rings once, the first time the live price crosses your price.'}
        </p>
        <p role="status" aria-live="polite" className={styles.said}>{said}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={busy}>Set alert</button>
        </div>
      </form>
    </Sheet>
  )
}
