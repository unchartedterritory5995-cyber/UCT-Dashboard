PROBES OF 2026-11-23 (Studio track), for the engine unit that takes findings 1 and 2.
Our own scripts, written by hand. Each was run through tools/value_cases/script_lane (the member pane's own path) on the built
daily chart. One line per probe: what it tests, then what the lane returned on master 037e8d75b6.
FINDING 2: a label whose text is ARITHMETIC on a value read back from a drawing is not drawn, and nothing is reported.
FINDING 1: the assistant is told it may write a ta call inside an `if` block; the engine refuses it when the block skips bars.

01_getter_y2_alone_in_a_label.pine: a label whose text is ONE read-back value (line.get_y2).
    TODAY: lane object program; lines 1; labels ['113.09']; plotted columns {'value': 2000}; errors none
02_getter_y1_alone_in_a_label.pine: a label whose text is ONE read-back value (line.get_y1).
    TODAY: lane object program; lines 1; labels ['111.49']; plotted columns {'value': 2000}; errors none
03_local_set_from_one_getter.pine: the read-back value goes through a local first.
    TODAY: lane object program; lines 1; labels ['113.09']; plotted columns {'value': 2000}; errors none
04_local_arithmetic_no_getter.pine: CONTROL: arithmetic in a local, no read-back at all.
    TODAY: lane object program; lines 1; labels ['1.60']; plotted columns {'value': 2000}; errors none
05_two_getters_subtracted_inline.pine: ARITHMETIC on read-back values, written inline in the label.
    TODAY: lane object program; lines 1; labels NONE; plotted columns {'value': 2000}; errors none
06_two_getters_subtracted_through_a_local.pine: the same arithmetic through a local, the text joined to a "$".
    TODAY: lane object program; lines 1; labels NONE; plotted columns {'value': 2000}; errors none
07_getter_minus_a_number.pine: ARITHMETIC on one read-back value and a constant.
    TODAY: lane object program; lines 1; labels NONE; plotted columns {'value': 2000}; errors none
08_getter_plus_itself.pine: ARITHMETIC on one read-back value and itself.
    TODAY: lane object program; lines 1; labels NONE; plotted columns {'value': 2000}; errors none
09_getter_arithmetic_plotted.pine: the same subtraction PLOTTED instead of put in a label (runtime lane).
    TODAY: lane runtime; lines 1; labels NONE; plotted columns {'value': 2000}; errors none
10_cap05_rise_from_getters.pine: value case cap-05 with the rise READ BACK from the line (the script that found it).
    TODAY: lane object program; lines 1; labels NONE; plotted columns {'value': 2000}; errors none
11_cap05_rise_without_getters.pine: CONTROL: the same script with the rise computed directly.
    TODAY: lane object program; lines 1; labels ['$8.06']; plotted columns {'value': 2000}; errors none
12_conditional_ta_inside_an_if.pine: FINDING 1: `ta.sma` inside an `if` block at the top level, as the assistant is told it may write.
    TODAY: lane None; lines 0; labels NONE; plotted columns NONE; errors {'value': {'guard': 'pine:block', 'message': '`avgUp` calls `ta.sma` inside a block that does not run on every bar, and that call sees only the bars its block runs on ? on this chart the block skips bar 0 and runs again on bar 3, so its calls have not run on every bar'}}
13_conditional_ta_inside_a_constant_switch.pine: CONTROL for finding 1: `ta.*` inside the arms of a `switch` over a setting (the block runs on every bar).
    TODAY: lane None; lines 0; labels NONE; plotted columns {'value': 1981}; errors none
