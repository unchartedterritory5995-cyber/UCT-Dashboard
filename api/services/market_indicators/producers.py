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
    return _cached(f"derived::{sid}", lambda: _build_uncached(sid))


def _build_uncached(sid: str) -> Optional[DerivedSeries]:
    from api.services.market_indicators import registry as reg
    row = reg.get(sid)
    if row is None or row.universe is None:
        return None
    uni = row.universe

    if sid.endswith(":MCO"):
        res = mcclellan_for_universe(uni)
        if res is None:
            return None
        return DerivedSeries(series_id=sid, dates=res.dates, values=res.oscillator,
                             universe=uni, methodology_version=row.methodology_version,
                             detail={"ema19": res.ema19, "ema39": res.ema39,
                                     "normalised": res.normalised})
    if sid.endswith(":MCS"):
        res = mcclellan_for_universe(uni, want_summation=True)
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
