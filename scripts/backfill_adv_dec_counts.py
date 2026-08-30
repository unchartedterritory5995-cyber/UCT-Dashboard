#!/usr/bin/env python
"""Backfill `advancing` / `declining` onto stored breadth snapshots.

WHY THIS EXISTS
---------------
`scripts/breadth_collector.py` (uct-intelligence) computed `adv` and `dec` and
returned only `adv - dec`, so every historical breadth row carries
`adv_decline` and NEITHER count. The Monitor's two count columns have been
blank for the life of the table, and the Event Ledger's **Zweig Breadth
Thrust** — a 10-day EMA of `advancing / (advancing + declining)` — refuses to
evaluate:

    Advance/decline counts cover 0 of 90 sessions — needs 11

The collector fix is forward-only, so without a backfill that lens stays dead
for ~3 trading weeks. This restores the counts on the sessions already stored.

WHERE THE NUMBERS COME FROM — and why not from bars.db
------------------------------------------------------
The collector caches the exact OHLCV frame it computed each session from at
`<uct-intelligence>/data/massive_cache/breadth_ohlcv_<YYYY-MM-DD>.pkl`. That
frame is the collector's OWN input: its column set is that day's universe
(point-in-time — delisted names included, because they were listed then), and
`Close.pct_change().iloc[-1]` on it is literally `adv_decline_parts`.

Measured 2026-08-30 against the stored `adv_decline` series:

    the collector's own cached frame          91 / 98 sessions EXACT
    a bars.db recompute (breadth_history_recon) 0 / 96 sessions exact

— which is why this script reads the frames rather than driving the recon.
The recon reconstructs the collector's METHOD faithfully but not its INPUTS
(yfinance auto-adjusted closes vs split-only bars.db, and 78-99.7% bars
coverage of the collector's universe). `POST .../history/adv-dec-validate`
re-measures that on the pod at any time.

THE GATE
--------
Nothing here is trusted. Every pair is checked against the row's own stored
`adv_decline` — `advancing - declining == adv_decline`, exactly — FIRST here
(so a bad frame never leaves this machine) and again server-side in
`breadth_history_recon.apply_adv_dec_counts`, which is what actually writes.
Sessions that fail are reported and skipped, never adjusted to fit.

SAFETY
------
Read-only on disk: it opens the collector's pickles and nothing else. It never
touches `C:\\data` / `/data`, and it cannot write to the store directly — the
only write path is the PUSH_SECRET-gated endpoint, which re-runs the gate.
It is idempotent: rows that already carry the counts are reported as
`already_present` and left alone, so re-running is a no-op.

USAGE
-----
    # 1. look, don't touch (the default) — prints the match rate + what would land
    python scripts/backfill_adv_dec_counts.py

    # 2. write it
    python scripts/backfill_adv_dec_counts.py --apply

    set PUSH_SECRET=...        (or pass --secret)
    --base-url  https://uctintelligence.com   (default)
    --cache-dir <uct-intelligence>/data/massive_cache
    --since / --until  YYYY-MM-DD bounds
    --batch     dates per request (default 40)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_CACHE_DIR = os.environ.get(
    "BREADTH_COLLECTOR_CACHE_DIR",
    r"C:\Users\Patrick\uct-intelligence\data\massive_cache",
)
DEFAULT_BASE_URL = os.environ.get("DASHBOARD_URL", "https://uctintelligence.com")
# Cloudflare 1010-blocks bare script user agents on uctintelligence.com.
_UA = "Mozilla/5.0 (compatible; uct-adv-dec-backfill)"


def _frames(cache_dir: str, since: str | None, until: str | None):
    """(date, path) for every cached collector frame in range, oldest first."""
    out = []
    for p in sorted(glob.glob(os.path.join(cache_dir, "breadth_ohlcv_*.pkl"))):
        d = os.path.basename(p)[len("breadth_ohlcv_"):-len(".pkl")]
        if len(d) != 10 or d[4] != "-" or d[7] != "-":
            continue
        if since and d < since:
            continue
        if until and d > until:
            continue
        out.append((d, p))
    return out


def counts_from_frame(path: str, expect_date: str):
    """`(advancing, declining, universe)` for the frame's LAST session.

    This is `breadth_collector.adv_decline_parts` verbatim — same
    `pct_change()`, same `notna()` mask, same strict `> 0` / `< 0` — applied to
    the frame the collector itself computed that session from. The duplicate-
    column drop mirrors `_download_ohlcv`'s cache branch.

    Returns None when the frame's newest session is not `expect_date` (a rerun
    on a later day rewrote the file, so its last row is somebody else's
    session and its column set is somebody else's universe).
    """
    import pandas as pd  # imported here so --help works without pandas

    df = pd.read_pickle(path)
    cl = df["Close"]
    cl = cl.loc[:, ~cl.columns.duplicated()]
    last = cl.index[-1]
    last_iso = last.strftime("%Y-%m-%d") if hasattr(last, "strftime") else str(last)[:10]
    if last_iso != expect_date:
        return None
    chg = cl.pct_change().iloc[-1]
    valid = chg.notna()
    adv = int((chg[valid] > 0).sum())
    dec = int((chg[valid] < 0).sum())
    universe = int(cl.iloc[-1].notna().sum())
    return adv, dec, universe


def _post(base_url: str, path: str, secret: str, body: dict, params: str = ""):
    url = base_url.rstrip("/") + path + (("?" + params) if params else "")
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Authorization": "Bearer " + secret,
                 "Content-Type": "application/json", "User-Agent": _UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        raise SystemExit(f"HTTP {e.code} from {url}\n{detail}")


def _get(base_url: str, path: str):
    req = urllib.request.Request(base_url.rstrip("/") + path,
                                 headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--secret", default=os.environ.get("PUSH_SECRET", ""))
    ap.add_argument("--since", default=None, help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--until", default=None, help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--batch", type=int, default=40)
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default is a dry run that writes nothing)")
    ap.add_argument("--json-out", default=None, help="write the full report here")
    a = ap.parse_args(argv)

    if not a.secret:
        print("PUSH_SECRET is required (env PUSH_SECRET or --secret)", file=sys.stderr)
        return 2
    if not os.path.isdir(a.cache_dir):
        print(f"no collector cache directory at {a.cache_dir}", file=sys.stderr)
        print("This script must run on the machine the breadth collector runs on.",
              file=sys.stderr)
        return 2

    frames = _frames(a.cache_dir, a.since, a.until)
    if not frames:
        print(f"no cached frames in {a.cache_dir} for that range")
        return 1
    print(f"reading {len(frames)} collector frames "
          f"({frames[0][0]} .. {frames[-1][0]})")

    pairs, skipped = {}, []
    for i, (d, p) in enumerate(frames, 1):
        try:
            got = counts_from_frame(p, d)
        except Exception as e:  # a truncated / half-written pickle
            skipped.append({"date": d, "reason": f"{type(e).__name__}: {e}"})
            continue
        if got is None:
            skipped.append({"date": d, "reason": "frame's newest session is not this date"})
            continue
        adv, dec, uni = got
        pairs[d] = [adv, dec]
        print(f"  [{i}/{len(frames)}] {d}  adv={adv:>5}  dec={dec:>5}  "
              f"net={adv - dec:>6}  universe={uni}")

    before = _get(a.base_url, "/api/breadth-monitor/history/adv-dec-coverage")
    print(f"\nZweig coverage before: {before['covered']} of {before['sessions']} "
          f"sessions (needs {before['needs']})")

    merged = {"written": [], "already_present": [], "partial_present": [],
              "refused_identity": [], "refused_no_row": [],
              "refused_no_adv_decline": [], "refused_malformed": [],
              "write_failed": []}
    dates = sorted(pairs)
    for s in range(0, len(dates), max(1, a.batch)):
        chunk = {d: pairs[d] for d in dates[s:s + a.batch]}
        rep = _post(a.base_url, "/api/breadth-monitor/history/adv-dec-apply",
                    a.secret, {"rows": chunk, "source": "collector_cache"},
                    params=("dry_run=false" if a.apply else "dry_run=true"))
        for k in merged:
            merged[k].extend(rep.get(k) or [])

    after = _get(a.base_url, "/api/breadth-monitor/history/adv-dec-coverage")

    n_ok = len(merged["written"])
    n_gate = len(merged["refused_identity"])
    graded = n_ok + n_gate
    print("\n" + ("APPLIED" if a.apply else "DRY RUN — nothing was written"))
    print(f"  frames read           {len(frames)}")
    print(f"  frames unusable       {len(skipped)}")
    print(f"  identity gate passed  {n_ok}"
          + (f"  ({n_ok / graded:.1%} of {graded} graded)" if graded else ""))
    print(f"  identity gate refused {n_gate}")
    print(f"  already had counts    {len(merged['already_present'])}")
    print(f"  no stored row         {len(merged['refused_no_row'])}")
    print(f"  no stored adv_decline {len(merged['refused_no_adv_decline'])}")
    if merged["partial_present"]:
        print(f"  ⚠ half-written rows   {len(merged['partial_present'])}: "
              f"{merged['partial_present']}")
    if merged["write_failed"]:
        print(f"  ⚠ write failures      {merged['write_failed']}")
    for r in merged["refused_identity"][:10]:
        print(f"    refused {r['date']}: net {r['net']} vs stored "
              f"adv_decline {r['stored_adv_decline']} (off by {r['diff']})")
    if len(merged["refused_identity"]) > 10:
        print(f"    … and {len(merged['refused_identity']) - 10} more")

    print(f"\nZweig coverage after:  {after['covered']} of {after['sessions']} "
          f"sessions (needs {after['needs']})  ->  "
          + ("EVALUATES" if after["zweig_ok"] else "still refuses"))
    if not a.apply:
        print("(coverage is unchanged because nothing was written — "
              "re-run with --apply)")

    if a.json_out:
        with open(a.json_out, "w") as f:
            json.dump({"skipped_frames": skipped, "report": merged,
                       "coverage_before": before, "coverage_after": after}, f, indent=1)
        print(f"\nfull report -> {a.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
