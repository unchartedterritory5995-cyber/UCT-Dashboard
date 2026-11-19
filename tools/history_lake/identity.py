"""Whose bars a lake symbol holds: reused tickers and renamed companies (2026-11-17).

The lake is keyed by the symbol each vendor day file used. A ticker can pass from one company to
another, and a company can change its ticker:

    META   Roundhill Metaverse ETF 2021-06-30 .. 2022-01-31, Meta Platforms from 2022-06-09
    FB     Meta Platforms 2012-05-18 .. 2022-06-08, a ProShares ETF from 2025-06-26

so before this, META's series began with an ETF's bars, Meta's own 2012-2022 bars sat under FB, and FB
showed Meta's history as the ETF's. From the vendor's ticker events (`ref/ticker_events.jsonl`: per
current ticker, the dates it took each symbol), every publish now:

  CUT     a symbol another company held before: its entries count only from the day the current
          company took it (an entry that straddles that day gets `from`; one wholly before is dropped);
  STITCH  the company's earlier symbols: their entries inside the window it traded under each, keyed
          `<period>~<symbol>` with `period` and `sym` (the piece is read where it is stored) and
          `from` / `until` (epoch seconds, New York midnight; `until` exclusive);
  SPLITS  the split table follows the same windows. Splits are keyed by the symbol at execution: FI's
          2021 reverse split is Frank's International's, and must never scale Fiserv's FISV bars.

The client (app/src/data/historyLake/source.js) reads the windows: `periodsFor` reports each entry's
window as its first/last and `loadBars` keeps only the bars inside it.

CONSERVATIVE BY DESIGN: the vendor's events are noisy (Agilent's record names AWD from 2005). A record is
used only when its newest event names its own ticker; a cut needs another company (a different CIK, or
a different FIGI where a CIK is missing) to have held the symbol before; a stitched window is dropped
when any other company's events touch that symbol inside it, and stitching stops at the first window
dropped. KNOWN LIMIT: an earlier holder that is not in the events file (a delisted company) cannot be
seen, so its bars are not cut.
"""
from __future__ import annotations

import copy
import datetime as _dt
import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
EVENTS_FILE = "ticker_events.jsonl"
#: The separator of a stitched entry's key, `<period>~<symbol>` (a period never holds it).
STITCH_SEP = "~"


def et_midnight(day: str) -> int:
    """Epoch seconds of 00:00 New York time on `day` (YYYY-MM-DD)."""
    y, m, d = (int(x) for x in day.split("-"))
    return int(_dt.datetime(y, m, d, tzinfo=NY).timestamp())


def load_records(path: Path) -> List[dict]:
    """The usable records of a ticker-events file (one JSON object per line)."""
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("status") == "ok" and isinstance(r.get("ticker"), str) and isinstance(r.get("events"), list):
                out.append(r)
    return out


def _who(r: dict) -> tuple:
    return (r.get("cik") or None, r.get("composite_figi") or None)


def _same_company(a: tuple, b: tuple) -> Optional[bool]:
    """True / False when the records say, None when they cannot tell."""
    (ca, fa), (cb, fb) = a, b
    if ca and cb:
        return ca == cb
    if fa and fb:
        return fa == fb
    return None


def _events(r: dict) -> List[tuple]:
    ev = set()
    for e in r.get("events") or ():
        d, s = (e or {}).get("date"), (e or {}).get("ticker")
        if isinstance(d, str) and len(d) == 10 and d[4] == "-" and d[7] == "-" and isinstance(s, str) and s:
            ev.add((d, s))
    return sorted(ev)


def plan(records: Iterable[dict], have: Optional[Iterable[str]] = None) -> Dict[str, dict]:
    """{symbol: {"since": date, "cut": bool, "segments": [{"sym", "from", "until"}, ...oldest first]}}
    for the symbols with anything to change. `have`: the lake's symbols (others are skipped)."""
    have = set(have) if have is not None else None
    claims: Dict[str, list] = {}                     # symbol -> [(date, who, record ticker)]
    parsed = []
    for r in records:
        ev = _events(r)
        if not ev:
            continue
        parsed.append((r, ev))
        for d, s in ev:
            claims.setdefault(s, []).append((d, _who(r), r["ticker"]))

    out: Dict[str, dict] = {}
    for r, ev in parsed:
        me, T = _who(r), r["ticker"]
        if ev[-1][1] != T:                           # its newest event is not its own ticker: noise
            continue
        if have is not None and T not in have:
            continue
        i = len(ev) - 1
        while i > 0 and ev[i - 1][1] == T:           # the run of events on T that reaches today
            i -= 1
        since = ev[i][0]
        cut = any(d < since and t != T and _same_company(w, me) is False for d, w, t in claims.get(T, ()))

        segments: List[dict] = []
        until, j = since, i - 1
        while j >= 0:
            sym = ev[j][1]
            k = j
            while k > 0 and ev[k - 1][1] == sym:
                k -= 1
            start = ev[k][0]
            if sym == T or (have is not None and sym not in have):
                break
            contested = any(start <= d < until and t != T and _same_company(w, me) is not True
                            for d, w, t in claims.get(sym, ()))
            if contested:
                break
            segments.append({"sym": sym, "from": start, "until": until})
            until, j = start, k - 1
        if cut or segments:
            out[T] = {"since": since, "cut": cut, "segments": segments[::-1]}
    return dict(sorted(out.items()))


def _splits_in(table, lo: Optional[str], hi: Optional[str]) -> list:
    return [list(s) for s in (table or ()) if (lo is None or s[0] >= lo) and (hi is None or s[0] < hi)]


def apply(indexes: Dict[str, dict], plans: Dict[str, dict]) -> dict:
    """Rewrite the planned symbols' index documents in place. Earlier symbols are read from a copy
    taken FIRST: FB's own cut must not change what META stitches from FB."""
    src = set()
    for p in plans.values():
        src.update(s["sym"] for s in p["segments"])
    snap = {s: copy.deepcopy(indexes[s]) for s in src if s in indexes}
    stats = {"cut": 0, "stitched": 0, "entries_dropped": 0, "entries_added": 0}
    for sym, p in plans.items():
        doc = indexes.get(sym)
        if doc is None:
            continue
        vf = et_midnight(p["since"])
        series: Dict[str, dict] = {}
        for s, periods in doc.get("series", {}).items():
            kept = {}
            for per, e in periods.items():
                if e["last"] < vf:
                    stats["entries_dropped"] += 1
                    continue
                kept[per] = {**e, "from": vf} if e["first"] < vf else e
            if kept:
                series[s] = kept
        splits = _splits_in(doc.get("splits"), p["since"], None) if "splits" in doc else None
        added = 0
        for seg in p["segments"]:
            pred = snap.get(seg["sym"])
            if pred is None:
                continue
            f, u = et_midnight(seg["from"]), et_midnight(seg["until"])
            for s, periods in pred.get("series", {}).items():
                for per, e in periods.items():
                    if e["last"] < f or e["first"] >= u:
                        continue
                    ne = {**e, "period": per, "sym": seg["sym"]}
                    if e["first"] < f:
                        ne["from"] = f
                    if e["last"] >= u:
                        ne["until"] = u
                    series.setdefault(s, {})[f"{per}{STITCH_SEP}{seg['sym']}"] = ne
                    added += 1
            if splits is not None:
                splits += _splits_in(pred.get("splits"), seg["from"], seg["until"])
        doc["series"] = series
        if splits is not None:
            doc["splits"] = sorted(splits)
        doc["identity"] = {"since": p["since"], "cut": p["cut"], "stitched": p["segments"]}
        stats["cut"] += bool(p["cut"])
        stats["stitched"] += bool(added)
        stats["entries_added"] += added
    return stats
