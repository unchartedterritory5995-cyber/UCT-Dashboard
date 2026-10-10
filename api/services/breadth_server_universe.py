"""The UCT breadth universe, built on the SERVER — the list the 4:15pm PC collector builds.

⭐ WHY (2026-10-10, owner): "find a solution so that we do not have to rely on my PC". The
EOD server row (`breadth_eod_source`) already computes the price metrics on the web pod, but
it measured them over the COLLECTOR's `universe_list`, so the PC still decided which names
count. This module makes the same decision here, from the same inputs.

THE COLLECTOR'S RULE (uct-intelligence `scripts/breadth_collector.py::_get_universe`),
reproduced, not reinterpreted:
  1. type CS or ADRC              (Massive reference, market=stocks)
  2. close  >= $2.00              (the newest Massive daily FLAT FILE — at 4:15pm on session
  3. volume >= 200,000             D that file is D-1's, so D is measured over D-1's list)
  4. market cap >= $300M          (Massive ticker details; no cap on record = EXCLUDED)
  5. minus a manual exclude set   (`EXCLUDE`, copied from the collector)

Here: (1) `breadth_pit_frame.reference_map()` resolved on the basis date, (2)(3) the RAW
grouped-daily frame of the session BEFORE D, (4) `screener_rows.market_cap` — the nightly
screener snapshot, filled from the same Massive ticker-details call the collector's nightly
ingest uses.

⛔ NOTHING HERE IS PUBLISHED BY ITSELF. `breadth_eod_source` measures over this list in shadow
(graded against the collector row) and, once armed, in `server` mode. A list that fails its
own sanity floor (`MIN_SIZE`) is refused, never used, and the caller falls back to the
collector's list.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Optional

_log = logging.getLogger("breadth_server_universe")

PRICE_FLOOR = 2.0
VOLUME_FLOOR = 200_000
CAP_FLOOR = 300_000_000
TYPES = frozenset({"CS", "ADRC"})
# The collector's `universe_exclude._MANUAL` (uct-intelligence, 2026-10-10), verbatim. Its
# other half — buyouts CONFIRMED by the PC's `buyout_sweep.py` — lives only on the PC, so
# `excluded()` adds the server's own owner-maintained buyout list
# (`screener_universe.buyout_excludes`). A name the PC excludes and we do not shows up in
# the parity run's `only_server` list, named.
EXCLUDE = frozenset({
    "SMX", "CNTA", "KALV", "CPRX", "AVNS", "OGN", "SILA", "CCRN", "ESPR", "GBTG",
    "WSR", "RAMP", "ZKP", "RREV", "NUVL", "LPRO", "THMC", "PAYO", "SLP", "APGE",
    "CRNX", "ACA", "ATAI", "TECH", "FBRX", "UTZ", "LXP", "CBZ", "MKTX", "ITGR",
})


def excluded() -> frozenset:
    try:
        from api.services.screener import screener_universe
        return EXCLUDE | screener_universe.buyout_excludes()
    except Exception:
        return EXCLUDE
MIN_SIZE = 1000                       # the collector's list is ~2,500-3,000 names
KEEP_SESSIONS = 60

_DATA = os.environ.get("DATA_DIR", "/data")
_lock = threading.Lock()


def _path() -> str:
    return os.environ.get("BREADTH_SERVER_UNIVERSE_PATH") or os.path.join(
        _DATA, "breadth_server_universe.json")


def _load() -> dict:
    try:
        with open(_path()) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _save(store: dict) -> None:
    keep = dict(sorted(store.items())[-KEEP_SESSIONS:])
    tmp = _path() + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(keep, fh, separators=(",", ":"))
    os.replace(tmp, _path())


def previous_session(date_iso: str) -> Optional[str]:
    """The newest bars.db session strictly before `date_iso` (SPY's daily bars)."""
    from api.services import breadth_live as bl
    from datetime import date as _date
    try:
        ts = bl._ts_int(_date.fromisoformat(date_iso))
        row = bl._bars_conn().execute(
            "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ? "
            "ORDER BY ts DESC LIMIT 1", (ts,)).fetchone()
        return bl._iso(int(row[0])) if row else None
    except Exception:
        return None


def market_caps() -> dict:
    """{TICKER: market_cap} from the screener snapshot (non-null caps only)."""
    from contextlib import closing
    from api.services.screener import snapshot_db
    with closing(snapshot_db.connect()) as c:
        rows = c.execute("SELECT ticker, market_cap FROM screener_rows "
                         "WHERE market_cap IS NOT NULL AND market_cap > 0").fetchall()
    return {str(t).upper(): float(m) for t, m in rows}


def select(day_rows: dict, ref_map: dict, caps: dict, basis_date: str,
           exclude: Optional[frozenset] = None) -> tuple[list, dict]:
    """The collector's filter over one day's raw frame. Pure: `(tickers, counts)`."""
    from api.services import breadth_pit_frame as bpf
    exclude = EXCLUDE if exclude is None else exclude
    counts = {"frame": len(day_rows or {}), "not_common": 0, "unresolved": 0,
              "fail_price": 0, "fail_volume": 0, "no_cap": 0, "fail_cap": 0,
              "excluded": 0, "eligible": 0}
    out = []
    for sym, r in (day_rows or {}).items():
        sym = str(sym).upper()
        rec = bpf.resolve(ref_map.get(sym), basis_date)
        if rec is None:
            counts["unresolved"] += 1
            continue
        if rec.get("type") not in TYPES:
            counts["not_common"] += 1
            continue
        try:
            c, v = r.get("c"), r.get("v")
        except AttributeError:
            counts["unresolved"] += 1
            continue
        if c is None or c < PRICE_FLOOR:
            counts["fail_price"] += 1
            continue
        if v is None or v < VOLUME_FLOOR:
            counts["fail_volume"] += 1
            continue
        cap = caps.get(sym)
        if cap is None:
            counts["no_cap"] += 1
            continue
        if cap < CAP_FLOOR:
            counts["fail_cap"] += 1
            continue
        if sym in exclude:
            counts["excluded"] += 1
            continue
        out.append(sym)
    out.sort()
    counts["eligible"] = len(out)
    return out, counts


def build(date_iso: str, force: bool = False) -> dict:
    """The server universe for session `date_iso`: `{ok, tickers, basis_date, counts}`.
    Persisted per session, so a session's list never changes once built (PIT)."""
    with _lock:
        store = _load()
        hit = store.get(date_iso)
        if hit and not force:
            return {"ok": True, **hit}
    basis = previous_session(date_iso)
    if not basis:
        return {"ok": False, "reason": "no previous session in bars.db"}
    try:
        from api.services import massive
        from api.services import breadth_pit_frame as bpf
        frame = (massive.get_grouped_daily_frame(basis, adjusted=False) or {}).get("rows") or {}
        ref = bpf.reference_map()
        caps = market_caps()
    except Exception as e:                       # noqa: BLE001 - reported, the caller falls back
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"}
    if not frame:
        return {"ok": False, "reason": f"no grouped-daily frame for {basis}"}
    if len(caps) < MIN_SIZE:
        return {"ok": False, "reason": f"screener holds only {len(caps)} market caps"}
    tickers, counts = select(frame, ref, caps, basis, excluded())
    if len(tickers) < MIN_SIZE:
        return {"ok": False, "reason": f"only {len(tickers)} names passed (floor {MIN_SIZE})",
                "counts": counts}
    entry = {"tickers": tickers, "basis_date": basis, "counts": counts,
             "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with _lock:
        store = _load()
        store[date_iso] = entry
        try:
            _save(store)
        except Exception as e:                   # noqa: BLE001
            _log.warning("[server-universe] persist failed: %s", e)
    return {"ok": True, **entry}


def compare(server: list, collector: list) -> dict:
    """Overlap of two lists, names by example — for the parity report."""
    s, c = set(server or ()), set(collector or ())
    return {"server": len(s), "collector": len(c), "both": len(s & c),
            "only_server": sorted(s - c)[:25], "only_server_n": len(s - c),
            "only_collector": sorted(c - s)[:25], "only_collector_n": len(c - s),
            "jaccard": round(len(s & c) / len(s | c), 4) if (s | c) else None}
