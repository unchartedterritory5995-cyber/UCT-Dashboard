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
import threading
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
# Selectable lookback windows (trading days). The default (DAYS) is kept warm by
# the scheduler; the others warm on first request (background build) and refresh
# when stale — never on the request path.
_ALLOWED_DAYS = sorted({DAYS} | {int(x) for x in
    os.environ.get("CONFLUENCE_ALLOWED_DAYS", "20,30,60,90").split(",")
    if str(x).strip().isdigit()})
_CACHES: dict = {}                        # days -> {"at": float, "board": dict}
_LOCKS: dict = {}                         # days -> threading.Lock (single-flight per window)
_LOCKS_GUARD = threading.Lock()


def _lock_for(days: int) -> threading.Lock:
    with _LOCKS_GUARD:
        lk = _LOCKS.get(days)
        if lk is None:
            lk = _LOCKS[days] = threading.Lock()
        return lk

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


def compute_board(days: int = DAYS) -> dict:
    """Full recompute of the confluence board for a lookback of `days` trading days.
    Slow (~4 min: two ~120s flow legs + fast 5d legs + dark-pool read). Runs off the
    request path via the scheduler / background window builds."""
    # options-flow leg — `days` (conviction) + 5d (freshness), large + mid_small
    flow, flow5, warnings = {}, {}, []
    legs_pending = False
    for cap in ("large", "mid_small"):
        d = _flow_leg(cap, days)
        if d.get("ok"):
            flow.update(d.get("names") or {})
        else:
            reason = d.get("reason") or d.get("status") or "flow leg failed"
            warnings.append(reason)
            if "comput" in str(reason).lower():
                legs_pending = True         # the worker is still BUILDING this leg
        d5 = _flow_leg(cap, 5)
        if d5.get("ok"):
            flow5.update(d5.get("names") or {})

    # A leg still computing on the worker means the board would be PARTIAL (e.g. only
    # mid-small if the large leg isn't ready). Do NOT cache a thin board over a good
    # one — report warming so the client keeps polling (fast) and the next compute,
    # once the worker's leg is ready, gets the full board. (Caching 37/254 for a full
    # 30-min TTL was the 2026-09-12 post-deploy thin-board bug.)
    if legs_pending:
        return {"ok": False, "status": "warming", "days": days, "rows": [],
                "reason": "flow leg still computing on the worker"}

    # If the flow leg produced nothing (both bands failed / timed out), this is a
    # DEGRADED compute — return ok:false so get_board keeps the last-good board
    # instead of caching an empty 0-row result over it (the 2026-08-31 regression).
    if not flow:
        return {"ok": False, "status": "flow_unavailable", "rows": [], "days": days,
                "reason": "; ".join(warnings) or "flow leg empty"}

    # dark-pool aggregate for the window — local (web owns darkpool.db)
    if not dpa.is_window_warm(days=days):
        dpa.build_window_background(days=days)
        return {"ok": False, "status": "warming", "days": days,
                "reason": f"dark-pool {days}d window building", "rows": []}
    dp = dpa.get_aggregated(days=days)
    dpmap = {x["t"]: x for x in (dp.get("allItems") or [])}
    window = dp.get("meta", {}).get("dateRange", "")

    ref = date.today()

    def _dte_days(s):
        try:
            return int(str(s).replace("d", "").strip())
        except Exception:  # noqa: BLE001
            return 0

    # ETF exclusion source. The Massive dark-pool feed no longer carries
    # SecurityType (only the retired BBS rows did), so the old
    # `securityType == "Equity"` gate drops EVERY name once the BBS rows age out
    # of the trailing window. We exclude ETFs instead via the same authoritative
    # FMP `isEtf` classifier the Dark Pool EOD card uses (cached per name/day,
    # fail-soft), applied to gate SURVIVORS only so the profile calls stay cheap.
    try:
        from api.darkpool_eod import _ticker_meta, _ETF_OVERRIDE
    except Exception:  # noqa: BLE001
        def _ticker_meta(_s):                          # fail-soft: never drops a name
            return {"sector": None, "isEtf": None}
        _ETF_OVERRIDE = set()

    rows = []
    for sym, f in flow.items():
        d = dpmap.get(sym)
        if not d:
            continue
        band = _BANDS.get(d.get("cat"))
        if not band:                                   # drops Indexes/ETF cats (Mega folds into Large)
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
        # Dark-pool DIRECTION is no longer gated on the accumulation call — a single
        # unsigned dark print names a price, not a buyer, so it can't reveal intent
        # (owner decision 2026-09-12). The dark-pool leg now contributes SIZE
        # (dpn >= DP_MIN); direction comes from the options flow, and the card shows
        # price-vs-their-average-price as live context instead of an Acc/Dist verdict.
        bull_ok = net > 0 and bull >= FLOW_MIN and dpn >= DP_MIN
        bear_ok = net < 0 and bear >= FLOW_MIN and dpn >= DP_MIN
        if not (bull_ok or bear_ok):
            continue
        # Survivor is a real confluence candidate — spend one cached FMP profile
        # call to (a) drop an ETF the cat-band's hardcoded lists miss (VOO/IGV/
        # IEFA-class, whose AUM mis-sizes them into a cap band) and (b) fill the
        # sector the Massive feed leaves blank. Fail-soft: an unavailable profile
        # never drops a name.
        sector = d.get("sector") or None
        if sym in _ETF_OVERRIDE:
            continue
        try:
            meta = _ticker_meta(sym) or {}
        except Exception:  # noqa: BLE001 — fail-soft: a bad profile never drops a name
            meta = {}
        if meta.get("isEtf"):
            continue
        if not sector:
            sector = meta.get("sector")
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
            # dark-pool structure for the price-vs-zone ladder. The frontend overlays
            # the LIVE price on top of these to compute the green/red performance vs
            # the average (vwap). dpLast (last dark-pool session price) is the fallback
            # when no live quote is available, so the ladder always renders.
            "dpLo": d.get("lo"), "dpHi": d.get("hi"), "dpAvg": d.get("vwap"),
            "dpLast": d.get("last"), "bigPrice": d.get("bigPrint"),
            "sector": sector,
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
    return {"ok": True, "window": window, "days": days, "rows": rows,
            "counts": counts, "band_meta": _BAND_META,
            "allowedDays": _ALLOWED_DAYS, "warnings": warnings or None}


_WARMING = {"ok": False, "status": "warming",
            "reason": "board is computing — try again shortly", "rows": []}


def _compute_and_cache(days: int) -> dict:
    """Compute ONE window under its single-flight lock and cache on success."""
    lk = _lock_for(days)
    if not lk.acquire(blocking=False):               # a build for this window is running
        return (_CACHES.get(days) or {}).get("board") or _WARMING
    try:
        board = compute_board(days)
        if board.get("ok"):
            _CACHES[days] = {"at": time.time(), "board": board}
        return (_CACHES.get(days) or {}).get("board") or board
    finally:
        lk.release()


def _build_background(days: int) -> None:
    threading.Thread(target=_compute_and_cache, args=(days,), daemon=True,
                     name=f"confluence-build-{days}d").start()


def get_board(days: int = DAYS, force: bool = False) -> dict:
    """READ path: serve the cached board for `days`. NEVER computes inline, so
    /api/confluence can't hang the request/gateway. A cold or stale window is
    (re)built in the BACKGROUND and the last-good board is served meanwhile; the
    default window is also kept warm by the scheduler. force=True (scheduler /
    admin) computes inline, single-flight per window."""
    days = days if days in _ALLOWED_DAYS else DAYS
    if force:
        return _compute_and_cache(days)
    entry = _CACHES.get(days) or {}
    board = entry.get("board")
    if board is None or (time.time() - entry.get("at", 0)) >= _TTL:
        _build_background(days)                       # warm / refresh off the request path
    return board or _WARMING                          # stale-but-good while rebuilding


def scheduled_refresh():
    """APScheduler entry — force a recompute of the DEFAULT window so its cache
    stays warm. Other windows warm on demand and self-refresh when stale."""
    try:
        get_board(days=DAYS, force=True)
    except Exception:  # noqa: BLE001
        pass
