// app/src/components/screener/RunNowButton.jsx
//
// ─── RUN A SAVED SCAN NOW, ON A LIST THE MEMBER NAMES (spec §5.5, W4a) ──────
//
// ⛔ THIS FILE RENDERS NO RESULT. It POSTs `/api/scans/run`, WATCHES the job it
// gets back, and hands the answer UP through `onResult(payload, run)`;
// `ScreensManager` feeds that payload to the ONE `ScanResults` mount it already
// renders. Importing `ScanResults` or `CoverageLine` here would give the
// four-outcome receipt a second door — `reachable.test.js`'s planted-cut control
// asserts exactly that chain — and would put two mounts on screen for one answer.
//
// ─── 🔴 IT IS A JOB, NOT AN ANSWER, AND THAT SHAPES THIS WHOLE FILE ─────────
//
// `POST /api/scans/run` replies **202 with a job envelope**, never with hits.
// W4a.1/.2 put the evaluator behind a single-worker pool because a 500-symbol
// run is 0.7–5.7 s of GIL-bound compute on this pod's one event loop (the
// 2026-07-01 outage class), and `tests/test_scan_evaluator_off_request_path.py`
// is now a standing rail that no route handler can reach the sweep at all. So
// the hits arrive on `GET /api/scans/run/{job}` and this component polls for
// them. ⚠️ The W4a.4 brief described a synchronous answer; it was written before
// that ruling and a client built to it would have rendered `undefined` hits.
//
// ⛔ THE POLL IS A GATED READ, so it carries `credentials: 'include'` exactly
// like the submit. `require_paid` sits on BOTH routes on purpose: an open read
// beside a gated write would hand every hit list on this pod to whoever guessed
// a job id.
//
// ⛔ `position` EXISTS ONLY WHILE THE JOB IS `queued` (`scan_run._public`). A
// surface that read it unconditionally would print "#undefined ahead" for the
// entire time a run is actually running.
//
// ⛔ AND A GATE THE SWEEP RAISED ARRIVES ON THE JOB, NOT AS A STATUS. The
// refusal a member is most likely to meet — `snapshot-stale`, the store has not
// rolled — happens after the submit already answered 202, so it lands on the
// job as `state: 'refused'` with its gate word intact. A client that only
// checked `r.ok` would render that run as an empty screen, which is the "quiet
// market" lie the four-outcome receipt exists to make impossible.
//
// ⭐ THE LISTS ARE THE SCREENER'S OWN. `useScreenerMeta().meta.filters[key='list']`
// carries server-minted selectors (`wl:<id>`, `flagged`, `tag:<colour>`) from
// `list_universe.available` — the same control the filter rail renders. Reading
// `/api/watchlists` instead would make this file spell the `wl:` prefix, a
// second authority over the selector grammar. ⚠️ `unflagged` is offered by that
// meta and REFUSED by the run route (a complement is not a bounded universe);
// the refusal is the server's own named sentence and is shown as such, because
// hiding the option here would mean this file deciding which selectors are
// runnable — the same second authority by another route.
//
// ⛔ THE CAP IS PINNED, NOT TRUSTED. `RUN_SYMBOL_CAP` below is READ out of this
// file by `tests/test_scan_run.py` and asserted equal to
// `scan_run.MAX_RUN_SYMBOLS`. The client refuses a 501st symbol with the count
// so a member is not sent to the server to learn it; the server refuses
// regardless, and at the same boundary (`>`, not `>=`).
//
// ⛔ THE SERVER'S REFUSAL IS SHOWN VERBATIM. `detail` leads with `[gate:…]` and
// names the counts; a paraphrase here would be a second vocabulary for one
// decision (the `useUserDefinitions` rule).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../ui/UIcon'
import useScreenerMeta from '../../pages/screener/hooks/useScreenerMeta'
import styles from './RunNowButton.module.css'

/** The submit. The poll hangs off it, so the path is spelled once. */
export const RUN_ENDPOINT = '/api/scans/run'

/** One job's read-back. ⛔ ENCODED — a job id is opaque and a surface that
 *  concatenates raw is one id-format change away from a broken read. */
export function jobUrl(job) {
  return `${RUN_ENDPOINT}/${encodeURIComponent(job)}`
}

/** ⛔ THE ONE NUMBER, and it is `scan_run.MAX_RUN_SYMBOLS`. Kept as a bare
 *  integer literal on its own line because a backend test READS THIS LINE and
 *  asserts the equality — that pin is the only thing standing between here and
 *  two authorities over one bound. */
export const RUN_SYMBOL_CAP = 500

/** The three codes the contract fixes (`tf?: 'D'|'W'|'M'`), with the words a
 *  member reads. The CODES are `scan_store._TF_CODES` members and the backend
 *  pin checks that; the labels are this surface's. */
export const RUN_TFS = [['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']]

/** `scan_run._TERMINAL` — the two states a job never leaves. Pinned to the
 *  server's tuple by the same backend test, because a client that stopped
 *  watching on a state the server does not consider final would drop an answer
 *  on the floor, and one that kept watching past a final state would poll for
 *  the full TTL. */
export const RUN_TERMINAL_STATES = ['done', 'refused']

/** How long between reads of a job that has not finished. ⭐ Sized against the
 *  measured run, not a round number: 0.7–5.7 s of compute means a member sees
 *  the answer within one interval of it existing, and the poll is deliberately
 *  outside the per-member rate window (`api/routers/scan_run.py` charges the
 *  SUBMIT only) so watching one run costs nothing. */
export const POLL_MS = 600

/** Uppercased, de-duplicated, order-stable — ⛔ AND THE DE-DUPE IS THE POINT.
 *  The server caps the DE-DUPED universe (`MAX_RUN_SYMBOLS` sits below the
 *  de-dupe, `HARD_SYMBOL_BOUND` above it) because a member who pasted a
 *  spreadsheet column of 600 rows carrying 50 tickers was once refused
 *  `gate:universe` for a run of fifty. Counting the same way here is what makes
 *  the number on screen the number the server will judge. */
export function parseSymbols(text) {
  const seen = new Set()
  const out = []
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const s = raw.trim().toUpperCase()
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

/** The finished job in the shape `ScanResults` renders — `tickers` DERIVED from
 *  `hits`, the receipt forwarded WHOLE, the tier carried.
 *
 *  ⛔ `truncated` IS READ OFF THE RECEIPT, never typed. It is one of
 *  `scan_run._COVERAGE_KEYS`, so the server always answers it; spelling `false`
 *  here would be a second authority over a fact the run already reported. */
export function toScanResultsPayload(run) {
  const coverage = run && run.coverage ? run.coverage : null
  return {
    def_hash: run.def_hash,
    tf: run.tf,
    as_of: run.as_of,
    status: 'evaluated',
    coverage,
    tickers: (Array.isArray(run.hits) ? run.hits : []).map((h) => h.symbol),
    truncated: Boolean(coverage && coverage.truncated),
    tier: run.tier,
  }
}

/** What the member is told when the server refused without a sentence of its
 *  own. ⛔ ONLY THEN — `detail` is preferred whenever there is one. */
function refusalText(body, status) {
  const detail = body && typeof body.detail === 'string' ? body.detail.trim() : ''
  return detail || `The server refused this run (${status}).`
}

async function readJson(response) {
  try { return await response.json() } catch { return null }
}

export default function RunNowButton({ defId, name, session, onResult }) {
  const { meta } = useScreenerMeta()
  const lists = useMemo(() => {
    const entry = (meta && Array.isArray(meta.filters) ? meta.filters : []).find((f) => f.key === 'list')
    // ⛔ A PRESET WITHOUT A `value` IS NOT A LIST. `filters._my_lists_entry`
    // leads with `{label: 'Any'}` — the filter rail's "no restriction" row —
    // and offering it here would POST an empty selector.
    return (entry && Array.isArray(entry.presets) ? entry.presets : [])
      .filter((p) => p && typeof p.value === 'string' && p.value)
  }, [meta])

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('paste')
  const [text, setText] = useState('')
  const [listId, setListId] = useState('')
  const [tf, setTf] = useState('D')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  // ⭐ WHAT IS ON SCREEN BELOW. The four-outcome receipt says how many were
  // evaluated; nothing in it says the universe was one the MEMBER named rather
  // than the nightly sweep's 3,742. Without this line the on-demand answer and
  // the nightly one are indistinguishable at a glance — and they mean different
  // things. Cleared the moment another run starts, so it can never caption a set
  // that is no longer showing.
  const [done, setDone] = useState(null)

  // ⛔ ONE RUN AT A TIME, AND THE OLD ONE'S POLL IS ABANDONED. Every async step
  // re-reads this ticket; a second click, or an unmount, bumps it and the loop
  // in flight returns without touching state. Without it a poll outliving its
  // panel writes into an unmounted tree, and — worse — a slow first run could
  // hand back its answer AFTER a second run's.
  const ticket = useRef(0)
  useEffect(() => () => { ticket.current += 1 }, [])

  const symbols = useMemo(() => parseSymbols(text), [text])
  const overCap = symbols.length > RUN_SYMBOL_CAP
  const useList = mode === 'list' && lists.length > 0
  const canRun = !busy && (useList ? listId !== '' : (symbols.length > 0 && !overCap))

  const start = useCallback(async () => {
    const mine = ticket.current + 1
    ticket.current = mine
    const stale = () => ticket.current !== mine
    const fail = (message) => {
      if (stale()) return
      setBusy(false)
      setProgress(null)
      // ⛔ AND THE PREVIOUS RUN'S CAPTION GOES WITH IT. "on-demand · 3 symbols"
      // left standing beside a refusal tells a member their list is on screen
      // when the set below is the nightly one.
      setDone(null)
      setError(message)
    }

    setError(null)
    setProgress(null)
    setDone(null)
    setBusy(true)

    const body = { def_id: defId, tf, as_of: session }
    if (useList) body.list_id = listId
    else body.symbols = symbols

    try {
      let response = await fetch(RUN_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      let job = await readJson(response)
      if (!response.ok) { fail(refusalText(job, response.status)); return }

      // ⭐ THE 202's BODY IS THE FIRST READ, NOT A RECEIPT TO THROW AWAY. The
      // pool is a real thread and can finish before the submit serialises its
      // answer, so a client that always polled once would burn a request per run
      // and show a "queued" flash for a job that was already done.
      while (!stale()) {
        if (!job || typeof job.job !== 'string') {
          fail('The server did not hand back a job to watch.')
          return
        }
        if (RUN_TERMINAL_STATES.includes(job.state)) break
        setProgress({
          state: job.state,
          // ⛔ ONLY WHILE QUEUED. `_public` omits the key entirely otherwise.
          position: typeof job.position === 'number' ? job.position : null,
        })
        await new Promise((resolve) => { setTimeout(resolve, POLL_MS) })
        if (stale()) return
        response = await fetch(jobUrl(job.job), { credentials: 'include' })
        job = await readJson(response)
        // ⛔ A POLL THAT FAILS STOPS THE LOOP. An expired or evicted job answers
        // 404 forever; polling it forever is a request every 600 ms for as long
        // as the tab is open.
        if (!response.ok) { fail(refusalText(job, response.status)); return }
      }
      if (stale()) return

      if (job.state === 'refused') {
        // Verbatim, gate token and all — including the crash shape
        // (`gate: null, error: true`), which is this pod failing the member and
        // says so in its own words.
        fail(refusalText(job, 0))
        return
      }
      setBusy(false)
      setProgress(null)
      // ⛔ THE LABEL IS THE SERVER'S, NOT THE SELECTOR WE SENT. `universe.label`
      // is what `list_universe.resolve` called the list; rendering `wl:4b9b…`
      // would show a member an id they never chose a name for.
      setDone({
        tier: job.tier,
        resolved: job.universe && job.universe.resolved,
        label: (job.universe && job.universe.label) || null,
      })
      onResult(toScanResultsPayload(job), job)
    } catch {
      fail('Could not reach the server — check your connection and try again.')
    }
  }, [defId, tf, session, useList, listId, symbols, onResult])

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Run ${name} now`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <UIcon name="bolt" size={12} /> Run now
      </button>

      {open && (
        <div className={styles.panel} role="group" aria-label={`Run ${name} on`}>
          {lists.length > 0 && (
            <div className={styles.modes} role="radiogroup" aria-label="Universe">
              <label className={styles.mode}>
                <input
                  type="radio" name={`run-mode-${defId}`} checked={mode === 'paste'}
                  onChange={() => setMode('paste')} aria-label="Paste symbols"
                />
                Paste symbols
              </label>
              <label className={styles.mode}>
                <input
                  type="radio" name={`run-mode-${defId}`} checked={mode === 'list'}
                  onChange={() => setMode('list')} aria-label="From a list"
                />
                From a list
              </label>
            </div>
          )}

          {useList ? (
            <select
              className={styles.select} aria-label="List to run"
              value={listId} onChange={(e) => setListId(e.target.value)}
            >
              <option value="">Choose a list…</option>
              {lists.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          ) : (
            <textarea
              className={styles.textarea} aria-label="Symbols to run"
              placeholder="NVDA, AMD, INTC…"
              value={text} onChange={(e) => setText(e.target.value)}
            />
          )}

          <div className={styles.row}>
            {!useList && (
              <span className={styles.count} data-testid="run-now-count">
                {symbols.length} {symbols.length === 1 ? 'symbol' : 'symbols'}
              </span>
            )}
            {!useList && overCap && (
              <span className={styles.over} data-testid="run-now-over-cap">
                over the cap of {RUN_SYMBOL_CAP} — shorten the list
              </span>
            )}
            <label className={styles.field}>
              Timeframe
              <select
                className={styles.select} aria-label="Timeframe"
                value={tf} onChange={(e) => setTf(e.target.value)}
              >
                {RUN_TFS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            <button type="button" className={styles.go} disabled={!canRun} onClick={start}>
              {busy ? 'Running…' : 'Run'}
            </button>
          </div>

          {progress && (
            <p className={styles.state} role="status" data-testid="run-now-state">
              <UIcon name="clock" size={12} />
              {progress.state === 'queued'
                ? (progress.position ? `Queued — ${progress.position} ahead of you`
                  : 'Queued — next up')
                : 'Running on this pod’s one worker…'}
            </p>
          )}

          {done && (
            <p className={styles.done} role="status" data-testid="run-now-done">
              <UIcon name="check" size={12} />
              Showing {done.tier} results over{' '}
              {done.resolved} {done.resolved === 1 ? 'symbol' : 'symbols'}
              {done.label ? ` from ${done.label}` : ''}.
            </p>
          )}

          {error && (
            <p className={styles.error} role="alert" data-testid="run-now-error">
              <UIcon name="warning" size={12} /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
