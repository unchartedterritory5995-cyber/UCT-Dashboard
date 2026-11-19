// app/src/components/chart/builder/inspect/InspectBar.jsx
//
// INSPECT A BAR, THE PANEL (Studio lane R5; `barInspection.js` holds the method).
//
// Closed until the member opens it: nothing is derived or computed before that. Opening it reads
// the script once (the probe copies, through the engine's own doors, handed in as props); moving
// to another bar only re-reads the columns already computed. A changed script is read again.
//
// One row per named top-level variable: its name, the line it is written on, and its value on the
// pinned bar. An empty one says why, and offers the line. The limits are printed, not hidden.
import { useEffect, useMemo, useRef, useState } from 'react'
import { inspectScript, readBar, emptyWords, valueText } from './barInspection'
import styles from './InspectBar.module.css'

/** A bar's time as a member reads it: a date, and the clock time when the bars are intraday. */
export function barWhen(bar, intraday = false) {
  // the chart's bars carry `t`: a session date ("2026-11-17") on daily bars and above, a clock
  // time (seconds or milliseconds, or an ISO string) on intraday ones; `time` is the series' own
  // spelling of the same thing
  const raw = bar ? (bar.t !== undefined && bar.t !== null ? bar.t : bar.time) : null
  if (raw === null || raw === undefined || raw === '') return ''
  let d
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) d = new Date(`${raw}T00:00:00Z`)
  else if (typeof raw === 'string' && Number.isNaN(Number(raw))) d = new Date(raw)
  else {
    const n = Number(raw)
    if (!Number.isFinite(n)) return ''
    d = new Date(n < 1e11 ? n * 1000 : n)
  }
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (!intraday) return date
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`
}

const INTRADAY = new Set(['1', '5', '15', '30', '60'])

export default function InspectBar({
  source, bars, tf = 'D', names, build, compute, onGoToLine = null, defaultOpen = false,
}) {
  const list = Array.isArray(bars) ? bars : []
  const [open, setOpen] = useState(defaultOpen)
  const [index, setIndex] = useState(null)             // null: the latest bar
  const [state, setState] = useState({ status: 'idle', result: null })
  const [why, setWhy] = useState(null)                 // the variable whose reason is shown
  const ready = typeof names === 'function' && typeof build === 'function' && typeof compute === 'function'
  const at = index === null ? list.length - 1 : Math.max(0, Math.min(list.length - 1, index))

  // read the script when the panel is open, and again when the script or the bars change
  const runId = useRef(0)
  useEffect(() => {
    if (!open || !ready || !list.length) return undefined
    const id = runId.current + 1
    runId.current = id
    setState((s) => ({ status: 'reading', result: s.result }))
    let live = true
    Promise.resolve()
      .then(() => inspectScript({ source, bars: list, names, build, compute }))
      .then((result) => { if (live && runId.current === id) setState({ status: 'done', result }) })
      .catch((e) => {
        if (live && runId.current === id) setState({ status: 'done', result: { ok: false, reason: String((e && e.message) || e), probes: [], columns: {}, skipped: [], failed: [], truncated: 0, laneDiffers: false } })
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `list` is `bars` made safe; the three doors are the caller's stable functions
  }, [open, ready, source, bars])

  const result = state.result
  const rows = useMemo(
    () => (result && result.ok ? readBar({ columns: result.columns }, result.probes, at) : []),
    [result, at],
  )
  const intraday = INTRADAY.has(String(tf))
  const dateOf = (i) => barWhen(list[i], intraday)

  if (!ready) return null
  return (
    <section className={styles.inspect} data-testid="inspect-bar">
      <button type="button" className={styles.head} aria-expanded={open} data-testid="inspect-bar-toggle"
        onClick={() => setOpen((v) => !v)}>
        <span>Inspect a bar</span>
        <span className={styles.headHint}>{open ? 'Hide' : 'See each variable’s value on one bar'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {!list.length ? (
            <p className={styles.note} data-testid="inspect-bar-nobars">There are no bars loaded to read.</p>
          ) : (
            <>
              <div className={styles.picker}>
                <button type="button" className={styles.step} aria-label="Earlier bar" disabled={at <= 0}
                  data-testid="inspect-bar-prev" onClick={() => { setWhy(null); setIndex(at - 1) }}>◀</button>
                <input type="range" className={styles.range} min={0} max={list.length - 1} value={at}
                  aria-label="Which bar" data-testid="inspect-bar-range"
                  onChange={(e) => { setWhy(null); setIndex(Number(e.target.value)) }} />
                <button type="button" className={styles.step} aria-label="Later bar" disabled={at >= list.length - 1}
                  data-testid="inspect-bar-next" onClick={() => { setWhy(null); setIndex(at + 1) }}>▶</button>
                <span className={styles.when} data-testid="inspect-bar-when">
                  {dateOf(at)}{at === list.length - 1 ? ' (latest)' : ''}
                </span>
              </div>

              {state.status === 'reading' && !result ? (
                <p className={styles.note} role="status" data-testid="inspect-bar-reading">Reading the script…</p>
              ) : null}

              {result && !result.ok ? (
                <p className={styles.note} role="alert" data-testid="inspect-bar-refused">{result.reason}</p>
              ) : null}

              {result && result.ok ? (
                <>
                  {rows.length === 0 && result.failed.length === 0 ? (
                    <p className={styles.note} data-testid="inspect-bar-none">
                      This script names no variable at its top level, so there is nothing to list.
                    </p>
                  ) : (
                    <ul className={styles.rows} data-testid="inspect-bar-rows">
                      {rows.map((r) => (
                        <li key={r.name} className={styles.row} data-testid="inspect-bar-row" data-name={r.name}
                          data-empty={r.empty ? r.empty.code : undefined}>
                          <span className={styles.name}>{r.name}</span>
                          {Number.isInteger(r.line) ? (
                            typeof onGoToLine === 'function' ? (
                              <button type="button" className={styles.line} data-testid="inspect-bar-line"
                                onClick={() => onGoToLine(r.line)}>line {r.line}</button>
                            ) : <span className={styles.lineText}>line {r.line}</span>
                          ) : null}
                          {r.empty ? (
                            <button type="button" className={styles.empty} aria-expanded={why === r.name}
                              data-testid="inspect-bar-why" onClick={() => setWhy(why === r.name ? null : r.name)}>
                              empty: why?
                            </button>
                          ) : <span className={styles.value} data-testid="inspect-bar-value">{valueText(r.value)}</span>}
                          {r.empty && why === r.name ? (
                            <span className={styles.reason} role="note" data-testid="inspect-bar-reason">
                              {emptyWords(r.empty, { dateOf, index: at })}
                            </span>
                          ) : null}
                        </li>
                      ))}
                      {result.failed.map((f) => (
                        <li key={`f-${f.name}`} className={styles.row} data-testid="inspect-bar-row" data-name={f.name} data-empty="not-run">
                          <span className={styles.name}>{f.name}</span>
                          {Number.isInteger(f.line) ? <span className={styles.lineText}>line {f.line}</span> : null}
                          <span className={styles.reason} role="note">
                            It is not a number on each bar (text, a colour or a drawing), so it cannot be read here.
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {result.laneDiffers ? (
                    <p className={styles.note} role="note" data-testid="inspect-bar-lane">
                      The copy used to read these values ran differently from the script itself, so a value here may
                      differ from the chart’s.
                    </p>
                  ) : null}
                  <p className={styles.limits} data-testid="inspect-bar-limits">
                    Variables inside an <code>if</code>, a loop or a function are not listed. A yes/no value reads 1 for yes and 0 for no.
                    {result.skipped.length ? ` Not read: ${result.skipped.map((s) => s.name).join(', ')} (${result.skipped.length === 1 ? 'a function' : 'functions'}).` : ''}
                    {result.truncated ? ` ${result.truncated} more ${result.truncated === 1 ? 'name is' : 'names are'} not shown.` : ''}
                  </p>
                </>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  )
}
