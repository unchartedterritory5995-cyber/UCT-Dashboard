"""BRK-01 increment 3 (roadmap RM-L01) — the implied-vol surface, from TODAY'S live chain only.

Three views, all off `polygon_options.get_chain` (the one chain implementation since TERM-069):
  1. the smile — IV by strike for one expiration, calls and puts;
  2. the term structure — at-the-money IV across a bounded sample of expirations;
  3. a strike x expiration grid of the out-of-the-money side.

⛔ HONESTY, each one railed in tests/test_vol_surface.py:
  * IV is the VENDOR'S field (`implied_volatility` on the Massive snapshot). Nothing here inverts
    Black-Scholes. `iv_source` says so, and the surface prints it.
  * A point needs a two-sided quote (bid > 0, ask > 0, ask >= bid) AND a vendor IV AND a quote
    time. Missing any one, the strike is REFUSED in a sentence; it is never drawn off a stale
    last trade.
  * Every point carries its quote time (`t`).
  * A side of an expiration with fewer than MIN_STRIKES valid points says so (`drawable: False`,
    a `reason`) and is not drawn as a line.
  * This is today's chain, not history: `basis` says so. IV history is the open vendor question
    (OPTIONS_UNIVERSE_LOG_ENABLED is dark), and nothing here fakes it.

⛔ REQUEST BUDGET: at most MAX_EXPIRATIONS chains per surface (plus the member's selected one),
fetched by at most WORKERS threads under a DEADLINE_S wall clock, and the whole surface cached for
the chain's own 60 s. Each chain is ALSO served from get_chain's 60 s cache, so the selected
expiration is the same cache entry the chain grid above it already paid for.
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.cache import TTLCache

MIN_STRIKES = 5          # fewer valid strikes than this on a side and it is not a line
MAX_EXPIRATIONS = 8      # sampled expirations per surface (the selected one is added on top)
STRIKES_AROUND_SPOT = 10  # strikes nearest spot per side (the chain cache is keyed without n, S3)
WING_DELTA = 0.05         # O2: also keep every strike with vendor |delta| >= this ...
WING_BAND = 0.25          # ... inside ±25% of spot, so the 25- and 10-delta wings are on hand
WORKERS = 4
DEADLINE_S = 25.0

IV_SOURCE = "vendor"
IV_SOURCE_TEXT = ("IV is the vendor's own implied volatility from the Massive (OPRA) snapshot; "
                  "this page does not compute it.")
BASIS_TEXT = ("Today's live chain only, not history: each point is the latest quote. "
              "IV history and past surfaces are not licensed yet.")

_CACHE = TTLCache()
_ET = ZoneInfo("America/New_York")


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def refusal(row: dict) -> str | None:
    """Why this contract cannot be a point, as a sentence fragment, or None if it can."""
    bid, ask = _num(row.get("bid")), _num(row.get("ask"))
    if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
        return "no two-sided quote"
    iv = _num(row.get("iv"))
    if iv is None or iv <= 0:
        return "the vendor sent no IV"
    if not row.get("quote_time"):
        return "no quote time"
    return None


def _side(rows: list[dict], kind: str) -> dict:
    points, refused = [], []
    for r in rows or []:
        k = _num(r.get("strike"))
        if k is None:
            continue
        why = refusal(r)
        if why:
            refused.append({"strike": k, "reason": why})
            continue
        points.append({"strike": k, "iv": _num(r["iv"]), "t": r["quote_time"],
                       "bid": _num(r["bid"]), "ask": _num(r["ask"]),
                       # the vendor's delta, carried for FT-018's RR/BF table (None when absent)
                       "delta": _num(r.get("delta"))})
    points.sort(key=lambda p: p["strike"])
    refused.sort(key=lambda p: p["strike"])
    out: dict[str, Any] = {"points": points, "refused": refused,
                           "drawable": len(points) >= MIN_STRIKES, "reason": None}
    if not out["drawable"]:
        out["reason"] = (f"Only {len(points)} {kind} strike{'s' if len(points) != 1 else ''} "
                         f"with a two-sided quote and a vendor IV; a smile needs at least "
                         f"{MIN_STRIKES}, so it is not drawn.")
    if refused:
        groups: dict[str, list[str]] = {}
        for x in refused:
            groups.setdefault(x["reason"], []).append(f"{x['strike']:g}")
        out["refused_text"] = "; ".join(
            f"{kind} {', '.join(ks)}: {why}" for why, ks in groups.items())
    return out


def _dte(expiration: str, today: date) -> int | None:
    try:
        return (date.fromisoformat(expiration) - today).days
    except (TypeError, ValueError):
        return None


def _atm(calls: dict, puts: dict, spot: float) -> dict:
    """At-the-money IV: the valid strike nearest spot. Both sides there are averaged; one side
    alone is used and NAMED; neither is a null with its reason."""
    cmap = {p["strike"]: p for p in calls["points"]}
    pmap = {p["strike"]: p for p in puts["points"]}
    strikes = sorted(set(cmap) | set(pmap), key=lambda k: (abs(k - spot), k))
    if not strikes:
        return {"atm_strike": None, "atm_iv": None, "atm_basis": None, "t": None,
                "reason": "no strike with a two-sided quote and a vendor IV"}
    k = strikes[0]
    c, p = cmap.get(k), pmap.get(k)
    if c and p:
        iv, basis, t = (c["iv"] + p["iv"]) / 2, "call and put averaged", max(c["t"], p["t"])
    elif c:
        iv, basis, t = c["iv"], "call only", c["t"]
    else:
        iv, basis, t = p["iv"], "put only", p["t"]
    return {"atm_strike": k, "atm_iv": iv, "atm_basis": basis, "t": t, "reason": None}


def build_expiration(chain: dict, today: date) -> dict:
    """One expiration's smile + its ATM point. `chain` is a get_chain() result."""
    spot = _num(chain.get("spot"))
    exp = chain.get("expiration")
    calls, puts = _side(chain.get("calls"), "call"), _side(chain.get("puts"), "put")
    atm = _atm(calls, puts, spot) if spot else {
        "atm_strike": None, "atm_iv": None, "atm_basis": None, "t": None,
        "reason": "no underlying price"}
    valid = len({p["strike"] for p in calls["points"]} | {p["strike"] for p in puts["points"]})
    enough = valid >= MIN_STRIKES
    if not enough and atm["reason"] is None:
        # one lonely quote is not an at-the-money read of an expiration
        atm = {**atm, "atm_iv": None,
               "reason": f"only {valid} valid strike{'s' if valid != 1 else ''} "
                         f"(needs {MIN_STRIKES})"}
    return {"expiration": exp, "dte": _dte(exp, today), "spot": spot,
            "calls": calls, "puts": puts, **atm}


def sample_expirations(listed: list[str], k: int = MAX_EXPIRATIONS) -> list[str]:
    """A bounded, spread sample: the nearest three, then the rest spaced evenly through the list,
    always ending on the farthest listed. Deterministic, never more than k."""
    xs = [x for x in (listed or []) if x]
    if len(xs) <= k:
        return xs
    head = xs[:3]
    rest = xs[3:]
    m = k - len(head)
    idx = sorted({round(i * (len(rest) - 1) / (m - 1)) for i in range(m)}) if m > 1 else [len(rest) - 1]
    return head + [rest[i] for i in idx]


def build_grid(exps: list[dict], spot: float | None) -> dict:
    """Strike x expiration, the OUT-OF-THE-MONEY side (put below spot, call at or above): the
    side whose quote is the liquid one. A cell with no valid point is null, never interpolated."""
    cols = [e for e in exps if e["calls"]["points"] or e["puts"]["points"]]
    strikes: set[float] = set()
    for e in cols:
        strikes |= {p["strike"] for p in e["calls"]["points"]}
        strikes |= {p["strike"] for p in e["puts"]["points"]}
    rows = []
    for k in sorted(strikes):
        cells = []
        for e in cols:
            side = e["puts"] if (spot is not None and k < spot) else e["calls"]
            hit = next((p for p in side["points"] if p["strike"] == k), None)
            cells.append({"iv": hit["iv"], "t": hit["t"]} if hit else None)
        rows.append({"strike": k, "cells": cells})
    return {"expirations": [e["expiration"] for e in cols], "rows": rows,
            "side_rule": "out-of-the-money side: puts below spot, calls at or above"}


def build_surface(sym: str, chains: list[dict], selected: str | None, listed_count: int,
                  missing: list[dict], today: date) -> dict:
    exps = sorted((build_expiration(c, today) for c in chains),
                  key=lambda e: e["expiration"] or "")
    spot = next((e["spot"] for e in exps if e["spot"]), None)
    term = [{"expiration": e["expiration"], "dte": e["dte"], "atm_iv": e["atm_iv"],
             "atm_strike": e["atm_strike"], "atm_basis": e["atm_basis"], "t": e["t"],
             "reason": e["reason"]} for e in exps]
    drawn = [p for p in term if p["atm_iv"] is not None]
    smile = next((e for e in exps if e["expiration"] == selected), exps[0] if exps else None)
    return {
        "ticker": sym,
        "spot": spot,
        "iv_source": IV_SOURCE,
        "iv_source_text": IV_SOURCE_TEXT,
        "basis": BASIS_TEXT,
        "min_strikes": MIN_STRIKES,
        "smile": smile,
        "term": {"points": term, "drawable": len(drawn) >= 2,
                 "reason": None if len(drawn) >= 2 else
                 f"Only {len(drawn)} expiration{'s' if len(drawn) != 1 else ''} with an "
                 "at-the-money IV; a term structure needs at least 2."},
        "grid": build_grid(exps, spot),
        "expirations_listed": listed_count,
        "expirations_sampled": len(exps),
        "missing": missing,
    }


def get_surface(sym: str, selected: str = "") -> dict:
    """Fetch (bounded) and build. {"error": ...} when the provider fails outright."""
    s = (sym or "").upper().strip()
    if not s:
        return {"error": "ticker required"}
    key = f"volsurf::{s}::{selected}"
    hit = _CACHE.get(key)
    if hit is not None:
        return dict(hit)

    from api.services import single_flight

    def _lead() -> dict:
        again = _CACHE.get(key)
        if again is not None:
            return dict(again)
        return _build_and_cache(s, selected, key)

    try:  # S3: concurrent cold readers of one surface share one fan-out
        return dict(single_flight.run(key, _lead, wait=DEADLINE_S + 30))
    except single_flight.SingleFlightTimeout:
        return {"error": "surface still being built", "ticker": s}


def _build_and_cache(s: str, selected: str, key: str) -> dict:
    from api.services import polygon_options as po

    fetched = fetch_chains(s, selected)
    if "error" in fetched:
        return fetched
    chains, missing, all_exps = fetched["chains"], fetched["missing"], fetched["listed"]
    out = build_surface(s, chains, selected or None, len(all_exps), missing,
                        datetime.now(_ET).date())
    out["served_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out["cache_seconds"] = po._CHAIN_TTL
    _CACHE.set(key, dict(out), po._CHAIN_TTL)
    return out


def fetch_chains(s: str, selected: str = "") -> dict:
    """The bounded fetch behind the surface: {chains, missing, listed} or {"error", "ticker"}.
    Shared with FT-018's RR/BF table (api/services/options_analytics/vol_skew.py); every chain is a
    get_chain cache entry, so a second reader costs no vendor call inside the 60 s."""
    from api.services import polygon_options as po

    listed = po.list_expirations(s)
    if isinstance(listed, dict) and listed.get("error"):
        return {"error": listed["error"], "ticker": s}
    all_exps = list(listed.get("expirations") or [])
    want = sample_expirations(all_exps)
    if selected and selected not in want:
        want.append(selected)
    if not want:
        return {"error": "no listed expirations", "ticker": s}

    chains, missing = [], []
    pool = ThreadPoolExecutor(max_workers=WORKERS)
    try:
        futs = {pool.submit(po.get_chain, s, x, STRIKES_AROUND_SPOT,
                            min_abs_delta=WING_DELTA, band_pct=WING_BAND): x for x in want}
        done, not_done = wait(futs, timeout=DEADLINE_S)
        for f in not_done:
            f.cancel()
            missing.append({"expiration": futs[f], "reason": "not fetched within the time budget"})
        for f in done:
            x = futs[f]
            try:
                c = f.result()
            except Exception as e:  # noqa: BLE001 -- one expiration failing is a named gap
                missing.append({"expiration": x, "reason": f"fetch failed: {type(e).__name__}"})
                continue
            if not isinstance(c, dict) or c.get("error"):
                missing.append({"expiration": x, "reason": (c or {}).get("error", "no data")})
                continue
            chains.append(c)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    if not chains:
        return {"error": "no expiration could be fetched", "ticker": s}
    missing.sort(key=lambda m: m["expiration"])
    return {"chains": chains, "missing": missing, "listed": all_exps}
