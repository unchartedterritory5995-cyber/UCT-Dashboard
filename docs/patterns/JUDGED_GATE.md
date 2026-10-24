# The judged regression gate

`tests/golden_judged/` stops any code change from silently making a member-visible drawing worse than what blind
judges approved. It runs in the default `pytest` run (`testpaths = tests api`), in about two and a half minutes on the dev box (1,041 judged chart cases, measured 2026-10-24).

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
| `base.json.gz` | `bc:base` base STATES: breakout / extended (recert A r2) and "Base forming" (recert A r3), both through the member textbook gate | `MEMBER_BASE_ROUND = 5` + `MEMBER_BASE_BREAKOUT_ROUND = 1` / `MEMBER_BASE_FORMING_ROUND = 1` |
| `base_plain.json.gz` | the stateless `bc:base` as the PLAIN base (`base_draw.plain_drawing`, lab base_rebuild): released 2026-10-24 after its pre-registered held-out round on the recert A rubric (A 2.74, B 2.86, C 2.56, D 2.62, pooled 2.695) | `MEMBER_BASE_STATELESS_ROUND = 6` |
| ~~`base_stateless.json.gz`~~ | REMOVED 2026-10-24 with the plain-base release: the OLD stateless `bc:base` (judged round 4) it guarded is superseded, and the rollback to it (`MEMBER_BASE_STATELESS_ROUND = 5`) stays guarded by `textbook.json.gz`, whose 51 cases replay that same drawing at 5; the fixture budget (5 MB) went to the live drawing's cases | (git history) |
| `double_bottom.json.gz` | `draw:double-bottom`, served only through the recert B textbook gate (certified by fix round fr1, pooled 2.705) | `MEMBER_DOUBLE_BOTTOM_ROUND = 2` + `MEMBER_PIVOT_GATE_ROUND = 1` |
| `flat_top.json.gz` | `uct_flat_top_breakout`, served only through the recert B textbook gate (certified by fix round fr1, pooled 2.51) | `MEMBER_FLAT_TOP_ROUND = 2` + `MEMBER_PIVOT_GATE_ROUND = 1` |
| `shelf.json.gz` | `draw:shelf-pivot`: **withdrawn** from members 2026-10-24 (status `withdrawn`; recert B fix round fr1 failed, pooled 2.39) | `MEMBER_SHELF_PIVOT_ROUND = None` (judged at `"r4"`) |
| `sr.json.gz` | `levels_sr` zones and trendline sides: **withdrawn** from members 2026-10-24 (status `withdrawn`) | `MEMBER_SR_ROUND = None` (judged at `"r2"`) |
| `cup.json.gz` | `bc:cup-with-handle` (cup tier drawing): **withdrawn** from members 2026-10-24 (status `withdrawn`), owner decision 4: strict blind 1.98 on n = 20 is not certifiable; re-ships when a pre-registered blind packet of n >= 60 passes | `MEMBER_CUP_TIER_ROUND = None` (judged at 4; the team chart reads `CUP_TIER_JUDGED_ROUND`) |
| `inside_day.json.gz` | `draw:inside-day` (round-3 drawing, served only through the recert B textbook gate) | `MEMBER_INSIDE_DAY_ROUND = 3` + `MEMBER_INSIDE_DAY_GATE_ROUND = 1` |
| `textbook.json.gz` | `bc:base` textbook buy point; round-2 cases also the drawn line (`metrics_textbook.line` = buy point - $0.10). Withdrawn 2026-10-24 with the old stateless base its numbers print on, then **superseded** by the plain base (whose buy point is its own highest high + $0.10) | replayed at 5 (the rollback value of `MEMBER_BASE_STATELESS_ROUND`); `MEMBER_TEXTBOOK_ROUND = 2` unchanged |
| `remount.json.gz` | `draw:remount` (the `setup_draws` layer) | `MEMBER_REMOUNT_ROUND = 3` |
| `u_and_r.json.gz` | `draw:u_and_r` (the `setup_draws` layer) | `MEMBER_U_AND_R_ROUND = 2` |
| `donchian_breakout.json.gz` | `draw:donchian_breakout`: owner released 2026-10-24, **withdrawn** the same day (status `withdrawn`; recert B DC1 pooled 1.53, fix round fr1 pooled 2.13) | `MEMBER_DONCHIAN_BREAKOUT_ROUND = None` (judged at `1`) |
| `rsi_bullish_divergence.json.gz` · `wyckoff_upthrust.json.gz` · `channel.json.gz` · `pennant.json.gz` · `darvas_box.json.gz` · `falling_wedge.json.gz` · `double_top.json.gz` · `golden_cross.json.gz` · `death_cross.json.gz` | the round-2 setup drawings (`setup_draw_r2`, the `setup_draws` layer); the crosses draw two rows each (the 50-day and the 200-day average) | `MEMBER_<SETUP>_ROUND = 2` (one literal per drawing) |
| `outside_bar.json.gz` · `major_trendlines.json.gz` · `descending_triangle.json.gz` · `inverse_head_shoulders.json.gz` · `bear_flag.json.gz` · `bollinger_squeeze.json.gz` | the round-3 setup drawings (`setup_draw_r3`, the `setup_draws` layer) | `MEMBER_<SETUP>_ROUND = 3` (`MEMBER_MAJOR_TRENDLINES_ROUND` for `draw:major-trendline`) |
| `rectangle.json.gz` | `draw:rectangle`, the trading-range box (`setup_draw_rectangle`, the `setup_draws` layer) | `MEMBER_RECTANGLE_ROUND = 1` |

### The setup lens (`setup_draws`)

Every setup drawing is read off the member's `setup_draws` key and nowhere else: a row of the right id that turns up
under `structures` or `detections` does not count. The single-level setups (remount, U&R, donchian) keep the key-price
check above. The setup-LINE families (the sixteen files in the last three rows of the table) store the judged drawing
as the lab drew it: one `det` per row the member path serves (the crosses have two), each with its geometry `shape`
and every anchor as a day offset and a scaled price. For each judged det the lens asks for its own drawn row with
the same shape, the same anchor count, and every anchor within tolerance: the price within
`min(0.25 x ATR14, 1% of price)` and the bar within `max(3, 10% of the drawing's span)` sessions (`judged.setup_line_failures`).

Check (3) is asserted only for a setup drawing the member path itself settles against the base drawings, which today
is the rectangle (`auto_structures.ONE_LINE_PER_BASE_PRIORITY`; its breakout line is the box top). The round-2 and
round-3 setup ids are outside that priority, so the member path draws them beside whatever else is on the chart and the
gate does not claim otherwise. `member_setup_one_line_per_base` can legitimately withhold a rectangle under a drawn
base-family line; such a case is retired under the existing `one_line_per_base` rule (which now reads the judged box's
own span as the window, the donchian keeping its 55-bar channel window), never added to `KNOWN_RED`. On the current
fixtures it suppresses **none**: every rectangle case that is in the member frame is drawn.

The setup fixtures were exported 2026-10-24 from every case EITHER judge scored 3 on the passed packets (round 2: 303
cases; round 3: 199; rectangle: 35), each re-detected first with the lab's own frozen detector on the current bars, and
kept only when its facts matched the lab key exactly (all 537 did). A round-2 or round-3 case stores the 330 bars the
detector reads (`setup_draw_r2.WINDOW`); a rectangle case stores the 600 bars the member route reads, because the base
drawings it yields to need the full window.

**Each setup family is served on the frame its passed round sampled** (`auto_structures.SETUP_FRAME_BY_ID`, owner
decision 2026-10-24). Round 3's batch b3 (descending triangle, Bollinger squeeze, bear flag, inverse head and shoulders)
and the rectangle's round sampled close above $5 and a 20-day average dollar volume of at least $5M, so those five are
drawn on that frame (`SETUP_FRAME_ADV20`). Every other setup family's round (release_g4, setups_r2, setups_r3 b1 and b2)
sampled close above $5 and an as-of close x volume of at least $20M, and stays on that one-day frame (`SETUP_FRAME_DAY`).
Until that change, 72 judged cases of the five were `KNOWN_RED` because the member frame was the one-day $20M floor for
every family; they reproduce now, and putting the one-day floor back on those five turns them red again.

A `withdrawn` file is a released drawing a later recertification failed: its member literal is `None` (admins
keep the layer) and `test_a_withdrawn_drawing_is_not_served_to_members` keeps it there. Its judged cases are still
replayed with the literal set back to the judged round, so the code stays guarded for the day a new passed round
re-releases it; re-releasing is a re-baseline (below) that flips the status back to `released`.

A `superseded` file is a released drawing a NEWER passed round of the same drawing replaced (its member literal moved
on to that round, which a `released` file records). Its cases replay with the literal set back to the judged round --
the rollback lever -- and `test_a_superseded_family_is_one_a_released_family_replaced` keeps the pairing honest.

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

Retired 2026-10-24 (recert B interim ruling) under rule `textbook_gate`: 17 shelf and 16 double-bottom cases. The
shelf pivot, the double bottom and the flat top each failed the strict textbook round 1 as served (pooled 1.57 /
2.005 / 2.01), and the coordinator ruled their fix gates live at once as interim removal-only guards
(`pattern_engine.textbook_gate.pivot_fails`, `MEMBER_PIVOT_GATE_ROUND = 1`). With the gate, the report-only blind
packet E (two fresh judges, the same strict rubric) scored shelf 2.52 (n 25, 100% at 2 or more), double bottom 2.55
(n 20, 95%) and flat top 2.46 (n 25, 96%). Each retired case's reason names the rules its ungated row fails, and the
rule (`judged._pivot_gate_holds`) replays the member route on the same chart with the gate off and asserts the gate
fails the family's row there, so a case whose drawing goes missing for any other reason is red. The packet E cases
both judges scored 3 were added (shelf 12, double bottom 11). The flat top has no golden fixture; its gate is railed
by `tests/test_textbook_pivot_gate.py` (parity with the lab rule on real served rows of all three types). A formal
fix round (four packets of 25) is still to run; a type that fails it is hidden.

Formal fix round fr1 (2026-10-24, PREREG_FR = AMENDMENT 2: whole bars.db history 1995-2026, $5M liquidity, four
pre-registered packets of 25, two fresh blind judges each, same strict bar): flat top 2.48 / 2.50 / 2.58 / 2.48,
pooled 2.51, PASS; double bottom 2.70 / 2.64 / 2.66 / 2.82, pooled 2.705, PASS; shelf 2.26 / 2.44 / 2.32 / 2.54,
pooled 2.39, FAIL (withdrawn); donchian with its textbook gate 2.10 / 2.06 / 2.26 / 2.10, pooled 2.13, FAIL
(withdrawn). 10 of each passing type's 3/3 cases were added (the flat top as a new family; the 5 MB budget caps the
rest). A withdrawn family's retired cases are kept as written and are not checked while it is withdrawn.

Un-retired the same day: 3 donchian cases (`a-002`, `b-001`, `b-005`) whose yielding was to a base line the interim
gate now withholds. With no base line left on the chart, the channel line is drawn as judged again, and the cases are
back under the drawn-as-judged test.

Retired 2026-10-24 under `one_line_per_base` (precedence round e): 11 donchian cases. Round e was a blind paired round:
25 shared-base charts, 2 fresh judges. On a shared base, the base-family line was preferred over the donchian channel
line in 84% of 50 judgments (95% CI 72-94%). So the channel line yields to a drawn base line within 1 ATR (8 cases
remain retired after the 3 un-retired above)
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
$5 close, $20M of one-day dollar volume and a $5M 20-day average). Encoding: `tests/golden_judged/encode.py`; decoding:
`member_path.decode_bars`. `test_the_fixtures_are_symbol_free_and_small` refuses identifying keys, paths and
anything shaped like a real date, and keeps the directory under 5 MB on disk. A fixture may be stored as
`.json.gz` (deterministic, mtime 0); it is counted compressed and scanned decompressed. Since 2026-10-24 every
family is gzipped, written by `encode.write_family_gz` (compact JSON, deflate level 9 with the filtered strategy, about
4% smaller than gzip's default here). The directory then held 4.85 MB of its 5 MB budget: the next family needs room
made first (shorter windows where the drawing reads fewer bars), not a bigger budget.

## Labels: the screener's candle names

`tests/golden_judged/test_judged_candles.py` guards the candle LABELS the screener publishes (not a chart drawing,
so these cases do not go through the member chart route). Each case in `fixtures_labels/candles.json` is a daily
bar BOTH blind judges scored 3 for one candle name in the 2026-10-24 recertification of `CANDLE_RULES_ROUND = 2`
(four pre-registered packets of 25, strict Nison / Bulkowski rubric: 2.54 / 2.50 / 2.48 / 2.32, pooled 2.46). The
case stores the 400 daily bars the screener hands `candles.single_candle` (encoded exactly like the chart fixtures)
and the judged key; the gate replays `single_candle(usable_bars(bars[-400:]))` and asserts the key is still in
`candle_matches`. Re-baselining follows the same rule as the chart families: only with a new passed blind round,
together with `MEMBER_CANDLE_ROUND`.

`tests/golden_judged/test_judged_setup_tags.py` guards the member setup and event TAGS on the chart (the chip naming
a setup or event on one of the last three sessions). Recertification C (2026-10-24) judged them blind on a 0-3 placement
rubric over three rounds; the eleven checks that passed are `api/services/pattern_engine/tag_textbook.py` at
`TAGS_ROUND = 2`, and gap support and trendline break (which failed) are withheld from members. Each case in
`fixtures_labels/setup_tags.json.gz` stores the 320 bars `compute_tags` saw. A case both judges scored 3 must still be
served through `compute_tags` then `member_tags`, and every detection's `parity` verdict (the lab's own check) must
match `tag_textbook.keep`; a detection the lab refused must not be served. Re-baselining follows the same rule, together
with `MEMBER_SETUP_TAGS_ROUND`.

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
