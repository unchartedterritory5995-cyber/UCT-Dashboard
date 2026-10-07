"""THE DERIVATION LAYER — canonical breadth history in, market indicators out.

⭐⭐ ONE FORWARD PASS OVER THE WHOLE HISTORY, EVERY TIME. Nothing here stores partial
state between runs, and that is a correctness decision rather than a performance
oversight: a cumulative series whose level depends on how often the job happened to run
is not reproducible, and `US:MCS` and `US:AD` are both cumulative. Recomputing 4,708
sessions of four series costs milliseconds; getting a different answer on Tuesday than
on Monday costs the series' meaning.

⛔⛔ THIS MODULE IS READ-ONLY WITH RESPECT TO BREADTH. It calls
`breadth_daily_ohlc.history()` and nothing else. It does not write a breadth row, does
not touch `breadth_snapshots`, does not import the combined pass, and cannot reach
Breadth V2's artifact. The architecture is deliberately one-directional:

    BREADTH V2 → CANONICAL FINALISED BREADTH HISTORY → MARKET INDICATOR DERIVATION

⚠️ AND IT CONSUMES ONLY *TRUSTED* ROWS, because `history()` filters to them: live,
intraday_recon and close_recon. A 'reconstruct' row (daily-bar-estimated wicks, known
to be far too wide) is excluded by that reader, so nothing here has to know about it.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Optional

from api.services.market_indicators import mcclellan as mc

_log = logging.getLogger("market_indicators.producers")

#: Zweig's smoother. His rule is a 10-day EMA of the advance ratio.
ZWEIG_ALPHA = 2.0 / (10 + 1)
ZWEIG_WASHOUT = 0.40
ZWEIG_THRUST = 0.615
ZWEIG_WINDOW = 10

#: How far back a derivation reads. The US universe holds ~4,708 sessions; this is
#: comfortably above it so "the whole history" really is the whole history, and it is a
#: bound rather than a page size — a runaway store cannot make one request unbounded.
MAX_SESSIONS = 20000


@dataclass
class DerivedSeries:
    """A produced series plus everything needed to explain or re-derive it."""
    series_id: str
    dates: list[str]
    values: list[Optional[float]]
    universe: str
    methodology_version: str
    #: Extra columns a diagnostic surface wants (EMAs, the normalised input, …). Never
    #: served to a chart — the chart gets `values`.
    detail: dict = None
    epoch: Optional[str] = None
    base: Optional[float] = None

    def as_points(self) -> list[dict]:
        """`[{t, v}]` for the finite values only. A hole stays a hole."""
        out = []
        for d, v in zip(self.dates, self.values):
            if v is None or not math.isfinite(v):
                continue
            out.append({"t": d, "v": float(v)})
        return out


# ── Reading the canonical breadth store ──────────────────────────────────────

def load_metric_closes(metric: str, universe: str,
                       limit: int = MAX_SESSIONS) -> tuple[list[str], list[Optional[float]]]:
    """`(dates ASC, closes)` for one breadth metric over one universe. READ-ONLY.

    ⚠️ `history()` RETURNS NEWEST-FIRST AND UNSORTED AS A DICT, so the ascending sort is
    not cosmetic — an EMA fed in the wrong order is silently, plausibly wrong.
    """
    from api.services import breadth_daily_ohlc as store
    rows = store.history(metric, limit=limit, universe=universe) or {}
    dates = sorted(rows.keys())
    return dates, [rows[d].get("c") for d in dates]


def load_pair(metric_a: str, metric_b: str, universe: str,
              limit: int = MAX_SESSIONS) -> tuple[list[str], list[Optional[float]], list[Optional[float]]]:
    """Two metrics aligned onto the UNION of their session dates.

    ⛔ THE UNION, NOT ONE METRIC'S DATES. If `advancing` has a session `declining` does
    not, the ratio is not computable there — but the SESSION still happened, and
    dropping it would silently compress the calendar and shift every later EMA by one
    bar. The value becomes `None` and the engine treats it as a hole, which is what a
    hole is.
    """
    from api.services import breadth_daily_ohlc as store
    a = store.history(metric_a, limit=limit, universe=universe) or {}
    b = store.history(metric_b, limit=limit, universe=universe) or {}
    dates = sorted(set(a) | set(b))
    return (dates,
            [(a.get(d) or {}).get("c") for d in dates],
            [(b.get(d) or {}).get("c") for d in dates])


#: Exchange Breadth V1 universes. ⛔ ONE AUTHORITY: their AD / MCO / MCS are NOT recomputed here — they are
#: read verbatim from `breadth_exchange_authority` (frozen derived artifact + the accepted live append),
#: so a chart can never show a value the authority does not hold. MCO/MCS are absent inside the burn-in.
EXCHANGE_UNIVERSES = ("nyse", "nasdaq")


def _exchange_series(sid: str, row) -> Optional["DerivedSeries"]:
    from api.services import breadth_exchange_authority as ea
    vals = ea.derived(sid)
    if not vals:
        return None
    dates = sorted(vals)
    kind = sid.split(":", 1)[1]
    return DerivedSeries(series_id=sid, dates=dates, values=[vals[d] for d in dates], universe=row.universe,
                         methodology_version=row.methodology_version,
                         detail={"authority": "breadth_exchange_authority", "token": ea.token()},
                         epoch=ea.MCO_FIRST[row.universe] if kind == "MCS" else None,
                         base=0.0 if kind == "MCS" else None)

# ── McClellan ────────────────────────────────────────────────────────────────

def mcclellan_for_universe(universe: str,
                           method: mc.Methodology = mc.RATIO_ADJUSTED,
                           anchor: Optional[mc.Anchor] = None,
                           want_summation: bool = False) -> Optional[mc.McClellanResult]:
    """The generic entry point. ONE engine, any universe.

    ⭐ `universe` IS THE ONLY THING THAT CHANGES between US, NYSE, NASDAQ and UCT. That
    is the whole reason NYMO is a data unlock rather than a second project: when Breadth
    V2 populates `nyse`, this function already produces it.

    Returns `None` when the universe has no advance/decline history — an honest
    "cannot", never an empty series that reads as a quiet market.
    """
    dates, adv, dec = load_pair("advancing", "declining", universe)
    if not dates:
        return None
    if anchor is None and want_summation:
        anchor = derive_summation_anchor(dates, adv, dec, method)
        if anchor is None:
            return None
    if anchor is not None and anchor.at not in set(dates):
        # ⛔⛔ A PINNED EPOCH THAT IS NOT IN THE DATA IS A REFUSAL. Falling back to a
        # derived one would re-level the whole series the moment the source changed
        # shape — which is the exact drift pinning exists to prevent — and would do it
        # silently, because the curve would still look right.
        _log.error("market indicators: summation anchor %s is not a session in "
                   "universe %s (%d sessions, %s..%s) — refusing to re-derive",
                   anchor.at, universe, len(dates), dates[0], dates[-1])
        return None
    return mc.compute(dates, adv, dec, method=method, anchor=anchor)


def derive_summation_anchor(dates, adv, dec,
                            method: mc.Methodology = mc.RATIO_ADJUSTED) -> Optional[mc.Anchor]:
    """THE ANCHOR DECISION, in code.

    ⛔⛔ WHY A *DECLARED* ANCHOR AND NOT A REFERENCE ONE, FOR THE US UNIVERSE. A
    reference anchor is better — it makes the LEVEL comparable to a published series
    rather than merely self-consistent — but it requires a publisher who computes the
    same indicator over the same population. Nobody publishes a McClellan Summation
    Index over "US common stock", so there is no value to anchor to. Inventing one from
    a NYSE series would be exactly the "call a different calculation by a famous
    indicator's name" failure this project forbids.

    So the strategy is EPOCH + BASE:

      epoch  the first session on which `burn_in` real observations already precede it,
             so the oscillator being accumulated is trustworthy rather than an artifact
             of the EMA seed.
      base   the variant's neutral level (0 for ratio-adjusted, +1000 for classic).

    ⭐ THAT MAKES THE SERIES DETERMINISTIC AND HONEST: the same inputs always produce
    the same level, the level means "distance from neutral since the epoch", and the
    epoch is carried in the series metadata rather than implied. It does NOT make the
    level comparable to NYSI, and the registry says so in words.

    ⚠️ When a reference DOES exist — NYSE and Nasdaq, whose values McClellan publish
    daily — pass `mc.Anchor(..., source="reference:mcclellan")` instead and the burn-in
    gate steps aside, because a published level corrects the seed rather than
    inheriting it.
    """
    norm = [mc.normalise(adv[i], dec[i], 0.0, method) for i in range(len(dates))]
    osc, _ = mc.oscillator_series(norm)
    idx = mc.first_trustworthy_index(osc, method)
    if idx is None:
        return None
    return mc.Anchor(at=dates[idx], value=method.summation_base, source="declared")


# ── Advance/Decline Line ─────────────────────────────────────────────────────

def ad_line_for_universe(universe: str, base: float = 0.0) -> Optional[DerivedSeries]:
    """Cumulative net advances, in ONE forward pass from the first session.

    ⛔⛔ THIS IS THE FUNCTION THE BREADTH ENGINE DELIBERATELY REFUSES TO BE.
    `breadth_metrics.PIT_UNPRODUCIBLE` lists `adv_decline_cum` because the PIT grind
    walks BACKWARD in chunks, so each chunk would start its own accumulation and the
    line would step at every chunk boundary. A downstream single forward pass over the
    finished history is the correct home for it, and this is that pass.

    ⚠️ THE ORIGIN IS ARBITRARY AND IS DECLARED, NOT HIDDEN. Every published A/D line
    differs in absolute level while agreeing in shape; starting at 0 on the first
    session and carrying the epoch in metadata is the honest version of that.
    """
    dates, net = load_metric_closes("adv_decline", universe)
    if not dates:
        return None
    out: list[Optional[float]] = []
    level = float(base)
    started = False
    for v in net:
        if v is None or not math.isfinite(v):
            # A hole holds the level: the cumulative total does not cease to exist
            # because one session could not be measured.
            out.append(level if started else None)
            continue
        level += float(v)
        started = True
        out.append(level)
    return DerivedSeries(
        series_id="AD", dates=dates, values=out, universe=universe,
        methodology_version="adline-v1", epoch=dates[0], base=float(base))


# ── Zweig Breadth Thrust ─────────────────────────────────────────────────────

def zweig_for_universe(universe: str) -> Optional[DerivedSeries]:
    """The CONTINUOUS series: a 10-day EMA of advances / (advances + declines).

    ⛔ THE THRUST EVENT IS NOT THIS SERIES. Zweig's signal is a move from below 0.40 to
    above 0.615 inside 10 trading sessions, and it has fired roughly 13 times since
    1944. A chart of the events would be empty for years; a chart of the ratio is
    readable every day and the event is a marker on top of it. `thrust_events()` below
    computes those separately, exactly so the two never get conflated.

    ⚠️ Unchanged issues are excluded from the denominator, matching the McClellan
    convention this codebase already applies to the ratio adjustment.
    """
    dates, adv, dec = load_pair("advancing", "declining", universe)
    if not dates:
        return None
    ema: Optional[float] = None
    out: list[Optional[float]] = []
    for i in range(len(dates)):
        a, d = adv[i], dec[i]
        if a is None or d is None:
            out.append(None)
            continue
        total = float(a) + float(d)
        if total <= 0:
            out.append(None)
            continue
        ratio = float(a) / total
        ema = ratio if ema is None else (1.0 - ZWEIG_ALPHA) * ema + ZWEIG_ALPHA * ratio
        out.append(ema)
    return DerivedSeries(series_id="ZBT", dates=dates, values=out, universe=universe,
                         methodology_version="zweig-v1")


def thrust_events(dates, values,
                  washout: float = ZWEIG_WASHOUT, thrust: float = ZWEIG_THRUST,
                  window: int = ZWEIG_WINDOW) -> list[dict]:
    """Sessions on which the classic Zweig Breadth Thrust completed.

    Both legs matter: the series must have been BELOW `washout` and then reach ABOVE
    `thrust` within `window` trading sessions. A slow climb through the same levels does
    not qualify, which is why this tracks the index of the last washout rather than
    simply testing the level.
    """
    out = []
    last_washout = None
    for i, v in enumerate(values):
        if v is None:
            continue
        if v < washout:
            last_washout = i
        elif v > thrust and last_washout is not None and (i - last_washout) <= window:
            out.append({"t": dates[i], "from_t": dates[last_washout],
                        "sessions": i - last_washout, "value": v})
            last_washout = None
    return out


# ── Derived breadth ratios (registry `_RATIO_KINDS`) ─────────────────────────
#
# ⛔⛔ A ZERO DENOMINATOR IS A HOLE (None), NEVER A ZERO — see the registry note. And the
# session calendar is the UNION of the inputs' dates (`load_pair`), so one missing input
# leaves a gap rather than compressing the calendar.

#: The High-Low Index window (StockCharts: a 10-day SMA of Record High Percent).
HLI_WINDOW = 10


def _safe_div(num, den) -> Optional[float]:
    if num is None or den is None:
        return None
    try:
        n, d = float(num), float(den)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(n) and math.isfinite(d)) or d == 0:
        return None
    return n / d


def ad_ratio_values(adv, dec) -> list[Optional[float]]:
    """Advancing ÷ declining per session; None where declining is 0 or either input is missing."""
    return [_safe_div(a, d) for a, d in zip(adv, dec)]


def ad_percent_values(adv, dec) -> list[Optional[float]]:
    """(A − D) ÷ (A + D) × 100 per session; None where A + D is 0 or an input is missing."""
    out = []
    for a, d in zip(adv, dec):
        if a is None or d is None:
            out.append(None)
            continue
        v = _safe_div(float(a) - float(d), float(a) + float(d))
        out.append(None if v is None else v * 100.0)
    return out


def record_high_percent_values(highs, lows) -> list[Optional[float]]:
    """NH ÷ (NH + NL) × 100 per session; None where NH + NL is 0 or an input is missing."""
    out = []
    for h, l in zip(highs, lows):
        if h is None or l is None:
            out.append(None)
            continue
        v = _safe_div(float(h), float(h) + float(l))
        out.append(None if v is None else v * 100.0)
    return out


def high_low_index_values(rhp, window: int = HLI_WINDOW) -> list[Optional[float]]:
    """A `window`-session SMA of Record High Percent. ⛔ Defined only when ALL `window` sessions
    in the window are defined: an average over fewer would silently change the indicator's
    span, and a member could not tell from the curve."""
    out: list[Optional[float]] = []
    for i in range(len(rhp)):
        if i + 1 < window:
            out.append(None)
            continue
        win = rhp[i + 1 - window:i + 1]
        if any(v is None or not math.isfinite(v) for v in win):
            out.append(None)
            continue
        out.append(sum(win) / window)
    return out


def ratio_for_universe(universe: str, kind: str) -> Optional[DerivedSeries]:
    """One derived ratio series for one universe, or None when its inputs have no history.
    READ-ONLY: `load_pair` / `load_metric_closes` → `breadth_daily_ohlc.history()`."""
    if kind in ("ADR", "ADP"):
        dates, adv, dec = load_pair("advancing", "declining", universe)
        if not dates:
            return None
        vals = ad_ratio_values(adv, dec) if kind == "ADR" else ad_percent_values(adv, dec)
    elif kind in ("RHP", "HLI"):
        dates, hi, lo = load_pair("new_52w_highs", "new_52w_lows", universe)
        if not dates:
            return None
        vals = record_high_percent_values(hi, lo)
        if kind == "HLI":
            vals = high_low_index_values(vals)
    elif kind == "UNCH":
        dates, vals = load_metric_closes("unchanged", universe)
        if not dates:
            return None
    else:
        return None
    return DerivedSeries(series_id=kind, dates=dates, values=vals, universe=universe,
                         methodology_version=f"breadth-ratio-v1/{kind.lower()}")


# ── The cached build ─────────────────────────────────────────────────────────
#
# ⚠️ A PROCESS-LOCAL CACHE WITH A TTL, and it is a cache rather than state: dropping it
# changes nothing about the answer. That is the property that makes the "one forward
# pass" rule safe to combine with serving on a request path.

_CACHE_TTL = 900
_cache: dict = {}
_cache_lock = threading.Lock()


def _cached(key: str, build):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] <= _CACHE_TTL:
            return hit[1]
    value = build()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def invalidate(key: Optional[str] = None) -> None:
    with _cache_lock:
        if key is None:
            _cache.clear()
        else:
            _cache.pop(key, None)


def build(series_id: str):
    """`registry` id → `DerivedSeries`, or None. The one door the serving layer uses."""
    sid = (series_id or "").strip().upper()
    return _cached(f"derived::{sid}{_authority_suffix()}", lambda: _build_uncached(sid))


def _authority_suffix() -> str:
    """'' under V1 (keys unchanged); the Breadth authority token when V2 owns a universe, so a
    switch or a rollback can never serve an indicator built under the other authority."""
    try:
        from api.services import breadth_authority as ba
        t = ba.token()
        return "" if t == "v1" else "::" + t
    except Exception:
        return ""


def _build_uncached(sid: str) -> Optional[DerivedSeries]:
    from api.services.market_indicators import registry as reg
    row = reg.get(sid)
    if row is None or row.universe is None:
        return None
    uni = row.universe
    # ⭐ The derived ratios are computed the same way for every universe: the exchange
    # authority answers `history()` for nyse/nasdaq (fail-closed), so no branch is needed.
    kind = sid.split(":", 1)[1] if ":" in sid else sid
    if kind in reg.RATIO_KINDS:
        ds = ratio_for_universe(uni, kind)
        if ds:
            ds.series_id = sid
        return ds
    if uni in EXCHANGE_UNIVERSES:
        return _exchange_series(sid, row)

    if sid.endswith(":MCO"):
        res = mcclellan_for_universe(uni)
        if res is None:
            return None
        osc = res.oscillator
        return DerivedSeries(series_id=sid, dates=res.dates, values=osc,
                             universe=uni, methodology_version=row.methodology_version,
                             detail={"ema19": res.ema19, "ema39": res.ema39,
                                     "normalised": res.normalised})
    if sid.endswith(":MCS"):
        # ⛔⛔ THE PINNED ANCHOR IS THE DEFINITION OF THIS SERIES' LEVEL, and it is read
        # from the registry rather than re-derived. Deriving it per build is
        # deterministic only while the dataset's start date never moves; a backfill
        # that adds earlier sessions would shift the epoch and silently re-level every
        # historical value. Pinning makes the level a property of the DEFINITION.
        anchor = None
        if row.summation_epoch is not None and row.summation_base is not None:
            anchor = mc.Anchor(at=row.summation_epoch, value=float(row.summation_base),
                               source=row.summation_anchor_source or "declared")
        res = mcclellan_for_universe(uni, anchor=anchor,
                                     want_summation=anchor is None)
        if res is None or res.anchor is None:
            return None
        return DerivedSeries(series_id=sid, dates=res.dates, values=res.summation,
                             universe=uni, methodology_version=row.methodology_version,
                             detail={"oscillator": res.oscillator},
                             epoch=res.anchor.at, base=res.anchor.value)
    if sid.endswith(":AD"):
        ds = ad_line_for_universe(uni)
        if ds:
            ds.series_id = sid
        return ds
    if sid.endswith(":ZBT"):
        ds = zweig_for_universe(uni)
        if ds:
            ds.series_id = sid
        return ds
    return None
