"""UCT breadth history before the collector (2008 → 2025), rebuilt POINT-IN-TIME.

⭐⭐ WHY (owner, 2026-11-22). UCT's rows before the collector's first session (2026-01-02) were
today's UCT list run backward (`breadth_history_recon`): a stock that became a leader later is in
the list during its run-up, and a company that died is not in it at all. Old years read hot, recent
years cold, and the shading ranked that drift (measured: Up 20%/5d at Strong or Extreme on 94% of
all sessions). Interim fix #2535 stopped shading those rows; this module serves a correct history.

⭐ HOW THE HISTORY IS BUILT (once, on the breadth runner; tools/breadth/uct_pit/):
  • the list: the collector's own rule (scripts/breadth_collector.py `_get_universe`) applied to
    each session from the PRIOR session's bar: CS/ADRC, close >= $2, volume >= 200k, market cap
    >= $300M, and traded that day — over the provider's day files, so every stock that traded is
    in the frame, delisted ones included. Market cap = prior close x the company's SEC share
    count as of that date (XBRL cover / balance sheet, weighted average for two-class and IFRS
    filers, 10-K/10-Q cover pages before XBRL);
  • the columns: PRODUCTION's breadth engine (`breadth_live.build_levels` + `compute_metrics`,
    via `breadth_history_recon.recompute_from_frame`) on split- and dividend-adjusted bars (the
    V2 dividend basis), new highs/lows on the intraday basis (`breadth_nhnl_intraday`'s rule);
  • market-wide columns (tools/breadth/uct_pit/market_wide.py): the index closes / MA dots / dist
    days from the provider's bars, VIX / VIX6M / VXN / SPX from Cboe's own CSVs; VXN before
    2009-09-14 (Cboe's file starts there) from Yahoo ^VXN, which matches Cboe on 99.7% of the
    sessions both carry (patched into the series 2026-11-23);
  • graded on 2026 against the REAL lists (pit_uct_ledger): the engine reproduces production's
    served columns (most within 0.1 pt); the rebuilt list's readings land within a median of
    0.25-0.4 pt of the real list's.

⛔ ONLY BACK-TESTED ROWS ARE REPLACED. A row the collector or the V2 authority wrote is never
touched: the overlay applies to `_reconstructed` rows whose date the series holds, sets `_uct_pit`
(so they are shaded and ranked again: `breadth_shade_rule.is_backtested_row`) and withholds
`new_ath` (it needs each stock's whole price history, which the rebuild does not hold).

⭐ THE A/D LINE RUNS INTO THE COLLECTOR WITHOUT A STEP. A rebuilt row carries `ad_back`, its net
advances summed over the later rebuilt sessions; the line at that row is the A/D line at the last
rebuilt session (the V1 lineage's total, which the collector's rows already continue from) minus
`ad_back`. The 2026 rows are byte-identical with the switch on or off.

⛔ OFF unless BREADTH_UCT_PIT=1 AND the series is present (/data, else restored from R2).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import threading
from typing import Optional

VERSION = "uct-pit-v1"
_DATA = os.environ.get("DATA_DIR", "/data")
SERIES_PATH = os.path.join(_DATA, "breadth_uct_pit_v1.json")
R2_KEY = "breadth_uct_pit/v1.json.gz"
#: Row keys that are bookkeeping, never a Monitor column.
_META = ("members", "ad_back")

_lock = threading.Lock()
_view: dict = {}


def enabled() -> bool:
    return os.environ.get("BREADTH_UCT_PIT", "").strip().lower() in ("1", "true", "yes", "on")


def _restore_from_r2() -> bool:
    try:
        from api.services import data_sync
        raw = data_sync.get_bytes(R2_KEY)
        if not raw:
            return False
        body = gzip.decompress(raw)
        json.loads(body)
        with open(SERIES_PATH + ".tmp", "wb") as fh:
            fh.write(body)
        os.replace(SERIES_PATH + ".tmp", SERIES_PATH)
        return True
    except Exception:
        return False


def _series() -> dict:
    """The loaded series, keyed on the file's mtime (a republish is picked up without a restart)."""
    try:
        st = os.stat(SERIES_PATH)
    except FileNotFoundError:
        if not _restore_from_r2():
            return {}
        st = os.stat(SERIES_PATH)
    key = (st.st_mtime_ns, st.st_size)
    with _lock:
        if _view.get("key") == key:
            return _view["data"]
    with open(SERIES_PATH, "rb") as fh:
        raw = fh.read()
    doc = json.loads(raw)
    if doc.get("version") != VERSION:
        doc = {}
    doc["_token"] = hashlib.sha256(raw).hexdigest()[:12] if doc else ""
    with _lock:
        _view.update(key=key, data=doc)
    return doc


def active() -> bool:
    return enabled() and bool(_series().get("rows"))


def token() -> str:
    """'' when off (every cache key byte-identical to before), else the series' content hash."""
    if not enabled():
        return ""
    s = _series()
    return f"_ucp{s['_token']}" if s.get("rows") else ""


def row(date_iso: str) -> Optional[dict]:
    if not active():
        return None
    return (_series().get("rows") or {}).get(date_iso)


def overlay(rows_asc: list) -> int:
    """Replace every back-tested (`_reconstructed`) row's per-universe columns with the rebuilt
    session's, in place. Returns the number of rows replaced. A no-op when off."""
    if not active():
        return 0
    rows = _series()["rows"]
    n = 0
    for r in rows_asc:
        if not r.get("_reconstructed"):
            continue
        p = rows.get(r.get("date") or "")
        if not p:
            continue
        for k, v in p.items():
            if k not in _META:
                r[k] = v
        r["_uct_pit"] = True
        r["_ad_back"] = p.get("ad_back")
        n += 1
    return n


def anchor_ad_line(rows_asc: list, line_at_last: Optional[float]) -> None:
    """After the derive pass: a rebuilt row's A/D line = the line at the last rebuilt session minus
    the rebuilt net advances after it (`ad_back`), so the history meets the collector's line exactly."""
    if line_at_last is None:
        return
    for r in rows_asc:
        if r.get("_uct_pit") and r.get("_ad_back") is not None:
            r["adv_decline_cum"] = line_at_last - r["_ad_back"]
        r.pop("_ad_back", None)


def last_date() -> Optional[str]:
    return _series().get("last") if active() else None
