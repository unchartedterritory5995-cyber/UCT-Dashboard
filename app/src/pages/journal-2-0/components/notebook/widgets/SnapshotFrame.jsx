import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import Switch from '../../../../../components/ui/Switch'
import { money, moneySigned, percent } from '../../../../../lib/journal-2-0/format'
import { etDateTime, isoDayText } from '../captureStamp'
import { widgetKind } from '../../../lib/notebookWidgets'
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import { savePreset, NAME_MAX } from '../../../lib/notebookSets'
import {
  fetchWidgetPayload, refreshParams, requestParamsOf, refreshFailureText,
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

export default function SnapshotFrame({
  title, asOf, account = false, share = false, editable = false,
  onRefresh, onShareChange, onSavePreset, sourceLine, children,
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [naming, setNaming] = useState(null)   // the preset name being typed, or null when closed
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
        <span className={styles.spacer} />
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
          <button type="button" className={styles.btn} onClick={refresh} disabled={busy} aria-busy={busy || undefined}>
            See it now
          </button>
        )}
        {editable && onSavePreset && naming === null && (
          <button type="button" className={styles.btn} onClick={() => { setNaming(''); setMessage('') }}>
            Save these settings as a preset
          </button>
        )}
      </div>
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
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.body}>{children}</div>
      {sourceLine && <p className={styles.source}>{sourceLine}</p>}
    </div>
  )
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
    editable: canWrite,
    onRefresh: canWrite ? onRefresh : undefined,
    onShareChange: canWrite ? onShareChange : undefined,
    // Only an editable snapshot offers it, and only while wave 5 is on.
    onSavePreset: canWrite && meta && widgetsWaveOn(5) ? onSavePreset : undefined,
  }
}

// ── Cells ────────────────────────────────────────────────────────────────────

/** An unknown figure: never 0, never blank. `title` says why it is unknown. */
export function NA({ reason }) {
  return <span className={styles.na} title={reason}>n/a</span>
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
/** The provenance line for an account kind's `source`. */
export const accountSourceLine = (source) => SOURCE_LINES[source] || null

export { styles as snapshotStyles }
