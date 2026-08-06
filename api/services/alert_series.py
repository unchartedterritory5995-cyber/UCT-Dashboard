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

⭐⭐ PHASE C TASK 10 — THIS TABLE IS NO LONGER A TWIN. IT IS THE ONE TABLE.
`indicator_alert_evaluator.INDICATOR_FUNCS` used to be a second hand-written
dict of 28 closures naming the same computes, the same column indices, the same
`on_closes` input shapes and the same defaults, differing only in the
`_last_non_none` at the end. It is now DERIVED from this one — a value is the
last non-None element of a column, which is the definition, not a coincidence.

⛔ THE DERIVATION RUNS IN ONE DIRECTION ONLY, AND THAT IS WHY IT IS THIS TABLE
THAT SURVIVED. A column determines its last value; a last value determines
nothing about the column. There was never a choice about which of the two twins
could retire into the other.

⚠️ WHAT THE COLLAPSE COST, SAID PLAINLY. The old
`test_every_address_series_ends_where_the_value_function_says_it_does` demanded
`_last_non_none(series_for(a, bars, p)) == value_function(a)(bars, p)` across
real fixtures and several param sets — and it was load-bearing, because a wrong
column index, a wrong `on_closes`, a wrong compute name or a dropped delivery
wrapper all return plausible numbers. That equality is now TRUE BY
CONSTRUCTION, so it has been moved DOWN A LEVEL rather than deleted: what
guards those four mistakes today is
`test_every_plot_address_resolves_to_the_column_it_names` (ORDERING invariants a
swap has to violate) plus the 5,040-row recorded baseline and the 691,195-fire
frozen log, both of which were recorded against the RETIRED closures and go red
if this table computes one different number.

⚠️ EVERY ENTRY CARRIES ITS OWN DEFAULTS AS DATA (`fn.inputs`), read by
`address_inputs`. That is what lets the alert catalog say "RSI(14)" and an alert
row say "RSI(7)" without a second table of parameter names — see
`indicator_alert_evaluator.instance_label`.
"""

from __future__ import annotations

from typing import Callable, Optional

Series = list[Optional[float]]


def _column(compute_name: str, index: Optional[int] = None,
            on_closes: bool = False, **defaults) -> Callable[[list[dict], dict], Series]:
    """Build a SERIES function for one plot of one indicator.

    ⭐ THIS IS THE ONLY BUILDER LEFT. It absorbed `indicator_alert_evaluator`'s
    `_plot_of`, which was the same function with `_last_non_none` bolted on the
    end; the value lane now composes that call itself. Same delivery wrapper,
    same `index`, same `on_closes` input shape, same params coercion — because
    it is literally the same code, not because two copies were kept in step.

    ⚠️ `defaults` IS KEPT ON THE FUNCTION, not just closed over. `fn.inputs` is
    what `address_inputs` reads, and it is what lets an alert row name its
    INSTANCE ("RSI(7)" vs "RSI(14)") without a second hand-written table of
    which parameters each address takes. Closing over it and not exposing it
    would have forced exactly that table.
    """
    def fn(bars: list[dict], params: dict) -> Series:
        from api.services import indicator_compute
        kwargs = {k: type(v)(params.get(k, v)) for k, v in defaults.items()}
        series = [b["c"] for b in bars] if on_closes else bars
        out = getattr(indicator_compute, compute_name)(series, **kwargs)
        return list(out if index is None else out[index])
    fn.__name__ = f"_series_{compute_name}_{index}"
    fn.inputs = dict(defaults)
    return fn


def _series_bb(bars: list[dict], params: dict) -> Series:
    """`bb` reports the CLOSE, not a band — so its column is the closes.

    ⛔ NOT `bb.middle`, AND THE DIFFERENCE IS AN ARMED USER'S ALERT. The legacy
    `bb` alert is a price-vs-band RELATION: the value is the close and the band
    is looked up as a declared operand (`THRESHOLD_OPERAND`). `bb.upper` /
    `bb.middle` / `bb.lower` are the band VALUES, a different question.
    """
    return [float(b["c"]) for b in bars]


_series_bb.inputs = {}


def _series_close(bars: list[dict], params: dict) -> Series:
    """⭐ PHASE C TASK 10 — THE BAR'S OWN CLOSE, AS A FIRST-CLASS ADDRESS.

    Task 11 needed price as a LEFT operand and could not have it: a left operand
    is an address, and every address lived in `INDICATOR_FUNCS`, whose 28 keys
    generate the frozen replay grid (`tools/alert_replay.py::build_alert_grid`).
    Adding a 29th key there would have moved 691,195 recorded fires, so Task 11
    shipped a 400 instead and handed the address forward.

    ⛔ SO IT IS NOT A 29th KEY. It is a THIRD PARTITION (`PRICE_FUNCS`), exactly
    the shape Task 3 used for the two `sar` EVENT addresses and for the same
    reason, verbatim: *"growing `INDICATOR_FUNCS` would have DESTROYED THE
    INSTRUMENT."* The frozen grid still enumerates 28 and `--check` still reads
    691,195, digest for digest.

    ⚠️ IT IS THE SAME NUMBER `bb` REPORTS, AND THAT IS NOT A REASON TO SHARE ONE
    ENTRY. `bb`'s value is the close because the legacy `bb` alert is a
    price-vs-BAND relation whose band arrives as a declared operand; `close`'s
    value is the close because it IS the close. One function object for both
    would make a future change to either one silently change the other.
    """
    return [float(b["c"]) for b in bars]


_series_close.inputs = {}


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


_series_price_vs_ma.inputs = {"period": 50, "type": "sma"}


# ⭐⭐ THE TABLE — AND SINCE PHASE C TASK 10 ITS KEY ORDER IS LOAD-BEARING.
#
# It used to mirror `INDICATOR_FUNCS`' order for a reader's convenience and
# nothing depended on it. `INDICATOR_FUNCS` is now DERIVED from this dict by
# filtering out the event and price partitions, and Python dicts preserve
# insertion order, so THIS is the dropdown's order authority. Insertion order
# has been the dropdown's order since B4 Task 9 and is pinned by
# `test_catalog_order_is_the_dropdown_order_and_it_did_not_change`, which is
# why the 28 levels stay exactly where they are and the two new partitions are
# APPENDED at the end rather than filed next to their relatives.
#
# ⛔ A NEW LEVEL ADDRESS INSERTED ANYWHERE BUT THE END OF THE FIRST 28 MOVES
# EVERY USER'S DROPDOWN, and also moves the frozen replay grid, which is
# generated in `INDICATOR_FUNCS` order.
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
    # ── PHASE C TASK 10: the one PRICE address ──
    "close": _series_close,
}


def address_inputs(address: str) -> dict:
    """The parameters this address takes, and their defaults.

    ⭐ DERIVED FROM THE COLUMN FUNCTION ITSELF (`fn.inputs`), never from a second
    table of "which knobs does rsi have". That second table is precisely the
    shape this task retired on the value side, and building a new one on the
    parameter side would have traded one twin for another.

    An empty dict means the address takes no parameters — `bb` (the close),
    `close`, `vwap`, `obv`. `{}` is returned for an unknown address too: a
    caller asking for the knobs of something that does not exist is asking a
    question with no wrong answer, and raising here would make the catalog's own
    construction able to fail on a typo in a *label*.
    """
    fn = SERIES_FUNCS.get(address)
    return dict(getattr(fn, "inputs", {}) or {})


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
