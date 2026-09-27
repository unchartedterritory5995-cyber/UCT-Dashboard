# Vendor harness — verdicts

Directories: `tests/fixtures/vendor`

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
adx-14-2026-09-06                            AMEX:SPY D       1      DIVERGE       adx: bar 220 t=1778679000 value vendor=26.598480129458775 ours=26.598489308308835
    adx                                      DIVERGE       cmp 273 ok 39 warm 193/193 steady 41/80 maxRel 1.93e-1 — 41 steady-state bars disagree; first at bar 220 (value: vendor 26.598480129458775 vs ours 26.598489308308835) — scattered, last at bar 260
atr-14-2026-09-06                            AMEX:SPY D       1      DIVERGE       atr14: bar 180 t=1644330600 value vendor=8.77494009272306 ours=8.774936243175715
    atr14                                    DIVERGE       cmp 1314 ok 1120 warm 166/166 steady 28/1148 maxRel 2.50e-1 — 28 steady-state bars disagree; first at bar 180 (value: vendor 8.77494009272306 vs ours 8.774936243175715) — a CONVERGING PREFIX: bars 180..207 differ with |err| falling 3.85e-6 → 5.21e-7, then all 1120 later bars agree (the recursive-state-seeded-at-the-window signature)
ema-close20-2026-09-06                       AMEX:SPY D       1      DIVERGE       ema20: bar 100 t=1546266600 value vendor=254.9096484133421 ours=254.90952665266488
    ema20                                    DIVERGE       cmp 2012 ok 1876 warm 81/81 steady 55/1931 maxRel 1.41e-3 — 55 steady-state bars disagree; first at bar 100 (value: vendor 254.9096484133421 vs ours 254.90952665266488) — a CONVERGING PREFIX: bars 100..154 differ with |err| falling 1.22e-4 → 5.47e-7, then all 1876 later bars agree (the recursive-state-seeded-at-the-window signature)
hma-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    hma20                                    MATCH         cmp 2009 ok 2009 warm 0/0 steady 0/2009 maxRel 0.00e+0
macd-hist-12-26-9-2026-09-06                 AMEX:SPY D       1      MATCH         all 1 items agree
    histLine                                 MATCH         cmp 1998 ok 1861 warm 137/177 steady 0/1821 maxRel 2.02e+0
macd-line-12-26-2026-09-06                   AMEX:SPY D       1      MATCH         all 1 items agree
    macdLine                                 MATCH         cmp 2006 ok 1851 warm 155/185 steady 0/1821 maxRel 8.36e-2
macd-signal-12-26-9-2026-09-06               AMEX:SPY D       1      MATCH         all 1 items agree
    signalLine                               MATCH         cmp 1998 ok 1846 warm 152/177 steady 0/1821 maxRel 4.44e-1
minus-di-14-2026-09-06                       AMEX:SPY D       1      DIVERGE       minusDI: bar 170 t=1772548200 value vendor=29.111226293280946 ours=29.111234826270927
    minusDI                                  DIVERGE       cmp 286 ok 99 warm 156/156 steady 31/130 maxRel 3.73e-2 — 31 steady-state bars disagree; first at bar 170 (value: vendor 29.111226293280946 vs ours 29.111234826270927) — a CONVERGING PREFIX: bars 170..200 differ with |err| falling 8.53e-6 → 5.44e-7, then all 99 later bars agree (the recursive-state-seeded-at-the-window signature)
plus-di-14-2026-09-06                        AMEX:SPY D       1      DIVERGE       plusDI: bar 170 t=1772548200 value vendor=13.874091248158093 ours=13.874088643084825
    plusDI                                   DIVERGE       cmp 286 ok 85 warm 154/156 steady 47/130 maxRel 8.52e-2 — 47 steady-state bars disagree; first at bar 170 (value: vendor 13.874091248158093 vs ours 13.874088643084825) — a CONVERGING PREFIX: bars 170..221 (with agreeing bars inside the run) differ with |err| falling 2.61e-6 → 5.54e-7, then all 78 later bars agree (the recursive-state-seeded-at-the-window signature)
rma-close14-2026-09-06                       AMEX:SPY D       1      DIVERGE       rma14: bar 150 t=1552570200 value vendor=275.89513466191005 ours=275.89519869793804
    rma14                                    DIVERGE       cmp 2018 ok 1815 warm 137/137 steady 66/1881 maxRel 5.80e-3 — 66 steady-state bars disagree; first at bar 150 (value: vendor 275.89513466191005 vs ours 275.89519869793804) — a CONVERGING PREFIX: bars 150..215 differ with |err| falling 6.40e-5 → 5.18e-7, then all 1815 later bars agree (the recursive-state-seeded-at-the-window signature)
rsi-close14-2026-09-06                       AMEX:SPY D       1      DIVERGE       rsi14: bar 180 t=1644330600 value vendor=48.27241930297317 ours=48.27241475045275
    rsi14                                    DIVERGE       cmp 1314 ok 1123 warm 166/166 steady 25/1148 maxRel 1.18e-1 — 25 steady-state bars disagree; first at bar 180 (value: vendor 48.27241930297317 vs ours 48.27241475045275) — a CONVERGING PREFIX: bars 180..214 (with agreeing bars inside the run) differ with |err| falling 4.55e-6 → 5.70e-7, then all 1113 later bars agree (the recursive-state-seeded-at-the-window signature)
sma-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    sma20                                    MATCH         cmp 2012 ok 2012 warm 0/0 steady 0/2012 maxRel 2.32e-15
stoch-k-14-2026-09-06                        AMEX:SPY D       1      MATCH         all 1 items agree
    stochK                                   MATCH         cmp 287 ok 287 warm 0/0 steady 0/287 maxRel 2.18e-16
wma-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    wma20                                    MATCH         cmp 2012 ok 2012 warm 0/0 steady 0/2012 maxRel 0.00e+0
seed-warmup-spy-12m-2026-09-21               SPY 12M          8      DIVERGE       N10_atr5: bar 4 t=1997-01-01 na vendor=13.96875 ours=na
    N08_ema5_SEED_QUESTION_compare_to_N09_at MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.31e-16
    N09_sma5_THE_DISCRIMINATOR_FOR_N08       MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.31e-16
    N10_atr5                                 DIVERGE       cmp 34 ok 4 warm 0/0 steady 30/34 maxRel 1.07e-1 — 30 steady-state bars disagree; first at bar 4 (na: vendor 13.96875 vs ours na) — persistent, last at bar 33
    N11_rma_of_tr5_MUST_EQUAL_N10            MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.40e-16
    N12_sma_of_tr5_SEED_DISCRIMINATOR        MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.60e-16
    N13_stdev5_POPULATION_OR_SAMPLE          MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 9.91e-15
    N15_sum5_PRE_WINDOW_na_or_partial        MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.03e-16
    N06_change_close_bar0_is_the_reading     MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
w2-warmup-spy-12m-2026-09-22                 SPY 12M          0      INCONCLUSIVE  refused on our side: member door refused (pine:role-order): this table states what kind each argument is and never what role it plays, so several price series cannot be matched onto it by position — `ta.cci` takes a SOURCE and this table reads the typical price from cci(series, series, series, int). Those are the same column when the source is `hlc3` and a DIFFERENT indicator otherwise, so only that source is taken — TO UNBLOCK: write `ta.cci(hlc3, …)`

TOTAL 16 captures — MATCH 7 · DIVERGE 8 · INCONCLUSIVE 1
```

## Not comparable (80)

- `tests/fixtures/vendor/agen-1d-bars-2000-2026-09-13.json` — these are OUR bars (/api/bars), not the vendor's — a companion file, not a capture
- `tests/fixtures/vendor/aroon-spy-1d-2026-09-10.json` — vendor built-in study — no Pine source exists to run on our side
- `tests/fixtures/vendor/barstate-daily-timeline.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/barstate-full-spy-1d-closed-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/divergences.json` — not a capture (schema / divergence register)
- `tests/fixtures/vendor/divergences.schema.json` — not a capture (schema / divergence register)
- `tests/fixtures/vendor/exchange-spelling-seven-witnesses-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/fold-numeric-spy-1d-1w-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/groupb-barssince-arity-spy-1d-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/groupb-pivot-default-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/groupb-readings-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/groupb-round-max-vwap-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/observations/ta-accdist-delta5-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json` — the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots
- `tests/fixtures/vendor/observations/ta-falling-close3-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-kcw-close20-2-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-median_even_length-oracle-ambiguity-v3-1-2026-09-05.json` — the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots
- `tests/fixtures/vendor/observations/ta-percentrank-oracle-ambiguity-v3-1-2026-09-05.json` — the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots
- `tests/fixtures/vendor/observations/ta-pvt-delta5-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-rising-oracle-ambiguity-v3-1-2026-09-05.json` — vendor.values holds 1 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/p1-top-unmeasured-spy-1d-2026-09-21.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/parity/adx-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/atr-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ema-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/hma-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/macd-hist-12-26-9-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/macd-line-12-26-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/macd-signal-12-26-9-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/minus-di-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/plus-di-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/rma-close14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/rsi-close14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/sma-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/stoch-k-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-median_even_length-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-percentrank-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-rising-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/wma-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/r11-alma-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-barssince-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-corr-pct-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-nine-safe-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-nvi-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-time-session-spy-5m-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-time-tf-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-time-tf-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-tr-true-spy-1d-2026-09-12.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-valuewhen-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-valuewhen-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/A/clouds-volume-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/A/volume-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/B/clouds-volume-nvda-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/B/volume-nvda-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/C/clouds-volume-spy-1w-150.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/C/volume-spy-1w-150.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/D/clouds-volume-spy-4h-300.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/D/volume-spy-4h-300.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/callsite-state-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/finite-window-na-policy-by-member-spy-1d-2026-09-08.json` — market.bars does not carry the vendor's OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed
- `tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/na-in-a-source-window-vs-recurrence-spy-1d-2026-09-08.json` — market.bars does not carry the vendor's OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed
- `tests/fixtures/vendor/runtime/recurrent-callsite-identity-and-event-history-spy-1d-2026-09-08.json` — market.bars does not carry the vendor's OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed
- `tests/fixtures/vendor/runtime/recurrent-composites-and-window-closure-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/recurrent-na-and-skipped-callsite-spy-1d-2026-09-08.json` — vendor readings are not a per-bar `values` series (split rows or named samples) — nothing contiguous to compare bar by bar
- `tests/fixtures/vendor/runtime/skipped-callsite-history-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/ta-cum-and-context-namespaces-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/saved-probe-integrity-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json` — these are OUR bars (/api/bars), not the vendor's — a companion file, not a capture
- `tests/fixtures/vendor/tuple-security-spy-1d-closed-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/uncharted-volume-v2-agen-1d-hve-2026-09-12.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-2026-09-12.json` — only 4 hand-read rows and no vendor OHLCV series
- `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-forced-depth-2026-09-13.json` — only 4 hand-read rows and no vendor OHLCV series
- `tests/fixtures/vendor/visual/five-indicators-spy-1d-2026-09-23.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/visual/fvg-boxes-spy-1d-2026-09-22.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json` — vendor readings are not a per-bar `values` series (split rows or named samples) — nothing contiguous to compare bar by bar
- `tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/w3-format-spy-1d-2026-09-22.json` — no vendor OHLCV series together with per-bar study values and a script source
