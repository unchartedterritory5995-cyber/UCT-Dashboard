# RS Rating transfer program (2026-11-14)

**Owner ask, 2026-11-14:** make TradingView's *RS Rating* (Fred6724,
`tradingview.com/script/pziQwiT2`, Pine v5, MPL-2.0) transfer fully, and build the general
capability behind every wall it hits. Where a script depends on something only TradingView has, we
use UCT's equivalent. Owner picked option (a): grade everything except the substituted values, and
label the substituted values "UCT data".

**Branch** `pine/rs-rating-transfer` (worktree `.claude/worktrees/rs-rating-test`).
**Engine numbers:** 55-58 are claimed by the other Pine session (#1264, #1265, #1294,
`fix/pine-engine58-colours`) and merge first. This program takes **59+**, one bump per merged PR.

## The walls (measured 2026-11-14 on master `e2caee513f`, engine 54, every production door flag on)

Each wall was found by removing the one before it (scratch variants, not committed).

| # | wall | lane | depends on |
|---|---|---|---|
| W1 | `SP:SPX` is not served (indices are `unserved`; our store holds no index bars on a member path) | L1 index symbols | #1264 merged; SPX source = FMP primary, yfinance fallback (owner ruling below) |
| W2 | untyped `input('SP:SPX')` used as a `request.security` symbol does not fold (`input.symbol` does) | L2 | #1264 merged (`requestTargetOf`) |
| W3 | `syminfo.industry` is not in the grammar (both lanes) | L3 | none |
| W4 | runtime lane: `runtime:conditional-history`, a stateful built-in (`ta.sma`/`ta.ema`) inside an `if` whose condition is a script constant (inputs, `timeframe.isweekly`) | L4 (= the other session's RT-HISTORY unit, handed over) | none |
| W5 | object lane withholds ALL drawings: `label.delete(label1[1])` (delete of a history-indexed id) cannot be followed; the runtime run-half that could draw them declines `runtime:request` | L5 runtime requests | #1264 merged |
| W6 | `request.seed('seed_fred6725_rs_rating','RSRATING',close)` has no equivalent (the seed repo is private) | L6 substitute data | L1 (the score needs SPX) |
| W7 | production runtime allowlist admits only scripts graded MATCH; a substituted script can never MATCH | L7 substitute grade | L6 |

After W1-W3 alone the door draws only the RS line. The rating number and the new-high dot are labels
(W5) fed by W4 and W6.

## Rules this program keeps

- **Honesty rule** (`SESSION-STATE.md`): serve only what the Pine reference states or a capture
  witnesses; refuse by name otherwise.
- **Substitution is its own class, never MATCH.** A value computed from UCT data in place of a
  vendor-only source (a seed, `syminfo.industry` from our classification) is:
  - tagged at the point of supply, and the tag survives into every output it reaches;
  - disclosed by name at the member door ("RS Rating uses UCT market data: ...");
  - graded in its own bucket (`MATCH_SUBSTITUTED`), which `coverage_map`, the evidence ledger and
    capability admission never count as MATCH or PROVEN-exact (peer ask, 2026-11-14).
- **The grade proves the engine, the substitute is disclosed.** For the grade, the harness feeds
  our side the VENDOR's own value of each substituted input, read off the capture (the seed series,
  `syminfo.industry`). With that done, every plot and object must MATCH bar for bar. That proves the
  translation exactly. The only unproven part left is our substitute data, which is what the
  disclosure says.
- Licence-held captures stay out of git (`LICENSING.md` 2c). This script is MPL-2.0, so it may be
  committed to `corpus/committed`.
- Index bars count only after a capture MATCH (peer ask).

## Lanes

**L3: where the data enters** (surveyed 2026-11-14):
- **Today's path.** The chart's symbol object is `{ticker, exchange}`, built at
  `StockChart.jsx:4624` from `tickerMeta`. `runtimeColumns.js:89` and `runtimeAsync.js:268` copy
  ONLY those two fields into the runtime lane. Our industry and sector come from
  `api/services/ticker_meta.py`: yfinance `info`, Finnhub `finnhubIndustry`, or FMP, so the
  taxonomy is mixed and not TradingView's FactSet.
- **Plan:**
  - thread `industry`, `sector` and the instrument type through the same object, in both lanes and
    in the screener's `ast_bind.py`;
  - serve TradingView's string where `symbolScope.json` gains a witnessed row from Q-RS4: by
    instrument class (ETF -> the captured string, expected `'Investment Trusts/Mutual Funds'`) and
    by our-string -> their-string for the captured names;
  - otherwise serve OUR string, tagged SUBSTITUTED and disclosed (`MATCH_SUBSTITUTED`, L7);
  - with no data at all, refuse by name.

**L3 status (2026-11-15, engine 62 placeholder):** built. `symbolScope.json::classification`
(by_class keyed by `screener_universe.types()`'s Stock/ADR/ETF, threaded as `securityType` from
`ticker_meta.security_type`; by_ours keyed by our string) ships with no rows until Q-RS4 lands;
`bind.js::classificationWith` (mirrored by `ast_bind.py::classification_with`, pinned by
`tests/fixtures/ast/symbol_classification_parity.json`) serves a witnessed row untagged, else our
string tagged `{name, source: 'uct:ticker_meta', vendorValueFrom: 'capture.symbol.<field>'}`,
else refuses by name. The harness feeds `capture.symbol.industry` and declares it on the L7
contract (`ourSide.substituted`); the member door's notes name the field. ⚠️ No capture's
`symbol` block carries `industry` yet: `tv_capture.js` must record it (or the Q-RS4 label text must
be mapped onto it) before an RS Rating grade can be MATCH_SUBSTITUTED rather than INCONCLUSIVE.

**L3 `syminfo.industry` (and its siblings `sector`)**: a bind-time text fold from our ticker meta,
tagged SUBSTITUTED (our classification is not TradingView's FactSet taxonomy). Accept: the micro
script `plot(syminfo.industry == 'X' ? 1 : 0)` attaches on both lanes. The read-back names the
substitution.

**L4 runtime conditional-history for constant conditions**: an `if` whose condition folds to a
script constant runs on every bar or on none, so its stateful calls keep the same history as
unconditional ones. Admit that case only; a per-bar condition keeps refusing. Accept: the 17
RT-HISTORY sample scripts regrade against the s7-ahead captures with no new DIVERGE, and the RS
Rating rating math builds on the runtime lane.

**L4d status (2026-11-15, engine 63 placeholder):** built, on the s10 captures (local only;
digests in `docs/pine/evidence/2026-11-15-w3n-d1/evidence.json`).
- W3N-D1 per shape: the drawing build serves `ta.sma` / `ta.ema` / `ta.rma` in an `if` block
  (rows a/b/c MATCH on RDDT and SPY); a block local's `x[1]` read by a drawing (row d DIVERGE:
  the previous RUN, not the previous bar) now refuses `runtime:conditional-history`.
- Q-RS5: `t = c ? na : label.new(…)` (E01) and `t = c ? box.new(…) : na` (X01) MATCH on both
  symbols and are served (`DRAW_ARM_WITNESSED`); other (arm, family) pairs keep
  `runtime:object-op`.
- The vendor's label/box `x` is a rank into `graphics()._indexes`; the grade reads it through the
  run's `xmap/<id>.json` sidecar. The harness's objects v2 leaves `x` ungraded by name (it never
  reads it as a bar index), so no harness change was needed.
- At the member door (runtime-on harness) these probes still do not reach the drawing build:
  W3N grades DIVERGE with the drawing withheld (`pine:object-ops-refused`, its one create dropped
  as `pine:block`), Q-RS5 INCONCLUSIVE (`pine:drawing`). Why the door mints no run half for them
  is not yet traced. The runtime-on grades of s7 (38) and s9 (160) are unchanged.

**L5 the runtime lane reads other symbols and timeframes** (re-scoped 2026-11-14, after reading
the door):
- RS Rating's labels cannot come from the host lane. Their TEXT is the rating, which only the
  runtime lane computes (the host lane refuses `totalRsRating` as `pine:reassign`).
- The door already has the right shape: `memberPaneDefinition.js::hostPartialRunHalf` draws host
  plots and takes the drawings from a runtime run (`compute.runtimeObjects`, `withRunHalf`).
- It declines `runtime:request` whenever the run reads another symbol or timeframe, because
  `computeRuntimeColumns` passes no `requestBars`.
- So L5 is: supply `request.security` bars to the runtime lane, using the same supply the host
  lane uses (`secondaryBars.js` in the chart, C26 captures in the harness), with Pine's
  `lookahead_off` alignment. It builds on #1264's `tf_merge` and other-symbol rules.
- `label.delete(x[1])` is then ordinary per-bar execution in the run.
- **Handed over by the peer session (2026-11-14): their REQ-SECURITY unit.** #1264 does not add
  runtime request supply, and the runtime door still declines every `request.security`. Their
  notes:
  - **Reuse, don't restate:**
    - `interpret.js::tfMergeMask` (`tf_merge`): when the next bar is in another bucket, read
      `child[b]`, otherwise `child[b-1]`. The newest bar is withheld unless it is forming, or
      served when it certainly closes its period: on a daily chart, W = Friday, M = the month's
      last weekday.
    - `request:htf-first-period-partial` off the listing.
    - The other-symbol rules (`otherSymbols.spellingUnservable` / `staticallyUnservable`,
      per-plot refusal at bind, one sentence via `staticOtherSymbolMessage`).
  - **Check and unify:** `runtime/vm.js::runRequest` uses strictly-before alignment (`"D"` on D
    reads `i-1`). It may disagree with `tf_merge` on period-end bars. The #1264 reviewer flagged
    this but did not verify it.
  - **Evidence:** S9 captured the 81 REQ-SECURITY sample scripts on RDDT 1D and SPY 1D (SPY 60
    in progress). Store: `uct-vendor-batch/runs/s9-ahead-2026-11-14/captures`, local only. Ledger
    via `evidence_engine regrade`.
  - **Engine 56 (#1265)** adds bool-na tracking through tf/sym/tf_merge/ltf nodes. Rebase over it.
- **Scoped 2026-11-14, the runtime machinery already exists:**
  - `vm.js` `OP.REQUEST` (case 79) runs the program from the request's entry over
    `ctx.requestBars['<symbol>|<timeframe>']` (`runRequest`). A missing key answers `na` and is
    recorded in `requested`, which is "run it, read back what it asked for".
  - The gaps:
    - (1) `runtimeColumns.js` refuses any script with `ir.requests` at three sites (~1329, ~1653,
      ~1752), and the chart passes no `requestBars`;
    - (2) **`runRequest` aligns STRICTLY BEFORE** (`otherTimes[j+1] < tNow`). For a same-timeframe
      other symbol (`request.security('SP:SPX', timeframe.period, close)` on a daily chart) that
      hands each bar YESTERDAY's SPX close, where Pine (`lookahead_off`) answers the same day's
      bar. This confirms the peer's flag. Replace it with `tfMergeMask` semantics, both lanes, one
      authority;
    - (3) a supply: the chart's `secondaryBars.js` cache, keyed the same way; the harness's C26
      captures.
- Accept: RS Rating's run-half mints, and the object-lane census shows no new divergence.

**L6 — REVISED 2026-11-14: the seed's own data is public, so ingest it and do not substitute.**
- Fred's generator (`github.com/Fred6725/relative-strength`, Apache-2.0,
  `.github/workflows/output.yml`) writes `output/RSRATING.csv` and copies the SAME file to the
  private seed repo `Fred6725/seed_fred6725_rs_rating` (`data/RSRATING.csv`, the 404) AND to the
  public `Fred6725/rs-log` (`output/RSRATING.csv`, no licence declared). Its git history holds
  every daily upload.
- The encoding, pinned from `rs_ranking.py::generate_tradingview_csv`:
  - percentiles `sorted([98,89,69,49,29,9,1])`, 5 calendar-day rows each, dated back from
    "yesterday", rows `YYYYMMDDT,0,1000,0,<value>,0`;
  - so the NEWEST rows carry the 1st-percentile value (12.5 on 2026-11-10) and the oldest the
    98th (199.57);
  - the script's loop collects distinct values newest-first, so its `first` is the
    1st-percentile value. That contradicts the script's own comments (`first` ~ 199). Either
    TradingView's seed differs from rs-log or the published script misranks today. **The
    capture decides; we reproduce TradingView, not the comments.**
- TradingView's seed series is the union of the uploads, a later upload winning per date. It is
  rebuilt by replaying rs-log's commit history of the file.
- So RS Rating needs NO substituted value. `MATCH_SUBSTITUTED` (L7) is still built for the inputs
  that are substitutes (`syminfo.industry`, seeds with no public mirror).
- Generic shape: a seed registry `(source, symbol)` maps to a public mirror. The default
  candidate is the `tradingview-pine-seeds` org's `<source>/data/<SYMBOL>.csv`; a named mirror
  such as rs-log overrides it. A seed with no reachable mirror refuses by name.

**L6 (original plan, kept for the no-mirror case) seed substitute**: a registry keyed by `(source, symbol)`. An unregistered seed keeps refusing
by name. First entry: `seed_fred6725_rs_rating:RSRATING`. A backend daily job computes Fred's score
(`0.4*p63 + 0.2*p126 + 0.2*p189 + 0.2*p252` of the stock over the same of SPX, x100) across our
universe, takes the 98/89/69/49/29/9/1 percentiles, and serves them as daily bars in the seed's own
encoding. That encoding must be pinned by a capture of the seed symbol on TradingView. The script's
own loop then extracts them unchanged.

Design (2026-11-14):
- **A seed is an other-symbol read of a UCT pseudo-ticker.** `request.seed(src, sym, expr)`
  translates to the same `sym` read as `request.security(<pseudo>, 'D', expr)`.
  - The pseudo-ticker is served by `api/routers/bars.py` as one more locally-served family,
    beside breadth (`UCTA50`) and market indicators (`US:MCO`): D only, `t` is 'YYYY-MM-DD'.
  - So the chart (`secondaryBars.js`), the screener lane and the harness all reuse the
    other-symbol pipeline: one path, no parallel one.
  - The harness's other-symbol supply (C26, committed captures) carries TradingView's own
    seed bars from a capture of the seed symbol. That is how the grade feeds the vendor's value.
- **The engine half builds on #1264** (`requestTargetOf`); the backend half does not.
- **The score is already computed nightly.** `api/services/screener/rs_history.py::ibd_score`
  uses `rs_weighted_return.IBD_TERMS` (0.4/0.2/0.2/0.2 over 63/126/189/252 bars), over about
  6,000 non-ETF US names. Fred's `totalRsScore` is that score divided by SPX's, x100. Dividing by
  one constant does not reorder the stocks, so:
  - each threshold = percentile_k(stock scores) / ibd_score(SPX) * 100;
  - SPX closes come from FMP (owner ruling).

**L7: what the new verdict touches** (surveyed 2026-11-14). Every consumer compares
`verdict == "MATCH"` exactly, so a new `MATCH_SUBSTITUTED` already fails closed everywhere. Three
consumers would mis-file it and need a real change:
- `tools/pine_coverage/coverage_map.py:542/561/919` would bucket it as DIVERGE;
- `tools/vendor_harness/evidence_ledger.py:39` (`VERDICTS`) would reject it;
- `tools/pine_coverage/capability_admission.py` / `api/services/rollout_gate.py::PINE_CAPTURE_MATCH`
  give it no admission row.

**L7 grade + admission**: the `MATCH_SUBSTITUTED` verdict in `tools/vendor_harness/compare.mjs`,
the ledger and `coverage_map`. An allowlist row kind for runtime admission. The member-door
disclosure.

**L1 index symbols** and **L2 untyped input fold**: after #1264, by extending
`staticallyUnservable` / `spellingUnservable` / `requestTargetOf`. No parallel path.

**L8 proof**: capture RS Rating (original source, defaults) on the rig for one stock and one ETF,
daily. Grade with the substituted inputs fed from the capture. Visual side by side. Deploy.

**L8 status (2026-11-15, engine 68 placeholder, branch `pine/rs-l5-runtime-requests`):**
graded on the real supply; NOT admitted. What is and is not proven:

- **Proven: the translation.** Every wall W1-W7 is built, and the member door attaches the
  original source with its run half minted. A local diagnostic, NOT a grade, fed the run
  TradingView's own `SP:SPX` values (Q-RS3) and the seed as captured (Q-RS2). On all three Q-RS1
  charts the RS line then agrees EXACTLY on every bar (maximum relative difference 0: RDDT
  665 of 666 bars, because the diagnostic's SPX begins at the listing and bar 0 reads none; SPY
  8506; NVDA 6997), and the two labels agree in text and in `y`: RDDT 16, SPY 64,
  NVDA 27. It is not recorded as a grade because a grade on TradingView's own SPX would be
  circular.
- **Graded on the real supply** (runtime-on, objects v2). The five L8 rows (three Q-RS1 captures,
  two Q-RS4 probes) are spliced into `docs/pine/vendor-harness/runtime-on/verdicts.json`, under its
  `spliced` key; every other row is left as that snapshot's own run. Regenerating the whole
  snapshot moves 18 captures that other lanes committed on 2026-11-14 into the capability-admission
  reach set. `docs/pine/evidence/2026-11-13-capability-admission/runs/report.json` would then need
  its own reach run first (`test_REACH_the_committed_reach_run_is_the_committed_registrys` goes red
  otherwise). In the full corpus run, the run-half grant (below) changed exactly four verdicts, none
  for the worse:
  - `atr-support-and-resistance` RDDT and SPY: INCONCLUSIVE to MATCH;
  - `atr-trailing-stop-by-ceyhun` RDDT and SPY: DIVERGE to MATCH. These are drawings the host
    withholds by name and the run draws correctly. The supply is recorded beside each capture in `tests/fixtures/vendor-supply/
  <id>.json` (`uct.harness-supply/v1`, read by `ourSide.js::recordedSupplyOf`):
  - SPX is the bars `api/index_bars.py` serves on its yfinance FALLBACK (`_fetch_yf('^GSPC',
    '1d', '5y')`, 1255 sessions from 2021-11-15). FMP, the primary, is not recorded: there is no
    FMP key on this machine.
  - the seed is `pine_seed_store`'s replay of rs-log (812 uploads, newest 64440c2a0187 of
    2026-11-11), read back through `build_bars`.
  - `syminfo.industry` is fed TradingView's string from the committed Q-RS4 probe
    (`rs-syminfo-industry-{rddt,nvda}`), checked against the probe's own label.

  | capture | verdict | why |
  |---|---|---|
  | `rs-rating-fred6724-rddt-1d-2026-11-15` | DIVERGE | Rating label text `16` MATCH (v1). RS line off by at most 2.02e-6 relative on 662 of 666 bars, and the label's `y` (the RS value) by 1.3e-8 (objects v2). The three MA plots are MATCH_SUBSTITUTED. |
  | `rs-rating-fred6724-nvda-1d-2026-11-15` | DIVERGE | Label `27` MATCH (v1), `y` off by 1.3e-8 (v2). The RS line is ALSO `na` before 2021-11-15, because the served SPX is 5 years deep and the chart reaches back to 1999. |
  | `rs-rating-fred6724-spy-1d-2026-11-15` | INCONCLUSIVE | Not graded. The served SPX source (FMP) is not recorded. The L5 builder's probe on the yfinance fallback read 63 where TradingView draws 64. |

  The divergence is the SPX data, not the engine. yfinance's `^GSPC` close differs from
  TradingView's `SP:SPX` by about one cent on 1139 of 1254 sessions (maximum relative difference
  2.02e-6), measured against Q-RS3. The harness tolerance is 1e-9 relative.
- **`syminfo.industry`.** The L3 table has no `by_ours` row and no Stock class row. So on a member's
  chart RDDT and NVDA serve OUR string, tagged substituted. The local `ticker_meta` cache holds
  `Internet Content & Information` for RDDT (TradingView: `Internet Software/Services`) and
  `Semiconductors` for NVDA (the same string as TradingView). Neither is
  `'Investment Trusts/Mutual Funds'`, so line 94's branch is not taken, as on TradingView. The best
  a stock capture can grade is therefore MATCH_SUBSTITUTED. SPY (ETF) serves the witnessed class
  row. The harness does not thread `securityType`, so it cannot grade that row yet.
- **Admission: no allowlist record was added.** No capture grades MATCH or MATCH_SUBSTITUTED.
  Three things stand between this and a member's chart:
  1. the SPX data: record what FMP serves (on the pod, or on a machine with the key) beside the
     three captures, and regrade. If FMP's closes are TradingView's, RDDT grades
     MATCH_SUBSTITUTED.
  2. SPX depth: on a chart with more than 5 years of bars, the RS line is blank before the served
     SPX begins (`INDEX_FMP_LOOKBACK_DAYS`, yfinance `period=5y`).
  3. ⛔ **The run-half evidence rule cannot count a substituted capture.**
     `runHalfRailSeam.js::runHalfEvidenceAdmits` counts only `verdict: MATCH`. A stock capture of
     RS Rating is at best MATCH_SUBSTITUTED, so its run half (the rating labels) cannot be
     admitted from stock captures until that rule gets the L7 substituted path, or until two ETF
     captures (witnessed industry) grade MATCH.
- **Run-half evidence, production wiring (built, empty).** An allowlist record's capture may
  carry `objectsV2: "MATCH"`. For SERVED records, `runtime_definitions.run_half_evidence` passes
  those captures on, and `/api/user-definitions/runtime-kill` serves them as `run_half_evidence`
  (absent when empty, so the read is unchanged today). `runtimeKill.js::latchRuntimeLists`, the one
  latch both `MemberPane` and the recheck use, feeds them to `setRunHalfObjectEvidence`.
  `tests/test_pine_run_half_evidence.py` holds every claim to the runtime-on verdicts. The
  harness's runtime-on lane grades every run half as admitted (`__admitEveryRunHalfForTests`, an
  upper bound like the allowlist grant), because that lane's grade IS the evidence.
- **4b (peer report).** `request.security(syminfo.tickerid, 'D', close)` on a weekly or an intraday
  chart refused `interpret:bind-time-text` on the symbol. It now refuses `runtime:request` by the
  timeframe. RS Rating on a weekly chart is refused by name and draws nothing:
  - every host plot is refused `other-symbol:witness-timeframe` (SP:SPX is witnessed on D only);
  - the run half is refused `pine:request`.
  - ⭐ **Superseded on a WEEKLY chart by L11 (2026-11-17, below):** RS Rating is served there. On an
    intraday chart the refusal stands.

**L9 status (2026-11-15, engine 68 placeholder, branch `pine/rs-l5-runtime-requests`):** the
three L8 blockers are addressed. RDDT grades MATCH_SUBSTITUTED; NVDA still DIVERGEs on the RS line
by FMP-vs-TradingView history; still NOT admitted.

- **(b) Depth: built.** `api/index_bars.py` reads daily index bars from 1990-01-01
  (`INDEX_DAILY_HISTORY_START`):
  - FMP is paged in 5-year windows (`FMP_PAGE_DAYS`, `INDEX_FMP_PAGE_DAYS`), oldest first, rows
    oldest-first and deduplicated by session.
  - A page that errors, an empty page after the history began, or a gap over 10 calendar days
    (the 9/11 closure leaves 7) is never served; the read falls back.
  - The yfinance fallback reads `period="max"` and is cut at the same start.
  - `INDEX_FMP_LOOKBACK_DAYS` still overrides both.
  - `/api/bars` slices the cached series, so the first-paint request (bars=600) is unchanged. A
    deep request (bars=12500, e.g. an indicator reading SPX) gets 9286 sessions (~223 KB gzip, was
    1255 / ~33 KB). `/api/bars-history` still refuses indices. A member's own SPX chart in the
    split-fetch cohort (100%) therefore still paints 600 bars and gets no deeper history.
    Serving index depth through the history door is open.
- **(c) Run-half evidence: built along L7.** `runtime_definitions.run_half_entry_admits` and
  `runHalfRailSeam.js::runHalfEntryAdmits` are one rule, pinned by
  `tests/fixtures/ast/run_half_evidence_parity.json`.
  - A record without `admission` counts MATCH captures.
  - `admission: "substituted"` counts MATCH_SUBSTITUTED captures whose own `substituted` names
    equal the record's.
  - Each counted capture has objects-v2 MATCH and the runtime pane on; at least 2 distinct.
  - The server serves only admitted entries; the client re-applies the rule.
  - Measured on Q-RS1: a substituted capture's objects-v2 grade is itself MATCH_SUBSTITUTED, never
    MATCH. Ruled (coordinator, 2026-11-15, after owner ruling (a)): ON THE SUBSTITUTED PATH ONLY a
    counted capture's objects-v2 grade may be MATCH_SUBSTITUTED, when its own names
    (`objectsV2Substituted` on the allowlist capture) are exactly the record's. Its verdict must
    still be MATCH_SUBSTITUTED with equal names. A record without `admission` still needs objects-v2
    MATCH. Built on both sides (parity cases L9b).
- **securityType in the harness: built.** A supply record's `store.securityType` (`Stock` / `ADR`
  / `ETF`, naming its `source`) reaches `ctx.symbol`, so an ETF keys the L3 class row. No committed
  record states one: our store's class is not readable on this machine.
- **The supply is FMP, committed under the owner ruling below.** FMP ^GSPC (the primary) was
  recorded by the owner (2026-11-15T13:50:55Z, 9286 sessions from 1990-01-02).
  - It was read back through the server's own `_fetch_fmp_daily`, and is committed in the RDDT and
    NVDA records with `source` FMP and the ruling quoted in `licence`.
  - It replaces the L8 yfinance rows, which the grade does not need; those stay in history at
    `bce0de1ecb`.
  - A rail (`vendorHarness.l9LocalSupply.test.js`) allows inline provider bars only in these
    RS Rating records, and only when they quote the ruling.
  - Provider supply no ruling covers uses a manifest (`rows: {file, sha256, count, first, last}`).
    Its rows live in `$UCT_HARNESS_SUPPLY_STORE` (default `%LOCALAPPDATA%/uct-vendor-batch/supply`),
    and without the file the grade is refused by name.

  | capture | verdict | why |
  |---|---|---|
  | `rs-rating-fred6724-rddt-1d-2026-11-15` | MATCH_SUBSTITUTED | RS line 666/666 exact (maxRel 0), MA plots, labels (objects v2 MATCH_SUBSTITUTED). Substituted: `syminfo.industry`. |
  | `rs-rating-fred6724-nvda-1d-2026-11-15` | DIVERGE | Labels exact (objects v2 MATCH_SUBSTITUTED). RS line valued on all 6997 bars, 5705 exact. The 1292 that differ are all before 2023-12-05: 89 by more than 1e-4 relative, the largest 1.83e-2 on 2006-01-20. This is FMP's history against TradingView's. |
  | `rs-rating-fred6724-spy-1d-2026-11-15` | INCONCLUSIVE | Not graded (owner ruling). |

- **Still not admitted.** Only one capture grades MATCH_SUBSTITUTED, and the run-half rule needs
  two. No allowlist record was added. Next: Q-RS1b (RS Rating on NASDAQ:ALAB and NASDAQ:CRWV 1D, both
  listed after 2023-12-05, where FMP is exact) and Q-RS4b (the industry probe on the same).

**Integration status (2026-11-15, engine 68 placeholder, branch `pine/rs-rating-integrate`):**
the program branch merged with master `fd670de1ee`. Graded on three captures; NOT admitted.

- **Q-RS1b / Q-RS4b graded** (s13-2026-11-15, from the listing, committed as harness fixtures with
  their supply records in the RDDT pattern: the same FMP ^GSPC rows and seed replay, the industry
  read off each probe). Runtime-on, objects v2, tolerance unchanged (1e-9 relative):

  | capture | verdict | why |
  |---|---|---|
  | `rs-rating-fred6724-alab-1d-2026-11-15` | MATCH_SUBSTITUTED | RS line and the three MAs 667/667 exact (maxRel 0); labels objects v2 MATCH_SUBSTITUTED (18/18 fields, v1 MATCH, rating 76). Substituted: `syminfo.industry` (`Semiconductors`). |
  | `rs-rating-fred6724-crwv-1d-2026-11-15` | MATCH_SUBSTITUTED | 411/411 exact on every plot; labels objects v2 MATCH_SUBSTITUTED (18/18, rating 13). Substituted: `syminfo.industry` (`Packaged Software`). |
  | `rs-rating-fred6724-rddt-1d-2026-11-15` | MATCH_SUBSTITUTED | regraded in the same run; the row is identical to the committed one. |

  The four new rows (two Q-RS1b, two Q-RS4b probes, INCONCLUSIVE as the RDDT probe is) are spliced
  into `docs/pine/vendor-harness/runtime-on/verdicts.json` under `spliced`. The xmap sidecars are
  not committed: objects v2 never grades `x`, so the grade does not read them (L4d).
- **The run-half rule is met** (three distinct MATCH_SUBSTITUTED captures, each objects v2
  MATCH_SUBSTITUTED with equal names, pane on). **The allowlist record is not.** R1
  (`rollout_gate.pine_runtime_admission`, the per-script gate both the browser pane and the server
  lanes ask) withholds the record by name, because the census detector
  (`coverage_map.features_of`) finds 11 capabilities in the original source and three are not
  conformant:
  - `conditional-ta` is `divergent` (R4). RS Rating's conditional `ta.*` sit under constant
    conditions, the case L4 built; the registry row does not tell that case apart.
  - `switch` and `max_bars_back` have no registry row.

  A committed record would therefore be WITHHELD, and `test_WSI_R1_every_COMMITTED_script_passes_R1`
  would go red by name, as it is meant to. So no record was added. Admission needs a ruling on
  the registry: split or regrade `conditional-ta` for constant conditions, and add conformant
  `switch` / `max_bars_back` rows with named evidence. Then the record is: `admission:
  "substituted"`, `substituted: ["syminfo.industry"]`, sha256 `caa94fe31a87...` (the original
  source), captures RDDT / ALAB / CRWV each `objectsV2: "MATCH_SUBSTITUTED"`,
  `objectsV2Substituted: ["syminfo.industry"]`.
- **The server lane (HP-7).** `services/pine_runtime/job.mjs` declares what a server run does not
  carry:
  - the L3 symbol fields (the wire symbol is `{ticker, exchange}`), so a server run refuses
    `syminfo.industry` by name (`interpret:bind-time-text`);
  - the L5 other-symbol cache, so a server run of `request.security('SP:SPX', …)` is refused
    `runtime:request` by name (`otherSymbolSupply: false`). Before this it was held as "still
    loading", which on the server never ends.

  An admitted RS Rating would therefore draw on a member's chart and be refused by name on alerts
  and scans.

**ADMITTED FOR ITS PLOTS; THE LABELS ARE NOT (2026-11-16, engine 58, corrected the same day).**
The registry blockers named above are gone: `switch` and `max_bars_back` are conformant since #1347
(U1 + U3) and `conditional-ta` since #1409 (COND-TA). The record is in
`api/data/pine_runtime_allowlist.json`: slug `rs-rating-fred6724`, sha256 `caa94fe31a87...5af0`
(the original source), `admission: "substituted"`, `substituted: ["syminfo.industry"]`, the 11
census capabilities, and the three captures RDDT / ALAB / CRWV, each `MATCH_SUBSTITUTED` with the
runtime pane on and **`objectsV2: "INCONCLUSIVE"`**.

- ⚰️ **The correction.** #1410 merged the record with `objectsV2: "MATCH_SUBSTITUTED"` on all
  three captures. That value was copied from this document and from snapshot rows graded BEFORE
  U13 (#1335), when objects v2 did not grade x. Graded on master `d615e76494` with master's own
  harness, all three are: capture MATCH_SUBSTITUTED, objects v1 MATCH, **objects v2 INCONCLUSIVE**
  (`verdictWithoutX` MATCH; x: 0 graded, 2 not resolvable, "the capture records no x table (taken
  before U13)"). The record claimed evidence the harness does not reproduce. The landing train's
  re-grade found it; the record now says what is graded.
- **What each grade covers.**
  - Objects v1 (what `runtimeAllowlistParity.test.js` reads): counts, texts and colours. No
    coordinates.
  - Objects v2 with x witnessed is what admits a run half (`run_half_entry_admits`,
    `runHalfEvidenceAdmits`).
  - A capture that records no x table can never admit one.
- **What a permitted account gets** (`PINE_RUNTIME_STAGE` is `admins` on production, so today
  that is admins only): the RS line and its three averages, with `syminfo.industry` disclosed as
  UCT data. The two labels ("RS Rating" and the rating number) are withheld by name
  (`pine:object-removal-lost`): the run half that draws them is not admitted.
- **What the grade proves, and what it does not** (narrowed 2026-11-16; the earlier wording here,
  "equal to TradingView's on every bar of the three captures", was true and read wider than it is).
  - **Proved:** on RDDT, ALAB and CRWV 1D the RS line and its three averages equal TradingView's on
    every bar (666 / 667 / 411). All three stocks listed after 2023-12-05, so no bar of the proof
    is older than that date.
  - **Not equal, and a member sees it:** the plots are served on every symbol, not only the graded
    three. On NVDA 1D the RS line differs from TradingView's on **1,292 of 6,997 bars**, every one
    of them before 2023-12-05 (first 1999-01-28, last 2023-12-04); the other 5,705 are exact. The
    largest difference is 1.83% of the value (maxRel 1.8326e-2, maxAbs 1.78e-2). Re-derived
    2026-11-16 from the harness's own statistics on master `d615e76494` (both lanes agree). The
    2026-11-15 grade also recorded that 89 of the 1,292 exceed 0.01% and that the largest falls on
    2006-01-20; those two figures were NOT re-derived on the 16th. The three averages agree on all
    6,997 bars.
  - **Cause as recorded, not proved bar by bar:** the S&P 500 history. We serve FMP `^GSPC`;
    TradingView reads `SP:SPX`. Q-RS3's probe (`rs-spx-daily`), which would compare the two series
    directly, grades INCONCLUSIVE because no supply is recorded for it. Tracked as Q-RS9.
  - **Not part of the proof at all:** the member's own stock bars. The harness feeds our engine
    TradingView's chart bars from the capture, so the grade says our arithmetic and our SPX and
    seed supply reproduce TradingView's output on TradingView's bars. Whether our stored bars for
    a stock equal TradingView's is a separate question this grade does not answer.
  - **The rating seed is proved separately:** Q-RS2's probe grades MATCH on all 666 RDDT bars in
    both lanes (values, na pattern and bars-since), now that its supply is recorded
    (`tests/fixtures/vendor-supply/rs-seed-rsrating-rddt-1d-2026-11-15.json`). Before that record
    it graded DIVERGE only because nothing was supplied.
- **What an ordinary member gets today:** the same four plots and no labels, for a second reason
  as well: the run half is declined `run-half:pane-off` ("the per-bar runtime pane is not on
  here") until the runtime stage is raised from `admins`. Measured on master, the committed
  allowlist latched.
- **What an admin actually sees (real browser, 2026-11-16, engine 59, build `8cdb0af178`).** The
  smoke account in its own headless browser, production `/charts`, RDDT 1D, the committed source
  pasted through "paste a TradingView script" (textarea sha256 = the allowlisted hash), added to
  the chart:
  - the RS line is drawn (legend "RS Rating 43.57") and the three averages are listed with no
    value (off at default inputs, as in the captures); one plot is hidden by the author;
  - no label is drawn, and the note under the chart says so in two sentences (the drawings
    sentence ending "...that run hasn't been checked against TradingView for this script", and
    the `syminfo.industry` sentence).
  - ⚠️ **The RS line was mostly off screen**: 43.57 under a price scale of about 80 to 220. The
    values were right and not visible. Fixed by the price-scale join (engine 61, NUMBER PENDING):
    an imported `overlay = true` script's plots take part in the price pane's autoscale, as
    TradingView's do by default. With that build swapped into the same browser session the scale
    reads about 20 to 220 and the whole line is in view under the bars. Rests on TradingView's
    documented default; no capture records a visible price range (Q-RS10).
  - ⚠️ **For the seconds the SPX and seed bars took to load, the note named a wrong cause** ("the
    script reads another symbol or timeframe, which this chart cannot hand that run"). A run
    waiting for bars is now held with no cause worded (same PR).
- **What finishes it.** Q-RS8 (`docs/pine/capture-queue-2026-11-14-rs-rating.md`): re-take the
  three captures with the current `tv_capture.js`, which records the x table. If objects v2 then
  grades MATCH_SUBSTITUTED with x witnessed, the record's `objectsV2` is set from THAT grade and
  the labels are admitted for permitted accounts. Raising the runtime stage for members is the
  owner's act.
- **Still not served either way.** A member's own EDITED copy (admitted only by capability, and
  `request-other` has no registry row); alerts and scans (the server lane refuses the script by
  name, HP-7 above). SPY is ungraded (owner ruling).
- **Served, and different from TradingView:** the RS line on bars before 2023-12-05 (NVDA above;
  any stock with history that old is exposed the same way). Q-RS9 holds it for the owner's ruling.
- ⛔ **Checklist line, from this mistake:** an allowlist record's capture fields (`verdict`,
  `objectsV2`, `objectsV2Substituted`) are copied ONLY from a grade taken on the tree being merged,
  never from a document or a spliced snapshot row.

**THE LABELS ARE ADMITTED (Q-RS8, 2026-11-16, graded on master `b7cd7a0e63`, engine 60).**

- **Re-captured.** The owner signed in to the capture rig once. RS Rating (the committed source,
  default inputs) and the `rs-syminfo-industry` probe were re-taken on NYSE:RDDT, NASDAQ:ALAB and
  NASDAQ:CRWV 1D, each from the listing, with the capture tool that records the object x table
  (`objects.xIndex`, `uct.object-x-index/v1`). Six captures, committed beside the 2026-11-15 ones
  (which stay as history): `rs-rating-fred6724-{rddt,alab,crwv}-1d-2026-11-16` and
  `rs-syminfo-industry-{rddt,alab,crwv}-1d-2026-11-16`. Their chart bars end on the same session
  as the earlier captures' (2026-11-13) and TradingView draws the same ratings (16 / 76 / 13).
- **Supply.** `tests/fixtures/vendor-supply/rs-rating-fred6724-{rddt,alab,crwv}-1d-2026-11-16.json`:
  the 2026-11-15 records copied unchanged (the same FMP `^GSPC` rows under the same ruling, the
  same seed replay), with the industry read off the probe re-taken in the same session.
- **Graded with master's own corpus harness, a run of exactly these captures, both lanes.**

  | capture | runtime-on | objects v1 | objects v2 | production lane |
  |---|---|---|---|---|
  | `rs-rating-fred6724-rddt-1d-2026-11-16` | MATCH_SUBSTITUTED, 666 bars on each of the 4 plots | MATCH | MATCH_SUBSTITUTED: 18 graded fields agree; x: 2 graded, 2 agreeing, 0 differing (exact bar) | DIVERGE: the plots agree, the drawing is withheld by name (`pine:object-removal-lost`) |
  | `rs-rating-fred6724-alab-1d-2026-11-16` | MATCH_SUBSTITUTED, 667 bars | MATCH | MATCH_SUBSTITUTED, x 2 of 2 exact | DIVERGE, the same reason |
  | `rs-rating-fred6724-crwv-1d-2026-11-16` | MATCH_SUBSTITUTED, 411 bars | MATCH | MATCH_SUBSTITUTED, x 2 of 2 exact | DIVERGE, the same reason |

  The three probes grade INCONCLUSIVE in both lanes, as the 2026-11-15 probes do (they are read
  for TradingView's industry string, not graded as indicators).
- **The record** (`api/data/pine_runtime_allowlist.json`) now names the three 2026-11-16 captures,
  each `objectsV2: "MATCH_SUBSTITUTED"`, `objectsV2Substituted: ["syminfo.industry"]`, copied from
  that grade. The run-half rule is met (three distinct captures, names equal, pane on), so
  `run_half_evidence` serves exactly this script's three captures and nothing else.
- **What changes on a chart.** For an account the runtime pane is on for (`PINE_RUNTIME_STAGE`,
  `admins` on production today), RS Rating's run half is admitted: the "RS Rating" label and the
  rating number are drawn by the per-bar run, at the script's own settings, on a chart that starts
  at the listing. Everything else the run half checks still applies (a changed setting, a chart
  that does not start at the listing, a column that disagrees: each withholds by its own
  sentence). For an account the pane is not on for, nothing changes: `run-half:pane-off`.
- **Controls kept.** `test_E1c`: a record built on the 2026-11-15 captures (no x table, objects v2
  INCONCLUSIVE) serves nothing and admits nothing, and claiming the grade for them is caught by
  name.

## L11: RS Rating on a WEEKLY chart (2026-11-17, PR 1 of 2, engine 74 (#1737, the engine 74 train), branch `feat/rs-weekly-witness`)

**Weekly is served.** Before L11 every plot was refused `other-symbol:witness-timeframe` on a weekly
chart and the run half `pine:request` (4b). Now RS Rating draws its RS line and both labels there.

**The witness.** Q-RS7, batch `rs-weekly-2026-11-17` (taken 2026-11-17 ~21:17Z, after the close; newest
week FORMING):
- `rs-rating-fred6724-w-rddt-1w-2026-11-17` (NYSE:RDDT 1W, 140 bars) and
  `rs-rating-fred6724-w-nvda-1w-2026-11-17` (NASDAQ:NVDA 1W, 1453 bars from 1999). The original
  source (sha256 `caa94fe3…5af0`), default inputs. MPL-2.0, so both are committed beside the daily
  captures (`tests/fixtures/vendor/harness/`).
- `rs-spx-daily-w-rddt-1w-2026-11-17` and `rs-seed-rsrating-w-rddt-1w-2026-11-17` (UCT probes, NYSE:RDDT
  1W). **Kept local** (`%LOCALAPPDATA%/uct-vendor-batch/runs/rs-weekly-2026-11-17/captures`).
- TradingView draws two labels on the weekly chart: `"                RS Rating"` and `""`. The rating
  text is empty there by the script's own design (`isDaily` gate, line 357), unless `ratingOnly` is on.

**The rules** (`requestWitnesses.json`, each row's `periods.W` block; every one checked against the
captures before it was coded, on every visible week):

| rule | read | on a weekly chart | evidence |
|---|---|---|---|
| R1 | `SP:SPX` at `timeframe.period` (the RS line, line 89) | each week reads the PREVIOUS week's last daily close (`previous-week`): week of 2026-11-09 reads 2026-11-06's 7376.86; 2026-11-02 reads 2026-10-30's 7580.07 | 139/139 settled RDDT weeks against FMP ^GSPC daily (max relative difference 0) and 138/138 against TradingView's own daily SP:SPX (the committed `rs-spx-daily-pm-rddt-1d-2026-11-16`); holiday weeks included (Good Friday 2025-04-18 and 2026-04-03, 2026-07-03, every Monday holiday) |
| R2 | `SP:SPX` at `"D"` (line 188) | each week reads the previous-session-aligned daily bar at its LAST session (`week-last-row`): its Thursday close in a full week (2026-11-12's 7592.40 for the week of 2026-11-09), Wednesday's in a Good Friday week; open / high / low the same bar's | 139/139 settled weeks, all four fields |
| R3 | `syminfo.tickerid` at `"D"` (line 187) | the week's last daily close, which IS the weekly close | TradingView's weekly close equals its last daily close on 139/139 RDDT weeks (the weekly capture against the committed daily one); on the forming week both are the latest price |
| R4 | `request.seed(…)` = `SEED_…:RSRATING` at `"D"` (line 253) | the seed row dated the week's FIRST calendar day, Monday (`week-first-day`); a week with no such row reads `na` | 140/140 weeks against `pine_seed_store`'s replay as it stood at the capture (newest upload `af528c134fb9`, 2026-11-17T09:39:26Z): week 2026-11-09 reads 39.88 (its Monday row) although 2026-11-12..15 hold 12.98; week 2026-11-16 reads 12.98; week 2026-10-12, whose Monday has no row (the series begins on the 13th), reads `na` where the week's first row would have been 190.9 |

**How it is built.**
- **Fetch and hold at D.** On a weekly chart SP:SPX and the seed are fetched from `/api/bars/<store>?tf=D`
  and cached under their own key (`SPX@D`, `SEED_…:RSRATING@D`; `otherSymbols.js::heldFetchOf`, one
  answer for `sourceRef.symbolsNeeded`, `useSecondarySources.ensureChartSources`, the binder's memo key,
  `headlessCompute`'s supply and the harness). Depth `heldDepthOf`: 7 rows per weekly bar + 14, capped at
  12,500 (FMP from 1990 is 9,288 sessions). `/api/bars/SPX?tf=W` (yfinance 1wk, Monday keys, ten years)
  and the seed's `tf=W` (no data) are never asked.
- **R1, both lanes.** `previousWeekBarsOf`: the held rows folded into Monday-to-Sunday weeks (the weekly
  bar `resampleTo` builds), each keyed by the product's weekly key (its Friday) one calendar week later.
  Placed by the calendar, so a chart week whose own SPX rows have not arrived still reads the week before.
  The host lane (RS line) and the run (`requestAlignment`) read the same series.
- **R2 / R4, the run.** `pine.js::dailyOnWeeklyTargetOf` reads another symbol's `"D"` request on a weekly
  base as `{code: 'D', below: true}`. `requestSupply.js::belowChartRead` asks the bind for that read
  (`witnessReadOf(row, 'W', 'D')`), runs the request's expression on the HELD DAILY series (the row's own
  daily read: `previous-session` for SPX, `same-date-gaps-na` for the seed) and samples each chart week
  (`weekSampleOf`). The host lane keeps the daily base's gate on such a read, so it is withheld whole by
  name there (`request:other-timeframe`); a run COLUMN that would read one is refused `runtime:request`
  by name (the run reads it only as its own variable, the way RS Rating writes it).
- **R3, the identity.** Served for a bare `close` only: `request.security(syminfo.tickerid, 'D', close)`
  on a weekly base is the chart's own `close` (gated to the weekly chart, recorded in `baseFolds`).
  Chosen over evaluating the expression on the symbol's daily bars because a weekly chart holds none (that
  is a new own-symbol daily supply in the chart, the headless door and the harness, and the harness has no
  daily bars of the forming week). Every other expression keeps its refusal by name.

**Graded by the harness** (`batch_capture.py grade --run-dir …/rs-weekly-2026-11-17`, both lanes; supply
records `tests/fixtures/vendor-supply/rs-{rating-fred6724-w-{rddt,nvda},spx-daily-w-rddt,seed-rsrating-w-rddt}-1w-2026-11-17.json`:
FMP ^GSPC daily through 2026-11-16 (the owner's 2026-11-16T23:13Z recording, inline in the RS records
under the 2026-11-15 ruling, by manifest in the probe's record) and the seed as served at the capture):

| capture | runtime-on | production |
|---|---|---|
| `rs-rating-fred6724-w-rddt-1w-2026-11-17` | DIVERGE: RS line 139/140 (every settled week exact, maxRel 0 on them); the ONE difference is the forming week (37.8408 vs 36.7341); the three averages MATCH_SUBSTITUTED 140/140; objects v1 MATCH (both labels, texts equal); objects v2 DIVERGE only on the labels' `y` (the RS value of the forming week, the same difference), x 2 of 2 exact | the same plots; objects DIVERGE (the run half is dark: `pine:object-removal-lost`, as on daily) |
| `rs-rating-fred6724-w-nvda-1w-2026-11-17` | DIVERGE: RS line 1186/1453; 266 settled weeks differ, every one before 2023-12-05 (first 1999-02-22, last 2023-12-04, the accepted S&P 500 history, Q-RS9), plus the forming week; averages MATCH_SUBSTITUTED; objects v1 MATCH; objects v2 DIVERGE only on the labels' `y` (the forming week), x 2 of 2 exact | the same plots; objects DIVERGE (run half dark) |
| `rs-spx-daily-w-rddt-1w-2026-11-17` | DIVERGE: X05 (R1) 139/140, the forming week the one difference (7340.53 vs 7561.67); X01..X04 INCONCLUSIVE by name (host lane: `request:other-timeframe`) | the same |
| `rs-seed-rsrating-w-rddt-1w-2026-11-17` | INCONCLUSIVE: S01..S05 withheld by name in the host lane (`request:other-timeframe`); S06 control MATCH | the same |

The host lane does not read a daily series below the chart, so the probes' `"D"` plots are graded on the
RUN, with the harness's own supply and comparator (`vendorHarness.l11WeeklyWitness.test.js`, run when the
local captures are present at their recorded sha256, skipped by name otherwise). The capture does not
start at the listing, so the run withholds its first 31 weeks (its off-listing warm-up, the runtime lane's
own rule); on the 109 weeks after it X01..X05 equal TradingView on every settled week, the forming week
the one difference, and S01..S05 equal on all 109 (the forming week included; the rule itself was checked
on all 140 weeks against the replay, above).

**⏳ The one known difference: the FORMING week.** TradingView reads the latest SPX value there
(7340.53 on 2026-11-17, both `"D"` and `timeframe.period`); this engine reads the previous week's close
(R1) and the newest placed daily row (R2), as the daily previous-session rule does. **PR 2** settles it
on an in-session capture (Q-RS7b).

**A daily chart is byte-identical.** Our side's columns, objects and refusals on all 32 committed daily
RS Rating, seed and SPX captures are equal on the base (`99e99171ee`) and on this branch (sha256 per
capture), with the two weekly captures as the control that the comparison saw the change (refused on
the base, served here). A daily row has no weekly block and its keys are the plain store keys.

**Not settled, by name.**
- The weekly OPEN / HIGH / LOW of `SP:SPX` at `timeframe.period`: the probe captured only the close (X05);
  the fold serves them as the weekly resample builds them, unwitnessed.
- A `"D"` read of another symbol below a weekly chart that is NOT a witnessed spelling (a listing): refused
  `other-symbol:witness-timeframe`; no capture shows how TradingView samples one.
- R4 when a week's Monday is a holiday: the 35-day seed window had none; the rule reads the Monday's
  calendar row regardless (seed rows exist for every calendar day).
- A pre-existing runtime-lane hole, NOT changed here: on a plain (non-drawing) runtime run, a request bound
  to a name and read inside a pure expression (`na(s_c)`) goes to the columnar lane, which holds no
  other-symbol supply (on a daily chart it draws `1` on every bar for `na(seed)`). RS Rating's run half
  (the drawing build) reads it as a slot and is not affected. On a weekly chart that column is now refused
  by name instead.

## L13: Fred RS on a MONTHLY chart (2026-11-18, branch `feat/rs-monthly-witness`, stacked on L11 PR 2)

**Monthly is served.** Before L13 a 1M chart drew no RS line: both witness rows covered D and W only, so every
plot was refused `other-symbol:witness-timeframe` and the chart showed the "complete set of this script's drawings
isn't shown" note (found by the 10-member production sweep at engine 76). TradingView draws it.

**Witnessed** on the `rs-monthly-2026-11-18c` captures (pre-market 13:0xZ, newest month forming; Q-RS-M in the
capture queue): Fred RS on NYSE:RDDT 1M (33 months from the 2024-03 listing month) and NASDAQ:NVDA 1M (335 months
from 1999-01), committed (MPL-2.0); the `rs-spx-daily` and `rs-seed-rsrating` probes on NYSE:RDDT 1M (local).
`requestWitnesses.json` gains `periods.M` on both rows, held at `D` like the weekly blocks:

- **R1** `SP:SPX` at `timeframe.period`: each month reads the PREVIOUS month's last daily close
  (`previous-month`; 32/32 settled RDDT months against our FMP daily). Fred RS's RS line is close / that x 3360
  (4200 x 80 / 100: `timeframe.isweekly` is false on 1M) on all 33 RDDT months. The forming month on this fresh
  load read October's 7580.07, as PR 2 serves it (its own month only while the index session is on).
- **R2** `SP:SPX` at `"D"`: each month reads the previous-session bar at its LAST session (`month-last-row`,
  o/h/l/c 32/32). The FORMING month read 7340.53, the newest SPX close (2026-11-17), which the previous-session
  read places on its NEXT session (2026-11-18), inside November. One rule for weekly and monthly
  (`otherSymbols.js::belowChartSeriesOf`, coordinator ruling 2026-11-18): a `*-last-row` sample reads the newest
  held row on its next session (the exchange calendar). The weekly after-close capture (X04 7340.53) is the
  second witness; the weekly rail's forming week now reads it (`rsWeeklyWitness.test.js` R2). A daily chart's
  series is unchanged (the row is kept beside it, not enumerable).
- **R3** this chart's own symbol at `"D"`, a bare `close`: the monthly close is its month's last daily close
  (32/32 settled RDDT months, the 1M capture against the committed daily one): the identity, as on weekly.
- **R4** the seed at `"D"`: the row dated the month's FIRST SESSION (`month-first-session`): November read 75
  (Monday 2026-11-02's row), not Sunday 2026-11-01's 92.81; October read `na` (no 2026-10-01 row; the series
  begins 2026-10-13).

**On 1M TradingView draws the labels "RS Rating" and an EMPTY rating** (the script prints the number only when
`timeframe.isdaily`, unless Rating Only is set): the run half draws the same (objects MATCH).

**Graded by the harness** (`vendorHarness.l13MonthlyWitness.test.js`, runtime-on): RDDT 1M RS line 33/33 months
exact, the listing month and the forming month included, every average agreeing on every bar (the capture reads
INCONCLUSIVE for one reason only: the longest average's warm-up is longer than 33 months); NVDA 1M exact on every
month from 2023-12-05 (earlier: Q-RS9's accepted S&P 500 history); the SPX probe X01..X05 and the seed probe
S01..S05 equal on every graded month. Unit rails `rsMonthlyWitness.test.js`; the held fetch asks 31 calendar days
a month plus two months (`heldDepthOf(n, 'M')`).

**Found beside it, fixed separately (#1852):** our `/api/bars/RDDT?tf=M` dropped the listing month (and SPY's
January 1993): the serve-time reuse cutoff read a monthly series' 31-day step as a gap. The harness grades on the
capture's own bars, so L13's grade does not depend on it; a member's monthly chart does.

**Not settled, by name.**
- The monthly OPEN / HIGH / LOW of `SP:SPX` at `timeframe.period` (only the close, X05, is captured).
- R4 on a month whose first session has no seed row but a later day does: read `na`, as October was.
- The forming month's R1 on a chart that ticked after the close (PR 2's residual, unchanged).

## L12: Fred RS's RS line on INTRADAY charts (2026-11-18, PR 1 of 2, branch `feat/rs-intraday-witness`, stacked on L13)

**The RS line is served on 1 / 5 / 15 / 30 / 60 minute charts.** Before L12 an intraday chart drew no RS line: the
witness rows covered D, W and M only, so every plot was refused `other-symbol:witness-timeframe` (found by the
10-member production sweep at engine 76). TradingView draws it.

**Witnessed** on two local batches (Q-L12-1): `l12-pm-2026-11-18` (pre-open 14:2xZ, the newest bars settled: the
`rs-spx-daily` probe and Fred RS on NYSE:RDDT 5 and 60, Fred RS on NASDAQ:NVDA 60) and `l12-is-2026-11-18` (in
session 15:05-15:17Z: the probe on NYSE:RDDT 1 / 5 / 15 / 30 / 60, Fred RS on RDDT 5 / 30 / 60 and NVDA 60).
`requestWitnesses.json` gains `periods.<1|5|15|30|60>` on SP:SPX, held at the chart's own timeframe AND at D
(`alsoHeld: 'D'`, the `SPX@D` key: the official daily closes), read `latest-at-or-before`: each chart bar reads the
index's latest value at or before its open, Pine's `gaps_off` (`otherSymbols.js::atOrBeforeGridOf`, laid out on the
chart's own extended-hours grid, 04:00..20:00 ET every `tf` minutes, so both lanes read it by an exact bar time):

- **A regular-hours chart bar reads the SPX bar that opened at or before it** (the same bar on a 5m grid). Settled bars against our
  `/api/bars/SPX?tf=<tf>` rows, to the 2-decimal print: 1m 2,339 / 2,343, 5m 4,604 / 4,611 (pre-open 4,617 /
  4,620), 15m 1,534 / 1,535, 30m 767 / 768. Every miss is a yfinance print 0.02 to 0.20 off or our NEWEST stored
  bar (a partial print served as settled: #1868 part 3). Fred RS's RS line is close / that close x 3360 on all
  4,680 shared bars of the pre-open RDDT 5m capture.
- **Extended-hours bars** (the rig layout is an EXTENDED-hours chart, and so is the product's stock grid: RDDT 5m
  534 pre / 1,013 regular / 453 post of its last 2,000 bars): pre-market reads the previous session's OFFICIAL close,
  post-market the day's (5m: 1,988 / 1,678; 15m 967 / 817; 30m 567 / 458). Read from the held daily rows: an
  intraday bar's last print is the 15:59 trade, never the closing auction (0 of 59 sessions equal on 5m). From the
  close (16:00, 13:00 on a half-day) and only once that session's daily row is held and settled.
- **60m** on the extended grid (hour-aligned 04:00..19:00, the product's too, while SPX's hourly bars open at
  :30): each bar reads the SPX hourly bar that OPENED at or before it in its session (the 10:00 bar the 09:30 one;
  360 / 360). An exact-time match would leave every 60m bar empty.
- **Never filled forward past what is held**: no row after the newest SPX bar's own period (a stale copy withholds;
  it never repeats its last print), no regular-session row before a session's first held bar, no post-close row
  while that session's daily row is still forming.

**Witnessed and inferred, by name.**
- WITNESSED (TradingView, extended-hours charts, the rig layout's own session): the regular-session read on 1 / 5 /
  15 / 30m (same open time) and on the hour-aligned 60m grid (the bar that opened at or before, 360 / 360); the
  pre-market read (the previous official close) and the post-market read (the day's) on every timeframe captured;
  Fred RS's RS line on RDDT 5 / 60 and NVDA 60.
- INFERRED, not captured: a REGULAR-hours grid (09:30, 10:30, ... on 60m; the same rule reads the same bar there,
  every chart bar opening with an index bar). The rig layout's session is never switched (its autosave is on), so
  that grid is never measured. The product's stock grid is the extended one, which is witnessed.
- INFERRED: a half-day's post-market read from its 13:00 close (the calendar's close; no half-day captured).
- **Before our store's first SPX row** a chart bar is UNKNOWN (`interpret.js::SERIES_UNKNOWN_BEFORE_FIRST`):
  withheld, not `na`. yfinance holds 7 days of 1m, 60 of 5 / 15 / 30m and 730 of 60m (#1861); TradingView more.

**Data fixes found on the way (merged):** #1861 (60m 730 days); #1868: an index level is its 2-decimal print
(yfinance hands `7340.6298828125` for 7340.63, about 1e-7 off on every bar of the RS line), a cold intraday copy
(over an hour) is refreshed in the request, and a newest bar stored while it formed is withheld once its period
has ended (production at 11:01 ET served the 15m 10:15 bar at its 10:17 print).

**The labels (U-DAILY) are PR 2.** Fred RS's rating reads `"D"` (`request.security(syminfo.tickerid, 'D', close)`
and SP:SPX at `"D"`). On an intraday chart TradingView draws "RS Rating" and an EMPTY rating (the number prints
only when `timeframe.isdaily`), so the run half needs the reads to be served, not to print. Measured on
`l12-is-2026-11-18` (look-ahead off, extended chart): the OWN symbol's `"D"` close on every bar of day d is day
d-1's, the day's own close appearing only on that day's LAST chart bar (5m 19:55 on 95 days, 60m 19:00 on 656:
the daily bar closes with the extended session), and the newest bar reads the developing day; SP:SPX at `"D"` on
pre-market and regular bars is the previous close, on post-market bars the day's official close (1m 2,258, 5m
4,015, 15m 5,056, 30m 4,959, 60m 2,617; the first post bars on 1m / 5m on some days still the previous close, the
official print's own lag). Until PR 2 those reads are refused by name and the labels withheld by name; the RS line
draws.

**Rails:** `rsIntradayWitness.test.js` (the host lane on a 5m extended chart: regular bars the same bar, pre-market
the previous official close, post-market the day's, bars before our depth UNKNOWN with a control that the plain
series reads `na`; the run reads the same; the RS-line shape; the 60m hour-aligned grid; a stale copy withholds; a
forming daily row is no close; a half-day closes at 13:00; all five timeframes served and 3 / 45 / 120 / 240 refused
by name; both held keys fetched (`heldFetchesOf`, `symbolsNeeded` names `SPX` and `SPX@D`, `heldDepthOf`); without
the daily rows the read is pending by name; a `"D"` read refused by name; a daily chart untouched);
`requestWitnesses.test.js` (a 4-hour chart refuses, naming Q-L12-1); `rsWeeklyWitness.test.js` (the weekly holds
unchanged).

**Not settled, by name.**
- SP:SPX's intraday OPEN / HIGH / LOW at `timeframe.period` (only the close, X05, is captured).
- The regular-hours grid itself (the same rule; not captured: the rig layout's session is never switched).
- The first post-market bars on 1m / 5m on some days: TradingView still read the last print there (the official
  close's publication lag, at most a few minutes); ours reads the official close from 16:00.
- The run half on 15m / 30m charts deeper than our 60 days of SPX: the run refuses a request with an unknown
  settled bar (it carries state bar to bar), so its labels and dots are withheld by name there; the RS line draws.
- Harness fixtures of Fred RS on an intraday chart: the pre-open captures were taken beside SPX served BEFORE
  #1868's rounding, so graded on that supply their RS line reads about 1e-7 off. They stay local, cited as
  witnesses, and are re-captured beside a rounded supply once #1868 is deployed.

## Owner rulings

- **2026-11-16, the S&P 500 history difference (Q-RS9):** told that the RS line on bars before
  2023-12-05 differs from TradingView's (NVDA: 1,292 of 6,997 bars, at most 1.83%) and asked to
  accept it or treat it as the measured need for a better index source: "I am fine with all of
  that". Recorded as: accepted as it is. FMP stays the primary index source; no Massive Indices
  upgrade. The difference stays disclosed in this document.
- **2026-11-16, the runtime stage:** the same sentence covered raising `PINE_RUNTIME_STAGE` for
  members once the labels are proven and live. Not yet acted on. The stage is not an RS Rating
  switch (it turns the per-bar pane on for every admitted script for the accounts in that
  stage), so it is put back to the owner in those words, with the ladder (`admins` -> `cohort`
  -> `all`), before anyone changes it.

- **2026-11-14, SPX source for members:** "We have the highest plan for FMP, I am fine using
  Yahoo, and only want to upgrade to massive if it is needed."
  - FMP (`^SPX`, top plan) is the PRIMARY source for index history in scripts.
  - yfinance `^GSPC` is an owner-accepted FALLBACK. The licensing register row
    (`provider_licensing_class.py`, `("yahoo","indices")`, today `X`) is updated to record this
    ruling, rather than worked around.
  - No Massive Indices upgrade unless FMP and Yahoo both fail a measured need.
- **2026-11-15, the SPY Q-RS1 capture:** "Leave spy blank imo".
  - `rs-rating-fred6724-spy-1d-2026-11-15` is not graded. It is recorded INCONCLUSIVE, with the
    reason: our served SPX (FMP) was not recorded locally, and on the yfinance fallback the rating
    moves by 1 (63 against TradingView's 64).
  - No committed verdict implies a pass or a fail for it. Its supply record says `notRecorded`, so
    the harness refuses to grade it (`ourSide.js::recordedSupplyOf`).
  - Admission evidence comes from RDDT and NVDA only.
  - Before this ruling the repo recorded Massive Indices as `U` (403 for this key) and yfinance as
    `X` ("never a member path"), while `/api/bars/SPX` already served yfinance
    (`api/routers/bars.py`).
- **2026-11-15, provider index bars in the RS Rating supply records:** "That's fine, I accept it
  all".
  - The question: the repo is public, and FMP (class R / LA, member display) and Yahoo (class X)
    data were being committed as harness supply.
  - The ruling covers the RS Rating grade's supply records (`tests/fixtures/vendor-supply/
    rs-rating-fred6724-*.json`) ONLY. It is not a general licence to commit provider data
    elsewhere.
  - So the yfinance ^GSPC rows already committed in `bce0de1ecb` stay, with no history rewrite,
    and the FMP ^GSPC rows are committed as these records' SPX supply, labelled by source.
