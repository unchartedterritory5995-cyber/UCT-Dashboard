"""Pure validation rules for OHLCV bars. No I/O.

Used at every cache write path and by the audit engine.

⭐ TWO LAYERS, AND THEY ANSWER DIFFERENT QUESTIONS.
``possible_bar_reasons`` asks *"could this bar have happened?"* — finite numbers,
positive prices, ``l <= min(o,c) <= max(o,c) <= h``, non-negative volume. Those
are FACTS about what a bar IS, so violating one is never a judgement call and the
row is never storable. ``validate_bar`` adds PLAUSIBILITY on top — the wide-bar
gate, the prior-close deviation, the low-volume combo — which are heuristics with
thresholds, correct to apply at a cache boundary and wrong to apply at a store
write, where they would reject a genuinely violent session.

🔴 THE SPLIT MATTERS BECAUSE THE GEOMETRY WAS ENFORCED NOWHERE ON THE DAILY
WRITE PATH. `validate_bar` already encoded every rule needed to stop the 3,533
impossible daily bars the 2026-08-09 audit found — and its three callers are
`fetch_with_validation` (INTRADAY only), the disk serving cache, and two
read-only auditors. `bars_sqlite.put_bars` validated nothing. That asymmetry is
the entire explanation for *"intraday zero violations, daily 3,533"*.
"""
import math
from typing import Optional


# Threshold for "extreme" price deviation that requires split context to accept.
_DEVIATION_THRESHOLD = 0.5
# Tolerance band around split-adjusted price.
_SPLIT_TOLERANCE = 0.05
# Volume floor — below this with a big price move is suspicious for any liquid ticker.
_LOW_VOLUME_THRESHOLD = 1000
# Wide-bar gate: H-L > 30% of C is suspicious for liquid tickers.
_WIDE_BAR_THRESHOLD = 0.3  # H-L > 30% of C is suspicious for liquid tickers


def possible_bar_reasons(bar: dict) -> list[str]:
    """Why this dict does NOT describe a bar that could have happened. ``[]`` = it does.

    ⛔ THE `isfinite` CHECK IS NOT DEFENSIVE PADDING — IT IS ONE OF THE MEASURED
    DEFECTS. `_fetch_daily_yf` does `round(float(row["Close"]), 2)` inside a
    `try/except … continue` that only catches a RAISE, so a NaN close sails
    through; SQLite then stores a NaN REAL as **NULL**, after which a provider's
    NaN and a genuinely absent session are byte-identical forever. 119 daily rows
    in the store carry a NULL close beside a real open, high, low and 20 M shares
    of volume. Every `<` comparison against a NaN is False, so the geometric
    rules below cannot see it — finiteness has to be asked first, separately.

    ⛔ AND A ZERO PRICE IS A SENTINEL, NOT A PRICE. 3,317 of the 3,533 impossible
    daily rows are one closed-end fund whose vendor returns `Open: 0.0` for
    history it does not have. `0.0` is outside every `[l, h]` by construction,
    which is how a missing value became an impossible bar.
    """
    reasons: list[str] = []
    for k in ("t", "o", "h", "l", "c", "v"):
        if bar.get(k) is None:
            reasons.append(f"missing field: {k}")
    if reasons:
        return reasons

    prices = {}
    for k in ("o", "h", "l", "c"):
        try:
            f = float(bar[k])
        except (TypeError, ValueError):
            reasons.append(f"non-numeric price: {k}")
            continue
        if not math.isfinite(f):
            reasons.append(f"non-finite price: {k}")
            continue
        prices[k] = f
    try:
        v = float(bar["v"])
        if not math.isfinite(v):
            reasons.append("non-finite volume")
    except (TypeError, ValueError):
        reasons.append("non-numeric volume")
        v = None
    if reasons:
        return reasons          # arithmetic below is meaningless without numbers

    o, h, l, c = prices["o"], prices["h"], prices["l"], prices["c"]
    if o <= 0 or h <= 0 or l <= 0 or c <= 0:
        reasons.append("zero or negative price")
    if h < l:
        reasons.append("H<L")
    if h < o:
        reasons.append("H<O")
    if h < c:
        reasons.append("H<C")
    if l > o:
        reasons.append("L>O")
    if l > c:
        reasons.append("L>C")
    if v is not None and v < 0:
        reasons.append("negative volume")
    return reasons


def describes_a_possible_bar(bar: dict) -> bool:
    """``True`` when nothing about this bar is impossible. See
    ``possible_bar_reasons``, which is the single authority and the only place
    the rules are written down."""
    return not possible_bar_reasons(bar)


def validate_bar(
    bar: dict,
    prior_close: Optional[float] = None,
    split_ratios: Optional[list[float]] = None,
    wide_bar_threshold: Optional[float] = None,
    low_volume_threshold: Optional[int] = None,
) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons).

    Args:
        bar: dict with keys t, o, h, l, c, v.
        prior_close: optional prior bar's close for deviation/low-volume gates.
        split_ratios: optional list of split ratios (e.g. [10.0]) to permit
            split-adjusted price deviations.
        wide_bar_threshold: override for the wide-bar (H-L)/C ratio gate.
            Defaults to ``_WIDE_BAR_THRESHOLD`` (0.30 = 30%). Pass ``0`` to
            disable the gate entirely.
        low_volume_threshold: override for the volume floor used in the
            low-volume + big-move combo check. Defaults to
            ``_LOW_VOLUME_THRESHOLD`` (1000). Plan 2 Task 2 will plug per-ticker
            baselines through this knob.
    """
    # ⭐ THE GEOMETRY IS NOT RE-WRITTEN HERE. One authority for "is this a bar",
    # consulted by both this function and `bars_sqlite.put_bars`; a second copy of
    # `h < l` is how a store write and a cache write come to disagree about what
    # is storable.
    reasons: list[str] = possible_bar_reasons(bar)
    if any(r.startswith(("missing field", "non-numeric", "non-finite"))
           for r in reasons):
        return False, reasons

    o = bar.get("o")
    h = bar.get("h")
    l = bar.get("l")
    c = bar.get("c")
    v = bar.get("v")

    # Wide-bar gate (range relative to close)
    threshold = _WIDE_BAR_THRESHOLD if wide_bar_threshold is None else wide_bar_threshold
    if threshold > 0 and c is not None and c > 0:
        ratio = (h - l) / c
        if ratio > threshold:
            reasons.append(f"wide-bar range: (h-l)/c = {ratio*100:.1f}% > {threshold*100:.0f}%")

    # Prior-close sanity (only when we have prior context)
    if prior_close is not None and prior_close > 0:
        deviation = abs(o - prior_close) / prior_close
        if deviation > _DEVIATION_THRESHOLD:
            split_ok = False
            for ratio in split_ratios or []:
                adjusted = prior_close / ratio
                if abs(o - adjusted) / adjusted <= _SPLIT_TOLERANCE:
                    split_ok = True
                    break
                # Reverse split
                adjusted = prior_close * ratio
                if abs(o - adjusted) / adjusted <= _SPLIT_TOLERANCE:
                    split_ok = True
                    break
            if not split_ok:
                reasons.append(
                    f"deviation from prior close: {deviation*100:.1f}% "
                    f"(open={o}, prior_close={prior_close})"
                )

        # Low-volume + big-move combo (the QQQ 6.55 fingerprint)
        low_threshold = _LOW_VOLUME_THRESHOLD if low_volume_threshold is None else low_volume_threshold
        if v < low_threshold and deviation > 0.05:
            reasons.append(
                f"implausibly low volume ({v}) with {deviation*100:.1f}% move"
            )

    return (len(reasons) == 0), reasons


# Expected seconds-between-bars per intraday TF
_TF_INTERVAL = {
    "1": 60,
    "5": 300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}


def validate_series(bars: list[dict], tf: str) -> list[dict]:
    """Series-level checks. Returns list of issue dicts: {bar_index, reason, bar_time}."""
    issues: list[dict] = []
    if not bars:
        return issues

    seen_ts = set()
    prev_ts = None
    interval = _TF_INTERVAL.get(tf)

    for i, bar in enumerate(bars):
        ts = bar.get("t")
        if ts is None:
            issues.append({"bar_index": i, "reason": "missing timestamp", "bar_time": None})
            continue
        if ts in seen_ts:
            issues.append({"bar_index": i, "reason": "duplicate timestamp", "bar_time": ts})
        seen_ts.add(ts)
        if prev_ts is not None:
            if ts < prev_ts:
                issues.append({"bar_index": i, "reason": "out of order", "bar_time": ts})
            elif interval is not None:
                # Gap detection — only meaningful for intraday during RTH
                gap = ts - prev_ts
                if gap > interval * 5:
                    issues.append({
                        "bar_index": i,
                        "reason": f"gap {gap}s exceeds 5x expected {interval}s",
                        "bar_time": ts,
                    })
        prev_ts = ts

    return issues
