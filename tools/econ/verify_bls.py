"""Live verification of the BLS adapter (keyless v1 unless BLS_API_KEY is set).

Fetches the FULL available history of every BLS cohort series (history mode,
windows planned by the adapter, all cohort series batched into each query) and
prints, per series: symbol, count, oldest period, newest period, newest value
(+flag), units, publication metadata. Then runs ``latest_period_probe`` once.

QUOTA: keyless v1 = 25 queries/day per IP, shared with other work. This script
prints the planned query count first and refuses to run above ``--max-queries``
(default 15). A quota answer stops the run and reports what was completed.

    python -m tools.econ.verify_bls [--save-raw DIR] [--max-queries 15] [--no-probe]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ.adapters import bls  # noqa: E402
from api.services.econ.adapters.base import as_specs  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

COHORT = ["USCPI", "USCPINSA", "USCORECPI", "USCORECPINSA", "USPPIFD", "USECI",
          "USUNRATE", "USNFP", "USJOLTSO"]

# Phase 0 proofs.md (2026-09-28), Aug 2026 prints; FRED cross-check values in the same table.
PHASE0 = {"USCPI": ("2026-08-01", 334.131), "USCPINSA": ("2026-08-01", 334.980),
          "USCORECPI": ("2026-08-01", 337.765), "USUNRATE": ("2026-08-01", 4.1),
          "USNFP": ("2026-08-01", 159075.0)}


def _load_specs():
    path = os.path.join(ROOT, "api", "services", "econ", "registry", "series.json")
    with open(path, encoding="utf-8") as f:
        entries = {e["symbol"]: e for e in json.load(f)}
    return as_specs([entries[s] for s in COHORT])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-raw", default=None, help="directory to write raw payloads (fixtures)")
    ap.add_argument("--max-queries", type=int, default=15)
    ap.add_argument("--no-probe", action="store_true")
    args = ap.parse_args(argv)

    specs = _load_specs()
    ad = bls.BlsAdapter(trim_to_history_start=False)     # discover the TRUE oldest period
    by_id = {bls.series_id_of(s): s for s in specs}
    queries = bls.plan_queries(specs, mode="history", start=date(bls.EARLIEST_YEAR, 1, 1),
                               keyed=ad.keyed, trim_to_history_start=False)
    planned = len(queries) + (0 if args.no_probe else 1)
    print(f"# BLS live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}  "
          f"mode={ad.version} ({'keyed' if ad.keyed else 'keyless'})")
    print(f"# planned queries: {len(queries)} history windows + {0 if args.no_probe else 1} probe "
          f"= {planned}  (limit/day {ad.limits.queries_per_day}, task budget {args.max_queries})")
    if planned > args.max_queries:
        print("# REFUSING: plan exceeds --max-queries")
        return 2

    http = HttpClient(max_retries=1)          # every retry may cost quota
    obs = {s.symbol: [] for s in specs}
    warnings: list[str] = []
    done = 0
    stopped = None
    for q in queries:
        try:
            res, _ = ad._run(q, by_id, http)
        except EconError as e:
            stopped = f"{type(e).__name__}: {e} (reason={getattr(e, 'reason', '-')}) at {q.request_key()}"
            break
        done += 1
        for o in res.observations:
            obs[o.series_id].append(o)
        warnings += [w for w in res.warnings if not w.startswith("bls: no data")]
        print(f"#   {q.request_key()}  rows={len(res.observations)}  bytes={res.payload_bytes}  "
              f"sha={res.payload_sha256[:12]}")
        if args.save_raw:
            os.makedirs(args.save_raw, exist_ok=True)
            with open(os.path.join(args.save_raw, f"v1_{q.start_year}_{q.end_year}.json"), "wb") as f:
                f.write(res.raw_payload or b"")

    probe = None
    if stopped is None and not args.no_probe:
        try:
            probe = ad.latest_period_probe(specs, http)
            done += 1
        except EconError as e:
            stopped = f"probe {type(e).__name__}: {e} (reason={getattr(e, 'reason', '-')})"

    print()
    print(f"{'symbol':<13} {'bls id':<22} {'count':>5} {'NA':>3} {'oldest':<10} {'newest':<10} "
          f"{'newest value':>12} flag  units / publication")
    for s in specs:
        rows = sorted(obs[s.symbol], key=lambda o: o.period_start)
        vals = [o for o in rows if o.value is not None]
        na = len(rows) - len(vals)
        if not rows:
            print(f"{s.symbol:<13} {bls.series_id_of(s):<22} {0:>5}  (no rows)")
            continue
        newest = vals[-1] if vals else rows[-1]
        print(f"{s.symbol:<13} {bls.series_id_of(s):<22} {len(rows):>5} {na:>3} "
              f"{rows[0].period_start:<10} {newest.period_start:<10} {newest.value!s:>12} "
              f"{newest.flag or '-':<4}  {s.units.get('raw')} / source_published_at=None (BLS states none)")
    print()
    print("# NA rows (value None):", {s.symbol: [o.period_start for o in obs[s.symbol] if o.value is None]
                                      for s in specs if any(o.value is None for o in obs[s.symbol])})
    print("# preliminary-flagged rows:", {s.symbol: [o.period_start for o in obs[s.symbol] if o.flag == "p"]
                                         for s in specs if any(o.flag == "p" for o in obs[s.symbol])})
    print("# registry history_start vs observed oldest:")
    for s in specs:
        rows = sorted(obs[s.symbol], key=lambda o: o.period_start)
        if rows:
            print(f"#   {s.symbol:<13} registry={s.get('history_start')}  observed={rows[0].period_start[:7]}")
    if warnings:
        print("# warnings:", warnings[:20])
    print()
    print("# Phase 0 cross-check (proofs.md, Aug 2026):")
    for sym, (period, want) in PHASE0.items():
        got = next((o for o in obs.get(sym, []) if o.period_start == period), None)
        if got is None:
            print(f"#   {sym:<13} {period} MISSING")
        else:
            print(f"#   {sym:<13} {period} phase0={want} live={got.value} flag={got.flag or '-'} "
                  f"{'MATCH' if got.value == want else 'MISMATCH'}")
    if probe is not None:
        print(f"# latest_period_probe: {probe}")
    st = http.stats()
    print(f"# queries sent: {ad.queries_sent}  (completed {done})  http stats: {st['by_host']}")
    if stopped:
        print(f"# STOPPED: {stopped}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
