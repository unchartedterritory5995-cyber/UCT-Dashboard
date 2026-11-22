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
- A row may name the vendor's OWN wrong figure for its event in `replaces` (execution_date, split_from,
  split_to). `merge` then drops exactly that vendor row (TKC 2006-06-26: the vendor's 100:102.78, where
  TradingView's step against the raw day files is 1.186057). Nothing else is dropped.
- A DROP row removes a vendor row that never happened (2026-11-21, seam-61; ruled by patrick-2b). CHY 2007-09-20: the
  vendor files a 1:3 reverse split, but the raw day files and the second vendor run on (no step), so the table would
  multiply every earlier bar by 3. A drop row names the vendor row in `drop` (execution_date, split_from, split_to)
  and carries no ratio of its own. It is refused unless its evidence records TradingView's step across the date
  (`tv_step`, the STEP METHOD against the raw day files) within DROP_TV_TOL of 1, AND the raw close's move across it
  (`raw_move`) continuous: within DROP_RAW_CONTINUOUS and under half the dropped factor (log terms). `merge` raises when
  no vendor row matches it within DROP_NEAR_DAYS, or more than one does: never a silent no-op. A drop never shares its
  event (+-DROP_NEAR_DAYS) with an add, a replace or another drop.
- A SMALL-EVENT drop (evidence.form "small-event", ruled 2026-11-21): vendor dividend rows (BP scrip, PHG's stock-dividend
  option, CM, PEO) that TradingView AND the second vendor both leave unadjusted. The raw close moves across them (the
  dividend plus the market), so raw continuity cannot speak; instead the second vendor's step (`second_vendor_step`)
  must be within DROP_TV_TOL of 1 as well as TradingView's. HARD CAP: the dropped factor lies within DROP_SMALL_CAP of 1,
  so this form can never drop a real split.
- A RE-DATE (2026-11-21, heal569; ruled by patrick-2b): a `replaces` naming the vendor's row on ANOTHER date. HCSG
  2010: the vendor files the 3:2 on 2010-11-12, but the raw day files (and TradingView) step on 11-15, so the table left
  the 11-12 bar on the old basis: a one-bar x1.5 spike that never traded (BRBS 2021, BMI 2016 the same). An add on 11-15
  would be skipped as the same event, so the row re-dates the vendor's. Refused unless the vendor's date lies within
  REPLACE_NEAR_DAYS of the row's AND `evidence.vendor_date_raw_move` shows the raw day files continuous across the
  vendor's date (the DROP continuity test, against the vendor's factor).
Rails: tests/test_history_lake_split_supplement.py."""
from __future__ import annotations

import datetime as _dt
import json
import math
from pathlib import Path
from typing import Iterable, List, Mapping

from tools.history_lake import factors as _F

SUPPLEMENT = Path(__file__).with_name("split_supplement.json")


class SupplementError(ValueError):
    """A supplement row is malformed or carries no price-verified evidence."""


#: A DROP row's evidence: TradingView's step across the date within this of 1.0 (the 0.05% bar every row is held to) ...
DROP_TV_TOL = 0.0005
#: ... and the raw day files continuous across it: the raw close moves less than this (|ln|), an ordinary session.
DROP_RAW_CONTINUOUS = 0.05
#: A SMALL-EVENT drop may only remove a factor within this of 1 (|factor - 1|): never a real split.
DROP_SMALL_CAP = 0.05
#: A drop matches its vendor row within this many days, and no other row may name an event this close to it (the
#: same-event window of daily_join.heal_splits).
DROP_NEAR_DAYS = 3
#: A RE-DATE (a row whose `replaces` names the vendor's row on ANOTHER date) stays inside the same-event window.
REPLACE_NEAR_DAYS = DROP_NEAR_DAYS


def _days(a: str, b: str) -> int:
    return abs((_dt.date.fromisoformat(a) - _dt.date.fromisoformat(b)).days)


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x > 0


def _load_drop(r: Mapping, where: str) -> dict:
    """A DROP row, validated: names one vendor row, carries no ratio of its own, and the no-step + continuity evidence."""
    if any(k in r for k in ("split_from", "split_to", "replaces")):
        raise SupplementError(f"{where}: a drop row carries no split_from/split_to/replaces of its own")
    d = r.get("drop")
    if (not isinstance(d, Mapping) or not _iso(d.get("execution_date"))
            or _F.split_ratio(d.get("split_from"), d.get("split_to")) is None):
        raise SupplementError(f"{where}: drop must name a vendor row (ISO execution_date, split_from/split_to)")
    if d["execution_date"] != r["execution_date"]:
        raise SupplementError(f"{where}: drop names {d['execution_date']}, not its row's execution_date")
    ratio = _F.split_ratio(d["split_from"], d["split_to"])
    ev = r.get("evidence")
    if not isinstance(ev, Mapping) or not str(ev.get("capture") or "").strip() or ev.get("price_verified") is not True:
        raise SupplementError(f"{where}: drop evidence needs evidence.capture and evidence.price_verified true")
    form = ev.get("form", "raw-continuous")
    if form not in ("raw-continuous", "small-event"):
        raise SupplementError(f"{where}: drop evidence.form must be raw-continuous or small-event, got {form!r}")
    tv, raw = ev.get("tv_step"), ev.get("raw_move")
    if not _num(tv) or abs(tv - 1) > DROP_TV_TOL:
        raise SupplementError(f"{where}: drop evidence.tv_step must show TradingView takes no step there "
                              f"(within {DROP_TV_TOL:.2%} of 1), got {tv!r}")
    if form == "small-event":
        if abs(ratio - 1) > DROP_SMALL_CAP + 1e-12:
            raise SupplementError(f"{where}: a small-event drop may only remove a factor within {DROP_SMALL_CAP:.0%} of 1, "
                                  f"got {ratio:.6f}: never a real split")
        sv = ev.get("second_vendor_step")
        if not _num(sv) or abs(sv - 1) > DROP_TV_TOL:
            raise SupplementError(f"{where}: drop evidence.second_vendor_step must show the second vendor takes no step "
                                  f"there either (within {DROP_TV_TOL:.2%} of 1), got {sv!r}")
    elif not _num(raw) or abs(math.log(raw)) > DROP_RAW_CONTINUOUS or abs(math.log(raw)) >= abs(math.log(ratio)) / 2:
        raise SupplementError(f"{where}: drop evidence.raw_move must show the raw day files continuous across the date "
                              f"(|ln| within {DROP_RAW_CONTINUOUS} and under half the dropped factor), got {raw!r}")
    return {"ticker": r["ticker"], "execution_date": r["execution_date"],
            "drop": {k: d[k] for k in ("execution_date", "split_from", "split_to")}, "evidence": ev}


def _check_redate(day: str, rep: Mapping, ev: Mapping, where: str) -> None:
    """A RE-DATE moves the vendor's row onto the session the prices step: one event, so inside REPLACE_NEAR_DAYS, and
    the raw day files continuous across the VENDOR's date (`vendor_date_raw_move`: the raw close's move from the
    session before it), within DROP_RAW_CONTINUOUS and under half the vendor's factor (log terms): no event there."""
    if _days(rep["execution_date"], day) > REPLACE_NEAR_DAYS:
        raise SupplementError(f"{where}: replaces names the vendor's {rep['execution_date']} row, outside the "
                              f"same-event window ({REPLACE_NEAR_DAYS} days): another event, never a re-date")
    ratio = _F.split_ratio(rep["split_from"], rep["split_to"])
    mv = ev.get("vendor_date_raw_move")
    if not _num(mv) or abs(math.log(mv)) > DROP_RAW_CONTINUOUS or abs(math.log(mv)) >= abs(math.log(ratio)) / 2:
        raise SupplementError(f"{where}: a re-date needs evidence.vendor_date_raw_move, the raw day files continuous "
                              f"across the vendor's {rep['execution_date']} (|ln| within {DROP_RAW_CONTINUOUS} and "
                              f"under half its factor), got {mv!r}")


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
        if "drop" in r:
            out.append(_load_drop(r, where))
            continue
        if _F.split_ratio(r.get("split_from"), r.get("split_to")) is None:
            raise SupplementError(f"{where}: split_from/split_to do not form a ratio")
        ev = r.get("evidence")
        if not isinstance(ev, Mapping) or not str(ev.get("capture") or "").strip() or ev.get("price_verified") is not True:
            raise SupplementError(f"{where}: needs evidence.capture and evidence.price_verified true")
        row = {k: r[k] for k in ("ticker", "execution_date", "split_from", "split_to", "evidence")}
        if "replaces" in r:
            rep = r["replaces"]
            if (not isinstance(rep, Mapping) or not _iso(rep.get("execution_date"))
                    or _F.split_ratio(rep.get("split_from"), rep.get("split_to")) is None):
                raise SupplementError(f"{where}: replaces must name a vendor row (ISO execution_date, split_from/split_to)")
            row["replaces"] = {k: rep[k] for k in ("execution_date", "split_from", "split_to")}
            if rep["execution_date"] != r["execution_date"]:
                _check_redate(r["execution_date"], row["replaces"], ev, where)
        out.append(row)
    for i, a in enumerate(out):                    # one event, one answer: a drop shares its event with nothing
        if "drop" not in a:
            continue
        for j, b in enumerate(out):
            if j != i and str(b["ticker"]) == str(a["ticker"]) and _days(a["execution_date"], b["execution_date"]) <= DROP_NEAR_DAYS:
                raise SupplementError(f"supplement rows {i} and {j} ({a['ticker']} {a['execution_date']} / "
                                      f"{b['execution_date']}): a drop and another row for the same event")
    return out


def _replaced(v: Mapping, s: Mapping) -> bool:
    """`v` (a vendor row) is the one supplement row `s` names in `replaces`: same ticker, date and ratio."""
    rep = s.get("replaces")
    if not rep or str(v.get("ticker")) != str(s.get("ticker")) or v.get("execution_date") != rep["execution_date"]:
        return False
    rv, rr = _F.split_ratio(v.get("split_from"), v.get("split_to")), _F.split_ratio(rep["split_from"], rep["split_to"])
    return rv is not None and abs(rv / rr - 1) <= 1e-6


def _same_event(a: Mapping, b: Mapping) -> bool:
    if str(a.get("ticker")) != str(b.get("ticker")):
        return False
    ra, rb = _F.split_ratio(a.get("split_from"), a.get("split_to")), _F.split_ratio(b.get("split_from"), b.get("split_to"))
    if ra is None or rb is None or not _iso(a.get("execution_date")) or not _iso(b.get("execution_date")):
        return False
    days = abs((_dt.date.fromisoformat(a["execution_date"]) - _dt.date.fromisoformat(b["execution_date"])).days)
    return days <= _F.SAME_EVENT_DAYS and abs(ra / rb - 1) <= _F.SAME_EVENT_TOL


def merge(vendor_rows: Iterable[Mapping], supplement_rows: Iterable[Mapping]) -> List[dict]:
    """The vendor's rows plus every supplement row the vendor does not already carry as the same event. A vendor row
    a supplement row names in `replaces` (the vendor's own wrong figure for that event, TKC 2006) is dropped first."""
    supplement_rows = list(supplement_rows)
    drops = [s for s in supplement_rows if "drop" in s]
    rows = [s for s in supplement_rows if "drop" not in s]
    vendor = [dict(r) for r in vendor_rows if not any(_replaced(r, s) for s in rows)]
    for s in drops:                                # a DROP removes exactly one vendor row, or the rebuild stops
        hit = [i for i, v in enumerate(vendor) if _dropped(v, s)]
        if len(hit) != 1:
            found = "no vendor row" if not hit else f"{len(hit)} vendor rows"
            raise SupplementError(f"drop {s['ticker']} {s['drop']}: {found} within {DROP_NEAR_DAYS} days at that ratio "
                                  "(needs exactly one); re-check the vendor reference")
        del vendor[hit[0]]
    by_ticker: dict = {}
    for r in vendor:
        by_ticker.setdefault(str(r.get("ticker")), []).append(r)
    added = [dict(s) for s in rows
             if not any(_same_event(s, v) for v in by_ticker.get(str(s.get("ticker")), ()))]
    return vendor + added


def _dropped(v: Mapping, s: Mapping) -> bool:
    """`v` (a vendor row) is the one DROP row `s` names: same ticker and ratio, within DROP_NEAR_DAYS of its date."""
    d = s["drop"]
    if str(v.get("ticker")) != str(s.get("ticker")) or not _iso(v.get("execution_date")):
        return False
    rv, rd = _F.split_ratio(v.get("split_from"), v.get("split_to")), _F.split_ratio(d["split_from"], d["split_to"])
    return rv is not None and abs(rv / rd - 1) <= 1e-6 and _days(v["execution_date"], d["execution_date"]) <= DROP_NEAR_DAYS
