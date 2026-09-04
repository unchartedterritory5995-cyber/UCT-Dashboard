import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

/**
 * `request.security(syminfo.tickerid, '<TF>', expr)` → the `tf` node.
 *
 * ⛔⛔ WHY THIS FILE EXISTS SEPARATELY FROM THE CORPORA. Neither the carve-out
 * nor the timeframe FOLD moved either corpus number — both stayed 12/21 owner
 * and 10/30 community, measured before and after. Without this file the whole
 * path would be code with no exercise anywhere, and the day it broke both
 * corpora would stay green. That is `lesson_built_tested_green_and_unreachable`,
 * and a translator path measured by no corpus is exactly its shape.
 *
 * ⭐ AND THE SECOND MEASUREMENT RETIRED A FALSE PREMISE. The plan predicted the
 * fold would free “the ~6 variable-timeframe scripts — the largest single group”.
 * It freed none, because a variable timeframe was never the BINDING constraint on
 * any of them. Read at the refusing line, the six `pine:request` scripts are:
 *
 *   05-mtf-structure-bias        `tf2 = input.timeframe("60")`  → FOLDS, to a
 *                                 timeframe we cannot resample from daily bars.
 *                                 The fold worked; the answer is still no.
 *   19-cm-macd-ult-mtf           `res = useCurrentRes ? period : resCustom`
 *   20-cm-ultimate-ma-mtf         — ✅ SOLVED 27 Aug, see `pine.tfternary.test.js`.
 *                                 This row read "a TERNARY. No literal exists to
 *                                 fold to", which is TRUE and was doing duty as
 *                                 "cannot be resolved". Nobody has to fold the
 *                                 ternary: its CONDITION is `input(true)`, so one
 *                                 arm is dead code in the script as shipped. Both
 *                                 now clear the timeframe and refuse further in,
 *                                 at `pine:statement` and `pine:window`.
 *   23-higher-timeframe-ema      `ema[barstate.isrealtime ? 1 : 0]` — the CHILD
 *                                 is the blocker, not the timeframe.
 *   04-superguppy                `s01 = input('BINANCE:BTCEUR', type=input.symbol)`
 *   13-relative-strength-vs-spy  `benchmark = input.symbol("SPY")`, read at
 *                                 `timeframe.period` — no resample at all.
 *
 * ⛔ SO THE BINDING CONSTRAINT IS `sym`, NOT `tf`, AND IT IS TWO SCRIPTS, NOT SIX.
 * 13 is precisely the benchmark-whitelist case already decided; 04 asks for a
 * crypto pair on another exchange. “Variable timeframe” was a property these
 * scripts SHARED, never the reason they refused — the same shape as
 * `lesson_a_premise_that_says_nothing_to_find_retires_the_search`, caught only by
 * doing the work and re-measuring instead of trusting the row.
 *
 * ⛔⛔ AND `tf_live` REPEATED THE PATTERN A THIRD TIME. The plan's blocker table
 * said four community scripts were held by `lookahead_on` (11, 14, 22, 30).
 * Measured after the node landed: **zero moved**, because every one of them
 * refuses EARLIER for something else — 11 at `pine:plot-offset`, 22 at
 * `pine:collection` (`array.get`), 14 and 30 at `pine:no-output`. `lookahead_on`
 * was a property they SHARED, never the reason they refused.
 *
 * ⭐ AND THE TERNARY FOLD MADE IT FOUR, IN BOTH DIRECTIONS AT ONCE. Predicted: it
 * frees 19 and 20. Measured: the community corpus stayed at **16/30** — both
 * scripts cleared the timeframe and stopped on the next thing. `pine:request` fell
 * from 3 to 1, which is a real change in what this door SAYS and no change in what
 * it TAKES, and those are different numbers that a single total would have blurred.
 * ⛔ What the fold actually bought was a CORRECTNESS bug nobody was looking for:
 * `period = "60"` immediately above a `security` call read as the chart's own
 * timeframe, because the check asked what the node was CALLED and never consulted
 * the binding — the identical defect `ownSymbolNameOf` was fixed for, three lines
 * away, still standing on the timeframe side. A script asking for hourly bars was
 * answered off daily ones, silently. Found by a shadowing CONTROL written for a
 * different feature.
 *
 * ⭐ SO THE STANDING LESSON, NOW MEASURED FOUR TIMES, IS THAT A BLOCKER TABLE
 * BUILT BY GREPPING FOR A FEATURE COUNTS SCRIPTS THAT **CONTAIN** IT, NOT SCRIPTS
 * **BLOCKED BY** IT. Variable timeframe: predicted 6, moved 0. Another symbol:
 * predicted ~3, moved 1. `lookahead_on`: predicted 4, moved 0. The binding
 * constraint is whatever the translator hits FIRST, which can only be read off
 * the refusing line — so a future estimate must be built by running the corpus
 * and reading refusals, never by searching for a keyword
 * (`lesson_a_premise_that_says_nothing_to_find_retires_the_search`).
 *
 * ⚠️ NONE OF THAT MAKES THE NODES WASTED. `sym` moved the corpus and is the
 * relative-strength primitive this firm trades on; `tf_live` is what lets a
 * `lookahead_on` script be ACCEPTED WITH AN HONEST BADGE instead of refused, the
 * moment its other blockers clear. What is wasted is an estimate nobody re-measured.
 *
 * ⭐ THE FOLD IS STILL CORRECT AND STILL KEPT: it is what TradingView's own Pine
 * Screener does, and it is what a MEMBER's pasted `input.timeframe("W")` needs.
 * The corpora simply do not contain that shape. Its exercise is here.
 */
describe('request.security → tf', () => {
  const src = (body) => `//@version=5\nindicator("t")\n${body}\n`

  const treeOf = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const first = out.outputs.find((o) => o.refusal === null)
    expect(first, 'no output translated').toBeTruthy()
    return first.ast
  }

  it('⭐ the plain shape becomes a tf node — same symbol, literal timeframe', () => {
    const out = translatePine(src("plot(request.security(syminfo.tickerid, 'W', close))"))
    const ast = treeOf(out)
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('…and the child is translated, not passed through as text', () => {
    const out = translatePine(src("plot(request.security(syminfo.tickerid, 'M', ta.sma(close, 20)))"))
    const ast = treeOf(out)
    expect(ast.type).toBe('tf')
    expect(ast.value).toBe('M')
    expect(ast.args[0]).toEqual({
      type: 'call',
      name: 'sma',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }],
    })
  })

  it('⭐ `1W` and `1M` are the same timeframes spelled Pine\'s other way', () => {
    for (const [spelled, code] of [['1W', 'W'], ['1M', 'M']]) {
      const ast = treeOf(translatePine(src(`plot(request.security(syminfo.tickerid, '${spelled}', close))`)))
      expect(ast.value, spelled).toBe(code)
    }
  })

  it('⭐⭐ lookahead_on becomes `tf_live` — the node that reads the FORMING period', () => {
    // ⛔⛔ THIS USED TO REFUSE, AND REFUSING WAS RIGHT AT THE TIME. While the only
    // higher-timeframe node was the CLOSED one, taking `lookahead_on` would have
    // turned a look-ahead script into a look-behind one — it would have backtested
    // beautifully and been wrong, which is the silent mistranslation this whole
    // door exists against. Nothing about that has softened.
    //
    // ⭐ WHAT CHANGED IS THAT WE CAN NOW SAY WHAT THE SCRIPT ASKED FOR. `tf_live`
    // reads the period the bar is INSIDE, exactly as `lookahead_on` does, and the
    // linter derives `preview-repaints` from the node type — so the member gets
    // their script AND the honest badge, rather than a refusal for something we
    // can model. FOUR community scripts (11, 14, 22, 30) are this shape.
    const ast = treeOf(translatePine(src(
      "plot(request.security(syminfo.tickerid, 'W', close, lookahead=barmerge.lookahead_on))")))
    expect(ast).toEqual({
      type: 'tf_live', value: 'W', args: [{ type: 'series', name: 'close' }],
    })
  })

  it('⛔ an UNRECOGNISED lookahead spelling still refuses — not \"anything that is not off\"', () => {
    // The control on the arm above: admitting `lookahead_on` must not become
    // admitting every value. A spelling this door does not know is a thing it
    // cannot model, and guessing is what it refuses to do.
    const out = translatePine(src(
      "plot(request.security(syminfo.tickerid, 'W', close, lookahead=barmerge.lookahead_maybe))"))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it("⛔ and lookahead_on at the CHART’S OWN timeframe is still the identity", () => {
    // There is no period to be part-way through, so there is nothing to model
    // and no repaint to declare — emitting `tf_live` here would badge a settled
    // read as repainting.
    const ast = treeOf(translatePine(src(
      "plot(request.security(syminfo.tickerid, timeframe.period, close, lookahead=barmerge.lookahead_on))")))
    expect(ast).toEqual({ type: 'series', name: 'close' })
  })

  it('…and lookahead_off, stated explicitly, still translates', () => {
    // The control: without it the case above would pass for a translator that
    // refused every `lookahead=` argument, or every four-argument call.
    const ast = treeOf(translatePine(src(
      "plot(request.security(syminfo.tickerid, 'W', close, lookahead=barmerge.lookahead_off))")))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐⭐ another SYMBOL is now `sym`, and it wraps the `tf` — never the other way', () => {
    // ⛔⛔ THE NESTING IS THE POINT. `sym` must be OUTER: `tf` hands its child
    // RESAMPLED bars while the benchmark series is not resampled, so
    // `tf(sym(…))` would align daily SPY bars onto weekly dates — an
    // almost-right column, not a NaN. `interpret` refuses that ordering by name,
    // and this translator composes from two independent answers (whose bars?
    // which period?) so it CANNOT emit it.
    const ast = treeOf(translatePine(src("plot(request.security('SPY', 'W', close))")))
    expect(ast).toEqual({
      type: 'sym',
      value: 'SPY',
      args: [{ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] }],
    })
  })

  it("⭐ …and at the chart's OWN timeframe it is a bare `sym`, with no `tf` at all", () => {
    // `timeframe.period` means "this chart's period", so there is nothing to
    // resample. Script 13 of the community corpus is exactly this shape:
    // `request.security(benchmark, timeframe.period, close)` — relative strength
    // against SPY, the primitive this whole node exists for.
    const ast = treeOf(translatePine(src(
      "plot(request.security('SPY', timeframe.period, close))")))
    expect(ast).toEqual({ type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }] })
  })

  it("⭐ and this chart's own symbol at its own timeframe is the IDENTITY — no node at all", () => {
    // The fourth corner of the same composition. `request.security(syminfo.tickerid,
    // timeframe.period, close)` asks for this symbol on this timeframe, which is
    // just `close`. Emitting a `sym` or a `tf` here would add a node that changes
    // nothing and costs a resample.
    const ast = treeOf(translatePine(src(
      "plot(request.security(syminfo.tickerid, timeframe.period, close))")))
    expect(ast).toEqual({ type: 'series', name: 'close' })
  })

  it('⛔ a symbol on ANOTHER MARKET still refuses — this engine reads US equities', () => {
    // Community script 04 asks for `BINANCE:BTCEUR`. ⚠️ AND THE REASON IS NOT
    // SNOBBERY: we hold no such series, so translating it builds a column that is
    // NOT COMPUTABLE on every row — which reads to a member as a quiet market
    // rather than as an answer we cannot give. `LSE:VOD` is the sharper case: a
    // REAL instrument that is NOT the `VOD` this store would fetch, so dropping
    // the venue there is the look-alike this table refuses everywhere else.
    for (const ticker of ['BINANCE:BTCEUR', 'LSE:VOD', 'TOOLONGTICKER']) {
      const out = translatePine(src(`plot(request.security('${ticker}', 'W', close))`))
      expect(out.refusal, ticker).toBeTruthy()
      expect(out.refusal.guard, ticker).toBe('pine:request')
    }
  })

  it('⭐ …but a US EQUITY VENUE resolves, because it names a series this store holds', () => {
    // ⚰️ THIS LINE USED TO ASSERT THAT `NASDAQ:AAPL` REFUSED, and the reason
    // recorded beside it was that `sentence.js::renderSym` will only SAY a plain
    // ticker, so accepting one would build a tree whose read-back refuses. That
    // reason is real and is NOT what changed: the venue is STRIPPED, so the node
    // built is `sym('AAPL', …)` — a plain ticker, which reads back. The guard was
    // testing the adjacent thing (does the string contain a colon) rather than the
    // invariant it was written for (can the tree be explained).
    const ast = treeOf(translatePine(src("plot(request.security('NASDAQ:AAPL', 'W', close))")))
    expect(ast).toEqual({
      type: 'sym',
      value: 'AAPL',
      args: [{ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] }],
    })
  })

  it('⛔⛔ THE TWO SPELLINGS OF A VENUE AGREE — one script cannot mean two things', () => {
    // ⚰️ THEY DID NOT, AND ONLY ONE SIDE WAS RAILED. `request.security('BINANCE:BTCEUR', …)`
    // refused (the rail above), while `ticker.new('BINANCE', 'BTCEUR', session.regular)`
    // translated to `sym('BTCEUR', …)` and had done all along — `tickerCallArg`
    // read argument ONE and never looked at the venue. A euro crypto pair became a
    // lookup against our US equity store, silently, in the spelling nobody checked.
    //
    // ⛔ SO THE ASSERTION IS AGREEMENT, NOT MEMBERSHIP. `US_EQUITY_VENUES` is a
    // list and will be wrong the day a venue is added; what must never drift is
    // that both ways of writing one request get the same answer.
    for (const [venue, ticker] of [['BINANCE', 'BTCEUR'], ['LSE', 'VOD'], ['NASDAQ', 'AAPL'], ['AMEX', 'SPY']]) {
      const asString = translatePine(src(`plot(request.security('${venue}:${ticker}', 'W', close))`))
      const asCall = translatePine(src(
        `plot(request.security(ticker.new('${venue}', '${ticker}', session.regular), 'W', close))`))
      expect(asCall.ok, `${venue}:${ticker} — the two spellings disagree`).toBe(asString.ok)
      if (asString.ok) {
        expect(treeOf(asCall)).toEqual(treeOf(asString))
      } else {
        expect(asCall.refusal.guard).toBe(asString.refusal.guard)
      }
    }
    // ⛔ NON-VACUITY: the loop above must contain BOTH answers, or it would pass
    // for an engine that refused every venue or served every venue.
    expect(translatePine(src("plot(request.security('NASDAQ:AAPL', 'W', close))")).ok).toBe(true)
    expect(translatePine(src("plot(request.security('BINANCE:BTCEUR', 'W', close))")).ok).toBe(false)
  })

  it('⛔ a timeframe this engine cannot RESAMPLE refuses at the door the member typed at', () => {
    // `'60'` is on the ladder but not resamplable from daily bars, so it must
    // refuse HERE rather than translate into a node `interpret` would then
    // refuse — a member should be told by the translator they used, not by an
    // engine two layers down.
    for (const tf of ['60', 'D', '3M']) {
      const out = translatePine(src(`plot(request.security(syminfo.tickerid, '${tf}', close))`))
      expect(out.refusal, tf).toBeTruthy()
      expect(out.refusal.guard, tf).toBe('pine:request')
    }
  })

  it('⭐ an `input.timeframe` VARIABLE folds to its default — TradingView does the same', () => {
    // ⭐ THIS IS FIDELITY, NOT A SHORTCUT. This file's own header records that
    // their Pine Screener "supports most `input.*`, falling back to defaults for
    // `input.timeframe`/`input.symbol`/`input.time`" — so on the surface these
    // scripts were written for, `res = input.timeframe(defval='W')` really does
    // mean 'W'. Six community scripts name their timeframe through a variable;
    // refusing them refuses the IDIOM, not the maths.
    const ast = treeOf(translatePine(src(
      "res = input.timeframe(defval='W')\nplot(request.security(syminfo.tickerid, res, close))")))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐ and a `tickerid = syminfo.tickerid` ALIAS is still this chart\'s own symbol', () => {
    // Three community scripts write it this way. Accepting the bare name while
    // refusing its alias would accept the same script only when spelled the less
    // common way.
    const ast = treeOf(translatePine(src(
      "tickerid = syminfo.tickerid\nplot(request.security(tickerid, 'W', close))")))
    expect(ast.type).toBe('tf')
    expect(ast.value).toBe('W')
  })

  it('⛔ FOLDING IS NOT PERMISSION — a folded timeframe we cannot resample still refuses', () => {
    // The control that stops the fold becoming a yes-machine: `'60'` resolves to
    // a real string and is STILL not something `tf` can produce from daily bars.
    const out = translatePine(src(
      "res = input.timeframe(defval='60')\nplot(request.security(syminfo.tickerid, res, close))"))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⛔ and a genuinely COMPUTED timeframe refuses — there is no literal to fold to', () => {
    // The node carries its code as a FIELD precisely so a timeframe can never be
    // computed at runtime. Here that rule is enforced by there being nothing to
    // read: a user function has no default to fall back to.
    const out = translatePine(src(
      "tfOf(x) => x > 1 ? 'W' : 'M'\nplot(request.security(syminfo.tickerid, tfOf(close), close))"))
    expect(out.refusal).toBeTruthy()
  })
  it('⭐ the v2/v3 spelling `tickerid` is the SAME “this chart” — age is not a refusal', () => {
    // 19-cm-macd-ult-mtf and 20-cm-ultimate-ma-mtf are v3 scripts that write
    // `security(tickerid, res, x)`. Knowing only v5's `syminfo.tickerid` would
    // refuse them for the year they were written in. (Both still refuse today —
    // their `res` is a ternary — which is why this is pinned HERE and not by a
    // corpus number that cannot move.)
    for (const spelled of ['tickerid', 'ticker', 'syminfo.ticker']) {
      const ast = treeOf(translatePine(src(
        `plot(security(${spelled}, 'W', close))`)))
      expect(ast.type, spelled).toBe('tf')
      expect(ast.value, spelled).toBe('W')
    }
  })

  it('⛔⛔ a USER-DEFINED `security` shadows the built-in carve-out', () => {
    // ⚰️⚰️ ONE NAME MEANT TWO THINGS IN ONE SCRIPT. The `security` carve-out ran
    // SIXTEEN LINES BEFORE the user-function check, so a member who defined
    // `security(a, b, c) => a + b + c` got THEIR function for
    // `security(close, high, low)` and the BUILT-IN for
    // `security(syminfo.tickerid, "W", close)` — the same call, resolved two ways,
    // decided by whether the arguments happened to match the built-in's shape.
    //
    // ⛔ THE RULE ABOVE THE USER-FUNCTION CHECK IS RIGHT AND UNCHANGED: only a
    // `f(x) =>` DEFINITION shadows a table name, never a value binding — because
    // `rsi = rsi(src, length)` is ordinary Pine. The carve-out simply ran before
    // that rule could apply.
    //
    // ⭐ FOURTH INSTANCE OF THE BINDING-ORDER DEFECT IN THIS FILE, after
    // `ownSymbolNameOf`, `ownTimeframeOf` and `resolveName`. Consult what the
    // script SAID before what the table knows.
    const out = translatePine(src(
      `security(a, b, c) => a + b + c
plot(security(syminfo.tickerid, 'W', close))`))
    // Their function adds a string to prices, which this grammar cannot hold — so
    // the honest answer is a refusal, NOT a weekly resample they never asked for.
    expect(out.refusal, 'the built-in carve-out is still winning').toBeTruthy()
  })

  it('⭐ …and with no user definition, the carve-out still works', () => {
    // The control: the fix must be a SHADOW check, not a deletion of the carve-out.
    const ast = treeOf(translatePine(src(
      "plot(security(syminfo.tickerid, 'W', close))")))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐ and a LOCAL binding that shadows `tickerid` reads as the instrument it NAMES', () => {
    // The control on the spellings above: recognising the built-in must not become
    // “any variable called tickerid is this chart”. Bound to a literal it is a
    // DIFFERENT instrument — which is now `sym`'s job, so it translates AS SPY
    // rather than silently as this chart. Before `sym` existed this refused; the
    // assertion that matters is unchanged either way, which is that it is never
    // read as the chart's own symbol.
    const ast = treeOf(translatePine(src(
      `tickerid = 'SPY'
plot(security(tickerid, 'W', close))`)))
    expect(ast.type).toBe('sym')
    expect(ast.value).toBe('SPY')
  })
})
