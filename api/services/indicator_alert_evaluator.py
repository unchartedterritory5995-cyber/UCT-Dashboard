"""Indicator alert evaluation loop.

Every 60s (configurable):
  1. List all active alerts (``indicator_alert_service.list_active``)
  2. Group by (sym, tf) to share bar fetches
  3. For each alert: compute the indicator value via ``indicator_compute``,
     evaluate condition vs last known value
  4. On trigger: record + dispatch delivery via the existing
     ``watchlist_alert_service.deliver_alert_payload`` hook (bell + email +
     Discord). On non-trigger but successful evaluation, persist the last
     value so the next cycle has a ``prev`` for cross-* conditions.

The evaluator runs in a single daemon thread. Each cycle is error-isolated
per alert so a single bad ticker does not block the rest. Bars are read
directly from the persistent SQLite store (``bars_sqlite.get_bars``); the
universe pre-warmer + background fetchers keep that store fresh, so we
never block on a remote API from this loop.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from typing import Any, Callable, Optional

_logger = logging.getLogger(__name__)
_running = threading.Event()
_thread: Optional[threading.Thread] = None


# ─── pure condition matching ─────────────────────────────────────────────────

def check_condition(
    condition: str,
    current: Optional[float],
    prev: Optional[float],
    threshold: Optional[float],
) -> bool:
    """Does an alert fire given current + previous indicator values?

    ``current`` is the latest indicator value (last computed bar). ``prev``
    is the value persisted from the previous evaluation cycle — used only by
    cross-* conditions. ``threshold`` is the user-supplied trigger level for
    above / below / cross_above / cross_below.

    Returns ``False`` for unknown conditions, missing values, or any case
    where the condition is well-defined but not met. Pure function — no
    side effects, no I/O, no module imports.
    """
    if current is None:
        return False

    if condition == "above":
        return threshold is not None and current > threshold
    if condition == "below":
        return threshold is not None and current < threshold
    if condition == "cross_above":
        # Crossed UP through threshold: prev was at/below, current is strictly above.
        return (
            prev is not None
            and threshold is not None
            and prev <= threshold
            and current > threshold
        )
    if condition == "cross_below":
        # Crossed DOWN through threshold: prev was at/above, current is strictly below.
        return (
            prev is not None
            and threshold is not None
            and prev >= threshold
            and current < threshold
        )
    if condition == "cross_zero":
        # Crossed through zero in either direction.
        if prev is None:
            return False
        return (prev <= 0 < current) or (prev >= 0 > current)
    if condition == "touch_upper":
        # Used for Bollinger Band upper-touch — current is expected to be the
        # close, threshold is the upper-band value at the same bar.
        return threshold is not None and current >= threshold
    if condition == "touch_lower":
        # Mirror of touch_upper for the lower band.
        return threshold is not None and current <= threshold
    return False


# ─── indicator dispatch ──────────────────────────────────────────────────────

def _last_non_none(seq: list) -> Optional[float]:
    """Return the last non-None value from a list, or None if all None / empty."""
    for v in reversed(seq):
        if v is not None:
            return float(v)
    return None


def _value_rsi(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 14))
    closes = [b["c"] for b in bars]
    return _last_non_none(indicator_compute.compute_rsi(closes, period))


def _value_macd(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    fast = int(params.get("fast", 12))
    slow = int(params.get("slow", 26))
    signal = int(params.get("signal", 9))
    closes = [b["c"] for b in bars]
    macd, _sig, _hist = indicator_compute.compute_macd(closes, fast, slow, signal)
    return _last_non_none(macd)


def _value_stoch(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    k_period = int(params.get("k_period", 14))
    d_period = int(params.get("d_period", 3))
    k, _d = indicator_compute.compute_stoch(bars, k_period, d_period)
    return _last_non_none(k)


def _value_williams_r(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 14))
    return _last_non_none(indicator_compute.compute_williams_r(bars, period))


def _value_cci(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 20))
    return _last_non_none(indicator_compute.compute_cci(bars, period))


def _value_mfi(bars: list[dict], params: dict) -> Optional[float]:
    from api.services import indicator_compute
    period = int(params.get("period", 14))
    return _last_non_none(indicator_compute.compute_mfi(bars, period))


def _value_price_vs_ma(bars: list[dict], params: dict) -> Optional[float]:
    """Return the spread (close − MA) for ``price_vs_ma`` alerts.

    Frontend stores this as a single alert where the user picks an MA type
    (sma/ema) and a period; we publish ``close − ma`` so the user can set
    a threshold of 0 for "price above/below MA" or a positive number for
    "price more than $X above MA".
    """
    from api.services import indicator_compute
    period = int(params.get("period", 50))
    ma_type = (params.get("type") or "sma").lower()
    closes = [b["c"] for b in bars]
    if not closes:
        return None
    if ma_type == "ema":
        ma_series = indicator_compute.compute_ema(closes, period)
    else:
        ma_series = indicator_compute.compute_sma(closes, period)
    last_ma = _last_non_none(ma_series)
    if last_ma is None:
        return None
    return float(closes[-1]) - last_ma


def _value_bb(bars: list[dict], params: dict) -> Optional[float]:
    """For BB alerts the ``current`` we return is the latest close; the
    caller looks up the appropriate band as the threshold (touch_upper /
    touch_lower) from the same compute pass.
    """
    if not bars:
        return None
    return float(bars[-1]["c"])


# indicator name → (callable that returns current value, callable that returns
# threshold override for touch_upper/touch_lower or None)
def _bb_threshold_override(bars: list[dict], params: dict, condition: str) -> Optional[float]:
    """For BB touch_upper/touch_lower: dynamic threshold = current band value."""
    if condition not in ("touch_upper", "touch_lower"):
        return None
    from api.services import indicator_compute
    period = int(params.get("period", 20))
    stddev = float(params.get("stddev", 2.0))
    closes = [b["c"] for b in bars]
    upper, _mid, lower = indicator_compute.compute_bb(closes, period, stddev)
    if condition == "touch_upper":
        return _last_non_none(upper)
    return _last_non_none(lower)


# Dispatch map: indicator → value function. The threshold override hook is
# applied only for BB; for everything else the user-supplied threshold from
# the alert row is used verbatim.
# ⚠️ INSERTION ORDER IS THE DROPDOWN'S ORDER since B4 Task 9, and it is pinned.
# These eight are re-ordered here to match the order the retired
# `IndicatorAlertPopover.INDICATORS` literal shipped, so collapsing the twin
# changes what a user sees by NOTHING. Dict order is irrelevant to the lookup
# this map exists for, so nothing else depends on it.
INDICATOR_FUNCS: dict[str, Callable[[list[dict], dict], Optional[float]]] = {
    "rsi": _value_rsi,
    "macd": _value_macd,
    "bb": _value_bb,
    "stoch": _value_stoch,
    "williams_r": _value_williams_r,
    "cci": _value_cci,
    "mfi": _value_mfi,
    "price_vs_ma": _value_price_vs_ma,
}


# ─── THE CATALOG — ONE AUTHORITY FOR "WHAT CAN BE ALERTED ON" ────────────────
#
# `IndicatorAlertPopover.jsx` used to hand-write INDICATORS (8 entries) and
# CONDITIONS (a per-indicator map). They were a TWIN of the dict above, and they
# already disagreed with reality: the create path validates nothing at any of its
# three layers — the router types `indicator` as a bare `str`, the service
# inserts it verbatim, the DDL is `TEXT NOT NULL` with no CHECK — so a `vwap`
# alert can be STORED and can never FIRE (`_evaluate_one` returns `(None, False)`
# on an `INDICATOR_FUNCS` miss), and no surface reported it.
#
# Deriving the dropdown from `INDICATOR_FUNCS` makes that OFFER unrepresentable.
# It deliberately does NOT validate the create path: an existing stored row keeps
# behaving exactly as it did (accepted, silently never firing), and closing that
# hole belongs to the rebuild below, not to a dropdown change.
#
# ⛔ SPEC §8 REBUILDS THIS EVALUATOR IN PHASE C (closed-bar evaluation, `prev`
# from the computed series, `last_value` demoted to delivery-dedup), and §9.5
# forbids an eager port of the remaining natives. So `INDICATOR_FUNCS` stays
# HAND-WRITTEN through B4 and its retirement is fated 'C' in the enumeration
# ledger. What B4 removes is its TWIN, not the list.
#
# ⚠️ AND THE FIRES THESE PRODUCE ARE NOT LEDGER-GRADE. This evaluator reads the
# FORMING bar with cycle-granularity crossings; nothing here may feed the
# Signature receipts ledger until the closed-bar rebuild lands.

_OSCILLATOR_CONDITIONS: list[dict] = [
    {"value": "above",       "label": "Above threshold", "needs_threshold": True},
    {"value": "below",       "label": "Below threshold", "needs_threshold": True},
    {"value": "cross_above", "label": "Crosses above",   "needs_threshold": True},
    {"value": "cross_below", "label": "Crosses below",   "needs_threshold": True},
]

# ⚠️ GROUPED BY SHAPE — the five oscillators that share one condition list, then
# the three that do not — which is DELIBERATELY NOT `INDICATOR_FUNCS`' order.
# That is what makes "which dict does `alert_catalog` iterate?" observable: the
# two have identical KEY SETS by assertion, so iterating the wrong one is an
# equivalent mutant on every set-based check and only the ORDER can see it.
ALERT_CONDITIONS: dict[str, list[dict]] = {
    "rsi": _OSCILLATOR_CONDITIONS,
    "stoch": _OSCILLATOR_CONDITIONS,
    "williams_r": _OSCILLATOR_CONDITIONS,
    "cci": _OSCILLATOR_CONDITIONS,
    "mfi": _OSCILLATOR_CONDITIONS,
    # 🔴 TWO DELIBERATE CORRECTIONS TO THE RETIRED FRONTEND LITERAL, BOTH MEASURED.
    #
    # 1. `needs_threshold` is TRUE for both crosses. The B4 brief specified False.
    #    It cannot be: `_value_macd` returns the MACD LINE, `_bb_threshold_override`
    #    is the only dynamic threshold in this module and it is `bb`-only, and
    #    `check_condition("cross_above", …)` returns False whenever `threshold is
    #    None`. A False here would offer an alert that can never fire — the exact
    #    `vwap` class this task exists to close, re-opened inside the fix.
    # 2. The LABEL says "level", not "signal". The retired popover collected a
    #    threshold for these two (its `THRESHOLD_CONDITIONS` was keyed on the
    #    CONDITION, not on indicator+condition), so the shipped behaviour has
    #    always been "MACD crosses the number you typed" while the shipped label
    #    said "signal". The naming authority may not carry that lie. Comparing
    #    against the signal LINE would need a macd threshold override, which is a
    #    change to the evaluation lane — spec §8's, in Phase C.
    "macd": [
        {"value": "cross_above", "label": "Crosses above level", "needs_threshold": True},
        {"value": "cross_below", "label": "Crosses below level", "needs_threshold": True},
        {"value": "cross_zero",  "label": "Crosses zero line",   "needs_threshold": False},
    ],
    "bb": [
        {"value": "touch_upper", "label": "Price touches upper band", "needs_threshold": False},
        {"value": "touch_lower", "label": "Price touches lower band", "needs_threshold": False},
    ],
    "price_vs_ma": [
        {"value": "above", "label": "Price above MA", "needs_threshold": True},
        {"value": "below", "label": "Price below MA", "needs_threshold": True},
    ],
}

# ⚠️ NOT DERIVED FROM THE JS CATALOG, ON PURPOSE. These are ALERT-LANE ids — the
# names of the compute functions above — not chart definition ids. `williams_r`
# is `williamsR` there, and `price_vs_ma` has no definition at ALL: it is a
# spread (close − MA) this module synthesises. Mapping one onto the other would
# be a lookup that lies for two of the eight.
ALERT_LABELS: dict[str, str] = {
    "rsi": "RSI",
    "macd": "MACD",
    "bb": "Bollinger Bands",
    "stoch": "Stochastic",
    "williams_r": "Williams %R",
    "cci": "CCI",
    "mfi": "MFI",
    "price_vs_ma": "Price vs MA",
}

_DEFAULT_THRESHOLDS: dict[str, float] = {
    "rsi": 70.0,
    "mfi": 70.0,
    "williams_r": -20.0,
    "cci": 100.0,
    "stoch": 80.0,
}


def alert_catalog() -> list[dict]:
    """What the alert dropdown may offer.

    Keyed off ``INDICATOR_FUNCS``, so an entry cannot exist for something that
    cannot be evaluated. Raises ``KeyError`` on a value function with no
    condition list — a ninth indicator has to fail HERE rather than render an
    empty second dropdown and an un-submittable form.
    """
    return [
        {
            "indicator": key,
            "label": ALERT_LABELS.get(key, key),
            # A COPY of the list: five keys share `_OSCILLATOR_CONDITIONS`, so a
            # consumer that mutated what it was handed would edit five entries.
            "conditions": list(ALERT_CONDITIONS[key]),
            "default_threshold": _DEFAULT_THRESHOLDS.get(key),
        }
        for key in INDICATOR_FUNCS
    ]


# ─── bar fetch ───────────────────────────────────────────────────────────────

def _fetch_bars_for_alert(sym: str, tf: str, count: int = 200) -> list[dict]:
    """Return the latest ``count`` bars for (sym, tf) from the SQLite store.

    Bars come as dicts with keys ``h``, ``l``, ``c``, ``v`` so they plug
    directly into ``indicator_compute``. We read from the persistent store
    (not the HTTP endpoint) to avoid a round-trip and to keep the loop
    isolated from web-layer concerns.

    Empty list is returned (and silently absorbed by the caller) when the
    store has no rows for the (sym, tf) — typical for a fresh deploy or a
    ticker that nobody has yet requested.
    """
    try:
        from api.services import bars_sqlite as _sqlite
        rows = _sqlite.get_bars(sym.upper(), tf, int(count))
    except Exception:
        _logger.exception("[alert-eval] bars_sqlite.get_bars failed for %s/%s", sym, tf)
        return []
    bars: list[dict] = []
    for r in rows:
        # rows are (ts, o, h, l, c, v)
        try:
            bars.append({
                "t": r[0],
                "o": float(r[1]) if r[1] is not None else 0.0,
                "h": float(r[2]) if r[2] is not None else 0.0,
                "l": float(r[3]) if r[3] is not None else 0.0,
                "c": float(r[4]) if r[4] is not None else 0.0,
                "v": int(r[5]) if r[5] is not None else 0,
            })
        except Exception:
            continue
    return bars


# ─── per-alert evaluation ────────────────────────────────────────────────────

def _parse_params(alert: dict) -> dict:
    """Best-effort decode of the alert's ``params_json`` blob → dict.

    The CRUD service stores params as a JSON string; legacy / future rows
    may also pass it through as a real dict. Either way we return a dict
    that the indicator funcs can ``.get(...)`` on safely.
    """
    raw = alert.get("params_json")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        import json
        return json.loads(raw)
    except Exception:
        return {}


def _evaluate_one(alert: dict, bars: Optional[list[dict]] = None) -> tuple[Optional[float], bool]:
    """Compute the indicator value for one alert and return (value, triggered).

    ``bars`` may be passed in pre-fetched (so a (sym, tf) group of alerts
    shares the same fetch); if None we fetch them ourselves. We need at
    least a handful of bars to compute most indicators — the indicator
    funcs themselves return None for short inputs, in which case we report
    (None, False) so the cycle records nothing and moves on.
    """
    indicator = (alert.get("indicator") or "").lower()
    fn = INDICATOR_FUNCS.get(indicator)
    if fn is None:
        return None, False

    if bars is None:
        bars = _fetch_bars_for_alert(alert["sym"], alert["tf"], 200)
    if not bars:
        return None, False

    params = _parse_params(alert)
    try:
        value = fn(bars, params)
    except Exception:
        _logger.exception(
            "[alert-eval] compute failed for alert %s (%s/%s/%s)",
            alert.get("id"), alert.get("sym"), indicator, alert.get("tf"),
        )
        return None, False

    if value is None:
        return None, False

    condition = alert.get("condition") or ""
    threshold = alert.get("threshold")

    # BB touch conditions: the threshold is dynamic (current upper/lower band).
    if indicator == "bb":
        dyn = _bb_threshold_override(bars, params, condition)
        if dyn is not None:
            threshold = dyn

    prev_value = alert.get("last_value")
    triggered = check_condition(condition, value, prev_value, threshold)
    return value, triggered


# ─── cycle + delivery ────────────────────────────────────────────────────────

def _dispatch_delivery(alert: dict, value: float) -> None:
    """Send the alert through the multi-channel watchlist delivery hook.

    Uses ``watchlist_alert_service.deliver_alert_payload`` — exposed as a
    public function alongside the original watchlist-price delivery so
    indicator alerts reuse the identical AlertBell + email + Discord
    pipeline without re-implementing any of the channel-specific code.
    """
    try:
        from api.services import watchlist_alert_service as wls
        sym = alert.get("sym", "")
        indicator = (alert.get("indicator") or "").upper()
        condition = (alert.get("condition") or "").replace("_", " ")
        threshold = alert.get("threshold")
        thr_str = f"{threshold:.2f}" if isinstance(threshold, (int, float)) else "—"
        val_str = f"{value:.2f}" if isinstance(value, (int, float)) else str(value)
        title = f"{sym} {indicator} alert"
        message = (
            f"{sym} {indicator} {condition} {thr_str} (now: {val_str}) on {alert.get('tf', '')}"
        )
        wls.deliver_alert_payload(
            user_id=alert["user_id"],
            sym=sym,
            title=title,
            message=message,
            source="indicator_alert",
            extra_data={
                "indicator": alert.get("indicator"),
                "condition": alert.get("condition"),
                "threshold": threshold,
                "value": value,
                "tf": alert.get("tf"),
                "alert_id": alert.get("id"),
            },
        )
    except Exception:
        _logger.exception("[alert-eval] dispatch failed for alert %s", alert.get("id"))


def _run_one_cycle() -> dict[str, Any]:
    """One pass: evaluate every active alert, record + dispatch as needed.

    Returns a small summary dict (counts) useful for tests and ad-hoc
    debugging via the evaluator's REPL.
    """
    summary = {"considered": 0, "evaluated": 0, "triggered": 0, "errors": 0}
    try:
        from api.services import indicator_alert_service as ias
        alerts = ias.list_active()
    except Exception:
        _logger.exception("[alert-eval] failed to list active alerts")
        summary["errors"] += 1
        return summary

    summary["considered"] = len(alerts)
    if not alerts:
        return summary

    # Group by (sym, tf) so we fetch bars once per group, then evaluate each
    # alert in the group against the same series.
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for a in alerts:
        groups[(a["sym"], a["tf"])].append(a)

    from api.services import indicator_alert_service as ias

    for (sym, tf), alerts_in_group in groups.items():
        try:
            bars = _fetch_bars_for_alert(sym, tf, 200)
        except Exception:
            _logger.exception("[alert-eval] fetch failed for %s/%s", sym, tf)
            summary["errors"] += 1
            continue

        for alert in alerts_in_group:
            try:
                value, triggered = _evaluate_one(alert, bars=bars)
                if value is None:
                    continue
                summary["evaluated"] += 1
                if triggered:
                    summary["triggered"] += 1
                    ias.record_trigger(alert["id"], last_value=value)
                    _dispatch_delivery(alert, value)
                else:
                    ias.record_evaluation(alert["id"], last_value=value)
            except Exception:
                _logger.exception(
                    "[alert-eval] eval failed for alert %s", alert.get("id"),
                )
                summary["errors"] += 1
    return summary


# ─── background thread ───────────────────────────────────────────────────────

def start_evaluator(interval_sec: int = 60) -> None:
    """Start the background evaluator thread.

    Idempotent: a second call while the thread is already running is a
    no-op. The thread polls ``_running`` every second so ``stop_evaluator``
    returns quickly even if the configured interval is long.
    """
    global _thread
    if _running.is_set():
        return
    _running.set()

    def _loop() -> None:
        while _running.is_set():
            try:
                _run_one_cycle()
            except Exception:
                _logger.exception("[alert-eval] cycle failed")
            # Sleep in 1-second slices so stop_evaluator wakes us promptly.
            for _ in range(max(1, int(interval_sec))):
                if not _running.is_set():
                    return
                time.sleep(1)

    _thread = threading.Thread(target=_loop, daemon=True, name="indicator-alert-eval")
    _thread.start()


def stop_evaluator() -> None:
    """Signal the background thread to exit at its next 1-second check."""
    _running.clear()


def is_running() -> bool:
    """Test helper: ``True`` if the evaluator thread is currently active."""
    return _running.is_set()
