"""OIC with no ticker: the biggest open-interest changes across everything the options log covers.

WHERE THE DATA COMES FROM
  The same two screen files the per-stock OIC reads (`oi_change.py`: the two newest logged sessions of
  our own options log, one row per contract that had an ask, open interest or volume). This module asks
  `oi_change` for the pair it holds (or for its one background mirror of them) and reads nothing else.
  No vendor call, no flow-worker read.

WHAT IT WORKS OUT (once per pair, on ONE background thread; builder rule 5)
  Every contract present in BOTH files with open interest reported in both, compared:
    * by stock: per underlying, the net change in open interest (newer minus earlier) over those
      contracts, the calls' and the puts' own net change, the earlier total and the percent;
    * by contract: the single contracts with the biggest change, either sign.
  Each list is ranked by the SIZE of the change (either sign), ties by name, for every side (any, call,
  put), at most `MAX_ROWS`, the rest counted. New contracts (no earlier figure) and contracts that left
  the log are counted, never ranked: they carry no change, exactly as in the per-stock OIC.
  The traded volume beside a contract is the EARLIER file's (session D-1's own), as in the per-stock OIC.

  Scanning every contract of both files takes seconds, so the request path NEVER does it: it answers at
  once with the held list (or `computing` while the one build runs), and the panel asks again. The
  answer is held in this module, keyed by the pair, never handed over through the shared cache.

Gate: the route (`api/routers/options_screener.py`) sits behind the screener's own switch and paid
dependency. This module adds no switch.
"""
from __future__ import annotations

import heapq
import sqlite3
import threading
import time
from typing import Optional

from api.services.options_analytics import oi_change as oic

MAX_ROWS = 50
VIEWS = ("stocks", "contracts")
SIDES = oic.SIDES                        # any, call, put
#: After a failed build, how long requests are told so before another is tried.
ERROR_HOLD_S = 60.0

_lock = threading.Lock()
_held: Optional[dict] = None             # the built lists for one pair
_inflight: Optional[tuple] = None        # the pair key being built
_failed: Optional[tuple] = None          # (pair key, monotonic seconds, exception name)
builds_started = 0                       # read by the tests


def reset() -> None:
    """Tests only."""
    global _held, _inflight, _failed, builds_started
    with _lock:
        _held, _inflight, _failed, builds_started = None, None, None, 0


def _key(pair: dict) -> tuple:
    return (pair["session"], pair["prior_session"])


def build(pair: dict) -> dict:
    """BLOCKING: one scan of both files. Pure over the pair's two paths; runs on the background thread
    (and directly in tests)."""
    con = sqlite3.connect(f"file:{pair['path']}?mode=ro", uri=True)
    try:
        con.execute("ATTACH DATABASE ? AS prior", (f"file:{pair['prior_path']}?mode=ro",))
        meta = dict(con.execute("SELECT k, v FROM prior.meta").fetchall())
        volume_present = meta.get("volume_present") == "1"
        rows = con.execute(
            "SELECT c.contract, c.underlying, c.exp, c.cp, c.strike_m, c.oi, p.oi, p.vol "
            "FROM main.contracts c JOIN prior.contracts p ON p.contract = c.contract "
            "WHERE c.oi IS NOT NULL AND p.oi IS NOT NULL")
        stocks: dict = {}
        heaps = {sd: [] for sd in SIDES}          # (size, -tiebreak) min-heaps of the biggest contracts
        changed = {sd: 0 for sd in SIDES}
        compared = 0
        for contract, und, exp, cp, strike_m, oi, prior_oi, vol in rows:
            compared += 1
            s = stocks.get(und)
            if s is None:
                s = stocks[und] = {"contracts": 0, "oi": 0, "prior_oi": 0,
                                   "call": {"oi": 0, "prior_oi": 0}, "put": {"oi": 0, "prior_oi": 0}}
            side = "call" if cp == "C" else "put"
            s["contracts"] += 1
            s["oi"] += oi
            s["prior_oi"] += prior_oi
            s[side]["oi"] += oi
            s[side]["prior_oi"] += prior_oi
            change = oi - prior_oi
            if change == 0:
                continue
            item = (abs(change), _neg(contract), contract, und, exp, cp, strike_m, oi, prior_oi, vol)
            for sd in ("any", side):
                changed[sd] += 1
                h = heaps[sd]
                if len(h) < MAX_ROWS:
                    heapq.heappush(h, item)
                elif item[:2] > h[0][:2]:
                    heapq.heapreplace(h, item)
        new = con.execute(
            "SELECT COUNT(*), COALESCE(SUM(c.oi), 0) FROM main.contracts c "
            "WHERE c.oi > 0 AND NOT EXISTS (SELECT 1 FROM prior.contracts p WHERE p.contract = c.contract)").fetchone()
        gone = con.execute(
            "SELECT COUNT(*), COALESCE(SUM(p.oi), 0) FROM prior.contracts p "
            "WHERE NOT EXISTS (SELECT 1 FROM main.contracts c WHERE c.contract = p.contract)").fetchone()
    finally:
        con.close()

    def contract_row(t) -> dict:
        _size, _n, contract, und, exp, cp, strike_m, oi, prior_oi, vol = t
        change = oi - prior_oi
        return {"contract": contract, "symbol": und, "expiration": oic._iso(exp), "strike": strike_m / 1000,
                "type": "call" if cp == "C" else "put", "oi": oi, "prior_oi": prior_oi, "change": change,
                "change_pct": round(change / prior_oi * 100, 1) if prior_oi > 0 else None,
                "volume": vol if volume_present else None}

    def stock_row(und: str, s: dict, sd: str) -> dict:
        part = s if sd == "any" else s[sd]
        change = part["oi"] - part["prior_oi"]
        return {"symbol": und, "contracts": s["contracts"], "oi": part["oi"], "prior_oi": part["prior_oi"],
                "change": change,
                "change_pct": round(change / part["prior_oi"] * 100, 1) if part["prior_oi"] > 0 else None,
                "call_change": s["call"]["oi"] - s["call"]["prior_oi"],
                "put_change": s["put"]["oi"] - s["put"]["prior_oi"]}

    by_stock = {}
    stock_matched = {}
    for sd in SIDES:
        moved = [(und, s) for und, s in stocks.items()
                 if (s if sd == "any" else s[sd])["oi"] != (s if sd == "any" else s[sd])["prior_oi"]]
        stock_matched[sd] = len(moved)
        top = heapq.nsmallest(MAX_ROWS, moved, key=lambda us: (
            -abs((us[1] if sd == "any" else us[1][sd])["oi"] - (us[1] if sd == "any" else us[1][sd])["prior_oi"]), us[0]))
        by_stock[sd] = [stock_row(und, s, sd) for und, s in top]
    by_contract = {sd: [contract_row(t) for t in sorted(heaps[sd], key=lambda t: (-t[0], t[2]))] for sd in SIDES}
    return {"session": pair["session"], "prior_session": pair["prior_session"],
            "skipped_sessions": pair.get("skipped_sessions") or [],
            "stocks": by_stock, "contracts": by_contract,
            "matched": {"stocks": stock_matched, "contracts": changed},
            "underlyings": len(stocks), "compared": compared,
            "new": {"contracts": new[0], "oi": new[1]}, "gone": {"contracts": gone[0], "prior_oi": gone[1]},
            "volume_present": volume_present, "volume_session": pair["prior_session"],
            "built_at": time.time()}


def _neg(name: str) -> tuple:
    """A tiebreak that makes a min-heap keep the alphabetically FIRST contract among equal changes."""
    return tuple(-ord(ch) for ch in name)


def _build_bg(pair: dict) -> None:
    global _held, _inflight, _failed
    key = _key(pair)
    try:
        out = build(pair)
        with _lock:
            _held, _failed = out, None
    except Exception as e:  # noqa: BLE001 -- held by name for ERROR_HOLD_S, then tried again
        with _lock:
            _failed = (key, time.monotonic(), type(e).__name__)
    finally:
        with _lock:
            _inflight = None


def normalize(view: Optional[str], side: Optional[str]) -> tuple:
    v = str(view or "stocks").strip().lower()
    if v not in VIEWS:
        raise oic.BadQuery("view must be stocks or contracts")
    sd = str(side or "any").strip().lower()
    if sd not in SIDES:
        raise oic.BadQuery("side must be call, put or any")
    return v, sd


def market_change(view: Optional[str] = None, side: Optional[str] = None, *, store=None) -> dict:
    """REQUEST PATH: the held lists at once, never a scan. `status`: ok | computing | unavailable |
    no_sessions | one_session (the last two from the per-stock pair, said the same way)."""
    global _inflight, builds_started
    v, sd = normalize(view, side)
    base = {"view": v, "side": sd, "source": oic.SOURCE, "coverage": "Every underlying in the options log's "
            "screen files: " + oic.COVERAGE, "max_rows": MAX_ROWS}
    pair = oic._pair(store, 0.0)
    if pair.get("status") != "ok":
        return {**base, **{k: val for k, val in pair.items() if k in ("status", "session", "error")}}
    key = _key(pair)
    now = time.monotonic()
    with _lock:
        held = _held if _held is not None and (_held["session"], _held["prior_session"]) == key else None
        failed = _failed if (_failed and _failed[0] == key and now - _failed[1] < ERROR_HOLD_S) else None
        stale = _held if held is None else None
        if held is None and _inflight is None and failed is None:
            _inflight = key
            builds_started += 1
            threading.Thread(target=_build_bg, args=(pair,), daemon=True, name="options-oi-market").start()
        building = _inflight == key
    if held is None and failed is not None:
        return {**base, "status": "unavailable", "error": failed[2]}
    got = held or stale
    if got is None:
        return {**base, "status": "computing", "session": pair["session"]}
    rows = got[v][sd]
    return {**base, "status": "ok", "session": got["session"], "prior_session": got["prior_session"],
            "skipped_sessions": got["skipped_sessions"], "rows": [dict(r) for r in rows], "shown": len(rows),
            "matched": got["matched"][v][sd], "underlyings": got["underlyings"], "compared": got["compared"],
            "new": got["new"], "gone": got["gone"], "volume_present": got["volume_present"],
            "volume_session": got["volume_session"], "built_at": got["built_at"],
            "refreshing": held is None and building}
