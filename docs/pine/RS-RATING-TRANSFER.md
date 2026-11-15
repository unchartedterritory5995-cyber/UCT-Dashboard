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

**L3 `syminfo.industry` (and its siblings `sector`)**: a bind-time text fold from our ticker meta,
tagged SUBSTITUTED (our classification is not TradingView's FactSet taxonomy). Accept: the micro
script `plot(syminfo.industry == 'X' ? 1 : 0)` attaches on both lanes. The read-back names the
substitution.

**L4 runtime conditional-history for constant conditions**: an `if` whose condition folds to a
script constant runs on every bar or on none, so its stateful calls keep the same history as
unconditional ones. Admit that case only; a per-bar condition keeps refusing. Accept: the 17
RT-HISTORY sample scripts regrade against the s7-ahead captures with no new DIVERGE, and the RS
Rating rating math builds on the runtime lane.

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
- Accept: RS Rating's run-half mints, and the object-lane census shows no new divergence.

**L6 seed substitute**: a registry keyed by `(source, symbol)`. An unregistered seed keeps refusing
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

**L7 grade + admission**: the `MATCH_SUBSTITUTED` verdict in `tools/vendor_harness/compare.mjs`,
the ledger and `coverage_map`. An allowlist row kind for runtime admission. The member-door
disclosure.

**L1 index symbols** and **L2 untyped input fold**: after #1264, by extending
`staticallyUnservable` / `spellingUnservable` / `requestTargetOf`. No parallel path.

**L8 proof**: capture RS Rating (original source, defaults) on the rig for one stock and one ETF,
daily. Grade with the substituted inputs fed from the capture. Visual side by side. Deploy.

## Owner rulings

- **2026-11-14, SPX source for members:** "We have the highest plan for FMP, I am fine using
  Yahoo, and only want to upgrade to massive if it is needed."
  - FMP (`^SPX`, top plan) is the PRIMARY source for index history in scripts.
  - yfinance `^GSPC` is an owner-accepted FALLBACK. The licensing register row
    (`provider_licensing_class.py`, `("yahoo","indices")`, today `X`) is updated to record this
    ruling, rather than worked around.
  - No Massive Indices upgrade unless FMP and Yahoo both fail a measured need.
  - Before this ruling the repo recorded Massive Indices as `U` (403 for this key) and yfinance as
    `X` ("never a member path"), while `/api/bars/SPX` already served yfinance
    (`api/routers/bars.py`).
