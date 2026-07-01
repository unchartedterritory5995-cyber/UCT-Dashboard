"""
flow_summary.py — Lightweight per-ticker conviction leaderboard for the
Dashboard "Options Flow" preview tile.

This is a self-contained companion to flow_router.py. It reads the same
flow.db, but instead of serving the full per-trade CSV it computes a compact
top-N per-ticker board (the same shape the Options Flow page's Leaderboard
shows): one row per ticker with net premium, bull %, and that ticker's single
biggest contract.

Ranking is "lightweight by premium" — tickers are ordered by |net premium|
(bull premium − bear premium). This is a faithful-in-spirit mirror of the
full page's board; the page itself adds a richer conviction score (grade +
vol/OI bonuses) that we intentionally do NOT replicate here. Clicking the
preview opens /options-flow for the real depth.

Direction derivation + arb/lottery filtering mirror the logic in
app/src/pages/OptionsFlow.jsx (processFlowData), kept compact:

  Call  + Ask/Above   -> BULL        Put + Ask/Above   -> BEAR
  Call  + Below sweep  -> BEAR        Put + Below sweep -> BULL
  (anything else = ambiguous, dropped)

Endpoint:
    GET /api/flow/top-conviction?limit=10   -> {date, count, items: [...]}
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import anyio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

ET = ZoneInfo("America/New_York")
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

flow_summary_router = APIRouter(prefix="/api/flow", tags=["flow"])

# ── tiny in-memory TTL cache (board is cheap but recomputing per request is
# wasteful when many dashboards poll at once) ───────────────────────────────
_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 60  # seconds


# ── parsing helpers (mirror OptionsFlow.jsx) ────────────────────────────────

def _f(v) -> float:
    """Parse a possibly-formatted numeric string ($, commas) to float."""
    if v is None:
        return 0.0
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _to_cp(raw) -> str:
    s = (raw or "").upper().strip()
    if s == "CALL":
        return "C"
    if s == "PUT":
        return "P"
    return "".join(ch for ch in s if ch in ("C", "P"))[:1]


def _side(raw) -> str:
    s = (raw or "").upper().strip()
    if "ABOVE" in s or s == "AA":
        return "AA"
    if "BELOW" in s or s == "BB":
        return "BB"
    if s == "A" or "ASK" in s:
        return "A"
    if s == "B" or "BID" in s:
        return "B"
    return s


def _color(raw) -> str:
    s = (raw or "").upper().strip()
    if s in ("YELLOW", "Y"):
        return "YELLOW"
    if s in ("MAGENTA", "PURPLE", "M"):
        return "MAGENTA"
    if s == "ORANGE":
        return "ORANGE"
    if s in ("RED", "#FF0000"):
        return "RED"
    return "WHITE"


def _parse_exp(raw):
    """Parse an expiration string (M/D/YYYY or M/D) to a date."""
    if not raw:
        return None
    s = str(raw).strip().replace('"', "")
    parts = s.split("/")
    try:
        if len(parts) == 3:
            y = int(parts[2])
            if y < 100:
                y += 2000
            return date(y, int(parts[0]), int(parts[1]))
        if len(parts) == 2:
            today = date.today()
            d = date(today.year, int(parts[0]), int(parts[1]))
            if d < today:
                d = date(today.year + 1, int(parts[0]), int(parts[1]))
            return d
    except (ValueError, IndexError):
        return None
    return None


def _format_exp(exp, today: date) -> str:
    if not exp:
        return ""
    if exp.year == today.year:
        return f"{exp.month}/{exp.day}"
    return f"{exp.month}/{exp.day}/{str(exp.year)[2:]}"


def _parse_date_mdy(s: str):
    try:
        parts = str(s).strip().split("/")
        if len(parts) == 3:
            return date(int(parts[2]), int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        pass
    return None


# ── core computation ────────────────────────────────────────────────────────

def compute_top_conviction(rows: list[dict], today: date | None = None,
                           limit: int = 10) -> list[dict]:
    """Aggregate raw flow rows into a per-ticker conviction board.

    `rows` are dict-like with the flow.db / BBS column names (Symbol, Type,
    CallPut, Side, Strike, Spot, Premium, Volume, Color, ExpirationDate, Dte,
    MktCap, Sector, ER ...). Returns up to `limit` items ranked by |net premium|.
    """
    if today is None:
        today = datetime.now(ET).date()

    by_sym: dict[str, dict] = {}

    for r in rows:
        type_raw = (r.get("Type") or "").upper().strip()
        is_ml = type_raw == "ML/" or type_raw.startswith("ML/")
        is_swp = type_raw == "SWEEP" or "SWP" in type_raw
        is_blk = type_raw == "BLOCK" or "BLK" in type_raw
        if is_ml or not (is_swp or is_blk):
            continue

        cp = _to_cp(r.get("CallPut"))
        if not cp:
            continue
        if _color(r.get("Color")) == "RED":
            continue

        premium = _f(r.get("Premium"))
        volume = _f(r.get("Volume"))
        if premium <= 0 or volume <= 0:
            continue

        strike = _f(r.get("Strike"))
        spot = _f(r.get("Spot"))
        mktcap = _f(r.get("MktCap"))
        exp = _parse_exp(r.get("ExpirationDate"))
        # Prefer the live DTE from the expiration date; fall back to the CSV Dte.
        dte = (exp - today).days if exp else -1
        if dte < 0:
            try:
                dte = int(_f(r.get("Dte")))
            except (ValueError, TypeError):
                dte = -1
        if dte < 0:
            continue

        side = _side(r.get("Side"))

        # Direction (mirror processFlowData)
        direction = None
        if cp == "C":
            if side in ("AA", "A"):
                direction = "BULL"
            elif side == "BB" and is_swp:
                direction = "BEAR"
        else:
            if side in ("AA", "A"):
                direction = "BEAR"
            elif side == "BB" and is_swp:
                direction = "BULL"
        if not direction:
            continue

        # Lottery-ticket filter: way-OTM + short-DTE on mega/large caps = noise.
        if spot > 0 and 0 <= dte <= 7 and mktcap >= 10e9:
            is_otm = (cp == "C" and strike > spot) or (cp == "P" and strike < spot)
            if is_otm:
                otm_pct = abs(strike - spot) / spot * 100
                limit_pct = 10 if mktcap >= 200e9 else 15
                if otm_pct >= limit_pct:
                    continue

        # Deep-ITM block = arb/rebalancing, drop it (mirror the page's arb filter).
        if spot > 0:
            pct_from_spot = abs(strike - spot) / spot * 100
            is_itm = (cp == "C" and strike < spot) or (cp == "P" and strike > spot)
            if is_blk and is_itm and pct_from_spot >= 10:
                continue

        sym = (r.get("Symbol") or "").upper().strip()
        if not sym:
            continue

        agg = by_sym.setdefault(sym, {
            "sym": sym, "bull": 0.0, "bear": 0.0, "contracts": {},
            "mktcap": mktcap, "sector": (r.get("Sector") or "").strip(),
            "er": False,
        })
        if direction == "BULL":
            agg["bull"] += premium
        else:
            agg["bear"] += premium
        if mktcap > agg["mktcap"]:
            agg["mktcap"] = mktcap
        if (r.get("ER") or "").upper().strip() == "T":
            agg["er"] = True

        ck = (cp, strike, exp)
        c = agg["contracts"].setdefault(ck, {
            "cp": cp, "strike": strike, "exp": exp,
            "prem": 0.0, "hits": 0, "spot": spot,
        })
        c["prem"] += premium
        c["hits"] += 1
        if spot > 0:
            c["spot"] = spot

    items = []
    for agg in by_sym.values():
        total = agg["bull"] + agg["bear"]
        if total <= 0:
            continue
        net = agg["bull"] - agg["bear"]
        direction = "BULL" if net >= 0 else "BEAR"
        bull_pct = round(agg["bull"] / total * 100)

        top = max(agg["contracts"].values(), key=lambda c: c["prem"], default=None)
        top_contract = None
        if top:
            tspot = top["spot"]
            tstrike = top["strike"]
            moneyness, otm_pct = "", 0.0
            if tspot > 0:
                pct = abs(tstrike - tspot) / tspot * 100
                is_atm = pct <= 1.0
                is_itm = (top["cp"] == "C" and tstrike < tspot) or \
                         (top["cp"] == "P" and tstrike > tspot)
                if is_atm:
                    moneyness = "ATM"
                elif is_itm:
                    moneyness = "ITM"
                else:
                    moneyness = "OTM"
                    otm_pct = round(pct)
            top_contract = {
                "cp": top["cp"],
                "strike": tstrike,
                "exp": _format_exp(top["exp"], today),
                "hits": top["hits"],
                "premium": round(top["prem"]),
                "moneyness": moneyness,
                "otmPct": otm_pct,
            }

        items.append({
            "sym": agg["sym"],
            "dir": direction,
            "netPremium": round(abs(net)),
            "bullPct": bull_pct,
            "sector": agg["sector"],
            "er": agg["er"],
            "topContract": top_contract,
        })

    items.sort(key=lambda x: x["netPremium"], reverse=True)
    items = items[:limit]
    for i, it in enumerate(items):
        it["rank"] = i + 1
    return items


# ── DB access ───────────────────────────────────────────────────────────────

def _latest_date(conn, source: str = "stocks"):
    cur = conn.execute(
        "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?", (source,)
    )
    dated = [(d, _parse_date_mdy(d)) for (d,) in cur.fetchall()]
    dated = [(raw, p) for raw, p in dated if p]
    if not dated:
        return None
    dated.sort(key=lambda x: x[1], reverse=True)
    return dated[0][0]


def _fetch_latest_rows(source: str = "stocks") -> tuple[str | None, list[dict]]:
    if not os.path.exists(DB_PATH):
        return None, []
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        latest = _latest_date(conn, source)
        if not latest:
            return None, []
        cur = conn.execute(
            "SELECT * FROM flow WHERE source = ? AND CreatedDate = ?",
            (source, latest),
        )
        rows = [dict(r) for r in cur.fetchall()]
        return latest, rows
    finally:
        conn.close()


def get_top_conviction(limit: int = 10) -> dict:
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(limit)
        if cached and now - cached[0] < _CACHE_TTL:
            return cached[1]

    latest, rows = _fetch_latest_rows("stocks")
    today = datetime.now(ET).date()
    items = compute_top_conviction(rows, today=today, limit=limit) if rows else []
    payload = {"date": latest, "count": len(items), "items": items}

    with _CACHE_LOCK:
        _CACHE[limit] = (now, payload)
    return payload


@flow_summary_router.get("/top-conviction")
async def top_conviction(request: Request):
    try:
        limit = int(request.query_params.get("limit", "10"))
    except (ValueError, TypeError):
        limit = 10
    limit = max(1, min(20, limit))
    try:
        # get_top_conviction() opens flow.db and, on a cold cache, does ~6-13s
        # of disk I/O + Python aggregation. This handler is `async`, so running
        # it inline would block the whole event loop (stalling every request, not
        # just this one). Offload to a worker thread. Steady-state this is a
        # ~80ms cached read; the thread hop is negligible. (2026-07-01 incident.)
        payload = await anyio.to_thread.run_sync(get_top_conviction, limit)
        return JSONResponse(
            payload,
            headers={"Cache-Control": "public, max-age=60"},
        )
    except Exception as e:  # never 500 a dashboard tile
        return JSONResponse({"date": None, "count": 0, "items": [], "error": str(e)})


# ── background cache warmer ──────────────────────────────────────────────────
# The first compute after a (re)deploy reads flow.db cold off the Railway
# volume -- ~6-13s of disk I/O before the OS page cache is warm (the table is
# already indexed; this is purely cold-disk, not a slow query). With the pod
# redeploying frequently, that cold read kept landing on a real user's request.
# Warm it in a daemon thread instead so users always get the ~80ms cached
# payload. Steady-state cost is negligible (each refresh runs cache-warm).
# Disable with FLOW_CONVICTION_WARMER=0.

_WARMER_STARTED = False


def _start_cache_warmer() -> None:
    global _WARMER_STARTED
    if _WARMER_STARTED:
        return
    _WARMER_STARTED = True

    def _warm_loop():
        time.sleep(20)  # let the app finish booting before the first cold read
        while True:
            try:
                get_top_conviction(10)
            except Exception:
                pass
            time.sleep(45)  # under _CACHE_TTL (60s) so the cache never expires cold

    threading.Thread(target=_warm_loop, daemon=True,
                     name="flow-conviction-warmer").start()


if os.environ.get("FLOW_CONVICTION_WARMER", "1") != "0":
    _start_cache_warmer()
