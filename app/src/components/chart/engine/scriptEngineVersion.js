// app/src/components/chart/engine/scriptEngineVersion.js
//
// ─── ⭐⭐ THE SCRIPT ENGINE'S VERSION — ONE NUMBER, ONE PLACE ─────────────────
//
// A member's saved Pine script is stored as the TRANSLATED document the engine
// produced on the day they saved it (`compute.*`, `objects`, `meta.blockRuns`, …)
// plus — since this module — the script itself, in its own server column
// (`api/services/user_definitions.py::MAX_PINE_SOURCE_BYTES`). This number is
// stamped on every document a SCRIPT door writes (`meta.engineVersion`), so a
// later browser can tell "translated by an older engine" from "current" without
// translating anything.
//
// ⛔⛔ WHEN TO BUMP IT — and this is the whole contract:
//   Bump `SCRIPT_ENGINE_VERSION` by one in the SAME commit as any engine change
//   that alters what the translator WRITES for an unchanged script: a value it
//   now computes differently, a plot it now withholds or refuses (C45/C48's
//   `blockRuns` are the model), a new stamp a reader depends on. A change that
//   only alters how an EXISTING document is drawn needs no bump — every chart
//   already draws it with today's code.
//   What a bump does: on each member's next chart load, every saved script
//   document stamped below it that holds its source is re-translated ONCE in the
//   browser, drawn from the new translation, and written back through the
//   ordinary revision-guarded save (`savedScriptUpgrade.js`). The next load sees
//   the new stamp and does no work. Documents saved without their source get the
//   one quiet "Updated accuracy available" row in their legend menu instead.
//   ⛔ Never bump it for a change that does not move translator output: every
//   bump costs one translation + one write per saved script per member.
//
// ⛔⛔ ENGINE BUMP RUNBOOK — read before AND after every bump.
//   • ⭐ BUMP ONE NUMBER: this one. The server (the alert/scan/backtest lanes have no
//     browser to ask) READS this declaration (`user_definitions.read_script_engine_version`;
//     keep it `export const SCRIPT_ENGINE_VERSION = <n>` on one line — any other shape
//     reads as unreadable, and unreadable fails CLOSED: every recorded refusal binds).
//     ⛔ Do not add a server literal back: that is the drift this replaced.
//   • A TRANSLATOR REGRESSION CAN MARK GOOD SCRIPTS 'refused' SERVER-SIDE. A browser
//     running the bumped engine records each refusal (`definition_engine_status`, with
//     the engine number that refused), and every server lane — alerts, scans, backtests —
//     then WITHHOLDS that definition by name, for every device. A save that does not come
//     from the script path (stamped >= the refusing engine, script attached) CARRIES the
//     refusal to the new version, refusing engine and all; so do a fork, a share install
//     and a delete/resurrect.
//   • A VERDICT (RECORDED OR CARRIED) BINDS ONLY WHILE ITS ENGINE IS TODAY'S. Browser
//     (`savedScriptUpgrade.upgradeKindOf`) and server (`engine_withheld_reason`) answer
//     identically once this number moves past it:
//       – a version that HOLDS its script stays held until today's engine re-answers: the
//         member's next chart load re-translates it (accepted → written back from the
//         script path, lifted; refused → a new verdict at today's number);
//       – a version WITHOUT its script (a studio / Formula hand edit of a refused script,
//         a share-installed copy) EXPIRES and runs as stored ONLY WHEN ITS MATHS DIFFERS
//         from the refused maths (the server's `same_maths`, from the store's maths
//         identity). A no-op Undo, a presentation-only studio save or a share install
//         carries the refused calculation unchanged and STAYS HELD until it is saved from
//         a script today's engine accepts. Chosen over carrying the script forward:
//         re-translating the ancestor's script would overwrite the member's hand edit
//         (the L2 rule — a hand edit is the member's own maths).
//       – a `write-failed` (the store refused the write-back, e.g. a 422 repaint ack)
//         NEVER clears an older refusal: the alerts keep withholding the stored maths and
//         the chart draws today's translation, without PUTting it again, and offers the
//         Builder.
//   • ⛔ A SCRIPT-HOLDING VERSION WHOSE MEMBER NEVER OPENS A CHART STAYS WITHHELD
//     SERVER-SIDE INDEFINITELY. Only a chart load re-translates it; until then every
//     alert, scan and backtest on it is withheld by name. Nothing on the server re-asks.
//     Owner follow-up, not built: "server-side upgrade for members who never open a
//     chart" (re-translate in the pod with the shipped translator, or notify the member).
//   • RECOVERY IS TO SHIP ANOTHER BUMP (the fixed translator with this number + 1). Every
//     refused script is re-asked on its next chart load (see the bullet above for a
//     member who never opens one), and every scriptless carry whose maths differs from
//     the refused maths expires.
//   • AFTER EVERY BUMP, CHECK THE REFUSED COUNT: in the web pod, against
//     user_definitions.db, `SELECT engine, COUNT(*) FROM definition_engine_status WHERE
//     status='refused' GROUP BY engine` — a jump on the new engine is a regression signal,
//     not a population of bad scripts. (Read-only; never DELETE from that table — the
//     next bump is the fix.)
//
// ⛔ IT IS NOT `memberDocumentMigration.DOOR_VERSION`. That number versions the
// band-opacity RULE a door applied (its rule table must carry an entry per
// version, railed), and a document's bytes can be repaired from it without the
// script. This one versions the TRANSLATOR as a whole and can only be acted on
// with the script in hand. Two questions, two numbers.

/** 1 = the first stamped engine (C45/C48 `blockRuns` withholding is in it). */
/** 2 = the first real bump (2026-11-02): saved scripts re-translate once with every engine
 *  change merged since 1 was stamped (#610), now that refusals are remembered (#673). */
/** 3 = P3 WS-A: the C18 object door refuses by name the master-wrong block shapes (readSelf,
 *  v6 unmatched bool, moved for-bound, continued switch arms). */
/** 4 = the plot lane withholds a var filled from a ta.* call in a block that skips (C48);
 *  a function reading a var written later is refused; hiding colours withhold the whole output. */
/** 5 = W1: Pine v4-v6 builtin names and lookback reads (#736). */
/** 6 = W4 T4: a v6 root `?:` arm with sma/ema/rma/change runs only when chosen; a `?:` off the
 *  column route no longer steps unchosen arms every bar (now refused by name). */
/** 7 = W4-T3 (train): session/timeframe text fixed before bar 0 (own timeframe via a parameter, joined texts, an unreassigned var) is served on the runtime lane */
/** 8 = W3 (train): refusals name their text shape; a {N} message number that rounds across a digit (999.9996 -> 1000) is withheld */
/** 9 = W4-T7 (train): an expression's own series inside a function body (per call site) is served instead of refused */
/** 10 = W4-T2 (train): simple-qualifier folding (reassignment under an invariant test, an unreassigned var, arithmetic over an input) serves values where it refused */
/** 11 = W4-T9 (train): offsets bounded by simple values and frame parameters are served */
/** 12 = W4-T8 (train): series int window lengths (v5 and v6) are served on the runtime lane */
/** 13 = W4-T10 (train): state kernels over runtime values (ta.cum, 3-arg pivothigh/low, ta.stoch, ta.vwap(source)) are served */
/** 14 = W4-T11 (train): runtime text values are served on the runtime lane */
/** 15 = W4-T12 (train): paint typing: colours proven through blocks, functions and colour arrays; fill() over a ?:-chosen plot id */
/** 16 = W4-T13 (train): plotcandle / plotbar are served (OHLC payload from four columns; colours a call omits stay withheld) */
/** 17 = W4-T15 (train): function and statement forms (named/default user args, one-line binding bodies, loop-end values, log.* statements) are served on the runtime lane */
/** 18 = W6-T3a: one static type descriptor per value; runtime lane serves matrix./map. method forms and some former refusals */
/** 19 = W6-T2: v3/v4 `method` is a callable name and keyword misreads are refused by name rather than served */
/** 20 = W6-T6: `for … in` over arrays and line/box/label.all is served on the runtime lane (one shared walk rule) */
/** 21 = W6-T5: array.* reference-formula members are served on the runtime lane; unpinned conventions are refused by name */
/** 22 = W34-I6a: a `switch` arm that wraps onto a continuation line is served on the runtime lane; an arm mixing wrap and block lines is refused by name */
/** 23 = W34-I4b: a v1/v2 (or no-pragma) self-reference's bar 0 on a run from the listing is withheld unless both seeds (na, 0) agree, not guessed */
/** 24 = W34-I4: a v1/v2 self-referencing definition whose every self read is `nz(x[k])` runs as a slot on the runtime lane instead of refusing `pine:state` */
export const SCRIPT_ENGINE_VERSION = 24

/** The meta key the stamp lives under. `defSchema` keeps unknown `meta` keys
 *  (ignore-and-preserve), and it sits outside every tree, so no hash moves. */
export const ENGINE_STAMP_KEY = 'engineVersion'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The engine version a document was translated by, or null when unstamped. */
export function engineStampOf(def) {
  const m = def && isObj(def.meta) ? def.meta : null
  const v = m ? m[ENGINE_STAMP_KEY] : undefined
  return Number.isInteger(v) && v >= 1 ? v : null
}

/** Was this document translated by an engine older than `current`?
 *  An unstamped document counts as older than every engine. */
export function isStaleStamp(def, current = SCRIPT_ENGINE_VERSION) {
  const s = engineStampOf(def)
  return s === null || s < current
}

/** The document stamped with `version` (today's engine by default). */
export function withEngineStamp(def, version = SCRIPT_ENGINE_VERSION) {
  if (!isObj(def)) return def
  return { ...def, meta: { ...(isObj(def.meta) ? def.meta : {}), [ENGINE_STAMP_KEY]: version } }
}

/** The document WITHOUT the stamp — for every door that is not a script door.
 *  ⛔ A hand-edited document must never claim to be the translator's output: the
 *  Formula tab carries the stored row's `meta` through an edit
 *  (`objectProgramCarry.carryProgramMeta`), and a carried stamp would tell the
 *  next engine "current" about maths the member changed. The same object back
 *  when there is nothing to strip. */
export function withoutEngineStamp(def) {
  if (!isObj(def) || !isObj(def.meta) || !(ENGINE_STAMP_KEY in def.meta)) return def
  const meta = { ...def.meta }
  delete meta[ENGINE_STAMP_KEY]
  return { ...def, meta }
}

/** ⛔ L6 — the store's cap on a stored script (`api/services/user_definitions.py
 *  ::MAX_PINE_SOURCE_BYTES`, pinned equal by `tests/test_saved_script_prebump.py`).
 *  A script over it is never sent: the store would refuse the whole request. */
export const PINE_SOURCE_MAX_BYTES = 256 * 1024

/** Does this script fit the store's cap, measured in UTF-8 bytes as the store does? */
export function withinPineSourceCap(source) {
  if (typeof source !== 'string') return false
  try { return new TextEncoder().encode(source).length <= PINE_SOURCE_MAX_BYTES } catch { return source.length * 4 <= PINE_SOURCE_MAX_BYTES }
}
