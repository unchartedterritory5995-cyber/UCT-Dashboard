// app/src/hub/PlanTradeSheet.jsx — ONE sheet, TWO doors (Phase 3 §3.3 ruling + §3.4, gate A5).
//
// The Screener opens it with a SYMBOL and, when the stream has one, a last price — and nothing
// else (owner ruling, 2026-09-09: the Screener carries entry/stop only as DISTANCES, in one
// non-default column view, deliberately blank on stale rows, and it has no account context at
// all, so it cannot supply size). The Journal opens it PREFILLED from the selected position.
// Same component, same rules, same POST.
//
// ⛔⛔ BLANK MEANS BLANK. A field that cannot be computed renders as an em dash and "Save plan"
// stays DISABLED. It never fabricates a level. That is the whole reason the ruling put
// blank-means-blank in writing: a "helpful" default here is a price a member would act on, and
// a fabricated stop is indistinguishable from a real one once it is in the box.
//
// ⛔ EVERY DEFAULT IS IMPORTED, NEVER RE-DERIVED:
//   * the stop comes from `disciplineGuards.prefillStop` (D-33, lifted out of AddPositionModal
//     for exactly this) — which returns '' whenever it cannot compute one;
//   * the size comes from `disciplineGuards.computeDefaultShares` — percent-of-account, the
//     only sizing rule this app has (there is no mode discriminator);
//   * 1R comes from `calculations.tradePnlDollar` with the STOP as the modelled exit, which is
//     bit-for-bit how the server derives `r_value` (`hub_planned_trades._one_r_dollars`). The
//     obvious `|entry - stop| * size` would be a second authority over how this app computes
//     trade money, and it would agree today and drift tomorrow.
//   * the SIDE is derived from entry-vs-stop, mirroring the server's `side_of`. Storing or
//     passing a side as well would let the two disagree, and then a plan could say "Long" with
//     a stop above its entry and nothing could say which field was wrong.

import { useCallback, useMemo, useRef, useState } from 'react'
import Sheet from '../components/mobile/Sheet'
import { validatePlanTradeSheetProps } from './contracts'
import plannedTradesClient, { planSideOf } from './plannedTradesClient'
import { tradePnlDollar } from '../lib/journal-2-0'
import { computeDefaultShares, prefillStop } from '../pages/journal-2-0/lib/disciplineGuards'
import styles from './hub.module.css'

/** '' / null / NaN all mean BLANK. `Number(null)` is 0 and 0 is finite — hence the explicit list. */
const asNumber = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const DASH = '—'
const show = (v, dp) => {
  const n = asNumber(v)
  return n === null ? DASH : (dp === undefined ? String(n) : n.toFixed(dp))
}

/**
 * 1R in dollars for a plan, through the journal's own calc module.
 * @returns {number|null} null unless entry, stop and size are ALL present
 */
export function planOneR({ entry, stop, size }) {
  const e = asNumber(entry)
  const s = asNumber(stop)
  const z = asNumber(size)
  if (e === null || s === null || z === null) return null
  if (e === s) return null // risk undefined — the same degenerate case the server 422s on
  return Math.abs(tradePnlDollar({
    side: planSideOf(e, s), entryPrice: e, exitPrice: s, shares: z,
  }))
}

/**
 * @param {Object} props
 * @param {string} props.symbol                 fixed — never editable
 * @param {number|null} [props.entry]           the caller's prefill (Journal: the position's entry)
 * @param {number|null} [props.stop]
 * @param {number|null} [props.size]
 * @param {number|null} [props.lastPrice]       the stream's price, when there is one
 * @param {'Long'|'Short'} [props.side]         only used to seed `prefillStop`
 * @param {object} [props.settings]             j2 settings: accountSize, defaultStop, defaultSizePct
 * @param {string} [props.sourceMode]           which section this plan came from
 * @param {(row: object) => void} [props.onPlanned]
 * @param {(msg: string, tone?: string) => void} [props.onToast]
 * @param {() => void} props.onClose
 * @param {{create: Function}} [props.client]
 */
export default function PlanTradeSheet({
  symbol,
  entry = null,
  stop = null,
  size = null,
  lastPrice = null,
  side = 'Long',
  settings = null,
  sourceMode = null,
  onPlanned,
  onToast,
  onClose,
  client = plannedTradesClient,
}) {
  // ── the three seeds, resolved ONCE at open ───────────────────────────────
  // Lazy initial state, not an effect: an effect that "helpfully" refills a field the member
  // just cleared is how a blank becomes a fabricated level two renders later.
  const [entryValue, setEntryValue] = useState(() => {
    const seeded = asNumber(entry) ?? asNumber(lastPrice)
    return seeded === null ? '' : String(seeded)
  })
  const [stopValue, setStopValue] = useState(() => {
    const given = asNumber(stop)
    if (given !== null) return String(given)
    const seedEntry = asNumber(entry) ?? asNumber(lastPrice)
    const computed = prefillStop({
      side,
      sharesVal: asNumber(size),
      entryVal: seedEntry,
      defaultStop: settings?.defaultStop,
    })
    // `prefillStop` returns '' when it cannot compute one. That '' is the answer, not a miss.
    return computed === '' || computed === null || computed === undefined ? '' : String(computed)
  })
  const [sizeValue, setSizeValue] = useState(() => {
    const given = asNumber(size)
    if (given !== null) return String(given)
    const computed = computeDefaultShares({
      accountSize: settings?.accountSize,
      defaultSizePct: settings?.defaultSizePct,
      entryPrice: asNumber(entry) ?? asNumber(lastPrice),
    })
    return computed === null || computed === undefined ? '' : String(computed)
  })
  const [saving, setSaving] = useState(false)
  const firedRef = useRef(false)

  const nums = useMemo(() => ({
    entry: asNumber(entryValue), stop: asNumber(stopValue), size: asNumber(sizeValue),
  }), [entryValue, stopValue, sizeValue])

  const oneR = planOneR(nums)
  const complete = nums.entry !== null && nums.stop !== null && nums.size !== null
  const sameLevel = complete && nums.entry === nums.stop
  const canSave = complete && !sameLevel && !saving

  const save = useCallback(async () => {
    if (firedRef.current || !canSave) return
    firedRef.current = true
    setSaving(true)
    const plan = {
      symbol, entry: nums.entry, stop: nums.stop, size: nums.size, sourceMode,
    }
    // The contract's own props validator, run on the values actually being sent — the one place
    // where they are guaranteed to be finite numbers.
    validatePlanTradeSheetProps({ ...plan, onClose }, 'PlanTradeSheet.save')
    try {
      const row = await client.create(plan)
      onToast?.(`Planned ${symbol} — ${nums.size} at ${nums.entry.toFixed(2)}, stop ${nums.stop.toFixed(2)}`, 'success')
      onPlanned?.(row)
      onClose?.()
    } catch (e) {
      // The server's own message, verbatim: its 422s name the field a member can fix.
      firedRef.current = false
      setSaving(false)
      onToast?.(`Couldn't save the plan: ${String(e?.message || e)}`, 'error')
    }
  }, [canSave, client, nums, onClose, onPlanned, onToast, sourceMode, symbol])

  return (
    <Sheet open onClose={onClose} variant="auto" title="Plan trade" ariaLabel="Plan trade">
      <div className={styles.confirmBody} data-testid="hub-plan-body">
        <p data-testid="hub-plan-symbol">{symbol}</p>
        <p data-testid="hub-plan-r">
          {/* 1R only when entry, stop and size are ALL present. Blank renders as an em dash. */}
          Risk (1R) {oneR === null ? DASH : `$${oneR.toFixed(2)}`}
        </p>
        <p data-testid="hub-plan-side">
          Side {complete && !sameLevel ? planSideOf(nums.entry, nums.stop) : DASH}
        </p>
      </div>

      <div className={styles.confirmField}>
        <label htmlFor="hub-plan-entry">Entry</label>
        <input
          id="hub-plan-entry"
          data-testid="hub-plan-entry"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={entryValue}
          placeholder={DASH}
          onChange={(e) => setEntryValue(e.target.value)}
        />
        <span data-testid="hub-plan-entry-shown">{show(entryValue, 2)}</span>
      </div>

      <div className={styles.confirmField}>
        <label htmlFor="hub-plan-stop">Stop</label>
        <input
          id="hub-plan-stop"
          data-testid="hub-plan-stop"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={stopValue}
          placeholder={DASH}
          onChange={(e) => setStopValue(e.target.value)}
        />
        <span data-testid="hub-plan-stop-shown">{show(stopValue, 2)}</span>
      </div>

      <div className={styles.confirmField}>
        <label htmlFor="hub-plan-size">Size</label>
        <input
          id="hub-plan-size"
          data-testid="hub-plan-size"
          type="number"
          inputMode="decimal"
          value={sizeValue}
          placeholder={DASH}
          onChange={(e) => setSizeValue(e.target.value)}
        />
        <span data-testid="hub-plan-size-shown">{show(sizeValue)}</span>
      </div>

      {sameLevel && (
        <p role="alert" data-testid="hub-plan-refusal" className={styles.confirmBody}>
          A stop at the entry risks nothing, so this plan cannot say what it risks. Move one of them.
        </p>
      )}

      <button
        type="button"
        data-testid="hub-plan-save"
        className={styles.confirmPrimary}
        disabled={!canSave}
        onClick={save}
      >
        Save plan
      </button>
      <button type="button" data-testid="hub-plan-cancel" onClick={onClose}>Cancel</button>
    </Sheet>
  )
}
