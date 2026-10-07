/**
 * ChartPlanPanel — "the chart markup is the plan" (wave 13 lane 13H-2, plan A.13H H3-H6).
 *
 * Under a note's chart: every flat level the member drew (a horizontal line or ray in the price
 * pane) is listed with its price, and each can be marked Entry, Stop or Target, armed as an
 * alert, and the plan sized. Dark behind 13H-1's `notebook_chart_plan_enabled`: the embed only
 * mounts this file when the gate is on (WidgetEmbedView), and it is lazy, so the Notebook's
 * first-open bytes do not move.
 *
 * ⛔ ONE READER OF PLAN LEVELS. This panel WRITES a role onto a drawing (`setPlanRole`, 13H-1's
 * writer — the shape 13A's `plan_extract` reads) and never reads a plan out of the drawings
 * itself. The numbers come from the server's reading: `POST /api/j2/chart-plan/size` hands the
 * block to `plan_extract` and answers {plan, account, compass}; `sizePlan` then evaluates the
 * STARTER FORMULAS on those numbers (no new formula). The roles shown on each row are the
 * drawing's own field — what the member set — not a second plan.
 *
 * ⛔ ONE ALERT PIPELINE. "Arm alert at this level" posts to 13H-1's thin adapter
 * (`/api/j2/chart-plan/alerts`), which calls the EXISTING watchlist-alert route with a bound
 * `drawing_id`. Moving the line re-points the alert through the EXISTING bound PATCH, and
 * deleting it deletes the alert under the EXISTING seen-to-absent rule — both by mounting
 * `useBoundDrawingAlerts` on THIS chart's drawings. A cold mount never deletes (that hook's
 * rule: a drawing this session never saw is left alone).
 *   The bound id is namespaced to the chart (`nb:<embedId>:<drawingId>`): a note chart's
 *   drawings are often a COPY of the symbol's /charts drawings (same ids, frozen at capture),
 *   and an un-namespaced id would let the /charts chart re-point a note's alert to ITS line.
 *
 * ⛔ WRITES ARE EXPLICIT ACTIONS. A role change, "Use this size" and nothing else write the
 * note — through `updateAttributes`, the member's own editor transaction (autosave, CAS, the
 * outbox). Showing a number never writes it.
 *
 * Touch: the panel claims BOTH event families (pointerdown/mousedown AND touchstart) at its
 * root, so a tap on it never reaches the editor's selection handling or a drag under it (the
 * CLAUDE.md touch-routing rule: a stop of the wrong family is no stop). Every control meets
 * the 44px floor on the touch tier.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mutate as globalMutate } from 'swr'
import {
  canCarryPlanRole, drawingLevelPrice, setPlanRole, sizePlan, withPlanShares, SIZED_BY_LABEL,
  addLevel, moveLevel,
} from '../../lib/chartPlan'
import { AddLevelForm, LevelPriceField, RoleRadios } from './ChartPlanLevelControls'
import { PRICE_ROLES } from '../../lib/planLevels'
import { PLAN_STOP_ARIA_KEYS, planStopChordLabel, usePlanStopShortcut } from '../../lib/planStopShortcut'
import useBoundDrawingAlerts from '../../../../components/chart/useBoundDrawingAlerts'
import { anchorsForDrawing } from '../../../../components/chart/drawingAlertAnchors'
import { money } from '../../../../lib/journal-2-0/format'
import { etDayOf } from '../../lib/calendar'
import BarReplay, { barTs } from './BarReplay'
import styles from './ChartPlanPanel.module.css'

const ROLE_LABEL = { entry: 'Entry', stop: 'Stop', target: 'Target' }
const ROLE_COLOR = { entry: '#c9a84c', stop: '#ef4444', target: '#22c55e' }
const SIZE_DEBOUNCE_MS = 300
const NATIVE_TFS = new Set(['1', '5', '15', '30', '60', 'D', 'W', 'M'])
const REPLAY_BEFORE = 40      // context bars revealed before the note's as-of
const REPLAY_AFTER = 250      // at most this many bars after it

/** The bound-alert id of a drawing on THIS chart (see the header). */
export const boundAlertId = (embedId, drawingId) => `nb:${embedId}:${drawingId}`

/** Which way an alert at a role's level should trigger, given the plan's side. null = ask. */
export function roleDirection(role, side) {
  if (side !== 'long' && side !== 'short') return null
  const long = side === 'long'
  if (role === 'stop') return long ? 'below' : 'above'
  if (role === 'target' || role === 'entry') return long ? 'above' : 'below'
  return null
}

const fmtPrice = (p) => (Number.isFinite(p) ? (p >= 1 ? p.toFixed(2) : p.toPrecision(3)) : '—')

async function readSizing(body, signal) {
  const res = await fetch('/api/j2/chart-plan/size', {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(res.status === 404 ? 'Chart plans are not available right now.' : 'The plan could not be sized.')
  return res.json()
}

/** The note's as-of moment as epoch seconds (params.to, else the capture time), or null. */
function asOfSeconds(attrs) {
  const to = attrs?.params?.to
  if (typeof to === 'number' && Number.isFinite(to)) return to > 10_000_000_000 ? Math.floor(to / 1000) : to
  if (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}/.test(to)) return barTs(to.slice(0, 10))
  const cap = Date.parse(attrs?.capturedAt || '')
  return to === null || !Number.isFinite(cap) ? null : Math.floor(cap / 1000)
}

/** The note's as-of EASTERN trading day (params.to, else the capture time), or null for a chart
 *  that tracks now. The same day the chart block is frozen at (ChartEmbed `tsToAnchorDay`),
 *  through the same function. ⛔ Never a UTC day: an evening plan would read as tomorrow's. */
export function noteAsOfDay(attrs) {
  const to = attrs?.params?.to
  if (to === null) return null
  return etDayOf(to) ?? etDayOf(Date.parse(attrs?.capturedAt || ''))
}

/** The bars a replay shows: context up to the note, then what printed after it.
 *  Daily, weekly and monthly bars are compared BY DAY against the note's Eastern day;
 *  intraday bars by the exact moment. Returns {bars, startIdx} or {error}. */
export function windowAfterNote(all, { day, sec, daily }) {
  if (day == null && sec == null) return { error: 'This chart tracks now, so nothing has printed after it yet.' }
  const known = daily
    ? (b) => (etDayOf(b.t) ?? '') <= day
    : (b) => barTs(b.t) <= sec
  let asIdx = -1
  for (let i = 0; i < all.length; i++) {
    if (known(all[i])) asIdx = i
    else break
  }
  if (asIdx < 0) return { error: 'No bar history reaches this note’s date.' }
  if (asIdx >= all.length - 1) return { error: 'Nothing has printed after this note’s date yet.' }
  const start = Math.max(0, asIdx - REPLAY_BEFORE)
  const bars = all.slice(start, Math.min(all.length, asIdx + 1 + REPLAY_AFTER))
  return { bars, startIdx: asIdx - start + 1 }
}

export default function ChartPlanPanel({
  attrs, noteId, updateAttributes, open = false, replayOpen = false, onCloseReplay,
}) {
  const params = attrs?.params || {}
  const symbol = String(params.symbol || '').toUpperCase()
  const tf = String(params.tf ?? 'D')
  const embedId = attrs?.embedId || ''
  const annotations = useMemo(() => (Array.isArray(attrs?.annotations) ? attrs.annotations : []), [attrs?.annotations])
  const planBlock = attrs?.ta?.planBlock || null

  // ── claim both event families at the root (touch routing) ──────────────────────────────
  const rootRef = useRef(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const claim = (e) => e.stopPropagation()
    const types = ['pointerdown', 'mousedown', 'touchstart']
    types.forEach((t) => el.addEventListener(t, claim, t === 'touchstart' ? { passive: true } : false))
    return () => types.forEach((t) => el.removeEventListener(t, claim, t === 'touchstart' ? { passive: true } : false))
  }, [open])

  // ── follow-the-line: the EXISTING bound-alert sync, over this chart's drawings ─────────
  const nsDrawings = useMemo(
    () => annotations.map((d) => (d && d.id ? { ...d, id: boundAlertId(embedId, d.id) } : d)),
    [annotations, embedId],
  )
  const noBars = useCallback(() => [], [])
  // ⛔ `namespace` is this chart's own id prefix: the hook then touches ONLY this embed's
  // alerts. Without it the panel deleted the member's /charts alerts on the same symbol.
  const alerts = useBoundDrawingAlerts({
    sym: symbol, drawings: embedId ? nsDrawings : [], tf, getBars: noBars,
    namespace: boundAlertId(embedId || '?', ''),
  })
  const armedIds = useMemo(
    () => new Set((alerts || []).filter((a) => a?.is_active && a.drawing_id).map((a) => a.drawing_id)),
    [alerts],
  )

  // ── the levels a role can ride ──────────────────────────────────────────────────────────
  const levels = useMemo(
    () => annotations.filter(canCarryPlanRole).sort((a, b) => drawingLevelPrice(b) - drawingLevelPrice(a)),
    [annotations],
  )

  // ── the server's reading (plan_extract) + sizing inputs + Compass ───────────────────────
  const sizeKey = useMemo(() => JSON.stringify({
    levels: annotations.filter((d) => d && d.role).map((d) => [d.id, d.role, drawingLevelPrice(d) ?? d.price ?? null]),
    planBlock,
  }), [annotations, planBlock])
  const [reading, setReading] = useState({ status: 'idle', data: null, error: null })
  useEffect(() => {
    if (!open && !replayOpen) return undefined
    const ctl = new AbortController()
    setReading((r) => ({ ...r, status: 'loading', error: null }))
    const t = setTimeout(() => {
      readSizing({ annotations, symbol, ...(planBlock ? { planBlock } : {}) }, ctl.signal)
        .then((data) => setReading({ status: 'ok', data, error: null }))
        .catch((e) => {
          if (e?.name === 'AbortError') return
          setReading({ status: 'error', data: null, error: e?.message || 'The plan could not be sized.' })
        })
    }, SIZE_DEBOUNCE_MS)
    return () => { clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeKey, symbol, open, replayOpen])

  const plan = reading.data?.plan || null
  const sized = useMemo(() => (plan ? sizePlan({
    entry: plan.entry, stop: plan.stop, target: plan.target,
    accountSize: reading.data?.account?.accountSize, riskPct: reading.data?.account?.riskPct,
    compass: reading.data?.compass,
  }) : null), [plan, reading.data])

  // ── writes: explicit actions only ───────────────────────────────────────────────────────
  const [msg, setMsg] = useState(null)
  const setRole = (drawingId, role) => {
    const next = setPlanRole(annotations, drawingId, role || null)
    if (next !== annotations) updateAttributes?.({ annotations: next })
  }
  // Opening the plan puts focus in it (lane KEYS): the Plan button is in the chart's toolbar
  // and this panel renders below the chart, so the next Tab is now the plan's first control.
  // Only on a change from closed to open; a panel open from the start takes nothing.
  const wasOpenRef = useRef(open)
  useEffect(() => {
    const was = wasOpenRef.current
    wasOpenRef.current = open
    if (open && !was) rootRef.current?.focus({ preventScroll: false })
  }, [open])

  // Lane KEYS3 (Q21): Ctrl+Alt+S, from anywhere inside this open plan, goes to the stop's
  // alert button (lib/planStopShortcut.js; declared in the shared shortcut registry).
  usePlanStopShortcut(rootRef, open)

  // ── the typed door to a level (lane FIN-A11Y, I-6): make one, move one ─────────────────
  // Focus follows the level being worked on: the rows are sorted by price, so a step can
  // reorder them, and the field of a new level does not exist until the note re-renders.
  const focusLevelRef = useRef(null)
  useEffect(() => {
    const id = focusLevelRef.current
    if (!id) return
    const row = [...(rootRef.current?.querySelectorAll('[data-level-id]') || [])]
      .find((el) => el.getAttribute('data-level-id') === id)
    const field = row?.querySelector('[data-level-price]')
    if (!field) return
    focusLevelRef.current = null
    if (document.activeElement !== field) field.focus()
  }, [annotations])
  const badPrice = () => setMsg({ tone: 'err', text: 'Enter a price above zero.' })
  const moveLevelTo = (drawingId, price, viaStep) => {
    const next = moveLevel(annotations, drawingId, price)
    if (next === annotations) return
    focusLevelRef.current = drawingId
    updateAttributes?.({ annotations: next })
    // A step is announced by the field itself (its value); a typed move gets a sentence.
    setMsg(viaStep ? null : { tone: 'ok', text: `Moved the line to ${fmtPrice(price)}.` })
  }
  const addLevelAt = (price, role) => {
    const id = `lv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const anchored = annotations.find((d) => d?.points?.[0]?.time != null)
    const cap = Date.parse(attrs?.capturedAt || '')
    const time = anchored ? anchored.points[0].time : Math.floor((Number.isFinite(cap) ? cap : Date.now()) / 1000)
    focusLevelRef.current = id
    updateAttributes?.({ annotations: addLevel(annotations, price, { id, time, role }) })
    setMsg({
      tone: 'ok',
      text: role
        ? `Added a level at ${fmtPrice(price)}, marked ${ROLE_LABEL[role]}.`
        : `Added a level at ${fmtPrice(price)}. Mark it Entry, Stop or Target.`,
    })
  }
  const savedShares = planBlock?.shares ?? null
  const canSaveSize = sized?.shares != null && (savedShares !== sized.shares || planBlock?.sizedBy !== sized.sizedBy)
  const saveSize = () => {
    if (!canSaveSize) return
    updateAttributes?.({ ta: withPlanShares(attrs?.ta, sized.shares, sized.sizedBy) })
    setMsg({ tone: 'ok', text: `Saved ${sized.shares.toLocaleString()} shares to this chart's plan.` })
  }

  const [dirOverride, setDirOverride] = useState({})
  const [arming, setArming] = useState(null)
  const armAlert = async (drawing) => {
    const role = drawing.role || null
    const direction = roleDirection(role, plan?.side) || dirOverride[drawing.id] || 'above'
    const geom = anchorsForDrawing(drawing, { tf })
    if (!geom || !noteId || !embedId) {
      setMsg({ tone: 'err', text: 'This level cannot carry an alert yet.' })
      return
    }
    setArming(drawing.id)
    setMsg(null)
    try {
      const res = await fetch('/api/j2/chart-plan/alerts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, embedId, drawingId: boundAlertId(embedId, drawing.id), direction, ...geom }),
      })
      if (!res.ok) {
        let detail = ''
        try { detail = (await res.json())?.detail || '' } catch { /* the status speaks */ }
        setMsg({ tone: 'err', text: res.status === 404 && /not found in this note/i.test(String(detail))
          ? 'The note is still saving this chart. Try again in a moment.'
          : (typeof detail === 'string' && detail) || 'The alert could not be armed.' })
        return
      }
      setMsg({ tone: 'ok', text: `Alert armed: ${symbol} ${direction} ${fmtPrice(geom.target_price)}. It follows the line if you move it.` })
      globalMutate((k) => typeof k === 'string' && k.startsWith('/api/watchlist-alerts'))
    } catch {
      setMsg({ tone: 'err', text: 'The alert could not be armed (network).' })
    } finally {
      setArming(null)
    }
  }

  // ── "what happened next": the one replay engine (BarReplay) ─────────────────────────────
  const replayTf = NATIVE_TFS.has(tf) ? tf : 'D'
  const asOf = asOfSeconds(attrs)
  const asOfDay = noteAsOfDay(attrs)
  const daily = replayTf === 'D' || replayTf === 'W' || replayTf === 'M'
  const windowBars = useCallback(
    (all) => windowAfterNote(all, { day: asOfDay, sec: asOf, daily }),
    [asOf, asOfDay, daily],
  )
  const replayLines = useMemo(() => PRICE_ROLES
    .filter((r) => Number.isFinite(plan?.[r]))
    .map((r) => ({ price: plan[r], color: ROLE_COLOR[r], title: ROLE_LABEL[r].toLowerCase() })), [plan])
  const [replayStart, setReplayStart] = useState(null)
  const firstHit = useCallback((bars, from, test) => {
    for (let i = from; i < bars.length; i++) if (test(bars[i])) return i
    return -1
  }, [])
  const hitsFor = useCallback((bars, from) => {
    const long = plan?.side !== 'short'
    const stop = plan?.stop
    const target = plan?.target
    return {
      stopAt: Number.isFinite(stop) ? firstHit(bars, from, (b) => (long ? b.l <= stop : b.h >= stop)) : -1,
      targetAt: Number.isFinite(target) ? firstHit(bars, from, (b) => (long ? b.h >= target : b.l <= target)) : -1,
    }
  }, [plan, firstHit])
  const windowAndRemember = useCallback((all) => {
    const w = windowBars(all)
    if (!w.error) setReplayStart(w.startIdx)
    return w
  }, [windowBars])
  const markersAt = useCallback((idx, bars) => {
    if (replayStart == null || replayStart < 1) return []
    const marks = [{ time: bars[replayStart - 1].t, position: 'aboveBar', color: '#c9a84c', shape: 'arrowDown', text: 'note' }]
    const { stopAt, targetAt } = hitsFor(bars, replayStart)
    if (stopAt >= 0 && idx > stopAt) marks.push({ time: bars[stopAt].t, position: 'belowBar', color: ROLE_COLOR.stop, shape: 'circle', text: 'stop' })
    if (targetAt >= 0 && idx > targetAt) marks.push({ time: bars[targetAt].t, position: 'aboveBar', color: ROLE_COLOR.target, shape: 'circle', text: 'target' })
    return marks.sort((a, b) => barTs(a.time) - barTs(b.time))
  }, [replayStart, hitsFor])
  const statusAt = useCallback((idx, bars) => {
    if (replayStart == null) return null
    const after = Math.max(0, idx - replayStart)
    const base = bars[replayStart - 1]?.c
    const last = bars[Math.max(0, idx - 1)]?.c
    const chg = Number.isFinite(base) && Number.isFinite(last) && base ? ((last - base) / base) * 100 : null
    const { stopAt, targetAt } = hitsFor(bars, replayStart)
    const hits = []
    if (targetAt >= 0 && idx > targetAt) hits.push('target reached')
    if (stopAt >= 0 && idx > stopAt) hits.push('stop hit')
    const order = stopAt >= 0 && targetAt >= 0 && idx > Math.max(stopAt, targetAt)
      ? (stopAt <= targetAt ? ' (stop first)' : ' (target first)') : ''
    const label = after === 0
      ? 'At the note — step forward'
      : `${after} bar${after === 1 ? '' : 's'} after the note${hits.length ? ` · ${hits.join(', ')}${order}` : ''}`
    return { label, value: chg == null ? null : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`, tone: chg == null ? null : chg >= 0 ? 'pos' : 'neg' }
  }, [replayStart, hitsFor])

  const replay = replayOpen ? (
    <BarReplay
      symbol={symbol}
      tf={replayTf}
      title={`What happened next · ${symbol}`}
      tfNote={replayTf === 'D' ? 'daily bars' : replayTf === 'W' ? 'weekly bars' : replayTf === 'M' ? 'monthly bars' : `${replayTf}-minute bars`}
      windowBars={windowAndRemember}
      priceLines={replayLines}
      markersAt={markersAt}
      statusAt={statusAt}
      autoplay={false}
      onClose={() => onCloseReplay?.()}
    />
  ) : null

  if (!open) return replay

  return (
    <>
      <section
        ref={rootRef}
        className={styles.panel}
        contentEditable={false}
        tabIndex={-1}
        aria-label={`Trade plan for ${symbol}`}
        data-chart-plan-panel=""
        data-tour="chart-plan-panel"
      >
        <h4 className={styles.head}>Trade plan</h4>
        {levels.length === 0 ? (
          <p className={styles.hint}>
            Draw a horizontal line on this chart (Draw, then the horizontal-line tool), then mark it
            Entry, Stop or Target here. Or type a price below.
          </p>
        ) : (
          <ul className={styles.levels} aria-label="Drawn levels">
            {levels.map((d) => {
              const price = drawingLevelPrice(d)
              const role = PRICE_ROLES.includes(d.role) ? d.role : ''
              const armed = embedId && armedIds.has(boundAlertId(embedId, d.id))
              const derived = roleDirection(role, plan?.side)
              // An alert follows the line's own geometry, so a level with no anchor point on
              // the chart cannot carry one. The button is offered only where it can work;
              // elsewhere the row says why, before any click (it used to refuse after one).
              const canArm = anchorsForDrawing(d, { tf }) != null
              return (
                <li key={d.id} className={styles.level} data-level-id={d.id} data-level-role={role}>
                  <LevelPriceField
                    price={price}
                    label={role ? `Price of the ${ROLE_LABEL[role]} line, ${fmtPrice(price)}` : `Price of the line at ${fmtPrice(price)}`}
                    onCommit={(next, viaStep) => moveLevelTo(d.id, next, viaStep)}
                    onInvalid={badPrice}
                  />
                  <RoleRadios
                    role={role}
                    label={`Role of the line at ${fmtPrice(price)}`}
                    onChange={(r) => setRole(d.id, r)}
                  />
                  <div className={styles.alertCell}>
                    {!derived && !armed && canArm && (
                      <select
                        className={styles.dirSelect}
                        aria-label={`Alert direction at ${fmtPrice(price)}`}
                        value={dirOverride[d.id] || 'above'}
                        onChange={(e) => setDirOverride((o) => ({ ...o, [d.id]: e.target.value }))}
                      >
                        <option value="above">Crosses above</option>
                        <option value="below">Crosses below</option>
                      </select>
                    )}
                    {armed ? (
                      <span className={styles.armed}>Alert armed</span>
                    ) : !canArm ? (
                      <span className={styles.hint}>Draw this level on the chart to set an alert.</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.armBtn}
                        data-tour="chart-plan-alert"
                        data-plan-arm=""
                        disabled={arming === d.id}
                        onClick={() => armAlert(d)}
                        aria-label={`Arm alert at this level, ${fmtPrice(price)}`}
                        {...(role === 'stop' ? { 'aria-keyshortcuts': PLAN_STOP_ARIA_KEYS } : {})}
                      >
                        {arming === d.id ? 'Arming…' : 'Arm alert at this level'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {levels.some((d) => d.role === 'stop') && (
          <p className={styles.hint} data-plan-keys="">{planStopChordLabel()} goes to the stop's alert.</p>
        )}
        <AddLevelForm onAdd={addLevelAt} onInvalid={badPrice} />

        <div className={styles.numbers} aria-live="polite" data-tour="chart-plan-numbers">
          {reading.status === 'error' && <p className={styles.err} role="alert">{reading.error}</p>}
          {reading.status === 'loading' && !reading.data && <p className={styles.hint}>Reading the plan…</p>}
          {sized && (
            <>
              <dl className={styles.grid}>
                <div><dt>R:R</dt><dd data-plan-value="rr">{sized.rewardToRisk == null ? '—' : `${sized.rewardToRisk.toFixed(2)}R`}</dd></div>
                <div><dt>Risk / share</dt><dd data-plan-value="rps">{sized.riskPerShare == null ? '—' : money(sized.riskPerShare)}</dd></div>
                <div><dt>Account risk</dt><dd data-plan-value="acct">{sized.accountRisk == null ? '—' : money(sized.accountRisk)}</dd></div>
                <div><dt>Position size</dt><dd data-plan-value="shares">{sized.shares == null ? '—' : `${sized.shares.toLocaleString()} sh`}</dd></div>
              </dl>
              {sized.label && <p className={styles.engine} data-sized-by={sized.sizedBy}>{sized.label}</p>}
              {sized.reason && <p className={styles.hint}>{sized.reason}{/account size|max risk/i.test(sized.reason) ? ' — set it in Journal Settings, Accounts.' : ''}</p>}
              {sized.rewardToRiskReason && sized.rewardToRisk == null && sized.side && (
                <p className={styles.hint}>{sized.rewardToRiskReason}</p>
              )}
              {sized.shares != null && (
                <button type="button" className={styles.saveBtn} disabled={!canSaveSize} onClick={saveSize}>
                  {canSaveSize ? 'Use this size in the plan' : 'Size saved in the plan'}
                </button>
              )}
            </>
          )}
          {msg && <p className={msg.tone === 'err' ? styles.err : styles.ok} role={msg.tone === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
        </div>
      </section>
      {replay}
    </>
  )
}
