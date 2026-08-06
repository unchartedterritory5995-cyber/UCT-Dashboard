"""Address → the indicator's FULL aligned series.

⭐ THE CONTRACT CHANGE THAT MAKES CLOSED-BAR POSSIBLE. `INDICATOR_FUNCS` returned
`_last_non_none(...)` — one number, the newest computable one — which is why the
only `prev` available was the previous POLL's number. With the whole column in
hand, `prev` is `series[i-1]` and `current` is `series[i]`, and the crossing is a
comparison of two BARS rather than two CYCLES.

⚠️ EVERY ENTRY STILL READS THE DELIVERY WRAPPER (`compute_atr`, not
`compute_atr_raw`). Global Constraint: the two live consumers of this lane have
always compared user thresholds against the rounded form, and the 5,040-row
baseline is a recording of exactly those numbers. Reading the precise core here
would make the closed lane disagree with the forming lane by up to half a unit in
the last place — which is precisely what flips a comparison at a boundary, and
would arrive disguised as "the rebuild changed when things fire".

⚠️ ALIGNMENT IS THE WHOLE SAFETY PROPERTY. Every returned list is `len(bars)` with
`None` before the first computable bar — `indicator_compute`'s own alignment rule.
An address whose series is SHORTER than `bars` silently shifts every index, so
`series_for` asserts the length rather than trusting it.

⚠️ AND ONE COLUMN HAS A **TRAILING** PAD. `ichimoku.chikou` back-shifts bar `i`'s
close to index `i - 26`, so the newest 26 slots are `None` — `compute_ichimoku_raw`
says so in its own docstring. The forming lane never noticed, because
`_last_non_none` walks backwards until it finds a number and happily returns one
from 26 bars ago. The closed lane reads `series[i]` and therefore reports "no
value at this bar", which is the honest answer: chikou at the newest closed bar is
a fact about a bar that has not happened yet. That is a DELIBERATE difference
between the lanes, not an oversight, and `test_chikou_has_no_value_at_the_newest_bar`
pins it in both directions.

⛔ THIS TABLE IS A TWIN OF `INDICATOR_FUNCS` AND THE TWIN IS NOT LEFT ON TRUST.
`test_every_address_series_ends_where_the_value_function_says_it_does` drives
EVERY address in `INDICATOR_FUNCS` + `EVENT_FUNCS` through both and demands
`_last_non_none(series_for(a, bars, p)) == value_function(a)(bars, p)` exactly, on
real fixtures across several param sets — which catches a wrong column index, a
wrong `on_closes`, a wrong compute name and a dropped delivery wrapper, all of
which return plausible numbers. `test_the_series_table_covers_every_address` is
the totality half: a rail that only checks what somebody remembered to list is a
LIST, not a rail.
"""

from __future__ import annotations

from typing import Callable, Optional

Series = list[Optional[float]]


def _column(compute_name: str, index: Optional[int] = None,
            on_closes: bool = False, **defaults) -> Callable[[list[dict], dict], Series]:
    """Build a SERIES function for one plot of one indicator.

    The exact counterpart of `indicator_alert_evaluator._plot_of`, minus the
    `_last_non_none` at the end — same delivery wrapper, same `index`, same
    `on_closes` input shape, same params coercion. Keeping the two builders
    shaped identically is what makes the equivalence rail a one-line assertion
    instead of a per-address argument.
    """
    def fn(bars: list[dict], params: dict) -> Series:
        from api.services import indicator_compute
        kwargs = {k: type(v)(params.get(k, v)) for k, v in defaults.items()}
        series = [b["c"] for b in bars] if on_closes else bars
        out = getattr(indicator_compute, compute_name)(series, **kwargs)
        return list(out if index is None else out[index])
    fn.__name__ = f"_series_{compute_name}_{index}"
    return fn


def _series_bb(bars: list[dict], params: dict) -> Series:
    """`bb` reports the CLOSE, not a band — so its column is the closes.

    ⛔ NOT `bb.middle`, AND THE DIFFERENCE IS AN ARMED USER'S ALERT. The legacy
    `bb` alert is a price-vs-band RELATION: the value is the close and the band
    is looked up as a declared operand (`THRESHOLD_OPERAND`). `bb.upper` /
    `bb.middle` / `bb.lower` are the band VALUES, a different question.
    """
    return [float(b["c"]) for b in bars]


def _series_price_vs_ma(bars: list[dict], params: dict) -> Series:
    """`close − MA`, aligned — the spread this lane synthesises.

    There is no `price_vs_ma` chart definition; the evaluator invents it so a
    user can say "price more than $X above the 50-day". The column is `None`
    exactly where the MA is.
    """
    from api.services import indicator_compute
    period = int(params.get("period", 50))
    ma_type = (params.get("type") or "sma").lower()
    closes = [b["c"] for b in bars]
    if not closes:
        return []
    if ma_type == "ema":
        ma_series = indicator_compute.compute_ema(closes, period)
    else:
        ma_series = indicator_compute.compute_sma(closes, period)
    return [None if ma is None else float(c) - ma for c, ma in zip(closes, ma_series)]


# The table. Key order mirrors `INDICATOR_FUNCS` then `EVENT_FUNCS` so a reader
# diffing the two files reads them in the same order; nothing depends on it (the
# dropdown's order authority is still `INDICATOR_FUNCS`, and
# `test_the_series_table_covers_every_address` compares SETS).
SERIES_FUNCS: dict[str, Callable[[list[dict], dict], Series]] = {
    # ── the eight that existed before B5 ──
    "rsi": _column("compute_rsi", None, on_closes=True, period=14),
    "macd": _column("compute_macd", 0, on_closes=True, fast=12, slow=26, signal=9),
    "bb": _series_bb,
    "stoch": _column("compute_stoch", 0, k_period=14, d_period=3),
    "williams_r": _column("compute_williams_r", None, period=14),
    "cci": _column("compute_cci", None, period=20),
    "mfi": _column("compute_mfi", None, period=14),
    "price_vs_ma": _series_price_vs_ma,
    # ── B5: the remaining plots of bases that were already alertable ──
    "macd.signal": _column("compute_macd", 1, on_closes=True, fast=12, slow=26, signal=9),
    "macd.histogram": _column("compute_macd", 2, on_closes=True, fast=12, slow=26, signal=9),
    "bb.upper": _column("compute_bb", 0, on_closes=True, period=20, stddev=2.0),
    "bb.middle": _column("compute_bb", 1, on_closes=True, period=20, stddev=2.0),
    "bb.lower": _column("compute_bb", 2, on_closes=True, period=20, stddev=2.0),
    "stoch.d": _column("compute_stoch", 1, k_period=14, d_period=3),
    # ── B5: the six definitions that could not be alerted on at all ──
    "vwap": _column("compute_vwap"),
    "atr": _column("compute_atr", None, period=14),
    "adx.adx": _column("compute_adx", 0, period=14),
    "adx.plusDI": _column("compute_adx", 1, period=14),
    "adx.minusDI": _column("compute_adx", 2, period=14),
    "obv": _column("compute_obv"),
    "donchian.upper": _column("compute_donchian", 0, period=20),
    "donchian.middle": _column("compute_donchian", 1, period=20),
    "donchian.lower": _column("compute_donchian", 2, period=20),
    "ichimoku.tenkan": _column("compute_ichimoku", 0, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.kijun": _column("compute_ichimoku", 1, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.spanA": _column("compute_ichimoku", 2, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.spanB": _column("compute_ichimoku", 3, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    "ichimoku.chikou": _column("compute_ichimoku", 4, tenkan_period=9, kijun_period=26, senkou_b_period=52),
    # ── PHASE C: the two EVENT addresses ──
    "sar.priceCrossedSar": _column("compute_sar_events", 0, step=0.02, max_step=0.2),
    "sar.trendFlipped": _column("compute_sar_events", 1, step=0.02, max_step=0.2),
}


def series_function(address: str) -> Optional[Callable[[list[dict], dict], Series]]:
    """The series function for a canonical address, or ``None``.

    ⚠️ LOOKED UP LIVE, never snapshotted — the same rule `value_function` states.
    Two committed controls re-point a live entry at runtime to prove the replay
    can fail, and a module-level merged copy would keep serving the pre-mutation
    callable, which is a control that cannot fail.
    """
    return SERIES_FUNCS.get(address)


def series_for(address: str, bars: list[dict], params: dict) -> Series:
    """One canonical plot address → its FULL column, aligned to ``len(bars)``.

    ⛔ THE LENGTH IS ASSERTED, NOT TRUSTED, AND THAT IS THE WHOLE SAFETY
    PROPERTY. The closed lane indexes this list by BAR POSITION. A column one
    element short does not raise anywhere downstream — it silently shifts every
    index by one, so every alert reads the previous bar's number, `prev` reads
    the one before that, and the whole lane is off by one bar forever while every
    value it reports is a real number from a real bar. There is no test of the
    OUTPUT that catches that reliably; there is only this assertion.

    ⛔ AN UNKNOWN ADDRESS RAISES. That is deliberately NOT how the alert row's
    stored `indicator` is handled — the create path validates nothing, so a
    stored typo has always been (and stays) a silent no-fire, which
    `_evaluate_one_closed` guards with `series_function(...) is None` before it
    gets here. Reaching this function with an address the table has never heard
    of is a bug in a caller, not a bar with no data.
    """
    fn = SERIES_FUNCS.get(address)
    if fn is None:
        raise KeyError(
            f"no series function for address {address!r}. "
            f"Known addresses: {sorted(SERIES_FUNCS)}"
        )
    out = fn(bars, params)
    if len(out) != len(bars):
        raise AssertionError(
            f"{address}: series is {len(out)} long for {len(bars)} bars. "
            "Every column in indicator_compute is aligned to its input; a "
            "shorter one shifts every bar index silently and the closed-bar "
            "lane would read the wrong bar forever."
        )
    return out
