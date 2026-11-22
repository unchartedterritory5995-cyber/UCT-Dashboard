"""Cash-index intraday gap scan: a STANDING check, so a vendor hole is found by us, not by a member.

⚰️ 2026-11-18: production's /api/bars/SPX?tf=60 had no bar from 2026-01-30 11:30 to 2026-02-02 12:30 ET
and no 12:30 bar on any 13:00 half-day, for at least nine months. Yahoo's own answer had the hole
(index_bars stored it byte for byte); a member's Fred RS run found it, by refusing ("SPX has no bar on
1770044400"). Nothing of ours was looking.

What this checks, per symbol and tf (default SPX NDX RUT DJX x 60 30): the answer the site serves
(`GET /api/bars/<SYM>?tf=<tf>`, the same unauthenticated read a chart makes), against the regular-session
buckets `intraday_gap_audit.expected_rth_buckets` says every SETTLED session has (half-days and holidays
are that authority's; no second calendar here). Buckets before the answer's first row are depth, not
holes; a session is judged once it closed `SETTLE_S` ago. A bucket that is absent AND not named in the
answer's own `holes` (`index_bars` names what no vendor has) is reported: an UNNAMED hole is one nobody
knows about yet.

    python tools/index_gap_scan.py                                   # production, the default set
    python tools/index_gap_scan.py --base http://localhost:8077 --symbols SPX --tfs 60

Output: one summary line, then one line per unnamed hole. Exit 0 = no unnamed hole, 1 = unnamed holes
(listed), 2 = a series could not be checked (a failed or empty read). Scheduled by
`.github/workflows/index-gap-scan.yml`, whose run goes RED on 1 or 2: that red run is the alert.
Rails: tests/test_index_gap_scan.py.
"""
from __future__ import annotations

import argparse
import functools
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

if __package__ in (None, ""):                     # `python tools/index_gap_scan.py`
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE = "https://uctintelligence.com"
DEFAULT_SYMBOLS = ("SPX", "NDX", "RUT", "DJX")
DEFAULT_TFS = ("60", "30")
#: Rows asked per tf: more than the index store holds (60m: ~5,100 over 730 days; 30m: ~800 over 60).
BARS = {"60": 8000, "30": 5000, "15": 5000, "5": 6000, "1": 3000}
#: A session is judged once it closed this long ago (`index_bars.REPAIR_SETTLE_S`, the same wait).
SETTLE_S = 30 * 60
TIMEOUT_S = 60
#: The site sits behind Cloudflare, which refuses a bare script User-Agent (tools/live_check.py).
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
_ET = ZoneInfo("America/New_York")


@functools.lru_cache(maxsize=8192)
def _expected(tf: str, d: date) -> tuple:
    """Every regular-session bucket of session `d`: the authority's answer, read once per (tf, day)."""
    from api.services import intraday_gap_audit as gap
    return tuple(gap.expected_rth_buckets(tf, d))


def _close_ts(d: date) -> int:
    from api.services import intraday_gap_audit as gap
    mid = int(datetime(d.year, d.month, d.day, tzinfo=_ET).timestamp())
    return mid + gap._close_minutes(d) * 60


def _et_date(t) -> date:
    return datetime.fromtimestamp(float(t), _ET).date()


def scan_series(bars: list, tf: str, named=(), now: float | None = None) -> dict:
    """`{"first", "last", "expected", "present", "unnamed": [t...], "named": n, "off_grid": n}` for one
    answer's rows. Pure: no network, no clock unless `now` is omitted."""
    now = float(now if now is not None else time.time())
    ts = sorted(int(b["t"]) for b in bars if isinstance(b, dict)
                and isinstance(b.get("t"), (int, float)) and not isinstance(b.get("t"), bool))
    out = {"first": None, "last": None, "expected": 0, "present": len(ts), "unnamed": [],
           "named": 0, "off_grid": 0}
    if not ts:
        return out
    have, named = set(ts), {int(t) for t in named or ()}
    first, last = _et_date(ts[0]), _et_date(ts[-1])
    out["first"], out["last"] = first.isoformat(), last.isoformat()
    on_grid = set()
    d = first
    while d <= last:
        exp = _expected(tf, d)
        on_grid.update(exp)
        if exp and _close_ts(d) + SETTLE_S <= now:
            for t in exp:
                if t < ts[0]:
                    continue                       # before the first row: depth, not a hole
                out["expected"] += 1
                if t in have:
                    continue
                if t in named:
                    out["named"] += 1
                else:
                    out["unnamed"].append(t)
        d += timedelta(days=1)
    out["off_grid"] = sum(1 for t in ts if t not in on_grid)
    return out


def fetch(base: str, sym: str, tf: str, timeout: float = TIMEOUT_S) -> dict:
    url = f"{base.rstrip('/')}/api/bars/{sym}?tf={tf}&bars={BARS.get(tf, 5000)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                               "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _label(t: int) -> str:
    return datetime.fromtimestamp(t, _ET).strftime("%Y-%m-%d %H:%M ET")


def run(base: str, symbols, tfs, *, now: float | None = None, fetcher=fetch) -> tuple[int, list[str]]:
    """(exit code, report lines). The first line is the summary."""
    rows, holes, failed = [], [], []
    for sym in symbols:
        for tf in tfs:
            try:
                data = fetcher(base, sym, tf)
                bars = data.get("bars") if isinstance(data, dict) else None
                if not bars:
                    raise ValueError("the answer has no bars")
            except Exception as e:  # noqa: BLE001 - reported by name, exit 2
                failed.append(f"{sym} {tf}: {type(e).__name__}: {e}")
                continue
            res = scan_series(bars, tf, data.get("holes") or (), now=now)
            rows.append(f"{sym} {tf} {len(res['unnamed'])}")
            holes.extend(f"{sym} {tf} {_label(t)} ({t})" for t in res["unnamed"])
    code = 1 if holes else (2 if failed else 0)
    summary = (f"index gap scan: {len(holes)} unnamed hole(s), {len(failed)} series not checked "
               f"[{', '.join(rows) or 'nothing checked'}]")
    return code, [summary, *holes, *(f"NOT CHECKED {f}" for f in failed)]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--symbols", nargs="+", default=list(DEFAULT_SYMBOLS))
    ap.add_argument("--tfs", nargs="+", default=list(DEFAULT_TFS))
    a = ap.parse_args(argv)
    code, lines = run(a.base, [s.upper() for s in a.symbols], a.tfs)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
