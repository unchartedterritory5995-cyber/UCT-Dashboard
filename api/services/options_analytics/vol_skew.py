"""FT-018 (lane/o-options-remainders): the RR/BF tenor table and the 3D surface mesh, off TODAY'S
chain through the vol surface's own bounded fetch (`api/services/vol_surface.py::fetch_chains`).

  rr_bf        per sampled expiration: ATM IV, and the 25-delta and 10-delta risk reversal
               (call IV - put IV) and butterfly ((call IV + put IV) / 2 - ATM IV).
  surface_mesh the surface's strike x expiration grid as a mesh for the 3D view.

⛔ IV and delta are the VENDOR'S. The value at a target delta is a LINEAR interpolation in delta
   between the two quoted strikes that bracket it, on the strikes the surface already validated
   (two-sided quote + vendor IV + quote time). A target the quoted strikes do not reach is None
   with its reason: never extrapolated, never a nearest-strike stand-in.
⛔ Plain blocking reads (vendor chains); callers are plain `def` routes. Cached for the chain's 60 s.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from api.services.cache import TTLCache

_ET = ZoneInfo("America/New_York")
TARGETS = (0.25, 0.10)
_CACHE = TTLCache(max_size=256)
RR_BF_METHOD = ("RR = call IV - put IV at the same |delta|; BF = (call IV + put IV) / 2 - ATM IV. "
                "Each IV at a target delta is linearly interpolated in the vendor's delta between "
                "the two quoted strikes that bracket it; ATM IV is the vol surface's own read "
                "(the valid strike nearest spot). Vendor IV and delta; RR and BF computed.")


def clear_cache() -> None:
    _CACHE.clear()


def iv_at_delta(points: list, target: float) -> tuple[Optional[float], Optional[str]]:
    """(iv, reason). `points` = surface points [{iv, delta}] of ONE side; `target` = |delta|."""
    pts = sorted(((abs(p["delta"]), p["iv"]) for p in points
                  if isinstance(p.get("delta"), (int, float)) and isinstance(p.get("iv"), (int, float))),
                 key=lambda x: x[0])
    if len(pts) < 2:
        return None, "fewer than two quoted strikes carry a vendor delta"
    lo_d, hi_d = pts[0][0], pts[-1][0]
    if not lo_d <= target <= hi_d:
        return None, f"the quoted strikes span |delta| {lo_d:.2f} to {hi_d:.2f}; {target:.2f} is not reached"
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        if d0 <= target <= d1:
            if d1 == d0:
                return v0, None
            return v0 + (v1 - v0) * (target - d0) / (d1 - d0), None
    return None, "no bracketing pair"


def tenor_row(e: dict) -> dict:
    """One expiration's row from vol_surface.build_expiration output."""
    row = {"expiration": e["expiration"], "dte": e["dte"], "atm_iv": e["atm_iv"],
           "atm_reason": e.get("reason")}
    for tgt in TARGETS:
        tag = f"{int(round(tgt * 100))}d"
        c, cwhy = iv_at_delta(e["calls"]["points"], tgt)
        p, pwhy = iv_at_delta(e["puts"]["points"], tgt)
        row[f"call_iv_{tag}"] = None if c is None else round(c, 4)
        row[f"put_iv_{tag}"] = None if p is None else round(p, 4)
        row[f"rr_{tag}"] = None if c is None or p is None else round(c - p, 4)
        row[f"bf_{tag}"] = (None if c is None or p is None or e["atm_iv"] is None
                            else round((c + p) / 2 - e["atm_iv"], 4))
        why = [f"calls: {cwhy}" if cwhy else None, f"puts: {pwhy}" if pwhy else None]
        if e["atm_iv"] is None and c is not None and p is not None:
            why.append("no at-the-money IV for the butterfly")
        row[f"reason_{tag}"] = "; ".join(w for w in why if w) or None
    return row


def rr_bf(sym: str) -> dict:
    """Raises RuntimeError with the provider's words when no expiration could be fetched."""
    from api.services import vol_surface as vs
    hit = _CACHE.get(f"rrbf::{sym}")
    if hit is not None:
        return dict(hit)
    got = vs.fetch_chains(sym)
    if "error" in got:
        raise RuntimeError(got["error"])
    today = datetime.now(_ET).date()
    exps = sorted((vs.build_expiration(c, today) for c in got["chains"]), key=lambda e: e["expiration"] or "")
    out = {"symbol": sym, "label": "computed", "method": RR_BF_METHOD, "iv_source": vs.IV_SOURCE,
           "iv_source_text": vs.IV_SOURCE_TEXT, "basis": vs.BASIS_TEXT,
           "spot": next((e["spot"] for e in exps if e["spot"]), None),
           "tenors": [tenor_row(e) for e in exps], "expirations_listed": len(got["listed"]),
           "missing": got["missing"],
           "strikes_note": (f"Each tenor reads the {vs.STRIKES_AROUND_SPOT * 2} strikes nearest spot per side, "
                            "so a far delta (10) may not be reached on a wide-strike name."),
           "served_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    _CACHE.set(f"rrbf::{sym}", dict(out), 60)
    return out


def surface_mesh(sym: str) -> dict:
    """The surface grid as {expirations:[{expiration,dte}], strikes, z[strike][expiration]}."""
    from api.services import vol_surface as vs
    s = vs.get_surface(sym)
    if not isinstance(s, dict) or s.get("error"):
        raise RuntimeError((s or {}).get("error", "no surface"))
    grid = s.get("grid") or {}
    dte = {p["expiration"]: p["dte"] for p in (s.get("term") or {}).get("points") or []}
    exps = list(grid.get("expirations") or [])
    rows = grid.get("rows") or []
    z = [[(c["iv"] if c else None) for c in r["cells"]] for r in rows]
    filled = sum(1 for r in z for v in r if v is not None)
    return {"symbol": sym, "label": "vendor", "iv_source_text": s.get("iv_source_text"),
            "basis": s.get("basis"), "spot": s.get("spot"), "side_rule": grid.get("side_rule"),
            "expirations": [{"expiration": x, "dte": dte.get(x)} for x in exps],
            "strikes": [r["strike"] for r in rows], "z": z,
            "cells_filled": filled, "cells_total": len(rows) * len(exps),
            "note": "A blank cell is a strike with no valid quote at that expiry; it is left open, never interpolated.",
            "served_at": s.get("served_at")}
