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
 *    input, and `throw new Error(title)` is one careless line away. So a
 *    message is sent ONLY when it fully matches one of the engines' own
 *    message TEMPLATES below ("x is not a function", "Can't find variable: x",
 *    "Failed to fetch" …). Inside a matched template, every quoted-input slot
 *    is `…`, and an identifier or chunk slot that is not code REFUSES the
 *    template (exactly what counts as code: residual (1) below). A message
 *    that no template sends is sent as `<ErrorName>: <unrecognized #hash8>`.
 * ⛔ THE HASH NEVER SEES A WORD (S2-1). It is eight letters of a hash of a
 *    SKELETON — a refused template's id and closed-set choices with every slot
 *    one fixed placeholder, or else the message's SHAPE with every word-bearing
 *    span that placeholder — never of the text. A hash of text is a dictionary
 *    oracle: this bundle ships the template list and the universe of tickers
 *    is public, so hash every candidate and match. Over the skeleton, every
 *    candidate a dictionary holds lands on one hash ("What a hash may see").
 * ⛔ EVERY DIGIT in the message and the stack becomes `#` — prices, sizes,
 *    times, line numbers alike.
 * ⛔ STACKS ARE FRAMES ONLY. The `Name: message` header V8 puts first is cut,
 *    and any stack line that repeats a line of the message is dropped, BEFORE
 *    the frame filter — so a message line that happens to be shaped like a
 *    frame cannot pass as one. Frames are recognised by a strict shape.
 * ⛔ EVERY PATH IS REDUCED SEGMENT BY SEGMENT. A segment survives only if it is
 *    a lowercase, digit-free route word (`journal`, `smoke-login`); every other
 *    segment is `:id`. On the four token-bearing routes (`SHARED_NOTE_ROUTE`,
 *    `TRACK_RECORD_ROUTE`, `SHARED_SCREEN_ROUTE`, `SHARED_FORMULA_ROUTE` — read
 *    from their modules, never typed) the token position is `:id` even when the
 *    token happens to look like a route word. Every URL loses its query and its
 *    fragment. The page is sent as its reduced pathname.
 *
 * ⚠️ RESIDUAL, stated — this is everything free text can still reach,
 *    re-derived from the code below in round 3 (2026-09-24). Every digit in
 *    all of it is `#`.
 *    (1) the identifier slot of a matched template: ONE token — TWO in the
 *        three templates with two `{id}` slots (failed-to-execute,
 *        jsc-not-a-function-in, sm-cant-access-property). A slot is kept only
 *        when it is `(intermediate value)` (V8's own text) or a dot-separated
 *        path whose every part is ONE JS identifier — letters, digits and `_`,
 *        `$` only as the part's single leading character — that holds a
 *        letter, and that is neither a ticker (1-5 capitals once a leading `$`
 *        and trailing digits are removed: NVDA, NVDA1, BRK.B's B) nor a cashtag
 *        (`$` then 1-5 letters of any case: $NVDA, $nvda). The code acronyms in
 *        CODE_CAPS pass though they are 1-5 capitals, and two of them are also
 *        tickers in the app's universe: `UI` and `URI` (api/data/
 *        cap_universe.json, measured 2026-09-24). So a whole WORD passes, in
 *        any case but 1-5 capitals: lowercase (`earnings` — and a lowercase
 *        ticker, `nvda`: 3,626 of the universe's 3,640 pass that way), mixed
 *        case (`Tesla`: a note titled "Tesla" thrown as `Tesla is not defined`
 *        sends exactly that), and ALL CAPS of six letters or more (`EARNINGS`,
 *        `NVIDIA` — no ticker in the universe has a part longer than five
 *        letters, so such a word is never one of its tickers). So do words
 *        joined by `_` or `.` (`Short_at_the_open`, `Short.at.the.open`,
 *        `BUY_THE_DIP`), a ticker joined to anything by `_` or run into digits
 *        (`NVDA_calls`, `_NVDA`, `$NVDA_x`, `NVDA260918C00150000` → `NVDA#C#`),
 *        and a `$` before six letters or more (`$emitter`, `$NVIDIA`). Never a
 *        space, a quote, a bracket, a hyphen, a bare ticker or a cashtag: any
 *        of those refuses the template, and the message goes as the hash (6).
 *        A chunk slot passes only a numeric chunk id, sent as `#`.
 *    (2) a URL's ORIGIN as written — the scheme and host verbatim, i.e.
 *        everything before the first `/`, `?` or `#` after `://`, so a scheme
 *        can be a word (`Buy_NVDA_calls://x` is kept whole); user info goes —
 *        and the FINAL segment of a URL path when it is a static asset file
 *        name (`…/assets/NoteEditorPage-abc.js`), kept so a frame still says
 *        which chunk failed. A token-route position is `:id` even so.
 *    (3) a lowercase, digit-free path segment (a route word) in the page or in
 *        any URL path. The app's own links name a symbol in capitals
 *        (`/research/NVDA` → `/research/:id`), but a route param typed in
 *        lowercase (`/research/nvda`) is a route word and passes.
 *    (4) function and component names in stack frames, as the engine wrote them.
 *    (5) the error NAME: `Error`, or any PascalCase name ending in `Error` or
 *        `Exception` — `ChunkLoadError`, and so also `BuyNvdaCallsError`.
 *    (6) the 8-letter hash of a message no template sends. It is of a SKELETON,
 *        never of words: for a template that matched and refused a slot, that
 *        template's id and its closed-set choices (`undefined` or `null`, the
 *        optional full stop), every slot REDACTED; for any other message, its
 *        shape, every run that is neither whitespace nor STRUCTURAL punctuation
 *        REDACTED. So a dictionary finds every candidate behind every hash
 *        (rail: the whole universe × every template → one hash per template).
 *        All a hash tells is WHICH template refused a slot, or how many
 *        space-separated spans a message had and where its quotes, brackets,
 *        colons, commas and semicolons sat — never a letter of it.
 *
 * ── How much, and how fast ────────────────────────────────────────────────
 * Every field is CAPPED before any pattern runs (`MAX_INPUT`, `MAX_STACK_INPUT`),
 * the URL finder is a linear scan (no backtracking regex), and an identical
 * error is deduplicated BEFORE the report is built — so an error thrown in a
 * loop, or a 50k-character message, costs the page next to nothing.
 * An identical stack is sent once per `DEDUPE_MS` (60 s), and at most
 * `MAX_PER_PAGE` (20) reports per page load. Reports are batched for
 * `FLUSH_MS`; every POST body is kept under `MAX_BATCH_BYTES` (the server
 * refuses a body over 64 KiB, and a browser refuses a keepalive or sendBeacon
 * body over its 64 KiB quota). On `pagehide` whatever is still queued goes by
 * `navigator.sendBeacon`, which outlives the page. If the server answers
 * `enabled: false` (kill switch `CLIENT_ERROR_BEACON_ENABLED=0`) the page stops
 * sending for the rest of its life.
 * ⚠️ ACCEPTED, NOT CLOSED (R1-1): the ~64 KiB keepalive quota spans every body in flight, so a second co-incident large batch can still drop.
 *
 * It never throws into a caller, and an error inside the beacon is never
 * reported by the beacon.
 */
import { SHARED_NOTE_ROUTE } from '../pages/journal-2-0/lib/noteShareLink'
import { TRACK_RECORD_ROUTE } from '../pages/journal-2-0/lib/trackRecordLink'
import { SHARED_SCREEN_ROUTE } from '../pages/screener/screenShareLink'
import { SHARED_FORMULA_ROUTE } from '../pages/formulas/formulaShareLink'

export const BEACON_URL = '/api/client-errors'
export const DEDUPE_MS = 60_000
export const MAX_PER_PAGE = 20
export const MAX_MESSAGE = 500
export const MAX_INPUT = 2 * MAX_MESSAGE      // the most of a message any pattern ever sees
export const MAX_STACK = 4000
export const MAX_STACK_INPUT = 2 * MAX_STACK  // the most of a stack any pattern ever sees
export const MAX_COMPONENT_STACK = 2000
export const FLUSH_MS = 1000
export const BATCH_MAX = 10                   // the server's MAX_REPORTS_PER_REQUEST
export const MAX_BATCH_BYTES = 60_000         // one POST body, UTF-8 — under the 64 KiB limits
const MAX_FRAME = 300
const MAX_PAGE = 300
const MAX_PATH_INPUT = 2000
const KINDS = new Set(['error', 'unhandledrejection', 'boundary'])

// ── Digits and the hash ───────────────────────────────────────────────────

const DIGITS = /\d+/g

/** Every run of digits becomes `#`. */
export function maskDigits(s) {
  return typeof s === 'string' ? s.replace(DIGITS, '#') : ''
}

/** Eight letters (a–p) of a 32-bit FNV-1a hash. Letters, so that masking the
 *  digits of a message that carries one can never alter it. Only ever called
 *  on a SKELETON (below) — never on a message's text. */
export function shortHash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let out = ''
  for (let i = 0; i < 8; i += 1) out += String.fromCharCode(97 + ((h >>> (28 - 4 * i)) & 15))
  return out
}

// ── What a hash may see (S2-1) ────────────────────────────────────────────
//
// ⛔ A HASH OF TEXT IS A DICTIONARY ORACLE. Eight letters of FNV-1a are 32
// bits, unsalted: anyone holding a list of candidates — every ticker in the
// app's universe, and every template below, since the list ships in this
// bundle — hashes each one and matches. Round 2 hashed the digit-masked TEXT,
// and a scan of the 3,640 universe tickers through every identifier template
// named 203,770 of 203,777 outputs uniquely: `(reading 'NVDA')` → `#lcdhlgeg`
// → NVDA. So a hash is computed only over a SKELETON in which every span that
// could hold a member's words is one fixed placeholder, REDACTED:
//   * a message that matched a template but refused a slot → the template's
//     id, its own words and its closed-set choices (`undefined|null`, the
//     optional full stop); EVERY slot is REDACTED, kept or refused alike;
//   * any other message → its SHAPE: every run of characters that is neither
//     whitespace nor STRUCTURAL punctuation is REDACTED.
// Two tickers in one shape are one hash, and a dictionary scan finds every
// candidate behind every hash. The server's own fallback hash applies the same
// rule; tests/test_client_errors.py pins its STRUCTURAL and REDACTED to these
// two literals.
export const REDACTED = "<id>"
export const STRUCTURAL = "'\"`()[]{}<>,;:"
const CONTENT_SPAN = new RegExp(`[^\\s${STRUCTURAL.replace(/[\\\]^-]/g, '\\$&')}]+`, 'g')

/** A message no template sends: its shape, every span that could carry a word REDACTED. */
function shapeSkeleton(text) {
  return `shape:${text.replace(CONTENT_SPAN, REDACTED)}`
}

// ── Paths ─────────────────────────────────────────────────────────────────

const ROUTE_WORD = /^[a-z]+(?:-[a-z]+)*$/
const ASSET_FILE = /^[\w.-]{1,120}\.(?:m?jsx?|cjs|tsx?|css|map|wasm|html?)$/
const TOKEN_ROUTES = [SHARED_NOTE_ROUTE, TRACK_RECORD_ROUTE, SHARED_SCREEN_ROUTE, SHARED_FORMULA_ROUTE]
  .map((route) => route.split('/'))

function forceTokenSegments(segs) {
  for (const route of TOKEN_ROUTES) {
    if (segs.length < route.length) continue
    let match = true
    for (let i = 0; i < route.length; i += 1) {
      if (!route[i].startsWith(':') && segs[i] !== route[i]) { match = false; break }
    }
    if (!match) continue
    for (let i = 0; i < route.length; i += 1) if (route[i].startsWith(':')) segs[i] = ':id'
  }
  return segs
}

/** A path, segment by segment: a lowercase digit-free route word survives,
 *  anything else is `:id`; a token-route position is `:id` whatever it looks
 *  like. `asset` also keeps a final static-asset file name (stack frames). */
export function reducePath(path, { asset = false } = {}) {
  if (typeof path !== 'string' || !path) return ''
  const segs = path.slice(0, MAX_PATH_INPUT).split('/')
  const last = segs.length - 1
  const out = segs.map((s, i) => {
    if (s === '' || ROUTE_WORD.test(s)) return s
    if (asset && i === last && ASSET_FILE.test(s)) return s
    return ':id'
  })
  return forceTokenSegments(out).join('/')
}

// ── URLs ──────────────────────────────────────────────────────────────────

const LINE_COL_OWN = /(:\d+(?::\d+)?)$/
const LINE_COL_AFTER = /(:\d+:\d+)$/
const SCRIPT_END = /\.(?:m?jsx?|cjs|tsx?|html?)$/i

/** Origin + reduced path (+ a script frame's :line:col). The query and the
 *  fragment go, whatever they hold; user info in the origin goes too. */
export function scrubUrl(url) {
  if (typeof url !== 'string' || !url) return ''
  if (url.slice(0, 5).toLowerCase() === 'data:') return 'data:[removed]'
  const sep = url.indexOf('://')
  let origin = ''
  let rest = url
  if (sep !== -1) {
    let end = url.length
    for (const ch of '/?#') {
      const i = url.indexOf(ch, sep + 3)
      if (i !== -1 && i < end) end = i
    }
    origin = url.slice(0, end)
    const at = origin.lastIndexOf('@')
    if (at > sep) origin = origin.slice(0, sep + 3) + origin.slice(at + 1)
    rest = url.slice(end)
  }
  let cut = rest.length
  for (const ch of '?#') {
    const i = rest.indexOf(ch)
    if (i !== -1 && i < cut) cut = i
  }
  let path = rest.slice(0, cut)
  const after = rest.slice(cut)
  let tail = ''
  const own = LINE_COL_OWN.exec(path)
  if (own && SCRIPT_END.test(path.slice(0, own.index))) {
    tail = own[1]
    path = path.slice(0, own.index)
  } else if (after && SCRIPT_END.test(path)) {
    const t = LINE_COL_AFTER.exec(after)
    if (t) tail = t[1]
  }
  return origin + reducePath(path, { asset: true }) + tail
}

const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isSchemeChar = (c) => isAlpha(c) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46
// whitespace ' " ( ) < >
const isUrlStop = (c) => c <= 32 || c === 34 || c === 39 || c === 40 || c === 41 || c === 60 || c === 62

/** Every scheme URL inside text, scrubbed. A LINEAR scan — find `://`, walk
 *  left over the scheme and right to the first stop character — because the
 *  regex form backtracks quadratically on a long run of letters. */
export function scrubUrlsInText(text) {
  if (typeof text !== 'string' || !text) return ''
  let out = ''
  let pos = 0
  let from = 0
  for (;;) {
    const i = text.indexOf('://', from)
    if (i === -1) break
    let s = i
    while (s > pos && isSchemeChar(text.charCodeAt(s - 1))) s -= 1
    while (s < i && !isAlpha(text.charCodeAt(s))) s += 1
    if (s === i) { from = i + 3; continue }
    let e = i + 3
    while (e < text.length && !isUrlStop(text.charCodeAt(e))) e += 1
    out += text.slice(pos, s) + scrubUrl(text.slice(s, e))
    pos = e
    from = e
  }
  return out + text.slice(pos)
}

// ── Message templates ─────────────────────────────────────────────────────
//
// A message is sent only when it FULLY matches one of these. They are the
// engines' own messages (V8, JavaScriptCore, SpiderMonkey), the browser's, and
// React's / ProseMirror's / the bundler's. Slots:
//   {id}   an identifier the engine names — kept only if code-shaped; anything
//          else REFUSES the template (see `codeShaped`)
//   {q}    '…'-quoted input · {qq} "…"-quoted input · {any} unquoted input — never sent
//   {url}  a URL — scrubbed (origin + reduced path); anything else is `…`
//   {n}    a number — `#`
//   {chunk} a bundler chunk id — `#` when numeric; anything else REFUSES the template
//   {alt:a|b} / {opt:text}  a closed set of literal text — kept as matched
// Every template also matches with one trailing full stop.

const TEMPLATE_SOURCES = [
  // ── V8 (Chrome, Edge, Node) ──
  ['cannot-read-properties', "Cannot read properties of {alt:undefined|null} (reading '{id}')"],
  ['cannot-set-properties', "Cannot set properties of {alt:undefined|null} (setting '{id}')"],
  ['cannot-read-property', "Cannot read property '{id}' of {alt:undefined|null}"],
  ['not-a-function', '{id} is not a function'],
  ['not-defined', '{id} is not defined'],
  ['not-a-constructor', '{id} is not a constructor'],
  ['not-iterable', '{id} is not iterable'],
  ['not-iterable-symbol', '{id} is not iterable (cannot read property Symbol(Symbol.iterator))'],
  ['not-async-iterable', '{id} is not async iterable'],
  ['access-before-init', "Cannot access '{id}' before initialization"],
  ['const-assignment', 'Assignment to constant variable.'],
  ['max-call-stack', 'Maximum call stack size exceeded'],
  ['invalid-array-length', 'Invalid array length'],
  ['invalid-time-value', 'Invalid time value'],
  ['convert-nullish', 'Cannot convert undefined or null to object'],
  ['convert-bigint', 'Cannot convert a BigInt value to a number'],
  ['destructure-property', "Cannot destructure property '{id}' of '{q}' as it is {alt:undefined|null}"],
  ['destructure-value', "Cannot destructure '{q}' as it is {alt:undefined|null}"],
  ['reduce-empty', 'Reduce of empty array with no initial value'],
  ['circular-json', 'Converting circular structure to JSON{any}'],
  ['json-unexpected-token', "Unexpected token '{q}', {any} is not valid JSON"],
  ['json-unexpected-token-position', 'Unexpected token {any} in JSON at position {n}'],
  ['json-end', 'Unexpected end of JSON input'],
  ['json-not-valid', '{any} is not valid JSON'],
  ['json-bad-control', 'Bad control character in string literal in JSON at position {n}'],
  ['json-bad-escape', 'Bad escaped character in JSON at position {n}'],
  ['syntax-unexpected-token', "Unexpected token '{q}'"],
  ['syntax-unexpected-identifier', 'Unexpected identifier'],
  ['syntax-unexpected-identifier-named', "Unexpected identifier '{q}'"],
  ['syntax-unexpected-end', 'Unexpected end of input'],
  ['syntax-invalid-token', 'Invalid or unexpected token'],
  ['syntax-unexpected-string', 'Unexpected string'],
  ['syntax-unexpected-number', 'Unexpected number'],
  ['syntax-missing-paren', 'missing ) after argument list'],
  ['invalid-regexp', 'Invalid regular expression: {any}'],
  ['failed-to-fetch', 'Failed to fetch'],
  ['dynamic-import', 'Failed to fetch dynamically imported module: {url}'],
  ['failed-to-execute', "Failed to execute '{id}' on '{id}': {alt:The node to be removed is not a child of this node.|The node before which the new node is to be inserted is not a child of this node.|parameter 1 is not of type 'Node'.|The database connection is closing.|The transaction has finished.|The transaction is not active.|A mutation operation was attempted on a database that did not allow mutations.|Illegal invocation}"],
  ['storage-quota', "Failed to execute 'setItem' on 'Storage': Setting the value of '{q}' exceeded the quota."],
  ['illegal-invocation', 'Illegal invocation'],
  // ── JavaScriptCore (Safari) ──
  ['jsc-cant-find-variable', "Can't find variable: {id}"],
  ['jsc-not-an-object', "{alt:undefined|null} is not an object (evaluating '{id}')"],
  ['jsc-not-a-function-in', "{id} is not a function. (In '{q}', '{id}' is {alt:undefined|null|an instance of Object})"],
  ['jsc-not-a-function-near', "{id} is not a function (near '{q}')"],
  ['jsc-not-a-constructor', "{id} is not a constructor (evaluating '{q}')"],
  ['jsc-readonly', 'Attempted to assign to readonly property.'],
  ['jsc-destructure', 'Right side of assignment cannot be destructured'],
  ['jsc-pattern', 'The string did not match the expected pattern.'],
  ['jsc-uninitialized', 'Cannot access uninitialized variable.'],
  ['jsc-json-parse', 'JSON Parse error: {any}'],
  ['load-failed', 'Load failed'],
  ['module-script', 'Importing a module script failed.'],
  // ── SpiderMonkey (Firefox) ──
  ['sm-is-undefined', '{id} is undefined'],
  ['sm-is-null', '{id} is null'],
  ['sm-cant-access-property', 'can\'t access property "{id}", {id} is {alt:undefined|null}'],
  ['sm-too-much-recursion', 'too much recursion'],
  ['sm-lexical-before-init', "can't access lexical declaration '{id}' before initialization"],
  ['sm-invalid-const', "invalid assignment to const '{id}'"],
  ['sm-no-properties', '{id} has no properties'],
  ['sm-cyclic', 'cyclic object value'],
  ['sm-json-parse', 'JSON.parse: {any} at line {n} column {n} of the JSON data'],
  ['sm-network-error', 'NetworkError when attempting to fetch resource.'],
  ['sm-dynamic-import', 'error loading dynamically imported module'],
  ['sm-dynamic-import-url', 'error loading dynamically imported module: {url}'],
  // ── The browser platform ──
  ['script-error', 'Script error.'],
  ['aborted', '{alt:The operation was aborted|The user aborted a request|signal is aborted without reason|This operation was aborted|Fetch is aborted}'],
  ['not-allowed', 'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.'],
  ['play-interrupted', 'The play() request was interrupted by {alt:a call to pause()|a new load request}'],
  ['quota-exceeded', 'The quota has been exceeded.'],
  ['clone-failed', '{any} could not be cloned.'],
  ['resize-observer-limit', 'ResizeObserver loop limit exceeded'],
  ['resize-observer-undelivered', 'ResizeObserver loop completed with undelivered notifications.'],
  ['extension-context', 'Extension context invalidated.'],
  ['idb-closing', 'The database connection is closing.'],
  ['idb-lost', 'Connection to Indexed Database server lost. Refresh the page to try again'],
  ['idb-aborted', 'The transaction was aborted, so the request cannot be fulfilled.'],
  ['idb-version-abort', 'Version change transaction was aborted in upgradeneeded event handler.'],
  ['idb-internal', '{alt:An internal error was encountered in the Indexed Database server|Internal error opening backing store for indexedDB.open.}'],
  ['idb-unrelated', 'The operation failed for reasons unrelated to the database itself and not covered by any other error code.'],
  // ── The bundler ──
  ['chunk-load', 'Loading chunk {chunk} failed. (error: {url})'],
  ['chunk-load-bare', 'Loading chunk {chunk} failed.'],
  ['css-chunk-load', 'Loading CSS chunk {chunk} failed. ({url})'],
  ['css-chunk-load-bare', 'Loading CSS chunk {chunk} failed.'],
  // Vite 7's own preload helper, `preload()` in node_modules/vite/dist/node/
  // chunks/config.js, emitted into this app's bundle: `dep` is base + the asset
  // path, so on the default base '/' it is root-relative and the slot is `…`.
  ['vite-preload-css', 'Unable to preload CSS for {url}'],
  // ── React ──
  ['react-minified', 'Minified React error #{n}; visit {url} for the full message{opt: or use the non-minified dev environment for full errors and additional helpful warnings}'],
  ['react-too-many-renders', 'Too many re-renders. React limits the number of renders to prevent an infinite loop.'],
  ['react-update-depth', 'Maximum update depth exceeded. {any}'],
  ['react-fewer-hooks', 'Rendered fewer hooks than expected. This may be caused by an accidental early return statement.'],
  ['react-more-hooks', 'Rendered more hooks than during the previous render.'],
  ['react-invalid-hook', 'Invalid hook call. {any}'],
  ['react-hydration', 'Hydration failed because {any}'],
  ['react-object-child', 'Objects are not valid as a React child (found: {any}). If you meant to render a collection of children, use an array instead.'],
  // ── ProseMirror / TipTap ──
  ['pm-position-range', 'Position {n} out of range'],
  ['pm-index-range', 'Index {n} out of range for {any}'],
  ['pm-invalid-content', 'Invalid content for node {id}: {any}'],
  ['pm-invalid-content-bare', 'Invalid content for node {id}'],
  ['pm-content-match', 'Called contentMatchAt on a node with invalid content'],
  ['pm-collapsed-range', 'Invalid collapsed range'],
  ['pm-mismatched-transaction', 'Applying a mismatched transaction'],
  ['pm-no-attr', 'No value supplied for attribute {id}'],
  ['pm-unknown-node', 'Unknown node type: {id}'],
  ['pm-no-node-type', 'No node type or group {id} found{any}'],
  // ── Made by buildReport itself ──
  ['non-error-value', 'non-error {alt:number|boolean|symbol|bigint|object|function|undefined} value'],
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const SLOT = /\{(id|q|qq|any|url|n|chunk|alt:[^}]*|opt:[^}]*)\}/g
const SLOT_RE = {
  // `(intermediate value).x` is V8's name for an unnamed receiver; any other
  // identifier slot is one run with no whitespace or quote in it.
  id: "(\\(intermediate value\\)[^\\s'\"]*|[^\\s'\"]+)",
  q: "([^']*)",
  qq: '([^"]*)',
  any: '(.*)',
  url: '(\\S+?)',
  n: '(\\d+)',
  chunk: '(\\S+?)',
}

function compileTemplate(id, src) {
  const parts = []
  const words = []
  let re = '^'
  let last = 0
  const lit = (s) => {
    re += escapeRe(s)
    parts.push({ lit: s })
    for (const w of s.split(/[^A-Za-z]+/)) if (w.length > 1) words.push(w)
  }
  SLOT.lastIndex = 0
  let m
  while ((m = SLOT.exec(src))) {
    lit(src.slice(last, m.index))
    const tok = m[1]
    if (tok.startsWith('alt:')) {
      re += `(${tok.slice(4).split('|').map(escapeRe).join('|')})`
      parts.push({ slot: 'keep' })
    } else if (tok.startsWith('opt:')) {
      re += `((?:${escapeRe(tok.slice(4))})?)`
      parts.push({ slot: 'keep' })
    } else {
      re += SLOT_RE[tok]
      parts.push({ slot: tok })
    }
    last = SLOT.lastIndex
  }
  lit(src.slice(last))
  // One trailing full stop is optional on every template, and kept as matched.
  if (!src.endsWith('.')) {
    re += '(\\.?)'
    parts.push({ slot: 'keep' })
  }
  re += '$'
  return { id, src, re: new RegExp(re), parts, words }
}

/** The template list, compiled. Exported so a rail can read its vocabulary,
 *  and fill each template's slots (`src`) the way an attacker would. */
export const TEMPLATES = TEMPLATE_SOURCES.map(([id, src]) => compileTemplate(id, src))

// An identifier slot is kept only when it is code (R1-4): V8's own
// `(intermediate value)` receiver, or a dot-separated path whose every part is
// ONE JS identifier — letters, digits and `_`, with `$` allowed only as the
// part's single leading character. No brackets, no hyphens, no other
// punctuation. Every part must hold a letter, and no part may read as a ticker
// or a cashtag (below).
const INTERMEDIATE = '(intermediate value)'
const ID_PART = /^\$?[A-Za-z_][A-Za-z0-9_]*$/
// With a leading `$` and trailing digits removed, 1-5 capitals read as a
// ticker (NVDA, NVDA1, BRK.B's B) and are not code worth the risk…
const TICKERISH = /^[A-Z]{1,5}$/
const CODE_CAPS = new Set(['URL', 'URI', 'JSON', 'CSS', 'DOM', 'HTML', 'SVG', 'XML', 'API', 'UI', 'IDB', 'ID', 'UUID', 'RTC', 'GPU', 'NaN'])
// …and a `$` before 1-5 letters of ANY case is a cashtag ($NVDA, $nvda).
const CASHTAG_BODY = /^[A-Za-z]{1,5}$/
// A chunk slot passes only a NUMERIC chunk id. This app's bundler (Vite) never
// emits "Loading chunk" at all — its dynamic-import failures are the browser's
// own "Failed to fetch dynamically imported module" / "Importing a module
// script failed." / "error loading dynamically imported module", and its CSS
// preload helper throws "Unable to preload CSS for <url>" (templated above as
// `vite-preload-css`). The webpack-shaped message
// can only come from a third party, and every sample of it in this repo is a
// number (utils/staleChunk.test.js "Loading chunk 42 failed"). So a name made
// of words — or of hex letters, which spell words too — refuses the template.
const CHUNK_ID = /^\d{1,12}$/

function codeShaped(value) {
  if (!value || value.length > 200) return false
  const parts = value.split('.')
  if (parts[0] === INTERMEDIATE) parts.shift()
  for (const part of parts) {
    if (!ID_PART.test(part)) return false
    const core = part.replace(/^\$/, '').replace(/\d+$/, '')
    if (!/[A-Za-z]/.test(core)) return false
    if (part[0] === '$' && CASHTAG_BODY.test(core)) return false
    if (TICKERISH.test(core) && !CODE_CAPS.has(core)) return false
  }
  return true
}

/** One slot, rendered — or null, which REFUSES the whole template. */
function renderSlot(kind, value) {
  const v = value || ''
  switch (kind) {
    case 'keep': return v
    case 'id': return codeShaped(v) ? v : null
    case 'url': return v.includes('://') ? scrubUrl(v) : '…'
    case 'n': return '#'
    case 'chunk': return CHUNK_ID.test(v) ? '#' : null
    default: return v ? '…' : ''          // input: never sent (an empty slot says nothing)
  }
}

const ERROR_NAME = /^[A-Z][A-Za-z]{0,58}(?:Error|Exception)$/
function safeName(name) {
  return typeof name === 'string' && (name === 'Error' || ERROR_NAME.test(name)) ? name : 'Error'
}

const UNCAUGHT = /^Uncaught (?:((?:[A-Z][A-Za-z]{0,58})?(?:Error|Exception)): )?/

/** A matched template with every slot REDACTED except its closed-set choices
 *  (an `{alt}`/`{opt}` word, the optional full stop) — the only skeleton a
 *  refused template is hashed as (S2-1). No slot's content can reach it. */
function templateSkeleton(t, m) {
  let out = `template:${t.id}:`
  let g = 1
  for (const p of t.parts) {
    if (p.lit !== undefined) { out += p.lit; continue }
    out += p.slot === 'keep' ? (m[g] || '') : REDACTED
    g += 1
  }
  return out
}

/** A message as it may leave the browser: a matched template, rendered, or
 *  `<Name>: <unrecognized #hash8>`. Returns `{message, template, name}`. */
export function scrubMessage(message, name = 'Error') {
  let resolved = safeName(name)
  if (typeof message !== 'string' || !message) return { message: '', template: 'empty', name: resolved }
  let text = message.slice(0, MAX_INPUT).replace(/\s+/g, ' ').trim()
  const u = UNCAUGHT.exec(text)
  if (u) {
    text = text.slice(u[0].length)
    if (u[1] && resolved === 'Error') resolved = safeName(u[1])
  }
  // An identifier or chunk slot that is not code refuses its template: the
  // message is then matched against the rest, and if nothing takes it, it
  // goes as the hash — never with a blanked slot inside the template's words.
  // ⛔ The hash is of the FIRST refused template's skeleton, or else of the
  // message's shape — never of the text (S2-1).
  let refused = null
  templates: for (const t of TEMPLATES) {
    const m = t.re.exec(text)
    if (!m) continue
    let out = ''
    let g = 1
    for (const p of t.parts) {
      if (p.lit !== undefined) { out += p.lit; continue }
      const r = renderSlot(p.slot, m[g])
      g += 1
      if (r === null) {
        refused = refused || templateSkeleton(t, m)
        continue templates
      }
      out += r
    }
    return { message: maskDigits(out).slice(0, MAX_MESSAGE), template: t.id, name: resolved }
  }
  const hash = shortHash(refused || shapeSkeleton(text))
  return { message: `${resolved}: <unrecognized #${hash}>`, template: `#${hash}`, name: resolved }
}

// ── Stacks ────────────────────────────────────────────────────────────────

// A frame is recognised by its SHAPE, strictly.
//   V8:       "    at fn (url:1:2)" · "    at url:1:2" · "    at <anonymous>" · "    at Promise.all (index 0)"
//   JSC/SM:   "fn@url:1:2" · "global code@url:1:2" · "url:1:2" · "fn@[native code]"
//   React:    "    at NoteCard (url:1:2)" · "    at div" · "    in div (created by X)"
// A location must be a real scheme URL (it contains `://`) — or, under Node
// and a test runner, an absolute filesystem path — so "NVDA:132:140" or
// "10:30:45" is never mistaken for one.
const URLISH = '(?:[A-Za-z][\\w+.-]*:)+\\/\\/\\S+'
const FSPATH = '(?:[A-Za-z]:)?[\\/\\\\]\\S+'
const V8_LOC = `(?:<anonymous>|native|index \\d+|${URLISH}|${FSPATH})`
const V8_FN = '(?:async |new )?[\\w$.<>\\[\\]]+(?: \\[as [\\w$]+\\])?'
const V8_FRAME = new RegExp(`^ {4}at (?:${V8_FN} \\(${V8_LOC}\\)|(?:async )?${V8_LOC})\\s*$`)
const JSC_FN = '[\\w$.<>\\/*\\[\\]-]+(?: [\\w$.<>\\/*\\[\\]-]+)?'
const JSC_FRAME = new RegExp(`^(?:(?:${JSC_FN})?@(?:${URLISH}|\\[native code\\])|${URLISH})\\s*$`)
const REACT_FRAME = new RegExp(`^\\s*(?:at|in) [\\w$.<>\\[\\]]+(?: \\((?:created by [\\w$.]+|${URLISH}|${FSPATH}|<anonymous>)\\))?\\s*$`)
// An absolute filesystem path in a frame, after the URLs have been scrubbed:
// it is reduced segment by segment like any other path.
const FS_PATH_IN_FRAME = /(^|[\s(@])((?:[A-Za-z]:)?[/\\][^\s()<>'"]*)/g

function scrubFrameLine(line) {
  return scrubUrlsInText(line)
    .replace(FS_PATH_IN_FRAME, (_m, lead, path) => lead + scrubUrl(path.replace(/\\/g, '/')))
}

/** Frame lines only (any other line is dropped), URL-scrubbed, digits masked.
 *  `exclude` is a set of trimmed lines never to keep — the message's own
 *  lines, so a message line shaped like a frame cannot pass as one. */
export function scrubStack(stack, max = MAX_STACK, { react = false, exclude = null } = {}) {
  if (typeof stack !== 'string' || !stack) return ''
  const lines = []
  for (const line of stack.slice(0, 2 * max).split('\n')) {
    if (exclude && exclude.has(line.trim())) continue
    const isFrame = V8_FRAME.test(line) || JSC_FRAME.test(line) || (react && REACT_FRAME.test(line))
    if (!isFrame) continue
    lines.push(maskDigits(scrubFrameLine(line)).slice(0, MAX_FRAME))
  }
  return lines.join('\n').slice(0, max)
}

/** V8 starts a stack with `Name: message`, and the message may span lines.
 *  Cut that header off, whatever name it was written with. A plain prefix
 *  compare on the WHOLE stack — no pattern runs, so it costs nothing however
 *  long the message — and it runs first, so a long message cannot push the
 *  real frames out of the capped window. */
function cutHeader(stack, name, message) {
  if (!stack) return ''
  for (const head of [message ? `${name}: ${message}` : name, message ? `Error: ${message}` : 'Error']) {
    if (head && stack.startsWith(head)) return stack.slice(head.length)
  }
  return stack
}

function messageLines(message) {
  if (!message || message.indexOf('\n') === -1) return null
  const set = new Set()
  for (const l of message.slice(0, MAX_STACK_INPUT).split('\n')) {
    const t = l.trim()
    if (t) set.add(t)
  }
  return set
}

function extract(thrown) {
  let name = 'Error'
  let message = ''
  let stack = ''
  if (thrown instanceof Error || (thrown && typeof thrown === 'object' && 'message' in thrown)) {
    name = typeof thrown.name === 'string' ? thrown.name : 'Error'
    message = typeof thrown.message === 'string' ? thrown.message : ''
    stack = typeof thrown.stack === 'string' ? thrown.stack : ''
  } else if (typeof thrown === 'string') {
    message = thrown
  } else if (thrown !== undefined) {
    message = `non-error ${typeof thrown} value`
  }
  return { name, message, stack }
}

function fromRaw(raw, { kind = 'error', componentStack, loc } = {}) {
  const m = scrubMessage(raw.message, raw.name)
  const where = loc || (typeof window !== 'undefined' ? window.location : null)
  const pathname = where && typeof where.pathname === 'string' ? where.pathname : ''
  const exclude = messageLines(raw.message)
  return {
    kind: KINDS.has(kind) ? kind : 'error',
    name: m.name,
    message: m.message,
    template: m.template,
    stack: scrubStack(cutHeader(raw.stack, raw.name, raw.message), MAX_STACK, { exclude }),
    componentStack: scrubStack(typeof componentStack === 'string' ? componentStack : '', MAX_COMPONENT_STACK, { react: true, exclude }),
    page: reducePath(pathname).slice(0, MAX_PAGE),
    ts: Date.now(),
  }
}

/** One report, built from whatever was thrown. Pure: the rails read it. */
export function buildReport(thrown, extra = {}) {
  return fromRaw(extract(thrown), extra)
}

// ── Batching by bytes ─────────────────────────────────────────────────────

function utf8Length(s) {
  let n = 0
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1 }
    else n += 3
  }
  return n
}

const ENVELOPE_BYTES = utf8Length('{"reports":[]}')

/** Take reports off the front of `queue` while the POST body they make stays
 *  under MAX_BATCH_BYTES (and BATCH_MAX). A report too big to send alone is
 *  dropped — it could never be delivered. Mutates `queue`. */
export function takeBatch(queue) {
  const batch = []
  let bytes = ENVELOPE_BYTES
  while (queue.length && batch.length < BATCH_MAX) {
    const size = utf8Length(JSON.stringify(queue[0])) + (batch.length ? 1 : 0)
    if (bytes + size > MAX_BATCH_BYTES) {
      if (!batch.length) { queue.shift(); continue }
      break
    }
    batch.push(queue.shift())
    bytes += size
  }
  return batch
}

// ── The beacon ────────────────────────────────────────────────────────────

function dedupeKey(kind, raw, componentStack) {
  const cs = typeof componentStack === 'string' ? componentStack : ''
  return [kind, raw.name, raw.stack.slice(0, 2000), raw.message.slice(0, MAX_MESSAGE), cs.slice(0, 1000)]
    .map(maskDigits).join('|')
}

export function createErrorBeacon({ fetchImpl, sendBeaconImpl, now, win } = {}) {
  const clock = now || (() => Date.now())
  const state = { sent: 0, builds: 0, disabled: false, queue: [], lastSeen: new Map(), timer: null, busy: false }
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
    while (state.queue.length && !state.disabled) {
      const batch = takeBatch(state.queue)
      if (batch.length) post(batch)
    }
  }

  function flushWithBeacon() {
    if (!state.queue.length || state.disabled) return
    const w = getWin()
    const send = sendBeaconImpl || (w?.navigator?.sendBeacon ? w.navigator.sendBeacon.bind(w.navigator) : null)
    while (state.queue.length) {
      const batch = takeBatch(state.queue)
      if (!batch.length) continue
      let ok = false
      try {
        const body = new Blob([JSON.stringify({ reports: batch })], { type: 'application/json' })
        ok = send ? send(BEACON_URL, body) === true : false
      } catch { ok = false }
      if (!ok) post(batch)
    }
  }

  /** Queue one report. Returns the report, or null when it was not queued.
   *  Every cheap check — the cap, the cross-origin case, the dedupe — runs
   *  BEFORE the report is built, so a loop of one error builds it once. */
  function report(thrown, extra = {}) {
    if (state.busy || state.disabled) return null
    state.busy = true
    try {
      if (state.sent >= MAX_PER_PAGE) return null
      const raw = extract(thrown)
      if (raw.message === 'Script error.' && !raw.stack) return null   // cross-origin, no detail
      const kind = KINDS.has(extra.kind) ? extra.kind : 'error'
      const key = dedupeKey(kind, raw, extra.componentStack)
      const t = clock()
      const last = state.lastSeen.get(key)
      if (last !== undefined && t - last < DEDUPE_MS) return null
      state.lastSeen.set(key, t)
      state.builds += 1
      const r = fromRaw(raw, { ...extra, kind, loc: getWin()?.location })
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
