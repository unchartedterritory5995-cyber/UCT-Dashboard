"""confluence_screen.py — the JOIN: dark-pool accumulation × LEAP/size-with-time flow.

WEB-side service. Fetches the options-flow leg from the flow-worker over the
INTERNAL private network (WORKER_INTERNAL_URL — no Cloudflare gateway, so a ~120s
flow compute is fine), reads the dark-pool 30d aggregate locally (darkpool_aggregator,
web owns darkpool.db), joins by ticker, applies the confluence gate + status, ranks
within cap band, and CACHES the final board. `/api/confluence` serves that cache
instantly — it never computes on the request path (a scheduler pre-warms it).

Gate (per name, in the 30d window):
  1. Sized dark pool + accumulation  — dpn >= DP_MIN and accDist == 'Acc' (bull) / 'Dist' (bear)
  2. Aligned directional flow         — net matches, bull/bear >= FLOW_MIN
  3. LEAP-led                          — leap_share >= LEAP_SHARE_MIN OR leap_prem >= LEAP_PREM_MIN
Status (freshness = a TAG, never a filter): 5d net vs 30d net ->
  BUILDING (>=BUILDING_FRAC, adding now) / STEADY (still adding) / ESTABLISHED (positioned, resting)
"""
import os
import time
from datetime import date

import httpx

from api import darkpool_aggregator as dpa

WORKER_INTERNAL_URL = os.environ.get("WORKER_INTERNAL_URL", "").rstrip("/")
_PUSH_SECRET = (os.environ.get("PUSH_SECRET") or "").strip()

DAYS = int(os.environ.get("CONFLUENCE_DAYS", "30"))
MIN_DTE = int(os.environ.get("CONFLUENCE_MIN_DTE", "30"))
# gate thresholds (env-tunable)
DP_MIN = float(os.environ.get("CONFLUENCE_DP_MIN", "25000000"))          # $25M dark-pool 30d notional
FLOW_MIN = float(os.environ.get("CONFLUENCE_FLOW_MIN", "2000000"))       # $2M bull (or bear) premium
LEAP_SHARE_MIN = float(os.environ.get("CONFLUENCE_LEAP_SHARE_MIN", "0.15"))
LEAP_PREM_MIN = float(os.environ.get("CONFLUENCE_LEAP_PREM_MIN", "3000000"))
BUILDING_FRAC = float(os.environ.get("CONFLUENCE_BUILDING_FRAC", "0.40"))

_TTL = float(os.environ.get("CONFLUENCE_BOARD_TTL", "1800"))            # 30 min
_CACHE: dict = {"at": 0.0, "board": None}

_BANDS = {"Large Cap": "L", "Mid Cap": "M", "Small Cap": "S"}
_BAND_META = {"L": ("Large Cap", "$10B – $500B"), "M": ("Mid Cap", "$2B – $10B"),
              "S": ("Small Cap", "< $2B")}


def _flow_leg(cap: str, days: int) -> dict:
    """Fetch the options-flow leg from the flow-worker over the private network."""
    if not WORKER_INTERNAL_URL:
        return {"ok": False, "reason": "WORKER_INTERNAL_URL unset", "names": {}}
    url = (f"{WORKER_INTERNAL_URL}/api/live/massive/confluence-flow"
           f"?days={days}&min_dte={MIN_DTE}&cap={cap}")
    hdr = {"Authorization": f"Bearer {_PUSH_SECRET}"} if _PUSH_SECRET else {}
    try:
        r = httpx.get(url, headers=hdr, timeout=httpx.Timeout(200.0, connect=10.0))
        r.raise_for_status()
        return r.json()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": f"flow-leg {cap}/{days}d: {e}", "names": {}}


def _pctile(vals):
    s = sorted(vals)
    n = len(s) or 1
    return {v: (s.index(v) + 1) / n for v in set(vals)}


def compute_board() -> dict:
    """Full recompute of the confluence board. Slow (~4 min: two 120s flow legs +
    fast 5d legs + dark-pool read). Runs off the request path via the scheduler."""
    # options-flow leg — 30d (conviction) + 5d (freshness), large + mid_small
    flow, flow5, warnings = {}, {}, []
    for cap in ("large", "mid_small"):
        d = _flow_leg(cap, DAYS)
        if d.get("ok"):
            flow.update(d.get("names") or {})
        else:
            warnings.append(d.get("reason", "flow leg failed"))
        d5 = _flow_leg(cap, 5)
        if d5.get("ok"):
            flow5.update(d5.get("names") or {})

    # dark-pool 30d aggregate — local (web owns darkpool.db)
    if not dpa.is_window_warm(days=DAYS):
        dpa.build_window_background(days=DAYS)
        return {"ok": False, "status": "warming", "reason": "dark-pool 30d window building",
                "rows": []}
    dp = dpa.get_aggregated(days=DAYS)
    dpmap = {x["t"]: x for x in (dp.get("allItems") or [])}
    window = dp.get("meta", {}).get("dateRange", "")

    ref = date.today()

    def _dte_days(s):
        try:
            return int(str(s).replace("d", "").strip())
        except Exception:  # noqa: BLE001
            return 0

    rows = []
    for sym, f in flow.items():
        d = dpmap.get(sym)
        if not d or d.get("securityType") != "Equity":
            continue
        band = _BANDS.get(d.get("cat"))
        if not band:                                   # drops Mega + Indexes/ETF
            continue
        net = f.get("net") or 0
        bull = f.get("bull") or 0
        bear = f.get("bear") or 0
        acc = d.get("accDist")
        dpn = d.get("n") or 0
        leap_prem = f.get("leap_prem") or 0
        leap_share = f.get("leap_share") or 0
        if not (leap_share >= LEAP_SHARE_MIN or leap_prem >= LEAP_PREM_MIN):
            continue                                    # LEAP-led gate
        bull_ok = net > 0 and acc == "Acc" and bull >= FLOW_MIN and dpn >= DP_MIN
        bear_ok = net < 0 and acc == "Dist" and bear >= FLOW_MIN and dpn >= DP_MIN
        if not (bull_ok or bear_ok):
            continue
        net5 = (flow5.get(sym) or {}).get("net") or 0
        ratio = abs(net5) / abs(net) if net else 0
        if net5 * net > 0 and ratio >= BUILDING_FRAC:
            status = "BUILDING"
        elif net5 * net > 0 and ratio > 0:
            status = "STEADY"
        else:
            status = "ESTABLISHED"
        top = f.get("top") or {}
        rows.append({
            "sym": sym, "band": band, "dir": "BULL" if bull_ok else "BEAR",
            "dpn": dpn, "acc": acc, "net": net, "net5": net5, "bull": bull, "bear": bear,
            "bullPct": f.get("bullPct"),
            "top": {"cp": top.get("cp"), "strike": top.get("strike"), "exp": top.get("exp"),
                    "dte": _dte_days(top.get("dte")), "prem": top.get("prem") or 0},
            "leapPrem": leap_prem, "leapShare": round(leap_share, 3),
            "status": status, "freshRatio": round(ratio, 2),
            "bigPrint": d.get("bigPrintN") or 0, "bigDate": d.get("bigPrintDate"),
            "sector": d.get("sector"),
        })

    # rank within (band, dir): dp size + net + leap-share + freshness weight
    W = {"BUILDING": 0.5, "STEADY": 0.25, "ESTABLISHED": 0.0}
    for band in "LMS":
        for dr in ("BULL", "BEAR"):
            g = [r for r in rows if r["band"] == band and r["dir"] == dr]
            if not g:
                continue
            pdp = _pctile([r["dpn"] for r in g])
            pnet = _pctile([abs(r["net"]) for r in g])
            for r in g:
                r["score"] = round(pdp[r["dpn"]] + pnet[abs(r["net"])]
                                   + min(r["leapShare"], 0.4) + W[r["status"]], 3)
    rows.sort(key=lambda r: -r["score"])

    counts = {"total": len(rows),
              "bull": sum(1 for r in rows if r["dir"] == "BULL"),
              "bear": sum(1 for r in rows if r["dir"] == "BEAR"),
              "building": sum(1 for r in rows if r["status"] == "BUILDING")}
    return {"ok": True, "window": window, "days": DAYS, "rows": rows,
            "counts": counts, "band_meta": _BAND_META,
            "warnings": warnings or None}


def get_board(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["board"] and now - _CACHE["at"] < _TTL:
        return _CACHE["board"]
    board = compute_board()
    if board.get("ok"):
        _CACHE["at"] = now
        _CACHE["board"] = board
    elif _CACHE["board"]:
        # keep serving the last good board if a recompute is mid-warm
        return _CACHE["board"]
    return board


def scheduled_refresh():
    """APScheduler entry — force a recompute so the cache stays warm."""
    try:
        get_board(force=True)
    except Exception:  # noqa: BLE001
        pass
