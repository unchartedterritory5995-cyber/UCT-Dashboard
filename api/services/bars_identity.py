"""Another company's bars inside a symbol's served D/W/M history (2026-11-17).

The provider maps a renamed company's history onto its CURRENT symbol, except on the dates another
company traded under that symbol. Production's daily META served Meta Platforms at $351.89 on
2021-06-29, the Roundhill Metaverse ETF at ~$15 from 2021-06-30 to 2022-01-28, then Meta again from
2022-01-31 ($313.26): a seven-month cliff on a megacap's daily chart. Checked over every symbol another
company held before (52, from the vendor's ticker events, tools/history_lake/identity.py), five daily
series carried another company inside a window: META, CALY, CCC, MSGE, STRC (api/data/bars_identity.json
says which window, and why).

At serve time (bars_sanitize.sanitize_daily_bars: the one path /api/bars, /api/bars-history and the
daily pack share), a window's bars are REPLACED by the company's own bars under the symbol it traded as
then (`source`: META's window from FB, CALY's from MODG, read straight from the store), or DROPPED when it
did not trade yet (`source` null). A source is used only when it agrees with the served series at the
window's edge (same company, same price basis: closes within EDGE_TOL on a date both hold); otherwise the
window is dropped, never filled with bars that cannot be vouched for.

The served `history_rev` of a corrected D/W/M series carries the table's epoch (`history_epoch`): a
client holding a copy stamped by an earlier answer sees a newer history and replaces it whole
(app reducer applyRest `histRose`), so nobody keeps the other company's bars from a cache.

Pure apart from `read_source` (the caller's store read). Never raises out of `apply`.
"""
from __future__ import annotations

import datetime as _dt
import functools
import json
from pathlib import Path
from typing import Callable, Optional

TABLE = Path(__file__).resolve().parents[1] / "data" / "bars_identity.json"
#: Added to a corrected series' served history_rev, once per table version.
EPOCH_STEP = 1_000_000
#: A source agrees with the served series when their closes on a shared date outside the window are
#: within this fraction.
EDGE_TOL = 0.02
DATE_TFS = ("D", "W", "M")


@functools.lru_cache(maxsize=1)
def _table() -> dict:
    try:
        doc = json.loads(TABLE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": 0, "symbols": {}}
    out = {}
    for sym, ws in (doc.get("symbols") or {}).items():
        good = []
        for w in ws or ():
            try:
                lo = _dt.date.fromisoformat(w["from"]) if w.get("from") else None
                hi = _dt.date.fromisoformat(w["until"])
            except (KeyError, TypeError, ValueError):
                continue
            src = w.get("source")
            good.append({"from": lo, "until": hi, "source": str(src).upper() if src else None})
        if good:
            out[str(sym).upper()] = good
    return {"version": int(doc.get("version") or 0), "symbols": out}


def windows_for(ticker: str) -> list:
    return _table()["symbols"].get(str(ticker or "").upper(), [])


def history_epoch(ticker: str, tf: str) -> int:
    """What to add to `ticker`'s served history_rev at `tf`: the table epoch for a corrected D/W/M
    series, else 0."""
    if str(tf).upper() not in DATE_TFS or not windows_for(ticker):
        return 0
    return _table()["version"] * EPOCH_STEP


def _span(t: str, tf: str):
    """The calendar days a bar covers: D its day, W the week ending on its Friday key, M its month."""
    d = _dt.date.fromisoformat(str(t)[:10])
    if tf == "W":
        return d - _dt.timedelta(days=6), d
    if tf == "M":
        start = d.replace(day=1)
        nxt = (start + _dt.timedelta(days=32)).replace(day=1)
        return start, nxt - _dt.timedelta(days=1)
    return d, d


def _in(t: str, tf: str, lo: Optional[_dt.date], hi: _dt.date) -> bool:
    """Does the bar keyed `t` cover any day in [lo, hi)?"""
    try:
        start, end = _span(t, tf)
    except (TypeError, ValueError):
        return False
    return (lo is None or end >= lo) and start < hi


#: How many served bars on each side of a window may prove the source.
EDGE_BARS = 3


def _agrees(kept: list, source: list, tf: str, lo, hi) -> bool:
    """The source and the served series show the same company on the same basis: on a date right next
    to the window (EDGE_BARS on each side, nearest first) both hold, their closes agree within EDGE_TOL.
    ⛔ Only next to the window: a source symbol can be ANOTHER company far from it (FB is a ProShares
    ETF since 2025), so a shared date years away proves nothing."""
    by_t = {str(b.get("t"))[:10]: b for b in source}
    before = [b for b in kept if lo is not None and _span(b.get("t"), tf)[1] < lo][-EDGE_BARS:][::-1]
    after = [b for b in kept if _span(b.get("t"), tf)[0] >= hi][:EDGE_BARS]
    for b in before + after:
        s = by_t.get(str(b.get("t"))[:10])
        if s is None:
            continue
        try:
            a, c = float(b["c"]), float(s["c"])
        except (KeyError, TypeError, ValueError):
            continue
        if a > 0 and c > 0:
            return abs(c / a - 1) <= EDGE_TOL
    return False


def apply(ticker: str, bars: list, tf: str, read_source: Callable[[str, str], list]) -> list:
    """`bars` (served D/W/M bars of `ticker`, ascending) with every identity window corrected."""
    tf = str(tf).upper()
    ws = windows_for(ticker)
    if not ws or tf not in DATE_TFS or not bars:
        return bars
    try:
        out = bars
        for w in ws:
            lo, hi, src = w["from"], w["until"], w["source"]
            if not any(_in(b.get("t"), tf, lo, hi) for b in out):
                continue
            kept = [b for b in out if not _in(b.get("t"), tf, lo, hi)]
            fill = []
            if src:
                try:
                    rows = read_source(src, tf) or []
                except Exception:  # noqa: BLE001 - no source: the window is dropped
                    rows = []
                inside = [b for b in rows if _in(b.get("t"), tf, lo, hi)]
                if inside and _agrees(kept, rows, tf, lo, hi):
                    fill = inside
            out = sorted(kept + fill, key=lambda b: str(b.get("t")))
        return out
    except Exception:  # noqa: BLE001 - never blank a chart
        return bars
