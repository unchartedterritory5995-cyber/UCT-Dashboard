/**
 * Client error beacon (D14) — our own reporter, no new vendor.
 *
 * Captures `window.onerror`, `unhandledrejection` and React error boundaries
 * (`components/ErrorBoundary.jsx` calls `reportError`), and posts them to
 * `POST /api/client-errors` (`api/routers/client_errors.py`).
 *
 * ── What leaves the browser, and what never does ──────────────────────────
 * ⛔ NO NOTE TEXT AND NO DOM CONTENT. The page is where a member's writing
 *    lives, and an error message is the one field that can carry it — a
 *    ProseMirror content error quotes the node, a JSON parse error quotes the
 *    input, and `throw new Error(title)` is one careless line away. Form cannot
 *    tell a note sentence from an engine sentence, so the message is sent as a
 *    SKELETON: quoted spans are removed first (engines quote the offending
 *    input), then every word that is neither in the engines' own error
 *    vocabulary (`ENGINE_WORDS`) nor shaped like code becomes `…`.
 *    "Cannot read properties of undefined (reading 'x')" survives whole;
 *    "Buy NVDA on the pullback" does not survive at all.
 *    ⚠️ RESIDUAL, stated: a token shaped like code (dots, brackets, camelCase)
 *    survives, so a note that contained `example.com/x` could contribute that
 *    one token. Never a sentence.
 * ⛔ STACKS ARE FRAMES ONLY. A V8 stack's first lines repeat the message; every
 *    line that is not a frame is dropped, not scrubbed.
 * ⛔ EVERY URL LOSES ITS QUERY AND ITS FRAGMENT — share and login tokens ride in
 *    fragments (`/smoke-login#token=…`). The page is sent as its pathname only.
 * Message and stack are capped. The server scrubs URLs again and caps again,
 * and deliberately does NOT re-implement the skeleton (one authority).
 *
 * ── How much ──────────────────────────────────────────────────────────────
 * An identical stack is sent once per `DEDUPE_MS` (60 s), and at most
 * `MAX_PER_PAGE` (20) reports per page load. Reports are batched for
 * `FLUSH_MS`; on `pagehide` whatever is still queued goes by
 * `navigator.sendBeacon`, which outlives the page. If the server answers
 * `enabled: false` (kill switch `CLIENT_ERROR_BEACON_ENABLED=0`) the page stops
 * sending for the rest of its life.
 *
 * It never throws into a caller, and an error inside the beacon is never
 * reported by the beacon.
 */

export const BEACON_URL = '/api/client-errors'
export const DEDUPE_MS = 60_000
export const MAX_PER_PAGE = 20
export const MAX_MESSAGE = 500
export const MAX_STACK = 4000
export const MAX_COMPONENT_STACK = 2000
export const FLUSH_MS = 1000
export const BATCH_MAX = 10          // the server's MAX_REPORTS_PER_REQUEST
const MAX_FRAME = 300

// ── URL scrub ─────────────────────────────────────────────────────────────

const SCRIPT_PATH = /\.(?:m?jsx?|cjs|tsx?|html?)$/i
const LINE_COL = /(:\d+:\d+)$/
const SCHEMED_URL = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"()<>]+/g
const REL_URL = /(^|[\s("'=])(\/[^\s?#'"()<>]*)([?#][^\s'"()<>]*)/g
const BARE_PARAMS = /(^|[\s("'=])[#?][^\s'"()<>]*=[^\s'"()<>]*/g
const CREDENTIAL = /\b(access_token|id_token|refresh_token|token|api_key|apikey|key|secret|password|passwd|pass|code|session|sid|sig|signature|auth)=[^\s&;'"()<>]*/gi
const DATA_URI = /data:[^\s'"()<>]+/gi

function frameTail(path, rest) {
  if (!SCRIPT_PATH.test(path)) return ''
  const m = LINE_COL.exec(rest)
  return m ? m[1] : ''
}

/** Origin + path only: the query AND the fragment go, whatever they hold. */
export function scrubUrl(url) {
  if (typeof url !== 'string') return ''
  if (url.slice(0, 5).toLowerCase() === 'data:') return 'data:[removed]'
  const q = url.indexOf('?')
  const h = url.indexOf('#')
  const cut = [q, h].filter((i) => i !== -1).reduce((a, b) => Math.min(a, b), url.length)
  if (cut === url.length) return url
  return url.slice(0, cut) + frameTail(url.slice(0, cut), url.slice(cut))
}

/** Every URL inside free text loses its query and fragment. */
export function scrubUrlsInText(text) {
  if (typeof text !== 'string' || !text) return ''
  return text
    .replace(DATA_URI, 'data:[removed]')
    .replace(SCHEMED_URL, (u) => scrubUrl(u))
    .replace(REL_URL, (_m, lead, path, rest) => lead + path + frameTail(path, rest))
    .replace(BARE_PARAMS, (_m, lead) => lead + '[removed]')
    .replace(CREDENTIAL, (_m, name) => `${name}=[removed]`)
}

// ── Message skeleton ──────────────────────────────────────────────────────

/** The words JS engines, browsers, React, ProseMirror and IndexedDB use in
 *  their OWN error messages. A word outside this list is replaced, not sent. */
export const ENGINE_WORDS = new Set(`
a an the is are was were be been being not no of to in on at by for from with without as and or but
if than then this that these those it its into onto out up has have had does do did can cannot could
would should will must may might got received requires required least most one two zero only all any
some none each every more less too many much large small long short limit limits reached exceeded
undefined null nan infinity true false object objects function functions string strings number numbers
boolean symbol bigint array arrays property properties reading setting read set get call called calling
method methods constructor constructors prototype instance instances class classes value values
argument arguments parameter parameters type types key keys index indexes length size range maximum
minimum max min stack depth invalid valid unexpected expected token tokens end input json parse parsing
parsed syntax reference variable variables defined declared initialized initialization before after
access accessing assignment assign constant const let var iterable iterator callable convert converted
conversion primitive circular structure serialize serialized clone cloned find found exist exists
existing missing already empty same different network request requests response responses failed fail
failure fetch fetching load loading loaded resource resources module modules dynamically imported import
importing script scripts chunk chunks timeout timed aborted abort operation operations cancelled
canceled blocked refused denied permission permissions allowed disallowed quota storage database
transaction transactions store stores version versions connection closed closing open opening lock locks
locked state states status error errors exception exceptions event events handler handlers listener
listeners element elements node nodes child children parent document window frame frames render
rendering rendered component components hook hooks hydration hydrate mismatch text content schema mark
marks position positions selection step steps apply applied mapping slice fragment replace insert delete
deleted observer loop completed undelivered notifications notification minified react visit full message
messages dev environment production development internal unknown unsupported supported support feature
features origin cross cors policy security secure context contexts offline online retry retries attempt
attempts again while during when which what where because due via per use used using user gesture play
playback audio video media source sources image images decode decoding canvas webgl lost pointer touch
click scroll resize focus blur keyboard clipboard write writing written readonly writable configurable
extensible frozen sealed strict mode private public field fields getter setter super new await async
promise promises rejected rejection resolved resolve reject unhandled handled caught uncaught thrown throw
returned return yield generator iteration next done match matched matches pattern regular expression flags
group character characters escape sequence quote unterminated literal identifier reserved word keyword
statement block label operand operator side instanceof typeof update updated updating create created
creating destroy destroyed mount mounted unmount unmounted unmounting memory allocation worker workers
thread service cache caches cached json html dom url uri api http https css svg utf jsx idb id ids
removed evaluating evaluate evaluated uncaught
can't don't doesn't isn't won't couldn't didn't wasn't aren't hasn't haven't
`.split(/\s+/).filter(Boolean))

// Quoted spans are where engines put the offending INPUT. A single quote only
// opens a span when it does not follow a letter, so "Can't" is not a quote.
const QUOTED = /"([^"]*)"|`([^`]*)`|“([^”]*)”|‘([^’]*)’/g
const SINGLE_QUOTED = /(^|[^\w])'([^']*)'/g
// A quoted member path (`foo.bar`, `Iterator.prototype.join`) is code, never
// prose, and it is the most useful thing in the message: kept.
const MEMBER_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/
// Where engines name an identifier WITHOUT quotes. The captured word is kept
// even though it is not in the vocabulary ("Can't find variable: Iterator").
const ENGINE_POSITIONS = [
  /([A-Za-z_$][\w$.]*) is not defined/g,
  /[Vv]ariable:?\s+([A-Za-z_$][\w$.]*)/g,
  /([A-Za-z_$][\w$.]*) is not (?:a function|a constructor|iterable|an object)/g,
]

function stripQuoted(text) {
  const keepOr = (whole, inner) => (MEMBER_PATH.test(inner) ? whole : '"…"')
  return text
    .replace(QUOTED, (whole, a, b, c, d) => keepOr(whole, a ?? b ?? c ?? d ?? ''))
    .replace(SINGLE_QUOTED, (whole, lead, inner) => lead + (MEMBER_PATH.test(inner) ? `'${inner}'` : '"…"'))
}

function engineIdentifiers(text) {
  const found = new Set()
  for (const re of ENGINE_POSITIONS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) found.add(m[1])
  }
  return found
}

const LEAD_PUNCT = /^[([{"'`“‘]+/
const TRAIL_PUNCT = /[)\]}"'`,.;:!?”’]+$/

function isCodeShaped(core) {
  if (/^\d+(?:\.\d+)?%?$/.test(core)) return true               // numbers
  if (/^#\d+$/.test(core)) return true                         // React error #185
  if (/[._()[\]{}<>=:/\\`]/.test(core)) return true            // a.b, fn(), x=y, a/b
  if (/[a-z][A-Z]/.test(core)) return true                     // camelCase / TypeError
  if (/^[A-Z][a-z]+(?:Error|Exception|Event)$/.test(core)) return true
  if (core === '…') return true
  return false
}

function keepWord(core, named) {
  if (!core) return true
  if (ENGINE_WORDS.has(core.toLowerCase())) return true
  if (named.has(core)) return true
  return isCodeShaped(core)
}

/** The message a report may carry: URL-scrubbed, quotes removed, and every
 *  word outside the engine vocabulary replaced. Capped. */
export function messageSkeleton(message) {
  if (typeof message !== 'string' || !message) return ''
  const text = stripQuoted(scrubUrlsInText(message))
  const named = engineIdentifiers(text)
  const out = []
  for (const tok of text.split(/\s+/)) {
    if (!tok) continue
    const lead = (LEAD_PUNCT.exec(tok) || [''])[0]
    const rest = tok.slice(lead.length)
    const trail = (TRAIL_PUNCT.exec(rest) || [''])[0]
    const core = rest.slice(0, rest.length - trail.length)
    out.push(keepWord(core, named) ? tok : `${lead}…${trail}`)
  }
  // Runs of masked words collapse to one marker: the count of hidden words is
  // itself a small fact about the text, and there is no need to send it.
  return out.join(' ').replace(/…(?:\s+…)+/g, '…').slice(0, MAX_MESSAGE)
}

// ── Stacks ────────────────────────────────────────────────────────────────

// A frame is recognised by its SHAPE, strictly — a line of a multi-line
// message that merely begins with "at " must not pass as one.
//   V8:       "    at fn (url:1:2)" · "    at url:1:2" · "    at <anonymous>"
//   JSC/SM:   "fn@url:1:2" · "global code@url:1:2" · "url:1:2" · "fn@[native code]"
//   React:    "    at NoteCard (url:1:2)" · "    at div" · "    in div (created by X)"
const V8_FRAME = /^ {4}at .*(?:\)|:\d+:\d+|<anonymous>)\s*$/
const JSC_FRAME = /^(?:[\w$.<>]+(?: code)?@)?(?:\S+:\d+:\d+|\[native code\])\s*$/
const REACT_FRAME = /^\s*(?:at|in)\s+[\w$.<>[\]]+(?:\s+\(.*\))?\s*$/

/** Frame lines only (any line that is not a frame is dropped), URL-scrubbed. */
export function scrubStack(stack, max = MAX_STACK, { react = false } = {}) {
  if (typeof stack !== 'string' || !stack) return ''
  const lines = []
  for (const line of stack.split('\n')) {
    const isFrame = V8_FRAME.test(line) || JSC_FRAME.test(line) || (react && REACT_FRAME.test(line))
    if (!isFrame) continue
    lines.push(scrubUrlsInText(line).slice(0, MAX_FRAME))
  }
  return lines.join('\n').slice(0, max)
}

function errorName(err) {
  const n = err && typeof err.name === 'string' ? err.name : ''
  return /^[A-Za-z_$][\w$]{0,99}$/.test(n) ? n : 'Error'
}

/** One report, built from whatever was thrown. Pure: the rails read it. */
export function buildReport(thrown, { kind = 'error', componentStack, loc } = {}) {
  let name = 'Error'
  let message = ''
  let stack = ''
  if (thrown instanceof Error || (thrown && typeof thrown === 'object' && 'message' in thrown)) {
    name = errorName(thrown)
    message = typeof thrown.message === 'string' ? thrown.message : ''
    stack = typeof thrown.stack === 'string' ? thrown.stack : ''
  } else if (typeof thrown === 'string') {
    message = thrown
  } else if (thrown !== undefined) {
    message = `non-error ${typeof thrown} value`
  }
  const where = loc || (typeof window !== 'undefined' ? window.location : null)
  return {
    kind,
    name,
    message: messageSkeleton(message),
    stack: scrubStack(stack),
    componentStack: scrubStack(componentStack || '', MAX_COMPONENT_STACK, { react: true }),
    page: where && typeof where.pathname === 'string' ? where.pathname.slice(0, 300) : '',
    ts: Date.now(),
  }
}

// ── The beacon ────────────────────────────────────────────────────────────

export function createErrorBeacon({ fetchImpl, sendBeaconImpl, now, win } = {}) {
  const clock = now || (() => Date.now())
  const state = { sent: 0, disabled: false, queue: [], lastSeen: new Map(), timer: null, busy: false }
  const getWin = () => win || (typeof window !== 'undefined' ? window : null)

  function post(reports) {
    const f = fetchImpl || globalThis.fetch
    if (!f) return
    try {
      const p = f(BEACON_URL, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reports }),
      })
      if (p && typeof p.then === 'function') {
        p.then((r) => (r && typeof r.json === 'function' ? r.json() : null))
          .then((body) => { if (body && body.enabled === false) disable() })
          .catch(() => {})
      }
    } catch { /* never into the caller */ }
  }

  function disable() {
    state.disabled = true
    state.queue = []
    if (state.timer) { clearTimeout(state.timer); state.timer = null }
  }

  function flush() {
    if (state.timer) { clearTimeout(state.timer); state.timer = null }
    while (state.queue.length && !state.disabled) post(state.queue.splice(0, BATCH_MAX))
  }

  function flushWithBeacon() {
    if (!state.queue.length || state.disabled) return
    const w = getWin()
    const send = sendBeaconImpl || (w?.navigator?.sendBeacon ? w.navigator.sendBeacon.bind(w.navigator) : null)
    while (state.queue.length) {
      const batch = state.queue.splice(0, BATCH_MAX)
      let ok = false
      try {
        const body = new Blob([JSON.stringify({ reports: batch })], { type: 'application/json' })
        ok = send ? send(BEACON_URL, body) === true : false
      } catch { ok = false }
      if (!ok) post(batch)
    }
  }

  /** Queue one report. Returns the report, or null when it was not queued. */
  function report(thrown, extra = {}) {
    if (state.busy || state.disabled) return null
    state.busy = true
    try {
      if (state.sent >= MAX_PER_PAGE) return null
      const r = buildReport(thrown, { ...extra, loc: getWin()?.location })
      if (r.message === 'Script error.' && !r.stack) return null   // cross-origin, no detail
      const key = `${r.kind}|${r.name}|${r.stack || r.message}|${r.componentStack}`
      const t = clock()
      const last = state.lastSeen.get(key)
      if (last !== undefined && t - last < DEDUPE_MS) return null
      state.lastSeen.set(key, t)
      state.sent += 1
      state.queue.push(r)
      if (state.queue.length >= BATCH_MAX) flush()
      else if (!state.timer) state.timer = setTimeout(flush, FLUSH_MS)
      return r
    } catch {
      return null
    } finally {
      state.busy = false
    }
  }

  const onError = (event) => {
    const e = event?.error
    if (e) return report(e, { kind: 'error' })
    const file = typeof event?.filename === 'string' ? event.filename : ''
    const stack = file ? `    at ${file}:${event.lineno || 0}:${event.colno || 0}` : ''
    return report({ name: 'Error', message: event?.message || '', stack }, { kind: 'error' })
  }
  const onRejection = (event) => report(event?.reason, { kind: 'unhandledrejection' })
  const onPageHide = () => flushWithBeacon()

  function install() {
    const w = getWin()
    if (!w || typeof w.addEventListener !== 'function') return () => {}
    w.addEventListener('error', onError)
    w.addEventListener('unhandledrejection', onRejection)
    w.addEventListener('pagehide', onPageHide)
    return function uninstall() {
      w.removeEventListener('error', onError)
      w.removeEventListener('unhandledrejection', onRejection)
      w.removeEventListener('pagehide', onPageHide)
    }
  }

  return { report, flush, flushWithBeacon, install, state }
}

// The page's one beacon. Created on first use so importing this module has no
// side effects (ErrorBoundary imports it on every page).
let pageBeacon = null
function beacon() {
  if (!pageBeacon) pageBeacon = createErrorBeacon()
  return pageBeacon
}

/** Report something that was thrown. Never throws. */
export function reportError(thrown, extra) {
  try { return beacon().report(thrown, extra) } catch { return null }
}

let uninstallPage = null
/** Listen for `error`, `unhandledrejection` and `pagehide` on the page. Idempotent. */
export function installErrorBeacon() {
  if (!uninstallPage) uninstallPage = beacon().install()
  return uninstallPage
}

/** Tests only: forget the page beacon (and its listeners). */
export function resetErrorBeaconForTests() {
  if (uninstallPage) uninstallPage()
  uninstallPage = null
  pageBeacon = null
}
