# Study: the trade plan for every setup

The owner, 2026-11-08, on the entry, stop, trim and trail rules and the Go Signal: *"Those answers are out there. Either
in the app, somewhere, or on the internet and available!"* They are in the app. Every UCT setup detector
(`api/services/pattern_engine/detectors/uct/`) returns its own trigger (the entry) and stop for the candle it fires on.
The shared `make_levels` (`uct_setups_common.py`) puts the targets at 2R and 3R from that stop. Each detector's
narrative says how to trail.

`api/services/study_trade.py` reads all of this for the setup that fired on a chart's last candle and sends it with the
answer's reveal. `hardMode.reviewTrade` then plays it against the bars that followed: when each target was reached,
whether the stop was hit, the best price, and R. Where the owner has ruled, his words win: the Kicker. Where the app defines no trade, none is invented: the Bear gap's
obvious stop, the gap day's high, sat 25% over the close on VRNS (a gap that opened 37% down and closed at the low), so
its lesson measures the fall and the line it must stay under.

| Setup | Entry | Stop | Trim | Trail | Source |
|---|---|---|---|---|---|
| **Kicker** | a cent over the red day's high, on the Kicker day (his JBI example: *"11.05 over THE previous day high"*, the red day's high 11.04), or the day-1 30-minute opening-range break | under the Kicker's low, or 3.5% under the entry if that is closer (*"Under the kicker candle low or entry with a 3.5% stop"*) | 2R, 3R | under each higher low, or under the 10-day average | his rulings 2026-11-02; `uct_kicker.py` |
| **Oops Reversal** | the prior close, reclaimed during the day | the day's low | 2R, 3R | under each higher low | `uct_oops_reversal.py` |
| **Slingshot** | the close back over the 4-day average of the highs | the trigger day's low (the day before's low is the wider choice) | 2R, 3R | under the 10-day average, or under each higher low | `uct_slingshot.py` |
| **Launchpad** | the close out of the tight cluster of averages | under the 21-day and 50-day averages, a quarter of an ATR below the lower one | 2R, 3R | under the rising 21-day average, or under each higher low | `uct_launch_pad.py` |
| **High Volume Edge** | the high-volume close | the edge bar's low (its high on a down close) | 2R, 3R; the first return to the high-volume close is the cleanest decision point | not named by the detector | `uct_hve.py` |
| **Gap Support** | the close, as the gap holds | the gap top or the day's low, whichever is lower | 2R, 3R; the post-gap high is the first place to take some off | if it drifts sideways at the gap, a tighter stop just under the gap top | `uct_gap_support.py` |
| **Bear gap** (short) | no trade is defined in the app | the lesson shows the line a close must stay under: the gap day's high | the fall is measured, not traded | — | `study_hard.bear_gap_fires`; `find_bear_gap_examples.py` |

Trim is where to take some off: the detectors put the targets at 2R and 3R. They do not say how much to sell at each,
so the course names the levels and does not invent a fraction.

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

Each lesson's levels are the plan's: the entry, the stop, and the targets at 2R and 3R, drawn on the chart as it runs
on. The chart also marks where the trade was bought, where each target was reached, and where the stop was hit.
