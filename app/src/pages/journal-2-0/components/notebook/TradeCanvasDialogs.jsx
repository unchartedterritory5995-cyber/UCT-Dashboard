import { useId, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import NoteSearchPicker from './NoteSearchPicker'
import {
  LEVEL_ROLES, TF_OPTIONS, cleanSymbol, itemLabel, strictDay, todayET, tfLabel,
} from '../../lib/tradeCanvas'
import styles from './TradeCanvasBoard.module.css'

/**
 * Wave 11 lane 11D — the trade-plan canvas's dialogs. Every action a mouse
 * reaches by dragging or right-clicking has a real control here (a phone has
 * neither): add or edit a chart, add entry/stop/target or a custom level, draw
 * an arrow, link the canvas from a thesis, and the list of keys.
 *
 * Each is a `Sheet` (a modal on desktop, a bottom sheet on touch), named by its
 * visible title, and hands focus back to whatever opened it when it closes.
 */

const parsePrice = (raw) => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── a chart card ──────────────────────────────────────────────────────────────

export function ChartDialog({ open, initial, defaultSymbol, onSubmit, onClose }) {
  const editing = Boolean(initial)
  const [symbol, setSymbol] = useState(initial?.symbol || defaultSymbol || '')
  const [tf, setTf] = useState(initial?.tf || 'D')
  const [mode, setMode] = useState(initial?.mode === 'frozen' ? 'frozen' : 'live')
  const [asOf, setAsOf] = useState(initial?.asOf || todayET())
  const [error, setError] = useState('')
  const ids = useId()
  const today = todayET()
  const submit = (e) => {
    e.preventDefault()
    const sym = cleanSymbol(symbol)
    if (!sym) { setError('Type a ticker symbol, like NVDA.'); return }
    if (mode === 'frozen') {
      const day = strictDay(asOf)
      if (!day) { setError('Pick the date the chart is frozen at.'); return }
      if (day > today) { setError('A frozen chart cannot be dated after today.'); return }
    }
    onSubmit({ symbol: sym, tf, mode, asOf: mode === 'frozen' ? asOf : null })
  }
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit chart' : 'Add a chart'} labelledByTitle variant="auto" maxWidth={460}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <label className={styles.field} htmlFor={`${ids}-sym`}>
          <span>Ticker</span>
          <input
            id={`${ids}-sym`} value={symbol} autoFocus autoComplete="off" spellCheck={false}
            onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setError('') }}
            placeholder="NVDA" className={styles.input}
          />
        </label>
        <label className={styles.field} htmlFor={`${ids}-tf`}>
          <span>Timeframe</span>
          <select id={`${ids}-tf`} value={tf} onChange={(e) => setTf(e.target.value)} className={styles.input}>
            {TF_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <fieldset className={styles.fieldset}>
          <legend>What the chart shows</legend>
          <label className={styles.radio}>
            <input type="radio" name={`${ids}-mode`} value="live" checked={mode === 'live'} onChange={() => setMode('live')} />
            <span><strong>Live</strong> — follows the market</span>
          </label>
          <label className={styles.radio}>
            <input type="radio" name={`${ids}-mode`} value="frozen" checked={mode === 'frozen'} onChange={() => setMode('frozen')} />
            <span><strong>Frozen</strong> — exactly as it was on a date, so the plan keeps showing what you saw</span>
          </label>
          {mode === 'frozen' && (
            <label className={styles.field} htmlFor={`${ids}-asof`}>
              <span>Frozen as of</span>
              <input id={`${ids}-asof`} type="date" value={asOf} max={today} onChange={(e) => { setAsOf(e.target.value); setError('') }} className={styles.input} />
            </label>
          )}
        </fieldset>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.btnPrimary}>{editing ? 'Save chart' : 'Add chart'}</button>
        </div>
      </form>
    </Sheet>
  )
}

// ── price levels ──────────────────────────────────────────────────────────────

function ChartSelect({ id, charts, value, onChange }) {
  return (
    <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={styles.input}>
      <option value="">Not on a chart (list only)</option>
      {charts.map((c) => <option key={c.id} value={c.id}>{c.symbol} · {tfLabel(c.tf)}</option>)}
    </select>
  )
}

/** Add: entry, stop and target at once (any left blank are skipped) plus one
 *  custom level. Edit: one level. */
export function LevelDialog({ open, initial, charts, defaultChartId, onSubmit, onClose }) {
  const editing = Boolean(initial)
  const ids = useId()
  const [chartId, setChartId] = useState(initial ? initial.chartId : (defaultChartId || null))
  const [prices, setPrices] = useState({ entry: '', stop: '', target: '' })
  const [customLabel, setCustomLabel] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [role, setRole] = useState(initial?.role || 'custom')
  const [label, setLabel] = useState(initial?.label || '')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [error, setError] = useState('')
  const submit = (e) => {
    e.preventDefault()
    if (editing) {
      const p = parsePrice(price)
      if (!p) { setError('Type a price above zero.'); return }
      onSubmit([{ role, label, price: p, chartId }])
      return
    }
    const out = []
    for (const r of ['entry', 'stop', 'target']) {
      if (!String(prices[r]).trim()) continue
      const p = parsePrice(prices[r])
      if (!p) { setError(`The ${r} price is not a number above zero.`); return }
      out.push({ role: r, label: LEVEL_ROLES.find((x) => x.id === r).label, price: p, chartId })
    }
    if (String(customPrice).trim()) {
      const p = parsePrice(customPrice)
      if (!p) { setError('The custom level\'s price is not a number above zero.'); return }
      out.push({ role: 'custom', label: customLabel.trim() || 'Level', price: p, chartId })
    }
    if (!out.length) { setError('Type at least one price.'); return }
    onSubmit(out)
  }
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit level' : 'Add price levels'} labelledByTitle variant="auto" maxWidth={460}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {editing ? (
          <>
            <label className={styles.field} htmlFor={`${ids}-role`}>
              <span>Kind</span>
              <select id={`${ids}-role`} value={role} onChange={(e) => setRole(e.target.value)} className={styles.input}>
                {LEVEL_ROLES.map((r) => <option key={r.id} value={r.id}>{r.id === 'custom' ? 'Custom' : r.label}</option>)}
              </select>
            </label>
            <label className={styles.field} htmlFor={`${ids}-label`}>
              <span>Label</span>
              <input id={`${ids}-label`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className={styles.input} />
            </label>
            <label className={styles.field} htmlFor={`${ids}-price`}>
              <span>Price</span>
              <input id={`${ids}-price`} value={price} inputMode="decimal" autoFocus onChange={(e) => { setPrice(e.target.value); setError('') }} className={styles.input} />
            </label>
          </>
        ) : (
          <>
            {['entry', 'stop', 'target'].map((r, i) => (
              <label key={r} className={styles.field} htmlFor={`${ids}-${r}`}>
                <span className={styles.levelLabel} style={{ '--level-color': LEVEL_ROLES[i].color }}>{LEVEL_ROLES[i].label} price</span>
                <input
                  id={`${ids}-${r}`} value={prices[r]} inputMode="decimal" autoFocus={i === 0} placeholder="e.g. 182.50"
                  onChange={(e) => { setPrices((p) => ({ ...p, [r]: e.target.value })); setError('') }}
                  className={styles.input}
                />
              </label>
            ))}
            <div className={styles.fieldRow}>
              <label className={styles.field} htmlFor={`${ids}-clabel`}>
                <span>Custom level (optional)</span>
                <input id={`${ids}-clabel`} value={customLabel} maxLength={60} placeholder="e.g. Add-on" onChange={(e) => setCustomLabel(e.target.value)} className={styles.input} />
              </label>
              <label className={styles.field} htmlFor={`${ids}-cprice`}>
                <span>Its price</span>
                <input id={`${ids}-cprice`} value={customPrice} inputMode="decimal" onChange={(e) => { setCustomPrice(e.target.value); setError('') }} className={styles.input} />
              </label>
            </div>
          </>
        )}
        <label className={styles.field} htmlFor={`${ids}-chart`}>
          <span>Draw it on</span>
          <ChartSelect id={`${ids}-chart`} charts={charts} value={chartId} onChange={setChartId} />
        </label>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.btnPrimary}>{editing ? 'Save level' : 'Add levels'}</button>
        </div>
      </form>
    </Sheet>
  )
}

// ── arrows ────────────────────────────────────────────────────────────────────

export function ArrowDialog({ open, from, items, edges, onAdd, onRemove, onClose }) {
  const ids = useId()
  const others = items.filter((i) => i.id !== from?.id)
  const [to, setTo] = useState(others[0]?.id || '')
  const [label, setLabel] = useState('')
  const byId = new Map(items.map((i) => [i.id, i]))
  const mine = edges.filter((e) => e.from === from?.id || e.to === from?.id)
  return (
    <Sheet open={open} onClose={onClose} title="Arrows" labelledByTitle variant="auto" maxWidth={480}>
      <form
        className={styles.form}
        onSubmit={(e) => { e.preventDefault(); if (to) onAdd(to, label) }}
        noValidate
      >
        <p className={styles.formNote}>From <strong>{itemLabel(from)}</strong></p>
        {others.length ? (
          <>
            <label className={styles.field} htmlFor={`${ids}-to`}>
              <span>Draw an arrow to</span>
              <select id={`${ids}-to`} value={to} onChange={(e) => setTo(e.target.value)} className={styles.input} autoFocus>
                {others.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}
              </select>
            </label>
            <label className={styles.field} htmlFor={`${ids}-label`}>
              <span>Label (optional)</span>
              <input id={`${ids}-label`} value={label} maxLength={60} placeholder="e.g. if it holds" onChange={(e) => setLabel(e.target.value)} className={styles.input} />
            </label>
          </>
        ) : <p className={styles.formNote}>Add another card first — an arrow joins two of them.</p>}
        {mine.length > 0 && (
          <ul className={styles.arrowList} aria-label="Arrows on this card">
            {mine.map((e) => (
              <li key={e.id}>
                <span>{itemLabel(byId.get(e.from))} → {itemLabel(byId.get(e.to))}{e.label ? ` (${e.label})` : ''}</span>
                <button type="button" className={styles.btnGhost} onClick={() => onRemove(e.id)}>Remove arrow</button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.formActions}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>Done</button>
          {others.length > 0 && <button type="submit" className={styles.btnPrimary}>Add arrow</button>}
        </div>
      </form>
    </Sheet>
  )
}

// ── link from a thesis ────────────────────────────────────────────────────────

export function LinkThesisDialog({ open, canvasId, onPick, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Link this plan from a note" labelledByTitle variant="auto" maxWidth={520}>
      <div className={styles.form}>
        <p className={styles.formNote}>
          Pick your thesis (or any note). It opens with a button to add a link to this plan at its end —
          nothing is written until you press it. You can also type <kbd>[[</kbd> in any note and pick this plan.
        </p>
        <NoteSearchPicker
          onPick={onPick}
          onCancel={onClose}
          exclude={canvasId ? [canvasId] : []}
          inputLabel="Find the note to link from"
          listLabel="Notes"
          placeholder="Find your thesis…"
        />
      </div>
    </Sheet>
  )
}

// ── keys ──────────────────────────────────────────────────────────────────────

export const KEYS = Object.freeze([
  ['Tab / Shift+Tab', 'Go to the next / previous card'],
  ['Arrow keys', 'Move the selected card (Shift: a bigger step); with nothing selected, move around'],
  ['Alt + arrow keys', 'Resize the selected card'],
  ['Enter', 'Edit the card'],
  ['Space', 'Add the card to the selection, or take it out'],
  ['Delete', 'Delete the selection (Ctrl+Z brings it back)'],
  ['Ctrl+D', 'Duplicate the selection'],
  ['Ctrl+A', 'Select every card'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['T · S · C · L', 'Add a text card · sticky note · chart · price levels'],
  ['A', 'Draw an arrow from the selected card'],
  ['+ / − / 0', 'Zoom in / out / show everything'],
  ['Escape', 'Clear the selection'],
])

export function KeysDialog({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Canvas keys" labelledByTitle variant="auto" maxWidth={520}>
      <dl className={styles.keys}>
        {KEYS.map(([k, v]) => (
          <div key={k} className={styles.keyRow}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Sheet>
  )
}
