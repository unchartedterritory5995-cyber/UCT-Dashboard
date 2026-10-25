import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
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
import {
  BUILT_KIND, BUILT_CHANGE_KEYS, runBuilt, builtRefreshParams, viewerSettingsOf, failureText, overridableFilter,
  loadAccounts, loadVocabulary, loadCatalog, loadDefinition,
} from '../../../lib/builtWidgets'
import {
  isDedicated, settingsKeysOf, runDedicated, dedicatedRequestOf, dedicatedRefreshParams,
} from '../../../lib/dedicatedWidgets'
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
/** M6: Change asked while the browser is offline (no request was made). */
export const CHANGE_OFFLINE_SENTENCE = "Offline. You can change this when you're back."
/** The earnings calendar was not read (`earningsUnknown: true`): an unknown day, never "none". */
export const EARNINGS_UNREAD = 'The earnings calendar could not be read just now'

export default function SnapshotFrame({
  title, asOf, account = false, share = false, editable = false,
  onRefresh, onShareChange, onSavePreset, sourceLine, sourceDetail, tooLarge = false, tooLargeText, children,
  changeKeys = [], settings = {}, onChange, changeContext = null, menu = null, kind = null,
}) {
  const [busy, setBusy] = useState(false)
  const [change, setChange] = useState(null)   // the settings being edited, or null when closed
  const [message, setMessage] = useState('')
  const [naming, setNaming] = useState(null)   // the preset name being typed, or null when closed
  const [loaded, setLoaded] = useState({})      // Change's choices, read when it opened, by field
  const [fetchedDef, setFetchedDef] = useState(null)  // a defRef-only widget's plan, read when Change opened
  const ctx = changeContext && !changeContext.def && fetchedDef ? { ...changeContext, def: fetchedDef } : changeContext
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
    // `quiet`: a failure with nothing to say (a built widget's superseded run). `text`: the run's own sentence.
    if (!result?.ok && !result?.quiet) setMessage(result?.text || refreshFailureText(result?.reason))
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
    else if (result?.reason === 'offline') setMessage(CHANGE_OFFLINE_SENTENCE)
    else if (!result?.quiet) setMessage(result?.message || refreshFailureText(result?.reason))
  }

  // Change opens: a field that reads its choices (a built widget's ranges, accounts and filter values) asks for
  // them now; a read that fails leaves the field with what it already shows.
  const loadField = (k, c) => {
    const F = CHANGE_FIELDS[k]
    if (!F?.load || (F.enabled && !F.enabled(c))) return
    Promise.resolve().then(() => F.load(c)).then((opts) => {
      if (mounted.current && Array.isArray(opts)) setLoaded((l) => ({ ...l, [k]: opts }))
    }, () => {})
  }
  const openChange = () => {
    setChange({ ...settings })
    setMessage('')
    for (const k of changeKeys) loadField(k, ctx)
    // M4: a widget whose plan was too large to freeze (`defRef` only) has no `def` to read its overridable filter
    // from, so the plan is read from the widget itself. A read that fails leaves the filter disabled, with its
    // reason; a field with no `enabled` rule was already loaded above.
    if (ctx && !ctx.def && typeof ctx.loadDef === 'function') {
      Promise.resolve().then(() => ctx.loadDef()).then((def) => {
        if (!mounted.current || !def || typeof def !== 'object') return
        setFetchedDef(def)
        for (const k of changeKeys) if (CHANGE_FIELDS[k]?.enabled) loadField(k, { ...ctx, def })
      }, () => {})
    }
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
    // Wave 8 (Task 8.14, H14): only a BUILT widget reserves its scrollbar gutter (its charts measure their width).
    <div className={`${styles.frame} ${kind === BUILT_KIND ? styles.frameGutter : ''}`} data-snapshot-frame="">
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
          <button type="button" className={styles.btn} onClick={openChange}>
            Change
          </button>
        )}
        {editable && onSavePreset && naming === null && (
          <button type="button" className={styles.btn} onClick={() => { setNaming(''); setMessage('') }}>
            Save these settings as a preset
          </button>
        )}
        {/* Wave 8 (Task 8.14): a kind's own header controls (a built widget's ⋯ menu), drawn last. */}
        {menu}
      </div>
      {change !== null && (
        <form className={styles.presetForm} aria-label="Change this widget"
          onSubmit={(e) => { e.preventDefault(); submitChange() }}>
          {changeKeys.map((k) => {
            const F = CHANGE_FIELDS[k]
            const set = (v) => setChange((c) => ({ ...c, [k]: F.upper ? v.toUpperCase().replace(/\s+/g, '') : v }))
            if (F.load) {
              return <LoadedField key={k} name={k} F={F} change={change} setChange={setChange} set={set}
                loaded={loaded[k]} ctx={ctx} />
            }
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

/** A Change field whose choices are read when Change opens (`F.load`): a select, or a multi-select (`multiple`).
 *  The value already chosen is always one of its options, so a read still in flight never blanks it. `reveals`
 *  names the choice that shows more fields (a built widget's "Fixed dates" shows From and To). */
function LoadedField({ name, F, change, setChange, set, loaded, ctx }) {
  const enabled = !F.enabled || F.enabled(ctx)
  const whyId = useId()
  const cur = change[name]
  if (F.multiple) {
    const values = Array.isArray(cur) ? cur.map(String) : []
    const opts = [...(Array.isArray(loaded) ? loaded : [])]
    for (const v of values) if (!opts.some(([o]) => o === v)) opts.push([v, v])
    // M3: a disabled field says why in visible text, tied to it for a screen reader, never in a title alone.
    return (
      <Fragment>
        <select multiple className={styles.presetInput} aria-label={F.label} value={values} disabled={!enabled}
          aria-describedby={enabled ? undefined : whyId}
          onChange={(e) => setChange((c) => ({ ...c, [name]: [...e.target.selectedOptions].map((o) => o.value) }))}>
          {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {!enabled && F.disabledWhy && <span id={whyId} className={styles.note}>{F.disabledWhy}</span>}
      </Fragment>
    )
  }
  const opts = [...(Array.isArray(loaded) ? loaded : []), ...(F.extra || [])]
  if (typeof cur === 'string' && cur && !opts.some(([v]) => v === cur)) opts.unshift([cur, F.pending?.(ctx) || cur])
  const shown = F.reveals && cur === F.reveals.value ? F.reveals.keys : []
  return (
    <Fragment>
      <select className={styles.presetInput} aria-label={F.label} value={typeof cur === 'string' ? cur : ''}
        disabled={!enabled} onChange={(e) => set(e.target.value)}>
        <option value="">{F.empty || F.label}</option>
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {shown.map((rk) => (
        <input key={rk} className={styles.presetInput} type={CHANGE_FIELDS[rk].type} aria-label={CHANGE_FIELDS[rk].label}
          value={change[rk] || ''} onChange={(e) => setChange((c) => ({ ...c, [rk]: e.target.value }))} />
      ))}
    </Fragment>
  )
}

const upperFirst = (t) => (typeof t === 'string' && t ? t[0].toUpperCase() + t.slice(1) : '')

/** R58 (UX I-10): the settings a member can change, per request key: its label and its control. */
const CHANGE_FIELDS = {
  symbol: { label: 'Symbol', placeholder: 'NVDA', upper: true },
  list: { label: 'List', options: [['watchlist', 'Watchlist'], ['flagged', 'Flagged']] },
  from: { label: 'From', type: 'date' },
  to: { label: 'To', type: 'date' },
  month: { label: 'Month', type: 'month' },
  // Wave 8 (Task 8.13): a built widget's viewer settings (spec 5.6). The choices come from the server: the range
  // tokens and their labels from the catalog, the accounts from GET /api/j2/accounts, the filter's values from the
  // member's own vocabulary. "" keeps the widget's own choice (its range; all accounts).
  range: {
    label: 'Date range', empty: "The widget's own range", extra: [['fixed', 'Fixed dates']],
    reveals: { value: 'fixed', keys: ['from', 'to'] }, pending: (ctx) => upperFirst(ctx?.rangeLabel),
    load: () => loadCatalog().then((c) => (Array.isArray(c?.ranges) ? c.ranges : [])
      .filter((r) => r && typeof r.token === 'string').map((r) => [r.token, upperFirst(r.label || r.token)])),
  },
  accountId: {
    label: 'Accounts', empty: 'All my accounts', pending: (ctx) => ctx?.scopeLabel,
    load: () => loadAccounts().then((list) => list.map((a) => [a.id, a.name])),
  },
  // Wave 10 (Task 10.14): the prop-firm limits (a dedicated widget's own settings; `accountId` is the row above).
  dailyLoss: { label: 'Daily loss limit ($)', type: 'number' },
  maxDrawdown: { label: 'Max drawdown ($)', type: 'number' },
  since: { label: 'Challenge started', type: 'date' },
  filter: {
    label: 'Filter values', multiple: true,
    disabledWhy: 'This widget has no filter you can change from the note.',
    enabled: (ctx) => overridableFilter(ctx?.def) !== null,
    load: (ctx) => loadVocabulary(overridableFilter(ctx?.def)?.field).then((vals) => vals
      .map((v) => (v && typeof v === 'object' ? [String(v.id), String(v.name || v.id)] : [String(v), String(v)]))),
  },
}

/** A built widget's settings as Change edits them: the range as its token, or "fixed" with From and To. */
function builtChangeState(params) {
  const v = viewerSettingsOf(params)
  return {
    range: v.range?.token || (v.range ? 'fixed' : ''),
    from: v.range?.from || '',
    to: v.range?.to || '',
    accountId: v.accountId || '',
    filter: v.filter ? v.filter.map(String) : [],
  }
}

/** A dedicated widget's settings as Change edits them: each value as text ("" when unset). */
function dedicatedChangeState(kind, params) {
  const s = params?.settings && typeof params.settings === 'object' && !Array.isArray(params.settings) ? params.settings : {}
  return Object.fromEntries(changeKeysOf(kind).map((k) => [k, s[k] === undefined || s[k] === null ? '' : String(s[k])]))
}

/** A built widget's failed run as the frame reads it: the spec 5.10 sentence, or `quiet` when there is none to
 *  show (a superseded run: a newer one is already in flight). */
function builtFailure(got) {
  const text = failureText(got?.code, got?.message)
  return text ? { ok: false, reason: got?.code || 'failed', text, message: text } : { ok: false, quiet: true }
}

/** The request keys a kind's Change edits, read from its registry paramsSchema: a frozen `range` is asked for with
 *  from/to, a `listLabel` with list, a `month` with month, and a `symbol` with symbol (a trade recap's symbol is
 *  its trade's, never a setting: its request key is the trade). A trade or a screen is chosen from the / menu. */
export function changeKeysOf(kind) {
  if (kind === BUILT_KIND) return [...BUILT_CHANGE_KEYS]
  // Wave 10: a dedicated widget's own settings that Change has a field for (a Plan vs actual trade is picked).
  if (isDedicated(kind)) return settingsKeysOf(kind).filter((k) => Object.hasOwn(CHANGE_FIELDS, k))
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
export function useSnapshotFrame(kind, attrs, { editable = false, onUpdateParams, uid } = {}) {
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
    // Review m-5: a field the member emptied is CLEARED (left out of the request and of the stored keys, so the
    // server's default applies), never silently re-asked with its old value.
    const asked = {}
    const cleared = []
    for (const k of changeKeysOf(kind)) {
      const v = next?.[k]
      if (typeof v === 'string' && v.trim()) asked[k] = v.trim()
      else cleared.push(k)
    }
    const req = { ...requestParamsOf(paramsRef.current), ...asked }
    for (const k of cleared) delete req[k]
    const got = await fetchWidgetPayload(kind, req)
    if (got.ok) {
      const write = writeRef.current
      if (typeof write !== 'function') return { ok: false, reason: 'failed' }
      const merged = { ...refreshParams(paramsRef.current, got.payload), ...asked }
      for (const k of cleared) delete merged[k]
      // ...and the server's own spelling of the symbol wins over the member's typing.
      if (typeof got.payload?.symbol === 'string' && got.payload.symbol) merged.symbol = got.payload.symbol
      writeThrough(paramsRef, write, merged)
    }
    return got
  }, [kind])
  // Wave 8 (Task 8.13): a BUILT widget re-runs through POST /api/j2/widget-definitions/run, and the server echoes
  // every key the note keeps, so the write is the payload plus the member's share switch (builtRefreshParams). It
  // writes through the SAME ref, so a share switch made while the request ran wins.
  const onBuiltRefresh = useCallback(async () => {
    const got = await runBuilt(paramsRef.current)
    if (!got.ok) return builtFailure(got)
    const write = writeRef.current
    if (typeof write !== 'function') return { ok: false, reason: 'failed' }
    writeThrough(paramsRef, write, builtRefreshParams(paramsRef.current, got.data))
    return { ok: true }
  }, [])
  // Change asks the same run with the member's new settings; the server echoes them, so they are stored as asked.
  const onBuiltChange = useCallback(async (next) => {
    const n = next || {}
    let range = null
    if (n.range === 'fixed') {
      if (!n.from || !n.to) return { ok: false, reason: 'invalid', message: 'Pick a start and an end date.' }
      range = { from: n.from, to: n.to }
    } else if (typeof n.range === 'string' && n.range) range = { token: n.range }
    const filter = Array.isArray(n.filter) && n.filter.length ? n.filter.map(String) : null
    const got = await runBuilt({ ...paramsRef.current, range, accountId: n.accountId || null, filter })
    if (!got.ok) return builtFailure(got)
    const write = writeRef.current
    if (typeof write !== 'function') return { ok: false, reason: 'failed' }
    writeThrough(paramsRef, write, builtRefreshParams(paramsRef.current, got.data))
    return { ok: true }
  }, [])
  // Wave 10 (Task 10.14, W10-R4): a DEDICATED widget re-runs through POST /api/j2/notebook-shelf-widgets/{kind} with the
  // member's own settings (params.settings) in the body, one at a time (lib/dedicatedWidgets.js). The write is the
  // payload plus those settings and the CURRENT share switch, through the same ref as every other write.
  const onDedicatedRefresh = useCallback(async () => {
    const got = await runDedicated(kind, dedicatedRequestOf(kind, paramsRef.current))
    if (!got.ok) return builtFailure(got)
    const write = writeRef.current
    if (typeof write !== 'function') return { ok: false, reason: 'failed' }
    writeThrough(paramsRef, write, dedicatedRefreshParams(paramsRef.current, got.data))
    return { ok: true }
  }, [kind])
  // Change asks the same door with the new settings; a field the member emptied is cleared (the server default).
  const onDedicatedChange = useCallback(async (next) => {
    const cur = paramsRef.current?.settings
    const settings = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}) }
    for (const k of changeKeysOf(kind)) {
      const v = typeof next?.[k] === 'string' ? next[k].trim() : next?.[k]
      if (v === undefined || v === null || v === '') delete settings[k]
      else settings[k] = CHANGE_FIELDS[k].type === 'number' && Number.isFinite(Number(v)) ? Number(v) : v
    }
    const got = await runDedicated(kind, dedicatedRequestOf(kind, { settings }))
    if (!got.ok) return builtFailure(got)
    const write = writeRef.current
    if (typeof write !== 'function') return { ok: false, reason: 'failed' }
    writeThrough(paramsRef, write, { ...dedicatedRefreshParams(paramsRef.current, got.data), settings })
    return { ok: true }
  }, [kind])
  const onShareChange = useCallback((value) => {
    const write = writeRef.current
    if (typeof write === 'function') writeThrough(paramsRef, write, { ...paramsRef.current, share: value === true })
  }, [])
  const onSavePreset = useCallback((name) => savePreset({ name, kind, params: paramsRef.current, uid }), [kind, uid])
  const built = kind === BUILT_KIND
  const dedicated = isDedicated(kind)
  return {
    kind,
    // A built widget carries its member-given title; every kind falls back to its own name.
    title: (typeof params.title === 'string' && params.title) || meta?.title || kind,
    asOf: params.asOf,
    account: meta?.account === true,
    share: params.share === true,
    // F1's payload keys: where the numbers came from, and the too-large form (its sentence is `empty`).
    sourceDetail: typeof params.sourceDetail === 'string' && params.sourceDetail ? params.sourceDetail : null,
    tooLarge: params.tooLarge === true,
    tooLargeText: typeof params.empty === 'string' ? params.empty : null,
    editable: canWrite,
    onRefresh: canWrite ? (built ? onBuiltRefresh : dedicated ? onDedicatedRefresh : onRefresh) : undefined,
    onShareChange: canWrite ? onShareChange : undefined,
    changeKeys: changeKeysOf(kind),
    settings: built ? builtChangeState(params) : dedicated ? dedicatedChangeState(kind, params) : requestParamsOf(params),
    onChange: canWrite ? (built ? onBuiltChange : dedicated ? onDedicatedChange : onChange) : undefined,
    changeContext: built ? {
      def: params.def, scopeLabel: params.scopeLabel, rangeLabel: params.rangeLabel,
      // M4: a defRef-only widget reads its plan from GET /{defId} when Change opens.
      loadDef: typeof params.defId === 'string' && params.defId ? () => loadDefinition(params.defId) : null,
    } : null,
    // Only an editable snapshot offers it, and only while wave 5 is on. A built widget's settings belong to its
    // definition, so it offers no preset (spec 5.6); nor does a dedicated widget (lib/notebookSets.js SNAPSHOT_IDS).
    onSavePreset: canWrite && meta && !built && !dedicated && widgetsWaveOn(5) ? onSavePreset : undefined,
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

/** R60 (privacy audit M-6): a stored value used as a lookup key reads only the map's OWN entries. A crafted or
 *  legacy note's "__proto__", "constructor" or "toString" would otherwise reach Object.prototype (an object as a
 *  React child throws, and the embed drops to its error boundary). */
export const own = (map, k) => (typeof k === 'string' && Object.hasOwn(map, k) ? map[k] : undefined)
/** The same guard for a key handed to a shared helper whose map this module cannot see: the value, or undefined
 *  when it names anything Object.prototype has (or `prototype` itself). */
export const safeKey = (k) => (typeof k === 'string' && k !== 'prototype' && !(k in Object.prototype) ? k : undefined)

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
export const accountSourceLine = (p) => (p?.sourceDetail ? null : own(SOURCE_LINES, p?.source) || null)

export { styles as snapshotStyles }
