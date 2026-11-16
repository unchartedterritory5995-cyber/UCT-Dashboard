# Capture queue 2026-11-14: RS Rating transfer

Program: `docs/pine/RS-RATING-TRANSFER.md`. Manifest: `docs/pine/rs-rating/capture-manifest.json`
(the `batch_capture.py run --manifest` format). Every row is a VALUE capture
(`capture-procedure.md`), at default inputs, on the scratch layout.

| row | script | symbols / timeframe | settles |
|---|---|---|---|
| Q-RS1 | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` (RS Rating, Fred6724, MPL-2.0, the original source) | NYSE:RDDT 1D, AMEX:SPY 1D, NASDAQ:NVDA 1D | The end-to-end grade. RS line, MAs, labels (the rating text, the new-high dot). The rating number is what TradingView draws today, which may disagree with the script's comments (see L6 in the program). |
| Q-RS2 | `tools/visual_conformance/probes/rs-seed-rsrating.pine` | NYSE:RDDT 1D | The seed witness: TradingView's own `SEED_FRED6725_RS_RATING:RSRATING` values per chart bar, its na pattern and bars-since. Compared against `pine_seed_store`'s replay of the rs-log mirror. |
| Q-RS3 | `tools/visual_conformance/probes/rs-spx-daily.pine` | NYSE:RDDT 1D, AMEX:SPY 1D | `SP:SPX` OHLC as `"D"` and as `timeframe.period`. Compared against FMP `^GSPC` (the index-bars primary). |
| Q-RS4 | `tools/visual_conformance/probes/rs-syminfo-industry.pine` | about 20: RDDT, NVDA, AAPL, MSFT, AMD, TSLA, JPM, XOM, UNH, KO, PLTR, COIN, SPY, QQQ, IWM, XLK, SMH, ARKK, GLD, TLT | `syminfo.industry` / `sector` / `type` text per symbol. This is the witness table for L3 (our classification -> TradingView's string), the ETF case especially. |
| Q-RS5 | `tools/visual_conformance/probes/rs-arm-label-last-bar.pine` (added 2026-11-15, lane L4c) | NYSE:RDDT 1D (from the listing), AMEX:SPY 1D | A01/A02: RS Rating's label shape in one v5 script: `a1 = barstate.islast ? label.new(...) : na` plus `label.delete(a1[1])` leaves ONE label, on the last bar. R01: `label.delete(r1[1])` every bar removes each every-5th-bar label one bar later, and deleting `na` is a no-op. L4c serves these on separate witnesses (Q-RT5a T01/T02, Q-O1a, vw-object-gc-c O1, barstate-full N22); this capture would witness them together. E01 (a label in the ELSE arm) and X01 (a box in the THEN arm) are what L4c still refuses as `runtime:object-op`; their counts would let a later lane serve them. |

Licence: Q-RS1's script is MPL-2.0 (header line 7), so its capture may be committed. Q-RS2..5
are UCT probes.

Q-RS5 captured 2026-11-15 (s10, `rs-arm-label-last-bar-{rddt,spy}-1d-2026-11-15`, local only) and
graded by lane L4d through the run's x map: A01, R01, E01 and X01 MATCH on both symbols (RDDT: 96
E01 labels, 67 boxes; SPY: the newest 502 E01 labels and 503 boxes). E01 and X01 are now served;
digests in `docs/pine/evidence/2026-11-15-w3n-d1/evidence.json`.

**L8 (2026-11-15).** Q-RS1 is committed: `tests/fixtures/vendor/harness/rs-rating-fred6724-{rddt,spy,nvda}-1d-2026-11-15.json`,
MPL-2.0, the original source. Q-RS4's RDDT and NVDA probes are committed beside them
(`rs-syminfo-industry-{rddt,nvda}-1d-2026-11-15.json`, UCT probes): the grade reads TradingView's
industry string from them, because no Q-RS1 capture's `symbol` block carries `industry`. The other
Q-RS2..5 captures stay local. Graded runtime-on on the server's own supply
(`tests/fixtures/vendor-supply/`): RDDT DIVERGE, NVDA DIVERGE, SPY INCONCLUSIVE. The cause is SPX data
(yfinance vs TradingView, about a cent), not the engine; see the L8 status in the program doc. Still
owed, and none of it is a TradingView capture:

| row | what | settles |
|---|---|---|
| Q-RS6 | Record the bars `/api/bars/SPX?tf=D` serves from FMP (on the pod, or on a machine with the FMP key) into the three `tests/fixtures/vendor-supply/rs-rating-fred6724-*.json` records, replacing the yfinance record and SPY's `notRecorded`, then regrade runtime-on | Whether the primary SPX source equals TradingView's. If it does, RDDT (and NVDA within the served depth) grade MATCH_SUBSTITUTED, and SPY can be graded. |
| Q-RS7 (optional) | RS Rating on a WEEKLY chart (RDDT 1W) | What TradingView draws for `request.security(syminfo.tickerid, 'D', close)` below the chart's timeframe. Today it is refused by name (L8 4b). |

## ⭐ TOP OF THE NEXT CAPTURE SESSION (added 2026-11-16)

| row | script | symbols / timeframe | settles |
|---|---|---|---|
| Q-RS8 | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` (unchanged, sha256 `caa94fe31a87...5af0`) | NYSE:RDDT 1D, NASDAQ:ALAB 1D, NASDAQ:CRWV 1D, each from the listing, default inputs | The x of RS Rating's two labels. The three committed captures (`rs-rating-fred6724-{rddt,alab,crwv}-1d-2026-11-15`) predate U13 and record no x table, so objects v2 grades INCONCLUSIVE and the run half that draws the rating labels is not admitted. Re-take with the current `tools/vendor_harness/tv_capture.js` (it records `graphics()._indexes`), re-take the matching `rs-syminfo-industry` probe on the same three symbols in the same session (the grade reads TradingView's industry string from it), then grade runtime-on on master. Objects v2 MATCH_SUBSTITUTED with x witnessed on at least two of the three admits the labels. |

The rig (`tools/vendor_harness/batch_capture.py`, profile `%LOCALAPPDATA%/uct-capture-profile/tradingview`)
read **signed out** on 2026-11-16 09:5xZ (`recon --channel chrome`: the layout answers 403 "Chart Not
Found"), so this needs one sign-in at the keyboard in the window the tool opens. ⚠️ A `recon` run a few
minutes earlier WITHOUT `--channel chrome` failed to launch (the bundled Chromium against a profile
last used by the installed Chrome); whether that launch is what signed the profile out was not
established. Always pass `--channel chrome` with this profile.

## Display: an overlay script's plots and the price scale (added 2026-11-16)

Seen on production in a real browser (smoke account, RDDT 1D, RS Rating pasted from the committed
source): the RS line's last value was 43.57 while the price scale showed about 80 to 220, so most
of the line was below the pane. The values were right and not visible. Ruled (coordinator,
2026-11-16): a Pine translation's own `overlay = true` plots join the price pane's autoscale, as
TradingView's do by default; natives keep the guest rule. Built as `placement.joinPriceScale`
(`memberPaneDefinition.joinsPriceScale`, `eligibility.js::priceScaleJoinLook`,
`__tests__/priceScaleJoin.test.js`).

| row | script | symbols / timeframe | settles |
|---|---|---|---|
| Q-RS10 | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`, in the Q-RS8 session | NYSE:RDDT 1D | TradingView's VISIBLE PRICE RANGE with the script on the price scale, at default settings and a stated visible bar range, plus the same with "Scale price chart only" switched on. No committed capture records a visible price range (`tv_capture.js` reads values and objects, not the scale), so the join rests on TradingView's documented default, not a witnessed number. Needs a capture-tool field for the price scale's visible range first. Also worth one probe with `scale = scale.none` and one with `scale = scale.left`, which this door does NOT join. |

## Tracked: the S&P 500 history difference (added 2026-11-16, for the owner's ruling)

| row | what | size | settles |
|---|---|---|---|
| Q-RS9 | RS Rating's RS line on bars before 2023-12-05: we serve FMP `^GSPC`, TradingView reads `SP:SPX` | NVDA 1D: 1,292 of 6,997 bars differ (18.5%), first 1999-01-28, last 2023-12-04, largest 1.83% of the value; 5,705 exact; the three averages exact on all 6,997. Re-derived 2026-11-16 on master `d615e76494`. From the 2026-11-15 grade, not re-derived: 89 of the 1,292 exceed 0.01%. RDDT / ALAB / CRWV (listed after that date) are exact on every bar. | Whether this is a "measured need" under the 2026-11-14 ruling (FMP primary, Yahoo fallback, Massive Indices only if both fail a measured need). It is a member-visible difference today: the plots are served on every symbol. |

Not a TradingView capture. What would turn "cause as recorded" into a measurement: give Q-RS3's
committed probe (`rs-spx-daily-{rddt,spy}-1d-2026-11-15`, INCONCLUSIVE today for no supply) the FMP
`^GSPC` rows as an out-of-git manifest record (inline provider bars are ruled only for the
`rs-rating-fred6724-*` records) and grade it: that compares the two SPX series bar by bar. RDDT's
window starts after 2023-12-05, so the old bars need the same probe on a long-history symbol
(one capture, in the Q-RS8 session).

**Q-RS9 RULED AND CLOSED (owner, 2026-11-16).** Told the size above and asked to accept it or treat
it as the measured need for a better index source: "I am fine with all of that". Accepted as it
is: FMP stays primary, no Massive Indices upgrade. The difference stays disclosed in the program
doc. The SPX-probe measurement above is optional from here, not owed.

**Q-RS8 CAPTURED AND GRADED (2026-11-16).** The owner signed in; RS Rating and the industry probe
were re-taken on RDDT, ALAB and CRWV 1D from the listing (rig run dirs `qrs8-2026-11-16-{rddt,alab,crwv}`,
six captures, each written verified, x table recorded). Graded on master `b7cd7a0e63` with master's
corpus harness: all three RS Rating captures MATCH_SUBSTITUTED runtime-on, objects v2
MATCH_SUBSTITUTED with x witnessed (2 graded, 2 agreeing, exact bar). The record's `objectsV2` is
set from that grade and the labels are admitted (program doc, "THE LABELS ARE ADMITTED").

⚠️ **Three rig-tool defects were found taking these, worked around from a scratch wrapper, and are
owed a tool PR before the repo tool drives the rig again** (`tools/vendor_harness/batch_capture.py`,
`tools/pine_vendor_capture.py`):
1. At the tool's 1440-wide window TradingView's Pine editor dialog collapses `Add to chart` to an
   icon, so the binding gate (which reads the button's text) counts 0. 1760 wide works.
2. ⛔ `TITLE_JS` does not look at `H2`, where the script title now lives, and its fallback
   (`/script/i`) selected the **"Publish script"** button, which the tool then clicked on the
   owner's account (it opens TradingView's publish dialog; nothing was published; the buffer was
   an unsaved Untitled script and cleanup ran). `--title-selector 'h2[class*="label-"]'` avoids it.
   The fallback must be an allow-list of what a title element may be.
3. The binding gate is read the instant `Create new > Indicator` yields a model, before the editor
   header re-renders (0 / 0, GATE_FAILED). A 15 s poll before the same gate fixes it.
Rule added by the coordinator: a capture run never clicks anything it cannot name.

**Q-RS2 graded (2026-11-16).** `rs-seed-rsrating-rddt-1d-2026-11-15` graded DIVERGE (5 of 7) in
both committed snapshots only because no supply was recorded for it: ours read na on every bar. Its
supply record is now committed (`tests/fixtures/vendor-supply/rs-seed-rsrating-rddt-1d-2026-11-15.json`,
the `pine_seed_store` replay entry of the RDDT RS Rating record, unchanged; a public mirror, not
provider data). Graded on master `8cdb0af178`, a run of exactly that capture, both lanes: **MATCH,
all 7 items, 666 of 666 bars** (seed close / open / high, the na pattern, bars-since, and the
chart-close control). The two snapshot rows are replaced textually by that run's rows; no other
row changed.

