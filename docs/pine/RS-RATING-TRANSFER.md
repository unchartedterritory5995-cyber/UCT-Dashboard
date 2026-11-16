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
  that is admins only): the RS line and its three averages, equal to TradingView's on every bar of
  the three captures, with `syminfo.industry` disclosed as UCT data. The two labels ("RS Rating"
  and the rating number) are withheld by name (`pine:object-removal-lost`): the run half that draws
  them is not admitted.
- **What an ordinary member gets today:** the same four plots and no labels, for a second reason
  as well: the run half is declined `run-half:pane-off` ("the per-bar runtime pane is not on
  here") until the runtime stage is raised from `admins`. Measured on master, the committed
  allowlist latched.
- **What finishes it.** Q-RS8 (`docs/pine/capture-queue-2026-11-14-rs-rating.md`): re-take the
  three captures with the current `tv_capture.js`, which records the x table. If objects v2 then
  grades MATCH_SUBSTITUTED with x witnessed, the record's `objectsV2` is set from THAT grade and
  the labels are admitted for permitted accounts. Raising the runtime stage for members is the
  owner's act.
- **Still not served either way.** A member's own EDITED copy (admitted only by capability, and
  `request-other` has no registry row); alerts and scans (the server lane refuses the script by
  name, HP-7 above). SPY is ungraded (owner ruling); NVDA's RS line differs before 2023-12-05
  (FMP history against TradingView's).
- ⛔ **Checklist line, from this mistake:** an allowlist record's capture fields (`verdict`,
  `objectsV2`, `objectsV2Substituted`) are copied ONLY from a grade taken on the tree being merged,
  never from a document or a spliced snapshot row.

## Owner rulings

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
