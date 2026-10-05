# Lower timeframe: the switch-on plan (`VITE_PINE_LOWER_TF_ENABLED`)

Status 2026-10-05 (branch `pine/ltf-data-agreement`). The production flag stays **OFF**.
This page gives the evidence so the integrator can decide. Section `## LTF` of
`docs/pine/vendor-harness/objects-triage-2026-09-28.md` has the full account.

## What the flag does now

Off (production): every read below the chart's timeframe is refused as
`lower-tf:store-unmeasured`. Nothing is fetched. Nothing changes from today.

On: C41's rule (which intrabar, which session, when a chart bar is unknown) runs on
**our** intraday bars, with a second gate added by this lane. That gate is
`engine/lowerTfStoreRule.js`. It serves a code only when every field the document's
reads consume at that code was **measured equal** to TradingView's. Everywhere
else the code is refused as `lower-tf:store-disagrees`, with the measured numbers
and the cause. Refused codes are not fetched (`lowerTfWindowsOf`) and are given no
supply (`resolveLowerTf`). They are withheld, never drawn.

## The measurement (committed, re-derived by `lowerTfStoreRule.test.js`)

Store payloads: `tests/fixtures/store/api-bars-{RDDT,SPY}-tf{5,15,D}.json.gz`. These
are the exact bytes `GET /api/bars/...` returned on 2026-10-05, gzipped. The sha256
of each is in `provenance.json`. They are compared with the committed TradingView
captures, using the same `intrabarSeries` on both sides. Each figure is
"equal / compared" over the sessions that are complete on both sides. Prices are
equal at the store's 4-decimal precision. Volume and time must be exactly equal.

| code | listing (sessions) | last intrabar: time · open · high · low · close · volume | every intrabar: open · close |
|---|---|---|---|
| 5 | RDDT (248) | 248 · 248 · 248 · 248 · **240** · **0** | 19262/19272 · 19225/19272 |
| 5 | SPY (42) | 42 · 42 · 42 · 42 · **40** · **0** | 3253/3276 · 3271/3276 |
| 15 | RDDT (632) | 632 · 632 · **631** · 632 · **613** · **0** | 16330/16360 · 16302/16360 |
| 15 | SPY (126) | 126 · 126 · 126 · 126 · **117** · **0** | 3210/3276 · 3263/3276 |
| 60 | RDDT (632) | 632 · 632 · **631** · 632 · **613** · **0** | 4377/4406 · 4378/4406 |
| 60 | SPY (752) | 752 · 752 · **744** · **746** · **727** · **0** | 4929/5246 · 5218/5246 |
| 240 | RDDT (632) | 632 · 632 · **631** · **631** · **613** · **0** | 1229/1258 · 1238/1258 |
| 240 | SPY (603) | 603 · **599** · **591** · **594** · **580** · **0** | 933/1200 · 1177/1200 |

**The bar** (`BAR`): every compared value must be equal, on both listings, each over
at least 40 sessions. A read that reaches back (`maxLookback > 0`) needs the field
equal on **every** intrabar, not only the last.

**What serves under it:** `time` (and every clock field) at 5/15/60/240. `open` of the
last intrabar at 5/15/60. `low` at 5/15. `high` at 5. All of these only with no
history reach. **`close` and `volume` serve nowhere.**

## Why: the root causes, each measured

1. **Volume. Not ours to fix.** TradingView's intraday volume is a subset of the
   consolidated tape. Our daily volume matches TradingView's daily volume (631/634
   RDDT days, 1,747/1,800 SPY days; the rest are late corrections, median ratio
   exactly 1). TradingView's own daily volume is a median 1.54× the sum of its own
   15m bars. Our 15m volume divided by TradingView's has a median of 1.383 (p05 1.17,
   p95 1.75). That ratio is above 1.2 in **every one** of the 26 slots of the
   session, so it is not explained by extended hours or the auctions. The ratio
   cannot be derived from bars.
2. **The 09:30 open. Our provider's convention.** Our 09:30 bar opens at the
   official opening print (SIP "MC Official Open", which sets open and close but not
   high and low). On every day ours differs from TradingView's, ours equals the
   official daily open: RDDT 29/29, SPY 66/66. TradingView's open is a different
   trade, which our aggregates do not hold.
3. **The session's last print. A genuine provider difference.** The last 15m close
   differs on RDDT 19/632 and SPY 9/126 days, by 1 to 3 cents. Neither side's value
   is the official close: TradingView's last 15m close equals its own daily close on
   84/634 days. The two feeds pick a different last eligible trade in the final
   second.
4. **Scattered prints.** About 1 bar in 2,000 differs in high or low by a cent or
   more.
5. **Ruled out, each measured:**
   - Extended hours. The store's 18,777 RDDT bars outside the session are dropped by
     `intrabarSeries`, and removing them changes nothing.
   - Session boundary and time zone. No TradingView bar is missing from the store.
   - Bucketing. 60 and 240 built from our 15m bars disagree only where our 15m bars do.
   - Splits and dividends. Median close ratio is exactly 1 in every year.
   - 4-decimal storage. The store rounds TradingView's 6-decimal sub-penny prints to
     4 decimals. Below 1e-4 the two are the same price. This was a measurement fix:
     it lifts session price-equality from 77.1% to 85.8%, and it is not a data change.

**Store defects found (not fixed here; for the bars owner):**
- One off-grid, zero-volume 11:05 bar on RDDT 2026-05-28. It makes that session
  unplaceable, so the session is withheld (it is never drawn wrong).
- The SPY 15m store has a hole from 2020-08 to 2023-12. Chart bars there are unknown.
- The SPY 30m store is sparse: 4,906 of 8,300 compared bars are missing. "30" is
  unwitnessed anyway.

## The census (flag on, objects pane on: `lowerTfStoreCensus.test.js`)

This census covers the 12 C-LTF scripts plus ema-ribbon and artemis. **0 lower reads
are served from our store.**

- Ten of the twelve stop at the member door on another wall first (each wall is
  named in the census row).
- `artemis-oscillator-pro` attaches with no lower read stamped.
- `ema-ribbon` reads EMAs of `close` (reach 8 to 55). It is refused at 15/60/240 with
  the measured last-close numbers.
- `mtf-dashboard-pro` stamps 15/60/240, but its installed document holds no `ltf`
  read. It is refused and nothing is fetched.
- Graded captures are unchanged. The harness supplies TradingView's own bars, so the
  data rule is not asked.

**Scripts unlocked: 0. MATCH lost: 0.**

## Recommendation

**Keep the flag OFF.** Turning it on today is safe, because every read our bars
cannot answer is refused by name. It would also draw nothing new: no corpus script's
lower read consumes only the fields that pass.

Any of the following would change the answer:

- **An intraday source whose last print and volume match TradingView's.** This is a
  data-source decision, and paid sources are out of scope here. Re-capture, refresh
  the payloads, and re-derive `EVIDENCE`. Rail 1 goes red until the numbers are
  written down.
- **An owner ruling** that a close within one tick on ~3% of days is acceptable.
  Not recommended: it draws values known to be wrong.
- **CAP6 / vendor M2.** If TradingView's lower read on an extended-hours chart uses
  extended bars, that is a separate measurement. This rule is measured on the
  regular session only.

To flip it: set `VITE_PINE_LOWER_TF_ENABLED=1` as a build-time variable, then redeploy.
Verify that a chart with ema-ribbon makes no `/api/bars?tf=15` request, and that its
lower rows are withheld with `lower-tf:store-disagrees`.
