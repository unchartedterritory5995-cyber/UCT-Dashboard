# REQ — `request.security` coverage unit (2026-11-16)

Branch `feat/pine-coverage-request-security` (worktree `u4u5`), merged with master at engine 61. Engine
number: NUMBER PENDING (the landing train numbers it). Every runtime path here is behind the dark runtime
pane; nothing is armed.

## The measure

Coverage on the runtime-on lane, by the census's own predicate (`coverageMapDoorCensus.measure.test.js`, and
`coverage_map.runtime_on_section::transfers`: clean, or attached on the runtime lane, placing no orders), over
the 109 sample scripts the request family touches (the wall analysis of the engine-60 census). BEFORE = master
`e9807547d0` (engine 61; it differs from the merged `6ee6fb2d0e` only by two non-engine commits, #1440 and
#1441), AFTER = this branch, both in one lock hold, the head recorded at every stage.

**1 of the 109 newly transfers (sole-family)**:

| slice | script | before | after | what serves it |
|---|---|---|---|---|
| (a) resolution | `builtin:correlation-coefficient` | `pine:request` (unresolved symbol) | transfers: clean AND clean on the bound check | `ticker.modify(input.symbol("GOOG"))` with nothing modified is GOOG: an ordinary `sym` read |

The first push also transferred `reference:money-flow-index-mtf-alerts` (slice b) by routing a v1–v4 bare
`security(…)` through the request door, where the identity over state is the expression itself. That was
WITHDRAWN by the coordinator's ruling (no committed capture grades a v1–v4 bare identity over state MATCH);
it waits for Q-REQ4, which would free it.

Slice (a)'s own count: 1 transfers (above). Two further readings were built, measured and WITHDRAWN before the
push (see "Withdrawn" below), so the cppivot and machine-learning moves the first measurement reported are not in
this PR. Slice (b)'s own count: 0 on this branch (1 on the first push, withdrawn, Q-REQ4). Of the
20 scripts blocked by `runtime:request-with-state` on a bare `security(…)`, the first push showed 7 more would
stop at a named request wall behind it (look-ahead below the chart, a timeframe below the chart, another
symbol, a dynamic timeframe): the state wall is not their only one.

`budget:series` failures this unit uncovered (for the cap ruling): `cppivot-boss-floor-pivots-with-atr-dilation-
and-dynamic-levels` (13 > 8) once its six-hop timeframe chain is read on the plot lane (withdrawn here, so not
reached on this branch), `swing-points-and-liquidity-by-leviathan` (14 > 8, already so on master, after peeling).

## Withdrawn (built, measured, reverted before the push)

- **The timeframe reader's 16 hops on the PLOT lane.** The cloud's `pineProbeReplay` rail measured
  artemis-oscillator-pro's plot-lane translation moving (more Resolver steps AND a different output digest), and
  `pine.c10ConstantTests` pins the confinement. Per the coordinator's ruling (revert if a previously served
  output moves) it is object-pass only again. It freed no transfer: cppivot then fails `budget:series`.
- **A v1–v4 bare `security(…)` through the request door.** Ruled: re-pin only shapes a committed capture
  grades MATCH; none grades a v1–v4 bare identity over state, so `w4ClassifierHonesty` keeps master's refusals
  and the routing is out (Q-REQ4).
- **A v3 / v4 `input(…, type = input.symbol)` default read as the symbol.** The cloud's production harness
  lane measured pmax-explorer SPY's PMax plot MATCH -> DIVERGE (`vendorHarness.coverageAudit`): its twenty
  symbol inputs became twenty per-symbol requests. Reverted; it freed no transfer either.

The per-target table (identifiers only) is in the PR body.

## What is served, and its witness

| shape | lane | witness |
|---|---|---|
| an empty symbol `''` (a literal, or an `input.symbol('')` default) is the chart's own | host + runtime | reference, `request.security`, `symbol`: "Use an empty string or `syminfo.tickerid` to request data using the chart's symbol." Served as the identity |
| `ticker.modify(<symbol>)` with no other argument is `<symbol>` | host + runtime | reference, `ticker.modify`: "If session is not given, then `syminfo.session` value is used", "If adjustment is not given, then default adjustment value is used"; `backadjustment` / `settlement_as_close` default to inherit. Served as the existing `sym` read (`vw-other-symbol-rddt-1d-2026-09-30` O02 / O03 MATCH) |
| a `session` / `gaps` / `lookahead` constant written through a plain binding | host + runtime | the constant itself: `Resolver.builtinNameThrough` follows bare names only and folds nothing |
| `lookahead = barmerge.lookahead_on` at `W` / `M` on the runtime lane | runtime | the committed `vw-request-htf-alignment-spy-1d-2026-10-02` (AMEX:SPY 1D, 1,800 bars): A01 (weekly close), A04 (monthly close), A06 (`close[1]`: last week's close) exact on every graded bar, by the pick (`interpret.js::tfLiveReads`) AND by the runtime lane's own run (`computeRuntimeColumns`, off the listing, warm-up curtain); A02 / A05 (look-ahead off) unchanged; the controls show the two picks part on more than 1,000 bars (`vendorHarness.reqLookaheadAlignment.test.js`) |

### Look-ahead and gaps on the runtime lane (slice c)

| look-ahead | gaps | historical bar | newest bar, finished | newest bar, forming |
|---|---|---|---|---|
| off | off | served (engine 55's merge) | served where it certainly closes its period, else withheld `request:htf-newest-unconfirmed` | the forming period (engine 55) |
| on, at `W` / `M` | off | **served** (A01 / A04 / A06) | **served** (the capture's newest bar is finished) | **withheld** `request:htf-lookahead-forming-unmeasured` (Q-REQ1) |
| on, any other code | any | refused `runtime:request` by name | | |
| any | on, at another timeframe | refused by name (P0 0H, unchanged) | | |

Off the listing, a look-ahead read's partial first period is withheld
(`request:htf-lookahead-first-period-partial`); inside the off-listing warm-up runs the measured curtain judges
it instead (it withholds every bar before the two runs agree).

## Still refused by name, with queue rows (`docs/pine/capture-queue-2026-11-16-request-security.md`)

- **Q-REQ1** the forming newest bar of a look-ahead W / M read.
- **Q-REQ2** a `barmerge.gaps_*` constant passed as `lookahead` (`previous-n-daysweeksmonths-high-low`).
  Per the coordinator's ruling, graded both readings against that script's two committed captures: both are
  INCONCLUSIVE, because the script's next wall (`pine:offset-literal`, a `[barstate.isconfirmed ? 0 : 1]`
  offset) refuses first, so neither reading is witnessed. It stays refused; the probe in Q-REQ2 parts them.
- **Q-REQ3** a Heikin Ashi ticker (`ticker.heikinashi`, v4 `heikinashi(tickerid)`): 5 sample scripts.
- `ticker.modify` that modifies (a session, an adjustment), `session.extended`: another series, refused.
- A symbol reached only through a helper's PARAMETER is not served (it is followed only to NAME a symbol
  that is refused). Measured: serving it sent `best-abcd-pattern-screener` (five tickers, each read through
  many fractal offsets) past the 10 s translate budget (`pine:timeout`), where master refuses it by name at
  once. With the parameter not followed for serving it is refused by name again (3.8 s, master 4.2 s).

## Lower timeframes (slice d): the measured data-source question, for the owner

The RULE of a read below the chart is captured (`vw-lower-tf-*`, C41). The DATA is ours, and it was measured
2026-10-01 (`docs/pine/WAVE12-INTEGRATION-STATE.md`, R-LTF, `storeIntradayAgreement`): our
`/api/bars/RDDT?tf=15&bars=60000` against TradingView's `vw-bar-counters-rddt-15-2026-09-30`, 634 sessions:
coverage 99.84%; sessions price-equal on every bar **77.06%** (the bar is 99%); last-bar close equal 96.99%
(the bar is 99.5%); volume equal **0.00%** (ours / TradingView's median 1.383, p05 1.170, p95 1.751). Price
mismatches are scattered one-cent provider differences clustered on the 15:45 close and the 09:30 open. A
lower read would differ from TradingView about one day in thirty, and volume never agrees. That is a choice of
intraday feed, not engine work: `VITE_PINE_LOWER_TF_ENABLED` stays off and nothing was built (10 sample scripts
touched by `lower-tf:store-unmeasured`, 1 sole).

## Symbols we do not hold (slice e)

The sample asks for: USI: / INDEX: breadth (`USI:ADVN.NY`, `USI:DECL.NY`, `USI:UNCH.NY`, `USI:UVOL`, `USI:DVOL`,
`USI:ADD`, `UPVOL.*` / `DNVOL.*`, `INDEX:SLTW`) — in scope as its own unit (our breadth data); `SP:` sector
indices (`SP:SPN`, `SP:S5MATR`, `SP:S5INDU`, `SP:S5COND`, `SP:S5CONS`, `SP:S5HLTH`, `SP:SPF`, `SP:S5INFT`,
`SP:S5TELS`, `SP:S5UTIL`, `SP:S5REAS`); `ECONOMICS:*`, `QUANDL:*`, `ESD:*_EARNINGS`; crypto and FX
(`BINANCE:*`, `BITMEX:*`, `KRAKEN:*`, `INDEX:BTCUSD`, `EURUSD`), out of scope by owner ruling. All refused by
name (`other-symbol:*`). Nothing substituted, so no MATCH_SUBSTITUTED row.

## Server lanes (the Python twins)

- The host translator's new readings produce only existing tree kinds (the identity, `sym`, `tf_merge`,
  `tf_live`); `ast_interpret.py` evaluates them as before: a `sym` read needs its bars supplied (the alert /
  screen supplier), else it is `not_computable` by name. No new node, so no twin change.
- The runtime service (`services/pine_runtime/job.mjs`) runs the same bundle: own-symbol look-ahead W / M is
  served there as in the browser (the bars are the chart symbol's own); another symbol stays refused by name
  (`otherSymbolSupply: false`).

## Harness

Over the 202 committed captures whose source reads `security(`, `ticker.modify` or a symbol input, graded on
the runtime-on lane on master `e9807547d0` and on this branch: **no verdict moves** (151 INCONCLUSIVE, 28 MATCH,
20 DIVERGE, 3 MATCH_SUBSTITUTED on both; RS Rating's RDDT / ALAB / CRWV stay MATCH_SUBSTITUTED). The full
corpus, both lanes, is the cloud's (pine heavy).
