# Study: the trade plan for every setup

The owner, 2026-11-08, on the entry, stop, trim and trail rules and the Go Signal: *"Those answers are out there. Either
in the app, somewhere, or on the internet and available!"* They are in the app. Every UCT setup detector
(`api/services/pattern_engine/detectors/uct/`) returns its own trigger (the entry) and stop for the candle it fires on.
The shared `make_levels` (`uct_setups_common.py`) floors the stop and, for the scanners app-wide, puts targets at 2R and
3R. **Study does not use those targets.**

**How the trade is managed is the owner's, as he ruled it on 2026-11-12** (`docs/study/setups/RULINGS_2026-11-12.json`;
the Flat Base card's `management` and its `fb.trim_1`, `fb.trim_2`, `fb.trim_gap_open`, `fb.breakeven` and `fb.trail`
carry the same words). Those rulings replaced the account rulebook's trims (`docs/study/sizing_rule.md` section 9: B19
"a third at 3R", E51 "a third at 5R", F63 "a trim level the day opens past is taken at the open"), which the courses and
games taught until then:

* **D-013, the first sell is a judgment.** *"I very rarely sell on the day 1 of the buy day. I usually wait until day 3
  at the earliest. SO 3-5-7 day or 5-10 R is often best."* Selling into a 3, 5 or 7 day push, or at about 5 to 10R, is
  often best; later sells are a judgment too; trail what is left. No question may key "sell a third at 3R", or any day-1
  sell, as the right answer. He counts the buy day as day 1, and so does every Study screen that names a day.
* **Breakeven:** the stop may move to breakeven between 2R and 5R, or at the first sell (B19's window stands). The replays
  move it at 3R, inside that window.
* **GAP-TRIM:** a gap up past a level at the open is not an automatic sell; selling part into a big gap is an optional
  judgment, never a rule.
* **D-021, the averages:** the 9 and 20 EMA, with the 50 and 200 SMA. E52's trail ("the 10-day for a fast mover, the
  21-day for a steadier one") reads as the 9 EMA and the 20 EMA; the Study charts draw them (`studyChartLook`).
* **B20 stands:** a gap through the stop makes the first 30-minute low the new stop, out if past 2R; a daily chart
  cannot see the 30-minute bar, so the games fill at the open and say so.

So **3R and 5R stay on the chart as marks on the ruler, never as fixed sells**: 3R is where the stop can move up to
breakeven; 5R sits in the 5 to 10R zone where a first sell into strength is often best, by judgment, usually day 3 or
later. `api/services/study_trade.py` builds the plan (`t1` = 3R, `t2` = 5R, `trim_r` [3, 5], a key the client reads,
and `breakeven_at` "t1"); no fraction rides on it any more.

`api/services/study_trade.py` reads all of this for the setup that fired on a chart's last candle and sends it with the
answer's reveal. `hardMode.reviewTrade` then plays it against the bars that followed: when each mark was reached,
whether the stop was hit, the best price, and R. Where the owner has ruled, his words win: the Kicker. Where the app defines no trade, none is invented: the Bear gap's
obvious stop, the gap day's high, sat 25% over the close on VRNS (a gap that opened 37% down and closed at the low), so
its lesson measures the fall and the line it must stay under.

| Setup | Entry | Stop | Marks and sells | Trail | Source |
|---|---|---|---|---|---|
| **Kicker** | over the red day's high, on the Kicker day, at market as it trades through (his JBI example: *"11.05 over THE previous day high"*, the red day's high 11.04), or the day-1 30-minute opening-range break | under the Kicker's low, or 3.5% under the entry if that is closer (*"Under the kicker candle low or entry with a 3.5% stop"*) | 3R and 5R are marks; the first sell is a judgment (D-013) | under each higher low, or under the 9 EMA | his rulings 2026-11-02; `uct_kicker.py` |
| **Oops Reversal** | the prior close, reclaimed during the day | the day's low | 3R and 5R are marks; the first sell is a judgment (D-013) | under each higher low | `uct_oops_reversal.py` |
| **Slingshot** | the close back over the 4-day average of the highs (open item: D-003) | the trigger day's low (the day before's low is the wider choice) | 3R and 5R are marks; the first sell is a judgment (D-013) | under the 9 EMA, or under each higher low | `uct_slingshot.py` |
| **Launchpad** | the close out of the tight cluster of averages (open item: D-003) | under the 21-day and 50-day averages, a quarter of an ATR below the lower one (open item: D-021) | 3R and 5R are marks; the first sell is a judgment (D-013) | under the rising 20 EMA, or under each higher low | `uct_launch_pad.py` |
| **High Volume Edge** | the high-volume close (open item: D-003) | the edge bar's low (its high on a down close) | 3R and 5R are marks; the first return to the high-volume close is the cleanest decision point | not named by the detector | `uct_hve.py` |
| **Gap Support** | the close, as the gap holds (open item: D-003) | the gap top or the day's low, whichever is lower | 3R and 5R are marks; the post-gap high is the first place to take some off (from day 3, D-013) | if it drifts sideways at the gap, a tighter stop just under the gap top | `uct_gap_support.py` |
| **Bear gap** (short) | no trade is defined in the app | the lesson shows the line a close must stay under: the gap day's high | the fall is measured, not traded | — | `study_hard.bear_gap_fires`; `find_bear_gap_examples.py` |

Until 2026-11-09 the courses taught the detectors' 2R / 3R targets with no fraction; from 2026-11-09 to 2026-11-12 the
rulebook's thirds at 3R and 5R; since 2026-11-12 the owner's D-013. Every game and the replay's questions follow it:
Hard mode's replay pause keys holding at 3R (the old "sell a third: 3R is a fixed trim" is a wrong choice whose why
teaches the change) and "sell some into strength if it is day 3 or later" at 5R, and says the day; Trade Story scores a
sell on day 1 or 2 as off the plan and, from day 3 into a push or at about 5R, takes Sell some as the plan's best call
and Hold as a judgment too (`app/src/pages/study/challenges/games/tradeStory.js`).

## Open items for the owner

* **D-003, the entries on the close.** *"It is always just the trigger for each trade never the close."* The Kicker and the
  Oops Reversal enter as price trades through the trigger during the day. The Slingshot, Launchpad, High Volume Edge and
  Gap Support detectors return the close as their trigger and expose no level a member could buy through during the
  day, so their plans still enter on the close until he names the level (nothing is invented):
  * **Slingshot:** the detector's `e4h_level` is that day's 4-day EMA of the highs, which takes in the day's own high, so
    it is only known at the close. The level price would trade through during the day is the prior session's 4-day EMA
    of the highs (with a 2/5 weight on the new high, price crosses the live average exactly when it clears the prior
    value), which the detector does not return. Proposed: enter over the prior session's 4-day EMA of the highs.
  * **Launchpad:** a state, not a crossing (*"A launch pad is a STATE more than a trigger"*); the detector names *"a break
    of a recent high on rising volume"* as the stronger trigger but returns no such level.
  * **High Volume Edge:** the record volume is only known at the close, so the high-volume close is the first price there is.
  * **Gap Support:** the test (a touch of the gap's levels and a close over them) is read at the close.
* **D-021, the Launchpad's stop.** The stop is measured off the detector's own 21-day EMA (min(EMA21, SMA50) less a
  quarter ATR; the cluster's floor on the v4 rule), so its words still name the 21-day average. Moving it to the 20 EMA
  changes the level, which is his call.

## The Go Signal

The Go Signal is defined in `uct_go_signal.py`, adjudicated blind. It is an intraday entry in a stock that has already
shown it can move. The session opens weak, sweeps a nearby support, and buyers step in and turn it. On the daily chart
it fires when all of these hold:

* the 20-day average is rising;
* there is a notable recent move: a 13% gain over 5 sessions within the last 20, or a 4% gap on 2x volume within the
  last 30, or a tight 10-bar base above the 50-day;
* the day opens under the prior close;
* the low sweeps support: the prior low, the 5-bar low, or a 9, 20 or 50-day average the prior close was above;
* buyers step in: a lower wick of 40% of the range, or the low under the open with the close in the upper half;
* the day closes in the upper 40% of its range.

**Entry:** the prior close when it traded that session (red to green), else the close. **Stop:** the session's low.
The real trigger is on the 30 or 65-minute chart, which the daily bar cannot see. The hourly candidates are already
drafted in `docs/study/setups/go_signal_hourly_*.json`.

## The levels

Each lesson's levels are the plan's: the entry, the stop, and the marks at 3R and 5R, drawn on the chart as it runs on.
The chart also marks where the trade was bought, where each mark was reached, and where the stop was hit.
