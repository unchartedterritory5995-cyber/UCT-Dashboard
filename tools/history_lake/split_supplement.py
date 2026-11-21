"""Declared corporate actions the vendor's split reference lacks (split_supplement.json), 2026-11-21.

The deep daily rebuild applies the vendor's split reference (ref/splits.json). That reference can miss real events.
CX (Cemex) paid a 4% stock dividend every year 2009-2017, and the vendor files only 2015-2017. So every CX bar
before 2014-04-22 was up to 26% above the price an independent reference (TradingView) shows.

This module reads the supplement and merges it into the vendor's rows, in the vendor's own row shape:
- `load` REFUSES a row that does not name where it was read (`evidence.capture`) or was not checked against an
  independent reference's prices (`evidence.price_verified` true). A listed-but-unverified event never enters
  the table (CX 2008-05-06).
- `merge` does not apply an event twice. When the vendor files the same event itself (same ticker, within
  factors.SAME_EVENT_DAYS days, ratio within factors.SAME_EVENT_TOL), the vendor's row wins and the supplement's is
  skipped. factors.build_factor_tables dedupes only by EXACT date, so a vendor fix filed a few days off ours would
  otherwise multiply the factor twice.
Rails: tests/test_history_lake_split_supplement.py."""
from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Iterable, List, Mapping

from tools.history_lake import factors as _F

SUPPLEMENT = Path(__file__).with_name("split_supplement.json")


class SupplementError(ValueError):
    """A supplement row is malformed or carries no price-verified evidence."""


def _iso(d) -> bool:
    try:
        return isinstance(d, str) and len(d) == 10 and _dt.date.fromisoformat(d).isoformat() == d
    except ValueError:
        return False


def load(path: Path = SUPPLEMENT) -> List[dict]:
    """The supplement's rows, each validated. RAISES SupplementError on the first bad row."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for i, r in enumerate(doc.get("rows") or ()):
        where = f"supplement row {i} ({r.get('ticker')} {r.get('execution_date')})"
        if not str(r.get("ticker") or "").strip() or not _iso(r.get("execution_date")):
            raise SupplementError(f"{where}: needs a ticker and an ISO execution_date")
        if _F.split_ratio(r.get("split_from"), r.get("split_to")) is None:
            raise SupplementError(f"{where}: split_from/split_to do not form a ratio")
        ev = r.get("evidence")
        if not isinstance(ev, Mapping) or not str(ev.get("capture") or "").strip() or ev.get("price_verified") is not True:
            raise SupplementError(f"{where}: needs evidence.capture and evidence.price_verified true")
        out.append({k: r[k] for k in ("ticker", "execution_date", "split_from", "split_to", "evidence")})
    return out


def _same_event(a: Mapping, b: Mapping) -> bool:
    if str(a.get("ticker")) != str(b.get("ticker")):
        return False
    ra, rb = _F.split_ratio(a.get("split_from"), a.get("split_to")), _F.split_ratio(b.get("split_from"), b.get("split_to"))
    if ra is None or rb is None or not _iso(a.get("execution_date")) or not _iso(b.get("execution_date")):
        return False
    days = abs((_dt.date.fromisoformat(a["execution_date"]) - _dt.date.fromisoformat(b["execution_date"])).days)
    return days <= _F.SAME_EVENT_DAYS and abs(ra / rb - 1) <= _F.SAME_EVENT_TOL


def merge(vendor_rows: Iterable[Mapping], supplement_rows: Iterable[Mapping]) -> List[dict]:
    """The vendor's rows plus every supplement row the vendor does not already carry as the same event."""
    vendor = [dict(r) for r in vendor_rows]
    by_ticker: dict = {}
    for r in vendor:
        by_ticker.setdefault(str(r.get("ticker")), []).append(r)
    added = [dict(s) for s in supplement_rows
             if not any(_same_event(s, v) for v in by_ticker.get(str(s.get("ticker")), ()))]
    return vendor + added
