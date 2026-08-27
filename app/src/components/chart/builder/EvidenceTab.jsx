// app/src/components/chart/builder/EvidenceTab.jsx
//
// ─── EVIDENCE: the retro study beside the forward record (spec §5.9, A8) ────
//
// ⭐ ONE COMPONENT, TWO DOORS. `BuilderSheet` mounts it for a SAVED definition
// (edit mode) and `ScanResults` mounts it behind an "Evidence" button; both hand
// it the same `{defId, defHash, tf}`.
//
// ⛔ NEVER A NAKED HIT RATE (spec §4). The only layout this file knows renders
// the screen's number and the baseline's number in ONE cell, joined by "vs"; a
// horizon that arrives without `baseline` is refused by name and its screen
// numbers are not rendered. `EvidenceTab.rails.test.js` pins the words: every
// string here that says "win rate" says "vs" in the same string.
//
// ⭐ AND THE SAME RULE ON THE OTHER ARM. `claim.hit_rate` is an OCCURRENCE rate
// (`bars_true / bars_evaluated`), not a rate of winning, and the record route
// ships `hit_rate_means` at the TOP LEVEL of every response — beside `claim`,
// never inside it — precisely so that sentence cannot be separated from the
// number. Its own docstring says why: this tab renders the number "within inches
// of the backtest's strategy/baseline pair", where an unlabelled percentage
// reads as performance. So the two travel TOGETHER here: the number renders only
// when the sentence came with it, and a number that arrives without one is
// WITHHELD by name rather than shown bare.
//
// ⛔ THE RECEIPT IS RENDERED, NOT RE-DERIVED. `method.fill`, the survivorship
// caveat, the refusal sentence, the coverage counts, `hit_rate_means` and the
// forward record's refusal are the server's own words, reproduced verbatim. The
// one arithmetic here is the closure check on bar coverage (the `CoverageLine`
// idiom, one grain down) — a receipt whose parts do not sum to its total is not
// shown.
//
// ⛔ THE RECEIPT MUST BE THE DEFINITION'S. The route echoes `def_hash` (the hash
// of the tree it RAN); a receipt carrying any other hash is refused rather than
// shown under this definition's name.
//
// ⭐ EVERY STATE HAS A SENTENCE WITH A NAME, AND EVERY SENTENCE IS TRUE OF THE
// STATE THAT PRODUCED IT. A correct guard whose branch renders the wrong words
// is invisible to a rail that only asserts the guard, so the words are asserted
// too (`EvidenceTab.test.jsx` for what a member sees, the `SPEAKING_STATES` block
// of `EvidenceTab.rails.test.js` for "this branch renders prose at all"). The
// two in-flight states are SEPARATE elements rather than one ternary for that
// reason: "Replaying…" is a false claim while the request that starts the replay
// is still on the wire.
//
// ⚠️ POLLING IS A NUMERIC `refreshInterval` FLIPPED FROM STATE (the
// `useEarningsBrief` idiom). SWR's function-form interval is read once in its
// mount effect, when a cold key has no data, so a poll that has to START from a
// settled payload never starts. `dedupingInterval` sits UNDER the poll interval
// or SWR dedupes the poll away.
//
// ⚠️ `SCREEN_BACKTEST_ENABLED` GATES THE MOUNT of `/api/screener/backtest*`
// (`api/main.py`: the router is included only when the flag is `"1"`, and it is
// off on this branch). With the flag off the POST hits the SPA catch-all and
// answers 405 — that is rendered as a refusal NAMING THE STATUS, never as "no
// evidence". A `.catch(() => null)` here would render "the feature is switched
// off" as "this definition has no history", which is a different fact and a lie.
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../ui/UIcon'
import CoverageLine from '../../screener/CoverageLine'
import styles from './EvidenceTab.module.css'

export const BACKTEST_ENDPOINT = '/api/screener/backtest'
export const RECORD_ENDPOINT = '/api/scans/definition-record'
/** The horizons the study is asked for (spec A8: 1/5/10/20). This is only the
 *  REQUEST: what gets rendered is `data.horizons`, the per-horizon RESULTS the
 *  engine computed. (`method.horizons` is echoed on the receipt too and this
 *  file never reads it — an earlier comment here said it was the thing being
 *  rendered, which was a claim about a mechanism nobody ran.) */
export const EVIDENCE_HORIZONS = [1, 5, 10, 20]
export const EVIDENCE_POLL_MS = 2000

/** ⛔ THE SERVER'S OWN SENTENCE SURVIVES THE THROW. A bare status is plumbing:
 *  `402` tells a member nothing, while `definition_record.require_paid`'s
 *  "A definition's forward record requires a paid plan" tells them what to do.
 *  Both travel — the status because it is what actually happened, the detail
 *  because it is the only part written for a person. */
async function okJson(r) {
  if (!r.ok) {
    let detail = ''
    try { detail = (await r.json())?.detail || '' } catch { /* HTML from the SPA catch-all */ }
    const e = new Error(detail ? `${r.status}: ${detail}` : String(r.status))
    e.status = r.status
    e.detail = detail
    throw e
  }
  return r.json()
}
const fetcher = (url) => fetch(url, { credentials: 'include' }).then(okJson)

/** ⛔ AN EXPLICIT LOCALE, for `CoverageLine`'s reason: `toLocaleString()` with no
 *  argument reads `3.742` for some members, and that reads as a decimal. */
const n = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v).toLocaleString('en-US') : '—')
const pct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—')
const rate = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')

/** The receipt's symbol coverage in `CoverageLine`'s four words. The identity
 *  `tested + missing + no_window + no_answer == requested` is the engine's own
 *  (`_assert_closes("universe")`), so the line's closure check holds. */
export function symbolCoverage(c) {
  // ⛔ ABSENT IS NOT BROKEN. A refusal that fires before a single bar is read
  // carries `coverage: {}` (`backtest.refuse`'s `coverage or {}`), and handing
  // that to `CoverageLine` would trip its closure alarm and tell the member this
  // study's counts do not add up — when the truth is there are none.
  if (!c || !Number.isFinite(Number(c.symbols_requested))) return null
  return {
    evaluated: c.symbols_requested,
    answered: c.symbols_tested,
    dropped: c.symbols_missing_bars,
    not_computable: (Number(c.symbols_no_bars_in_window) || 0)
      + (Number(c.symbols_no_answer_in_window) || 0),
  }
}

export default function EvidenceTab({ defId, defHash, tf = 'D', pollMs = EVIDENCE_POLL_MS }) {
  const [job, setJob] = useState(null)
  const [requestError, setRequestError] = useState(null)

  useEffect(() => {
    if (!defId || !defHash) return undefined
    let alive = true
    setJob(null); setRequestError(null)
    fetch(`${BACKTEST_ENDPOINT}?background=1`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ def_id: defId, tf, horizons: EVIDENCE_HORIZONS }),
    })
      .then(async (r) => {
        if (!r.ok) {
          let detail = ''
          try { detail = (await r.json())?.detail || '' } catch { /* a 405 from the SPA catch-all is HTML */ }
          throw Object.assign(new Error(detail || String(r.status)), { status: r.status })
        }
        return r.json()
      })
      .then((body) => { if (alive) setJob(body && body.job ? String(body.job) : null) })
      .catch((err) => { if (alive) setRequestError({ status: err.status || null, detail: err.message }) })
    return () => { alive = false }
  }, [defId, defHash, tf])

  const [polling, setPolling] = useState(false)
  const { data, error } = useSWR(
    job ? `${BACKTEST_ENDPOINT}/${encodeURIComponent(job)}` : null,
    fetcher,
    {
      refreshInterval: polling ? pollMs : 0,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      dedupingInterval: Math.min(250, Math.floor(pollMs / 2)),
    },
  )
  const running = !!data && data.status === 'running'
  useEffect(() => { setPolling(running) }, [running])

  const record = useSWR(
    defId ? `${RECORD_ENDPOINT}?def_id=${encodeURIComponent(defId)}&tf=${encodeURIComponent(tf)}` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  // ⛔ NOTHING WAS ASKED FOR, SO NOTHING IS "IN PROGRESS". Both arms key on
  // `def_id` — the POST replays a SAVED definition by id, and the record is filed
  // under one — so with no id there is no request on the wire and never will be.
  // Falling through to the in-flight branches below would print "Replaying this
  // definition over the current universe…" beside "Reading the record…" forever,
  // two sentences that are flatly false, each behind a perfectly correct guard.
  if (!defId) {
    return (
      <section className={styles.wrap} data-testid="evidence-tab" data-definition={defHash || ''} aria-label="Evidence">
        <p className={styles.refusal} role="alert" data-testid="evidence-not-saved">
          <UIcon name="warning" size={14} />
          <span>
            This definition has not been saved yet, so there is nothing to ask about: the study
            replays a saved definition by its id, and the forward record is filed under one.
            Save it and both halves of the evidence have something to answer.
          </span>
        </p>
      </section>
    )
  }

  return (
    <section className={styles.wrap} data-testid="evidence-tab" data-definition={defHash || ''} aria-label="Evidence">
      <h4 className={styles.head}>Retro study</h4>
      <RetroStudy defHash={defHash} job={job} requestError={requestError} data={data} error={error} />
      <ForwardRecord data={record.data} error={record.error} />
    </section>
  )
}

function Refusal({ testid, children }) {
  return (
    <p className={styles.refusal} role="alert" data-testid={testid}>
      <UIcon name="warning" size={14} />
      <span>{children}</span>
    </p>
  )
}

function RetroStudy({ defHash, job, requestError, data, error }) {
  if (!defHash) {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-no-hash">
        <UIcon name="warning" size={14} />
        <span>
          This definition&apos;s hash is not known to this surface, so no receipt could be checked
          against it — reopen the definition.
        </span>
      </p>
    )
  }
  // ⛔⛔ "NOT SWITCHED ON" AND "IT FAILED" ARE DIFFERENT FACTS, AND THIS IS THE
  // STATE EVERY MEMBER IS IN. `api/main.py:6140` mounts
  // `/api/screener/backtest*` only when `SCREEN_BACKTEST_ENABLED == "1"`, and it
  // is unset. With the router absent nothing serves POST on that path, so the
  // request falls to the SPA catch-all — declared `@app.get(...)`, GET ONLY —
  // and FastAPI answers 405 `{"detail": "Method Not Allowed"}`.
  //
  // A 405 on THIS path therefore means exactly one thing: the study service is
  // not running here. Rendering it as "Evidence could not be requested (405):
  // Method Not Allowed" hands a member an HTTP status where a sentence belongs,
  // in the single most-read string this component has. Every OTHER status is a
  // real answer from a mounted route and keeps the generic refusal below.
  if (requestError && requestError.status === 405) {
    return (
      <p className={styles.note} role="status" data-testid="evidence-not-enabled">
        <UIcon name="clock" size={14} />
        <span>
          Backtested evidence is not switched on for this site yet, so no study could be run.
          Nothing about this definition failed and nothing was measured — the service that
          replays a screen over past sessions is simply not available here.
        </span>
      </p>
    )
  }
  if (requestError) {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-request-refused">
        <UIcon name="warning" size={14} />
        <span>
          Evidence could not be requested
          {requestError.status ? ` (${requestError.status})` : ''}
          {requestError.detail && requestError.detail !== String(requestError.status)
            ? `: ${requestError.detail}` : ''}
          . That is what the server answered — it is not a statement about this
          definition&apos;s history.
        </span>
      </p>
    )
  }
  if (error) {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-poll-refused">
        <UIcon name="warning" size={14} />
        <span>
          The study&apos;s receipt could not be read ({error.status || String(error.message || error)}).
          {error.detail ? ` ${error.detail}` : ''}
        </span>
      </p>
    )
  }
  // ⭐ TWO IN-FLIGHT STATES, TWO SENTENCES. "Replaying…" is not true while the
  // request that starts the replay is still on the wire, and a member watching a
  // spinner deserves the one that is.
  if (!job) {
    return (
      <p className={styles.note} role="status" data-testid="evidence-running">
        <UIcon name="clock" size={14} />
        <span>Asking the server to replay this definition…</span>
      </p>
    )
  }
  if (!data || data.status === 'running') {
    return (
      <p className={styles.note} role="status" data-testid="evidence-running">
        <UIcon name="clock" size={14} />
        <span>Replaying this definition over the current universe…</span>
      </p>
    )
  }
  if (data.status === 'error') {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-job-error">
        <UIcon name="warning" size={14} />
        <span>The study failed while it ran: {data.detail}</span>
      </p>
    )
  }
  if (data.status === 'unknown') {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-job-unknown">
        <UIcon name="warning" size={14} />
        <span>
          The server no longer knows this study — its receipt expired or the server restarted.
          Reopen Evidence to ask again.
        </span>
      </p>
    )
  }
  if (data.def_hash && data.def_hash !== defHash) {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-hash-mismatch">
        <UIcon name="warning" size={14} />
        <span>
          This receipt is for a different definition ({data.def_hash}) than the one open
          here ({defHash}), so it is not shown.
        </span>
      </p>
    )
  }
  if (data.backtestable === false) return <Refused data={data} />
  return <Receipt data={data} />
}

function Refused({ data }) {
  return (
    <div className={styles.block} data-testid="evidence-refused">
      {data.detail
        ? <Refusal testid="evidence-refused-detail">{data.detail}</Refusal>
        : (
          <p className={styles.refusal} role="alert" data-testid="evidence-refused-detail">
            <UIcon name="warning" size={14} />
            <span>This screen cannot be replayed, and the server sent no reason with the refusal.</span>
          </p>
        )}
      {Array.isArray(data.names) && data.names.length > 0 && (
        <ul className={styles.names} data-testid="evidence-refused-names">
          {data.names.map((x) => <li key={x}><code>{x}</code></li>)}
        </ul>
      )}
      {data.universe && data.universe.caveat && (
        <p className={styles.caveat} data-testid="evidence-survivorship">{data.universe.caveat}</p>
      )}
      {/* ⛔⛔ A REFUSAL STILL CARRIES ITS COUNTS, AND THE SERVER PROMISED THEM.
          `backtest.refuse` takes `results=` for one stated reason — "how RULE 5's
          n IS ALWAYS REPORTED survives a refusal" — and the `too_few_signals`
          detail says VERBATIM "the per-horizon counts are in `horizons`". A tab
          that renders that sentence and then draws no table sends the member
          somewhere there is nothing: a cross-layer broken promise, and worse than
          saying less. `coverage` rides for the same reason; a refusal that fired
          before any bar was read carries {} and both blocks render nothing. */}
      <CoverageLine coverage={symbolCoverage(data.coverage)} />
      <BarsCoverage c={data.coverage} />
      {Array.isArray(data.horizons) && data.horizons.length > 0 && <Horizons data={data} />}
    </div>
  )
}

/** ⚠️ MEASURED: `screen_id` and `screen_name` are `PER_CALLER_UNIVERSE_KEYS` in
 *  `api/routers/screener_backtest.py`, and `_shared_only` strips both off every
 *  POLL answer. This component only ever reads polls (it always asks with
 *  `?background=1`), so on a saved-screen run neither name reaches here — and
 *  `saved screen ${u.screen_name || u.screen_id}` would print the literal word
 *  "undefined" into a member-facing sentence. It says what it actually knows. */
function describeUniverse(data) {
  const u = data.universe_request || {}
  const membership = data.universe && data.universe.membership
  const named = u.screen_name || u.screen_id
  const tail = `${n(u.matched)} names${u.truncated ? ' (truncated)' : ''}`
  if (u.kind === 'saved-screen') {
    return named ? `saved screen ${named} · ${tail}` : `a saved screen · ${tail}`
  }
  return `${membership || 'current'} membership · ${tail}`
}

function Receipt({ data }) {
  const m = data.method || {}
  const w = data.window || {}
  // ⚠️ `window_request` is a PER_CALLER key and is stripped off every poll, so on
  // this path it is absent by construction. Kept because a door that ever renders
  // a synchronous receipt would carry it, and rendering nothing is correct either
  // way — this is NOT a claim that the rule shows up today.
  const wr = data.window_request
  return (
    <div className={styles.block}>
      <dl className={styles.method} data-testid="evidence-method">
        <dt>Fill</dt><dd>{m.fill}</dd>
        <dt>Exit</dt><dd>{m.exit}</dd>
        <dt>Window</dt>
        <dd>
          {w.from} → {w.to}
          {data.as_of ? ` · last bar ${data.as_of}` : ''}
          {wr && wr.derived && wr.rule ? ` · ${wr.rule}` : ''}
        </dd>
        <dt>Universe</dt><dd>{describeUniverse(data)}</dd>
        <dt>Signals</dt>
        <dd>{n(data.signals)} over {n(data.evaluated_dates)} sessions · floor {n(m.min_signals)} per horizon</dd>
        <dt>Controls</dt>
        <dd>
          {m.winsorised ? `winsorised ±${m.winsor_pct}%` : 'not winsorised'}
          {' · '}
          {m.same_day_control ? 'same-day-move matched' : 'no same-day-move control'}
        </dd>
        <dt>Answers</dt><dd>{m.answers}</dd>
        <dt>Observations</dt><dd>{m.observations}</dd>
      </dl>
      {data.universe && data.universe.caveat && (
        <p className={styles.caveat} data-testid="evidence-survivorship">{data.universe.caveat}</p>
      )}
      <CoverageLine coverage={symbolCoverage(data.coverage)} />
      <BarsCoverage c={data.coverage} />
      <Horizons data={data} />
    </div>
  )
}

function BarsCoverage({ c }) {
  if (!c) return null
  const parts = [c.bars_warmup, c.bars_not_computable, c.bars_answered].map(Number)
  const total = Number(c.bars_in_window)
  // Same rule as `symbolCoverage`: no bar coverage at all is silence, not an alarm.
  if (!Number.isFinite(total)) return null
  const closes = [total, ...parts].every(Number.isFinite) && parts.reduce((a, b) => a + b, 0) === total
  if (!closes) {
    return (
      <p className={styles.refusal} role="alert" data-testid="evidence-bars-broken">
        <UIcon name="warning" size={14} />
        <span>This study&apos;s bar coverage does not add up, so its counts are not shown.</span>
      </p>
    )
  }
  return (
    <p className={styles.line} data-testid="evidence-bars-coverage">
      {n(total)} bars in window · {n(c.bars_warmup)} warm-up · {n(c.bars_not_computable)} not
      {' '}computable · {n(c.bars_answered)} answered
    </p>
  )
}

function Pair({ a, b, f }) {
  const cls = Number.isFinite(a) && Number.isFinite(b) ? (a > b ? styles.gain : a < b ? styles.loss : '') : ''
  return <><span className={cls}>{f(a)}</span> vs <span>{f(b)}</span></>
}

function Signed({ v, f }) {
  return <span className={Number.isFinite(v) ? (v >= 0 ? styles.gain : styles.loss) : ''}>{f(v)}</span>
}

function Horizons({ data }) {
  const rows = Array.isArray(data.horizons) ? data.horizons : []
  const floor = data.method && data.method.min_signals
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid="evidence-horizons">
        <thead>
          <tr>
            <th>Horizon</th>
            <th>n (screen / all)</th>
            <th>Win rate vs baseline</th>
            <th>Avg % vs baseline</th>
            <th>Winsorised avg % vs baseline</th>
            <th>Same-day excess</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => <HorizonRow key={h.horizon} h={h} floor={floor} />)}
        </tbody>
      </table>
    </div>
  )
}

function HorizonRow({ h, floor }) {
  const s = h.strategy
  const b = h.baseline
  if (!s || typeof s !== 'object' || !b || typeof b !== 'object') {
    return (
      <tr data-testid={`evidence-horizon-${h.horizon}-naked`}>
        <td>{h.horizon}d</td>
        <td colSpan={5} className={styles.refusalCell} role="alert">
          This horizon arrived without its baseline, so its screen numbers are not shown — a number
          without the same universe over the same dates beside it cannot be read.
        </td>
      </tr>
    )
  }
  if (h.below_floor) {
    return (
      <tr data-testid={`evidence-horizon-${h.horizon}-withheld`}>
        <td>{h.horizon}d</td>
        <td>{n(s.n)} / {n(b.n)}</td>
        <td colSpan={4} className={styles.muted}>below the floor of {n(floor)} signals — rates withheld</td>
      </tr>
    )
  }
  const sd = h.same_day
  return (
    <tr data-testid={`evidence-horizon-${h.horizon}`}>
      <td>{h.horizon}d</td>
      <td>{n(s.n)} / {n(b.n)}</td>
      <td><Pair a={s.win_rate} b={b.win_rate} f={rate} /></td>
      <td><Pair a={s.avg_pct} b={b.avg_pct} f={pct} /></td>
      <td><Pair a={s.avg_pct_winsorised} b={b.avg_pct_winsorised} f={pct} /></td>
      <td>
        {sd ? (
          <>
            <Signed v={sd.excess_pct_winsorised} f={pct} />
            {' '}
            <span className={styles.muted}>(n {n(sd.n_matched)}{sd.n_unmatched ? `, ${n(sd.n_unmatched)} unmatched` : ''})</span>
          </>
        ) : '—'}
      </td>
    </tr>
  )
}

function ForwardRecord({ data, error }) {
  return (
    <div className={styles.block} data-testid="evidence-record">
      <h4 className={styles.head}>Forward record</h4>
      {error && (
        <p className={styles.refusal} role="alert" data-testid="evidence-record-error">
          <UIcon name="warning" size={14} />
          <span>
            The forward record could not be read ({error.status || String(error.message || error)}).
            {error.detail ? ` ${error.detail}` : ''}
          </span>
        </p>
      )}
      {!error && !data && (
        <p className={styles.note} role="status"><UIcon name="clock" size={14} /><span>Reading the record…</span></p>
      )}
      {data && <RecordClaim data={data} />}
    </div>
  )
}

/** The claim in the RECORD's words. `refusal` is `claim_for`'s own sentence;
 *  a proven claim has none, so the raw fields are shown under their own names —
 *  this file writes no sentence about what the record means. The ONE sentence
 *  that must appear beside a number is the route's `hit_rate_means`, and it is
 *  rendered verbatim rather than paraphrased for exactly that reason. */
function RecordClaim({ data }) {
  const c = data.claim || {}
  const sym = c.symbols || {}
  const w = data.window
  // ⛔ TOGETHER OR NEITHER. `hit_rate_means` rides beside `claim`, never inside
  // it, so a payload can carry the number without the sentence — and that number
  // sits inches from the study's strategy/baseline pair, where a bare ratio reads
  // as performance. When the sentence is missing the number is withheld BY NAME:
  // a receipt that says less is honest, and one that says this much less says so.
  const means = typeof data.hit_rate_means === 'string' && data.hit_rate_means.trim()
    ? data.hit_rate_means
    : null
  const known = Number.isFinite(c.hit_rate)
  return (
    <dl className={styles.method}>
      {c.refusal ? (
        <>
          <dt>refusal</dt><dd data-testid="evidence-record-refusal">{c.refusal}</dd>
          {/* ⛔ `evaluated` SURVIVES THE REFUSAL, BY THE STORE'S OWN RULE.
              `claim_for`'s docstring: "reports how much of the window IS proven
              even when the claim refuses, because that is a coverage fact and not
              a performance one — and with `hits` withheld there is no arithmetic
              a caller can do with it". A `partial` claim that showed only its
              refusal would hide the one number saying how far the record HAS got. */}
          <dt>evaluated</dt>
          <dd data-testid="evidence-record-evaluated">{n(c.evaluated)}</dd>
        </>
      ) : (
        <>
          <dt>coverage</dt><dd data-testid="evidence-record-claim">{c.coverage}</dd>
          <dt>hits</dt><dd>{n(c.hits)}</dd>
          <dt>evaluated</dt><dd>{n(c.evaluated)}</dd>
          <dt>hit_rate</dt>
          <dd>
            {!known && '—'}
            {known && means && (
              <>
                <span className={styles.rateValue}>{c.hit_rate.toFixed(3)}</span>
                <span className={styles.means} data-testid="evidence-record-hit-rate-means">{means}</span>
              </>
            )}
            {known && !means && (
              <span className={styles.means} role="alert" data-testid="evidence-record-hit-rate-withheld">
                The record sent this number without the sentence that says what it counts, so it is
                not shown here — beside a study it would read as something it is not.
              </span>
            )}
          </dd>
        </>
      )}
      <dt>window</dt>
      <dd>{w ? `${w.first} → ${w.through}${w.derived ? ' (derived: the latest closed month on record)' : ''}` : 'none yet'}</dd>
      <dt>symbols</dt>
      <dd>
        {n(sym.proven)} proven of {n(sym.requested)}
        {Array.isArray(sym.unproven) && sym.unproven.length > 0
          ? ` · unproven: ${sym.unproven.slice(0, 12).join(', ')}${sym.unproven.length > 12 ? '…' : ''}`
          : ''}
        {sym.unproven_withheld ? ` · ${n(sym.unproven_withheld)} withheld (${sym.withheld_reason})` : ''}
      </dd>
      <dt>retention</dt><dd>{c.horizon ? `${n(c.horizon.retention_days)} days` : '—'}</dd>
    </dl>
  )
}
