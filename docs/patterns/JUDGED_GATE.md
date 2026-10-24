# The judged regression gate

`tests/golden_judged/` stops any code change from silently making a member-visible drawing worse than what blind
judges approved. It runs in the default `pytest` run (`testpaths = tests api`), in about 20 seconds.

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
| `sr.json` | `levels_sr` zones and trendline sides | `MEMBER_SR_ROUND = "r2"` |
| `cup.json` | `bc:cup-with-handle` (cup tier drawing) | `MEMBER_CUP_TIER_ROUND = 4` |
| `inside_day.json` | `draw:inside-day` | `MEMBER_INSIDE_DAY_ROUND = 3` |
| `textbook.json` | `bc:base` textbook buy point | `MEMBER_TEXTBOOK_ROUND = 1` |
| `remount.json`, `u_and_r.json`, `donchian_breakout.json` | passed both packets, **not yet ported** | none (`pending_port`) |

Unpassed rounds and dark drawings are not fixtures. The three `pending_port` files are carried so the gate covers
those drawings the day they ship: `test_a_pending_drawing_is_still_not_on_the_member_path` goes red when a member
round literal for one appears, and the fix is to set that file's `status` to `released` with its `pattern_id` and
`member_literal` (and teach `judged.py` the row's geometry keys).

`KNOWN_RED` in `test_judged_gate.py` lists the judged cases current master does NOT reproduce, each with its
measured cause. They are strict xfails: any OTHER case going red fails the run, and a listed case that starts
passing fails it too, so its entry has to be deleted. Never add a case to `KNOWN_RED` to make a change pass.

## Public repo: what a fixture holds

No ticker, no trader name, no member data, no path. Bars are stored as calendar-day offsets from the window's first
bar (the weekday of that bar is kept, the year is not), and every price is multiplied by a random per-case `scale`
that is recorded in the case so the replay can divide it back out (the drawing code has absolute floors such as a
$5 close and $20M of dollar volume). Encoding: `tests/golden_judged/encode.py`; decoding:
`member_path.decode_bars`. `test_the_fixtures_are_symbol_free_and_small` refuses identifying keys, paths and
anything shaped like a real date, and keeps the directory under 5 MB.

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
