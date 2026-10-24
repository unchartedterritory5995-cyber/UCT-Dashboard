# The judged regression gate

`tests/golden_judged/` stops any code change from silently making a member-visible drawing worse than what blind
judges approved. It runs in the default `pytest` run (`testpaths = tests api`), in about 20 seconds (316 judged cases).

## What it guards

Every fixture is a chart that a blind judge scored **3** on a drawing round that **passed its pre-registered
packets and is released to members**. Each one is replayed through the CURRENT member route
(`api.routers.patterns.get_detections`, member role, `include_structures=True`, every released layer's flag on),
with only the data sources pointed at the fixture: the bars store, the session clock, the scan store (the member
detectors are run on the bars exactly as the daily scan runs them), the deal-status marker and the scan-universe
membership. Everything else is production code: `member_rows`, the freshness filter, every precedence pass,
one-line-per-base, metrics and textbook numbers, the shelf pivot and the S/R layer.

For each case the gate asserts:

1. **the drawing is still produced** on the member chart;
2. **its key geometry is within tolerance** of what the judges saw: pivot / buy point, box top and bottom, line
   prices within `min(0.25 x ATR14, 1% of price)` (whichever is stricter); span edges within `max(3, 10% of the span)` sessions;
3. **no other member drawing (a different pattern id) sits on the same base**: a drawn row whose span overlaps the
   judged drawing and that puts a line within 1 ATR of the judged key price (the member path's own
   one-line-per-base distance).

| fixture file | drawing | member literal it was judged at |
|---|---|---|
| `base.json` | `bc:base` | `MEMBER_BASE_ROUND = 4` |
| `double_bottom.json` | `draw:double-bottom` | `MEMBER_DOUBLE_BOTTOM_ROUND = 2` |
| `shelf.json` | `draw:shelf-pivot` | `MEMBER_SHELF_PIVOT_ROUND = "r4"` |
| `sr.json` | `levels_sr` zones and trendline sides: **withdrawn** from members 2026-10-24 (status `withdrawn`) | `MEMBER_SR_ROUND = None` (judged at `"r2"`) |
| `cup.json` | `bc:cup-with-handle` (cup tier drawing) | `MEMBER_CUP_TIER_ROUND = 4` |
| `inside_day.json.gz` | `draw:inside-day` (round-3 drawing, served only through the recert B textbook gate) | `MEMBER_INSIDE_DAY_ROUND = 3` + `MEMBER_INSIDE_DAY_GATE_ROUND = 1` |
| `textbook.json.gz` | `bc:base` textbook buy point; round-2 cases also the drawn line (`metrics_textbook.line` = buy point - $0.10) | `MEMBER_TEXTBOOK_ROUND = 2` (the 10 round-1 buy-point cases are kept: round 2 changed no printed number) |
| `remount.json` | `draw:remount` (the `setup_draws` layer) | `MEMBER_REMOUNT_ROUND = 3` |
| `u_and_r.json` | `draw:u_and_r` (the `setup_draws` layer) | `MEMBER_U_AND_R_ROUND = 2` |
| `donchian_breakout.json` | `draw:donchian_breakout`: passed both packets, owner released 2026-10-24 | `MEMBER_DONCHIAN_BREAKOUT_ROUND = 1` (`released`) |

A `withdrawn` file is a released drawing a later recertification failed: its member literal is `None` (admins
keep the layer) and `test_a_withdrawn_drawing_is_not_served_to_members` keeps it there. Its judged cases are still
replayed with the literal set back to the judged round, so the code stays guarded for the day a new passed round
re-releases it; re-releasing is a re-baseline (below) that flips the status back to `released`.

Unpassed rounds are not fixtures. A `pending_port` file is a drawing that passed but is not released: it is carried so
the gate covers it the day it ships. `test_a_pending_drawing_is_still_not_released_to_members` goes red when its
member literal is set, and the fix is to set that file's `status` to `released`.

## Retired cases: a newer passed round can require ABSENCE

A judged case can be retired by a NEWER passed blind round whose rule removes the drawing. The case stays in its
file with a `retired` block (`rule` + a short public reason naming the round) and is checked by
`test_a_retired_judged_drawing_stays_off_the_member_chart` instead of the drawn-as-judged test. It asserts two
things (`judged.retired_failures`): no member row of the family's pattern id puts its key price (and, for textbook,
its printed buy point) within 1 ATR of the judged one, and the retiring rule still holds on the chart (for
`trend_gate`: `base_draw.trend_ok` is False on the as-of bar). If the rule stops holding, the drawing is missing for
some other reason nobody judged, and the case goes red. Each rule must be in `judged.RETIRE_RULES`; an unknown rule
is red. `test_a_retired_drawing_coming_back_is_caught` is the control.

Retired so far (2026-10-23, the trend-gate blind round: suppressed rows 0.98, controls 2.46 / 84%, and the lost
approved cases re-judged blind on "is this a buy" averaged 1.00): 19 shelf and 9 double-bottom cases, plus 7 textbook
round-2 cases whose as-of bar fails the trend rule. Only cases where `trend_ok` is False on the fixture are retired.

Retired 2026-10-24 (recert B round 2, the strict textbook rubric: four pre-registered packets of 25, two fresh judges
each, packets 2.34 / 2.54 / 2.64 / 2.82, pooled 2.585): all 32 round-3 inside-day cases, under rule `textbook_gate`
(`pattern_engine.textbook_gate.inside_day_fails` withholds each one; every one is more than 6% above its 50-day).
The round's 3-scored cases that pass the one-line-per-base check were added in their place (32 of 56; the other 24
share their base with a pullback, base or channel line on the member chart and are not fixtures).

Retired 2026-10-24 under `one_line_per_base` (precedence round e): 11 donchian cases. Round e was a blind paired round:
25 shared-base charts, 2 fresh judges. On a shared base, the base-family line was preferred over the donchian channel
line in 84% of 50 judgments (95% CI 72-94%). So the channel line yields to a drawn base line within 1 ATR
(`auto_structures.ONE_LINE_PER_BASE_PRIORITY`).

The rule (`judged._base_line_holds`) still asserts on each chart that the yielding has a cause: a drawn row ranked
ahead of the channel line puts a breakout line, where the chart draws it, within 1 ATR of the judged level inside the
55-bar channel window. Rules now take `(case, payload, bars)`.

`KNOWN_RED` in `test_judged_gate.py` lists the judged cases current master does NOT reproduce, each with its
measured cause. They are strict xfails: any OTHER case going red fails the run, and a listed case that starts
passing fails it too, so its entry has to be deleted. Never add a case to `KNOWN_RED` to make a change pass.

## Public repo: what a fixture holds

No ticker, no trader name, no member data, no path. Bars are stored as calendar-day offsets from the window's first
bar (the weekday of that bar is kept, the year is not), and every price is multiplied by a random per-case `scale`
that is recorded in the case so the replay can divide it back out (the drawing code has absolute floors such as a
$5 close and $20M of dollar volume). Encoding: `tests/golden_judged/encode.py`; decoding:
`member_path.decode_bars`. `test_the_fixtures_are_symbol_free_and_small` refuses identifying keys, paths and
anything shaped like a real date, and keeps the directory under 5 MB on disk. A fixture may be stored as
`.json.gz` (deterministic, mtime 0); it is counted compressed and scanned decompressed.

## Labels: the screener's candle names

`tests/golden_judged/test_judged_candles.py` guards the candle LABELS the screener publishes (not a chart drawing,
so these cases do not go through the member chart route). Each case in `fixtures_labels/candles.json` is a daily
bar BOTH blind judges scored 3 for one candle name in the 2026-10-24 recertification of `CANDLE_RULES_ROUND = 2`
(four pre-registered packets of 25, strict Nison / Bulkowski rubric: 2.54 / 2.50 / 2.48 / 2.32, pooled 2.46). The
case stores the 400 daily bars the screener hands `candles.single_candle` (encoded exactly like the chart fixtures)
and the judged key; the gate replays `single_candle(usable_bars(bars[-400:]))` and asserts the key is still in
`candle_matches`. Re-baselining follows the same rule as the chart families: only with a new passed blind round,
together with `MEMBER_CANDLE_ROUND`.

## When it goes red

A red case is a member-visible drawing that no longer matches what was judged. Read the message: it names the case,
the judges' scores and which of (1), (2), (3) broke. Either fix the code, or, if the change is intended, it is a
re-baseline (below). Do not widen a tolerance or delete a case to get green.

## Re-baselining: ONLY with a new passed blind round

The fixtures change only when a drawing ships a NEW round that has itself passed blind judging (two fresh
pre-registered packets at the bar, independent judges), and only for that drawing:

1. move the member literal (`MEMBER_<X>_ROUND`) to the new round in the same change as the new fixtures;
   `test_each_released_family_is_still_served_at_the_round_the_judges_scored` fails until both agree;
2. export the new round's 3-scored cases with `encode.py` (bars ending at the judged as-of bar, the 600 daily bars
   the member path reads, the judged geometry as drawn), replacing that family's file wholesale;
3. run the gate; every case of the new file must pass on the code that ships the round. A case that does not is a
   finding for that round, not a `KNOWN_RED` entry to add quietly.

A code change that moves a judged drawing without a new passed round is a regression by definition, however
sensible it looks: the judges approved the old drawing, nobody has approved the new one.
