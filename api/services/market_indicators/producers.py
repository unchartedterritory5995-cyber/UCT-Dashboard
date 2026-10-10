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
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

from api.services.market_indicators import mcclellan as mc

import contextvars

#: ⭐ (2026-10-08) LIVE / PROVISIONAL INPUT ROWS. `{universe: {metric: {date: value}}}` set by
#: `build_with_overlay` for the duration of one derivation: the two store readers below append
#: these dates AFTER the canonical ones, so every derived series (McClellan, A/D, ratios, HLI,
#: Zweig) extends through the provisional and live sessions with the SAME formulas — no second
#: implementation. ⛔ Never set on the cached path (`build`): the cache holds canonical only.
_INPUT_OVERLAY: contextvars.ContextVar = contextvars.ContextVar("mi_input_overlay", default=None)


def _overlay(universe: str, metric: str) -> dict:
    ov = _INPUT_OVERLAY.get()
    if not ov:
        return {}
    return ((ov.get(universe) or {}).get(metric)) or {}


#: The key carries the authority token, which moves whenever the stored history does, so this
#: TTL is only a ceiling — 15 min made every indicator's live overlay re-read SQLite in-request.
_HIST_TTL = 6 * 3600
_hist_memo: dict = {}
_hist_lock = threading.Lock()


def _stored_history(metric: str, limit: int, universe: str) -> dict:
    """`breadth_daily_ohlc.history`, memoised per (metric, universe, limit, authority token).

    ⭐ (2026-10-10) The live overlay (`build_with_overlay`) re-derives a whole indicator about
    once a minute in session; every one of those re-read thousands of rows from SQLite. The
    stored history only changes when the token does, so it is read once and the overlay is
    applied on top. ⛔ Callers must not mutate the returned dict (`_with_overlay` copies)."""
    from api.services import breadth_daily_ohlc as store
    # the reader's identity is part of the key: a swapped reader (tests) never sees another's rows
    key = (metric, universe, int(limit), _authority_suffix(), id(store.history))
    now = time.time()
    with _hist_lock:
        hit = _hist_memo.get(key)
        if hit and now - hit[0] <= _HIST_TTL:
            return hit[1]
    rows = store.history(metric, limit=limit, universe=universe) or {}
    with _hist_lock:
        if len(_hist_memo) > 256:
            _hist_memo.clear()
        _hist_memo[key] = (now, rows)
    return rows


def _with_overlay(rows: dict, universe: str, metric: str) -> dict:
    extra = _overlay(universe, metric)
    if not extra:
        return rows
    last = max(rows) if rows else ""
    out = dict(rows)
    for d, v in extra.items():
        if d > last:
            out[d] = {"c": v}
    return out

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
    rows = _with_overlay(_stored_history(metric, limit, universe), universe, metric)
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
    a = _with_overlay(_stored_history(metric_a, limit, universe), universe, metric_a)
    b = _with_overlay(_stored_history(metric_b, limit, universe), universe, metric_b)
    dates = sorted(set(a) | set(b))
    return (dates,
            [(a.get(d) or {}).get("c") for d in dates],
            [(b.get(d) or {}).get("c") for d in dates])


#: Exchange Breadth V1 universes. ⛔ ONE AUTHORITY: their AD / MCO / MCS are NOT recomputed here — they are
#: read verbatim from `breadth_exchange_authority` (frozen derived artifact + the accepted live append),
#: so a chart can never show a value the authority does not hold. MCO/MCS are absent inside the burn-in.
EXCHANGE_UNIVERSES = ("nyse", "nasdaq")


# ── The Summation Index's NATURAL level (2026-10-07) ────────────────────────
#
# ⭐⭐ A McClellan Summation Index is exactly  SUM(t) = C + 19·EMA5%(t) − 9·EMA10%(t)  for a
# constant C fixed by wherever the running total was started (sum MO(t) = 19·ΔEMA5% − 9·ΔEMA10%).
# With C = 0 the level means what traders read it as: a long-run average of ratio-adjusted net
# advances ×10, so ZERO IS NEUTRAL and ±500 are the usual extremes. StockCharts' $NASI/$NYSI sit at
# C ≈ 0 (solved from their published 2026-10-06/07 readings: −625.9 vs −625.44, −770.9 vs −772.10).
#
# ⛔ OURS DID NOT. The accepted series started the running total at 0 on its epoch, which bakes in a
# permanent C — measured on production: NASDAQ +478.75, NYSE −202.74, US +388.95, constant to 1e-4
# over the whole history. The shape and every daily change were right; the LEVEL (and therefore the
# zero line and the reference lines) was shifted. This removes C — the same constant for every date,
# so all history is corrected at once and every future value stays corrected.
#
# ⚠️ THE FROZEN EXCHANGE ARTIFACT IS NOT TOUCHED. Its stored running total is read as-is and shifted
# here at serve time; the shift is re-measured from the SAME authority's advancing/declining on every
# build (it is a constant, so measuring it at the latest common session is exact, and the EMA seed has
# no influence after thousands of sessions).

def natural_summation_shift(dates, summation, ema_fast, ema_slow) -> Optional[float]:
    """The constant to ADD to a running-total summation so that C = 0. `ema_fast` is the 10% trend
    (`ema19`), `ema_slow` the 5% trend (`ema39`), all aligned to `dates`. None if not measurable."""
    for i in range(len(dates) - 1, -1, -1):
        s, f, w = summation[i], ema_fast[i], ema_slow[i]
        if s is None or f is None or w is None:
            continue
        if not (math.isfinite(s) and math.isfinite(f) and math.isfinite(w)):
            continue
        return (19.0 * float(w) - 9.0 * float(f)) - float(s)
    return None


def _shifted(values, shift: float):
    return [None if v is None else float(v) + shift for v in values]


def _exchange_series(sid: str, row) -> Optional["DerivedSeries"]:
    from api.services import breadth_exchange_authority as ea
    vals = ea.derived(sid)
    if not vals:
        return None
    dates = sorted(vals)
    kind = sid.split(":", 1)[1]
    values = [vals[d] for d in dates]
    base = None
    if kind == "MCS":
        # The frozen running total, re-levelled to its natural level (see the block above).
        # ⛔ ONE AUTHORITY: the trends are measured from the exchange authority's OWN advancing /
        # declining rows — never the general store — the same data its running total was built from.
        ha = ea.universe_history("advancing", row.universe) or {}
        hd = ea.universe_history("declining", row.universe) or {}
        adates = sorted(set(ha) | set(hd))
        if not adates:
            return None
        adv = [(ha.get(d) or {}).get("c") for d in adates]
        dec = [(hd.get(d) or {}).get("c") for d in adates]
        res = mc.compute(adates, adv, dec, method=mc.RATIO_ADJUSTED)
        f = dict(zip(res.dates, res.ema19))
        w = dict(zip(res.dates, res.ema39))
        shift = natural_summation_shift(dates, values, [f.get(d) for d in dates], [w.get(d) for d in dates])
        if shift is None:
            # ⛔ No measurable level: refuse rather than serve the shifted-by-C series as if it were right.
            _log.error("market indicators: %s natural level not measurable — not served", sid)
            return None
        values = _shifted(values, shift)
        base = values[0]
    return DerivedSeries(series_id=sid, dates=dates, values=values, universe=row.universe,
                         methodology_version=row.methodology_version,
                         detail={"authority": "breadth_exchange_authority", "token": ea.token()},
                         epoch=ea.MCO_FIRST[row.universe] if kind == "MCS" else None,
                         base=base)

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


def build_with_overlay(series_id: str, overlay: dict) -> Optional["DerivedSeries"]:
    """The series computed over canonical inputs + `overlay` rows (see `_INPUT_OVERLAY`).

    UNCACHED, and callers keep only the dates after the canonical series' last date. The
    exchange universes' AD / MCO / MCS are otherwise read verbatim from the authority, which
    cannot extend them, so under an overlay they run the SAME engine the US series use over the
    authority's own advancing/declining (`load_pair` reads the authority for nyse/nasdaq) — the
    recomputation reproduces the authority's values (verified 2026-10-07, max |Δ| 0.000000), so
    the extension continues the served line.
    """
    from api.services.market_indicators import registry as reg
    row = reg.get(series_id)
    if row is None or row.universe is None:
        return None
    token = _INPUT_OVERLAY.set(overlay or None)
    try:
        kind = series_id.split(":", 1)[1] if ":" in series_id else series_id
        if row.universe in EXCHANGE_UNIVERSES and kind in ("MCO", "MCS", "AD"):
            if kind == "AD":
                ds = ad_line_for_universe(row.universe)
                if ds:
                    ds.series_id = series_id
                return ds
            res = mcclellan_for_universe(row.universe)
            if res is None:
                return None
            if kind == "MCO":
                vals = res.oscillator
            else:
                vals = [None if (f is None or w is None) else 19.0 * w - 9.0 * f
                        for f, w in zip(res.ema19, res.ema39)]
            return DerivedSeries(series_id=series_id, dates=res.dates, values=vals,
                                 universe=row.universe, methodology_version=row.methodology_version)
        return _build_uncached(series_id)
    finally:
        _INPUT_OVERLAY.reset(token)


def build(series_id: str):
    """`registry` id → `DerivedSeries`, or None. The one door the serving layer uses.

    ⭐ (2026-10-10) NEVER A BUILD WHILE A MEMBER WAITS, once one has ever been made: a fresh
    in-memory value is served; a stale one is served while ONE background rebuild runs; after a
    deploy (memory empty) the last persisted series is served the same way. Only a series never
    built anywhere is computed inline — single-flighted."""
    sid = (series_id or "").strip().upper()
    key = f"derived::{sid}{_authority_suffix()}"
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and now - hit[0] <= _CACHE_TTL:
        return hit[1]
    if hit:
        _kick_rebuild(sid, key)
        return hit[1]
    disk = _disk_load(sid)
    if disk is not None:
        saved_at, disk_key, value = disk
        with _cache_lock:
            _cache[key] = (saved_at if disk_key == key else 0.0, value)
        if disk_key != key or now - saved_at > _CACHE_TTL:
            _kick_rebuild(sid, key)
        return value
    from api.services import single_flight
    return single_flight.run("mi-build:" + key, lambda: _rebuild(sid, key))


def _rebuild(sid: str, key: str):
    value = _build_uncached(sid)
    now = time.time()
    with _cache_lock:
        _cache[key] = (now, value)
    if value is not None:
        _disk_save(sid, key, now, value)
    return value


_rebuild_inflight: set = set()


def _kick_rebuild(sid: str, key: str) -> None:
    with _cache_lock:
        if key in _rebuild_inflight or len(_rebuild_inflight) >= 4:
            return
        _rebuild_inflight.add(key)

    def run():
        try:
            _rebuild(sid, key)
        except Exception as e:
            _log.warning("[market_indicators] background rebuild %s failed: %s", sid, e)
        finally:
            with _cache_lock:
                _rebuild_inflight.discard(key)
    threading.Thread(target=run, name=f"mi-rebuild-{sid}", daemon=True).start()


def _series_dir() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "market_indicator_series_v1")


def _persist_on() -> bool:
    v = os.environ.get("BREADTH_SERIES_PERSIST")
    if v is not None:
        return v != "0"
    return "PYTEST_CURRENT_TEST" not in os.environ


def _disk_path(sid: str) -> str:
    return os.path.join(_series_dir(), "".join(c if c.isalnum() else "_" for c in sid) + ".pkl")


def _disk_save(sid: str, key: str, saved_at: float, value) -> None:
    if not _persist_on():
        return
    import pickle
    try:
        os.makedirs(_series_dir(), exist_ok=True)
        path = _disk_path(sid)
        with open(path + ".tmp", "wb") as fh:
            pickle.dump({"sid": sid, "key": key, "saved_at": saved_at, "value": value}, fh,
                        protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(path + ".tmp", path)
    except Exception as e:
        _log.warning("[market_indicators] persist %s failed: %s", sid, e)


def _disk_load(sid: str):
    if not _persist_on():
        return None
    import pickle
    try:
        with open(_disk_path(sid), "rb") as fh:
            d = pickle.load(fh)
        if d.get("sid") != sid:
            return None
        return d["saved_at"], d["key"], d["value"]
    except Exception:
        return None


_primed: dict = {}


def _prime_overlay_inputs(sid: str) -> None:
    """Read (memoise) the stored histories `sid`'s live overlay derives from, here in the warm
    thread instead of in the first member request after a deploy (NYSE:AD took 8.9 s)."""
    key = (sid, _authority_suffix())
    if _primed.get(sid) == key:
        return
    try:
        build_with_overlay(sid, {})
        _primed[sid] = key
    except Exception:
        pass


def warm_all(max_rebuilds: int = 6) -> dict:
    """Keep every breadth-derived indicator warm: restore from disk after a deploy, rebuild in
    the background when stale. At most `max_rebuilds` inline builds per pass."""
    from api.services.market_indicators import registry as reg
    out = {"fresh": 0, "restored": 0, "rebuilt": 0, "deferred": 0}
    for row in reg.all_rows() if hasattr(reg, "all_rows") else []:
        if row.source_type != reg.SRC_BREADTH_DERIVED:
            continue
        sid = row.id.upper()
        key = f"derived::{sid}{_authority_suffix()}"
        with _cache_lock:
            hit = _cache.get(key)
        if hit and time.time() - hit[0] <= _CACHE_TTL:
            out["fresh"] += 1
            _prime_overlay_inputs(sid)
            continue
        if not hit and _disk_load(sid) is not None:
            build(sid)
            _prime_overlay_inputs(sid)
            out["restored"] += 1
            continue
        if out["rebuilt"] >= max_rebuilds:
            out["deferred"] += 1
            continue
        try:
            _rebuild(sid, key)
            _prime_overlay_inputs(sid)
            out["rebuilt"] += 1
        except Exception:
            pass
        time.sleep(0.3)
    return out


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
        # ⭐ The epoch still decides WHERE the series starts (after the burn-in); the level is the
        # natural one (C = 0), not "0 on the epoch". See `natural_summation_shift`.
        shift = natural_summation_shift(res.dates, res.summation, res.ema19, res.ema39)
        if shift is None:
            return None
        values = _shifted(res.summation, shift)
        return DerivedSeries(series_id=sid, dates=res.dates, values=values,
                             universe=uni, methodology_version=row.methodology_version,
                             detail={"oscillator": res.oscillator},
                             epoch=res.anchor.at, base=float(res.anchor.value) + shift)
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
