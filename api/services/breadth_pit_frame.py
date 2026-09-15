"""The point-in-time breadth FRAME — which securities existed, and which of them
belonged to a universe, on each past day.

⭐⭐ THE ONE IDEA: A STOCK EXISTS HISTORICALLY BECAUSE IT TRADED, NOT BECAUSE A
REFERENCE FILE MENTIONS IT. The grouped-daily endpoint returns every ticker that
printed on a given session — a company that went to zero in 2009 appears on
exactly the days it traded and then stops — so the frame IS the point-in-time
market, with no curated delisted list and no survivorship filter. Reference
metadata then CLASSIFIES those observations (common stock? which venue?). It may
only ever REMOVE a name from a day, never add one.

⛔⛔ THAT ORDERING IS THE NO-LOOK-AHEAD GUARANTEE, and reversing it is the whole
trap this module exists to avoid. Building the universe from today's ticker list
and then asking for prices is how the existing 2008-2024 UCT reconstruction became
survivorship-biased (`breadth_history_recon`'s header measures the damage). Here a
2020 IPO cannot appear in a 2010 frame because it is not IN the 2010 frame — the
guarantee is structural rather than a date comparison that could be wrong.

⛔ AND IT DOES NOT COMPUTE BREADTH. It hands `breadth_live.build_levels` /
`compute_metrics` — the SAME engine the live path and the UCT reconstruction use —
a matrix and a per-date member set. One metric definition, many universes; if this
file ever grows a `pct_above_` it has failed.

⚠️ `bars.db` IS NOT AN ALTERNATIVE SOURCE. Measured 2026-09-14: on 2008-03-10 it
held 2,073 names of which TWO were delisted (0.1 %), against 7,993 in the
grouped-daily frame of which 44.9 % of the eligible set is dead today. It is a
demand-driven cache of what members chart now, so it is survivor-shaped by
construction.
"""
from __future__ import annotations

import json
import logging
import os
import time
import warnings
from collections import defaultdict
from datetime import date as _date, timedelta as _td
from typing import Optional

from api.services import breadth_pit_universe as pit
from api.services import breadth_universes as bu

_log = logging.getLogger("breadth_pit_frame")

#: Security types that count as "common stock" for breadth. Mirrors the collector's
#: own `_load_cs_ticker_set` ({CS, ADRC}) so the new universes use UCT's security
#: semantics even though they deliberately use different eligibility thresholds.
COMMON_TYPES = frozenset({"CS", "ADRC"})

#: Phase-1 accepted eligibility thresholds. NOT a market-cap filter: we do not
#: possess historical shares-outstanding, and the $300M proxy is what dragged the
#: earlier calibration to Jaccard 0.76. These universes publish their own rule.
PRICE_MIN = 2.0
DOLLARVOL_MIN = 1_000_000.0
DOLLARVOL_WINDOW = 20           # trailing sessions for the median $-volume

_REF_TTL = 7 * 86400            # reference data changes slowly; refresh weekly


def _ref_cache_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"),
                        "breadth_pit_reference.json")


def _d10(v) -> Optional[str]:
    if not v:
        return None
    s = str(v)
    return s[:10] if len(s) >= 10 else None


# ── Reference map ────────────────────────────────────────────────────────────

def reference_map(force: bool = False) -> dict:
    """`{SYMBOL: [record, …]}` from BOTH the active and delisted enumerations.

    ⭐ A LIST PER SYMBOL, NOT ONE RECORD, because a symbol is not an identity. A
    ticker delisted in 2009 and reassigned in 2015 is two companies, and a map that
    kept one of them would classify the 2008 observation with the 2015 company's
    type and venue. `resolve()` picks per date.

    Cached to the data volume for a week — 36k records, and a whole-market sweep
    must not re-enumerate them per chunk.
    """
    path = _ref_cache_path()
    if not force:
        try:
            st = os.stat(path)
            if time.time() - st.st_mtime < _REF_TTL:
                with open(path) as fh:
                    return json.load(fh)
        except Exception:
            pass
    from api.services import massive
    by_sym: dict = defaultdict(list)
    n = 0
    for active in (True, False):
        for r in massive.list_reference_tickers(active=active, max_pages=300):
            sym = str(r.get("ticker") or "").upper()
            if not sym:
                continue
            by_sym[sym].append({
                "type": r.get("type"),
                "primary_exchange": (r.get("primary_exchange") or "").upper(),
                "list_date": _d10(r.get("list_date")),
                "delisted_utc": _d10(r.get("delisted_utc")),
            })
            n += 1
    out = dict(by_sym)
    if n:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(out, fh, separators=(",", ":"))
            os.replace(tmp, path)
        except Exception:
            pass
    _log.info("[pit_frame] reference map: %s records over %s symbols", n, len(out))
    return out


def resolve(recs, date: str) -> Optional[dict]:
    """The record whose listing window contains `date`, or None.

    ⚠️ `list_date` IS ABSENT FROM THE LIST ENDPOINT (measured 2026-09-14: 0 % of
    resolved names carry one), so the `list_date ≤ date` half of
    `breadth_pit_universe.active_on` is inert here. That costs NOTHING for
    inclusion — the grouped-daily frame already guarantees no look-ahead — and it
    is handled rather than assumed: when several records survive the delisting
    test we take the LATEST listing, which is the right answer for a reused symbol
    whenever a list date exists, and a harmless no-op when none does.
    """
    if not recs:
        return None
    hits = [r for r in recs if pit.active_on(r, date)]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


# ── Eligibility ──────────────────────────────────────────────────────────────

def eligible_on(universe: str, date: str, day_rows: dict, ref_map: dict,
                dollarvol: Optional[dict] = None,
                price_min: float = PRICE_MIN,
                dollarvol_min: float = DOLLARVOL_MIN) -> tuple[set, dict]:
    """`(eligible_symbols, coverage)` for one universe on one date.

    `day_rows`  : {TICKER: {"c","v",…}} — the RAW (unadjusted) grouped-daily frame,
                  because a historical dollar price floor means the price people
                  actually paid, not that price restated into today's split basis.
    `dollarvol` : {TICKER: trailing median close·volume}. When omitted, the day's
                  own close·volume stands in — enough to select a universe, but the
                  trailing median is what a sweep should pass (a single halted or
                  news-spiked session must not add or drop a member).

    ⛔ AN UNRESOLVED NAME IS EXCLUDED AND COUNTED, NEVER GUESSED. ~2 % of a 2008
    frame has no reference record at all; assigning it a type or a venue would be
    inventing membership, and silently dropping it would make the gap invisible.
    `coverage` carries the number so a future series can report what it measured.
    """
    row = bu.get(universe)
    allowed = row["venues"]
    if allowed is None:
        raise bu.UnknownUniverse(
            f"{row['label']} membership comes from the collector, not from a PIT "
            "frame; it has no venue set to select on.")

    cov = {"frame": len(day_rows or {}), "resolved": 0, "unresolved": 0,
           "not_common": 0, "wrong_venue": 0, "no_venue": 0,
           "fail_price": 0, "fail_liquidity": 0, "eligible": 0}
    out: set = set()
    for sym, m in (day_rows or {}).items():
        rec = resolve(ref_map.get(sym), date)
        if rec is None:
            cov["unresolved"] += 1
            continue
        cov["resolved"] += 1
        if rec.get("type") not in COMMON_TYPES:
            cov["not_common"] += 1
            continue
        exch = (rec.get("primary_exchange") or "").upper()
        if not exch:
            cov["no_venue"] += 1
            continue
        if exch not in allowed:
            cov["wrong_venue"] += 1
            continue
        try:
            c = m.get("c")
            v = m.get("v")
        except AttributeError:
            cov["unresolved"] += 1
            continue
        if c is None or c < price_min:
            cov["fail_price"] += 1
            continue
        dv = dollarvol.get(sym) if dollarvol is not None else (c * (v or 0.0))
        if dv is None or dv < dollarvol_min:
            cov["fail_liquidity"] += 1
            continue
        out.add(sym)
    cov["eligible"] = len(out)
    cov["coverage_ratio"] = round(cov["resolved"] / cov["frame"], 4) if cov["frame"] else 0.0
    return out, cov


# ── The frame ────────────────────────────────────────────────────────────────

def _sessions(from_date: str, to_date: str, adjusted: bool, max_gap: int = 12) -> list:
    """[(iso, {TICKER: row})] ascending over real trading sessions in the range.

    Walks calendar days and keeps whatever the provider answers; a non-trading day
    returns {} and is skipped. `max_gap` bounds a provider outage so a dead key
    cannot spin through years of empty days.
    """
    from api.services import massive
    out, gap = [], 0
    d = _date.fromisoformat(from_date)
    end = _date.fromisoformat(to_date)
    while d <= end:
        if d.weekday() < 5:
            g = massive.get_grouped_daily_ohlcv(d.isoformat(), adjusted=adjusted)
            if g:
                out.append((d.isoformat(), g))
                gap = 0
            else:
                gap += 1
                if gap > max_gap:
                    _log.warning("[pit_frame] %s empty sessions at %s — stopping",
                                 gap, d.isoformat())
                    break
        d += _td(days=1)
    return out


def build_frame(universe: str, from_date: str, to_date: str,
                warmup_days: int = 560, price_min: float = PRICE_MIN,
                dollarvol_min: float = DOLLARVOL_MIN) -> dict:
    """The matrix + per-date membership a sweep needs.

    Returns the SAME shape `breadth_history_recon.load_deep_frame` produces —
    `{dates, date_pos, closes, vols}` — plus `tickers`, `eligible` and `coverage`,
    so `recompute_from_frame` consumes it without learning anything new.

    ⭐⭐ THE MATRIX IS THE WHOLE MARKET; THE UNIVERSE IS A PER-DATE MEMBER SET.
    That split is what makes `UNIVERSE × METRIC` one algorithm. `compute_metrics`
    masks on which tickers have a PRICE (`have = ~isnan(px)`), so handing it only
    the eligible members' prices restricts every metric it computes — the MA
    family, the counts, the highs and lows — to that universe, with no branch
    anywhere in the metric engine. Three universes over one matrix is three member
    sets, not three frames.

    ⚠️ ADJUSTED CLOSES FOR THE MATRIX, RAW FOR ELIGIBILITY. A 50-day average and a
    52-week extreme must be measured on one split basis or they are arithmetic on
    two different instruments; a $2 floor must be measured on the price that
    actually traded. Both frames come from the same endpoint on the same day, so
    this costs one extra fetch per session and removes a whole class of silent
    error.
    """
    bu.sweepable_range(universe, from_date, to_date)
    import numpy as np

    warm_start = (_date.fromisoformat(from_date) - _td(days=int(warmup_days))).isoformat()
    t0 = time.perf_counter()
    adj = _sessions(warm_start, to_date, adjusted=True)
    if not adj:
        return {"ok": False, "reason": "no sessions in range", "dates": [],
                "date_pos": {}, "tickers": [], "eligible": {}, "coverage": {}}

    dates = [d for (d, _g) in adj]
    date_pos = {d: i for i, d in enumerate(dates)}
    tickers = sorted({t for (_d, g) in adj for t in g})
    ti = {t: i for i, t in enumerate(tickers)}

    closes = np.full((len(tickers), len(dates)), np.nan)
    vols = np.full((len(tickers), len(dates)), np.nan)
    for j, (_d, g) in enumerate(adj):
        for t, m in g.items():
            i = ti[t]
            c = m.get("c")
            if c:
                closes[i, j] = c
            v = m.get("v")
            if v:
                vols[i, j] = v

    # ⭐ TRAILING $-VOLUME IS ONE VECTORISED PASS, not a per-date walk over every
    # ticker. `nanmedian` over the trailing window of `closes * vols` is the same
    # number a rolling Python list would give, at a fraction of the cost on a
    # 10k × 900 matrix — and the median ignores the NaNs that are simply "this name
    # had not listed yet", which is exactly the desired treatment.
    #
    # ⚠️ Measured on the ADJUSTED matrix on purpose: close·volume is invariant to a
    # split (price down by the factor, volume up by it), so the adjusted product is
    # the same dollar figure the raw one gives — and it saves holding a second
    # whole-market matrix just to multiply it away.
    dollar = closes * vols
    ref = reference_map()
    sweep_dates = [d for d in dates if from_date <= d <= to_date]
    eligible, coverage = {}, {}
    missing_raw = []
    from api.services import massive
    for d in sweep_dates:
        j = date_pos[d]
        lo = max(0, j - DOLLARVOL_WINDOW + 1)
        # ⚠️ An all-NaN row is the NORMAL case, not an error: most of the matrix is
        # names that had not listed yet or had already died. `nanmedian` warns on it
        # and returns NaN, which is exactly the answer we want (the name has no
        # liquidity history, so it is not eligible) — so the warning is suppressed
        # rather than the condition avoided.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med = np.nanmedian(dollar[:, lo:j + 1], axis=1)
        dv = {t: float(med[i]) for i, t in enumerate(tickers) if med[i] == med[i]}
        raw = massive.get_grouped_daily_ohlcv(d, adjusted=False)
        # ⛔⛔ AN EMPTY RAW FRAME ON A REAL SESSION IS AN ERROR, NOT AN EMPTY UNIVERSE.
        # `d` is in `dates`, which means the ADJUSTED fetch returned rows, so the
        # market traded. If the RAW fetch comes back empty the fetch FAILED — and
        # `get_grouped_daily_ohlcv` swallows every exception and returns `{}`, so the
        # failure arrives looking exactly like a quiet day.
        #
        # ⚰️ MEASURED, not theorised: a control sweep asked for 48 sessions, held raw
        # frames for 5, and silently produced 5. Eligibility over `{}` yields zero
        # members, every metric is then `None`, nothing is written, and the sweep
        # reports success over a window with a 43-session hole in it. In a multi-year
        # grind that is a gap nobody would see until somebody charted the year.
        if not raw:
            missing_raw.append(d)
            continue
        elig, cov = eligible_on(universe, d, raw, ref, dollarvol=dv,
                                price_min=price_min, dollarvol_min=dollarvol_min)
        eligible[d] = elig
        coverage[d] = cov

    if missing_raw:
        # ⛔ REFUSE THE WHOLE CHUNK rather than write a partial one. A historical
        # series with an invisible hole is worse than a sweep that failed loudly: the
        # hole survives into the store, the chart, and every later re-run that sees
        # coverage already reaching past it.
        _log.error("[pit_frame] %s sweep dates have no RAW frame (first %s) — refusing",
                   len(missing_raw), missing_raw[0])
        return {"ok": False, "reason": (
            f"{len(missing_raw)} of {len(sweep_dates)} sweep dates have no raw "
            f"grouped-daily frame (first: {missing_raw[0]}, last: {missing_raw[-1]}). "
            "The adjusted frame exists for these dates, so the market traded and the "
            "RAW fetch failed — computing over them would write a silent gap."),
            "missing_raw": missing_raw, "dates": [], "date_pos": {},
            "tickers": [], "eligible": {}, "coverage": {}}
    return {"ok": True, "universe": bu.normalize(universe), "dates": dates,
            "date_pos": date_pos, "closes": closes, "vols": vols,
            "tickers": tickers, "eligible": eligible, "coverage": coverage,
            "sweep_dates": sweep_dates,
            "elapsed_s": round(time.perf_counter() - t0, 1)}
