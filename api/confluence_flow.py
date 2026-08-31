"""confluence_flow.py — the OPTIONS-FLOW leg of the Confluence screen (flow-worker).

Reuses weekly_flow's tested still-open engine (load_directional_trades + aggregate)
so numbers match the Open-Flow board exactly, then adds the two fields the board
never exposed: the TOP CONTRACT's premium (e["top"]["prem"]) and the LEAP SHARE
(still-open premium in contracts with DTE >= LEAP_MIN_DTE, over total).

Runs on the FLOW-WORKER (owns the live flow.db); reached from web via the proxied
/api/live/massive/confluence-flow route. Never raises — returns {"ok": False,...}.

Why here and not a per-ticker CSV pull: the bulk flow CSV caps at the top-50k
prints by premium, so a large-cap LEAP built from many small prints is invisible
there (NKE C40 6/17/27 came back $0). flow.db is uncapped, so this is exact.
"""
import os
import time
from datetime import date

from api import weekly_flow as wf

LEAP_MIN_DTE = int(os.environ.get("CONFLUENCE_LEAP_MIN_DTE", "180"))
_CACHE: dict = {}
_TTL = float(os.environ.get("CONFLUENCE_FLOW_TTL", "120"))


def _leap_premium(contracts: dict, ref: date) -> float:
    """Sum still-open premium sitting in LEAP-dated contracts (DTE >= LEAP_MIN_DTE)."""
    lp = 0.0
    for c in contracts.values():
        d = wf._parse_mdy(c.get("exp", ""))
        if d and (d - ref).days >= LEAP_MIN_DTE:
            lp += c.get("prem", 0.0) or 0.0
    return lp


def flow_leg(*, days: int = 30, min_dte: int = 30, cap: str = "all",
             frac: float = 0.75) -> dict:
    """Per-ticker options-flow leg for the confluence join.

    Returns {"ok", "window", "names": {SYM: {net,bull,bear,bullPct,
      top:{cp,strike,exp,dte,prem}, leap_prem, leap_share, since}}}.
    120s TTL-cached per params. min_dte=30 matches the board (excludes gamma).
    """
    cap = (cap or "all").strip().lower()
    ckey = (days, min_dte, cap, frac)
    now = time.time()
    hit = _CACHE.get(ckey)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    try:
        trades, window = wf.load_directional_trades(days, min_dte, cap, min_premium=0.0)
        agg = wf.aggregate(trades, top_n=10 ** 9, still_open_frac=frac)
        ref = date.today()
        names: dict = {}
        for e in agg["bulls"] + agg["bears"]:
            tot = (e["bull"] or 0) + (e["bear"] or 0)
            lp = _leap_premium(e.get("contracts") or {}, ref)
            tc = e.get("top") or {}
            names[e["sym"]] = {
                "net": e["net"], "bull": e["bull"], "bear": e["bear"],
                "bullPct": e["bullPct"],
                "top": {
                    "cp": tc.get("cp"), "strike": tc.get("K"), "exp": tc.get("exp"),
                    "dte": wf._dte_of(tc.get("exp"), ref) if tc.get("exp") else None,
                    "prem": round(tc.get("prem", 0.0) or 0.0, 2),
                },
                "leap_prem": round(lp, 2),
                "leap_share": round(lp / tot, 4) if tot else 0.0,
                "since": e["first"].isoformat() if e.get("first") else None,
            }
        res = {"ok": True, "window": window, "days": days, "cap": cap,
               "n_names": len(names), "names": names}
        _CACHE[ckey] = (now, res)
        return res
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": f"error: {e}", "names": {}}
