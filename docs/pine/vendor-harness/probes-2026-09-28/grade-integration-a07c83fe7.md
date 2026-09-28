# Vendor harness — verdicts

Directories: `../../../../AppData/Local/uct-vendor-batch/runs/probes-2026-09-28/captures`

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
vw-bool-cast-spy-1d-2026-09-28               AMEX:SPY 1D      10     DIVERGE       B07_corpus_time_membership_first_bar: bar 45 t=734016600 value vendor=1 ours=0
    B00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_and                                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_not                                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B03_or                                   MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B04_ternary_test                         MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B05_if_else                              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     DIVERGE       cmp 8473 ok 8439 warm 0/0 steady 34/8473 maxRel 1.00e+0 — 34 steady-state bars disagree; first at bar 45 (value: vendor 1 vs ours 0) — scattered, last at bar 8332
    B08_t_is_na_CONTROL                      DIVERGE       cmp 8473 ok 3165 warm 0/0 steady 5308/8473 maxRel 0.00e+0 — 5308 steady-state bars disagree; first at bar 45 (value: vendor 0 vs ours 1) — persistent, last at bar 8472
    objects                                  MATCH         neither side draws an object
vw-bool-cast-spy-60-2026-09-28               AMEX:SPY 60      10     MATCH         all 11 items agree
    B00_bar_index_CONTROL                    MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B01_and                                  MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B02_not                                  MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B03_or                                   MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B04_ternary_test                         MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B05_if_else                              MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH         cmp 20616 ok 20616 warm 0/1 steady 0/20615 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-v4-spy-1d-2026-09-28            AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:role-order): this table states what kind each argument is and never what role it plays, so several price series cannot be matched onto it by position — `valuewhen` takes 2 price series (valuewhen(series, series, int)) and no measured order maps `valuewhen` onto them
vw-bool-cast-v4-spy-60-2026-09-28            AMEX:SPY 60      0      INCONCLUSIVE  refused on our side: member door refused (pine:role-order): this table states what kind each argument is and never what role it plays, so several price series cannot be matched onto it by position — `valuewhen` takes 2 price series (valuewhen(series, series, int)) and no measured order maps `valuewhen` onto them
vw-deadband-ticks-aapl-1d-2026-09-28         NASDAQ:AAPL 1D   0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin): `syminfo.mintick` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: It is the symbol's minimum price increment, which differs per symbol and is not something this engine holds. ⭐ IN PRACTICE IT APPEARS IN ONE IDIOM — `math.max(high - low, syminfo.mintick)` — a guard against dividing by a bar whose range is zero. THIS ENGINE DOES NOT NEED THAT GUARD: a zero denominator is reported as NOT COMPUTABLE for that symbol rather than quietly replaced, so write `(close - low) / (high - low)` and a halted, zero-range bar is left unanswered instead of being scored as though it closed on its low. ⚠️ That is a REAL difference, not a simplification: Pine answers 0 on such a bar and this engine answers nothing, which is why the edit is yours to make rather than one taken silently on your behalf.
vw-deadband-ticks-brk-a-1d-2026-09-28        NYSE:BRK.A 1D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin): `syminfo.mintick` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: It is the symbol's minimum price increment, which differs per symbol and is not something this engine holds. ⭐ IN PRACTICE IT APPEARS IN ONE IDIOM — `math.max(high - low, syminfo.mintick)` — a guard against dividing by a bar whose range is zero. THIS ENGINE DOES NOT NEED THAT GUARD: a zero denominator is reported as NOT COMPUTABLE for that symbol rather than quietly replaced, so write `(close - low) / (high - low)` and a halted, zero-range bar is left unanswered instead of being scored as though it closed on its low. ⚠️ That is a REAL difference, not a simplification: Pine answers 0 on such a bar and this engine answers nothing, which is why the edit is yours to make rather than one taken silently on your behalf.
vw-deadband-ticks-spy-1d-2026-09-28          AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin): `syminfo.mintick` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: It is the symbol's minimum price increment, which differs per symbol and is not something this engine holds. ⭐ IN PRACTICE IT APPEARS IN ONE IDIOM — `math.max(high - low, syminfo.mintick)` — a guard against dividing by a bar whose range is zero. THIS ENGINE DOES NOT NEED THAT GUARD: a zero denominator is reported as NOT COMPUTABLE for that symbol rather than quietly replaced, so write `(close - low) / (high - low)` and a halted, zero-range bar is left unanswered instead of being scored as though it closed on its low. ⚠️ That is a REAL difference, not a simplification: Pine answers 0 on such a bar and this engine answers nothing, which is why the edit is yours to make rather than one taken silently on your behalf.
vw-var-seed-spy-1d-2026-09-28                AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `d` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.

TOTAL 8 captures — MATCH 1 · DIVERGE 1 · INCONCLUSIVE 6
```

## Not comparable (0)

