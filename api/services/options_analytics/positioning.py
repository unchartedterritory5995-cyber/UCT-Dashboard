"""Dealer-positioning extensions over the GEX chain (BRK-08 / FT-047, 049, 050, 052, 055).

Five surfaces, each with its own dark switch (`flags.py`), all reading ONE chain per
(symbol, window) — the chain `api/gex_service.py` already fetches, through its own source rule
and (for Massive) its 60 s server-side cache, so a heatmap, a max-pain read and the GEX page
asking about the same name cost one walk:

  * heatmap   (FT-049) — net GEX per (expiration x strike): the strike x expiry exposure grid.
  * max_pain  (FT-055) — per expiration, the strike where option holders' intrinsic value is
                          smallest.
  * nope      (FT-055) — net delta of today's option volume over today's share volume.
  * impact    (FT-050) — gamma notional relative to the stock's dollar volume: WHEN to ignore
                          the positioning read.
  * levels    (FT-047) — the named levels, in the closed vocabulary of `positioning_vocab.py`.
  * dealer_short (FT-052) — contracts our trade-side attribution estimates dealers are net
                          short, read from flow-worker's dealer_positioning table.

⛔ COMPUTED, AND SAID SO. Gamma, delta, OI and volume are the vendor's (Massive or Schwab, named
  in `chain_source`); every number this module returns is ours and carries `label: "computed"`
  and its method in words.
⛔ THE ONE FORMULA. GEX per contract line is `gex_service.contract_gex` — the same function
  `get_gex_data` uses — never restated here.
⛔ A CONTRACT WITHOUT THE INPUT IS COUNTED, NEVER ZERO. Missing gamma/OI/volume is tallied and
  reported, the same rule `get_gex_data` follows.
⛔ THE STRIKE BAND IS STATED. The Massive walk keeps strikes within 15% of spot
  (`gex_service.MASSIVE_STRIKE_BAND_PCT`); max pain over a band is max pain OVER THAT BAND, and
  the answer says so.
⛔ ASYNC WITHOUT BLOCKING. The chain is awaited; bars, the dealer table read and the vendor
  chain call run in `asyncio.to_thread`.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import time
from typing import Optional
from zoneinfo import ZoneInfo

from api.services.cache import TTLCache

_ET = ZoneInfo("America/New_York")

DTE_WINDOWS = {"0dte": 0, "1dte": 1, "week": 7, "month": 30, "all": 180}
RESULT_TTL_S = 60.0
ADV_TTL_S = 3600.0
ADV_SESSIONS = 20
HEATMAP_MAX_EXPIRATIONS = 8
HEATMAP_MAX_STRIKES = 30
#: Options Impact bands. ⛔ HEURISTIC, NOT CALIBRATED: no history yet says where positioning
#: starts to steer a price, so the bands are stated as ours and the raw ratio is always shown.
IMPACT_BANDS = ((0.02, "low"), (0.08, "moderate"))

_RESULTS = TTLCache(max_size=256)
_ADV = TTLCache(max_size=512)


def clear_cache() -> None:
    _RESULTS.clear()
    _ADV.clear()


# ── the chain (one per symbol x window) ───────────────────────────────────────

async def _default_fetch(sym: str, from_date: str, to_date: str) -> tuple:
    """(data, error, source): the chain gex_service reads, by gex_service's own source rule.
    `shadow` SERVES Schwab there, so it does here."""
    from api import gex_service as g
    src = g.chain_source()
    src = "schwab" if src == "shadow" else src
    fetch = g._fetch_chain_massive if src == "massive" else g._fetch_chain_schwab
    data, err = await fetch(sym, from_date, to_date)
    return data, err, src


_fetch = _default_fetch


def _window(dte: str, today: Optional[_dt.date] = None) -> tuple:
    days = DTE_WINDOWS.get(dte, 30)
    t = today or _dt.datetime.now(_ET).date()
    return t.isoformat(), (t + _dt.timedelta(days=days)).isoformat()


def _exp_of(key: str) -> str:
    return (key or "").split(":")[0]


def contracts(data: dict) -> list:
    """Flatten Schwab's shape into rows: {expiration, strike, cp, oi, gamma, delta, volume}."""
    out = []
    for side, cp in (("callExpDateMap", "C"), ("putExpDateMap", "P")):
        for exp_key, strikes in (data.get(side) or {}).items():
            for k, rows in (strikes or {}).items():
                try:
                    strike = float(k)
                except (TypeError, ValueError):
                    continue
                for c in rows or []:
                    out.append({"expiration": _exp_of(exp_key), "strike": strike, "cp": cp,
                                "oi": c.get("openInterest"), "gamma": c.get("gamma"),
                                "delta": c.get("delta"), "volume": c.get("totalVolume")})
    return out


async def chain(sym: str, dte: str) -> dict:
    """{spot, rows, source, truncated} or raises RuntimeError with the provider's words."""
    f, t = _window(dte)
    data, err, src = await _fetch(sym, f, t)
    if err or not data:
        raise RuntimeError(err or "no chain")
    spot = float(data.get("underlyingPrice") or 0)
    if spot <= 0:
        raise RuntimeError(f"no spot price for {sym}")
    return {"spot": spot, "rows": contracts(data), "source": src,
            "truncated": bool(data.get("massive_truncated")), "window": {"from": f, "to": t}}


def _base(sym: str, dte: str, ch: dict, method: str) -> dict:
    from api import gex_service as g
    return {"symbol": sym, "dte": dte, "spot": ch["spot"], "chain_source": ch["source"],
            "window": ch["window"], "label": "computed", "method": method,
            "inputs": "vendor (gamma, delta, open interest, volume from the chain source)",
            "strike_band_pct": g.MASSIVE_STRIKE_BAND_PCT if ch["source"] == "massive" else None,
            "chain_truncated": ch["truncated"],
            "computed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}


async def _cached(kind: str, sym: str, dte: str, build) -> dict:
    key = f"posn::{kind}::{sym}::{dte}"
    hit = _RESULTS.get(key)
    if hit is not None:
        return hit
    out = await build()
    _RESULTS.set(key, out, RESULT_TTL_S)
    return out


# ── FT-049 heatmap ────────────────────────────────────────────────────────────

HEATMAP_METHOD = ("Net GEX per expiration and strike: for each contract, gamma x open interest x "
                  "100 x spot^2 x 1% (calls positive, puts negative), summed per cell. Dollars of "
                  "dealer gamma per 1% move under the naive convention (dealers short what "
                  "customers hold). The nearest expirations and the strikes closest to spot are "
                  "shown.")


def heatmap_from(sym: str, dte: str, ch: dict) -> dict:
    from api.gex_service import contract_gex
    spot = ch["spot"]
    cells: dict = {}
    missing = 0
    for r in ch["rows"]:
        if r["oi"] is None or r["gamma"] is None:
            missing += 1
            continue
        if r["oi"] <= 0 or r["gamma"] == 0:
            continue
        v = contract_gex(r["gamma"], r["oi"], spot) * (1 if r["cp"] == "C" else -1)
        k = (r["expiration"], r["strike"])
        cells[k] = cells.get(k, 0.0) + v
    exps = sorted({e for e, _ in cells})[:HEATMAP_MAX_EXPIRATIONS]
    strikes = sorted({s for e, s in cells if e in exps}, key=lambda s: abs(s - spot))[:HEATMAP_MAX_STRIKES]
    strikes.sort()
    grid = [[(round(cells[(e, s)]) if (e, s) in cells else None) for s in strikes] for e in exps]
    flat = [v for row in grid for v in row if v is not None]
    return {**_base(sym, dte, ch, HEATMAP_METHOD), "expirations": exps, "strikes": strikes,
            "cells": grid, "max_abs": max((abs(v) for v in flat), default=0),
            "unit": "$ of gamma per 1% move", "contracts_missing_gamma_or_oi": missing,
            "note": ("A blank cell is a strike with no computable contract at that expiry, never "
                     "zero gamma.")}


async def heatmap(sym: str, dte: str = "month") -> dict:
    async def build():
        return heatmap_from(sym, dte, await chain(sym, dte))
    return await _cached("heatmap", sym, dte, build)


# ── FT-055 max pain ───────────────────────────────────────────────────────────

MAX_PAIN_METHOD = ("Max pain = the strike at which the total intrinsic value of the expiration's "
                   "open calls and puts is smallest (open interest x 100 x distance in the "
                   "money), searched over the listed strikes.")


def max_pain_from(sym: str, dte: str, ch: dict) -> dict:
    by_exp: dict = {}
    missing = 0
    for r in ch["rows"]:
        if r["oi"] is None:
            missing += 1
            continue
        if r["oi"] <= 0:
            continue
        by_exp.setdefault(r["expiration"], []).append(r)
    out = []
    for exp in sorted(by_exp):
        rows = by_exp[exp]
        strikes = sorted({r["strike"] for r in rows})
        best, best_pain = None, None
        for k in strikes:
            pain = 0.0
            for r in rows:
                itm = max(0.0, k - r["strike"]) if r["cp"] == "C" else max(0.0, r["strike"] - k)
                pain += itm * r["oi"] * 100
            if best_pain is None or pain < best_pain:
                best, best_pain = k, pain
        out.append({"expiration": exp, "max_pain": best,
                    "payout_at_max_pain": round(best_pain or 0),
                    "call_oi": sum(r["oi"] for r in rows if r["cp"] == "C"),
                    "put_oi": sum(r["oi"] for r in rows if r["cp"] == "P"),
                    "strikes_counted": len(strikes),
                    "distance_pct": (round((best - ch["spot"]) / ch["spot"] * 100, 2)
                                     if best is not None else None)})
    base = _base(sym, dte, ch, MAX_PAIN_METHOD)
    band = base["strike_band_pct"]
    return {**base, "expirations": out, "contracts_missing_oi": missing,
            "band_note": (f"Computed over strikes within {band:g}% of spot; open interest outside "
                          "that band is not counted." if band else
                          "Computed over the strikes the chain source returned.")}


async def max_pain(sym: str, dte: str = "month") -> dict:
    async def build():
        return max_pain_from(sym, dte, await chain(sym, dte))
    return await _cached("maxpain", sym, dte, build)


# ── the stock's own volume (NOPE, impact) ───────────────────────────────────────

def _default_bars(sym: str) -> list:
    from api.services import massive
    t = _dt.date.today()
    return massive.get_agg_bars(sym, (t - _dt.timedelta(days=45)).isoformat(), t.isoformat())


_bars = _default_bars


def _bar_date(b: dict) -> Optional[str]:
    try:
        return _dt.datetime.fromtimestamp(int(b["t"]) / 1000, _dt.timezone.utc).astimezone(
            _ET).date().isoformat()
    except (KeyError, TypeError, ValueError, OSError):
        return None


async def stock_volume(sym: str, today: Optional[str] = None) -> dict:
    """{today_volume, today_date, adv_dollars, adv_sessions} from daily bars. An empty bar read
    is reported as unavailable — `get_agg_bars` answers [] on failure, so empty cannot mean zero."""
    key = f"posnadv::{sym}"
    hit = _ADV.get(key)
    if hit is None:
        bars = await asyncio.to_thread(_bars, sym)
        hit = {"bars": bars or [], "read_at": time.time()}
        if bars:
            _ADV.set(key, hit, ADV_TTL_S)
    bars = hit["bars"]
    if not bars:
        return {"available": False, "reason": f"no daily bars could be read for {sym}"}
    today = today or _dt.datetime.now(_ET).date().isoformat()
    last = bars[-1]
    today_volume = last.get("v") if _bar_date(last) == today else None
    done = [b for b in bars if _bar_date(b) != today][-ADV_SESSIONS:]
    dollars = [float(b["c"]) * float(b["v"]) for b in done if b.get("c") and b.get("v")]
    return {"available": True, "today_volume": today_volume, "today_date": today,
            "adv_dollars": (sum(dollars) / len(dollars)) if dollars else None,
            "adv_sessions": len(dollars)}


# ── FT-055 NOPE ───────────────────────────────────────────────────────────────

NOPE_METHOD = ("NOPE = (sum over contracts of delta x today's contract volume x 100) / today's "
               "share volume, as a percent. Calls carry positive delta, puts negative; the sign "
               "is the side the day's option volume leans.")


def nope_from(sym: str, dte: str, ch: dict, vol: dict) -> dict:
    net_delta_shares, counted, missing = 0.0, 0, 0
    for r in ch["rows"]:
        if r["delta"] is None or r["volume"] is None:
            missing += 1
            continue
        if not r["volume"]:
            continue
        net_delta_shares += r["delta"] * r["volume"] * 100
        counted += 1
    base = _base(sym, dte, ch, NOPE_METHOD)
    out = {**base, "net_option_delta_shares": round(net_delta_shares), "contracts_counted": counted,
           "contracts_missing_delta_or_volume": missing, "nope": None, "nope_note": None,
           "share_volume": vol.get("today_volume") if vol.get("available") else None}
    if not vol.get("available"):
        out["nope_note"] = f"Share volume unavailable: {vol.get('reason')}."
    elif not vol.get("today_volume"):
        out["nope_note"] = (f"No share volume for {sym} on {vol.get('today_date')} yet; NOPE needs "
                            "today's traded shares.")
    elif counted == 0:
        out["nope_note"] = "No contract in the window carried both delta and today's volume."
    else:
        out["nope"] = round(net_delta_shares / vol["today_volume"] * 100, 2)
    return out


async def nope(sym: str, dte: str = "all") -> dict:
    async def build():
        ch, vol = await asyncio.gather(chain(sym, dte), stock_volume(sym))
        return nope_from(sym, dte, ch, vol)
    return await _cached("nope", sym, dte, build)


# ── FT-050 Options Impact ─────────────────────────────────────────────────────

IMPACT_METHOD = ("Options Impact = absolute gamma notional (gamma x open interest x 100 x spot^2 x "
                 "1%, calls and puts both counted unsigned) divided by the stock's average daily "
                 "dollar volume over its last 20 completed sessions. Low means the stock trades "
                 "far more than dealers would need to hedge a 1% move: ignore the positioning "
                 "read. Bands (under 2% low, 2-8% moderate, above 8% high) are ours and "
                 "uncalibrated.")


def impact_from(sym: str, dte: str, ch: dict, vol: dict) -> dict:
    from api.gex_service import contract_gex
    gross, missing = 0.0, 0
    for r in ch["rows"]:
        if r["oi"] is None or r["gamma"] is None:
            missing += 1
            continue
        if r["oi"] > 0 and r["gamma"]:
            gross += abs(contract_gex(r["gamma"], r["oi"], ch["spot"]))
    base = _base(sym, dte, ch, IMPACT_METHOD)
    out = {**base, "gamma_notional_per_1pct": round(gross), "contracts_missing_gamma_or_oi": missing,
           "adv_dollars": None, "adv_sessions": None, "impact_ratio": None, "band": None,
           "impact_note": None}
    if not vol.get("available"):
        out["impact_note"] = f"Dollar volume unavailable: {vol.get('reason')}."
        return out
    out["adv_dollars"] = round(vol["adv_dollars"]) if vol.get("adv_dollars") else None
    out["adv_sessions"] = vol.get("adv_sessions")
    if not vol.get("adv_dollars"):
        out["impact_note"] = "No completed session with price and volume to average."
        return out
    ratio = gross / vol["adv_dollars"]
    out["impact_ratio"] = round(ratio, 4)
    out["band"] = next((name for cut, name in IMPACT_BANDS if ratio < cut), "high")
    return out


async def impact(sym: str, dte: str = "month") -> dict:
    async def build():
        ch, vol = await asyncio.gather(chain(sym, dte), stock_volume(sym))
        return impact_from(sym, dte, ch, vol)
    return await _cached("impact", sym, dte, build)


# ── FT-047 levels, in the published vocabulary ────────────────────────────────

LEVELS_METHOD = ("Call Wall, Put Wall and Zero Gamma are the GEX page's own levels "
                 "(api/gex_service.py, the same computation). Absolute Gamma and Key Delta "
                 "strikes and max pain are computed here from the same chain (max pain for the "
                 "nearest expiration, named beside it); the implied moves use a 30-day "
                 "constant-maturity at-the-money IV -- the vendor's ATM IV on the two listed "
                 "expirations bracketing 30 calendar days, interpolated in total variance -- "
                 "on the one convention IV x sqrt(trading sessions / 252).")

CM_DAYS = 30


def _atm_iv(sym: str, expiration: str = "") -> Optional[dict]:
    """Vendor ATM IV on one expiration (the chain's default -- the nearest non-0DTE one -- when
    none is named): mean of the call and put IV at the strike closest to spot, from the member
    chain (`polygon_options.get_chain`)."""
    from api.services import polygon_options
    c = polygon_options.get_chain(sym, expiration=expiration, strikes_around_spot=2)
    if not isinstance(c, dict) or c.get("error") or not c.get("spot"):
        return None
    spot = float(c["spot"])
    best = None
    for side in ("calls", "puts"):
        for r in c.get(side) or []:
            if r.get("strike") is None or r.get("iv") is None:
                continue
            d = abs(float(r["strike"]) - spot)
            if best is None or d < best[0]:
                best = (d, float(r["strike"]))
    if best is None:
        return None
    ivs = [float(r["iv"]) for side in ("calls", "puts") for r in c.get(side) or []
           if r.get("strike") is not None and float(r["strike"]) == best[1] and r.get("iv") is not None]
    return {"iv": sum(ivs) / len(ivs), "strike": best[1], "expiration": c.get("expiration"),
            "spot": spot}


def _atm_iv_30d(sym: str, *, today=None) -> Optional[dict]:
    """O6: a 30-day constant-maturity ATM IV. The nearest expiration (often 0DTE) priced the
    1-day and 5-day moves off whatever the last hours of a dying contract were doing. Here the
    two listed expirations that bracket 30 calendar days each give their vendor ATM IV, and the
    30-day IV is interpolated in total variance (IV^2 x days). With only one side listed, that
    expiration is used and the basis says so. None when no ATM IV can be read at all."""
    import datetime as _d
    from zoneinfo import ZoneInfo
    from api.services import polygon_options
    today = today or _d.datetime.now(ZoneInfo("America/New_York")).date()
    listed = polygon_options.list_expirations(sym)
    ok = isinstance(listed, dict) and not listed.get("error")
    dated = []
    for e in (listed.get("expirations") or []) if ok else []:
        try:
            d = (_d.date.fromisoformat(e) - today).days
        except (TypeError, ValueError):
            continue
        if d > 0:
            dated.append((d, e))
    dated.sort()
    below = [x for x in dated if x[0] <= CM_DAYS]
    above = [x for x in dated if x[0] >= CM_DAYS]
    picks = []
    if below:
        picks.append(below[-1])
    if above and (not picks or above[0] != picks[0]):
        picks.append(above[0])
    reads = []
    for d, e in picks:
        a = _atm_iv(sym, e)
        if a is not None and a.get("iv"):
            reads.append((d, e, a))
    if not reads:
        a = _atm_iv(sym)                     # nothing bracketing read: the chain's default expiry
        if a is None:
            return None
        return {**a, "basis": "nearest expiration (no 30-day read)",
                "expirations": [a.get("expiration")]}
    if len(reads) == 1:
        d, e, a = reads[0]
        basis = ("30-day expiration" if d == CM_DAYS
                 else f"single expiration {d} days out (none listed on the other side of 30 days)")
        return {**a, "basis": basis, "expirations": [e]}
    (d1, e1, a1), (d2, e2, a2) = reads
    w1, w2 = a1["iv"] ** 2 * d1, a2["iv"] ** 2 * d2
    w = w1 + (w2 - w1) * (CM_DAYS - d1) / (d2 - d1)
    iv = (max(w, 0.0) / CM_DAYS) ** 0.5
    return {"iv": iv, "strike": a1["strike"], "expiration": None, "spot": a1["spot"],
            "basis": f"30-day constant maturity from {e1} ({d1}d) and {e2} ({d2}d)",
            "expirations": [e1, e2]}


_atm = _atm_iv_30d


def levels_from(sym: str, dte: str, ch: dict, gex: dict, atm: Optional[dict]) -> dict:
    from api.gex_service import contract_gex
    from api.services.options_analytics import move_convention as mc
    from api.services.options_analytics import positioning_vocab as pv
    spot = ch["spot"]
    gamma_by_k: dict = {}
    delta_by_k: dict = {}
    for r in ch["rows"]:
        if r["oi"] is None or r["oi"] <= 0:
            continue
        if r["gamma"]:
            gamma_by_k[r["strike"]] = gamma_by_k.get(r["strike"], 0.0) + abs(
                contract_gex(r["gamma"], r["oi"], spot))
        if r["delta"] is not None:
            delta_by_k[r["strike"]] = delta_by_k.get(r["strike"], 0.0) + r["delta"] * r["oi"] * 100
    mp = max_pain_from(sym, dte, ch)["expirations"]
    ok = not gex.get("error")
    vals = {
        "call_wall": (gex.get("callWall") or {}).get("strike") if ok else None,
        "put_wall": (gex.get("putWall") or {}).get("strike") if ok else None,
        "zero_gamma": round(gex["zeroGamma"], 2) if ok and gex.get("zeroGamma") else None,
        "absolute_gamma_strike": max(gamma_by_k, key=gamma_by_k.get) if gamma_by_k else None,
        "key_delta_strike": max(delta_by_k, key=lambda k: abs(delta_by_k[k])) if delta_by_k else None,
        "max_pain": mp[0]["max_pain"] if mp else None,
        # O11: the one convention, IV x sqrt(trading sessions / 252) (move_convention.py)
        "implied_move_1d": round(spot * mc.sigma(atm["iv"], 1), 2) if atm else None,
        "implied_move_5d": round(spot * mc.sigma(atm["iv"], 5), 2) if atm else None,
    }
    expiration_of = {"max_pain": mp[0]["expiration"] if mp else None}
    roles = (gex.get("levels") or {}) if ok else {}
    role_of = {"call_wall": (roles.get("call_wall") or {}).get("label"),
               "put_wall": (roles.get("put_wall") or {}).get("label"),
               "zero_gamma": (roles.get("zero_gamma") or {}).get("label")}
    rows = []
    for tid in pv.POSITIONING_TERMS:
        if tid not in vals:
            continue
        rows.append({"id": tid, "label": pv.label_of(tid), "value": vals[tid],
                     "unit": "$ move" if tid.startswith("implied_move") else "strike",
                     "role": role_of.get(tid),
                     # O6: which expiration a per-expiry level is FOR (max pain); None elsewhere
                     "expiration": expiration_of.get(tid)})
    notes = []
    if not ok:
        notes.append(f"The GEX levels are unavailable: {gex['error']}.")
    if atm is None:
        notes.append("No at-the-money IV could be read; implied moves are blank.")
    if ok and gex.get("zeroGammaMethod") and not gex.get("zeroGammaIsFlip"):
        notes.append("Zero Gamma here is a stand-in level, not a flip of cumulative gamma "
                     f"(method: {gex['zeroGammaMethod']}).")
    return {**_base(sym, dte, ch, LEVELS_METHOD),
            "vocabulary_version": pv.POSITIONING_VOCABULARY_VERSION, "levels": rows,
            "atm_iv": ({"value": round(atm["iv"], 4), "strike": atm["strike"],
                        "expiration": atm["expiration"], "label": "vendor",
                        "basis": atm.get("basis"), "expirations": atm.get("expirations")}
                       if atm else None),
            "zero_gamma_method": gex.get("zeroGammaMethod") if ok else None,
            "move_convention": mc.CONVENTION_TEXT,
            "notes": notes}


async def levels(sym: str, dte: str = "month") -> dict:
    async def build():
        from api import gex_service
        ch, gex, atm = await asyncio.gather(chain(sym, dte), gex_service.get_gex_data(sym, dte),
                                            asyncio.to_thread(_atm, sym))
        return levels_from(sym, dte, ch, gex if isinstance(gex, dict) else {"error": "no answer"}, atm)
    return await _cached("levels", sym, dte, build)


# ── FT-052 dealer short, explained ─────────────────────────────────────────────

DEALER_SHORT_METHOD = ("From our dealer-positioning table (flow-worker): each contract's estimated "
                       "customer net position from the trade side of every print on our tape "
                       "since its open-interest snapshot. Dealer net = minus customer net. A "
                       "negative dealer position means market makers are estimated to be net "
                       "short that contract. Read for the 100 largest open-interest contracts of "
                       "the latest snapshot.")


def _default_dealer_rows(sym: str) -> Optional[list]:
    """The latest snapshot's largest-OI rows from flow-worker (where flow.db lives since the P5
    cutover), with the service credential. None when the read failed."""
    import httpx
    from api import flow_proxy
    from api.services.options_analytics.market_tide import _flow_base_url
    try:
        r = httpx.get(_flow_base_url() + "/api/dealer-positioning/sample",
                      params={"symbol": sym, "limit": 100},
                      headers=flow_proxy.internal_read_headers(), timeout=10.0)
    except Exception:  # noqa: BLE001 -- a failed read is named by the caller
        return None
    if r.status_code != 200:
        return None
    try:
        return list((r.json() or {}).get("rows") or [])
    except ValueError:
        return None


_dealer_rows = _default_dealer_rows


def dealer_short_from(sym: str, rows: list) -> dict:
    snaps = sorted({r.get("snap_date") for r in rows if r.get("snap_date")})
    latest = snaps[-1] if snaps else None
    out_rows = []
    for r in rows:
        if r.get("snap_date") != latest:
            continue
        cust = r.get("est_customer_net")
        if cust is None:
            continue
        dealer = -float(cust)
        out_rows.append({"contract_key": r.get("contract_key"), "cp": r.get("cp"),
                         "strike": r.get("strike"), "expiration": r.get("expiration"),
                         "open_interest": r.get("oi"), "est_customer_net": cust,
                         "est_dealer_net": round(dealer), "dealer_short": dealer < 0,
                         "flow_confidence": r.get("flow_confidence")})
    short = sorted((r for r in out_rows if r["dealer_short"]), key=lambda r: r["est_dealer_net"])
    sentence = (f"Dealers are estimated net short {len(short)} of the {len(out_rows)} largest "
                f"open-interest contracts on {sym} in the {latest} snapshot." if out_rows else
                f"Our dealer-positioning table holds no estimate for {sym}.")
    return {"symbol": sym, "snapshot": latest, "label": "computed", "method": DEALER_SHORT_METHOD,
            "explanation": ("Negative open interest, read plainly: market makers sold these "
                            "contracts to customers and have not bought them back, so they are "
                            "net short them and hedge in the direction that position requires."),
            "summary": sentence, "contracts": out_rows, "dealer_short": short}


async def dealer_short(sym: str) -> dict:
    async def build():
        rows = await asyncio.to_thread(_dealer_rows, sym)
        if rows is None:
            raise RuntimeError("the dealer-positioning table could not be read")
        return dealer_short_from(sym, rows)
    return await _cached("dealershort", sym, "-", build)
