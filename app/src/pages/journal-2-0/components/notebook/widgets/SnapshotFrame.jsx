import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import Switch from '../../../../../components/ui/Switch'
import { money, moneySigned, percent } from '../../../../../lib/journal-2-0/format'
import { etDateTime, isoDayText } from '../captureStamp'
import { widgetKind } from '../../../lib/notebookWidgets'
import { widgetMeta } from '../../../../../widgets/registry'
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import { savePreset, NAME_MAX } from '../../../lib/notebookSets'
import {
  fetchWidgetPayload, refreshParams, requestParamsOf, refreshFailureText, OFFLINE_SENTENCE,
} from '../../../lib/notebookWidgetsFetch'
import styles from './SnapshotFrame.module.css'

/**
 * Notebook widgets (Task 7): the frame every snapshot widget is drawn in.
 *
 * ⛔ A SNAPSHOT. The numbers inside were frozen into the node's params when it was inserted; the
 * embed never fetches on mount. "See it now" is the one door to fresher numbers, and it writes
 * them back through the host's `onUpdateParams` (one editor transaction, the note's own save
 * path). A refresh that fails leaves the params, and so the rendered numbers, exactly as they were.
 *
 * The share switch is offered only for an ACCOUNT kind: its numbers stay off public pages unless
 * the member turns it on. Both controls exist only when the host says the note is editable.
 */

/** How long a failed refresh's sentence stays up. */
export const REFRESH_MESSAGE_MS = 4000
/** The server's sentence for a payload over the byte cap (fix-f1-report.md: `tooLarge`), when it sent none. */
export const TOO_LARGE_SENTENCE = "This widget's data was too large to save. Narrow it and try again."
/** The earnings calendar was not read (`earningsUnknown: true`): an unknown day, never "none". */
export const EARNINGS_UNREAD = 'The earnings calendar could not be read just now'

export default function SnapshotFrame({
  title, asOf, account = false, share = false, editable = false,
  onRefresh, onShareChange, onSavePreset, sourceLine, sourceDetail, tooLarge = false, tooLargeText, children,
  changeKeys = [], settings = {}, onChange,
}) {
  const [busy, setBusy] = useState(false)
  const [change, setChange] = useState(null)   // the settings being edited, or null when closed
  const [message, setMessage] = useState('')
  const [naming, setNaming] = useState(null)   // the preset name being typed, or null when closed
  // Spec §6 (final review M-10): offline, See it now is DISABLED with the reason as its title, and it is
  // enabled again on the browser's online event.
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!message) return undefined
    const t = setTimeout(() => setMessage(''), REFRESH_MESSAGE_MS)
    return () => clearTimeout(t)
  }, [message])

  const refresh = async () => {
    if (busy || typeof onRefresh !== 'function') return
    setBusy(true)
    setMessage('')
    let result
    try {
      result = await onRefresh()
    } catch {
      result = { ok: false, reason: 'failed' }
    }
    if (!mounted.current) return
    setBusy(false)
    if (!result?.ok) setMessage(refreshFailureText(result?.reason))
  }

  // R58 (UX I-10): Change asks for this widget again with other settings (its request keys), through the same
  // transaction See it now writes with; a refused setting shows the server's own sentence.
  const submitChange = async () => {
    if (busy || typeof onChange !== 'function') return
    setBusy(true)
    setMessage('')
    let result
    try { result = await onChange(change || {}) } catch { result = { ok: false, reason: 'failed' } }
    if (!mounted.current) return
    setBusy(false)
    if (result?.ok) setChange(null)
    else setMessage(result?.message || refreshFailureText(result?.reason))
  }

  // Task 17 (wave 5): this widget's SETTINGS saved under a name, listed under "My presets" in the / menu.
  const savePresetNamed = async () => {
    if (busy || typeof onSavePreset !== 'function') return
    setBusy(true)
    let result
    try { result = await onSavePreset(naming || '') } catch { result = { ok: false, reason: "Couldn't save just now." } }
    if (!mounted.current) return
    setBusy(false)
    if (result?.ok) { setNaming(null); setMessage(`${result.message || 'Saved as a preset.'} Type /preset to use it.`) } else setMessage(result?.reason || "Couldn't save just now.")
  }

  const privateChip = account && !share
  const stamp = etDateTime(asOf)
  return (
    <div className={styles.frame} data-snapshot-frame="">
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        {privateChip ? (
          <span className={styles.chip} data-snapshot-lock="">
            <UIcon name="lock" size={12} gold={false} />
            <span>Only you</span>
          </span>
        ) : (
          <span className={styles.chip}>Snapshot</span>
        )}
        <span className={styles.asOf}>{stamp ? `as of ${stamp}` : 'as of an unrecorded time'}</span>
        {offline && <span className={styles.chip} data-snapshot-offline="" title={OFFLINE_SENTENCE}>Offline</span>}
        <span className={styles.spacer} />
        {/* R58 (UX I-8): a market widget never reaches a shared page (its numbers are the market's), and says so
            where an account widget offers its switch. */}
        {!account && <span className={styles.chip} data-snapshot-public="">Not shown on shared pages</span>}
        {editable && account && (
          <label className={styles.shareRow}>
            <Switch
              checked={share}
              disabled={!editable}
              onClick={() => onShareChange?.(!share)}
              className={styles.switch}
              checkedClassName={styles.switchOn}
              knobClassName={styles.thumb}
            />
            <span>Show on shared pages</span>
          </label>
        )}
        {editable && (
          <button type="button" className={styles.btn} onClick={refresh} disabled={busy || offline}
            aria-busy={busy || undefined} title={offline ? OFFLINE_SENTENCE : undefined}>
            See it now
          </button>
        )}
        {editable && onChange && changeKeys.length > 0 && change === null && (
          <button type="button" className={styles.btn} onClick={() => { setChange({ ...settings }); setMessage('') }}>
            Change
          </button>
        )}
        {editable && onSavePreset && naming === null && (
          <button type="button" className={styles.btn} onClick={() => { setNaming(''); setMessage('') }}>
            Save these settings as a preset
          </button>
        )}
      </div>
      {change !== null && (
        <form className={styles.presetForm} aria-label="Change this widget"
          onSubmit={(e) => { e.preventDefault(); submitChange() }}>
          {changeKeys.map((k) => {
            const F = CHANGE_FIELDS[k]
            const set = (v) => setChange((c) => ({ ...c, [k]: F.upper ? v.toUpperCase().replace(/\s+/g, '') : v }))
            return F.options ? (
              <select key={k} className={styles.presetInput} aria-label={F.label} value={change[k] || ''}
                onChange={(e) => set(e.target.value)}>
                <option value="">{F.label}</option>
                {F.options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            ) : (
              <input key={k} className={styles.presetInput} type={F.type || 'text'} aria-label={F.label}
                placeholder={F.placeholder} value={change[k] || ''} onChange={(e) => set(e.target.value)} />
            )
          })}
          <button type="submit" className={styles.btn} disabled={busy}>Show these</button>
          <button type="button" className={styles.btn} onClick={() => setChange(null)}>Cancel</button>
        </form>
      )}
      {naming !== null && (
        <form className={styles.presetForm} onSubmit={(e) => { e.preventDefault(); savePresetNamed() }}>
          <input
            className={styles.presetInput} value={naming} maxLength={NAME_MAX} aria-label="Preset name"
            placeholder="Weekly review P&L" onChange={(e) => setNaming(e.target.value)}
          />
          <button type="submit" className={styles.btn} disabled={busy}>Save preset</button>
          <button type="button" className={styles.btn} onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      {offline && !message && <p className={styles.note}>{OFFLINE_SENTENCE}</p>}
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.body}>
        {tooLarge ? <p className={styles.empty} data-snapshot-too-large="">{tooLargeText || TOO_LARGE_SENTENCE}</p> : children}
      </div>
      {sourceDetail && <p className={styles.source}>{sourceDetail}</p>}
      {sourceLine && <p className={styles.source}>{sourceLine}</p>}
    </div>
  )
}

/** R58 (UX I-10): the settings a member can change, per request key: its label and its control. */
const CHANGE_FIELDS = {
  symbol: { label: 'Symbol', placeholder: 'NVDA', upper: true },
  list: { label: 'List', options: [['watchlist', 'Watchlist'], ['flagged', 'Flagged']] },
  from: { label: 'From', type: 'date' },
  to: { label: 'To', type: 'date' },
  month: { label: 'Month', type: 'month' },
}

/** The request keys a kind's Change edits, read from its registry paramsSchema: a frozen `range` is asked for with
 *  from/to, a `listLabel` with list, a `month` with month, and a `symbol` with symbol (a trade recap's symbol is
 *  its trade's, never a setting: its request key is the trade). A trade or a screen is chosen from the / menu. */
export function changeKeysOf(kind) {
  const keys = new Set((widgetMeta(kind)?.paramsSchema || []).map((f) => f.key))
  return [
    ...(keys.has('symbol') && !keys.has('tradeId') ? ['symbol'] : []),
    ...(keys.has('listLabel') ? ['list'] : []),
    ...(keys.has('range') ? ['from', 'to'] : []),
    ...(keys.has('month') ? ['month'] : []),
  ]
}

/** One snapshot write, written through to `ref` when the host took it (final review M-1, below). */
const writeThrough = (ref, write, next) => { if (write(next) !== false) ref.current = next }

/** The frame's props for one stored snapshot: title, as-of, privacy, and the two doors wired to
 *  the host's `onUpdateParams`. With no host callback (or a read-only note) there are no doors. */
export function useSnapshotFrame(kind, attrs, { editable = false, onUpdateParams } = {}) {
  const params = attrs?.params || {}
  const meta = widgetKind(kind)
  const canWrite = editable === true && typeof onUpdateParams === 'function'
  // ⛔ LIVE, NOT CLICK-TIME. A refresh awaits a request, and in that time the member can switch
  // `share` off or the note can turn read-only. These refs are updated every render, and the write
  // after the await reads them: the merge starts from the CURRENT params (so the current `share`
  // wins, never the click-time copy), and a host that is no longer writable gets no write at all.
  const paramsRef = useRef(params)
  paramsRef.current = params
  const writeRef = useRef(null)
  writeRef.current = canWrite ? onUpdateParams : null
  // Final review M-1: two writes before a re-render. The node's attrs reach this hook only on the NEXT render,
  // so a refresh that resolves in the same frame as a share switch would merge from the pre-switch params and
  // write `share` back the unsafe way. Each write this frame lands is therefore written through to the ref at
  // once (the host answers false when it wrote nothing), so the next write always starts from the node as it
  // now stands; the next render re-reads the real attrs.
  const onRefresh = useCallback(async () => {
    const got = await fetchWidgetPayload(kind, requestParamsOf(paramsRef.current))
    if (got.ok) {
      const write = writeRef.current
      if (typeof write !== 'function') return { ok: false, reason: 'failed' }
      writeThrough(paramsRef, write, refreshParams(paramsRef.current, got.payload))
    }
    return got
  }, [kind])
  // R58 (UX I-10): the same write as See it now, asked with the member's new settings, which are stored as the
  // request keys (so a later See it now and a preset made from this widget keep them).
  const onChange = useCallback(async (next) => {
    const asked = {}
    for (const [k, v] of Object.entries(next || {})) if (typeof v === 'string' && v.trim()) asked[k] = v.trim()
    const got = await fetchWidgetPayload(kind, { ...requestParamsOf(paramsRef.current), ...asked })
    if (got.ok) {
      const write = writeRef.current
      if (typeof write !== 'function') return { ok: false, reason: 'failed' }
      writeThrough(paramsRef, write, { ...refreshParams(paramsRef.current, got.payload), ...asked })
    }
    return got
  }, [kind])
  const onShareChange = useCallback((value) => {
    const write = writeRef.current
    if (typeof write === 'function') writeThrough(paramsRef, write, { ...paramsRef.current, share: value === true })
  }, [])
  const onSavePreset = useCallback((name) => savePreset({ name, kind, params: paramsRef.current }), [kind])
  return {
    title: meta?.title || kind,
    asOf: params.asOf,
    account: meta?.account === true,
    share: params.share === true,
    // F1's payload keys: where the numbers came from, and the too-large form (its sentence is `empty`).
    sourceDetail: typeof params.sourceDetail === 'string' && params.sourceDetail ? params.sourceDetail : null,
    tooLarge: params.tooLarge === true,
    tooLargeText: typeof params.empty === 'string' ? params.empty : null,
    editable: canWrite,
    onRefresh: canWrite ? onRefresh : undefined,
    onShareChange: canWrite ? onShareChange : undefined,
    changeKeys: changeKeysOf(kind),
    settings: requestParamsOf(params),
    onChange: canWrite ? onChange : undefined,
    // Only an editable snapshot offers it, and only while wave 5 is on.
    onSavePreset: canWrite && meta && widgetsWaveOn(5) ? onSavePreset : undefined,
  }
}

// ── Cells ────────────────────────────────────────────────────────────────────

/** An unknown figure: never 0, never blank. R58 (UX I-3): the reason is reachable without a pointer that
 *  hovers. A screen reader hears it in the control's name, and a tap or a click shows it as text beside the
 *  n/a; `title` keeps the desktop hover. */
export function NA({ reason }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={styles.naBox}>
      <button type="button" className={styles.na} title={reason} aria-label={`n/a: ${reason}`}
        aria-expanded={open} onClick={() => setOpen(!open)}>n/a</button>
      {open && <span className={styles.naWhy}>{reason}</span>}
    </span>
  )
}

/** An earnings day: the date, or for none "None this week" once the calendar was read, or n/a with the reason
 *  when it was not (`earningsUnknown`). A snapshot from before F1 carries neither, and keeps its old reason. */
export function earningsCell(day, unknown, fmt) {
  if (day) return fmt(day)
  if (unknown === true) return <NA reason={EARNINGS_UNREAD} />
  if (unknown === false) return <span className={styles.none}>None this week</span>
  return <NA reason="No earnings date in the next seven days" />
}

/** `fmt(value)`, or n/a with `reason` when the value is not a finite number. */
export function numCell(value, fmt, reason) {
  return typeof value === 'number' && Number.isFinite(value) ? fmt(value) : <NA reason={reason} />
}

/** The tone class for a signed figure. */
export const toneOf = (v) => (typeof v === 'number' && v > 0 ? styles.up : typeof v === 'number' && v < 0 ? styles.dn : '')

export const fmtPrice = (v) => money(v)
export const fmtMoneySigned = (v) => moneySigned(v)
export const fmtChangePct = (v) => percent(v, { isRatio: false, signed: true })
export const fmtPctPlain = (v, dp = 1) => percent(v, { isRatio: false, dp })
export const fmtRatioPct = (v) => percent(v, { isRatio: true, dp: 0 })
export const fmtDay = (iso) => isoDayText(iso)

const SOURCE_LINES = {
  broker: 'Source: your linked broker',
  manual: 'Source: your manual trades',
  mixed: 'Source: your linked broker and manual trades',
}
/** The provenance line for an account kind's params: none when the server sent its own `sourceDetail`, which the
 *  frame shows instead. */
export const accountSourceLine = (p) => (p?.sourceDetail ? null : SOURCE_LINES[p?.source] || null)

export { styles as snapshotStyles }
