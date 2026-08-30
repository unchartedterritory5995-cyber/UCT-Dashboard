// ─── THE thinkScript READER — A THIRD SURFACE LANGUAGE, ONE CANONICAL TREE ───
//
// A member who has spent five years in thinkorswim types
// `def x = Average(close, 50); plot scan = close > x;`. This file is how that
// reaches the same engine `sma(close, 50)` reaches: it produces the SAME
// canonical tree `parse.js` produces, so the chart, the scan and the alert all
// get the object they already share, and the budget, the repaint linter and the
// read-back all decide about it unchanged.
//
// ⭐ IT IS `pine.js`'s SHAPE, NOT ITS COPY. This module IMPORTS `printFormula`
// and `treeYieldsBool` from `pine.js` — one printer, one round-trip, one
// `yields` reader — and `closedTable.json` stays the only list of what a formula
// may call. Every engine name this module emits is LOOKED UP in the table at
// translation time (`TABLE.series` today, `TABLE.functions` from W3.4); a token
// whose engine name the table does not declare refuses BY NAME rather than
// resolving to something this file believes.
//
// ✅ THOSE IMPORTS LANDED WITH THIS TASK, WHICH IS THE ONE THAT FIRST HAS A TREE
// TO PRINT. W3.2 deliberately shipped without them ("built, tested, green and
// unreachable" is the shape this repo keeps paying for); the wiring arrives now
// that there is a formula to print and a round trip to verify.
//
// ⛔ WHAT THIS TRANSLATOR WILL NOT DO: guess a proprietary formula. thinkorswim
// publishes the maths for `Average`, `ExpAverage`, `WildersAverage`, `StDev`,
// `TrueRange`, `Highest`/`Lowest`, `Log`, `within`, `between` and
// `CompoundValue`, and every one of those will be mapped by an IDENTITY quoted
// at its call shape. It publishes no formula for `TTM_Squeeze` or for a study's
// undeclared defaults, and those refuse at their token with the reason. A silent
// mistranslation is far worse than a refusal: the member gets a chart that looks
// right and is wrong.
//
// ⚠️ ONE CONVENTION IS OURS AND IS SAID OUT LOUD: the reference defines
// `crosses above` only as *"tests if value1 gets higher than value2"*, while
// this engine's `crossOver(a, b)` is `a > b && a[1] <= b[1]` (interpret.js).
// The strict/non-strict edge on the PRIOR bar is therefore this engine's
// reading, not a quoted one, and the read-back says `crossing above` so a member
// sees which function they got.
//
// ⏳ WHAT IT READS TODAY (W3.5): the LEXER, the STATEMENT READER, the
// EXPRESSIONS and the FUNCTION MAP.
// `declare`, `input`, `def`/`rec`, a forward declaration and its
// later assignment, `plot` (quoted names included) and a bare condition all
// read; the expression grammar is ONE binding-power loop over `TS_PRECEDENCE`
// below — thinkorswim's OWN published 12-level operator table, copied row for
// row — covering numbers, the five bar fields, the arithmetic and comparison
// operators in BOTH their symbol and their word spellings, `and`/`or`/`not`,
// `if … then … else`, `[n]`, the `Double.*` constants, `between`,
// `within N bars`, `crosses [above|below]` and `%`.
//
// ⭐ THE FUNCTION MAP LANDED IN W3.5 — `TS_CALL_SHAPES` below, one entry per
// PUBLISHED identity, each carrying the quotation it was read from. With it come
// `MovingAverage`'s enum dispatch, `TrueRange`'s published expansion, `ATR`'s
// averaging convention and `CompoundValue` → the bounded accumulator. Every
// OTHER call still refuses `thinkscript:function` AT ITS NAME rather than
// resolving to a neighbour — INCLUDING names this engine has a function for.
// `TS_UNCITED` records those by name with the reason, because
// ⛔⛔ THERE IS NO NAME-COLLISION FALLBACK IN THIS DOOR, AND THAT IS A RULING.
// `pine.js` maps any `ta.<name>` onto the table because Pine's namespace makes
// it unambiguous; thinkScript has none, and `MACD(12, 26, 9)` — a study call
// with fast 12 / slow 26 / signal 9 — would become the MACD OF THE NUMBER 12.
// That parses, prints, round-trips and saves.
// `thinkscript.corpus.test.js` pins where all 24 real published studies in
// `tests/fixtures/thinkscript/` now land, so every later task's gain stays a
// fact rather than a claim.
//
// SOURCES for the language (read 2026-08-25, toslc.thinkorswim.com; the pages
// are Schwab's and are quoted, never copied):
//   * Reserved words — /center/reference/thinkScript/Reserved-Words/{within,between,rec,crosses,reference}
//   * Functions — /center/reference/thinkScript/Functions/{Tech-Analysis,Others,Statistical,Math---Trig}/…
//   * Studies — /center/reference/Tech-Indicators/studies-library/…
//   * Tutorials — /center/reference/thinkScript/tutorials/{Basic,Advanced}/…

import { TABLE, parseFormula, astHash, TICKER_SHAPE } from './parse.js'
// ⭐ THE INTERPRETER'S OWN CEILING ON `self[k]`, ASKED RATHER THAN RESTATED — the
// same import `pine.js` takes, and for the same reason its docblock gives: a door
// that restates the number translates a tree the engine then refuses at
// evaluation, which is a refusal at a door the member never typed at.
import { MAX_SELF_LAG } from './interpret.js'
import {
  printFormula, treeYieldsBool, forgetsItsSeed, seedAndUpdateOf, containsFreeSelfSeries,
  derivedSeriesTree,
} from './pine.js'

/** guard → the sentence it always refuses with. CLOSED, and closed in two places
 *  that fail differently: `thinkscript.test.js` derives the guard strings from
 *  this module's own source and fails on any absent here, and the constructor
 *  below rejects one arriving from another module at runtime — which no regex
 *  over this file could ever see. This table stays the single authority; both
 *  rails read it.
 *
 *  Every sentence is pairwise-disjoint from the other six declared tables in the
 *  engine (`pine`, `pcf`, `parse`, `interpret`, `budget`, `sentence`) in BOTH
 *  directions, because a gate that checks a refusal by its words can otherwise
 *  keep passing with the safety it was watching deleted. */
export const REFUSALS = Object.freeze({
  'thinkscript:empty':
    'there is no thinkScript here to translate',
  'thinkscript:unsupported':
    'this part of thinkScript is not read by the translator yet',
  'thinkscript:character':
    'thinkorswim has no character like this one',
  'thinkscript:syntax':
    'this thinkScript line does not end where a statement has to end',
  'thinkscript:statement':
    'this thinkScript line is not a shape the translator reads',
  'thinkscript:builtin':
    'this thinkorswim name has no home in this engine grammar',
  'thinkscript:function':
    'this engine declares no function for that thinkorswim call',
  // ⛔ THE SENTENCE HAS TO BE TRUE OF EVERY CASE THAT CARRIES IT. This read "was
  // handed a different number of arguments than it takes" and FOUR different
  // failures reach it — a real count error, a missing parameter with no published
  // default, a named argument written twice, and a positional landing on a slot a
  // name already took. For the last three the member had handed EXACTLY the
  // declared number, so the sentence told them to go and count arguments that were
  // already right (W3.5 review). Each case now appends its own reason; this line is
  // only the half they all share.
  'thinkscript:arity':
    'that thinkorswim call\'s arguments do not fill the parameters it declares',
  'thinkscript:window':
    'a length here has to be a written whole number before a screen can budget it',
  'thinkscript:named-argument':
    'that argument name is not one the called thinkorswim function declares',
  'thinkscript:undefined':
    'this name is used before anything in the script gives it a value',
  'thinkscript:cycle':
    'these thinkorswim names are defined in terms of each other with no way in',
  'thinkscript:type':
    'this thinkorswim value is not a number a column can hold',
  'thinkscript:offset-literal':
    'a bar index has to reduce to a written whole number',
  'thinkscript:future-offset':
    'a negative bar index reads a bar that has not happened, and a closed-bar engine cannot',
  'thinkscript:state':
    'this value carries forward from bar to bar in a way the bounded accumulator cannot hold',
  'thinkscript:block':
    'this thinkorswim block spans several statements and this engine stores a single expression',
  // ⚰️⚰️ THESE TWO SENTENCES USED TO DENY CAPABILITIES THIS ENGINE SHIPS.
  // They read "a second aggregation period reads bars of another size than the
  // ones being screened" and "another ticker inside one column is outside what a
  // single screened value reads". Both are false: the grammar declares `tf` and
  // `sym`, the PINE door emits both, and the scan gate already limits `sym` to
  // the benchmark roster. What is missing is the TRANSLATION at this door — not
  // the node, not the evaluator, not the gate.
  // ⛔ A REFUSAL THAT NAMES A MISSING CAPABILITY INSTEAD OF A MISSING TRANSLATION
  // IS HOW A FIXABLE SCRIPT GETS ABANDONED, and it is how three of these sat
  // unexamined: `ta.highestbars` and the displaced plot were both recovered this
  // week purely by re-reading a refusal's own last sentence against what the
  // table already held.
  'thinkscript:aggregation':
    'this door does not yet fold a second aggregation period onto the engine\'s '
    + 'higher-timeframe read. The `tf` node exists and serves weekly and monthly '
    + 'from daily bars; what is missing is this translation',
  'thinkscript:symbol':
    'this door does not yet fold another ticker onto the engine\'s cross-symbol '
    + 'read. The `sym` node exists, the Pine door emits it, and the scan gate '
    + 'limits it to the benchmark roster; what is missing is this translation',
  'thinkscript:strategy':
    'placing an order is a backtest instruction and answers with no value to filter on',
  'thinkscript:account':
    'this reads your own position, which is a fact about your account and not about the stock',
  // ⚰️ ALSO FALSE AS WRITTEN: it said "a session clock reading is outside the
  // bar fields this engine keeps". The manifest declares THIRTEEN clock fields
  // and the Pine door binds them.
  // ⚠️ BUT THE HAZARD IS REAL AND WORTH NAMING RATHER THAN HIDING: thinkorswim's
  // `GetTime()` is MILLISECONDS since the epoch and this engine's `time` is
  // SECONDS — the single entry in Pine's own clock-mismatch table. A translation
  // that lines those up wrongly is off by a factor of a thousand and looks
  // plausible, so the mapping has to be written per function, not assumed.
  // ✅ INVESTIGATED IN FULL, AND THE ANSWER IS THAT THIS STAYS REFUSED — recorded
  // here so nobody re-opens it without the three findings that closed it.
  //
  // The engine is NOT short of clock fields: the manifest declares thirteen, and
  // `hour`/`minute` are documented as NEW YORK TIME, which is the same clock
  // thinkorswim's regular session is defined in. So `getTime() <
  // RegularTradingStart(getYYYYMMDD())` LOOKS like `hour < 9 || (hour == 9 &&
  // minute < 30)`. Three separate things make that wrong:
  //
  // ⛔ 1. UNITS. `GetTime()` is MILLISECONDS; this engine's `time` is SECONDS.
  //    A factor of a thousand is invisible in the output — every comparison still
  //    returns a clean 0 or 1, just always the same one.
  // ⛔ 2. EARLY CLOSES. `RegularTradingEnd` is 13:00 ET on roughly nine days a
  //    year, not 16:00. A hardcoded 16:00 is right ~96% of the time, which is the
  //    worst possible failure shape: it reads as working.
  // ⛔ 3. THE SCREEN IS DAILY. Both corpus scripts that reach this guard are
  //    INTRADAY session logic — `15-scan-premarket-gap-up` says so in its own
  //    header ("Run Scan at premarket on one minute aggregation") — and a
  //    session-relative test has no meaning on a daily bar. Translating it would
  //    hand a member a column that computes, and answers about nothing.
  //
  // ⭐ SO THIS IS A CORRECT REFUSAL, NOT A MISSING TRANSLATION, and that is a
  // different sentence from the one this guard used to carry ("a session clock
  // reading is outside the bar fields this engine keeps"), which was false.
  'thinkscript:time':
    'this reads the session clock, which only means something on intraday bars — '
    + 'a daily screen has no session to be inside. \u26a0\ufe0f Two further walls sit '
    + 'behind that one: `GetTime()` is in milliseconds while this engine\'s '
    + '`time` is in seconds, and `RegularTradingEnd` is 13:00 on an early-close '
    + 'day rather than 16:00, so neither can be assumed',
  // ⚰️⚰️ THE STEM SAID "whose FORMULA thinkorswim does not publish", AND THAT IS
  // TRUE OF EXACTLY ONE OF THE FIVE STUDIES IT IS PRINTED WITH. Measured: RSI,
  // BollingerBands, MovAvgExponential and SimpleMovingAvg all say "publishes no
  // DEFAULT …"; only TTM_Squeeze says "publishes no FORMULA … at all".
  //
  // ⛔ AND THE TWO ARE NOT THE SAME KIND OF WALL, WHICH IS THE WHOLE COST. An
  // unpublished DEFAULT is a number sitting on the member's own thinkorswim
  // screen — answerable, and each of those four tails already names the exact
  // parameter and what to write instead. Unpublished MATHS is answerable by
  // nobody. Collapsing them told four members their study was unreconstructable
  // when what was missing was one value they could read off in a second.
  //
  // ⭐ SO THE STEM SITUATES AND THE TAIL DECIDES. The specific tails were always
  // right; only the sentence they were printed under was wrong.
  'thinkscript:study-ref':
    'this names another thinkorswim study, and what thinkorswim leaves unpublished '
    + 'about it is named below',
  'thinkscript:fold':
    'a fold loop repeats an expression, and this engine stores one expression rather than a program',
  'thinkscript:no-output':
    'nothing in this script offers a value a screen could read',
  'thinkscript:roundtrip':
    'the translated text did not read back as the same tree, so nothing is offered',
  'thinkscript:input-kind':
    'this input has no default this translator can freeze it at',
  'thinkscript:enum-arm':
    'this is not one of the choices the thinkorswim input declares',
  'thinkscript:offset-chained':
    'a second bar offset on one value names a bar that a single offset already names',
})

/** ⭐ A NOTE IS NOT A REFUSAL, AND IT GETS ITS OWN CLOSED TABLE. What `ignored[]`
 *  carries is the opposite of a refusal: a line this translator DID read and
 *  deliberately left out of the column, recorded so the member can see it was
 *  seen. Putting these codes in `REFUSALS` would have made "how much of this
 *  door can say no" — the number `thinkscript.test.js` measures — quietly
 *  include two things that never say no.
 *
 *  ⛔ SO THE `note-` PREFIX IS LOAD-BEARING, not decoration: it is what lets the
 *  source sweep tell a note code from a guard without a second hand-typed list.
 *  Their sentences join the disjointness sweep for the same reason every guard's
 *  does — a gate that matches on words must not be satisfiable by another
 *  table's words.
 *
 *  ⚠️⚠️ AND `assertNote` BELOW IS A RUNTIME GUARD, **NOT A RAIL** — MEASURED, not
 *  assumed. W3.3's mutation sweep deleted it and all 97 tests stayed GREEN, for
 *  exactly the reason the identical disclosure above `refusalValue` gives: every
 *  caller passes a LITERAL code that the source sweep already closes. It is kept
 *  anyway, and the two tables' guards are kept SEPARATE, because one shared
 *  check would let a note code stand in for a missing guard — and that is the
 *  mistake no test could see either. Re-measured on the same sweep:
 *  `refusalValue`'s `assertDeclared` STILL survives deletion, now against W3.3's
 *  much larger call surface, so that disclosure is current rather than inherited. */
export const NOTES = Object.freeze({
  'thinkscript:note-declare':
    'a chart placement is a drawing instruction, and a screened column has no chart to be placed on',
  'thinkscript:note-endash':
    'a dash pasted out of a web page was read as the minus sign it was written to be',
  'thinkscript:note-seed':
    'this average begins from a different first window than thinkorswim does, and the two converge',
  'thinkscript:note-warmup':
    'a value that carries forward restarts a fixed number of bars back rather than at the first bar ever drawn',
  // ⭐⭐ A4's WORDING IS "chrome calls listed as ignored lines, NEVER DROPPED", and
  // this sentence is the half every chrome line shares. The KIND-specific half is
  // appended per entry from `TS_CHROME_*` below, because a generic sentence
  // repeated eighteen times is a list a member learns to skip — and a silently
  // swallowed chrome line would be invisible in the corpus count, which is
  // exactly the failure this lane exists to prevent.
  // ⚠️ THE `note-` PREFIX IS A CONTRACT, NOT A NAMING HABIT. This was written
  // `thinkscript:chrome` and the vocabulary rail caught it: the prefix is what
  // lets the source sweep tell a note from a guard WITHOUT a second hand-typed
  // list of which is which, so a note that skips it quietly costs the sweep its
  // discriminator. Renamed rather than weakening the rail.
  'thinkscript:note-chrome':
    'this line draws on a chart and produces no value a screen can read, so it is listed here and skipped',
})

/** ⛔ THE ONE PLACE A GUARD ENTERS THIS DOOR. Reads `REFUSALS` rather than
 *  trusting its caller, so a guard invented in another module — where no sweep
 *  over this file can reach — dies where the mistake was made instead of
 *  reaching a member as a refusal with no sentence at all. */
function assertDeclared(guard) {
  if (!Object.prototype.hasOwnProperty.call(REFUSALS, guard)) {
    throw new Error(
      `thinkscript.js: ${guard} is not a guard REFUSALS declares — the refusal set is closed`)
  }
}

/** The same door for a note code, and separate for the same reason the tables
 *  are: one shared check would let a note code stand in for a missing guard. */
function assertNote(code) {
  if (!Object.prototype.hasOwnProperty.call(NOTES, code)) {
    throw new Error(
      `thinkscript.js: ${code} is not a code NOTES declares — the note set is closed`)
  }
}

/** A thinkScript construct this translator will not translate. Carries the guard
 *  AND the exact token, because "somewhere in your script" is not a refusal a
 *  member can act on.
 *
 *  ⛔ ITS OWN CLASS, like `PineRefusal`'s and `PcfRefusal`'s and for the same
 *  reason: one shared class lets one guard's deletion be covered by another
 *  guard's test. */
export class ThinkScriptRefusal extends Error {
  constructor(guard, message, at, suggest) {
    super(message)
    assertDeclared(guard)
    this.name = 'ThinkScriptRefusal'
    this.guard = guard
    this.at = at || null
    // ⭐ THE CONVENTIONAL CALL, when this refusal has one — see `TS_DOC_BLOCKED`.
    // It rides the refusal because the refusal is the only thing the member sees.
    this.suggest = suggest || null
  }
}

/** ⭐ THE WARM-UP THIS TRANSLATOR GIVES A CARRIED VALUE — 250 bars, one trading
 *  year. thinkScript accumulates from the first bar the chart ever loaded;
 *  `accum` is bounded ON PURPOSE (`closedTable.json::_functions_recurrence`).
 *  ⚠️ IT IS THE SAME NUMBER `pine.js::PINE_STATE_WARMUP` picked, DECLARED AGAIN
 *  rather than imported, because that constant is not exported and `pine.js` is
 *  another lane's file. Two translators may legitimately differ here; if they
 *  ever must not, exporting it from `pine.js` is a one-line W3b hand-back. */
/** Does this UNRESOLVED thinkScript expression read `name`'s own previous bar?
 *
 *  ⚠️ THE PARSED TREE, NOT THE CANONICAL ONE — this has to be decided BEFORE
 *  resolution, because resolution is what turns `name[1]` into `self` and it
 *  needs to know it is inside a recurrence first. */
function readsOwnPreviousBar(node, name) {
  let found = false
  const walk = (n) => {
    if (found || !n || typeof n !== 'object') return
    if (n.e === 'offset' && n.base && n.base.e === 'name' && key(n.base.name) === name) {
      found = true
      return
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(node)
  return found
}

export const TS_STATE_WARMUP = 250

// --------------------------------------------------------------------------- //
// refusal values — the same five helpers `pine.js` declares, same shape
// --------------------------------------------------------------------------- //

/** `{guard, message, line, column, index, token, excerpt}` — identical to
 *  `pine.js::refusalValue`'s shape, because `ImportBox` and the corpus fixture
 *  both read these keys by name and one door's refusal must render like every
 *  other door's.
 *
 *  ⚠️⚠️ THE `assertDeclared` BELOW IS A RUNTIME GUARD, **NOT A RAIL**, AND NO
 *  TEST WILL EVER CATCH ITS DELETION. Measured twice and recorded rather than
 *  papered over:
 *    1. W3.2's mutation sweep deleted it — every rail stayed GREEN. It cannot
 *       fire today because every caller passes a LITERAL guard (closed by the
 *       source sweep in `thinkscript.test.js`) or one off a
 *       `ThinkScriptRefusal`, whose constructor already checked it.
 *    2. W3.2's REVIEW then planted W3.3's actual shape — a branch emitting
 *       `` `thinkscript:${kind}` `` — and BOTH variants stayed GREEN too. So it
 *       is not even prospectively railed: the source sweep's
 *       `/'(thinkscript:[a-z-]+)'/g` is structurally blind to a template
 *       literal, which is exactly how a computed guard will be written.
 *
 *  ⛔ IT IS KEPT ANYWAY, and the next engineer should know why: it is the only
 *  thing that will catch a computed guard name that `REFUSALS` does not declare,
 *  precisely because no test can. Deleting cheap defence at a chokepoint because
 *  today's two callers happen to be safe is how the chokepoint stops being one.
 *
 *  ✅ W3.3 ANSWERED THE ⏳ THAT SAT HERE, AND ANSWERED IT THE OTHER WAY. The note
 *  said "widen the source sweep to match `` `thinkscript:${…}` `` too, or it
 *  ships blind", and widening it to MATCH one would still not check it: a regex
 *  can read the prefix and can never read `kind`. So the sweep in
 *  `thinkscript.test.js` was widened to DETECT a computed guard and pin the set
 *  of them — measured EMPTY, because this task deliberately writes every guard
 *  as a literal. That turns "structurally blind" into "acknowledged and zero",
 *  and the day somebody writes the first computed guard the sweep reds and says
 *  in its own message that `assertDeclared` below is then the only check there
 *  is. The blindness was real; what was wrong was believing a wider regex could
 *  cure it. */
function refusalValue(guard, message, at, suggest) {
  assertDeclared(guard)
  return {
    guard,
    message,
    line: at ? at.line : null,
    column: at ? at.column : null,
    index: at ? at.index : null,
    token: at ? at.token : null,
    excerpt: null,
    suggest: suggest || null,
  }
}

/** A thrown error as a refusal value, mirroring `pine.js::fromError`.
 *
 *  ✅ THE FIRST BRANCH IS LIVE AS OF W3.3 — the lexer, the statement splitter and
 *  the resolver all throw `ThinkScriptRefusal`, which is the whole mechanism by
 *  which a construct refuses at its token. W3.2 shipped it unreachable and said
 *  so; this is that disclosure closing.
 *
 *  ⚠️ THE SECOND BRANCH DELIBERATELY SWALLOWS A NON-REFUSAL INTO A MEMBER-FACING
 *  GUARD, the same trade `pine.js` makes: the promise that this door never
 *  throws outranks a clean stack, and the underlying message is appended so the
 *  bug is still legible in what the member is shown. */
function fromError(err) {
  if (err instanceof ThinkScriptRefusal) {
    return refusalValue(err.guard, err.message, err.at, err.suggest)
  }
  return refusalValue('thinkscript:statement',
    `${REFUSALS['thinkscript:statement']} (${err && err.message ? err.message : err})`, null)
}

/** The source line and a caret under the offending token. A refusal that names a
 *  line number and shows nothing is a refusal a member has to go looking for. */
function withExcerpt(refusal, lines) {
  if (!refusal || refusal.line == null) return refusal
  const text = lines[refusal.line - 1]
  if (typeof text !== 'string') return refusal
  const caret = `${' '.repeat(Math.max(0, (refusal.column || 1) - 1))}^`
  return { ...refusal, excerpt: `${text}\n${caret}` }
}

function withExcerpts(list, lines) {
  return list.map((r) => withExcerpt(r, lines))
}

function byPosition(a, b) {
  const al = a.line == null ? Infinity : a.line
  const bl = b.line == null ? Infinity : b.line
  if (al !== bl) return al - bl
  return (a.column || 0) - (b.column || 0)
}

/** A note value — the shape `ignored[]` carries. Same positional keys a refusal
 *  carries, because `ImportBox` renders both in one list. */
function noteValue(code, line, column, detail, extra) {
  assertNote(code)
  return {
    code,
    message: detail ? `${NOTES[code]} (${detail})` : NOTES[code],
    line,
    column,
    // ⭐ A CHROME NOTE CARRIES ITS TOKEN AND ITS OFFSET, because the Import box has
    // to be able to point AT the line it skipped. Every other note is positional
    // only, so this is optional rather than a shape every caller must fill.
    ...(extra || {}),
  }
}

// --------------------------------------------------------------------------- //
// TWO FOLDS, AND THEY ARE NOT THE SAME FOLD
// --------------------------------------------------------------------------- //

/** The SCRIPT's own symbol table. thinkorswim matches a member's identifiers and
 *  its own keywords case-insensitively and does NOTHING ELSE to them — that is
 *  measured, not assumed: `13-scan-52-week-high` is published as
 *  `Def High52 = Highest(High,52);` and runs, `21` writes `ArrowUP` for a plot it
 *  declared `ArrowUp`, and `06` writes `compoundValue` and `addlabel`. */
const key = (name) => String(name).toLowerCase()

/** The ENGINE table's fold, which ALSO strips `_` — the same one
 *  `pine.js::functionIndex` applies, so `williams_r` and `williamsR` are one
 *  entry on both sides of the engine.
 *
 *  ⛔ IT IS A SECOND FUNCTION ON PURPOSE AND MUST STAY ONE. Sharing `key` above
 *  would make `bull_cross` and `bullcross` the same MEMBER name, and
 *  `02-macd-lookback-cross-watchlist` binds `bull_cross` — a member who typo'd it
 *  would silently be handed someone else's series instead of a refusal. One fold
 *  serves the member's names; the other serves the engine's table. */
const normaliseName = (name) => String(name).toLowerCase().replace(/_/g, '')

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

/** The source, as the member pasted it, split into lines.
 *
 *  ⛔ ONE FUNCTION, CALLED FROM BOTH PLACES THAT NEED IT — the lexer and the
 *  door's excerpt fallback for a source the lexer REFUSED. Two copies of
 *  `.replace(/\r\n?/g, '\n').split('\n')` would be a second authority over where
 *  line 3 starts, and the caret is drawn from one of them while the position is
 *  measured against the other. */
const sourceLines = (src) => String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n')

/** A token as a refusal position. ⭐ `token` is the token's SOURCE TEXT, never
 *  its parsed value, so the corpus gate's `line.slice(column - 1, …) === token`
 *  stays a real assertion — for a quoted plot name that is `"DI+"`, not `DI+`. */
const locate = (tok) => (tok
  ? { line: tok.line, column: tok.column, index: tok.index, token: tok.text }
  : null)

const refuse = (guard, tok) => new ThinkScriptRefusal(guard, REFUSALS[guard], locate(tok))

// --------------------------------------------------------------------------- //
// the lexer
// --------------------------------------------------------------------------- //

const DIGIT = /[0-9]/
const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/

/** ⚠️ LONGEST FIRST. `<>` before `<`, `>=` before `>`: a shorter match taken
 *  first turns `a <> b` into `a < (> b)` and reports the syntax error one token
 *  past the real one.
 *
 *  ⭐ IT IS `lexPine`'s LIST WITH THREE CHANGES, each measured off the corpus:
 *  `<>` joins (thinkScript's other spelling of `!=`, in `10-rsi-laguerre`);
 *  Pine's `=>` and `:=` leave (thinkScript has neither); and `;` `{` `}` `.`
 *  join, because a statement here is `;`-terminated, an enum default is a brace
 *  group, and `BollingerBands(length = X).LowerBand` takes a member off a call
 *  result — a dot the identifier lexer cannot swallow because what follows it is
 *  not an identifier start.
 *
 *  ⚠️ `&&` AND `||` JOINED IN W3.4, AND THE REFERENCE IS ASYMMETRIC ABOUT THEM.
 *  thinkorswim's Logical Operators page (fetched 2026-08-26) spells its AND row
 *  `and, &&` — the symbol is the platform's own — while its OR row reads `or`
 *  alone. `||` is accepted anyway, because the pair is ONE grammar: a member who
 *  writes `&&` writes `||` in the next line, and reading one while refusing the
 *  other would refuse half a script over punctuation. ⛔ A SINGLE `&` OR `|` IS
 *  STILL A CHARACTER THIS LEXER CANNOT NAME and refuses at its own column — the
 *  superset stops at the two spellings the page and its own grammar imply. */
const PUNCT = [
  '==', '!=', '<>', '>=', '<=', '&&', '||',
  '?', ':', ',', ';', '.', '(', ')', '[', ']', '{', '}',
  '>', '<', '+', '-', '*', '/', '%', '=', '!',
]

/** Every dash a web page can render where thinkScript wanted `-`: U+2010 HYPHEN
 *  through U+2015 HORIZONTAL BAR, plus U+2212 MINUS SIGN. `10-rsi-laguerre`
 *  carries EN DASHes inside its arithmetic because that is what the forum it was
 *  published on served, and it runs on thinkorswim after a paste through the
 *  platform's own editor. Refusing the script would be refusing published code
 *  for an artefact of the page it was published on — so it is repaired, and the
 *  repair is RECORDED per line in `ignored[]` rather than done silently. */
const DASH_LOOKALIKES = /[‐-―−]/g

/**
 * Read a pasted thinkScript source into tokens.
 *
 * ⛔ IT NEVER SKIPS A CHARACTER IT CANNOT NAME. An unknown character refuses
 * `thinkscript:character` AT ITS OWN COLUMN, because a lexer that quietly drops
 * what it does not recognise produces a tree for a script the member did not
 * write.
 *
 * @param {string} src
 * @returns {{tokens: Array<object>, lines: string[], notes: Array<object>, text: string}}
 *   `lines` is the source AS PASTED — the dash repair below is 1:1 by
 *   construction, so every column measured against `text` is the same column in
 *   `lines`, and the excerpt a member reads is their own text rather than ours.
 */
export function lexThinkScript(src) {
  const lines = sourceLines(src)
  const notes = []
  const text = lines.map((line, i) => {
    const fixed = line.replace(DASH_LOOKALIKES, '-')
    if (fixed === line) return line
    notes.push(noteValue('thinkscript:note-endash', i + 1, line.search(DASH_LOOKALIKES) + 1))
    return fixed
  }).join('\n')

  const tokens = []
  let i = 0
  let line = 1
  let lineStart = 0
  const at = (index, ln, col, raw) => ({ line: ln, column: col, index, token: raw })

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') { i += 1; line += 1; lineStart = i; continue }
    if (ch === ' ' || ch === '\t') { i += 1; continue }
    const col = i - lineStart + 1

    // ⭐ `#` TO END OF LINE IS THE ONLY COMMENT, AND `#hint` IS ONE OF THEM.
    // thinkScript has no `//`; the reference documents `#hint <name>: <text>` as
    // a comment the platform reads for its input dialog, which is chrome for a
    // screened column. `10-rsi-laguerre` writes one on the same line as an input.
    if (ch === '#') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      i = end
      continue
    }

    if (ch === '"') {
      let j = i + 1
      let out = ''
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') { out += text[j]; j += 1 }
      if (text[j] !== '"') {
        throw new ThinkScriptRefusal('thinkscript:character', REFUSALS['thinkscript:character'],
          at(i, line, col, ch))
      }
      tokens.push({ kind: 'string', value: out, text: text.slice(i, j + 1), line, column: col, index: i })
      i = j + 1
      continue
    }

    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || ''))) {
      let j = i
      while (j < text.length && DIGIT.test(text[j])) j += 1
      if (text[j] === '.') { j += 1; while (j < text.length && DIGIT.test(text[j])) j += 1 }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1
        if (text[k] === '+' || text[k] === '-') k += 1
        if (DIGIT.test(text[k] || '')) { k += 1; while (k < text.length && DIGIT.test(text[k])) k += 1; j = k }
      }
      const raw = text.slice(i, j)
      tokens.push({ kind: 'number', value: Number(raw), text: raw, line, column: col, index: i })
      i = j
      continue
    }

    // An identifier is DOTTED exactly as Pine's is, so `Double.NaN`, `Color.RED`,
    // `mode.UseA` and `TTM_Squeeze` are each ONE token — which is what lets a
    // refusal name `Double.POSITIVE_INFINITY` rather than `Double`.
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < text.length && IDENT_PART.test(text[j])) j += 1
      while (text[j] === '.' && IDENT_START.test(text[j + 1] || '')) {
        j += 1
        while (j < text.length && IDENT_PART.test(text[j])) j += 1
      }
      const word = text.slice(i, j)
      tokens.push({ kind: 'ident', value: word, text: word, line, column: col, index: i })
      i = j
      continue
    }

    const punct = PUNCT.find((p) => text.startsWith(p, i))
    if (punct) {
      tokens.push({ kind: 'punct', value: punct, text: punct, line, column: col, index: i })
      i += punct.length
      continue
    }

    throw new ThinkScriptRefusal('thinkscript:character', REFUSALS['thinkscript:character'],
      at(i, line, col, ch))
  }

  return { tokens, lines, notes, text }
}

// --------------------------------------------------------------------------- //
// the statement splitter
// --------------------------------------------------------------------------- //

const isPunctTok = (t, v) => !!t && t.kind === 'punct' && t.value === v
const isWordTok = (t, w) => !!t && t.kind === 'ident' && key(t.value) === w

/**
 * Split a token stream into statement runs.
 *
 * ⭐ TWO TERMINATORS, AND THEY PULL IN OPPOSITE DIRECTIONS. `;` at depth zero
 * ends a statement — but `input mode = {default A, B};` closes a brace and then
 * still wants its `;`, while `if … { … } else { … }` closes a brace and is OVER.
 * Splitting on `;` alone swallows the statement after every block; splitting at
 * every closing brace splits an enum default in half. So a `}` that returns to
 * depth zero ends the run UNLESS the next token is its `;` or the `else` that
 * continues it.
 *
 * ⛔⛔ AND A TRAILING RUN WITH NEITHER IS STILL A STATEMENT — the lane brief said
 * it "throws `thinkscript:syntax` at the last token", and that is WRONG against
 * this lane's own corpus. `16-scan-rsi-crosses-30-70.ts` is published as
 * `RSI() crosses above 30 or RSI() crosses below 70` with no `plot`, no `def`
 * and NO `;` ANYWHERE — a thinkorswim scan condition, which is the single
 * commonest shape a member pastes into a screener. Refusing it here would refuse
 * real published code for punctuation the platform does not require. An
 * unfinished statement still refuses `thinkscript:syntax` at the token it ran out
 * on — `plot p = close >` does — but it refuses because the EXPRESSION READER
 * ran out of tokens, which is where that fact actually lives.
 *
 * @param {Array<object>} tokens
 * @returns {Array<{tokens: Array<object>}>}
 */
export function readStatements(tokens) {
  const runs = []
  let cur = []
  let paren = 0
  let brace = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[') paren += 1
      else if (t.value === ')' || t.value === ']') paren = Math.max(0, paren - 1)
      else if (t.value === '{') brace += 1
      else if (t.value === '}') brace = Math.max(0, brace - 1)
      else if (t.value === ';' && paren === 0 && brace === 0) {
        if (cur.length) runs.push({ tokens: cur })
        cur = []
        continue
      }
    }
    cur.push(t)
    if (isPunctTok(t, '}') && brace === 0 && paren === 0) {
      const nxt = tokens[i + 1]
      const continues = isPunctTok(nxt, ';') || isWordTok(nxt, 'else')
      if (!continues) { runs.push({ tokens: cur }); cur = [] }
    }
  }
  if (cur.length) runs.push({ tokens: cur })
  return runs
}

// --------------------------------------------------------------------------- //
// the expression reader
// --------------------------------------------------------------------------- //

/** Words that can never begin a value. Reaching one where an atom is due means
 *  the statement's shape is not what the reader thought, and saying so AT that
 *  word is more useful than resolving whatever came before it.
 *
 *  ⛔⛔ `bar` AND `bars` ARE NOT IN HERE, AND THE CORPUS IS WHY. thinkorswim's
 *  own reserved-word page lists both, and `14-scan-inside-bar` writes
 *  `inside within 1 bars` — but `23-previous-day-high-low-mean` opens with
 *  `def bar = barNumber();` and then reads `then bar` seventeen times, published
 *  and running. Reserving them refused a real script at `bar` with
 *  `thinkscript:syntax`, which is both the wrong reason and the wrong place.
 *  `within` consumes its trailing `bar`/`bars` POSITIONALLY, which is all the
 *  phrase ever needed. ⭐ The corpus is the measurement, not the reference page. */
const NOT_AN_ATOM = Object.freeze(new Set([
  'then', 'else', 'and', 'or', 'not', 'if', 'def', 'plot', 'input', 'declare', 'rec',
  'within', 'crosses', 'above', 'below', 'is', 'than', 'greater', 'less',
  'case', 'switch', 'do', 'to', 'with', 'while', 'default',
]))

/** ⭐⭐ THE PRECEDENCE, COPIED FROM thinkorswim's OWN PUBLISHED TABLE — level by
 *  level, spelling by spelling, so a later reader can hold this beside the page
 *  and check it row for row.
 *
 *      SOURCE: /center/reference/thinkScript/Operators/Operator-Precedence.html
 *      fetched 2026-08-26. **Level 1 binds TIGHTEST, level 12 LOOSEST.**
 *
 *      1   [] ; from
 *      2   !
 *      3   * ; / ; %
 *      4   + (string concatenation)
 *      5   + (addition) ; -
 *      6   < ; is less than ; > ; is greater than ; <= ; is less than or equal
 *          to ; >= ; is greater than or equal to ; crosses above ; crosses
 *          below ; crosses
 *      7   == ; equals ; is equal to ; != ; <> ; is not equal to
 *      8   is true ; is false
 *      9   and ; &&
 *      10  or
 *      11  if
 *      12  within
 *
 *  ⛔⛔ W3.4 SHIPPED A LADDER IT INVENTED, AND THE SENTENCE THAT SAID SO IS WHY
 *  NOBODY CHECKED. It read: "thinkorswim's reference publishes the operator
 *  ROSTER … and does NOT publish a precedence table, so this ladder is the
 *  conventional one every C-family language uses". **That was false**, and a
 *  false premise recorded as the reason for a decision is how the decision never
 *  gets revisited. Two real defects lived under it:
 *    * `within` was given a rung TIGHTER than `and`. The page makes it level 12,
 *      the LOOSEST operator in the language, so
 *      `high < high[1] and low > low[1] within 3 bars` emitted
 *      `high < high[1] && highest(low > low[1], 3) > 0` — 53 of 158 bars wrong,
 *      passing both the round trip and the save door. A chart that looks right
 *      and is wrong.
 *    * Relational and equality were collapsed onto ONE rung, so
 *      `close == open < high` grouped as `(close == open) < high` where the page
 *      gives levels 6 and 7 and therefore `close == (open < high)` — 74 of 160
 *      bars wrong.
 *  ⭐ THE LESSON IS NARROWER THAN "CHECK THE DOCS": the `between` row HAD been
 *  researched against the Comparison Operators page in the same task, and the
 *  ladder underneath it was never re-checked against the same source. Correcting
 *  one row of a table is not correcting the table.
 *
 *  ⛔⛔ AND THE PARSER READS THIS, which is the other half. W3.3 shipped a
 *  recursive-descent chain (`parseOr → parseAnd → parseWithin → parseComparison
 *  → parseAdditive → …`) that encoded a ladder in the SHAPE of its call graph;
 *  a table written beside such a chain is a second authority over one value, and
 *  the drift between them is silent. One binding-power loop reads this map:
 *  change a level here and the grammar changes, or nothing does.
 *
 *  ⚠️ `between` IS THE ONE ROW THAT IS NOT ON THE PAGE'S TABLE, and it is marked
 *  here rather than blended in. The page gives it a PROSE bound only —
 *  *"Operator `between` has precedence lower than addition or subtraction but
 *  higher than the conditional operator"* — which pins it to levels 6..10. It is
 *  placed at 6 because the Comparison Operators page lists it as a row of the
 *  comparison table beside `>=` and `crosses`, and the precedence table puts
 *  that whole relational group at 6. ⛔ The choice inside 6..10 is observable in
 *  exactly one shape, `a == b between c and d`, which no fixture and no
 *  reference example writes; if thinkorswim ever publishes the row, this is the
 *  single line to change.
 *
 *  ⚠️ LEVELS 1, 2 AND 4 ARE PRESENT ON THE PAGE AND ABSENT FROM THIS MAP, for
 *  THREE different reasons that are worth keeping apart.
 *    * `[]` (1) and `!` (2) ARE implemented — as postfix and prefix forms in
 *      `parsePostfix`/`parseUnary`, whose position in the grammar IS "tighter
 *      than every infix operator" — so a number for them would be read by
 *      nothing, which is the same unread-constant defect one level down.
 *    * `+` as string concatenation (4) is not implemented at all: a screened
 *      column holds a number.
 *    * ⏳ `from` (1) IS NOT PARSED, AND THAT IS A KNOWN WRONG-REASON REFUSAL
 *      rather than a harmless gap. Measured: `close from 2 bars ago` falls out
 *      of the expression as a leftover token and refuses `thinkscript:syntax`
 *      AT `from` — right position, false reason, the same class W3.3 fixed for
 *      `between`, `reference` and `script`. It is left alone because fixing it
 *      means deciding what `from` MEANS, and this lane has no fetched citation
 *      for that; guessing it is an offset would be the silent mistranslation
 *      this door exists to prevent. Pinned by `⏳ from is the ONE published
 *      operator this reader does not parse` in `thinkscript.test.js`. */
export const TS_PRECEDENCE = Object.freeze({
  '*': 3, '/': 3, '%': 3,
  '+': 5, '-': 5,
  '<': 6, 'is less than': 6, '>': 6, 'is greater than': 6,
  '<=': 6, 'is less than or equal to': 6, '>=': 6, 'is greater than or equal to': 6,
  'crosses above': 6, 'crosses below': 6, 'crosses': 6,
  'between': 6, // ⚠️ prose-bounded to 6..10, not a row — see the note above
  '==': 7, 'equals': 7, 'is equal to': 7, '!=': 7, '<>': 7, 'is not equal to': 7,
  'is true': 8, 'is false': 8,
  'and': 9, '&&': 9,
  'or': 10, '||': 10, // ⚠️ `||` is not published; see the lexer's note on the pair
  'if': 11,
  'within': 12,
})

/** A published LEVEL as this loop's binding power. ⛔ LOOSER MUST BE SMALLER,
 *  because `parseBinary` stops on `bp < minBp`, and the page numbers run the
 *  other way — so the conversion is a negation, done HERE and once, which is
 *  what lets the map above stay byte-comparable with the page. */
const bpOfLevel = (level) => -level

/** The symbol an operator is CANONICALLY spelled with. `<>` is thinkScript's
 *  other spelling of `!=` (`10-rsi-laguerre` writes it), and folding it here
 *  means the tree and the printer only ever see one of the two.
 *
 *  ⚠️ THE FOLD HAPPENS AFTER THE LEVEL LOOKUP, AND TODAY THAT ORDERING DECIDES
 *  NOTHING — measured: `<>` and `!=` are BOTH row 7 of the published table, so
 *  folding first returns the same level and all 148 tests pass either way. It is
 *  ordered this way as future-proofing only: the page lists the two spellings
 *  separately, so if it ever gave them different levels, folding first would
 *  silently answer with `!=`'s. ⛔ NO TEST CAN TELL THE TWO ORDERINGS APART,
 *  which is why this says so instead of offering a reason.
 *
 *  ⛔⛔ AND THE SENTENCE THAT USED TO BE HERE WAS FALSE — *"asking that table for
 *  a row it does not have"* — because `!=` IS a row. It was written in the same
 *  commit that removed the "thinkorswim does not publish a precedence table"
 *  alibi, which is the third time this lane has produced this exact shape: a
 *  comment that explains why something was not checked, standing in for the
 *  check. The tell is a rationale for an absence. */
const CMP = Object.freeze({ '==': '==', '!=': '!=', '<>': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' })

/** ⭐ THE WORD SPELLINGS ARE THE SYMBOL SPELLINGS. thinkorswim's Comparison
 *  Operators page lists `is greater than` and `>` as SEPARATE ROWS WITH THE SAME
 *  DESCRIPTION, and its Logical page does the same for `and` / `&&`. So these
 *  are not a convenience mapping bolted onto a symbol grammar — they are the
 *  same operators, and the reader must not grow a second grammar for the long
 *  ones. Every entry below is a row of one of those two pages, quoted.
 *
 *  ⛔ LONGEST MATCH WINS, AND IT IS DECIDED BY MEASURING THE PHRASE, NOT BY THE
 *  ORDER OF THIS LIST. `is greater than or equal to` and `is greater than` share
 *  a prefix; a matcher that took the first hit in list order would read
 *  `a is greater than or equal to b` as `a > (or equal to b)` and die at `or`
 *  with a wrong reason at a wrong token — and it would do it silently the day
 *  somebody re-sorted the list alphabetically. `infixAt` picks the longest
 *  phrase that matches, so the order here carries no meaning at all.
 *
 *  ⚠️⚠️ AND THAT LAST SENTENCE IS WHY NO TEST CAN CATCH THE LONGEST-MATCH GUARD
 *  ALONE — MEASURED, not assumed. The sweep replaced it with "take the first
 *  match" and all 144 tests stayed GREEN, because the rows below HAPPEN to be
 *  written longest-first, so the two rules agree on this table: it is an
 *  EQUIVALENT MUTANT, not an unrailed guard. What separates them is a pair:
 *  re-ordering the rows short-first with the guard KEPT stays green (the guard
 *  absorbs the order — which is its whole job), and re-ordering with the guard
 *  REMOVED reds `is greater than or equal to`. The behavioural rail that does
 *  exist is `every row of the word-operator table is REACHABLE, and parses as
 *  ITSELF` in `thinkscript.test.js`, which walks THIS array — so a row added in
 *  the wrong place is caught by the guard, and a row that is unreachable for any
 *  other reason is caught by name.
 *
 *  ⚠️ `is true` / `is false` ARE ON THE LOGICAL PAGE, whose NOT row reads
 *  `!, is false` — the two spellings are literally one row, so `is false` is `!`
 *  by quotation rather than by inference. `is true` is that row's neighbour,
 *  `is true | logical value`, and it resolves to the operand UNCHANGED: passing
 *  the value straight through hands this engine exactly the truthiness decision
 *  thinkorswim's own runtime would make on it, which is what every other boolean
 *  context in this translator already does. */
export const TS_WORD_OPERATORS = Object.freeze([
  { words: ['and'], kind: 'binary', op: '&&' },
  { words: ['or'], kind: 'binary', op: '||' },
  { words: ['is', 'greater', 'than', 'or', 'equal', 'to'], kind: 'binary', op: '>=' },
  { words: ['is', 'less', 'than', 'or', 'equal', 'to'], kind: 'binary', op: '<=' },
  { words: ['is', 'not', 'equal', 'to'], kind: 'binary', op: '!=' },
  { words: ['is', 'greater', 'than'], kind: 'binary', op: '>' },
  { words: ['is', 'less', 'than'], kind: 'binary', op: '<' },
  { words: ['is', 'equal', 'to'], kind: 'binary', op: '==' },
  { words: ['equals'], kind: 'binary', op: '==' },
  { words: ['is', 'true'], kind: 'postfix', op: null },
  { words: ['is', 'false'], kind: 'postfix', op: '!' },
  { words: ['crosses', 'above'], kind: 'cross', dir: 'above' },
  { words: ['crosses', 'below'], kind: 'cross', dir: 'below' },
  { words: ['crosses'], kind: 'cross', dir: 'either' },
  { words: ['between'], kind: 'between', op: 'between' },
  { words: ['within'], kind: 'within', op: 'within' },
])

/** The binding power a word entry answers to, looked up BY ITS OWN PHRASE.
 *  ⭐ THAT IS THE WHOLE POINT: `is greater than` and `>` are separate rows of
 *  the published table at the same level, so reading each spelling's own row
 *  makes the code's ladder the page's ladder rather than a summary of it — and
 *  `is true` gets level 8 instead of being assumed onto a neighbouring tier,
 *  which is how it was wrong before. */
const bpOf = (entry) => bpOfLevel(TS_PRECEDENCE[entry.words.join(' ')])

const cursorOf = (toks) => ({ toks, i: 0 })
const peek = (c, k = 0) => c.toks[c.i + k] || null
const take = (c) => c.toks[c.i++]

const syntaxAt = (c, tok) => refuse('thinkscript:syntax', tok || c.toks[c.toks.length - 1] || null)

/** The infix operator sitting at the cursor, WITHOUT consuming it — a symbol, or
 *  the LONGEST word phrase that matches from here.
 *
 *  ⛔ THE LONGEST, not the first: `is greater than or equal to` and
 *  `is greater than` share a prefix, and taking the shorter one reads
 *  `a is greater than or equal to b` as `a > (or equal to b)`.
 *
 *  @returns {{entry: object, bp: number, tok: object, length: number}|null} */
function infixAt(c) {
  const t = peek(c)
  if (!t) return null
  if (t.kind === 'punct') {
    // The level is looked up by the spelling the member wrote, and only then is
    // the spelling folded to canonical — see `CMP` above for why that ordering
    // is future-proofing rather than a fix, and decides nothing today.
    if (!has(TS_PRECEDENCE, t.value)) return null
    const op = has(CMP, t.value) ? CMP[t.value] : t.value
    return { entry: { kind: 'binary', op }, bp: bpOfLevel(TS_PRECEDENCE[t.value]), tok: t, length: 1 }
  }
  if (t.kind !== 'ident') return null
  let best = null
  for (const entry of TS_WORD_OPERATORS) {
    if (best && entry.words.length <= best.length) continue
    if (entry.words.every((w, i) => isWordTok(peek(c, i), w))) {
      best = { entry, bp: bpOf(entry), tok: t, length: entry.words.length }
    }
  }
  return best
}

/**
 * One expression, read at a binding power.
 *
 * ⭐ ONE LOOP, DRIVEN BY `TS_PRECEDENCE` ABOVE. Everything about precedence
 * lives in that map; this function only knows "looser than what I was called at
 * means stop". The left-associativity of every tier is the `+ 1` on the
 * recursive call — one step TIGHTER, since a published level negates.
 *
 * ⚠️ `if … then … else …` IS A PREFIX FORM HERE, not an infix ternary, which is
 * how thinkScript writes it — so it is read by `parseExpression` below, at the
 * front of a value. `seed` is how that form re-enters this loop afterwards:
 * `if` is level 11 and `within` is 12, so a finished conditional can still be
 * the OPERAND of a `within` that follows it.
 */
function parseBinary(c, minBp, seed) {
  let left = seed === undefined ? parseUnary(c) : seed
  for (;;) {
    const found = infixAt(c)
    if (!found || found.bp < minBp) return left
    const { entry, bp, tok } = found
    for (let n = 0; n < found.length; n += 1) take(c)

    // ⭐ `x between a and b` — the reference's own words are *"within the range
    // of value1 and value2 (inclusive)"*. ⛔ THE BOUNDS ARE READ AT THE TIER
    // ABOVE, which is the load-bearing half: `between` SPENDS an `and` closing
    // its own phrase, so a reader that let the logical `and` win would take
    // `high and volume > 0` as the upper bound — a wrong column, not a refusal.
    // ⚠️ The CALL form `between(a, b, c)` is untouched and still refuses at its
    // name — `23-previous-day-high-low-mean` uses it six times, and a FUNCTION
    // called `Between` needs its own citation, which is the function map's job.
    // That is why `between` is not in `NOT_AN_ATOM`.
    if (entry.kind === 'between') {
      const lo = parseBinary(c, bp + 1)
      if (!isWordTok(peek(c), 'and')) throw syntaxAt(c, peek(c))
      take(c)
      left = { e: 'between', x: left, lo, hi: parseBinary(c, bp + 1), tok }
      continue
    }

    // `<cond> within N bars` — *"true at least one time for the given number of
    // bars starting from the current one"*. The trailing `bar`/`bars` is
    // consumed POSITIONALLY rather than reserved, because `23-previous-day`
    // opens `def bar = barNumber();` and reads `bar` seventeen times.
    if (entry.kind === 'within') {
      const count = parseBinary(c, bp + 1)
      if (isWordTok(peek(c), 'bars') || isWordTok(peek(c), 'bar')) take(c)
      left = { e: 'within', cond: left, count, tok }
      continue
    }

    // `x is true` / `x is false` take no right operand at all.
    if (entry.kind === 'postfix') {
      left = entry.op === null ? left : { e: 'unary', op: entry.op, arg: left, tok }
      continue
    }

    const right = parseBinary(c, bp + 1)
    left = entry.kind === 'cross'
      ? { e: 'cross', dir: entry.dir, left, right, tok }
      : { e: 'binary', op: entry.op, left, right, tok }
  }
}

/** The loosest rung there is — where a whole expression starts. Derived from the
 *  published map rather than typed, so the day thinkorswim publishes a level 13
 *  nothing here has to remember to move. */
const LOOSEST_BP = bpOfLevel(Math.max(...Object.values(TS_PRECEDENCE)))

/**
 * A value at a binding power — the conditional's prefix form, or a plain
 * expression.
 *
 * ⭐ ONE DISPATCH, USED IN BOTH PLACES A VALUE CAN BEGIN, which is what makes
 * `else if … then … else …` nest to the right: the `else` arm re-enters HERE,
 * so it may itself open a conditional. Calling `parseBinary` directly for the
 * arm reads `if` as an atom, and `if` is not one — the arm then refuses
 * `:syntax` on `if a then 1 else if b then -1 else 0`, which is correct
 * thinkScript. Measured in fix round 1.
 */
function parseValue(c, minBp) {
  if (!isWordTok(peek(c), 'if')) return parseBinary(c, minBp)
  const tok = take(c)
  const cond = parseExpression(c)
  if (!isWordTok(peek(c), 'then')) throw syntaxAt(c, peek(c))
  take(c)
  const a = parseExpression(c)
  if (!isWordTok(peek(c), 'else')) throw syntaxAt(c, peek(c))
  take(c)
  // ⭐ THE `else` ARM IS READ AT `if`'s OWN LEVEL (11), NOT AT THE LOOSEST.
  // Everything tighter than the conditional belongs to the arm — `or` is 10, so
  // `else 0 or volume > 0` is one arm — while `within`, the only thing LOOSER at
  // 12, must stay outside and take the whole conditional. Read at the loosest, a
  // window would silently cover one branch of a member's `if … then … else …`
  // instead of the answer it computes.
  const otherwise = parseValue(c, bpOfLevel(TS_PRECEDENCE.if))
  return parseBinary(c, minBp, { e: 'if', cond, then: a, otherwise, tok })
}

/** ⭐⭐ A `fold` THAT IS A ROLLING SUM, RECOGNISED — the one fold shape the corpus
 *  actually contains, and it needs no grammar at all.
 *
 *  ⛔⛔ THE MEASUREMENT THAT PUT THIS HERE RATHER THAN A COLLECTION NODE TYPE. Four
 *  independent designs and three adversaries examined adding collections to the
 *  closed grammar. `pine:collection` is the FIRST wall for exactly ONE script in 75
 *  and appears nowhere else, and that script has FOUR more walls behind the array
 *  (`pine:tuple`, `pine:builtin`, `pine:state`, and `pine:request` for a `'D'` rung
 *  `TF_RESAMPLABLE` cannot serve). Measured corpus delta of the permanent grammar
 *  change: ZERO scripts. What the corpus rewards is this recogniser instead.
 *
 *  ⭐ `fold i = 0 to 8 with p do p + GetValue(<expr>, i)` IS `sum(<expr>, 8)`.
 *  thinkorswim's fold runs while `index < end`, so `0 to 8` is eight terms — the
 *  bound is EXCLUSIVE, and reading it as inclusive would compute a nine-bar sum
 *  under the member's own title with nothing announcing the substitution.
 *
 *  ⛔ IT RECOGNISES ONE SHAPE AND REFUSES EVERYTHING ELSE. The accumulator must be
 *  `acc + <term>`, the term must be `GetValue(<expr>, <the loop's own index>)`, both
 *  bounds must be whole-number literals, and the seed must be absent or 0. A fold
 *  that multiplies, that reads a different index, or that seeds non-zero is NOT a
 *  rolling sum and keeps the refusal it has today. Recognising a shape loosely is
 *  how a translator answers a plausible different number.
 *
 *  ⚠️ PARSED IN FULL BEFORE IT IS JUDGED, deliberately: a fold this cannot take is
 *  thrown on, so consumed tokens never need restoring. */
function foldAsRollingSum(c, foldTok) {
  const wordIs = (t, w) => !!(t && t.kind === 'ident' && key(t.value) === w)
  const literalInt = (node) => (node && node.e === 'num' && Number.isInteger(node.value)
    ? node.value : null)

  const idx = peek(c)
  if (!idx || idx.kind !== 'ident') return null
  take(c)
  if (!isPunctTok(peek(c), '=')) return null
  take(c)
  const from = literalInt(parseExpression(c))
  if (from === null) return null
  if (!wordIs(peek(c), 'to')) return null
  take(c)
  const to = literalInt(parseExpression(c))
  if (to === null) return null
  if (!wordIs(peek(c), 'with')) return null
  take(c)
  const acc = peek(c)
  if (!acc || acc.kind !== 'ident') return null
  take(c)
  // ⛔ AN EXPLICIT SEED MUST BE ZERO. `with p = 5` is a sum plus five, which is a
  // different number, and the shape below cannot carry it.
  if (isPunctTok(peek(c), '=')) {
    take(c)
    if (literalInt(parseExpression(c)) !== 0) return null
  }
  if (!wordIs(peek(c), 'do')) return null
  take(c)
  const body = parseExpression(c)

  // body must be exactly `<acc> + <term>`
  if (!body || body.e !== 'binary' || body.op !== '+') return null
  const { left, right } = body
  if (!left || left.e !== 'name' || key(left.name) !== key(acc.value)) return null
  // term must be `GetValue(<expr>, <idx>)`
  if (!right || right.e !== 'call' || key(right.name) !== 'getvalue') return null
  // ⚠⚠ EVERY ARGUMENT IS A `{name, nameTok, value}` WRAPPER, not the node. Reading
  // the wrapper as if it WERE the node is the exact mistake `pine.js::securityAsNode`
  // records against itself — "how the first draft returned null for every shape,
  // including the ones it exists to take" — and it made this recogniser match
  // NOTHING while looking perfectly reasonable.
  const args = right.args || []
  if (args.length !== 2) return null
  // ⛔ POSITIONAL ONLY. `GetValue(source = x, index = i)` is a shape this has not
  // measured, and guessing at a named form is how a translator answers a different
  // number.
  if (args.some((a) => !a || a.name)) return null
  const which = args[1].value
  if (!which || which.e !== 'name' || key(which.name) !== key(idx.value)) return null

  const count = to - from
  if (!(count >= 1)) return null
  // ⭐ `sum(source, n)` — the rolling reduction this table has declared since v1.
  return {
    e: 'call',
    name: 'sum',
    base: null,
    // ⚠⚠ AND THE WRAPPER GOES BACK ON, ON THE WAY OUT. `parseArguments` produces
    // `{name, nameTok, value}` and every consumer reads that shape, so emitting raw
    // nodes here refused `thinkscript:named-argument` — the same wrapper mistake as
    // above, in the other direction, two lines apart.
    args: [
      { name: null, nameTok: null, value: args[0].value },
      { name: null, nameTok: null, value: { e: 'num', value: count, tok: foldTok } },
    ],
    tok: foldTok,
  }
}

function parseExpression(c) {
  return parseValue(c, LOOSEST_BP)
}

function parseUnary(c) {
  const t = peek(c)
  if (t && t.kind === 'punct' && (t.value === '-' || t.value === '!')) {
    const tok = take(c)
    return { e: 'unary', op: tok.value, arg: parseUnary(c), tok }
  }
  if (isWordTok(t, 'not')) {
    const tok = take(c)
    return { e: 'unary', op: '!', arg: parseUnary(c), tok }
  }
  return parsePostfix(c)
}

function parsePostfix(c) {
  let node = parseAtom(c)
  for (;;) {
    const t = peek(c)
    if (isPunctTok(t, '[')) {
      // ⭐ THE `[` IS KEPT. `tok` stays the value's own token so a refusal inside
      // the value points at the value; `bracket` is where the OFFSET itself
      // lives, and it is the only honest caret for "this offset is the problem".
      const bracket = take(c)
      const index = parseExpression(c)
      if (!isPunctTok(peek(c), ']')) throw syntaxAt(c, peek(c))
      take(c)
      node = { e: 'offset', base: node, index, tok: node.tok, bracket }
      continue
    }
    if (isPunctTok(t, '.')) {
      const dot = take(c)
      const nameTok = peek(c)
      if (!nameTok || (nameTok.kind !== 'ident' && nameTok.kind !== 'string')) throw syntaxAt(c, nameTok || dot)
      take(c)
      node = isPunctTok(peek(c), '(')
        ? { e: 'call', name: nameTok.value, base: node, args: parseArguments(c), tok: node.tok || dot }
        : { e: 'member', base: node, name: nameTok.value, tok: node.tok || dot }
      continue
    }
    return node
  }
}

function parseArguments(c) {
  if (!isPunctTok(peek(c), '(')) throw syntaxAt(c, peek(c))
  take(c)
  const args = []
  if (isPunctTok(peek(c), ')')) { take(c); return args }
  for (;;) {
    let name = null
    let nameTok = null
    const a = peek(c)
    // ⭐ THE NAME'S OWN TOKEN IS KEPT, and it is the whole reason a refusal can
    // land on `source` rather than on the call. A quoted name is the same name —
    // `19-consecutive-bars` writes `MovAvgExponential("length" = 21)` — so the
    // token's TEXT stays `"length"` (with its quotes) while its VALUE is
    // `length`, which is what keeps the corpus gate's caret assertion honest.
    if (a && (a.kind === 'ident' || a.kind === 'string') && isPunctTok(peek(c, 1), '=')) {
      name = a.value
      nameTok = a
      take(c)
      take(c)
    }
    args.push({ name, nameTok, value: parseExpression(c) })
    if (isPunctTok(peek(c), ',')) { take(c); continue }
    break
  }
  if (!isPunctTok(peek(c), ')')) throw syntaxAt(c, peek(c))
  take(c)
  return args
}

function parseAtom(c) {
  const t = peek(c)
  if (!t) throw syntaxAt(c, null)
  if (t.kind === 'number') { take(c); return { e: 'num', value: t.value, tok: t } }
  if (t.kind === 'string') { take(c); return { e: 'text', value: t.value, tok: t } }
  if (isPunctTok(t, '(')) {
    take(c)
    const inner = parseExpression(c)
    if (!isPunctTok(peek(c), ')')) throw syntaxAt(c, peek(c))
    take(c)
    return inner
  }
  if (t.kind === 'ident') {
    const k = key(t.value)
    // ⛔ A `fold` LOOP REFUSES AS A FOLD, NEVER AS A SYNTAX ERROR. It is real,
    // documented thinkScript (`fold i = 0 to 8 with p do …`, and
    // `18-fold-up-down-points-ratio` is published with two of them); telling a
    // member their line "does not end where a statement has to end" would be a
    // false reason at a true position, which is the worse half of a wrong
    // refusal. This engine stores ONE expression rather than a program, so the
    // construct has nowhere to go and says exactly that.
    if (k === 'fold') {
      // ⭐ THE ONE SHAPE THAT IS A ROLLING SUM TRANSLATES; every other fold keeps
      // the refusal it has, with the same sentence and the same token.
      take(c)
      const asSum = foldAsRollingSum(c, t)
      if (asSum) return asSum
      throw refuse('thinkscript:fold', t)
    }
    // ⛔ `reference <Study>` NAMES ANOTHER STUDY, and thinkorswim publishes no
    // formula for one. Refusing at the word is the whole reason `:study-ref`
    // exists; before this it reported a syntax error at the study's NAME, which
    // is a false reason pointing one token past the real one.
    if (k === 'reference') throw refuse('thinkscript:study-ref', t)
    if (NOT_AN_ATOM.has(k)) throw syntaxAt(c, t)
    take(c)
    if (isPunctTok(peek(c), '(')) {
      return { e: 'call', name: t.value, base: null, args: parseArguments(c), tok: t }
    }
    // `yes` and `no` are thinkScript's two boolean literals, and the reference
    // is explicit that they are 1 and 0.
    if (k === 'yes') return { e: 'num', value: 1, tok: t }
    if (k === 'no') return { e: 'num', value: 0, tok: t }
    return { e: 'name', name: t.value, tok: t }
  }
  throw syntaxAt(c, t)
}

/** Parse a whole run as ONE expression and refuse at whatever is left over.
 *  ⭐ THE LEFTOVER CHECK IS THE HALF THAT CATCHES A MISSING `;`: `def x = close`
 *  followed by `plot p = x > 0;` reads as one statement whose expression stops at
 *  `close`, and the honest place to say so is `plot`, on line 2. */
function parseWhole(toks) {
  const c = cursorOf(toks)
  const expr = parseExpression(c)
  if (peek(c)) throw syntaxAt(c, peek(c))
  return expr
}

// --------------------------------------------------------------------------- //
// the statement reader — what each shape of line MEANS
// --------------------------------------------------------------------------- //

/** thinkorswim price series this engine keeps no field for. ⭐ IT EXISTS SO A
 *  REAL BUILT-IN IS NOT REPORTED AS A TYPO. `01-supertrend-mobius` reads `HL2`;
 *  telling a member "this name is used before anything in the script gives it a
 *  value" would send them hunting for a `def` they never omitted, when the true
 *  answer is that this engine's bar has five fields and `HL2` is not one.
 *  ⚠️ AND THE DISTINCTION IS A BEST EFFORT, SAID OUT LOUD: thinkorswim's
 *  vocabulary is thousands of names and this is the handful the reference lists
 *  as bar-derived prices, so an unlisted built-in still reads as `:undefined`.
 *  Every entry here is one the corpus or the reference's Constants page names. */
const TS_BUILTIN_PRICES = Object.freeze(new Set([
  'hl2', 'hlc3', 'ohlc4', 'vwap', 'open_interest', 'imp_volatility', 'tick', 'bid', 'ask',
]))

const nameOf = (tok) => tok.value

/** The default of an `input NAME = { … };`.
 *
 *  ⭐ THE ARM MARKED `default` WINS, AND WHERE NONE IS MARKED THE FIRST DOES —
 *  which is what the reference says the platform does. `24-position-capital`
 *  writes `default` thirteenth in a list of seventeen, so "take the first" alone
 *  would fold every one of its three colour inputs to the wrong arm.
 *
 *  ⛔⛔ AND IT RETURNS THE ARMS, WHICH IS NOT A CONVENIENCE. Returning only the
 *  chosen arm made an undeclared one UNCHECKABLE — `mode == mode.UseZ` folded to
 *  `false` and `if … then close else open` silently became `open`, with no
 *  refusal anywhere. That is a chart that looks right and is wrong, the one
 *  outcome this translator exists to prevent, and it was structural: nothing
 *  downstream HAD the list to check against. Found in W3.3 review. */
function readEnumDefault(rest, nameTok) {
  let depth = 0
  const arms = []
  let chosen = null
  let markNext = false
  for (const t of rest) {
    if (isPunctTok(t, '{')) { depth += 1; continue }
    if (isPunctTok(t, '}')) { depth -= 1; if (depth <= 0) break; continue }
    if (isPunctTok(t, ',')) continue
    if (t.kind === 'ident' && key(t.value) === 'default') { markNext = true; continue }
    if (t.kind === 'ident' || t.kind === 'string') {
      arms.push(t.value)
      if (markNext) { chosen = t.value; markNext = false }
      continue
    }
    throw refuse('thinkscript:input-kind', nameTok)
  }
  if (!arms.length) throw refuse('thinkscript:input-kind', nameTok)
  return { arms, chosen: chosen === null ? arms[0] : chosen }
}

/** What an input froze at, spelled the way the member wrote it. A single string
 *  token gives its CONTENT (`"SPY"` → `SPY`); everything else is the exact source
 *  slice, so `-2.0` reads as `-2.0` rather than as two tokens joined. */
function defaultText(rest, text) {
  if (rest.length === 1 && rest[0].kind === 'string') return rest[0].value
  const first = rest[0]
  const last = rest[rest.length - 1]
  return text.slice(first.index, last.index + last.text.length).trim()
}

/**
 * ⭐⭐ CHROME — THE LINES THAT DRAW, AND THE SENTENCE EACH ONE GETS.
 *
 * ⛔⛔ A4 SAYS "chrome calls listed as ignored lines, NEVER DROPPED". Swallowing
 * one silently would gain a script in the corpus count and be INVISIBLE there,
 * which is the exact failure this lane exists to prevent. Every entry below
 * produces a `thinkscript:note-chrome` note carrying its LINE, its COLUMN, its
 * source OFFSET and the TOKEN as the member wrote it, so the Import box can
 * point at the line it skipped.
 *
 * ⛔ ONE SENTENCE PER KIND, NEVER A GENERIC ONE. A colour, a line weight and an
 * alert are three different things to be told, and eighteen copies of one
 * sentence is a list a member learns to skip.
 *
 * ⭐ THE SET IS DERIVED FROM THE CORPUS, NOT TYPED FROM MEMORY (W3.6 step 1).
 * Every statement-level call in `tests/fixtures/thinkscript/*.ts` was extracted
 * and folded, giving exactly these method suffixes — `assignvaluecolor
 * definecolor hide hidebubble hidetitle setdefaultcolor sethiding setlineweight
 * setpaintingstrategy setstyle` — and these bare calls: `addchartbubble addcloud
 * addlabel addverticalline alert assert assignbackgroundcolor assignpricecolor`.
 * The remaining statement-level names the probe found are NOT chrome and are
 * handled elsewhere: `addorder` (a HARD `:strategy` refusal — an order is not
 * decoration), `if`/`switch` (statement keywords) and `rsi` (a study reference).
 *
 * ⚠️ TWO ENTRIES ARE PUBLISHED RATHER THAN OBSERVED, and they are marked: the
 * corpus never writes bare `DefineColor(…)` or bare `SetHiding(…)`, only the
 * `.`-suffixed forms. They are the same instruction addressed to the study
 * instead of to one plot, and are included so a paste that uses them is listed
 * rather than refused. Nothing else was added on a hunch.
 *
 * ⛔ CHROME'S ARGUMENTS ARE NEVER RESOLVED. `RSI.AssignValueColor(if RSI >
 * over_Bought then RSI.color("OverBought") else …)` (corpus 04) is full of
 * things this grammar has no node for — `.color(…)`, `GetColor(5)`,
 * `Color.DARK_GRAY` — and resolving them would turn a line we are deliberately
 * skipping into a refusal. Skipping a line means skipping what is inside it.
 */
/**
 * ⛔⛔ THE GUARDS THAT BLOCK THE WHOLE SCRIPT, AND WHY THEY HAVE TO.
 *
 * 🔴🔴 MEASURED, AND IT NEARLY SHIPPED THE OTHER WAY. When W3.6's chrome work
 * first landed, the corpus jumped 4 → 9 translating — and TWO of the five gains
 * were `08-relative-strength-zscore-vs-spy` and `24-position-capital-efficiency`.
 * Both had been blocked only by a chrome line. With the chrome listed, each
 * script's OTHER plots translated and the script reported as a working screen,
 * while the `close(symbol = "SPY")` comparison and the `GetQuantity()` position
 * size — THE ENTIRE SUBJECT OF EACH SCRIPT — were quietly reduced to one refused
 * column among several. A member would have got a "relative strength vs SPY"
 * screen with no SPY in it. ⛔ THAT IS A SILENT MISTRANSLATION BY OMISSION, and
 * it would have shown up in the corpus count as PROGRESS.
 *
 * ⭐ THE LINE IS NOT "hard to compute" — IT IS "outside a screen's world". A
 * screen answers a question about ONE symbol, on ONE timeframe, from price and
 * volume. A script that reaches for another symbol, another aggregation, the
 * clock, the account, or an order is not a screen with a gap in it; it is a
 * different kind of document, and offering a subset of its plots answers about
 * something the member did not paste. That is the same ruling `translateThinkScript`
 * already makes for an unread statement, reached from the other side.
 *
 * ⚠️ AND THE LINE IS DRAWN DELIBERATELY NARROW. `:state`, `:fold` and `:function`
 * are NOT here: those are columns this engine cannot express, in a script whose
 * remaining columns are still honestly that script's own. Widening this set to
 * them would refuse a great deal that is fine.
 */
export const TS_HARD_GUARDS = Object.freeze([
  'thinkscript:symbol',
  'thinkscript:aggregation',
  'thinkscript:time',
  'thinkscript:account',
  'thinkscript:strategy',
])

/** ⛔⛔ A STATEMENT-LEVEL CALL THAT IS NOT DECORATION. These sit beside chrome in
 *  the reader and are checked FIRST, because getting the order wrong would list
 *  a trade instruction as something skipped. Each refuses at its own token with
 *  a reason a member can act on; `addorder` blocks the whole script. */
const TS_DEFERRED_STATEMENTS = Object.freeze({
  addorder: {
    guard: 'thinkscript:strategy',
    why: 'this places an order, which is a strategy instruction rather than a study value; '
      + 'a screen answers a question about a bar and has no position to open or close. The '
      + 'plots above it were read and are shown, but the script as a whole is not a screen',
  },
})

/**
 * ⭐⭐ THE REFUSALS THAT ARE BLOCKED ON A DOCUMENT, AND THE DOCUMENT EACH ONE
 * NEEDS — the registry, and the answer to a defect class this lane named.
 *
 * 🔴🔴 AN OVER-REFUSAL IS INVISIBLE. A wrong "no" has no red test, no wrong
 * column and no complaint — only a recorded reason nobody re-reads. This whole
 * programme enforces *a refusal beats a silent mistranslation*, which is right,
 * and this is the bill for it: refusals accumulate silently and nobody audits
 * them. `RateOfChange` sat here for a WHOLE TASK carrying a reason that said the
 * page *"does not say whether the result is a ratio, a percentage or a
 * difference"* — and printed the quote, which says "percentage change". Nothing
 * failed. Nothing could have.
 *
 * ⭐ SO A REFUSAL BLOCKED ON DOCUMENTATION MUST NAME THE DOCUMENT IT NEEDS.
 * *"Unmappable"* is what let `RateOfChange` hide. *"its epoch origin is not
 * published; a vendor example showing a known instant would unblock it"* is a
 * standing instruction to whoever reads it next, and it is checkable: go and
 * look for that one thing.
 *
 * ⛔ AND THE DISTINCTION THIS REGISTRY DRAWS IS THE ONE THAT MATTERS. A missing
 * MAPPING is fetchable — the page states the identity, you cite it, done (that is
 * ruling D, and it is how the trig block moved). A missing UNIT or ORIGIN is a
 * CONVENTION, and a convention nobody can derive from an independent fact is the
 * exact input to a silent mistranslation: an epoch origin guessed wrong draws a
 * column that is plausible on every bar and wrong on every bar. So these stay
 * refused until a published example pins them — a worked example in the vendor's
 * own docs IS a citation.
 *
 * ⚠️ THIS SET'S SIZE IS THE HONEST CEILING FOR A4. Every entry is a script this
 * door could translate the day the document appears, and none of them is work.
 */
export const TS_DOC_BLOCKED = Object.freeze({
  // ⭐ THESE FOUR NOW DESCRIBE A *PARTIAL* BLOCK, AND THE WORDING TRACKS THAT.
  // The studies are MAPPED (see `TS_CALL_SHAPES`) — state every parameter the
  // page leaves undefaulted and they translate today. So `missing` names the
  // defaults that are absent, not the study, and `unblocks` says what a member can
  // do NOW as well as what a vendor page would have to print.
  RSI: {
    suggest: 'RSI(length = 14, price = close)',
    missing: 'a default `length` and `price` (the Wilder\'s `average type` and the 70/30 '
      + 'levels ARE published, and this door now uses them)',
    unblocks: 'writing them yourself — RSI(length = 14, price = close) translates today — or '
      + 'the Studies-Library page gaining a Default value column, or its description stating '
      + 'them the way ATR\'s does',
  },
  BollingerBands: {
    suggest: 'BollingerBands(price = close, length = 20, displace = 0, '
      + '"average type" = AverageType.SIMPLE)',
    missing: 'a default `price`, `average type` and `displace` (the two standard deviations '
      + 'ARE published, and this door now uses them)',
    unblocks: 'writing them yourself — BollingerBands(price = close, length = 20, displace = '
      + '0, "average type" = AverageType.SIMPLE).LowerBand translates today — or the page '
      + 'naming which average the bands are drawn around',
  },
  MovAvgExponential: {
    suggest: 'MovAvgExponential(price = close, length = 21, displace = 0)',
    missing: 'a default `price`, and a default `displace` — which shifts every bar',
    unblocks: 'writing them yourself — MovAvgExponential(price = close, length = 21, displace '
      + '= 0)."AvgExp" translates today — or the page publishing both, since `displace` '
      + 'cannot be assumed to be zero',
  },
  SimpleMovingAvg: {
    suggest: 'SimpleMovingAvg(close, 20, 0)',
    missing: 'a default `price`, `length` and `displace`',
    unblocks: 'writing them yourself — SimpleMovingAvg(close, 20, 0) translates today — or '
      + 'the page publishing them; `displace` shifts every bar so it cannot be assumed',
  },
  TTM_Squeeze: {
    missing: 'any published calculation at all',
    unblocks: 'thinkorswim publishing the formula — it is proprietary, so this one may never '
      + 'unblock, and that is the honest answer rather than a reconstruction from the '
      + 'description',
  },
  RateOfChange: {
    suggest: 'RateOfChange(price = close, length = 14)',
    missing: 'a default `length` and `price` (the MATHS is published and IS mapped)',
    unblocks: 'the page publishing the two defaults; supply both explicitly and it translates '
      + 'today',
  },
  GetTime: {
    missing: 'the UNIT the value is measured in — milliseconds or seconds since an epoch',
    unblocks: 'a worked example in thinkorswim\'s own docs showing GetTime() against a known '
      + 'instant. ⛔ A unit is a CONVENTION, not an identity: guessed wrong it draws a '
      + 'plausible column that is wrong on every bar, with no refusal anywhere',
  },
  BarNumber: {
    missing: 'the ORIGIN — whether the first bar is numbered 0 or 1',
    unblocks: 'a published example showing the number on a known bar. ⛔ This engine\'s '
      + '`barindex` is declared and ready; an off-by-one here would be invisible in the '
      + 'output and wrong on every comparison against it',
  },
})

/** ⭐⭐ THE CONVENTIONAL SPELLING OF A DOCUMENTATION-BLOCKED CALL, OFFERED AND
 *  NEVER APPLIED — the distinction this whole registry turns on.
 *
 *  ⛔⛔ THIS DOOR STILL REFUSES TO ASSUME AN UNPUBLISHED DEFAULT, and that ruling
 *  did not soften. `displace` shifts every bar; a `price` guessed wrong draws a
 *  plausible column that is wrong everywhere with no refusal anywhere. Applying
 *  one silently is the mistranslation this lane exists against, and it was priced
 *  before being refused: assuming them buys TWO corpus scripts, which is not worth
 *  a class of invisible wrongness.
 *
 *  ⭐ SO THE MEMBER APPLIES IT, NOT US. `suggest` is the call written out in full,
 *  offered as an EDIT TO THEIR SOURCE. They accept it, it lands in the script, and
 *  the formula read-back shows `length = 14, price = close` in their own text —
 *  so the number is their choice and visible, rather than ours and silent. That is
 *  `closedTable.json::_functions_na`'s ruling applied one lane over: the member
 *  says what they mean and can see that they said it.
 *
 *  ⛔ NOT EVERY BLOCKED ENTRY MAY CARRY ONE, and the absences are the honest half.
 *  `TTM_Squeeze` has no published formula at all, so there is nothing to suggest.
 *  `GetTime` is missing a UNIT and `BarNumber` an ORIGIN — a convention, not a
 *  value, and a suggested guess at one would be the silent-wrongness this refuses.
 *  A suggestion may only ever spell out arguments the member could have typed.
 *
 *  ⚠️ AND EVERY ONE IS PROVEN TO WORK rather than asserted to:
 *  `thinkscript.suggest.test.js` translates each `suggest` and fails if any of
 *  them refuses, so a suggestion cannot rot into advice that no longer applies. */

/** The tail every documentation-blocked refusal carries, derived from the one
 *  registry so a refusal and its audit entry can never drift apart. */
function docBlockedTail(name) {
  const d = TS_DOC_BLOCKED[name]
  /* istanbul ignore next — the rail pins the registry against every caller */
  if (!d) return ''
  return ` — WHAT IS MISSING IS ${d.missing}, not a way to compute it; ${d.unblocks} would `
    + 'change this answer'
}

/** ⛔ THE CALLS THIS ENGINE REFUSES BY NAME BECAUSE OF WHAT THEY READ, not
 *  because of how hard they are. Every one blocks the script (`TS_HARD_GUARDS`).
 *  ⚠️ `gettime` is refused even though W2a's `clock` section now declares a
 *  `time`: thinkorswim publishes no unit for `GetTime()` on the page this lane
 *  could fetch, and a milliseconds-vs-seconds guess is invisible in the output.
 *  The message says what it is waiting for, which is a citation, not a release. */
const TS_DEFERRED_CALLS = Object.freeze({
  gettime: { guard: 'thinkscript:time',
    why: 'this reads the clock, and a screen answers from the bar rather than from the time '
      + 'of day' + docBlockedTail('GetTime') },
  // ⭐ `BarNumber()` IS NOT A CAPABILITY GAP — the manifest's `clock` section
  // declares `barindex` and it is ready to use. What is missing is the ORIGIN,
  // and that is a CONVENTION rather than an identity: guessed wrong it is off by
  // one on every bar and on every comparison, with no refusal anywhere.
  barnumber: { guard: 'thinkscript:time',
    why: 'this counts which bar you are on' + docBlockedTail('BarNumber') },
  getyyyymmdd: { guard: 'thinkscript:time', why: 'this reads the calendar date of the bar' },
  regulartradingstart: { guard: 'thinkscript:time',
    why: 'this is the session open as a clock time, and a screen has no session boundary to '
      + 'compare a bar against' },
  regulartradingend: { guard: 'thinkscript:time',
    why: 'this is the session close as a clock time, and a screen has no session boundary to '
      + 'compare a bar against' },
  secondsfromtime: { guard: 'thinkscript:time', why: 'this measures a bar against a clock time' },
  secondstilltime: { guard: 'thinkscript:time', why: 'this measures a bar against a clock time' },
  daysfromdate: { guard: 'thinkscript:time', why: 'this counts days from a calendar date' },
  getdayofweek: { guard: 'thinkscript:time', why: 'this reads which weekday the bar fell on' },
  getquantity: { guard: 'thinkscript:account',
    why: 'this reads how many shares YOU hold, which is a fact about your account rather '
      + 'than about the symbol, and a screen has to mean the same thing for everyone' },
  getaverageprice: { guard: 'thinkscript:account',
    why: 'this reads the price YOU paid, which is a fact about your account rather than '
      + 'about the symbol' },
  getopenpl: { guard: 'thinkscript:account',
    why: 'this reads YOUR open profit and loss, which is a fact about your account rather '
      + 'than about the symbol' },
  entryprice: { guard: 'thinkscript:account',
    why: 'this reads the price YOUR position was opened at' },
  fpl: { guard: 'thinkscript:account', why: 'this reads YOUR floating profit and loss' },
})

/** ⛔ A BAR FIELD CALLED AS A FUNCTION is thinkorswim asking for that field from
 *  ANOTHER series — `close(symbol = "SPY")`, `high(period = AggregationPeriod.DAY)`.
 *  ⭐ The field set is READ FROM THE MANIFEST, never typed here, so a manifest
 *  that gains a bar field gets the same treatment with no edit. */
/** thinkorswim `AggregationPeriod` values this engine can actually serve.
 *
 *  ⛔⛔ `DAY` IS DELIBERATELY ABSENT, AND IT IS THE CARE THIS TABLE EXISTS FOR.
 *  Pine's `timeframe.period` means "whatever this chart is", so reading it as a
 *  no-op is exact. thinkorswim's values are ABSOLUTE — `DAY` means daily bars,
 *  full stop. On a daily screen that IS the identity; on an INTRADAY chart it is
 *  a higher-timeframe read this engine cannot serve, because it resamples only
 *  UPWARD from the bars it is handed. A no-op would be right in one lane and
 *  silently wrong in the other, so it refuses in both.
 *
 *  ⭐ WEEK AND MONTH ARE NOT A SHORTLIST SOMEBODY TYPED — they are what
 *  `TF_RESAMPLABLE` declares the engine can serve from daily bars. Offering a code
 *  the interpreter then refuses is the "told it would run, answers nothing" shape
 *  this codebase has already paid for twice. */
const TS_AGGREGATION_TF = Object.freeze({ week: 'W', month: 'M' })

const TS_SERIES_ARG_GUARDS = Object.freeze({
  // ⚰⚰ EVERY `why` HERE ASSERTED SOMETHING FALSE ABOUT THE ENGINE. The symbol
  // one said "a comparison against a benchmark needs a second column, not a
  // second symbol inside this one" — which is exactly what the `sym` node is,
  // and exactly what `08-relative-strength-zscore-vs-spy` asks for with
  // `close(symbol = benchmark)` where `benchmark` is an input defaulting to
  // "SPY", a ticker already ON the benchmark roster. The Pine door translates
  // that identical shape.
  symbol: { guard: 'thinkscript:symbol',
    why: 'this asks for another symbol\'s prices. The engine holds that as `sym` and '
      + 'the Pine door emits it; what is missing is folding this argument to a '
      + 'ticker here, after which the scan gate decides whether that ticker is on '
      + 'the benchmark roster' },
  period: { guard: 'thinkscript:aggregation',
    why: 'this asks for another timeframe\'s bars. The engine holds that as `tf` and '
      + 'serves weekly and monthly from daily bars; what is missing is folding this '
      + 'argument to one of those codes here' },
  aggregationperiod: { guard: 'thinkscript:aggregation',
    why: 'this asks for another timeframe\'s bars. The engine holds that as `tf` and '
      + 'serves weekly and monthly from daily bars; what is missing is folding this '
      + 'argument to one of those codes here' },
})

const TS_CHROME_METHODS = Object.freeze({
  setdefaultcolor: 'sets the colour this plot is drawn in',
  assignvaluecolor: 'colours the plot bar by bar from a value',
  assignbackgroundcolor: 'colours the chart background behind the plot',
  definecolor: 'names a colour this study can refer to later',
  color: 'reads back one of the colours this study named',
  setpaintingstrategy: 'chooses how the plot is drawn — arrows, points, a histogram',
  setlineweight: 'sets how thick the line is drawn',
  setstyle: 'sets the line style — dashed, dotted, solid',
  hidetitle: 'hides the plot`s name in the chart title',
  hidebubble: 'hides the plot`s bubble on the chart',
  hide: 'hides the plot from the chart',
  sethiding: 'hides the plot from the chart when a condition holds',
})
const TS_CHROME_CALLS = Object.freeze({
  addlabel: 'puts a text label on the chart',
  addchartbubble: 'puts a bubble on the chart',
  addcloud: 'shades the area between two plots',
  addverticalline: 'draws a vertical line on the chart',
  alert: 'raises an alert, which a screen has nowhere to deliver',
  assert: 'checks an input and stops the study — a screen has no study to stop',
  assignbackgroundcolor: 'colours the chart background',
  assignpricecolor: 'colours the price bars themselves',
  definecolor: 'names a colour this study can refer to later',
  sethiding: 'hides a plot from the chart when a condition holds',
  hidepricebars: 'hides the price bars themselves',
})

/** The chrome sentence for a parsed statement-level call, or `null`.
 *
 *  ⛔⛔ THE SUFFIX IS TAKEN FROM THE NAME, NOT FROM `call.base`, AND THAT IS
 *  MEASURED. This lexer emits a DOTTED IDENTIFIER AS ONE TOKEN — which is why
 *  `resolveDotted` splits `tok.value` on `.` rather than walking a base node — so
 *  `signal.AssignValueColor(…)` parses as a call whose `name` is the whole
 *  `signal.AssignValueColor` and whose `base` is NULL. Reading `call.base` here
 *  listed the bare `AssignBackgroundColor` on corpus `02` line 24 and left the
 *  method form on line 23 refusing, which is how this was caught: the corpus
 *  moved by nothing while the chrome count moved by one.
 *
 *  ⛔ Matched CASE-INSENSITIVELY, and the corpus is why that is not a nicety:
 *  `02` writes `AssignBackgroundCOlor`, `11` writes `UpArrow .SetPaintingStrategy`
 *  with a space before the dot, and `05` writes `setPaintingStrategy`. All three
 *  run on thinkorswim. */
function chromeOf(call) {
  const dot = String(call.name).lastIndexOf('.')
  if (dot < 0 && !call.base) {
    const bare = TS_CHROME_CALLS[key(call.name)]
    return bare === undefined ? null : bare
  }
  const suffix = dot < 0 ? call.name : String(call.name).slice(dot + 1)
  const what = TS_CHROME_METHODS[key(suffix)]
  return what === undefined ? null : what
}

/** The call written the way the member wrote it, for the note's `token`. */
function chromeToken(call) {
  if (!call.base) return call.name
  const base = call.base.e === 'name' ? call.base.name : null
  return base ? `${base}.${call.name}` : call.name
}

/** The `{ … }` run at `i`, as `[bodyTokens, indexAfter]`, or `null`. */
function braceBody(toks, i) {
  if (!isPunctTok(toks[i], '{')) return null
  let depth = 0
  for (let j = i; j < toks.length; j += 1) {
    if (isPunctTok(toks[j], '{')) depth += 1
    else if (isPunctTok(toks[j], '}')) {
      depth -= 1
      if (depth === 0) return [toks.slice(i + 1, j), j + 1]
    }
  }
  return null
}

/** A block body that is exactly `<name> = <expression> ;` — the only shape this
 *  reader accepts. Returns `{ name, expr }` or `null`.
 *  ⛔ ANY OTHER BODY IS REFUSED, NOT GUESSED. A body assigning two names, or
 *  calling something, is a program where this engine stores one expression, and
 *  picking one of its statements would answer about a different script. */
function blockAssignment(body) {
  if (body.length < 3) return null
  const nameTok = body[0]
  if (nameTok.kind !== 'ident' && nameTok.kind !== 'string') return null
  if (!isPunctTok(body[1], '=')) return null
  const rest = body.slice(2)
  // ⛔ ONE statement only: a `;` that is not the last token means two.
  const semis = rest.filter((t, i) => isPunctTok(t, ';') && i !== rest.length - 1)
  if (semis.length) return null
  const exprToks = isPunctTok(rest[rest.length - 1], ';') ? rest.slice(0, -1) : rest
  if (!exprToks.length) return null
  return { name: nameOf(nameTok), nameTok, expr: parseWhole(exprToks) }
}

/**
 * ⭐⭐ AN `if`/`switch` BLOCK THAT FILLS ONE FORWARD-DECLARED NAME IS ONE
 * EXPRESSION — and that is the whole of what this reader accepts.
 *
 * thinkorswim's tutorials write a conditional column two ways: as an `if … then
 * … else` EXPRESSION, and as a `def x;` followed by an `if … { x = a; } else { x
 * = b; }` BLOCK. They mean the same column, so this reads the second into the
 * first. `10-rsi-laguerre` and `17-compoundvalue` both use it.
 *
 * ⭐ A `switch` OVER A FOLDED ENUM INPUT IS ONE ARM. Once the input is frozen,
 * every other arm is dead code — the same ruling `pine.js` makes for a `switch`
 * on a fixed subject — so the arm the input selects becomes the expression and
 * the fold is recorded where a member can see which one they got.
 *
 * ⛔ AND IT RETURNS `false` RATHER THAN GUESSING. Anything that is not exactly
 * "one forward-declared name, assigned once per branch" falls through to
 * `thinkscript:block`, which names the word that opened the block. A block that
 * assigns two different names, or whose branches assign different names, is a
 * program; refusing it is the honest answer and the member can see where.
 */
function readAssignmentBlock(toks, ctx, kind) {
  const head = toks[0]
  const branches = []          // [{ when: tokens|null, assign }]
  let subject = null

  if (kind === 'if') {
    let i = 1
    const thenAt = toks.findIndex((t, j) => j > 0 && isWordTok(t, 'then'))
    if (thenAt < 0) return false
    const cond = toks.slice(i, thenAt)
    const consequent = braceBody(toks, thenAt + 1)
    if (!consequent) return false
    const a = blockAssignment(consequent[0])
    if (!a) return false
    i = consequent[1]
    if (!isWordTok(toks[i], 'else')) return false
    // ⚠️ `else if` is a block of its own and is NOT unrolled here: one more
    // branch is one more place to get an arm wrong silently, and nothing in the
    // corpus needs it. It refuses `:block` at the `if` that opened it.
    const alternate = braceBody(toks, i + 1)
    if (!alternate) return false
    const b = blockAssignment(alternate[0])
    if (!b) return false
    if (alternate[1] !== toks.length) return false
    if (key(a.name) !== key(b.name)) return false
    branches.push({ when: cond, assign: a }, { when: null, assign: b })
  } else {
    // switch (<subject>) { case ARM: name = expr; … [default: name = expr;] }
    if (!isPunctTok(toks[1], '(')) return false
    let depth = 0
    let close = -1
    for (let j = 1; j < toks.length; j += 1) {
      if (isPunctTok(toks[j], '(')) depth += 1
      else if (isPunctTok(toks[j], ')')) { depth -= 1; if (depth === 0) { close = j; break } }
    }
    if (close < 0) return false
    subject = toks.slice(2, close)
    if (subject.length !== 1 || subject[0].kind !== 'ident') return false
    const body = braceBody(toks, close + 1)
    if (!body || body[1] !== toks.length) return false
    const inner = body[0]
    const starts = []
    for (let j = 0; j < inner.length; j += 1) {
      if (isWordTok(inner[j], 'case') || isWordTok(inner[j], 'default')) starts.push(j)
    }
    if (!starts.length) return false
    for (let s = 0; s < starts.length; s += 1) {
      const from = starts[s]
      const to = s + 1 < starts.length ? starts[s + 1] : inner.length
      const isDefault = isWordTok(inner[from], 'default')
      const colon = inner.findIndex((t, j) => j > from && j < to && isPunctTok(t, ':'))
      if (colon < 0) return false
      const arm = isDefault ? null : inner.slice(from + 1, colon)
      if (!isDefault && (arm.length !== 1 || arm[0].kind !== 'ident')) return false
      const assign = blockAssignment(inner.slice(colon + 1, to))
      if (!assign) return false
      branches.push({ when: isDefault ? null : arm[0], assign })
    }
    const first = branches[0].assign.name
    if (branches.some((b) => key(b.assign.name) !== key(first))) return false
  }

  const name = branches[0].assign.name
  const prior = ctx.env.get(key(name))
  // ⛔ IT MUST FILL A NAME ALREADY DECLARED. `def dataPrice;` then the block is
  // the published shape; a block that invents a binding is a different statement
  // and is not this reader's to accept.
  if (!prior || prior.kind !== 'forward') return false

  if (kind === 'switch') {
    // ⭐ THE SUBJECT MUST BE A FOLDED ENUM INPUT, and the arm it selects is the
    // column. Anything else — a number, a series, an unfrozen name — is a
    // genuine runtime switch and refuses.
    const bound = ctx.env.get(key(subject[0].value))
    if (!bound || bound.kind !== 'enum' || !Array.isArray(bound.arms)) return false
    const chosen = branches.find((b) => b.when && key(b.when.value) === key(bound.arm))
      || branches.find((b) => b.when === null)
    if (!chosen) return false
    // ⛔ AND EVERY ARM MUST BE ONE THE INPUT DECLARES. A `case` naming something
    // the input has no choice for is a typo that would otherwise be silently
    // unreachable — the same undeclared-arm rule `resolveDotted` keeps.
    for (const b of branches) {
      if (b.when && !bound.arms.some((x) => key(x) === key(b.when.value))) {
        throw refuse('thinkscript:enum-arm', b.when)
      }
    }
    ctx.env.set(key(name), { kind: 'def', expr: chosen.assign.expr, tok: prior.tok })
    return true
  }

  const [ifBranch, elseBranch] = branches
  ctx.env.set(key(name), {
    kind: 'def',
    tok: prior.tok,
    expr: {
      e: 'if',
      cond: parseWhole(ifBranch.when),
      then: ifBranch.assign.expr,
      otherwise: elseBranch.assign.expr,
      tok: head,
    },
  })
  return true
}

/** Read one statement into the program under construction.
 *
 * ⛔ ONE RULE DECIDES WHAT A BARE EXPRESSION IS, AND IT IS THE RULE THAT KEEPS
 * `AddLabel(…)` FROM BECOMING A COLUMN: a statement that is nothing but a CALL
 * answers with no value to screen on — it draws, alerts, orders or asserts. If
 * it is CHROME it is listed in `ignored[]` with its line and its own sentence;
 * if it is not, it still refuses `thinkscript:statement` at the call, because a
 * statement-shaped call this lane has never seen is not something to skip
 * quietly. Anything else bare IS the output, which is what
 * `16-scan-rsi-crosses-30-70` needs: it has no `plot`, no `def` and no `;`. */
function readStatement(toks, ctx) {
  const head = toks[0]
  const k = head.kind === 'ident' ? key(head.value) : null

  const bindNew = (name, binding) => {
    if (ctx.env.has(key(name))) throw refuse('thinkscript:statement', binding.tok)
    ctx.env.set(key(name), binding)
  }

  if (k === 'declare') {
    const word = toks[1]
    if (!word || word.kind !== 'ident') throw refuse('thinkscript:statement', head)
    ctx.declaration = key(word.value)
    ctx.ignored.push(noteValue('thinkscript:note-declare', head.line, head.column,
      `\`${head.text} ${word.text}\``))
    return
  }

  if (k === 'input') {
    const nameTok = toks[1]
    if (!nameTok || (nameTok.kind !== 'ident' && nameTok.kind !== 'string')) throw refuse('thinkscript:statement', head)
    const name = nameOf(nameTok)
    if (toks.length === 2) {
      // Bound anyway, so a USE of it refuses by name too rather than reading as
      // a typo — but the declaration is what carries the first refusal.
      ctx.env.set(key(name), { kind: 'no-default', tok: nameTok })
      throw refuse('thinkscript:input-kind', nameTok)
    }
    if (!isPunctTok(toks[2], '=')) throw refuse('thinkscript:statement', head)
    const rest = toks.slice(3)
    if (!rest.length) throw refuse('thinkscript:input-kind', nameTok)
    if (isPunctTok(rest[0], '{')) {
      const { arms, chosen } = readEnumDefault(rest, nameTok)
      bindNew(name, { kind: 'enum', family: key(name), arm: chosen, arms, tok: nameTok, input: true })
      ctx.folded.push({ name, folded: chosen, line: nameTok.line, column: nameTok.column })
      return
    }
    const expr = parseWhole(rest)
    bindNew(name, { kind: 'input', expr, tok: nameTok })
    ctx.folded.push({ name, folded: defaultText(rest, ctx.text), line: nameTok.line, column: nameTok.column })
    return
  }

  if (k === 'def' || k === 'rec' || k === 'plot') {
    const nameTok = toks[1]
    if (!nameTok || (nameTok.kind !== 'ident' && nameTok.kind !== 'string')) throw refuse('thinkscript:statement', head)
    const name = nameOf(nameTok)
    // ⭐⭐ A `plot` NEVER OVERWRITES A NAME A `def` ALREADY BOUND — it keeps its
    // expression inline instead, and the earlier binding stays the one every
    // reader sees. `11-money-flow-index-mobile` is published as
    // `def mfi = …; plot MFI = mfi;`, and identifiers here fold case-insensitively
    // (measured: `02` reads `Value` back as `value`, `21` reads `ArrowUp` back as
    // `ArrowUP`, `22` reads `open` back as `OPEN`), so those two are ONE key.
    // Rebinding would make the plot read itself — a cycle refusal on a published
    // script; refusing the statement would be a wall at a line that is not the
    // member's problem. ⚠️ A colliding `def` still refuses: a variable really
    // cannot be defined twice, and that is a different fact from this one.
    // ⛔ THE SAME PLOT NAME TWICE IS A DUPLICATE COLUMN, NOT A SHADOW. W3.3
    // disclosed this asymmetry and review asked for the guard: a duplicate `def`
    // refused while a duplicate `plot` quietly produced two columns both titled
    // `p` with `ok: true`. ⚠️ Checked BEFORE `shadowed`, because it is the
    // shadowing rule below that would otherwise absorb it.
    if (k === 'plot') {
      if (ctx.plotted.has(key(name))) throw refuse('thinkscript:statement', nameTok)
      ctx.plotted.add(key(name))
    }
    const shadowed = k === 'plot' && ctx.env.has(key(name))
    if (toks.length === 2) {
      // ⭐ A FORWARD DECLARATION. `10-rsi-laguerre` writes `plot RSI;` at the top
      // and `RSI = …;` forty lines down; `06`, `17` and `20` all do the same with
      // `def`. One binding, filled later — never two names.
      if (!shadowed) bindNew(name, { kind: 'forward', plot: k === 'plot', tok: nameTok })
      if (k === 'plot') ctx.outputs.push({ kind: 'plot', title: name, name: shadowed ? null : key(name), tok: head, nameTok, expr: shadowed ? { e: 'name', name, tok: nameTok } : null })
      return
    }
    if (!isPunctTok(toks[2], '=')) throw refuse('thinkscript:statement', head)
    const expr = parseWhole(toks.slice(3))
    if (!shadowed) bindNew(name, { kind: 'def', expr, tok: nameTok })
    if (k === 'plot') {
      ctx.outputs.push({
        kind: 'plot', title: name, name: shadowed ? null : key(name), tok: head, nameTok, expr,
      })
    }
    return
  }

  if ((k === 'if' || k === 'switch') && readAssignmentBlock(toks, ctx, k)) return

  if (k === 'if' || k === 'switch' || k === 'script') {
    // ⛔ A BLOCK ASSIGNS ONE NAME FROM SEVERAL STATEMENTS. This engine stores a
    // single expression per column, so the shape has nowhere to go — and saying
    // so at the word that opened it is more useful than refusing the name it
    // was going to fill. ⭐ `script foo { … }` — a user-defined sub-script — is
    // the same fact: a program where one expression is stored. It reported a
    // syntax error at the script's NAME until W3.3 review.
    throw refuse('thinkscript:block', head)
  }

  if ((head.kind === 'ident' || head.kind === 'string') && isPunctTok(toks[1], '=')) {
    const name = nameOf(head)
    const prior = ctx.env.get(key(name))
    if (!prior || prior.kind !== 'forward') throw refuse('thinkscript:statement', head)
    ctx.env.set(key(name), { kind: 'def', expr: parseWhole(toks.slice(2)), tok: prior.tok })
    return
  }

  const expr = parseWhole(toks)
  if (expr.e === 'call') {
    // ⛔ THE DEFERRED CONSTRUCTS COME FIRST, because they are not decoration.
    // `addOrder` is a trade instruction: it refuses HARD and blocks the whole
    // script even though the plots above it translate perfectly well — a study
    // whose order line we did not read is a study we have not finished reading.
    const deferred = TS_DEFERRED_STATEMENTS[key(expr.name)]
    if (deferred) {
      throw new ThinkScriptRefusal(deferred.guard,
        `${REFUSALS[deferred.guard]} — ${deferred.why}`, locate(expr.tok))
    }
    const what = chromeOf(expr)
    if (what === null) throw refuse('thinkscript:statement', expr.tok)
    ctx.ignored.push(noteValue('thinkscript:note-chrome', expr.tok.line, expr.tok.column,
      `\`${chromeToken(expr)}\` ${what}`,
      { index: expr.tok.index, token: chromeToken(expr) }))
    return
  }
  ctx.outputs.push({ kind: 'condition', title: null, name: null, tok: head, nameTok: head, expr })
}

/** Every statement, read; a statement that refuses does NOT stop the rest.
 *  ⭐ THE WHOLE PROGRAM IS STILL READ AROUND A REFUSAL, because a member's
 *  chrome line must not hide the function token their column actually died on —
 *  which is the position that tells them what to do next. */
function readProgram(lexed) {
  const ctx = {
    env: new Map(), outputs: [], ignored: [...lexed.notes], folded: [],
    hard: [], declaration: null, text: lexed.text, plotted: new Set(),
  }
  for (const run of readStatements(lexed.tokens)) {
    try { readStatement(run.tokens, ctx) } catch (err) { ctx.hard.push(fromError(err)) }
  }
  ctx.ignored.sort((a, b) => (a.line - b.line) || (a.column - b.column))
  return ctx
}

// --------------------------------------------------------------------------- //
// the resolver — thinkScript names to the engine's canonical tree
// --------------------------------------------------------------------------- //

const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })
/** ⛔ NEVER CALLED DIRECTLY — `Resolver.engineCall` is the only caller, because
 *  the promise this module makes is that every engine name it emits was LOOKED
 *  UP in the closed table first. A `cCall` reachable from anywhere else is how
 *  that promise quietly stops being true. */
const cCall = (name, args) => ({ type: 'call', name, args })

/** ⚠️ A NEGATIVE LITERAL IS `u-` OF A POSITIVE ONE, which is what `parseFormula`
 *  produces and therefore what the round trip demands. Emitting `{num: -2}` for
 *  `-2.0` prints the same text and hashes differently. */
function cNum(value, tok) {
  if (!Number.isFinite(value)) throw refuse('thinkscript:type', tok)
  return value < 0
    ? cOp('u-', [{ type: 'num', value: -value }])
    : { type: 'num', value }
}

/** `Double.NaN` — the engine's not-computable, spelled the way its own parser
 *  reads it. The identity `pine.js` already uses for a bare `na`. */
const cNaN = () => cOp('/', [{ type: 'num', value: 0 }, { type: 'num', value: 0 }])

function literalInteger(node) {
  if (node && node.type === 'num' && Number.isInteger(node.value)) return node.value
  if (node && node.type === 'op' && node.name === 'u-' && node.args.length === 1
    && node.args[0].type === 'num' && Number.isInteger(node.args[0].value)) return -node.args[0].value
  return null
}

const isEnum = (v) => !!v && v.ts === 'enum'

/** ⭐⭐ thinkorswim's FIVE PUBLISHED AverageType constants, and the engine name
 *  each one is an identity for. `Constants/AverageType` lists exactly
 *  `EXPONENTIAL HULL SIMPLE WEIGHTED WILDERS` and says they are "the constants
 *  used with MovingAverage function"; `Functions/Tech-Analysis/MovingAverage`
 *  spells the same five as "Simple, Exponential, Weighted, Wilder's, and Hull".
 *
 *  ⭐ `hull → hma` IS DELIBERATE AND IS THE WHOLE DERIVED-MAP CLAIM. `hma` is
 *  measured ABSENT from `closedTable.functions`, so the arm resolves to a NAME
 *  the table lookup then refuses — which means the refusal is a fact about the
 *  manifest, not a hard-coded "no". The day a manifest declares `hma`,
 *  `MovingAverage(AverageType.HULL, …)` translates with no edit in this file,
 *  and `thinkscript.test.js` proves that with an injected table.
 *
 *  ⛔ IT IS ONE OBJECT, READ TWICE. `MovingAverage` dispatches on it and `ATR`'s
 *  averaging gate checks membership against it; a second list of the five arms
 *  is the `lesson_a_second_authority_over_one_value` shape. */
const TS_AVERAGE_TYPES = Object.freeze({
  simple: 'sma',
  exponential: 'ema',
  weighted: 'wma',
  wilders: 'rma',
  hull: 'hma',
})

/** thinkorswim's `AverageType` written back the way a member typed it, for a
 *  refusal sentence. ⛔ Derived from the arm, never a second spelling table. */
const armText = (arm) => `AverageType.${String(arm).toUpperCase()}`

/** The choices a member may write, spelled their way. ⛔ Derived from the caller's
 *  own dispatch map, so it can never list an arm the dispatch does not accept. */
const armChoices = (choices) => Object.keys(choices).map(armText).join(', ')

/**
 * ⛔⛔ WHY THIS ARGUMENT IS NOT AN `AverageType`, IN THE MEMBER'S OWN TERMS —
 * AND IT IS ONE FUNCTION BECAUSE TWO CALLERS ASK IT.
 *
 * 🔴🔴 THE W3.5 REVIEW FOUND THIS AND NOTHING ELSE WOULD HAVE. Three different
 * member mistakes reached one `refuse('thinkscript:enum-arm', …)` and therefore
 * one sentence — *"this is not one of the choices the thinkorswim input
 * declares"* — which is true for exactly one of them. A member who wrote
 * `input at = {default SIMPLE, EXPONENTIAL};` was told SIMPLE is not one of
 * their input's choices when it plainly IS one, and there was no way to learn
 * the real cause: a braces input is a different KIND of value from an
 * `AverageType` constant, however it is spelled.
 *
 * ⛔ A REFUSAL THAT CONTRADICTS THE MEMBER'S OWN LINE IS WORSE THAN A VAGUE ONE.
 * They go and fix the thing the sentence named, which was never wrong. The guard
 * was right all three times; only the words were wrong — which is why the rails
 * in `thinkscript.test.js` now assert the SENTENCE and not only the guard.
 *
 * @param {*} v the resolved value in the averaging slot
 * @param {object} tok the token a refusal about it should point at
 * @param {object} choices the CALLER's own arm→engine map (never a second list)
 */
function requireAverageType(v, tok, choices) {
  const say = (why) => new ThinkScriptRefusal('thinkscript:enum-arm',
    `${REFUSALS['thinkscript:enum-arm']} — ${why}`, locate(tok))
  if (!isEnum(v)) {
    throw say('this slot takes one of thinkorswim\'s AverageType constants and this is a '
      + `value rather than one of them; write ${armChoices(choices)}`)
  }
  if (v.family !== 'averagetype') {
    // ⛔ AN INPUT'S ARM AND A CONSTANT ARE DIFFERENT KINDS, AND THE SENTENCE SAYS
    // WHICH ONE ARRIVED. A braces input carries its declared `arms`; a dotted
    // constant of another family does not.
    // ⛔ ECHO THE MEMBER'S OWN SPELLING, NEVER THE FOLDED ONE. `family`/`arm` are
    // `key()`-folded (thinkorswim matches case-insensitively), so quoting them
    // back writes `color.RED` at somebody who typed `Color.RED` — a sentence that
    // does not match the line it is about, which is the whole defect this round
    // is fixing. The token is what they wrote.
    const written = (v.tok && v.tok.value) || `${v.family}.${v.arm}`
    throw say(Array.isArray(v.arms)
      ? `\`${written}\` is an input with its own list of choices, which is a different kind `
        + 'of value from an AverageType constant even when a choice is spelled the same way; '
        + `write ${armChoices(choices)} here instead`
      : `\`${written}\` is a ${v.family} constant, not an AverageType one; `
        + `write ${armChoices(choices)} here`)
  }
  if (!has(choices, v.arm)) {
    throw say(`${armText(v.arm)} is not one of the average types thinkorswim publishes `
      + `(${armChoices(choices)})`)
  }
}

/**
 * ⭐⭐ A NOTE THAT IS A FACT ABOUT AN ENGINE FUNCTION IS KEYED ON THE ENGINE
 * FUNCTION, NOT ON THE THINKORSWIM SPELLING THAT REACHED IT.
 *
 * 🔴 W3.5's MUTATION SWEEP FOUND THIS, AND IT WAS A REAL MISS. The seed note
 * started life on the `ExpAverage` row, so `ExpAverage(close, 12)` said the seed
 * differs and `MovingAverage(AverageType.EXPONENTIAL, close, 12)` — the SAME
 * `ema`, the same difference — said nothing. `02-macd-lookback-cross-watchlist`
 * is published with exactly that spelling, so a member pasting the commonest
 * MACD script in the corpus would have been told nothing at all. Two spellings,
 * one identity, one note: keyed here, consulted once the engine is CHOSEN, so a
 * route added later cannot arrive without it.
 *
 * ⚠️ ONLY `ema` IS LISTED, AND THE OTHER FOUR ARMS ARE DELIBERATE ABSENCES.
 * `sma` and `wma` are finite windows with nothing to seed; `rma` is EXACT
 * against `WildersAverage`'s published "the first value is calculated as the
 * simple moving average" (`closedTable::_functions_smoothing` states ours the
 * same way); `atr` matches an independent Wilder construction to 5.4e-16
 * INCLUDING its seed (`_functions_atr_convention`). A note on those would be
 * noise, and a member who learns to skip the list stops reading the one that
 * matters.
 */
const TS_NOTE_BY_ENGINE = Object.freeze({
  ema: 'thinkscript:note-seed',
})

/**
 * ⭐⭐ THE CALL SHAPES — a thinkorswim function, its OWN parameter names, and the
 * engine identity it stands for.
 *
 * ⛔ EVERY ROW IS A QUOTED IDENTITY, and `cite` is where the quote lives so it
 * travels with the row instead of ageing in a comment three screens up. A shape
 * is never "the function I believe this is" — it is the function the reference's
 * own words say it is, checked against the table that owns the engine name.
 * ⛔⛔ AND WHERE NO QUOTE COULD BE FOUND, THE NAME IS REFUSED RATHER THAN
 * GUESSED. `RSI` is the worked example and it is recorded at `_uncited` below.
 *
 * ⭐⭐ THE ARGUMENT PLAN — this is W3.5's answer to the arity rail W3.4 left
 * deliberately red. A thinkorswim parameter list and an engine argument list are
 * NOT the same length and there is no reason they should be: `ATR(length)` fills
 * `atr(high, low, close, n)`, `MovingAverage(averageType, data, length)` fills
 * `sma(data, length)`, `Round(number, numberOfDigits)` fills `round(number)`,
 * `Sqr(value)` fills `pow(value, 2)`, and `TrueRange(high, close, low)` fills no
 * single call at all. So the relationship is DECLARED instead of counted:
 *
 *   * `args[]` — ONE ENTRY PER ENGINE ARGUMENT, in the engine's own order. Each
 *     is `{from: <a thinkorswim parameter>}`, `{series: <a bar field the engine
 *     declares and the thinkorswim call does not carry>}`, or `{const: <a
 *     literal the identity requires>}`.
 *   * `gates{}` — a parameter that is CHECKED and contributes no node.
 *   * `unused{}` — a parameter deliberately dropped, WITH THE REASON.
 *
 * ⛔ AND THE RAIL CHECKS BOTH DIRECTIONS: every engine argument is filled, every
 * thinkorswim parameter is accounted for exactly once, and every `{series}` is
 * cross-checked against the ENGINE'S OWN `argRoles` at that position — so
 * `atr`'s (high, low, close) order is read off `closedTable.json` rather than
 * retyped here. Swap two and the rail reds by name. A silently dropped parameter
 * IS the mistranslation this replaces a bare count with.
 *
 * ⚠️ `defaults` CARRIES ONLY WHAT THE PAGE PUBLISHES, and a parameter with no
 * published default refuses `:arity` rather than being handed a number this
 * translator made up — a guessed default is invisible in the result, so the
 * member gets a window they never asked for and never see.
 *
 * ⚠️⚠️ A PARAMETER WHOSE PUBLISHED NAME CONTAINS A SPACE — `average type`,
 * `visible data`, `historical data`, `over bought`. The Studies-Library tables
 * render these as UI labels and the real identifier spelling is NOT published
 * anywhere this lane could fetch, so the label is written verbatim and inventing
 * `average_type` would be the guess. ⛔ WHAT A MEMBER ACTUALLY MEETS, MEASURED
 * RATHER THAN REASONED — this paragraph used to claim such a parameter "can
 * never be addressed by name … the lexer cannot produce such an identifier, so
 * `findIndex` never matches and the call refuses `:named-argument`", and BOTH
 * halves were wrong (W3.5 review):
 *   * BARE — `ATR(length = 14, average type = AverageType.SIMPLE)` refuses
 *     `thinkscript:syntax` AT `type`. The statement reader breaks on the second
 *     word; `findIndex` is never reached, so the guard named above never fires.
 *   * QUOTED — `ATR(length = 14, "average type" = AverageType.WILDERS)` WORKS.
 *     A string literal is one token, `key()` matches the declared label, and the
 *     argument lands in its slot: the call answers `atr(high, low, close, 14)`,
 *     and the SIMPLE spelling refuses at the averaging gate exactly as the
 *     positional form does. Every gate is reachable through it.
 * ⭐ SO IT IS A DOOR, AND IT IS RAILED (`thinkscript.test.js`). An untested
 * working door is one edit away from being an untested broken one, and a comment
 * explaining why something was impossible is how nobody looks again. thinkorswim's
 * own `Reserved-Words/reference` page shows the named form only for single-word
 * inputs (`BollingerBandsSMA(price = open, displace = 0, length = 30)`), so the
 * quoted spelling is this engine's reading and is said out loud rather than
 * assumed.
 *
 * ⛔ W3.4 HAD `StDev` BACKWARDS AND THE SWEEP THEN CEMENTED IT. It shipped
 * `defaults: {}` on the claim that the page published none — the page its own
 * `cite` names reads "Default values: length: 12" — so `StDev(close)`
 * OVER-REFUSED. The mutation that "killed" a guessed 12 was therefore railing
 * the wrong reading in place, which is worse than the miss: a wrong answer with
 * a test around it stops being re-checked.
 */
export const TS_CALL_SHAPES = Object.freeze({
  // ── the rolling reductions ────────────────────────────────────────────────
  average: {
    engine: 'sma',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Tech-Analysis/Average: "Returns the average value of a set of data '
      + 'for the last length bars", shown as Sum(data, length) / length; length default 12',
  },
  sum: {
    engine: 'sum',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Math---Trig/Sum: "Returns the sum of values for the specified number '
      + 'of bars. The default value of length is 12." — closedTable `sum` reads '
      + '"the sum of {0} over the last {1} bars"',
  },
  stdev: {
    engine: 'stdev',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Statistical/StDev: reimplemented on the page itself as '
      + 'Sqrt(Average(Sqr(data), length) - Sqr(Average(data, length))) — divided by length, '
      + 'i.e. the POPULATION deviation, which is the divisor closedTable declares for stdev; '
      + '"Default values: length: 12" on the same page',
  },
  highest: {
    engine: 'highest',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Tech-Analysis/Highest: "Returns the highest value of data for the last '
      + 'length bars"; Default value length 12',
  },
  lowest: {
    engine: 'lowest',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Tech-Analysis/Lowest: "Returns the lowest value of data for the last '
      + 'length bars"; Default value length 12 — the same page shape as Highest',
  },

  // ── the averages ──────────────────────────────────────────────────────────
  expaverage: {
    engine: 'ema',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Tech-Analysis/ExpAverage: "Returns the exponential moving average (EMA) '
      + 'of data with length"; "alpha is a smoothing coefficient equal to 2/(length + 1)" '
      + 'and "EMA1 = price1"; Default value length 12. SAME ALPHA as closedTable `ema`, '
      + 'DIFFERENT SEED (ours is the mean of the first full window, `_functions_smoothing`) '
      + '— carried as thinkscript:note-seed rather than hidden',
  },
  wildersaverage: {
    engine: 'rma',
    params: ['data', 'length'],
    defaults: { length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    cite: 'Functions/Tech-Analysis/WildersAverage: "Returns the Wilder\'s Moving Average of '
      + 'data with a smoothing coefficient that equals 1/length"; "The first value is '
      + 'calculated as the simple moving average and then all values are calculated as the '
      + 'exponential moving average"; Default value length 12. EXACT against closedTable '
      + '`_functions_smoothing`: alpha 1/n, seed = the mean of the first full window',
  },
  movingaverage: {
    dispatch: TS_AVERAGE_TYPES,
    dispatchOn: 'averageType',
    pending: ['hma'],
    params: ['averageType', 'data', 'length'],
    defaults: { averageType: { arm: 'simple' }, length: 12 },
    args: [{ from: 'data' }, { from: 'length' }],
    gates: { averageType: 'dispatch' },
    cite: 'Functions/Tech-Analysis/MovingAverage: '
      + 'MovingAverage(int averageType, IDataHolder data, int length); "Returns the average '
      + 'value of specified type and length for a data set. Available average types are: '
      + 'Simple, Exponential, Weighted, Wilder\'s, and Hull." Default values: averageType '
      + 'AverageType.Simple, length 12. The five arms are Constants/AverageType\'s own list',
  },

  // ── the pointwise maths ───────────────────────────────────────────────────
  absvalue: {
    engine: 'abs',
    params: ['value'],
    args: [{ from: 'value' }],
    cite: 'Functions/Math---Trig/AbsValue: "Returns the absolute value of an argument. If '
      + 'the argument is positive, the argument is returned. If the argument is negative, '
      + 'the negation of the argument is returned."',
  },
  sqrt: {
    engine: 'sqrt',
    params: ['value'],
    args: [{ from: 'value' }],
    cite: 'Functions/Math---Trig/Sqrt: "Calculates the square root of an argument."',
  },
  sqr: {
    engine: 'pow',
    params: ['value'],
    args: [{ from: 'value' }, { const: 2 }],
    cite: 'Functions/Math---Trig/Sqr: "Calculates the square of an argument." — an identity '
      + 'in this table\'s own vocabulary (`pow` reads "{0} raised to the power {1}"), so it '
      + 'needs no new engine name',
  },
  power: {
    engine: 'pow',
    params: ['number', 'power'],
    args: [{ from: 'number' }, { from: 'power' }],
    cite: 'Functions/Math---Trig/Power: Power(double number, double power); "Returns the '
      + 'value of the first argument raised to the power of the second argument."',
  },
  log: {
    engine: 'ln',
    params: ['number'],
    args: [{ from: 'number' }],
    cite: 'Functions/Math---Trig/Log: "Returns the NATURAL logarithm of an argument." — so '
      + 'this is closedTable `ln` ("the natural log of {0}") and never `log10`',
  },
  // ── the pointwise transcendentals (W3.6, ruling D) ────────────────────────
  // ⛔ "Cheap to map" was not the licence — the citation is. Each page was
  // fetched 2026-08-26 and each names its own argument's UNITS, which is the one
  // thing that could have been silently wrong here: a degrees-vs-radians reading
  // is invisible in the output and wrong on every bar. `closedTable` declares all
  // four, and the numeric block asserts cos(0)=1 and cos(π)=−1, which is what
  // makes "radians" a measurement rather than a shared assumption.
  cos: {
    engine: 'cos',
    params: ['angle'],
    args: [{ from: 'angle' }],
    cite: 'Functions/Math---Trig/Cos: Cos(double angle); "Returns the trigonometric cosine '
      + 'of an angle." The parameter row reads "Defines angle (IN RADIANS) whose cosine is '
      + 'calculated", and no default is published (the column shows "—"), which matches '
      + 'closedTable `cos` ("the cosine of {0}", lookback 0)',
  },
  sin: {
    engine: 'sin',
    params: ['angle'],
    args: [{ from: 'angle' }],
    cite: 'Functions/Math---Trig/Sin: Sin(double angle); "Returns the trigonometric sine of '
      + 'an angle."; "Defines angle (IN RADIANS) whose sine is calculated"; no default '
      + 'published — closedTable `sin` ("the sine of {0}", lookback 0)',
  },
  tan: {
    engine: 'tan',
    params: ['angle'],
    args: [{ from: 'angle' }],
    cite: 'Functions/Math---Trig/Tan: Tan(double angle); "Returns the trigonometric tangent '
      + 'of an angle."; "Defines angle (IN RADIANS) whose tangent is calculated"; no default '
      + 'published — closedTable `tan` ("the tangent of {0}", lookback 0)',
  },
  exp: {
    engine: 'exp',
    params: ['number'],
    args: [{ from: 'number' }],
    cite: 'Functions/Math---Trig/Exp: Exp(double number); "Returns the exponential value of '
      + 'a number."; "Defines number whose exponential value is returned"; no default. '
      + '⭐ THE BASE IS PUBLISHED AS AN IDENTITY, not inferred: the page\'s own Example puts '
      + 'Exp(x) beside Power(Double.E, x) and states "The results of the calculations are '
      + 'equal" — the same kind of published identity TrueRange\'s "the resulting plots '
      + 'coincide" gives. closedTable `exp` reads "e raised to {0}"',
  },

  max: {
    engine: 'max',
    params: ['value1', 'value2'],
    args: [{ from: 'value1' }, { from: 'value2' }],
    cite: 'Functions/Math---Trig/Max: Max(double value1, double value2); "Returns the '
      + 'greater of two values."',
  },
  min: {
    engine: 'min',
    params: ['value1', 'value2'],
    args: [{ from: 'value1' }, { from: 'value2' }],
    cite: 'Functions/Math---Trig/Min: Min(double value1, double value2); "Returns the '
      + 'smaller of two values."',
  },
  isnan: {
    engine: 'na',
    params: ['value'],
    args: [{ from: 'value' }],
    cite: 'Functions/Math---Trig/IsNaN: IsNaN(double value); returns true if the parameter '
      + 'is not a number and false otherwise — closedTable `na` yields bool and '
      + '"INSPECTS that state" (`_functions_na`)',
  },
  round: {
    engine: 'round',
    params: ['number', 'numberOfDigits'],
    defaults: { numberOfDigits: 2 },
    args: [{ from: 'number' }],
    gates: { numberOfDigits: 'zeroDigits' },
    cite: 'Functions/Math---Trig/Round: Round(double number, int numberOfDigits); "Rounds a '
      + 'number to a certain number of digits"; the page\'s Default-value column reads '
      + 'numberOfDigits 2. This table\'s `round` is round-to-WHOLE (half away from zero, '
      + '`_functions_rounding`), so ONLY an explicit 0 is the same function',
  },

  // ── the expansions ────────────────────────────────────────────────────────
  truerange: {
    expand: 'truerange',
    engines: ['max', 'min'],
    params: ['high', 'close', 'low'],
    args: [{ from: 'high' }, { from: 'close' }, { from: 'low' }],
    cite: 'Functions/Tech-Analysis/TrueRange: TrueRange(IDataHolder high, IDataHolder close, '
      + 'IDataHolder low) — NOTE THE ORDER. The page\'s own Example reimplements it as '
      + '`plot TrueRangeTS = Max(close[1], high) - Min(close[1], low);` beside the built-in '
      + 'and states "The resulting plots coincide forming a single curve." That sentence is '
      + 'the identity, so this emits the page\'s formula node for node',
  },

  // ── the one study whose OWN description publishes its defaults ────────────
  atr: {
    engine: 'atr',
    params: ['length', 'average type'],
    defaults: { length: 14, 'average type': { arm: 'wilders' } },
    args: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { from: 'length' }],
    gates: { 'average type': 'wildersOnly' },
    cite: 'Tech-Indicators/studies-library/A-B/ATR: "By default, the average true range is a '
      + '14-PERIOD WILDER\'S moving average of this value; both the period and the type of '
      + 'moving average can be customized using the study input parameters." That one '
      + 'sentence publishes BOTH defaults, which is why this study is mapped and the others '
      + 'are not. The three bar fields are the study\'s own definition — "the difference '
      + 'between the current high and the current low; ... the current high and the previous '
      + 'close; ... the previous close and the current low" — not a member choice. '
      + 'closedTable `_functions_atr_convention` proves our `atr` IS Wilder\'s to 5.4e-16',
  },

  // ── the accumulator ───────────────────────────────────────────────────────
  compoundvalue: {
    engine: 'accum',
    recurrence: true,
    params: ['length', 'visible data', 'historical data'],
    defaults: { length: 1 },
    // ⭐⭐ THE PLAN IS BY ROLE, NOT BY POSITION, and `argumentPlan` below turns it
    // into positions using `closedTable.json::accum.recurrence` — which is the
    // one place that says which slot is the seed, which is the body and which is
    // the warm-up. Typing `args: [seed, body, warmup]` here would be a second
    // authority over three indices the table already owns.
    argsByRole: {
      seed: { from: 'historical data' },
      body: { from: 'visible data' },
      warmup: { const: TS_STATE_WARMUP },
    },
    unused: {
      length: 'thinkorswim counts how many LEADING BARS take the historical value; this '
        + 'engine\'s accumulator re-seeds a fixed number of bars back instead, and the '
        + 'convergence gate is what makes the difference invisible after warm-up. Recorded '
        + 'as thinkscript:note-warmup rather than silently dropped.',
    },
    cite: 'Functions/Others/CompoundValue: CompoundValue(int length, IDataHolder visible '
      + 'data, IDataHolder historical data), length default 1; "Calculates a compound value '
      + 'according to following rule: if a bar number is greater than length then the '
      + 'visible data value is returned, otherwise the historical data value is returned." '
      + '=> the historical value IS the seed and the visible one IS the update, which is '
      + 'closedTable `accum(seed, update, warmupPeriod)`\'s own shape',
  },

  // ⭐ THE ONE STUDY IN THIS GROUP WHOSE MATHS IS PUBLISHED IN WORDS. Its
  // DEFAULTS still are not, so nothing here is defaulted and a partial call
  // refuses naming the parameter it is missing. See `TS_EXPANSIONS.rateofchange`
  // for the citation and for what it corrects.
  rateofchange: {
    expand: 'rateofchange',
    engines: [],
    params: ['length', 'color norm length', 'price'],
    args: [{ from: 'length' }, { from: 'price' }],
    unused: {
      'color norm length': 'thinkorswim uses this only to scale the COLOUR GRADIENT the '
        + 'study is drawn with ("The number of bars used to calculate the color gradient"), '
        + 'which changes no value; a screen has no gradient to scale.',
    },
    cite: 'Tech-Indicators/studies-library/R-S/RateOfChange: "The Rate Of Change (ROC) is an '
      + 'oscillator calculating the PERCENTAGE CHANGE of the security price relative to the '
      + 'price a specified number of periods before." Input Parameters is `Parameter | '
      + 'Description` (length, color norm length, price) with NO Default value column, so '
      + 'neither `length` nor `price` is defaulted here. Plots are ROC and ZeroLine ("Zero '
      + 'level") — the zero line is why the percentage-change form is the published one and '
      + 'the ratio form is not',
  },

  // ── the STUDY references, and what the Studies-Library pages actually publish ──
  //
  // ⛔⛔ THE STRUCTURAL FACT, RE-FETCHED 2026-08-29 RATHER THAN RE-READ. Every
  // thinkScript **Functions** page carries `Parameter | Default value |
  // Description`. Every **Studies-Library** page carries `Parameter |
  // Description` and NOTHING ELSE — there is no Default column anywhere in the
  // library. So a study's defaults exist only where its prose happens to state
  // them. Confirmed on RSI, BollingerBands and SimpleMovingAvg by walking the
  // pages again; `RSI` is a STUDY ONLY — it is absent from the Functions index —
  // so there is no Functions page with a Default column to fall back to.
  //
  // ⭐⭐ AND THE VENDOR PUBLISHES THE *RULE* WITHOUT THE *NUMBERS*.
  // `Reserved-Words/reference` states: *"If parameters values are not defined,
  // default values should be used"* and *"If the plot name is not defined,
  // study's main plot should be referenced (main is the first declared in the
  // source code)."* The second sentence IS implementable — `TS_STUDY_PLOTS`
  // below encodes each study's declaration order. The first is not, for these
  // studies, because the library never prints the values it is promising.
  //
  // 🔴🔴 SO THE ROWS BELOW ARE MAPPINGS, NOT BLANKET REFUSALS — AND THAT IS THE
  // CORRECTION THIS TASK SHIPPED. They previously read `params: []` plus an
  // unconditional `refuse`, which meant the door refused a study reference
  // **however completely the member had specified it**. A member who wrote
  // `RSI(length = 14, price = close)` — every value this engine needs, stated in
  // their own script, nothing left to invent — was told "thinkorswim publishes no
  // default `length` or `price`", a sentence about a default they had not asked
  // anyone to supply. That is an OVER-REFUSAL, and this file already names the
  // reason it survives: `TS_DOC_BLOCKED`'s header — *"a wrong 'no' has no red
  // test, no wrong column and no complaint"*. The `rsi` row had ALREADY been
  // corrected once for printing a remedy its own `params: []` made unfollowable;
  // that fix repaired the SENTENCE and left the MECHANISM, so the loop stayed.
  //
  // ⭐ WHAT CHANGED IS ONLY WHO DECIDES. `defaults` still carries EXACTLY what a
  // page prints and not one number more, so the arity pass — which already says
  // *"`price` has no value, and thinkorswim publishes no default for it"* and
  // already appends `docBlockedTail` — now names the ONE parameter actually
  // missing from the member's own call instead of a fixed list. A study whose
  // every value the member supplied translates; a study missing an unpublished
  // default refuses AT THAT PARAMETER. Nothing is assumed in either direction.
  //
  // ⛔ MEASURED, AND THE CORPUS DID NOT MOVE: 9/24 before, 9/24 after. `05` and
  // `16` still refuse (no published `price`), `07` is proprietary, and `09`/`19`
  // have a SECOND wall behind the study reference (`:aggregation` on `09` line 3,
  // `:state` on `19`) that no study resolver can reach. Both numbers were run,
  // not forecast, and the per-script guards are in `thinkscript.corpus.test.js`.
  //
  // ⭐ `ATR` REMAINS THE CONTROL: it is mapped from this same library because ITS
  // description publishes both of its missing defaults in one sentence ("a
  // 14-period Wilder's moving average"). These four have no such sentence for
  // `price`, so `price` stays undefaulted and stays the thing they refuse on.
  rsi: {
    expand: 'study',
    study: 'rsi',
    engine: 'rsi',
    params: ['length', 'over bought', 'over sold', 'price', 'average type',
      'show breakout signals'],
    // ⭐ THREE PUBLISHED DEFAULTS, AND THE THIRD IS A CORRECTION. The page's
    // description states "with default values of 30 for the oversold level and 70
    // for the overbought" AND — the clause this file's previous citation omitted —
    // **"By default, the Wilder's moving average is used in the calculation of
    // RSI"**. That sentence is a published default for `average type`, so the door
    // no longer demands it. `length` and `price` are still nowhere on the page.
    defaults: { 'over bought': 70, 'over sold': 30, 'average type': { arm: 'wilders' } },
    args: [{ from: 'price' }, { from: 'length' }],
    // ⛔ WILDER'S ONLY, BECAUSE THAT IS WHAT `rsi` IS. `interpret.js`'s `computeRSI`
    // smooths with `(avg * (period - 1) + x) / period` — Wilder's, read from the
    // implementation rather than assumed — so it answers the published default
    // exactly and answers NO OTHER arm. `RSI(…, "average type" = AverageType.SIMPLE)`
    // asks for a different function and is refused by name rather than silently
    // given this one.
    gates: { 'average type': 'wildersOnly' },
    unused: {
      'over bought': 'thinkorswim uses this only to place the horizontal OverBought LEVEL '
        + 'and to colour breakout signals; it changes no value of the RSI line itself, and a '
        + 'screen compares the line against whatever number you write.',
      'over sold': 'the OverSold LEVEL line, exactly as `over bought` — a horizontal '
        + 'reference at a published 30, which changes nothing about the RSI value a screen '
        + 'filters on.',
      'show breakout signals': 'this toggles the UpSignal/DownSignal arrows the study draws '
        + 'when the line crosses those levels; it is a drawing switch and changes no value.',
    },
    cite: 'Tech-Indicators/studies-library/R-S/RSI (re-fetched 2026-08-29): Input Parameters '
      + 'is `Parameter | Description` with rows length, over bought, over sold, price, '
      + 'average type, show breakout signals — NO Default value column. The description '
      + 'publishes "with default values of 30 for the oversold level and 70 for the '
      + 'overbought" and "By default, the Wilder\'s moving average is used in the calculation '
      + 'of RSI", and publishes NOTHING for length or price. ⭐ RSI is a STUDY ONLY — it is '
      + 'absent from the Functions/Tech-Analysis index (which lists Average, ExpAverage, '
      + 'MovingAverage, WildersAverage …), so no Default-value column exists for it anywhere',
  },
  bollingerbands: {
    expand: 'study',
    study: 'bollingerbands',
    // ⭐ THE MIDLINE'S AVERAGE IS DISPATCHED, exactly as `MovingAverage` dispatches:
    // the page says the bands sit around "a moving average" and names the five
    // types without picking one, so the arm the member writes chooses the engine
    // and an arm this table cannot serve refuses by name.
    dispatch: TS_AVERAGE_TYPES,
    dispatchOn: 'average type',
    engines: ['stdev'],
    params: ['price', 'displace', 'length', 'num dev dn', 'num dev up', 'average type'],
    // ⭐ THE ONLY PUBLISHED PAIR, AND THE SIGNS ARE thinkorswim's OWN INPUT
    // CONVENTION: the description publishes "two lines plotted, BY DEFAULT, two
    // standard deviations above and below a moving average", and the study takes
    // that as a signed multiplier per band (`num dev dn` negative = below). The
    // band is built as `mid + numDev * stdev`, so -2/+2 reproduce the published
    // placement. `price`, `displace` and `average type` are published nowhere.
    defaults: { 'num dev dn': -2, 'num dev up': 2 },
    args: [{ from: 'price' }, { from: 'length' },
      { from: 'num dev dn' }, { from: 'num dev up' }],
    gates: { displace: 'zeroDisplace', 'average type': 'dispatch' },
    cite: 'Tech-Indicators/studies-library/A-B/BollingerBands (re-fetched 2026-08-29): Input '
      + 'Parameters is `Parameter | Description` (rows: price, displace, length, num dev dn, '
      + 'num dev up, average type), NO Default value column. The description publishes the '
      + 'multiplier only — "two lines plotted, BY DEFAULT, two standard deviations above and '
      + 'below a moving average" — and names the average types without picking one. Plots '
      + 'are declared MidLine, LowerBand, UpperBand IN THAT ORDER, which is what makes a '
      + 'bare reference MidLine per Reserved-Words/reference. ⭐ closedTable `stdev` is the '
      + 'POPULATION deviation, which is the divisor thinkorswim\'s own StDev page '
      + 'reimplements itself with',
  },
  movavgexponential: {
    expand: 'study',
    study: 'movavgexponential',
    engine: 'ema',
    params: ['price', 'length', 'displace', 'show breakout signals'],
    args: [{ from: 'price' }, { from: 'length' }],
    gates: { displace: 'zeroDisplace' },
    unused: {
      'show breakout signals': 'this toggles the UpSignal/DownSignal arrows drawn where price '
        + 'crosses the average; it is a drawing switch and changes no value of the average.',
    },
    cite: 'Tech-Indicators/studies-library/M-N/MovAvgExponential: `Parameter | Description`, '
      + 'NO Default value column; rows price, length, displace, show breakout signals. '
      + '`displace` — "The displacement of the EMA study, in bars. Positive values signify '
      + 'backward displacement." Plots are AvgExp, UpSignal, DownSignal in that order. '
      + '⭐ `ExpAverage` IS separately mapped from the FUNCTIONS library, whose page DOES '
      + 'publish length 12 — same maths, different page, and only that page carries a default',
  },
  simplemovingavg: {
    expand: 'study',
    study: 'simplemovingavg',
    engine: 'sma',
    params: ['price', 'length', 'displace', 'show breakout signals'],
    args: [{ from: 'price' }, { from: 'length' }],
    gates: { displace: 'zeroDisplace' },
    unused: {
      'show breakout signals': 'this toggles the UpSignal/DownSignal arrows drawn where price '
        + 'crosses the average; the page states "By default, breakout signals are disabled", '
        + 'and either way it is a drawing switch that changes no value of the average.',
    },
    cite: 'Tech-Indicators/studies-library/R-S/SimpleMovingAvg (re-fetched 2026-08-29): '
      + '`Parameter | Description`, NO Default value column; rows price, length, displace, '
      + 'show breakout signals. `displace`: "The displacement of the SMA study, in bars." '
      + 'Plots are SMA, UpSignal, DownSignal in that order. The only default its description '
      + 'publishes is for `show breakout signals` ("By default, breakout signals are '
      + 'disabled"), which changes no value. ⭐ `Average` IS separately mapped from the '
      + 'Functions library, which publishes length 12',
  },
  ttm_squeeze: {
    params: [],
    refuse: {
      guard: 'thinkscript:study-ref',
      message: 'thinkorswim publishes no formula for the TTM Squeeze study at all, so there '
        + 'is nothing to translate it into — this door will not reconstruct a proprietary '
        + 'indicator from its description'
        + docBlockedTail('TTM_Squeeze'),
    },
    cite: 'Tech-Indicators/studies-library/S-T/TTM_Squeeze: proprietary; the page describes '
      + 'what the study shows and publishes no calculation',
  },

  // ── the published names that REFUSE, by name, with the reason ─────────────
  highestall: {
    params: ['data'],
    refuse: {
      guard: 'thinkscript:function',
      message: 'HighestAll reads every bar in the chart, so its answer would change with how '
        + 'many bars were fetched; write Highest(data, length) with the window you mean',
    },
    cite: 'Functions/Tech-Analysis/HighestAll: "Returns the highest value of data for ALL '
      + 'BARS IN THE CHART." A value that depends on the request is the same exclusion '
      + 'closedTable makes for `obv` (`lesson_a_derived_value_must_not_depend_on_the_request`)',
  },
  lowestall: {
    params: ['data'],
    refuse: {
      guard: 'thinkscript:function',
      message: 'LowestAll reads every bar in the chart, so its answer would change with how '
        + 'many bars were fetched; write Lowest(data, length) with the window you mean',
    },
    cite: 'Functions/Tech-Analysis/LowestAll: the HighestAll page\'s companion — "for all '
      + 'bars in the chart" — refused for the same reason',
  },
})

/** ⛔⛔ THE NAMES THIS TASK LOOKED UP AND REFUSED TO MAP, AND WHY EACH ONE.
 *
 *  ⭐ THIS IS THE PRODUCT, NOT AN APOLOGY. "If you cannot find a citation for a
 *  function's semantics, refuse it by name rather than guessing" is the rule this
 *  door exists to keep, and a refusal nobody wrote down gets re-litigated as an
 *  oversight. Every entry was FETCHED on 2026-08-26 before it was refused.
 *
 *  ⛔⛔ AND THERE IS NO NAME-COLLISION FALLBACK, DELIBERATELY. `pine.js` maps any
 *  `ta.<name>` straight onto `TABLE.functions` because Pine's namespace makes
 *  that unambiguous. thinkScript has no namespace, and the same trick here is a
 *  mistranslation machine: `MACD(12, 26, 9)` is thinkorswim's MACD study with
 *  fast 12 / slow 26 / signal 9, while this engine's `macd(series, int, int)`
 *  would read it as the MACD **of the number 12** with periods 26 and 9. That
 *  parses, prints, round-trips and saves — a plausible line that is not the
 *  member's indicator. So a thinkorswim name reaches the engine only through a
 *  CITED row above.
 *
 *  ⚠️ THE STRUCTURAL FACT BEHIND FOUR OF THESE: a thinkScript **Functions**
 *  reference page carries a "Default value" column; a **Studies Library** page
 *  does NOT (measured, 2026-08-26, on RSI / ATR / SimpleMovingAvg /
 *  RateOfChange). So a study is mappable only where its own DESCRIPTION states
 *  the missing defaults in prose, which is true of `ATR` and of none of these. */
export const TS_UNCITED = Object.freeze({
  Floor: 'closedTable declares no `floor` and no `ceil`; `round` is round-to-whole, which is '
    + 'a different function on every value whose fraction is at least one half.',
})

/**
 * 🔴🔴 W3.6 MOVED THE STUDY NAMES OUT OF `TS_UNCITED` AND INTO CITED ROWS ABOVE,
 * AND ONE OF THEM WAS A REFUSAL THIS FILE HAD GOT WRONG.
 *
 * `RSI`, `SimpleMovingAvg`, `MovAvgExponential`, `BollingerBands` and
 * `TTM_Squeeze` now each have a `TS_CALL_SHAPES` row carrying its own `cite` and
 * its own refusal sentence, so the page it was read from travels with the
 * refusal instead of living in a second list. Their guard moved from
 * `:function` — which said "this engine declares no function for that call",
 * false for every one of them, since `rsi`, `sma` and `ema` are all declared —
 * to `:study-ref`, which says what is actually missing: a published default.
 *
 * ⛔⛔ AND `RateOfChange` IS NOW MAPPED, WHICH MEANS THIS FILE HELD A FALSE
 * REFUSAL FOR A WHOLE TASK. Its entry read: *"its own description says only 'the
 * percentage change of the security price relative to the price a specified
 * number of periods before' — which does not say whether the result is a ratio,
 * a percentage, or a difference. Three readings, no quote to pick between
 * them."* ⭐ THE QUOTE IT PRINTS SAYS "PERCENTAGE CHANGE". The sentence that
 * decides the question was sitting inside the sentence claiming the question was
 * undecidable, and it survived a task, a mutation sweep and a review — because
 * everything after it re-read the claim instead of re-reading the page. W3.6
 * re-fetched and it took one line to see.
 *
 * ⚠️ THE HABIT THIS COSTS: an over-refusal is cheap for a member (one paste) and
 * expensive for this door, because nothing ever fails on it. A wrong "no" has no
 * red test, no wrong column and no complaint — only a reason nobody re-reads. It
 * is the one defect class this lane's own thesis makes invisible, and the only
 * defence is to re-derive the citation rather than the conclusion.
 */

/**
 * ⭐⭐ THE ARGUMENT PLAN, MATERIALISED — one entry per ENGINE argument, in the
 * engine's own order. ONE function, read by the builder AND by the rail, so the
 * plan a test checks is the plan the translator fills.
 *
 * ⛔ A RECURRENCE'S POSITIONS COME FROM THE TABLE. `accum`'s `recurrence` block
 * names which argument index is the seed, which is the body and which is the
 * warm-up; this reads those indices rather than restating them, which is why the
 * shape declares `argsByRole` instead of an ordered array.
 *
 * ⚠️ AN EXPANSION HAS NO SINGLE ENGINE ARITY TO FILL — `TrueRange` becomes a
 * subtraction of two calls — so its plan is one entry per thinkorswim PARAMETER
 * and the rail checks it that way instead. Returns `null` there, which is the
 * signal that it is a different kind of shape rather than a missing plan.
 */
export function argumentPlan(shape, table = TABLE) {
  if (shape.refuse || shape.expand) return null
  if (!shape.argsByRole) return shape.args
  const spec = table.functions[shape.engine]
  if (!spec || !spec.recurrence) return null
  const out = new Array(spec.args.length).fill(null)
  for (const [role, plan] of Object.entries(shape.argsByRole)) {
    const i = spec.recurrence[role]
    if (typeof i !== 'number') return null
    out[i] = plan
  }
  return out.every((p) => p !== null) ? out : null
}

/** ⭐ A CALL THAT IS AN EXACT EXPANSION IN THE TABLE'S OWN VOCABULARY, rather
 *  than one engine function. Keyed by the shape's `expand`, so a shape still
 *  declares a plan and a rail can still read it — an expansion is not an escape
 *  hatch out of the argument plan.
 *
 *  ⛔ EVERY ENGINE NAME INSIDE ONE STILL GOES THROUGH `engineCall`, which is the
 *  module header's promise: the lookup happens at translation time. */
const TS_EXPANSIONS = Object.freeze({
  /** `TrueRange(high, close, low)` → `Max(close[1], high) - Min(close[1], low)`.
   *
   *  ⭐ THAT IS THE PAGE'S OWN FORMULA, and the page's own sentence is the
   *  citation: it prints the manual reimplementation beside the built-in and says
   *  *"The resulting plots coincide forming a single curve."* Pine's three-way
   *  `max(h - l, max(|h - c1|, |l - c1|))` is the SAME column on a real bar (both
   *  measured against an independent oracle: 0 differing bars of 579) — this
   *  emits the one thinkorswim published, because a member reading their formula
   *  back should see the shape their own reference prints.
   *
   *  ⚠️ `close[1]` IS ONE SHARED NODE. The budget counts DISTINCT subtrees, so
   *  sharing costs nothing, and every walker in this engine reads trees rather
   *  than mutating them — the same arrangement `between` already uses. */
  truerange: (args, R, tok) => {
    const [high, close, low] = args
    // ⛔ `close[1][1]` AND `close[2]` ARE ONE COLUMN WITH TWO HASHES, so a member
    // who already offset the close arm is refused HERE rather than being
    // discovered by a failed round trip that could only name the output.
    if (close.node && close.node.type === 'offset') {
      throw refuse('thinkscript:offset-chained', close.tok || tok)
    }
    const prevClose = { type: 'offset', value: 1, args: [close.node] }
    return cOp('-', [
      R.engineCall('max', [{ node: prevClose, tok }, high], tok),
      R.engineCall('min', [{ node: prevClose, tok }, low], tok),
    ])
  },

  /** `RateOfChange(price, length)` → `(price / price[length] - 1) * 100`.
   *
   *  ⭐⭐ THE FORMULA IS PUBLISHED IN WORDS AND THIS CORRECTS W3.5. That task
   *  recorded ROC as unmappable because *"the description does not say whether
   *  the result is a ratio, a percentage or a difference — three readings, no
   *  quote to pick between them"*, and the W3.5 review CONFIRMED that correction.
   *  Both were wrong, and re-fetching the page rather than re-reading the claim
   *  is what found it (2026-08-26): the description's first sentence is *"an
   *  oscillator calculating the PERCENTAGE CHANGE of the security price relative
   *  to the price a specified number of periods before."* Percentage change of a
   *  value relative to an earlier one is `(new − old) / old × 100`, which leaves
   *  no reading to choose between.
   *
   *  ⭐ AND THE PAGE CORROBORATES ITSELF: it declares a second plot, `ZeroLine` —
   *  *"Zero level"* — so the oscillator is centred on ZERO. That rules out the
   *  other candidate spelling, `price / price[length] × 100`, which is centred on
   *  100 and would draw a plausible line 100 away from the right one on every
   *  bar. The numeric block asserts both directions against it.
   *
   *  ⛔ NEITHER `price` NOR `length` IS DEFAULTED, because the Studies-Library
   *  page has no Default value column. A bare `RateOfChange(14)` therefore
   *  refuses and names the parameter it is missing — the maths being citable does
   *  not make the defaults citable. */
  rateofchange: (args, R, tok) => {
    const [length, price] = args
    const n = literalInteger(length.node)
    if (n === null || n < 1) throw refuse('thinkscript:window', length.tok || tok)
    if (price.node && price.node.type === 'offset') {
      throw refuse('thinkscript:offset-chained', price.tok || tok)
    }
    const before = { type: 'offset', value: n, args: [price.node] }
    return cOp('*', [
      cOp('-', [cOp('/', [price.node, before]), { type: 'num', value: 1 }]),
      { type: 'num', value: 100 },
    ])
  },

  /**
   * ⭐⭐ A STUDY REFERENCE, AND THE LEG OF IT THE MEMBER ASKED FOR.
   *
   * One expander serves all four mapped studies because the only thing that
   * differs between them is which plot names they declare and how each plot is
   * built — and both of those are DATA, in `TS_STUDY_PLOTS`. Adding a fifth study
   * whose maths this table already declares is a row there plus a row above; it
   * is not a code path.
   *
   * ⛔ THE LEG NAME IS RESOLVED AGAINST THE STUDY'S DECLARED PLOT LIST, NEVER
   * GUESSED. `BollingerBands(…).LowerBnd` is a typo that must come back as a
   * refusal naming the three real plots — not as a silent MidLine, which is what
   * "fall back to the main plot when the name is unknown" would do, and which is
   * indistinguishable in the result from the band the member meant.
   *
   * ⭐ A BARE REFERENCE IS THE FIRST-DECLARED PLOT, and that is the vendor's own
   * rule rather than a convenience: Reserved-Words/reference says *"If the plot
   * name is not defined, study's main plot should be referenced (main is the
   * first declared in the source code)."* So `plots[0]` is the citation, which is
   * why the order in `TS_STUDY_PLOTS` is load-bearing and commented as such.
   */
  study: (args, R, tok, ctx) => {
    const spec = TS_STUDY_PLOTS[ctx.shape.study]
    /* istanbul ignore next — every `study` shape declares a plot list, pinned by a rail */
    if (!spec) throw refuse('thinkscript:study-ref', tok)
    const wanted = ctx.leg == null ? spec.plots[0] : ctx.leg
    const plot = spec.plots.find((p) => key(p) === key(wanted))
    if (!plot) {
      throw new ThinkScriptRefusal('thinkscript:study-ref',
        `${REFUSALS['thinkscript:study-ref']} — \`${ctx.name}\` declares no plot called `
        + `\`${wanted}\`; the plots it declares are ${spec.plots.join(', ')}`,
        locate(ctx.legTok || tok))
    }
    return spec.build(key(plot), args, R, tok, ctx)
  },
})

/**
 * ⭐⭐ WHAT EACH MAPPED STUDY *PLOTS*, IN ITS OWN DECLARATION ORDER — the data
 * half of the study resolver.
 *
 * ⛔ THE ORDER IS THE CITATION, NOT A STYLE CHOICE. Reserved-Words/reference:
 * *"If the plot name is not defined, study's main plot should be referenced (main
 * is the first declared in the source code)."* So reordering any `plots` array
 * silently changes what a BARE `BollingerBands(…)` means — from MidLine to a
 * band — with no test of the maths going red. Each list was read off its own
 * Studies-Library page and the page is cited in the shape above.
 *
 * ⛔⛔ A SIGNAL-ARROW PLOT REFUSES RATHER THAN BEING APPROXIMATED. `UpSignal` /
 * `DownSignal` are the crossing ARROWS thinkorswim draws — a mark at a bar, not a
 * value on every bar. `close crosses above ExpAverage(...)` is the screen a member
 * actually wants and it is one this door already translates, so the refusal says
 * that. Answering the arrow with the average, or with the crossing's price, would
 * be a plausible column that is not the plot they named.
 */
const TS_STUDY_PLOTS = Object.freeze({
  rsi: {
    plots: ['RSI', 'OverSold', 'OverBought'],
    build: (leg, args, R, tok, ctx) => {
      const [price, length] = args
      // ⭐ THE TWO LEVEL PLOTS ARE THE PUBLISHED NUMBERS THEMSELVES. They are
      // genuinely horizontal lines at `over sold` / `over bought`, so this is not
      // an approximation — it is what the study plots. They read no bar, so
      // `readsTheBar` will refuse one as a SCREEN; that is the right place for
      // that ruling and not this one's business.
      if (leg === 'oversold') return ctx.port.node('over sold').node
      if (leg === 'overbought') return ctx.port.node('over bought').node
      // ⛔ `ctx.engine`, NEVER the literal 'rsi' — the shape above already names
      // the engine, and a second copy here is the one-value-two-authorities shape
      // this repo keeps paying for.
      return R.engineCall(ctx.engine, [price, length], tok)
    },
  },
  bollingerbands: {
    // ⛔ MidLine FIRST — see the header. A bare `BollingerBands(…)` is the middle
    // average, which is exactly what corpus `05`'s band-width denominator wants.
    plots: ['MidLine', 'LowerBand', 'UpperBand'],
    build: (leg, args, R, tok, ctx) => {
      const [price, length, devDn, devUp] = args
      const mid = R.engineCall(ctx.engine, [price, length], tok)
      if (leg === 'midline') return mid
      const dev = { node: R.engineCall('stdev', [price, length], tok), tok }
      // ⭐ ONE FORM FOR BOTH BANDS, `mid + numDev * stdev` — because that is what
      // the study's two signed inputs mean. The lower band is not "minus": it is
      // `num dev dn`, whose published default is negative, and writing a
      // subtraction here would make a member's explicit `num dev dn = -2` draw the
      // band ABOVE the average.
      const mult = leg === 'lowerband' ? devDn : devUp
      return cOp('+', [mid, cOp('*', [mult.node, dev.node])])
    },
  },
  // ⭐ THE SECOND ARGUMENT IS THE IN-DIALECT REMEDY, not the engine — the engine
  // comes off `ctx`. A member reading a refusal about `MovAvgExponential` needs a
  // thinkScript line they can paste, and `ExpAverage` is the Functions-library
  // spelling of the same maths that this door already maps.
  movavgexponential: {
    plots: ['AvgExp', 'UpSignal', 'DownSignal'],
    build: (leg, args, R, tok, ctx) => signalOrAverage(leg, args, R, tok, ctx, 'ExpAverage'),
  },
  simplemovingavg: {
    plots: ['SMA', 'UpSignal', 'DownSignal'],
    build: (leg, args, R, tok, ctx) => signalOrAverage(leg, args, R, tok, ctx, 'Average'),
  },
})

/** The average itself, or a refusal naming the crossing a signal arrow really is.
 *  ⛔ ONE FUNCTION BECAUSE TWO STUDIES ASK IT — a second copy of this sentence is
 *  the `lesson_a_second_authority_over_one_value` shape, and the two would drift
 *  apart the first time either page's plot names changed. */
function signalOrAverage(leg, args, R, tok, ctx, inDialect) {
  const [price, length] = args
  if (leg === 'upsignal' || leg === 'downsignal') {
    const dir = leg === 'upsignal' ? 'above' : 'below'
    throw new ThinkScriptRefusal('thinkscript:study-ref',
      `${REFUSALS['thinkscript:study-ref']} — \`${ctx.name}\`'s ${leg === 'upsignal'
        ? 'UpSignal' : 'DownSignal'} is the ARROW thinkorswim draws on the bar where price `
      + `crosses ${dir} the average, not a value it plots on every bar; write the crossing `
      + `itself — <price> crosses ${dir} ${inDialect}(<price>, <length>) — which this door `
      + 'translates',
      locate(ctx.legTok || tok))
  }
  return R.engineCall(ctx.engine, [price, length], tok)
}

class Resolver {
  constructor(env, table, notes) {
    this.env = env
    /** ⭐ THE CLOSED TABLE THIS RUN READS. Injectable so the derived-map claim is
     *  MEASURABLE rather than argued: a table that declares `hma` makes
     *  `MovingAverage(AverageType.HULL, …)` translate with no edit in this file. */
    this.table = table || TABLE
    /** Where a per-call note lands (the seed difference, the warm-up). */
    this.notes = notes || []
    this.memo = new Map()
    this.stack = []
    this.inputs = new Set()
    this.lagged = false
    /** ⭐ THE NAME WHOSE ACCUMULATOR BODY IS BEING BUILT, or `null`. Inside it —
     *  and ONLY inside it — `name[k]` is the accumulator's own `self`. Mirrors
     *  `pine.js::buildingRecurrence`; outside, the same spelling means a bar
     *  offset of a finished column, which is a different tree. */
    this.buildingRecurrence = null
  }

  /** A note about the CALL, recorded once per occurrence. */
  note(code, tok, detail) {
    this.notes.push(noteValue(code, tok ? tok.line : null, tok ? tok.column : null, detail))
  }

  /** ⛔ A COMPILE-TIME VALUE IS NOT A COLUMN. An enum arm and a text literal are
   *  values thinkScript carries and this engine's tree has no node for, so they
   *  refuse HERE, where they are used as a number, rather than being coerced. */
  asNode(v, tok) {
    if (v && v.ts === 'bool') return { type: 'num', value: v.value ? 1 : 0 }
    if (v && v.ts === 'enum') throw refuse('thinkscript:builtin', v.tok || tok)
    if (v && v.ts === 'text') throw refuse('thinkscript:type', v.tok || tok)
    return v
  }

  resolveBinding(k, tok) {
    const cached = this.memo.get(k)
    if (cached) {
      if (cached.err) throw cached.err
      cached.inputs.forEach((n) => this.inputs.add(n))
      return cached.value
    }
    const b = this.env.get(k)
    if (!b) throw refuse('thinkscript:undefined', tok)
    if (b.kind === 'no-default') throw refuse('thinkscript:input-kind', tok)
    if (b.kind === 'forward') throw refuse('thinkscript:undefined', tok)
    if (this.stack.includes(k)) {
      // ⭐ TWO DIFFERENT FACTS, AND A MEMBER FIXES THEM DIFFERENTLY. A name that
      // reads its OWN PREVIOUS bar is carried state (`def ST = if close < ST[1]
      // …`); a name that reads itself at the SAME bar, or two names through each
      // other, has no way in at all.
      //
      // ⛔⛔ A SEEDLESS RECURSION IS REFUSED, AND THAT IS A MEASURED RULING RATHER
      // THAN A GAP. thinkorswim leaves an uninitialised `x[1]` undefined on the
      // leading bars (tutorial ch.12: a study "using past offset will be
      // initialized at a bar whose number is equal to the past offset value"),
      // and this engine's not-computable is `0 / 0`. A NaN seed is harmless ONLY
      // for an update that never reads `self` in the value it produces —
      // measured on the shared parity series, `accum(0 / 0, close < self ? high :
      // low, 250)` is identical to the zero-seeded form on all 579 bars, while
      // `accum(0 / 0, max(self, close), 250)` is NaN on EVERY one. There is no
      // seed this translator may invent, so it refuses and names the construct
      // thinkorswim itself publishes for supplying one.
      if (this.stack[this.stack.length - 1] === k && this.lagged) {
        throw new ThinkScriptRefusal('thinkscript:state',
          `${REFUSALS['thinkscript:state']} — \`${tok ? tok.value : k}\` reads its own `
          + 'previous bar with nothing to start from; wrap it in '
          + 'CompoundValue(length, thisExpression, startingValue) so it has a first value',
          locate(tok))
      }
      throw refuse('thinkscript:cycle', tok)
    }
    const outerInputs = this.inputs
    const outerLag = this.lagged
    const mine = new Set()
    if (b.kind === 'input' || b.input) mine.add(k)
    this.inputs = mine
    this.lagged = false
    this.stack.push(k)
    // ⭐⭐ THE PLAIN SELF-REFERENCE — `def x = if IsNaN(x[1]) then seed else f(x[1])`
    // — IS `CompoundValue` WEARING THE OTHER SPELLING, and this door could not
    // reach it: only `CompoundValue` ever set `buildingRecurrence`, so the plain
    // form walked back into the binding being resolved and refused as a seedless
    // recursion. It is the commonest stateful shape thinkorswim members write.
    // ⚠️ ONE RULE, BOTH LANES: `seedAndUpdateOf` is imported from `pine.js`, which
    // needed it first. Pine's `na(x[1]) ? … : …` and this `if IsNaN(x[1]) then …`
    // are the SAME canonical tree, so a second copy here is how two translators
    // come to disagree about one engine function.
    const outerBuilding = this.buildingRecurrence
    const selfRef = b.kind !== 'enum' && !!b.expr && readsOwnPreviousBar(b.expr, k)
    if (selfRef) this.buildingRecurrence = k
    let value = null
    let err = null
    try {
      value = b.kind === 'enum'
        ? { ts: 'enum', family: b.family, arm: key(b.arm), arms: b.arms, tok: b.tok }
        : this.resolve(b.expr)
      if (selfRef) value = this.foldSelfReference(value, k, b.tok || tok)
    } catch (e) { err = e }
    this.buildingRecurrence = outerBuilding
    this.stack.pop()
    this.inputs = outerInputs
    this.lagged = outerLag
    mine.forEach((n) => outerInputs.add(n))
    this.memo.set(k, { value, err, inputs: mine })
    if (err) throw err
    return value
  }

  resolveDotted(tok) {
    const parts = tok.value.split('.')
    const base = key(parts[0])
    const rest = key(parts.slice(1).join('.'))
    if (base === 'double') {
      if (rest === 'nan') return cNaN()
      if (rest === 'pi') return { type: 'num', value: Math.PI }
      // ⛔ AN INFINITY IS NOT A NUMBER A COLUMN CAN HOLD. The canonical tree
      // carries finite numbers only (`printFormula` refuses one outright), so
      // this refuses at the name rather than at the print.
      if (rest === 'positive_infinity' || rest === 'negative_infinity') throw refuse('thinkscript:type', tok)
      throw refuse('thinkscript:builtin', tok)
    }
    // ⛔⛔ A MEMBER BINDING OWNS A DOTTED NAME ONLY WHEN IT IS A BRACES ENUM —
    // THE ONLY BINDING KIND THAT HAS DOTTED ARMS AT ALL — AND THAT IS A FIX.
    //
    // 🔴 W3.5 EXPOSED THIS AND IT WAS A REAL DEFECT, NOT A NEW ONE. `input
    // averageType = AverageType.WILDERS;` is the ordinary spelling — four of the
    // 24 corpus scripts write it — and the base of that dotted constant folds to
    // `averagetype`, which is the input's OWN name. The old rule resolved the
    // binding, walked straight back into the binding being resolved, and reported
    // `thinkscript:cycle` on a published, correct script. It was invisible until
    // this task mapped `MovingAverage`, because nothing before it ever resolved
    // the input.
    //
    // ⭐ THE RULE IS THE PLATFORM'S, NOT A PATCH. `AverageType` is a reserved
    // CONSTANT namespace (`Constants/AverageType`: "the constants used with
    // MovingAverage function"), and a member input never shadows one — exactly
    // the precedence `Double` above already has, extended from one family to
    // every family, with no list to keep. A braces input is the other mechanism
    // and keeps its arms, so the undeclared-arm guard below is untouched.
    const bound = this.env.get(base)
    if (bound && bound.kind === 'enum') {
      // ⛔⛔ THE ARM MUST BE ONE THE INPUT DECLARED. `mode.UseZ` against
      // `{default UseA, UseB}` used to sail through and then quietly decide a
      // comparison, which is a mistranslation rather than a refusal.
      if (!Array.isArray(bound.arms) || !bound.arms.some((a) => key(a) === rest)) {
        throw refuse('thinkscript:enum-arm', tok)
      }
      return { ts: 'enum', family: bound.family, arm: rest, arms: bound.arms, tok }
    }
    // `Color.RED`, `AverageType.HULL`, `AggregationPeriod.DAY` — a symbolic
    // constant of thinkorswim's own, comparable with an enum input's arm and
    // refusable the moment it is asked to be a number.
    //
    // ⚠️ A NON-ENUM BINDING DOTTED READS AS ONE OF THESE NOW RATHER THAN
    // REFUSING `:builtin` HERE, AND THE GUARD IS NOT LOST — it moves one step
    // later, to `asNode`, which refuses `:builtin` for any enum asked to be a
    // number. Same sentence, same token; the only case that changes is a
    // COMPARISON of one, which refuses `:enum-arm` instead, and that is the more
    // accurate of the two.
    return { ts: 'enum', family: base, arm: rest, tok }
  }

  resolveName(tok) {
    if (tok.value.includes('.')) return this.resolveDotted(tok)
    const k = key(tok.value)
    if (this.env.has(k)) return this.resolveBinding(k, tok)
    // ⭐ THE SCRIPT'S OWN NAMES SHADOW THE ENGINE'S. `22-average-daily-range`
    // writes `def open = open(period = …);` and then reads `OPEN` — the member's
    // binding is the one they meant.
    const engine = normaliseName(k)
    if (has(this.table.series, engine)) return cSeries(engine)
    // ⭐⭐ THREE OF THESE ARE AN IDENTITY, NOT A MISSING FIELD. thinkorswim's own
    // Constants page defines `HL2` as `(high + low) / 2`, `HLC3` and `OHLC4`
    // likewise — the same definitions Pine publishes, and the sibling door has
    // expanded them all along. Refusing them here was one question with two
    // answers across two lanes. `derivedSeriesTree` is imported rather than
    // copied so the arithmetic has one owner.
    // ⚠️ THE REST OF THE SET STILL REFUSES and that is the honest half: `vwap`,
    // `open_interest`, `imp_volatility`, `tick`, `bid` and `ask` are not derivable
    // from a bar's five fields at all, so they keep saying so by name.
    const derived = derivedSeriesTree(normaliseName(k), this.table)
    if (derived) return derived
    if (TS_BUILTIN_PRICES.has(k)) throw refuse('thinkscript:builtin', tok)
    throw refuse('thinkscript:undefined', tok)
  }

  /**
   * ⛔⛔ THE ONE DOOR TO THE ENGINE'S TABLE, and every engine name this module
   * emits goes through it — the shapes above, `within`'s `highest`, `crosses`'s
   * `crossOver`/`crossUnder` and `%`'s `mod` alike. A name the table does not
   * declare refuses `:function` HERE rather than being printed into a formula
   * the engine will later fail to parse: the module header promises the lookup
   * happens at translation time, and this is where that promise is kept.
   *
   * ⭐ THE `int` CHECK IS THE REPAINT LINTER'S RULE, NOT THIS MODULE'S TASTE —
   * the same one `pine.js` applies at the same seam. `lint.js::resolveDeclaration`
   * answers UNKNOWN for a window that is not a `num` node, which fails the whole
   * tree closed to `repaints` at the save door. Refusing here names the LENGTH;
   * refusing there would name the badge. ⚠️ A negative literal is `u-` of a
   * positive one, so it is not a `num` node either and lands here too.
   *
   * ⛔ AND WHAT THIS CHECK DELIBERATELY DOES NOT DO IS ENFORCE A MINIMUM.
   * `Average(close, 0)` translates to `sma(close, 0)` and is then refused by
   * `interpret.js` — *"argument 1 must be a whole number of at least 1"* — at the
   * SAVE door rather than at the thinkorswim token, so it lands in the corpus's
   * `_blocked` set (measured, W3.5 review, minor #7). That is the honest seam:
   * the lower bound of the `int` kind is the ENGINE's declaration and lives with
   * the engine. Restating "at least 1" here would put a second authority on one
   * value, and the day the engine's bound moved the two would disagree silently —
   * the defect this repo repeats most. A refusal either way; only its address
   * differs, and W3.7's box is where a blocked column is shown.
   *
   * @param {string} name the ENGINE function
   * @param {Array<{node: object, tok: object}>} args resolved, each with the
   *   token a refusal about it should point at
   */
  engineCall(name, args, tok) {
    if (!has(this.table.functions, name)) throw refuse('thinkscript:function', tok)
    const spec = this.table.functions[name]
    // ⭐⭐ THIS LINE WAS REPORTED AS A DEAD BRANCH, AND IT IS NOT — IT WAS
    // UNEXERCISED, WHICH IS A DIFFERENT THING AND THE RAIL IS THE FIX.
    // The argument-plan rail guarantees `plan.length === spec.args.length` for
    // every SHAPE, so nothing a member types can trip it through that door. But
    // three call paths reach `engineCall` with a HAND-BUILT argument array and no
    // plan at all — `within N bars` → `highest`, `crosses [above|below]` →
    // `crossOver`/`crossUnder`, and `%` → `mod` — and for those this is the only
    // check there is. MEASURED by injecting a table whose `highest` takes three
    // arguments: `close > 5 within 3 bars` refuses `:arity` AT `within`, and the
    // same for `crosses` and `%`. The shipped shapes reach it too, because
    // `argumentPlan` builds from the SHAPE while `spec` comes from the MANIFEST —
    // so this is what catches the two disagreeing at TRANSLATION time rather than
    // printing a malformed call for the parser to choke on later.
    // ⛔ Deleting it would leave the three hand-built paths unguarded entirely.
    if (args.length !== spec.args.length) throw refuse('thinkscript:arity', tok)
    return cCall(name, args.map((a, i) => {
      if (spec.args[i] === 'int'
        && (a.node.type !== 'num' || !Number.isInteger(a.node.value))) {
        throw refuse('thinkscript:window', a.tok || tok)
      }
      return a.node
    }))
  }

  /**
   * A written thinkorswim call → the engine identity its shape declares.
   *
   * ⭐ THE k-TH POSITIONAL FILLS THE k-TH PARAMETER, which is the rule that
   * catches a slot handed two values. "Fill the leftmost FREE slot" reads
   * `Average(close, data = open)` as `sma(open, close)` — a wrong column with no
   * refusal anywhere — because it quietly slides the positional past the slot it
   * was written for. The two rules differ ONLY on that collision, which is
   * exactly the case worth refusing.
   *
   * ⛔⛔ A CALL NAME IS LOOKED UP IN THE MAP AND NEVER IN `env`, AND THAT IS A
   * DECISION RATHER THAN AN OVERSIGHT. `resolveName` does the opposite — a
   * member's binding SHADOWS an engine series, which `22-average-daily-range`
   * depends on (`def open = open(period = …);` then a read of `OPEN`). The two
   * resolvers disagree because thinkScript has two namespaces: a `def` names a
   * VALUE and can shadow a bar field, while a function name belongs to the
   * platform and a script cannot redefine one. So `def Average = 5;` followed by
   * `Average(close, 10)` is `sma(close, 10)`, the binding untouched and unread.
   * ⚠️ WRITTEN DOWN HERE BECAUSE AN UNSTATED ASYMMETRY BETWEEN TWO RESOLVERS IS
   * HOW A THIRD AUTHORITY GETS BORN — the next reader "fixes" one to match the
   * other and quietly breaks the corpus file that needs them different. Both
   * halves are pinned by test (W3.5 review, minor #9).
   */
  /** `close(symbol = …)` / `high(period = …)` — a bar field asked for from
   *  another series. Returns the refusal to throw, or `null`.
   *
   *  ⛔ THE FIELD SET COMES FROM `table.series`, so this can never disagree with
   *  what the engine actually declares as a bar field. The ARGUMENT is what
   *  decides which refusal: `symbol` and `period` are different questions and
   *  get different sentences, pointed at the argument the member wrote. */
  foreignSeriesCall(n) {
    if (n.base) return null
    const field = normaliseName(key(n.name))
    if (!has(this.table.series, field)) return null
    for (const a of n.args || []) {
      if (a.name == null) continue
      const rule = TS_SERIES_ARG_GUARDS[key(a.name)]
      if (!rule) continue
      // ⭐⭐ `symbol =` NOW TRANSLATES WHEN IT FOLDS TO A TICKER. The engine holds
      // another instrument as `sym`, the Pine door has emitted it since the node
      // landed, and this door refused it with a sentence that was false about the
      // engine: "a comparison against a benchmark needs a second column, not a
      // second symbol inside this one" — which is exactly what `sym` is.
      // ⛔ IT STILL REFUSES WHEN THE SYMBOL DOES NOT FOLD, and that is the whole
      // guard: a computed ticker is not knowable at translation time, and reading
      // the wrong instrument is worse than refusing.
      if (rule.guard === 'thinkscript:symbol') {
        const ticker = this.foreignSymbolOf(a.value)
        if (ticker) return { sym: ticker, field }
      }
      // ⭐ THE SAME SHAPE ONE ARGUMENT OVER: a period that folds to a servable
      // code becomes the engine's higher-timeframe read. One that does not —
      // `DAY`, an intraday value, anything computed — falls through to the
      // refusal, which now names what is missing rather than denying `tf` exists.
      if (rule.guard === 'thinkscript:aggregation') {
        const code = this.foreignPeriodOf(a.value)
        if (code) return { tf: code, field }
      }
      return new ThinkScriptRefusal(rule.guard,
        `${REFUSALS[rule.guard]} — ${rule.why}`, locate(a.nameTok || n.tok))
    }
    return null
  }

  /** A node that names an `AggregationPeriod` this engine can serve → its tf
   *  code, or null.
   *
   *  ⚠️ THE CONSTANT'S NAMESPACE IS CHECKED, not just its member. `WEEK` on its
   *  own is not an aggregation period, and a member could bind that name to
   *  anything; only `AggregationPeriod.WEEK` — or a name bound to it — counts.
   *
   *  ⛔ BOUNDED, and a binding is followed only to an INPUT'S DEFAULT. A period
   *  chosen per bar reaches no constant and returns null, which keeps
   *  `close(period = if … then WEEK else MONTH)` refused: there is no single
   *  timeframe that column reads. */
  foreignPeriodOf(node, depth = 0) {
    if (!node || depth > 4) return null
    if (node.e === 'member' && node.base && node.base.e === 'name'
        && key(node.base.name) === 'aggregationperiod') {
      return TS_AGGREGATION_TF[key(node.name)] || null
    }
    if (node.e === 'name') {
      // ⚠️ A DOTTED CONSTANT IS ONE TOKEN HERE, not a member expression — the
      // lexer keeps `AggregationPeriod.WEEK` whole, the same way Pine's door
      // keeps `display.none` whole. Reading only the `member` shape above matched
      // nothing at all, and the tests said so before anything shipped.
      const dot = String(node.name).indexOf('.')
      if (dot > 0) {
        const ns = key(node.name.slice(0, dot))
        return ns === 'aggregationperiod'
          ? (TS_AGGREGATION_TF[key(node.name.slice(dot + 1))] || null) : null
      }
      const bound = this.env.get(key(node.name))
      if (!bound) return null
      if (bound.kind === 'input') return this.foreignPeriodOf(bound.expr, depth + 1)
      if (bound.expr) return this.foreignPeriodOf(bound.expr, depth + 1)
      return null
    }
    return null
  }

  /** A node that names ANOTHER INSTRUMENT → its ticker, or null.
   *
   *  ⚠️ SHAPE ONLY, NOT THE ROSTER — and that is deliberate rather than lax.
   *  `pine.js::otherSymbolNameOf` validates the spelling and lets
   *  `assert_scannable` decide whether the benchmark roster allows it: ONE
   *  authority, asked once, at the gate that owns the answer. A second opinion
   *  here would let the two dialects drift about which benchmarks are permitted.
   *
   *  ⛔ BOUNDED, and a binding is followed only to an INPUT'S DEFAULT or another
   *  name. A computed symbol reaches no literal and returns null, which is what
   *  keeps `close(symbol = if … then "SPY" else "QQQ")` refused. */
  foreignSymbolOf(node, depth = 0) {
    if (!node || depth > 4) return null
    if (node.e === 'text') {
      const ticker = String(node.value).trim().toUpperCase()
      // ⭐ READ, NEVER RE-TYPED. ⚰️ I TYPED THIS COPY MYSELF one commit ago,
      // mirroring `pine.js` — which is exactly how a pattern reaches three
      // owners. `parse.js` owns it.
      return TICKER_SHAPE.test(ticker) ? ticker : null
    }
    if (node.e === 'name') {
      const bound = this.env.get(key(node.name))
      if (!bound) return null
      if (bound.kind === 'input') return this.foreignSymbolOf(bound.expr, depth + 1)
      if (bound.expr) return this.foreignSymbolOf(bound.expr, depth + 1)
      return null
    }
    return null
  }

  /**
   * @param {object} n the call node
   * @param {object|null} leg for a study reference, `{ name, tok }` naming the
   *   plot the member asked for — `BollingerBands(…).LowerBand`. `null` means no
   *   plot was named, which the vendor defines as the study's FIRST-declared plot.
   */
  resolveCall(n, leg = null) {
    // A method's receiver refuses at ITS OWN token first, so
    // `BollingerBands(length = X).LowerBand` names `BollingerBands`; and a method
    // form is never one of these shapes, so it refuses at the method name.
    if (n.base) {
      this.resolve(n.base)
      throw refuse('thinkscript:function', n.tok)
    }
    // ⚠️ A TRANSLATION, NOT A REFUSAL, IS NOW A POSSIBLE ANSWER FROM
    // `foreignSeriesCall`: `{sym, field}` means the symbol folded to a ticker and
    // the read becomes the engine's cross-symbol node.
    // ⛔⛔ WHAT IT READS IS CHECKED BEFORE WHETHER WE CAN COMPUTE IT. A bar field
    // called as a function is thinkorswim reaching for ANOTHER series — another
    // symbol or another timeframe — and naming that is far more use to a member
    // than "this engine declares no function for that call".
    const foreign = this.foreignSeriesCall(n)
    // ⭐ A TRANSLATION OR A REFUSAL. `{sym, field}` means the symbol folded to a
    // ticker, so `close(symbol = "SPY")` becomes the engine's cross-symbol read
    // over that instrument's own bar field. Anything else is still the refusal it
    // always was, thrown unchanged.
    if (foreign && foreign.sym) {
      return { type: 'sym', value: foreign.sym, args: [cSeries(foreign.field)] }
    }
    if (foreign && foreign.tf) {
      return { type: 'tf', value: foreign.tf, args: [cSeries(foreign.field)] }
    }
    if (foreign) throw foreign
    const deferredCall = TS_DEFERRED_CALLS[key(n.name)]
    if (deferredCall) {
      throw new ThinkScriptRefusal(deferredCall.guard,
        `${REFUSALS[deferredCall.guard]} — ${deferredCall.why}`, locate(n.tok))
    }
    const shape = TS_CALL_SHAPES[key(n.name)]
    if (!shape) throw refuse('thinkscript:function', n.tok)

    // ⛔ A SLOT FILLED TWICE IS NOT A WRONG ARGUMENT COUNT, AND NO LONGER SAYS IT
    // IS. Both collisions below used the bare `:arity` sentence — "handed a
    // different number of arguments than it takes" — while the member had handed
    // exactly the declared number; they would count their arguments, find them
    // right, and be stuck (W3.5 review). The guard stays `:arity` (it is one
    // slot-filling failure) and the sentence now names which collision happened.
    const twice = (p, tok) => new ThinkScriptRefusal('thinkscript:arity',
      `${REFUSALS['thinkscript:arity']} — two of them land on \`${p}\``, locate(tok))
    // ⛔ A REFUSED NAME REFUSES BEFORE ITS ARGUMENTS ARE READ, so the sentence a
    // member gets is about the FUNCTION and never about how they spelled the
    // call. `RSI(length = RSI_Length)` must be told that the study publishes no
    // default `price` — not that `length` is an argument name it does not know,
    // which is what a slot-filling pass answers first for a row that declares no
    // parameters at all.
    if (shape.refuse) {
      throw new ThinkScriptRefusal(shape.refuse.guard,
        `${REFUSALS[shape.refuse.guard]} — ${shape.refuse.message}`, locate(n.tok))
    }

    const slots = new Array(shape.params.length).fill(null)
    for (const a of n.args) {
      if (a.name == null) continue
      const i = shape.params.findIndex((p) => key(p) === key(a.name))
      if (i === -1) throw refuse('thinkscript:named-argument', a.nameTok || n.tok)
      if (slots[i]) throw twice(shape.params[i], a.nameTok || n.tok)
      slots[i] = a
    }
    let k = 0
    for (const a of n.args) {
      if (a.name != null) continue
      if (k >= slots.length) {
        // ⛔ THE REAL COUNT ERROR — and it says the count, because this is the one
        // case where counting arguments is the right thing for a member to do.
        throw new ThinkScriptRefusal('thinkscript:arity',
          `${REFUSALS['thinkscript:arity']} — ${n.name} takes `
          + `${shape.params.length} (${shape.params.join(', ')}) and was handed `
          + `${n.args.length}`,
          locate(n.tok))
      }
      if (slots[k]) {
        // ⛔ A POSITIONAL AFTER A NAMED ONE. The k-th positional fills the k-th
        // parameter, so once a name has taken that slot the positional has
        // nowhere to go — and sliding it to the next free slot is how
        // `Average(close, data = open)` would silently become `sma(open, close)`.
        throw new ThinkScriptRefusal('thinkscript:arity',
          `${REFUSALS['thinkscript:arity']} — \`${shape.params[k]}\` was already given by `
          + 'name, and a value written by position fills the slot at its own place rather '
          + 'than moving along to the next free one; name this one too, or write them all '
          + 'in order',
          locate(a.value.tok || n.tok))
      }
      slots[k] = a
      k += 1
    }

    // ⛔ EVERY PARAMETER IS PRESENT OR PUBLISHED-DEFAULTED, CHECKED BEFORE ANY OF
    // THEM IS RESOLVED. Checking as we go would resolve the first argument of a
    // call that is about to refuse for its third, which matters for a recurrence:
    // resolving its body binds `self` and must not happen speculatively.
    shape.params.forEach((p, i) => {
      // ⛔ A MISSING PARAMETER IS NOT A MISCOUNT EITHER — it names the parameter,
      // and says the reason no default filled it, because `defaults` carries ONLY
      // what the reference publishes.
      // ⚠️ A PARAMETER IN `unused` IS NOT REQUIRED, and leaving that out cost a
      // corpus script: `RateOfChange(price = …, length = …)` refused `:arity`
      // because the study's third parameter — `color norm length`, which scales a
      // COLOUR GRADIENT and changes no value — was neither supplied nor
      // defaulted. A parameter this door has already written down as
      // contributing nothing cannot also be one it demands.
      if (!slots[i] && !has(shape.defaults || {}, p) && !has(shape.unused || {}, p)) {
        // ⭐ AND IF THE WHOLE ROW IS BLOCKED ON A DOCUMENT, SAY WHICH ONE. A
        // member reading "publishes no default for it" learns what is missing;
        // the next engineer needs to know what would change the answer.
        const blocked = Object.keys(TS_DOC_BLOCKED)
          .find((k) => key(k) === key(n.name))
        throw new ThinkScriptRefusal('thinkscript:arity',
          `${REFUSALS['thinkscript:arity']} — \`${p}\` has no value, and thinkorswim `
          + 'publishes no default for it'
          + (blocked ? docBlockedTail(blocked) : ''),
          locate(n.tok),
          // ⭐ AND THE CONVENTIONAL SPELLING RIDES ALONG, so the member can accept
          // it into their own source rather than being told to go and look it up.
          blocked ? (TS_DOC_BLOCKED[blocked].suggest || null) : null)
      }
    })


    const port = this.callPort(shape, slots, n)
    if (shape.recurrence) return this.buildRecurrence(shape, port, n)

    const engine = shape.dispatch ? this.dispatchEngine(shape, port, n) : shape.engine
    const fill = (plan) => {
      if (plan.from !== undefined) return port.node(plan.from)
      if (plan.series !== undefined) return { node: cSeries(plan.series), tok: n.tok }
      return { node: cNum(plan.const, n.tok), tok: n.tok }
    }
    // ⚠️ THE GATES RUN BEFORE THE ARGUMENTS ARE FILLED, so a call refused for
    // asking the wrong average never resolves the rest of its arguments — which
    // matters because resolution records which member inputs a column folded.
    this.runGates(shape, port, n, engine)
    // ⭐ THE FOURTH ARGUMENT IS THE CALL'S CONTEXT, and it exists because a STUDY
    // expansion needs three things a plain expansion never did: which plot leg was
    // asked for, which engine the average-type dispatch chose, and the port (a
    // level plot IS one of the study's own parameters). `truerange` and
    // `rateofchange` take three parameters and ignore it, so nothing about them
    // changed.
    const built = shape.expand
      ? TS_EXPANSIONS[shape.expand](shape.args.map(fill), this, n.tok, {
        shape, engine, port, name: n.name,
        leg: leg && leg.name, legTok: leg && leg.tok,
      })
      : this.engineCall(engine, argumentPlan(shape, this.table).map(fill), n.tok)
    // ⭐ THE NOTE FOLLOWS THE ENGINE, NOT THE SPELLING — see `TS_NOTE_BY_ENGINE`.
    // ⛔ AND IT IS EMITTED LAST, AFTER THE CALL IS BUILT. Anything above this
    // line can still refuse, and a note about a seed the member never reached is
    // a sentence attached to a column that does not exist.
    if (has(TS_NOTE_BY_ENGINE, engine)) this.note(TS_NOTE_BY_ENGINE[engine], n.tok, `\`${n.name}\``)
    return built
  }

  /**
   * ⭐ THE ONE DOOR TO A CALL'S ARGUMENTS, memoised so each is resolved exactly
   * once. Resolution has side effects — it records which member inputs a column
   * folded, and for a recurrence body it binds `self` — so a parameter read twice
   * is a parameter resolved twice, and that has been a real bug class in the
   * sibling translator.
   */
  callPort(shape, slots, n) {
    const seen = new Map()
    const at = (p) => {
      const s = slots[shape.params.indexOf(p)]
      return (s && s.value && s.value.tok) || n.tok
    }
    const raw = (p) => {
      if (seen.has(p)) return seen.get(p)
      const s = slots[shape.params.indexOf(p)]
      let v
      if (s) {
        v = this.resolve(s.value)
      } else {
        const d = shape.defaults[p]
        // ⚠️ A PUBLISHED DEFAULT MAY BE AN ENUM ARM, NOT A NUMBER —
        // `MovingAverage`'s is `AverageType.Simple`. It enters as the same kind of
        // value the member would have written, so nothing downstream needs a
        // second branch for "this one was defaulted".
        v = (d && typeof d === 'object' && d.arm)
          ? { ts: 'enum', family: 'averagetype', arm: d.arm, tok: n.tok }
          : cNum(d, n.tok)
      }
      seen.set(p, v)
      return v
    }
    return {
      at,
      raw,
      written: (p) => !!slots[shape.params.indexOf(p)],
      node: (p) => ({ node: this.asNode(raw(p), at(p)), tok: at(p) }),
    }
  }

  /** The engine name an `averageType` arm resolves to.
   *
   *  ⛔ AN ARM THIS TABLE DOES NOT PUBLISH REFUSES; IT NEVER FALLS BACK TO THE
   *  DEFAULT. Falling back would answer `sma` for a member who asked for
   *  something else — a chart that looks right and is wrong, which is the one
   *  outcome this door exists against. */
  dispatchEngine(shape, port, n) {
    const p = shape.dispatchOn
    const v = port.raw(p)
    // ⛔ THE SENTENCE IS `requireAverageType`'s, not this call site's — one place
    // says why, so `MovingAverage`'s dispatch and `ATR`'s gate cannot come to
    // disagree about the same question. The CHOICES come from this shape's own
    // dispatch map, so a refusal can never name an arm this call would reject.
    requireAverageType(v, (v && v.tok) || port.at(p), shape.dispatch)
    const engine = shape.dispatch[v.arm]
    if (!has(this.table.functions, engine)) {
      // ⭐ DERIVED, NOT HARD-CODED. The arm names an engine function; the TABLE
      // is what says whether it exists. `AverageType.HULL` refuses today because
      // no manifest declares `hma`, and stops refusing the day one does.
      throw new ThinkScriptRefusal('thinkscript:function',
        `${REFUSALS['thinkscript:function']} — ${armText(v.arm)} would need \`${engine}\`, `
        + 'which this engine does not declare',
        locate((v && v.tok) || port.at(p)))
    }
    return engine
  }

  /** The parameters that are CHECKED and contribute no node. */
  runGates(shape, port, n, engine) {
    for (const [p, kind] of Object.entries(shape.gates || {})) {
      if (kind === 'dispatch') continue // consumed by dispatchEngine, above
      if (kind === 'zeroDigits') {
        // ⛔ thinkorswim's published default is TWO digits, so a bare `Round(x)`
        // asks for two decimals and this table's `round` gives a whole number.
        // Only a written 0 is the same function.
        const digits = literalInteger(this.asNode(port.raw(p), port.at(p)))
        if (digits !== 0) {
          throw new ThinkScriptRefusal('thinkscript:function',
            `${REFUSALS['thinkscript:function']} — this engine's \`${engine}\` rounds to a `
            + 'whole number, and thinkorswim rounds to '
            + `${digits === null ? 'a number of digits it cannot read here' : digits} `
            + '(the published default is 2); write Round(x, 0) for the whole-number form',
            locate(port.at(p)))
        }
        continue
      }
      if (kind === 'zeroDisplace') {
        // ⛔⛔ `displace` SHIFTS EVERY BAR OF THE PLOT, AND IT HAS NO PUBLISHED
        // DEFAULT — the two facts together are why it is a required parameter with
        // a gate rather than an `unused` one. A study drawn with `displace = 2`
        // answers about a bar two bars away from the one a screen is filtering,
        // which is invisible in the output and wrong on every row.
        //
        // ⭐ AND THE SIGN IS THE REASON THIS GATE DOES NOT JUST TRANSLATE IT. The
        // page says "Positive values signify BACKWARD displacement", which is the
        // opposite of the direction `offset` means here; getting that backwards
        // draws a plausible column shifted the wrong way. Only a written 0 is a
        // study this door can promise is the member's.
        const shift = literalInteger(this.asNode(port.raw(p), port.at(p)))
        if (shift !== 0) {
          throw new ThinkScriptRefusal('thinkscript:function',
            `${REFUSALS['thinkscript:function']} — \`displace\` shifts every bar of the plot, `
            + `and this reads ${shift === null ? 'a displacement it cannot read here'
              : shift}; thinkorswim publishes no default for it and states that POSITIVE `
            + 'values mean BACKWARD displacement, so only a written displace = 0 is a study '
            + 'this door can promise is the one you drew',
            locate(port.at(p)))
        }
        continue
      }
      if (kind === 'wildersOnly') {
        const v = port.raw(p)
        requireAverageType(v, (v && v.tok) || port.at(p), TS_AVERAGE_TYPES)
        if (v.arm !== 'wilders') {
          // ⛔ THE NOUN IS THE ENGINE, NOT "the true range". This gate had ONE
          // caller (`ATR`) and its sentence hard-coded that caller's subject; the
          // moment `RSI` became the second caller it told a member that this
          // engine's RSI is "Wilder's average of the true range", which is a
          // sentence about a different indicator. Wilder's SMOOTHING is the thing
          // both engines actually share, and naming the engine keeps the sentence
          // true for whichever one raised it.
          throw new ThinkScriptRefusal('thinkscript:function',
            `${REFUSALS['thinkscript:function']} — this engine's \`${engine}\` is computed `
            + `with Wilder's smoothing, which is the average thinkorswim publishes as this `
            + `study's default, and ${armText(v.arm)} asks for a different one`,
            locate(v.tok || port.at(p)))
        }
        continue
      }
      /* istanbul ignore next — unreachable while the gate names are closed */
      throw refuse('thinkscript:function', n.tok)
    }
  }

  /**
   * ⭐⭐ `CompoundValue` IS THE ENGINE'S BOUNDED ACCUMULATOR, AND THE GATE IS WHY
   * THAT IS SAFE.
   *
   * The reference: *"if a bar number is greater than `length` then the visible
   * data value is returned, otherwise the historical data value"* — so the
   * historical arm IS the seed and the visible arm IS the per-bar update, which
   * is `accum(seed, update, warmupPeriod)`'s own shape. The three POSITIONS come
   * from `closedTable.json`'s `recurrence` block, never from a number typed here.
   *
   * 🔴🔴 AND AN UPDATE THAT NEVER FORGETS ITS SEED IS REFUSED. `accum` re-seeds a
   * fixed number of bars back, deliberately, so a column cannot depend on where a
   * fetch began. MEASURED on the shared parity series (579 bars): `accum(0, self
   * + volume, 250)` agrees with a rolling 250-bar sum on all 329 bars where both
   * are defined and differs from it on exactly ONE — bar 249, a one-bar warm-up
   * offset, 578 of 579 overall — while differing from the true cumulative sum on
   * 579 of 579. ⚠️ The count here read "579 of 579" for both until the W3.5
   * review re-derived it; two agreeing copies of a number read as corroboration.
   * Folding thinkorswim's running total into it would be wrong on EVERY bar
   * while drawing a perfectly plausible line — so
   * `forgetsItsSeed` is IMPORTED from `pine.js` and asked the same question the
   * other translator asks. ⛔ Never a second copy: two convergence rules is how
   * two translators come to disagree about one engine function.
   */
  buildRecurrence(shape, port, n) {
    const spec = this.table.functions[shape.engine]
    const plan = argumentPlan(shape, this.table)
    if (!spec || !spec.recurrence || !plan) throw refuse('thinkscript:function', n.tok)

    // ⛔ THE SEED RESOLVES WITH NO `self` IN SCOPE, AND FIRST. thinkorswim's
    // historical arm is evaluated on the leading bars, where the value being
    // defined does not exist yet, so a `self` reachable from it would be a cycle
    // wearing a seed's clothes. The ORDER is what enforces that, and it is read
    // off the plan's roles rather than assumed from the parameter order.
    const seedPlan = shape.argsByRole.seed
    const bodyPlan = shape.argsByRole.body
    const seed = port.node(seedPlan.from)

    const name = this.stack.length ? this.stack[this.stack.length - 1] : null
    const outer = this.buildingRecurrence
    this.buildingRecurrence = name
    let body
    try { body = port.node(bodyPlan.from) } finally { this.buildingRecurrence = outer }

    if (!forgetsItsSeed(body.node, this.table, TS_STATE_WARMUP)) {
      // 🔴🔴 THE SENTENCE IS ABOUT THIS ENGINE'S LIMIT, NOT ABOUT THE MEMBER'S
      // FORMULA — AND THAT IS A CORRECTION. It used to read "this update keeps
      // building on its own previous bar without ever forgetting where it
      // started", which is FALSE for `if <cond> then <name>[1] + 1 else 0`: a
      // consecutive-bar counter forgets its seed on every reset, and
      // `19-consecutive-bars-above-ema-count` is published with exactly that
      // shape. `forgetsItsSeed` is conservative BY CONSTRUCTION — an
      // unrecognised shape answers NO — so the honest cause is that this engine
      // cannot SEE that the update forgets, never that the update does not.
      // ⛔ A refusal that states a false fact about a member's own line sends
      // them to fix something that was never wrong. Rail: the sentence, not just
      // the guard.
      throw new ThinkScriptRefusal('thinkscript:state',
        `${REFUSALS['thinkscript:state']} — this engine's accumulator re-seeds a fixed number `
        + 'of bars back rather than running from the first bar ever drawn, so it can only '
        + 'carry an update that stops depending on the value it started from, and it cannot '
        + 'tell that this one does. A value REPLACED outright on some bars — '
        + '`if <condition> then <newValue> else <name>[1]` — is the shape it can carry; a '
        + 'running total that only ever adds to itself is not, and would come out as a '
        + 'rolling window over the last '
        + `${TS_STATE_WARMUP} bars instead`,
        locate(port.at(bodyPlan.from)))
    }

    this.note('thinkscript:note-warmup', n.tok, `\`${n.name}\``)
    const built = { [seedPlan.from]: seed, [bodyPlan.from]: body }
    const args = plan.map((p) => (p.from !== undefined
      ? built[p.from] : { node: cNum(p.const, n.tok), tok: n.tok }))
    return this.engineCall(shape.engine, args, n.tok)
  }

  /** `name[k]` INSIDE `name`'s OWN accumulator body — the lag it means, or `null`.
   *
   *  ⭐⭐ thinkorswim COUNTS FROM ONE HERE AND THIS ENGINE COUNTS FROM ZERO, and
   *  getting it wrong would be silent. Inside `x`'s update, `x[1]` is the value
   *  `x` held on the PREVIOUS bar — which is exactly what the accumulator's own
   *  `self` already is. So `x[1]` IS bare `self`, and that is the whole mapping.
   *  Write `k` where the `0` is and a published, correct script starts refusing,
   *  which is how the off-by-one is caught.
   *
   *  ⛔⛔ A DEEPER LAG REFUSES; IT IS NOT MAPPED. This returned `k - 1` — so
   *  `x[2]` became `self[1]` — and that arithmetic was UNREACHABLE: `forgetsItsSeed`
   *  is conservative by construction and answers NO for any body in which `self`
   *  appears under an offset, so nothing it produced ever survived the gate.
   *  Unreachable code reads as capability. The next engineer builds on it or
   *  cites it, and a recurrence path that becomes reachable through a later gate
   *  change would ship having never been exercised on a single bar. Deleted per
   *  the W3.5 review ruling; what would bring it back is a relaxation of
   *  `pine.js::forgetsItsSeed` — where BOTH translators read it — and that
   *  relaxation is where the mapping belongs, with its own numeric argument. */
  /** A resolved plain self-reference → the accumulator, or a refusal that names
   *  what would make it one.
   *
   *  ⛔⛔ A SEEDLESS ONE STAYS REFUSED, AND THAT IS MEASURED RATHER THAN CAUTIOUS.
   *  It is tempting to argue that when `self` appears only in a ternary's
   *  CONDITION the produced value never carries the seed, so any seed would do —
   *  the note on the seedless refusal even records a measurement that looks like
   *  it says so (`accum(0/0, close < self ? high : low, 250)` matching the
   *  zero-seeded form on all 579 bars).
   *  🔴 CONSTRUCTED ADVERSARIAL INPUTS BREAK IT. `close < self ? 0 : 1000000` is
   *  the same shape and differs on 350 of 350 computable bars between a `0/0`
   *  seed and a `1000000` one; a latch — `self > 0.5 ? 1 : (close > open ? 1 : 0)`
   *  — does the same. The branch chains only coalesce when the arms sit near each
   *  other, which is a property of that FORMULA and not of the shape. So the
   *  measurement generalises to the instance it was taken on, and the refusal is
   *  correct. Recorded here so the next reader does not re-derive the widening
   *  from the same sentence. Rail: `thinkscript.selfref.test.js`. */
  foldSelfReference(value, name, tok) {
    const node = this.asNode(value, tok)
    // ⛔ FREE, NOT MERELY PRESENT. `def x = if IsNaN(x[1]) then 0 else c` where
    // `c` is a CompoundValue resolves to a tree that MENTIONS `self` — bound by
    // that inner accumulator, not by this binding. This is imported from
    // `pine.js` rather than copied so both lanes ask one question.
    if (!containsFreeSelfSeries(node, this.table)) return value
    const parts = seedAndUpdateOf(node, this.table)
    if (!parts) {
      throw new ThinkScriptRefusal('thinkscript:state',
        `${REFUSALS['thinkscript:state']} — \`${name}\` reads its own previous bar and this `
        + 'engine can hold that only when the script states a first-bar value; write '
        + `if IsNaN(${name}[1]) then <firstValue> else <thisExpression>, or wrap it in `
        + 'CompoundValue(length, thisExpression, startingValue)',
        locate(tok))
    }
    if (!forgetsItsSeed(parts.update, this.table, TS_STATE_WARMUP)) {
      throw new ThinkScriptRefusal('thinkscript:state',
        `${REFUSALS['thinkscript:state']} — this engine's accumulator re-seeds a fixed `
        + `number of bars back rather than running from the first bar ever drawn, and `
        + `it cannot tell that \`${name}\` ever forgets where it started, so folding it `
        + `would draw a rolling window over the last ${TS_STATE_WARMUP} bars`,
        locate(tok))
    }
    const spec = this.table.functions.accum
    const args = []
    args[spec.recurrence.seed] = parts.seed
    args[spec.recurrence.body] = parts.update
    args[spec.recurrence.warmup] = { type: 'num', value: TS_STATE_WARMUP }
    return { type: 'call', name: 'accum', args }
  }

  selfLagOf(n, k) {
    if (!(k >= 1) || this.buildingRecurrence === null) return null
    if (!n.base || n.base.e !== 'name') return null
    if (key(n.base.name) !== this.buildingRecurrence) return null
    // ⭐⭐ THIS DOOR WAS ONE LANE BEHIND THE OTHER ON A CAPABILITY THE ENGINE SHIPS.
    // ⚰️ It refused every `k > 1` as "can only be read one bar back", which was true
    // of this TRANSLATOR and false of the engine: `interpret.js` has carried
    // `MAX_SELF_LAG = 4` throughout, `pine.js` learned to spell the deeper lags when
    // the 2-pole Ehlers filter landed, and the consumption site three screens down
    // was ALREADY written for a non-zero lag (`{type:'offset', value: lag}`). So the
    // refusal was a sentence, not a limit — and thinkorswim scripts that read two
    // bars of their own history were turned away from an engine that could hold them
    // (`lesson_rail_the_mirror_not_just_the_lane`).
    //
    // ⛔ THE OFF-BY-ONE IS THE WHOLE MAPPING AND IT IS NOT COSMETIC. Inside an
    // accumulator body `self` IS the previous bar's value, so thinkorswim's `x[1]`
    // is lag 0 and `x[k]` is lag `k - 1`. The ceiling therefore sits at
    // `MAX_SELF_LAG + 1`, not at `MAX_SELF_LAG`: reading `x[5]` asks the engine for
    // `self[4]`, which is exactly what it holds.
    if (k > MAX_SELF_LAG + 1) {
      throw new ThinkScriptRefusal('thinkscript:state',
        `${REFUSALS['thinkscript:state']} — inside its own definition \`${n.base.name}\` can `
        + `be read at most ${MAX_SELF_LAG + 1} bars back, and this reads `
        + `${k} bars back`,
        locate(n.tok || (n.base && n.base.tok)))
    }
    return k - 1
  }

  binary(n) {
    const l = this.resolve(n.left)
    const r = this.resolve(n.right)
    if ((n.op === '==' || n.op === '!=') && (isEnum(l) || isEnum(r))) {
      // ⭐ AN ENUM COMPARISON IS DECIDED AT TRANSLATION TIME, which is the whole
      // point of folding an input: `17-compoundvalue` plots BOTH arms of
      // `{default UseCompoundValue, ManualCalculation}` and the member gets one.
      if (!isEnum(l) || !isEnum(r)) throw refuse('thinkscript:type', n.tok)
      // ⛔⛔ FOLD ONLY WHAT A DECLARED ARM LIST CAN DECIDE. The old form compared
      // `family` and `arm` as plain strings, so a cross-family pair and an
      // undeclared arm BOTH came out "not equal" — a decision this translator
      // had no grounds to make, delivered silently as a column. Now one side
      // must be an input whose arms are known, the other must name one of them,
      // and anything else refuses AT THE OFFENDING TOKEN.
      const declared = Array.isArray(l.arms) ? l : (Array.isArray(r.arms) ? r : null)
      if (!declared) throw refuse('thinkscript:enum-arm', n.tok)
      const other = declared === l ? r : l
      if (other.family !== declared.family
        || !declared.arms.some((a) => key(a) === other.arm)) {
        throw refuse('thinkscript:enum-arm', other.tok || n.tok)
      }
      const same = declared.arm === other.arm
      return { ts: 'bool', value: n.op === '==' ? same : !same, tok: n.tok }
    }
    const a = this.asNode(l, n.tok)
    const b = this.asNode(r, n.tok)
    // ⭐ `%` IS THE ENGINE'S `mod`, A FUNCTION RATHER THAN AN OPERATOR, so it
    // goes through the same door a written call does. thinkorswim's Arithmetic
    // Operators page reads `%` → "remainder"; `closedTable.json` reads `mod` →
    // "the remainder of {0} divided by {1}". One identity, and the printed text
    // names the function a member can then read back in the formula box.
    if (n.op === '%') {
      return this.engineCall('mod', [{ node: a, tok: n.tok }, { node: b, tok: n.tok }], n.tok)
    }
    return cOp(n.op, [a, b])
  }

  resolve(n) {
    switch (n.e) {
      case 'num': return cNum(n.value, n.tok)
      case 'text': {
        // ⭐ A QUOTED PLOT NAME IS AN IDENTIFIER. `03-adx-dmi-lower` writes
        // `plot "DI+" = …` and reads `"DI+"` back in `def DX`; a string that
        // names nothing is text, and text is not a number a column can hold.
        const k = key(n.value)
        if (this.env.has(k)) return this.resolveBinding(k, n.tok)
        return { ts: 'text', value: n.value, tok: n.tok }
      }
      case 'name': return this.resolveName(n.tok)
      case 'call': return this.resolveCall(n)
      // ⭐ `x between a and b` → `(x >= a) && (x <= b)`, INCLUSIVE BOTH ENDS,
      // because the reference's own words are *"within the range of value1 and
      // value2 (inclusive)"*. ⚠️ `x` appears in both halves as the SAME node
      // object: the budget counts DISTINCT subtrees, so sharing costs nothing,
      // and every walker in this engine reads trees rather than mutating them.
      case 'between': {
        const x = this.asNode(this.resolve(n.x), n.tok)
        return cOp('&&', [
          cOp('>=', [x, this.asNode(this.resolve(n.lo), n.tok)]),
          cOp('<=', [x, this.asNode(this.resolve(n.hi), n.tok)]),
        ])
      }
      // ⭐ `<cond> within N bars` → `highest(<cond>, N) > 0`. The reference:
      // *"true at least one time for the given number of bars starting from the
      // current one"* / *"at least one Doji among three candles including the
      // current one"* — and `highest` over a 0/1 column IS that sentence, using
      // a function the shipped table already declares. ⛔ N MUST BE A POSITIVE
      // WHOLE NUMBER once inputs are folded: `within 0 bars` names no window at
      // all, and a length the engine cannot read fails the repaint linter closed.
      case 'within': {
        const cond = this.asNode(this.resolve(n.cond), n.tok)
        const countTok = n.count.tok || n.tok
        const k = literalInteger(this.asNode(this.resolve(n.count), countTok))
        if (k === null || k <= 0) throw refuse('thinkscript:window', countTok)
        return cOp('>', [
          this.engineCall('highest', [
            { node: cond, tok: n.tok }, { node: { type: 'num', value: k }, tok: countTok },
          ], n.tok),
          { type: 'num', value: 0 },
        ])
      }
      // ⭐ `crosses above` / `crosses below` are the reference's *"human-readable
      // version of the Crosses function"*, and this engine's `crossOver` /
      // `crossUnder` are what they name. ⚠️ THE PRIOR-BAR EDGE IS OURS AND IS
      // SAID OUT LOUD in the module header: the page pins "gets higher than",
      // never the inequality on the bar before. ⭐ BARE `crosses` IS "EITHER
      // DIRECTION", and the disjunction of the two named crossings is exactly
      // that sentence rather than a third convention this file invented.
      case 'cross': {
        const a = this.asNode(this.resolve(n.left), n.tok)
        const b = this.asNode(this.resolve(n.right), n.tok)
        const pair = [{ node: a, tok: n.tok }, { node: b, tok: n.tok }]
        if (n.dir === 'above') return this.engineCall('crossOver', pair, n.tok)
        if (n.dir === 'below') return this.engineCall('crossUnder', pair, n.tok)
        return cOp('||', [
          this.engineCall('crossOver', pair, n.tok),
          this.engineCall('crossUnder', pair, n.tok),
        ])
      }
      case 'member': {
        // ⭐ `<Study>(…).<Plot>` IS THE STUDY REFERENCE'S ONLY OTHER SPELLING, and
        // the plot name travels INTO the call rather than being applied to its
        // result. That direction is what lets one member access pick between two
        // different formulas — `LowerBand` and `UpperBand` are not projections of
        // one value, they are two expressions — and it is why the leg is a
        // parameter of `resolveCall` and not a wrapper around it.
        //
        // ⭐ THE LEXER ACCEPTS BOTH `.LowerBand` AND `."AvgExp"`, because the
        // corpus writes both: `05` uses the bare form and `19` writes
        // `MovAvgExponential("length" = 21)."AvgExp"` with a STRING plot name.
        // `parsePostfix` already stores either as `n.name`, so nothing here has to
        // know which one the member typed.
        if (n.base && n.base.e === 'call' && !n.base.base
          && has(TS_STUDY_PLOTS, key(n.base.name))) {
          return this.resolveCall(n.base, { name: n.name, tok: n.tok })
        }
        this.resolve(n.base)
        throw refuse('thinkscript:study-ref', n.tok)
      }
      case 'offset': {
        const outerLag = this.lagged
        this.lagged = false
        let idx
        try { idx = this.asNode(this.resolve(n.index), n.tok) } finally { this.lagged = outerLag }
        const k = literalInteger(idx)
        if (k === null) throw refuse('thinkscript:offset-literal', n.index.tok || n.tok)
        // ⛔ `x[-1]` READS A BAR THAT HAS NOT HAPPENED. The reference's own
        // tutorial says the study "will wait for a new quote"; a closed-bar
        // engine cannot, and the offset node has no slot for a negative value.
        if (k < 0) throw refuse('thinkscript:future-offset', n.index.tok || n.tok)
        // ⭐⭐ `x[k]` INSIDE `x`'s OWN ACCUMULATOR BODY IS THE ACCUMULATOR'S `self`,
        // and it is read BEFORE the base is resolved — resolving it would walk
        // back into the binding being built and report a cycle. `binds` is read
        // off the table's own `recurrence`, so this file never types `self`.
        {
          const lag = this.selfLagOf(n, k)
          if (lag !== null) {
            const spec = this.table.functions.accum
            if (!spec || !spec.recurrence) throw refuse('thinkscript:state', n.tok)
            const base = cSeries(spec.recurrence.binds)
            return lag === 0 ? base : { type: 'offset', value: lag, args: [base] }
          }
        }
        this.lagged = k > 0
        let base
        try { base = this.asNode(this.resolve(n.base), n.tok) } finally { this.lagged = outerLag }
        if (k === 0) return base
        // ⛔ `close[1][1]` AND `close[2]` ARE THE SAME COLUMN WITH TWO HASHES, so
        // the engine refuses the chain (`canonicalise:offset-chained`). Decided
        // HERE rather than discovered by the round trip, because the round trip
        // could only name the OUTPUT — W3.3 review measured the caret landing on
        // `p` in `plot p = close[1][1];`, which is correct code. A caret on
        // correct code sends a member to fix the wrong thing.
        if (base && base.type === 'offset') {
          throw refuse('thinkscript:offset-chained', n.bracket || n.tok)
        }
        return { type: 'offset', value: k, args: [base] }
      }
      case 'unary': {
        const v = this.asNode(this.resolve(n.arg), n.tok)
        if (n.op !== '-') return cOp('!', [v])
        return v.type === 'num' ? cNum(-v.value, n.tok) : cOp('u-', [v])
      }
      case 'binary': return this.binary(n)
      case 'if': {
        const cond = this.resolve(n.cond)
        // ⚠️ THE ARM NOT TAKEN IS NOT READ, DELIBERATELY. Once the enum is
        // frozen the other branch is not part of the member's column, and
        // refusing the script for something it will never evaluate would refuse
        // a study that works.
        if (cond && cond.ts === 'bool') return this.resolve(cond.value ? n.then : n.otherwise)
        return cOp('?:', [
          this.asNode(cond, n.tok),
          this.asNode(this.resolve(n.then), n.tok),
          this.asNode(this.resolve(n.otherwise), n.tok),
        ])
      }
      default: throw refuse('thinkscript:statement', n.tok)
    }
  }
}

/** ⛔ `printFormula` THROWS A `PineRefusal`, WHICH IS ANOTHER DOOR'S CLASS. Left
 *  uncaught it would reach `fromError` and be swallowed into
 *  `thinkscript:statement` with a Pine sentence inside it — a refusal naming the
 *  wrong door. */
function printOrRefuse(ast, tok) {
  try { return printFormula(ast) } catch (err) {
    throw new ThinkScriptRefusal('thinkscript:roundtrip',
      `${REFUSALS['thinkscript:roundtrip']} (${err && err.message ? err.message : err})`, locate(tok))
  }
}

/** The text this translator offers must read back as the tree it was printed
 *  from. Mirrors `pine.js::verifyRoundTrip` — a drift between the printer and
 *  the parser cannot ship a wrong formula, only a loud refusal with nothing
 *  offered. */
function verifyRoundTrip(formula, ast, tok) {
  const reparsed = parseFormula(formula)
  if (!reparsed.ok) {
    throw new ThinkScriptRefusal('thinkscript:roundtrip',
      `${REFUSALS['thinkscript:roundtrip']} (${reparsed.error})`, locate(tok))
  }
  let a
  let b
  try { a = astHash(reparsed.ast); b = astHash(ast) } catch (err) {
    throw new ThinkScriptRefusal('thinkscript:roundtrip',
      `${REFUSALS['thinkscript:roundtrip']} (${err && err.message ? err.message : err})`, locate(tok))
  }
  if (a !== b) throw refuse('thinkscript:roundtrip', tok)
}

/** Which column is offered first. A `plot` that yields a truth is a scan; a
 *  bare condition IS one by construction. ⭐ `treeYieldsBool` is IMPORTED from
 *  `pine.js` rather than re-decided here — one `yields` reader for the engine. */
/**
 * 🔴🔴 DOES THIS COLUMN DEPEND ON THE BAR AT ALL?
 *
 * ⛔⛔ MEASURED IN W3.6, AND IT IS THE SAME DEFECT AS THE HARD GUARDS, ONE LEVEL
 * DEEPER. With chrome listed, two more corpus scripts reported as working
 * screens on a column that cannot screen anything:
 *   * `20-roc-stdev-lower-switch` offered **`ZeroLine = 0`** — the decorative
 *     zero line — while both of its real plots refused;
 *   * `17-compoundvalue-vs-manual-fibonacci` offered **`FibonacciNumbers2 = 0 / 0`**
 *     — not-a-number on every bar — while its Fibonacci plot refused.
 * Both would have counted as PROGRESS in the corpus number, and a member would
 * have pasted a study and been handed a horizontal line.
 *
 * ⭐ THE RULE IS NOT "not a literal": it is "reads the bar". A tree built only
 * from numbers is the same value on every bar however much arithmetic is piled
 * on it, so this asks whether ANY leaf reads a series — which is exactly the
 * question "is there a column here" means. Derived by walking the tree, so a
 * node type added later is covered by the descent it already has.
 */
function readsTheBar(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'series') return true
  return (node.args || []).some(readsTheBar)
}

function chooseOutput(rows) {
  const usable = rows.map((r, i) => i)
    .filter((i) => rows[i].refusal === null && !rows[i].hidden && readsTheBar(rows[i].ast))
  if (!usable.length) return -1
  const boolish = usable.find((i) => {
    if (rows[i].kind === 'condition') return true
    try { return treeYieldsBool(rows[i].ast) } catch { return false }
  })
  return boolish === undefined ? usable[0] : boolish
}

// --------------------------------------------------------------------------- //
// the door
// --------------------------------------------------------------------------- //

/**
 * Translate a pasted thinkorswim study into this engine's column formulas.
 *
 * ⛔ IT NEVER THROWS. Four callers treat it as total — the corpus gate runs it
 * over 24 real published studies, and a member's paste is arbitrary text.
 *
 * @param {string} source the pasted thinkScript
 * @param {object} [opts] `opts.table` injects a closed table in place of the
 *   shipped manifest, which is what makes the derived-map claim MEASURABLE
 *   rather than argued: a table that declares `hma` makes
 *   `MovingAverage(AverageType.HULL, …)` translate with no edit in this file.
 * @returns {{
 *   ok: boolean,
 *   version: 'thinkscript',
 *   declaration: string|null,
 *   title: string|null,
 *   outputs: Array<object>,
 *   selected: number,
 *   refusal: object|null,
 *   refusals: Array<object>,
 *   ignored: Array<object>,
 *   folded: Array<object>,
 * }}
 */
export function translateThinkScript(source, opts = {}) {
  const table = opts.table || TABLE
  const blank = {
    ok: false, version: 'thinkscript', declaration: null, title: null,
    outputs: [], selected: -1, refusal: null, refusals: [], ignored: [], folded: [],
  }

  // ⛔ THE **WHOLE** BODY IS INSIDE THE TRY, AND THAT IS A FIX, NOT A STYLE.
  // The empty-source branch used to sit above it, calling `refusalValue` —
  // which asserts its guard — outside any catch. The day that assert fires it
  // would throw straight out of a function whose header promises it never
  // throws, and the four callers that treat this as total (the corpus gate over
  // 24 real files, the intake bench, `ImportBox`, a member's arbitrary paste)
  // would all see the exception instead of a refusal. Found in W3.2 review.
  let lines = []
  try {
    if (typeof source !== 'string' || source.trim() === '') {
      const r = refusalValue('thinkscript:empty', REFUSALS['thinkscript:empty'], null)
      return { ...blank, refusal: r, refusals: [r] }
    }

    lines = sourceLines(source)
    const lexed = lexThinkScript(source)
    const program = readProgram(lexed)
    // ⭐ THE CALL NOTES LAND IN THE SAME `ignored[]` THE STATEMENT READER WRITES
    // TO, because `ImportBox` renders one list and a member reads one list. They
    // are appended and the whole thing is re-sorted by position below, so a seed
    // note on line 40 does not jump ahead of a `declare` note on line 1.
    const resolver = new Resolver(program.env, table, program.ignored)

    const rows = program.outputs.map((o) => {
      resolver.inputs = new Set()
      const site = { kind: o.kind, title: o.title, line: o.tok.line, column: o.tok.column }
      try {
        // ⭐ A NAMED OUTPUT RESOLVES THROUGH ITS BINDING, so `plot RSI;` reaches
        // the `RSI = …;` forty lines below it. A plot whose name a `def` already
        // owns carries its expression inline and resolves that instead.
        const value = o.name
          ? resolver.resolveBinding(o.name, o.nameTok)
          : resolver.resolve(o.expr)
        const ast = resolver.asNode(value, o.nameTok)
        const formula = printOrRefuse(ast, o.nameTok)
        verifyRoundTrip(formula, ast, o.nameTok)
        return {
          ...site,
          formula,
          ast,
          inputsFolded: program.folded.filter((f) => resolver.inputs.has(key(f.name))),
          hidden: false,
          refusal: null,
        }
      } catch (err) {
        return { ...site, formula: null, ast: null, inputsFolded: [], hidden: false, refusal: fromError(err) }
      }
    })

    // ⛔ RE-SORTED, BECAUSE THE CALL NOTES ARRIVE AFTER `readProgram` HAS ALREADY
    // SORTED. The lexer's notes and the `declare` notes are ordered while the
    // statements are read; a seed note comes out of RESOLUTION, which happens
    // afterwards and in output order rather than in source order. Appending
    // without this puts an `ExpAverage` on line 1 below an en-dash on line 3, and
    // `ImportBox` renders the list in the order it is given.
    //
    // ⚠️ A DEDUPE SAT HERE KEYED `code@line:COLUMN` AND THE MUTATION SWEEP PROVED
    // IT COULD NEVER FIRE — every call site has its own token, so its own column,
    // and the resolver's binding memo means a `def` is resolved once however many
    // outputs read it. It was deleted with that measurement rather than left
    // standing behind a paragraph.
    //
    // ⭐ THE W3.5 REVIEW THEN FOUND THE KEY THAT DOES FIRE. `ExpAverage(ExpAverage
    // (close, 12), 12)` is two seed notes on ONE line, and `02-macd-lookback-cross
    // -watchlist` prints `ignoredLines [4, 13, 13, 14]` for exactly that reason.
    // ⛔ THE KEY IS THE SENTENCE, NOT THE POSITION: `message` already carries the
    // call name (`noteValue` folds the detail into it), so two `ExpAverage` calls
    // on one line collapse to one sentence while `ExpAverage(…) + MovingAverage(
    // AverageType.EXPONENTIAL, …)` on that same line keeps BOTH — the member is
    // told which call each note is about, and never told the same thing twice.
    const saidHere = new Set()
    program.ignored = program.ignored
      .filter((v) => {
        const at = [v.code, v.message, v.line].join('|')
        if (saidHere.has(at)) return false
        saidHere.add(at)
        return true
      })
      // ⛔ RE-SORTED, and this half is REACHABLE and railed — see below.
      .sort((a, b) => (a.line - b.line) || (a.column - b.column))

    // ⛔ "USABLE" MEANS A COLUMN A SCREEN CAN ANSWER FROM — see `readsTheBar`. A
    // plot that is a constant translated perfectly and screens nothing, and
    // counting it made two corpus scripts report as working on a zero line and on
    // an all-NaN column.
    const usable = rows.filter((r) => r.refusal === null && !r.hidden && readsTheBar(r.ast))
    const refusals = [...program.hard, ...rows.filter((r) => r.refusal).map((r) => r.refusal)]
      .sort(byPosition)

    if (rows.length === 0) {
      const none = refusalValue('thinkscript:no-output', REFUSALS['thinkscript:no-output'], null)
      const all = program.hard.length ? refusals : [none, ...refusals]
      return {
        ...blank,
        declaration: program.declaration,
        ignored: program.ignored,
        folded: program.folded,
        refusal: withExcerpt(all[0] || null, lines),
        refusals: withExcerpts(all, lines),
      }
    }

    // ⛔ A STATEMENT THIS TRANSLATOR CANNOT READ REFUSES THE WHOLE SCRIPT EVEN
    // WHEN A PLOT TRANSLATED — the same ruling `pine.js` makes for a `strategy()`
    // whose plots are perfectly good Pine. A study whose `AddLabel` line was not
    // read is a study we have not finished reading, and offering one of its plots
    // as "your scan" is answering about a different document than the one pasted.
    // ⛔⛔ A HARD GUARD BLOCKS FROM WHEREVER IT WAS RAISED, INCLUDING FROM INSIDE
    // ONE PLOT. See `TS_HARD_GUARDS`: `08` and `24` both reported as working
    // screens the moment a chrome line stopped blocking them, with the SPY
    // comparison and the position size reduced to one refused column among
    // several. A guard that only blocks when it happens to be raised at statement
    // level is a guard that stops working as the rest of the door improves.
    const blocked = program.hard.length > 0
      || rows.some((r) => r.refusal && TS_HARD_GUARDS.includes(r.refusal.guard))
    return {
      ok: usable.length > 0 && !blocked,
      version: 'thinkscript',
      declaration: program.declaration,
      title: null,
      outputs: rows.map((r) => (r.refusal ? { ...r, refusal: withExcerpt(r.refusal, lines) } : r)),
      selected: blocked ? -1 : chooseOutput(rows),
      refusal: (usable.length > 0 && !blocked) ? null : withExcerpt(refusals[0] || null, lines),
      refusals: withExcerpts(refusals, lines),
      ignored: program.ignored,
      folded: program.folded,
    }
  } catch (err) {
    const r = withExcerpt(fromError(err), lines)
    return { ...blank, refusal: r, refusals: [r] }
  }
}
