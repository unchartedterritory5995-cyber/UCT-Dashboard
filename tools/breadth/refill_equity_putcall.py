"""Re-fill `cboe_putcall` with CBOE's EQUITY put/call ratio, 2019-10 onward (owner 2026-11-19).

WHY. The column was two series spliced together: 2003-2019 held the EQUITY ratio (CBOE's
equitypc archives, tools/build_breadth_sentiment.py), 2020-2025 held nothing, and 2026 held the
TOTAL ratio (the web pod's fill read "TOTAL PUT/CALL RATIO"). CBOE's per-date endpoint
(`breadth_putcall_backfill.URL`) has every session from 2019-10-07 and lists "EQUITY PUT/CALL
RATIO" on each one, so this tool makes the column one unbroken EQUITY series.

WHAT IT WRITES (with --apply; nothing without it):
  * a stored collector row (`breadth_snapshots`) for the date -> `cboe_putcall` OVERWRITTEN with
    the equity reading (`breadth_monitor.patch_fields`, the fill's own write). A stored reading on
    a date CBOE definitively has no file for (HTTP 403/404) is cleared, so no TOTAL survives.
  * no stored row (the reconstructed past) -> the sentiment store
    (`breadth_sentiment_history.upsert_many`), which the deep history overlays.
  --csv also rewrites the bundled seed `api/data/breadth_sentiment_history.csv` (dates before the
  collector floor) so a fresh volume seeds the same series.
  --export PATH rewrites a LOCAL read-only deep export (the `===BEGIN===` files the calibration and
  the dev reading endpoint read): `cboe_putcall` replaced, `avg_10d_cpc` and `breadth_score`
  recomputed with the live derivation. A `.pre-equity` backup is kept next to it. Dev only.

POLITE. ~1 request/second, browser UA + Referer (`breadth_putcall_backfill.HEADERS`), two light
retries on a network error, and every raw JSON body cached under --cache-dir so a rerun refetches
nothing (a 403/404 is cached too once the date is more than a week old).

⛔ PRIVACY (owner rule): prints COUNTS and DATES only, never a reading. Per-date detail goes to
--detail FILE if asked for.

Usage, from the repo root with the project venv:
    python tools/breadth/refill_equity_putcall.py                 # dry run: fetch (cached) + counts
    python tools/breadth/refill_equity_putcall.py --apply         # write the DBs the env points at
    python tools/breadth/refill_equity_putcall.py --apply --csv --export C:/w/bprod/universe_export/uct_deep.txt
    python tools/breadth/refill_equity_putcall.py --offline ...   # cache only, no network
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import sys
import tempfile
import time
from typing import Callable, Optional

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from api.services import breadth_putcall_backfill as pcb  # noqa: E402

SEED_CSV = os.path.join(ROOT, "api", "data", "breadth_sentiment_history.csv")
COLLECTOR_FLOOR = "2026-01-02"   # the seed CSV holds only dates strictly before this
DEFAULT_FROM = "2019-10-01"      # the per-date endpoint's first file is 2019-10-07

OK, MISSING, FAILED = "ok", "missing", "failed"


def _today_et() -> str:
    try:
        from zoneinfo import ZoneInfo
        return _dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return _dt.date.today().isoformat()


def weekdays(lo: str, hi: str) -> list:
    """Every Mon-Fri in [lo, hi]. Exchange holidays come back as `missing` (no CBOE file)."""
    d, end, out = _dt.date.fromisoformat(lo), _dt.date.fromisoformat(hi), []
    while d <= end:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += _dt.timedelta(days=1)
    return out


class Fetcher:
    """Per-date raw-JSON fetch with a disk cache. `get` is `requests.get`-shaped (tests inject)."""

    def __init__(self, cache_dir: str, *, get: Optional[Callable] = None, sleep: float = 1.0,
                 offline: bool = False, retries: int = 2, today: Optional[str] = None):
        self.cache_dir, self.get, self.sleep = cache_dir, get, sleep
        self.offline, self.retries = offline, retries
        self.today = today or _today_et()
        self.network_calls = 0
        os.makedirs(cache_dir, exist_ok=True)

    def _paths(self, d: str):
        return (os.path.join(self.cache_dir, f"{d}.json"),
                os.path.join(self.cache_dir, f"{d}.missing"))

    def _old(self, d: str) -> bool:
        return (_dt.date.fromisoformat(self.today) - _dt.date.fromisoformat(d)).days > 7

    def status(self, d: str):
        """(`ok`|`missing`|`failed`, equity ratio or None)."""
        jp, mp = self._paths(d)
        if os.path.exists(jp):
            try:
                with open(jp, encoding="utf-8") as f:
                    v = pcb.ratio_from(json.load(f))
                return (OK, v) if v is not None else (MISSING, None)
            except ValueError:            # a body cut short by an interrupted run: refetch it
                os.remove(jp)
        if os.path.exists(mp):
            return MISSING, None
        if self.offline:
            return FAILED, None
        get = self.get
        if get is None:
            import requests
            get = requests.get
        for attempt in range(self.retries + 1):
            if self.network_calls:
                time.sleep(self.sleep)
            self.network_calls += 1
            try:
                r = get(pcb.URL.format(d=d), timeout=8, headers=pcb.HEADERS)
                code = getattr(r, "status_code", 0)
                if code == 200:
                    body = r.json()
                    with open(jp, "w", encoding="utf-8") as f:
                        json.dump(body, f)
                    v = pcb.ratio_from(body)
                    return (OK, v) if v is not None else (MISSING, None)
                if code in (403, 404):
                    if self._old(d):
                        open(mp, "w").close()
                    return MISSING, None
            except Exception:
                pass
            time.sleep(self.sleep * (attempt + 1))
        return FAILED, None


def collect(dates: list, fetcher: Fetcher, progress: bool = True) -> dict:
    """{date: (status, value)} over `dates`."""
    out = {}
    for i, d in enumerate(dates):
        out[d] = fetcher.status(d)
        if progress and (i + 1) % 100 == 0:
            print(f"  .. {i + 1}/{len(dates)} dates ({fetcher.network_calls} network calls)", flush=True)
    return out


def first_ok(results: dict) -> Optional[str]:
    oks = [d for d, (st, _) in results.items() if st == OK]
    return min(oks) if oks else None


def plan(results: dict, stored: dict) -> dict:
    """What --apply would do. `stored` = {date: current cboe_putcall} for dates with a stored
    collector row. Returns lists of dates per action plus the value maps."""
    patch, clear, unchanged, sentiment = {}, [], [], {}
    # A date before CBOE's first per-date file is not evidence of anything (the frozen archive
    # owns it): only a missing file INSIDE the endpoint's range clears a stored reading.
    first = first_ok(results)
    for d, (st, v) in sorted(results.items()):
        if d in stored:
            if st == OK:
                if stored[d] == v:
                    unchanged.append(d)
                else:
                    patch[d] = v
            elif st == MISSING and stored[d] is not None and first and d >= first:
                clear.append(d)
        elif st == OK:
            sentiment[d] = v
    return {"patch": patch, "clear": clear, "unchanged": unchanged, "sentiment": sentiment}


def stored_putcall(lo: str, hi: str) -> dict:
    """{date: cboe_putcall} for every stored collector row in [lo, hi] (the env's monitor DB)."""
    from api.services import breadth_monitor as bm
    out = {}
    with bm._conn() as c:
        for d, mj in c.execute("SELECT date, metrics FROM breadth_snapshots WHERE date >= ? AND date <= ?",
                               (lo, hi)):
            try:
                out[d] = json.loads(mj).get("cboe_putcall")
            except Exception:
                out[d] = None
    return out


def apply(p: dict) -> dict:
    from api.services import breadth_monitor as bm
    from api.services import breadth_sentiment_history as sent
    ok = failed = 0
    for d, v in sorted(p["patch"].items()):
        if bm.patch_fields(d, {"cboe_putcall": v}):
            ok += 1
        else:
            failed += 1
    for d in p["clear"]:
        if bm.patch_fields(d, {"cboe_putcall": None}):
            ok += 1
        else:
            failed += 1
    n_sent = sent.upsert_many([(d, "cboe_putcall", v, "cboe_equity_daily")
                               for d, v in sorted(p["sentiment"].items())]) if p["sentiment"] else 0
    return {"snapshot_writes": ok, "snapshot_write_failures": failed, "sentiment_upserts": n_sent}


def rewrite_csv(results: dict, path: str = SEED_CSV) -> dict:
    """Replace the seed's `cboe_putcall` rows on fetched dates (< collector floor) with equity."""
    equity = {d: v for d, (st, v) in results.items() if st == OK and d < COLLECTOR_FLOOR}
    with open(path, newline="", encoding="utf-8") as f:
        rows = [(r["date"], r["key"], r["value"]) for r in csv.DictReader(f)]
    kept = [r for r in rows if not (r[1] == "cboe_putcall" and r[0] in equity)]
    replaced = len(rows) - len(kept)
    merged = kept + [(d, "cboe_putcall", f"{v}") for d, v in equity.items()]
    merged.sort(key=lambda r: (r[0], r[1]))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "key", "value"])
        w.writerows(merged)
    return {"csv_rows_before": len(rows), "csv_rows_after": len(merged),
            "csv_putcall_replaced": replaced, "csv_putcall_added": len(equity) - replaced}


def rewrite_export(results: dict, path: str) -> dict:
    """Dev only: rewrite a `===BEGIN===` deep export with the equity series (see module doc)."""
    import base64
    import gzip
    import shutil
    from api.services import breadth_monitor as bm
    from api.services.breadth_shade_rule import read_export
    rows = read_export(path)
    bak = path.replace(".txt", ".pre-equity.txt")
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
    lo = first_ok(results) or "9999"      # nothing before CBOE's first per-date file is touched
    equity = {d: v for d, (st, v) in results.items() if st == OK}
    rows.sort(key=lambda r: r.get("date") or "")
    changed = cleared = 0
    for r in rows:
        d = r.get("date") or ""
        if d < lo:
            continue
        if d in equity:
            if r.get("cboe_putcall") != equity[d]:
                changed += 1
            r["cboe_putcall"] = equity[d]
        elif r.get("cboe_putcall") is not None and results.get(d, (FAILED,))[0] == MISSING:
            r["cboe_putcall"] = None
            cleared += 1
    score_moved = 0
    for i, r in enumerate(rows):
        r["avg_10d_cpc"] = bm._rolling_avg(rows[max(0, i - 9):i + 1], "cboe_putcall", 2)
        new = bm._compute_breadth_score(r)
        if new != r.get("breadth_score"):
            score_moved += 1
        r["breadth_score"] = new
    blob = base64.b64encode(gzip.compress(json.dumps(rows).encode("utf-8"))).decode("ascii")
    with open(path, "w", encoding="utf-8") as f:
        f.write("===BEGIN===\n" + blob + "\n===END===\n")
    return {"export_rows": len(rows), "export_putcall_changed": changed,
            "export_putcall_cleared": cleared, "export_breadth_score_moved": score_moved}


def overlap_series(cache_dir: str) -> dict:
    """{date: (total, equity)} for every cached session that lists BOTH ratios."""
    out = {}
    for name in os.listdir(cache_dir):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(cache_dir, name), encoding="utf-8") as f:
            body = json.load(f)
        try:
            ratios = {it.get("name"): float(it.get("value")) for it in body.get("ratios", [])
                      if it.get("name") in ("TOTAL PUT/CALL RATIO", pcb.RATIO_NAME)}
        except (TypeError, ValueError):
            continue
        t, e = ratios.get("TOTAL PUT/CALL RATIO"), ratios.get(pcb.RATIO_NAME)
        if t is not None and e is not None and pcb.LO <= e <= pcb.HI:
            out[name[:-5]] = (t, e)
    return out


def tune_band(pairs: dict, total_band=(0.65, 0.85)) -> dict:
    """Map the Health score's TOTAL-era put/call band onto the EQUITY series: each end's
    percentile in the total distribution (mid-rank empirical CDF) -> the equity value at that
    same percentile. Returns {"band": (lo, hi), "pct": (p_lo, p_hi), "sessions": n}."""
    tot = sorted(t for t, _ in pairs.values())
    eq = sorted(e for _, e in pairs.values())
    n = len(tot)

    def pct(x):
        below = sum(1 for v in tot if v < x)
        at = sum(1 for v in tot if v == x)
        return (below + at / 2) / n

    def q(p):
        pos = p * (n - 1)
        i = int(pos)
        f = pos - i
        return eq[i] if i + 1 >= n else eq[i] + (eq[i + 1] - eq[i]) * f

    ps = tuple(pct(x) for x in total_band)
    return {"band": tuple(round(q(p), 2) for p in ps), "pct": ps, "sessions": n,
            "from": min(pairs), "to": max(pairs)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="lo", default=DEFAULT_FROM)
    ap.add_argument("--to", dest="hi", default="")
    ap.add_argument("--cache-dir", default=os.environ.get(
        "CBOE_DAILY_CACHE", os.path.join(tempfile.gettempdir(), "cboe_daily_options")))
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between network requests")
    ap.add_argument("--offline", action="store_true", help="cache only; never touch the network")
    ap.add_argument("--apply", action="store_true", help="write the monitor + sentiment DBs (env paths)")
    ap.add_argument("--csv", action="store_true", help="also rewrite the bundled seed CSV")
    ap.add_argument("--export", default="", help="also rewrite this LOCAL deep export (dev only)")
    ap.add_argument("--detail", default="", help="write per-date status/value JSON here (never printed)")
    ap.add_argument("--tune-band", default="", metavar="FILE",
                    help="from the cache only: write the equity Health band (tune_band) to FILE, print counts")
    args = ap.parse_args(argv)
    if args.tune_band:
        t = tune_band(overlap_series(args.cache_dir))
        with open(args.tune_band, "w", encoding="utf-8") as f:
            json.dump(t, f, indent=1)
        print(f"[refill-equity-pc] band tuned over {t['sessions']} sessions {t['from']}..{t['to']} -> {args.tune_band}")
        return 0
    hi = args.hi or _today_et()
    dates = weekdays(args.lo, hi)
    print(f"[refill-equity-pc] {len(dates)} weekdays {args.lo}..{hi}; cache {args.cache_dir}", flush=True)
    results = collect(dates, Fetcher(args.cache_dir, sleep=args.sleep, offline=args.offline))
    by = {s: [d for d, (st, _) in results.items() if st == s] for s in (OK, MISSING, FAILED)}
    print(f"  fetched={len(by[OK])} missing={len(by[MISSING])} failed={len(by[FAILED])}"
          f" first_ok={min(by[OK]) if by[OK] else None} last_ok={max(by[OK]) if by[OK] else None}")
    if by[FAILED]:
        print(f"  failed dates: {by[FAILED][:20]}{' ...' if len(by[FAILED]) > 20 else ''}")
    p = plan(results, stored_putcall(args.lo, hi))
    print(f"  stored rows: overwrite={len(p['patch'])} clear={len(p['clear'])} unchanged={len(p['unchanged'])};"
          f" sentiment store (no stored row): {len(p['sentiment'])}")
    if args.detail:
        with open(args.detail, "w", encoding="utf-8") as f:
            json.dump({"results": results, "plan": p}, f, indent=1)
    if not args.apply:
        print("  dry run: nothing written (pass --apply)")
        return 0
    print(f"  applied: {apply(p)}")
    if args.csv:
        print(f"  seed csv: {rewrite_csv(results)}")
    if args.export:
        print(f"  export: {rewrite_export(results, args.export)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
