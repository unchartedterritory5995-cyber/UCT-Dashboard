/* Is BrowserStack Automate FUNDED right now? — the gate in front of the CI device job.
 *
 * ⛔ WHY THIS FILE EXISTS, AND WHY IT IS NOT A `try { fetch } catch { skip }`.
 * Run 4 of the Phase 2 device gate (2026-09-09 05:52) lost three of four devices to
 * `Automate testing time expired.` — `GET /automate/plan.json` reported
 * `automate_plan: "Free"` with `parallel_sessions_running: 0`, so it was the plan's
 * total minutes allowance, not concurrency. A CI job that opens sessions against that
 * account burns a build slot to learn what one unauthenticated GET already knows.
 *
 * ⛔⛔ THE RULE THIS FILE IS WRITTEN AGAINST — CLAUDE.md rule 14, "An empty result is a
 * failed invocation until proven otherwise": any rail that shells out carries a
 * NON-VACUITY CONTROL proving the command returned something before any assertion over
 * its output means anything. `scripts/deploy_watch.py` v1 threw `FileNotFoundError`
 * forty times and **exited 0**. The shape of that defect here would be:
 *
 *     let funded = false
 *     try { funded = (await fetch(PLAN)).ok } catch {}      // ⚰️ NEVER
 *     if (!funded) { console.log(SKIP_LINE); process.exit(0) }
 *
 * — under which a DNS failure, a revoked access key, a 502, and a genuinely exhausted
 * Free plan all produce the same clean green skip, forever, and nobody ever finds out
 * the device job stopped being able to run. So:
 *
 * ⭐ A SKIP REQUIRES POSITIVE PROOF OF UNFUNDEDNESS. Only two things may skip: we can
 * see locally that the secrets are absent (so no call is owed), or BrowserStack
 * ANSWERED, we PARSED its answer, and that answer SAYS the plan is not funded.
 * Everything else — no HTTP response at all, a 401, a 5xx, a 200 that is not a plan
 * document — is a FAILED INVOCATION and goes red. "Could not reach BrowserStack" and
 * "the plan is not funded" are different facts and this module refuses to merge them.
 *
 * ⭐ AND AN UNRECOGNISED PLAN NAME RUNS, IT DOES NOT SKIP. Guessing "unknown ⇒ skip"
 * would let a paid plan be silently skipped forever, which is the exact failure this
 * program keeps shipping (a `-t` filter matching no tests, a landscape readout that had
 * stopped polling). Guessing "unknown ⇒ run" fails LOUDLY on the session attempt. When
 * the two errors are not symmetric, take the loud one.
 *
 * ── MEASURED, not asserted (2026-09-10, from this machine, `curl 8.18.0`) ────────────
 *   $ curl -s -D - https://api.browserstack.com/automate/plan.json
 *       HTTP/1.1 401 Unauthorized · Content-Type: text/html; charset=utf-8
 *       WWW-Authenticate: Basic realm="Application"
 *       body (27 bytes): `HTTP Basic: Access denied.`
 *   $ curl -s -u "not-a-real-user:not-a-real-key" https://api.browserstack.com/automate/plan.json
 *       HTTP/1.1 401 · text/html · byte-identical body
 *   $ curl -s --max-time 15 https://api.browserstack.invalid/automate/plan.json
 *       exit 6 (could not resolve host), HTTP 000, no body
 *
 *   Two findings that shape the code below:
 *     1. THE UNFUNDED ANSWER IS NOT JSON. A 401 here is `text/html` — a bare
 *        `JSON.parse(await res.text())` THROWS, and that throw is what a catch-all
 *        would have turned into "not funded". The classifier therefore reads the
 *        STATUS before it reads the body, and never parses a non-2xx.
 *     2. NO CREDENTIALS AND WRONG CREDENTIALS ARE INDISTINGUISHABLE AT THE WIRE —
 *        same status, same content type, byte-identical body. So "are the secrets
 *        present?" can only be answered LOCALLY, before the call. That is why
 *        `decide()` checks the environment first and never attributes a 401 to
 *        absent secrets.
 *
 *   ⚠️ NOT MEASURED: a funded 2xx. This machine's account is the Free plan whose
 *   minutes are spent, and no real credential is available to this file's author.
 *   The RUN path's shape comes from the documented response
 *   (`automate_plan`, `parallel_sessions_max_allowed`, `parallel_sessions_running`,
 *   `queued_sessions`) and from the Free-plan body recorded in
 *   `docs/plans/joystick/40-phase2-device.md` §"RUN 4". Treat it as untested until a
 *   funded account has run it.
 *
 * ⛔ IMPORTING THIS FILE IS INERT. `tests/run.js` learned this the expensive way: a
 * bare `main()` call at module scope meant `require('./tests/run')` started the whole
 * BrowserStack matrix and overwrote four result files. Nothing here runs on import.
 *
 * ⛔ ZERO DEPENDENCIES, and that is a hard constraint, not a preference. CLAUDE.md:
 * "There is no BrowserStack MCP or SDK configured, and none is to be installed."
 * Node's own `fetch` (18+) is the entire HTTP layer here; nothing is added to
 * `app/package.json` or `requirements.txt`.
 */
// Node globals are IMPORTED, not assumed — `app/eslint.config.js` declares browser
// globals for all of `src/**`, and every other node-side file here (`rule12Paths.test.js`,
// `reachable.test.js`, `cotFactsEntry.test.js`) reaches for `node:` the same way.
import { Buffer } from 'node:buffer'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** The six outcomes. Three of them exit 0; three of them are red. Nothing collapses. */
export const OUTCOME = {
  /** Secrets present, BrowserStack answered, the answer says funded. Run the devices. */
  RUN: 'RUN',
  /** No `BROWSERSTACK_*` in the environment — a fork PR, or a repo without the secrets.
   *  Decided LOCALLY, before any call: the wire cannot tell absent from wrong. */
  SKIP_NO_SECRETS: 'SKIP_NO_SECRETS',
  /** BrowserStack answered 2xx, we parsed a plan document, and it says not funded. */
  SKIP_NOT_FUNDED: 'SKIP_NOT_FUNDED',
  /** 401/403 — the secrets ARE present and BrowserStack REJECTED them. A rotted or
   *  revoked key is a defect the owner must fix, not a funding state. Red, on purpose:
   *  skipping here would hide a dead credential for as long as anyone cared to look. */
  FAIL_AUTH: 'FAIL_AUTH',
  /** No HTTP response at all (DNS/TLS/connection/timeout), or a 5xx. We learned nothing
   *  about funding. Red: this is precisely the "empty result" rule 14 forbids treating
   *  as an answer. */
  FAIL_UNREACHABLE: 'FAIL_UNREACHABLE',
  /** An answer arrived and is not a plan document — a 404, a non-JSON 200 (proxy or
   *  captive portal), JSON without `automate_plan`. Red: unclassifiable is not unfunded. */
  FAIL_UNPARSEABLE: 'FAIL_UNPARSEABLE',
}

/** ⛔ The one line the job is specified to print on a skip. Exactly this, byte for byte.
 *  Tested against, printed by the workflow, and greppable in a run log. */
export const SKIP_LINE = 'device job skipped: Automate not funded.'

export const PLAN_URL = 'https://api.browserstack.com/automate/plan.json'

export const CREDENTIAL_VARS = ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY']

/** Plan names that POSITIVELY mean "no funded Automate minutes". Word-boundary matched
 *  so `Automate Mobile` is never caught by a substring of `free`. Extend only with a
 *  name someone has actually SEEN; a guess here becomes a silent skip. */
const UNFUNDED_PLAN = /(?:^|[^a-z])(free|trial|expired|unsubscribed|cancell?ed|none)(?:[^a-z]|$)/i

const isSkip = (o) => o === OUTCOME.SKIP_NO_SECRETS || o === OUTCOME.SKIP_NOT_FUNDED
const isFail = (o) => o === OUTCOME.FAIL_AUTH || o === OUTCOME.FAIL_UNREACHABLE ||
                      o === OUTCOME.FAIL_UNPARSEABLE

export { isSkip, isFail }

/** One-line, credential-free summary safe to print in a public CI log. */
const oneLine = (s, cap = 120) =>
  String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, cap)

/**
 * Are the credentials present in this environment?
 *
 * ⛔ PRESENCE ONLY. The values never leave this function — not into a return value, not
 * into a log line, not into an error message. `run-phase2.ps1` holds the same line
 * ("NEVER printed, logged, echoed or committed - only their presence is reported").
 *
 * Empty and whitespace-only count as ABSENT: GitHub Actions materialises an unset
 * secret as the empty string, so `'BROWSERSTACK_USERNAME' in env` is true for a repo
 * that has never had one.
 */
export function credentialsPresent(env = {}) {
  const missing = CREDENTIAL_VARS.filter((v) => !String(env[v] ?? '').trim())
  return { present: missing.length === 0, missing }
}

/**
 * Classify a plan DOCUMENT (already parsed). Exported so the funded/unfunded decision
 * can be tested without inventing an HTTP layer around it.
 */
export function classifyPlanDocument(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { outcome: OUTCOME.FAIL_UNPARSEABLE, detail: 'plan.json body is not a JSON object' }
  }
  const name = typeof plan.automate_plan === 'string' ? plan.automate_plan.trim() : ''
  if (!name) {
    // ⛔ NOT a skip. A plan document with no plan name is an answer we cannot read, and
    // "cannot read" is the failed-invocation case, not the unfunded case.
    return {
      outcome: OUTCOME.FAIL_UNPARSEABLE,
      detail: 'plan.json parsed but carries no `automate_plan` — the response shape changed',
    }
  }

  // A plan that allows zero parallel sessions cannot start one, whatever it is called.
  // Guarded on `=== 0` rather than falsiness: the field being ABSENT must not read as
  // zero, or a response-shape change silently becomes a permanent skip.
  if (plan.parallel_sessions_max_allowed === 0) {
    return {
      outcome: OUTCOME.SKIP_NOT_FUNDED,
      plan: name,
      detail: `plan "${name}" allows 0 parallel sessions`,
    }
  }

  if (UNFUNDED_PLAN.test(name)) {
    return { outcome: OUTCOME.SKIP_NOT_FUNDED, plan: name, detail: `plan "${name}" is not a funded plan` }
  }

  // ⭐ Unrecognised ⇒ RUN. See the header: the loud error beats the silent one.
  return { outcome: OUTCOME.RUN, plan: name, detail: `plan "${name}" is funded` }
}

/**
 * Classify a RESPONSE. Pure — this is the whole decision, with no network in it, which
 * is what makes the mutation proof in `automatePlanGate.test.js` possible.
 *
 * @param {object} r
 * @param {number|null} r.status       HTTP status, or null if no response arrived
 * @param {string} [r.contentType]
 * @param {string|null} [r.body]
 * @param {string|null} [r.transportError]  set ONLY when no HTTP response arrived
 */
export function classifyResponse(r) {
  const { status = null, contentType = '', body = null, transportError = null } = r || {}

  // ⛔ A GUARD AGAINST THIS MODULE'S OWN COLLAPSE. A caller that reports both a status
  // and a transport error has merged two facts, which is the defect this file exists to
  // prevent. Refuse rather than pick one.
  if (transportError && status !== null) {
    throw new Error('classifyResponse: a transport error and an HTTP status cannot both be true')
  }

  if (transportError) {
    return {
      outcome: OUTCOME.FAIL_UNREACHABLE,
      detail: `no HTTP response from BrowserStack: ${oneLine(transportError)}`,
    }
  }
  if (typeof status !== 'number' || !Number.isFinite(status)) {
    // Neither a status nor an error — the invocation returned nothing at all.
    return {
      outcome: OUTCOME.FAIL_UNREACHABLE,
      detail: 'the plan.json call returned neither an HTTP status nor an error',
    }
  }

  if (status === 401 || status === 403) {
    return {
      outcome: OUTCOME.FAIL_AUTH,
      detail: `HTTP ${status} — BrowserStack rejected the credentials. ` +
              'The secrets are set but not accepted; this is a broken credential, not an unfunded plan.',
    }
  }
  if (status >= 500) {
    return {
      outcome: OUTCOME.FAIL_UNREACHABLE,
      detail: `HTTP ${status} from api.browserstack.com — the service answered, but not with an answer`,
    }
  }
  if (status < 200 || status >= 300) {
    return {
      outcome: OUTCOME.FAIL_UNPARSEABLE,
      detail: `HTTP ${status} from ${PLAN_URL} — not a plan document`,
    }
  }

  // ── 2xx from here down. Only now is the body worth reading. ────────────────────────
  if (body === null || body === undefined) {
    return { outcome: OUTCOME.FAIL_UNPARSEABLE, detail: `HTTP ${status} with no readable body` }
  }
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    // ⛔ THIS BRANCH IS WHY THE 401 IS HANDLED ABOVE IT. The real unfunded-looking
    // response measured from this machine is `text/html` reading `HTTP Basic: Access
    // denied.` — parsing it throws, and a catch-all around the whole function would
    // have filed that throw as "not funded".
    return {
      outcome: OUTCOME.FAIL_UNPARSEABLE,
      detail: `HTTP ${status} body is not JSON (content-type: ${oneLine(contentType, 60) || 'none'}): ` +
              oneLine(body, 60),
    }
  }
  return classifyPlanDocument(parsed)
}

/**
 * Make the call. Returns the RAW facts — status, content type, body, or a transport
 * error — and classifies nothing, so the classifier above stays pure and testable.
 *
 * ⛔ The `catch` here is deliberately narrow in MEANING, not in syntax: it can only ever
 * produce `transportError`, which has exactly one outcome (FAIL_UNREACHABLE). It cannot
 * reach the skip path.
 */
export async function fetchPlan({
  env = {},
  url = PLAN_URL,
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
  authenticated = true,
} = {}) {
  const headers = { Accept: 'application/json' }
  if (authenticated) {
    const user = String(env.BROWSERSTACK_USERNAME ?? '')
    const key = String(env.BROWSERSTACK_ACCESS_KEY ?? '')
    // Built here, used here, referenced nowhere else. Not returned, not logged.
    headers.Authorization = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64')
  }

  let res
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  } catch (err) {
    return { status: null, contentType: '', body: null, transportError: oneLine(err?.message || err) }
  }

  let body = null
  try {
    body = (await res.text()).slice(0, 4096)
  } catch {
    // A status DID arrive, so this is not "unreachable" — it is an answer we could not
    // read, which the classifier files as unparseable. Keeping the status is the whole
    // point: the two must not become one.
    body = null
  }
  return {
    status: res.status,
    contentType: res.headers?.get?.('content-type') || '',
    body,
    transportError: null,
  }
}

/**
 * The whole decision. Credentials are checked LOCALLY FIRST — see the measured note in
 * the header: 401 looks identical with no credentials and with wrong ones, so a call
 * made without them could only ever be misread.
 */
export async function decide({ env = {}, ...opts } = {}) {
  const creds = credentialsPresent(env)
  if (!creds.present) {
    return {
      outcome: OUTCOME.SKIP_NO_SECRETS,
      detail: `not configured for this run: ${creds.missing.join(', ')} absent`,
    }
  }
  const raw = await fetchPlan({ env, ...opts })
  const verdict = classifyResponse(raw)
  return { ...verdict, status: raw.status }
}

/* ──────────────────────────────────────────────────────────────────────────────────────
 * `--self-check` — THE NON-VACUITY CONTROL, run BEFORE the gate is trusted.
 *
 * Rule 14 asks for "a case proving the command returned something before any assertion
 * over its output means anything", with its mutation proof run BEFORE the rail is called
 * done. This performs a REAL, UNAUTHENTICATED call to the live endpoint and proves four
 * things at once:
 *
 *   1. the network call returned an actual HTTP status (not nothing, not an exception);
 *   2. the classifier files that real 401 as FAIL_AUTH — NOT as a skip;
 *   3. the SAME classifier files a genuine unfunded plan document as SKIP_NOT_FUNDED,
 *      and a transport error as FAIL_UNREACHABLE, and a funded plan as RUN;
 *   4. those four land on FOUR DISTINCT outcomes.
 *
 * (4) is the assertion a `catch { skip }` implementation cannot pass, and it is the
 * reason this is a control rather than a smoke test. It costs no Automate minutes: an
 * unauthenticated GET opens no session.
 * ──────────────────────────────────────────────────────────────────────────────────── */
export async function selfCheck({ url = PLAN_URL, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const failures = []
  const say = (ok, line) => { log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`); if (!ok) failures.push(line) }

  log('self-check — an UNAUTHENTICATED call to the live plan endpoint (no session, no quota)')
  const raw = await fetchPlan({ env: {}, url, fetchImpl, authenticated: false })
  log(`  measured: status=${raw.status} content-type="${raw.contentType}" ` +
      `bodyBytes=${raw.body === null ? 'null' : raw.body.length} ` +
      `transportError=${raw.transportError ?? 'none'}`)
  log(`  body: ${oneLine(raw.body, 80) || '(none)'}`)

  // 1 — NON-VACUITY. Without this, every assertion below is over an empty set.
  say(typeof raw.status === 'number' && raw.status >= 100,
      `the call returned a real HTTP status (got ${raw.status === null ? 'NOTHING' : raw.status})`)

  if (typeof raw.status !== 'number') {
    log('')
    log('REFUSING to certify the gate: the live endpoint returned no HTTP status, so')
    log('nothing below would be measuring the real thing. This is a failed invocation.')
    return { ok: false, failures: ['no HTTP status from the live endpoint'], measured: raw }
  }

  // 2 — the real, live, credential-less answer must be an AUTH failure, not a skip.
  const live = classifyResponse(raw)
  say(live.outcome === OUTCOME.FAIL_AUTH,
      `the live credential-less answer classifies as FAIL_AUTH (got ${live.outcome})`)
  say(!isSkip(live.outcome),
      `the live credential-less answer is NOT a skip (got ${live.outcome})`)

  // 3 — the other three inputs, through the SAME classifier.
  const unfunded = classifyResponse({
    status: 200,
    contentType: 'application/json',
    // The shape recorded from this account in 40-phase2-device.md §"RUN 4".
    body: JSON.stringify({
      automate_plan: 'Free', parallel_sessions_running: 0,
      parallel_sessions_max_allowed: 1, queued_sessions: 0,
    }),
  })
  const unreachable = classifyResponse({ status: null, transportError: 'getaddrinfo ENOTFOUND' })
  const funded = classifyResponse({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      automate_plan: 'Automate Mobile', parallel_sessions_running: 0,
      parallel_sessions_max_allowed: 5, queued_sessions: 0,
    }),
  })
  say(unfunded.outcome === OUTCOME.SKIP_NOT_FUNDED,
      `a parsed "Free" plan classifies as SKIP_NOT_FUNDED (got ${unfunded.outcome})`)
  say(unreachable.outcome === OUTCOME.FAIL_UNREACHABLE,
      `a transport error classifies as FAIL_UNREACHABLE (got ${unreachable.outcome})`)
  say(funded.outcome === OUTCOME.RUN,
      `a paid plan classifies as RUN (got ${funded.outcome})`)

  // 4 — THE COLLAPSE TEST. Four inputs, four outcomes. A `catch { skip }` gate scores 1.
  const distinct = new Set([live.outcome, unfunded.outcome, unreachable.outcome, funded.outcome])
  say(distinct.size === 4,
      `the four inputs land on FOUR DISTINCT outcomes (got ${distinct.size}: ` +
      `${[...distinct].join(' ')})`)

  log('')
  log(failures.length
    ? `self-check FAILED (${failures.length}) — the gate's answer cannot be trusted this run.`
    : 'self-check PASSED — the call reaches BrowserStack and the four cases stay separate.')
  return { ok: failures.length === 0, failures, measured: raw }
}

/* ── CLI ───────────────────────────────────────────────────────────────────────────── */

function emitGithubOutput(verdict) {
  const out = process.env.GITHUB_OUTPUT
  if (!out) return
  // Single-line values only; `detail` is already collapsed by `oneLine`.
  const lines = [
    `outcome=${verdict.outcome}`,
    `detail=${oneLine(verdict.detail, 200)}`,
    `plan=${oneLine(verdict.plan ?? '', 60)}`,
    `skip_line=${SKIP_LINE}`,
  ]
  appendFileSync(out, lines.join('\n') + '\n')
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--self-check')) {
    const r = await selfCheck()
    return r.ok ? 0 : 1
  }

  const creds = credentialsPresent(env)
  console.log(`BROWSERSTACK_USERNAME   : ${creds.missing.includes('BROWSERSTACK_USERNAME') ? 'absent' : 'present'}`)
  console.log(`BROWSERSTACK_ACCESS_KEY : ${creds.missing.includes('BROWSERSTACK_ACCESS_KEY') ? 'absent' : 'present'}`)

  const verdict = await decide({ env })
  console.log(`outcome : ${verdict.outcome}`)
  console.log(`detail  : ${verdict.detail}`)
  if (verdict.plan) console.log(`plan    : ${verdict.plan}`)
  emitGithubOutput(verdict)

  // ⛔ Exit 0 on ANY verdict — producing a verdict is this program succeeding, and the
  // workflow is what turns FAIL_* red. A non-zero here would be indistinguishable from
  // the script itself being broken, which is the one thing the caller must be able to
  // tell apart. 2 is reserved for "could not even classify".
  return 0
}

// ⛔ INERT ON IMPORT — see the header. `node …/automatePlanGate.js` runs; every other
// reach (a test, a lint pass, a require) gets the exports and nothing else.
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1]
    // `pathToFileURL` rather than string surgery: it is the one thing that gets a
    // Windows drive letter, a UNC path and a POSIX path all right.
    return !!entry && import.meta.url === pathToFileURL(entry).href
  } catch { return false }
})()

if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((err) => {
      console.error(`automatePlanGate: could not classify — ${err?.stack || err}`)
      process.exitCode = 2
    })
}
