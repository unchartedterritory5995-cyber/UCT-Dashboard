# -*- coding: utf-8 -*-
"""intraday_table.py - what a member on an INTRADAY chart is served, from a census run with --chart-tfs (e98).

    python tools/pine_coverage/intraday_table.py --prod <cache>/census.jsonl --rt <cache>/census.jsonl \
        [--manifest <cache>/sample_manifest.json] [--json out.json]

The member door translates at the daily base whatever the chart, so the intraday picture is the daily door's verdict
AND the bind at the chart's timeframe (`coverageMapDoorCensus.measure.test.js` `boundAt`, `cleanBoundAt`). This reads
both lanes' rows and prints, per population (committed / reference / builtin / example), the scripts served when bound
at D (the census's own `cleanBound`, and on the runtime-on lane a runtime-lane attach) beside the same predicate at each
intraday timeframe, then the blocker codes an intraday bind adds to scripts the daily bind serves, and every refusal the
binds EXCLUDED as store-dependent, by code and count (an exclusion is never silent).

⛔ CENSUS-NATIVE: "served" here is the census's bound predicate, comparable across D / 60 / 5 within this table. It is
not the coverage map's headline (which applies its own order, kill and listing rules on top).
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re


def rows_of(path):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:  # noqa: BLE001
            continue
    return out


def population(key):
    return key.split(":", 1)[0]


def blocker_code(why: str) -> str:
    """`column-error:<row key>:<guard>` -> `column-error:<guard>`; `other-symbol:<code>:<ticker>` -> its code; else as is."""
    parts = why.split(":")
    if parts[0] == "column-error" and len(parts) >= 3:
        return "column-error:" + ":".join(parts[2:])
    if parts[0] == "other-symbol" and len(parts) >= 3:
        return "other-symbol:" + ":".join(parts[1:-1])
    if parts[0] == "objects" and len(parts) >= 2:
        return "objects:" + parts[1]
    return re.sub(r"\d+$", "", why)


def served_daily(row, lane):
    first = (row.get("steps") or [{}])[0]
    if row.get("cleanBound") is True:
        return True
    return lane == "runtime-on" and bool(row.get("attached")) and first.get("lane") == "runtime" \
        and isinstance(first.get("boundWhy"), list) and not first["boundWhy"]


def served_at(row, lane, tf):
    first = (row.get("steps") or [{}])[0]
    at = (first.get("boundAt") or {}).get(tf)
    if not at:
        return False
    if (row.get("cleanBoundAt") or {}).get(tf) is True:
        return True
    return lane == "runtime-on" and bool(row.get("attached")) and first.get("lane") == "runtime" and at.get("clean") is True


def table(rows, lane, tfs):
    pops = collections.OrderedDict()
    added = {tf: collections.Counter() for tf in tfs}
    excluded = {tf: collections.Counter() for tf in tfs}
    excluded_daily_served = {tf: collections.Counter() for tf in tfs}
    for r in rows:
        if r.get("stuck") == "killed" and "lane" not in r:
            continue
        p = population(r.get("key", "?"))
        c = pops.setdefault(p, collections.Counter())
        c["rows"] += 1
        d = served_daily(r, lane)
        c["D"] += d
        first = (r.get("steps") or [{}])[0]
        for tf in tfs:
            s = served_at(r, lane, tf)
            c[tf] += s
            at = (first.get("boundAt") or {}).get(tf) or {}
            for code, n in (at.get("excluded") or {}).items():
                excluded[tf][code] += n
                if d:
                    excluded_daily_served[tf][code] += n
            if d and not s:
                daily_why = {blocker_code(w) for w in (first.get("boundWhy") or [])}
                for w in sorted({blocker_code(x) for x in (at.get("why") or [])} - daily_why):
                    added[tf][w] += 1
    return pops, added, excluded, excluded_daily_served


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--prod", required=True)
    ap.add_argument("--rt", required=True)
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    report = {}
    for lane, path in (("production", a.prod), ("runtime-on", a.rt)):
        rows = rows_of(path)
        tfs = sorted({tf for r in rows for tf in (r.get("chartTfs") or [])}, key=lambda x: int(x), reverse=True)
        if not tfs:
            raise SystemExit("%s holds no row bound at an intraday timeframe (run_census.py --chart-tfs)" % path)
        pops, added, excluded, exc_d = table(rows, lane, tfs)
        print("\n## %s lane (%d rows; bound at D, %s)" % (lane, len(rows), ", ".join(tfs)))
        print("| population | rows | served D | " + " | ".join("served %s" % tf for tf in tfs) + " |")
        print("|---|---:|---:|" + "---:|" * len(tfs))
        total = collections.Counter()
        for p, c in pops.items():
            total.update(c)
            print("| %s | %d | %d | %s |" % (p, c["rows"], c["D"], " | ".join(str(c[tf]) for tf in tfs)))
        print("| **all** | %d | %d | %s |" % (total["rows"], total["D"], " | ".join(str(total[tf]) for tf in tfs)))
        for tf in tfs:
            print("\nserved at D, not at %s: the blocker codes the %s bind adds (scripts per code, top 15)" % (tf, tf))
            for code, n in added[tf].most_common(15):
                print("  %4d  %s" % (n, code))
            print("excluded as store-dependent at %s (refusals; of them on daily-served scripts):" % tf)
            for code, n in excluded[tf].most_common():
                print("  %4d (%d)  %s" % (n, exc_d[tf][code], code))
        report[lane] = {"tfs": tfs, "populations": {p: dict(c) for p, c in pops.items()},
                        "added": {tf: dict(added[tf]) for tf in tfs}, "excluded": {tf: dict(excluded[tf]) for tf in tfs}}
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1)
    return report


if __name__ == "__main__":
    main()
