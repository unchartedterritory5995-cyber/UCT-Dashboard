"""LIVE verification of the Census adapter (keyless econ_export CSV unless CENSUS_API_KEY is set).

    python tools/econ/verify_census.py [--save-dir DIR] [--symbols USRETAIL,...]
        [--params-json '{"USDURGOODS": {"advance_program": "advm3"}}']

For every Census cohort series: fetch the FULL history through the adapter and
print symbol, count, oldest/newest period, newest value (+flag), registry units.
Then compare the newest values with the Phase 0 proofs. ``--params-json`` overlays
PROPOSED registry params (docs/economic-data/registry-corrections/census.json)
without editing series.json. Read-only, sequential, one small CSV per request.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from api.services.econ import registry  # noqa: E402
from api.services.econ.adapters.base import SeriesSpec  # noqa: E402
from api.services.econ.adapters.census import CensusAdapter  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402

COHORT = ["USRETAIL", "USHOUST", "USDURGOODS", "USTRADEBAL"]
PHASE0 = {
    "USRETAIL": ("2026-08-01", 773947.0, "proofs.md + proofs/census_marts_current.xlsx Table 1 SA total Aug.(a)"),
    "USHOUST": ("2026-08-01", 1275.0, "proofs.md: starts Aug 1,275k SAAR (newresconst.xlsx)"),
}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-dir")
    ap.add_argument("--symbols", default=",".join(COHORT))
    ap.add_argument("--params-json", default="")
    a = ap.parse_args(argv)
    overlay = json.loads(a.params_json) if a.params_json else {}
    specs = []
    for s in [x.strip().upper() for x in a.symbols.split(",") if x.strip()]:
        e = copy.deepcopy(registry.get(s))
        e["source"]["params"].update(overlay.get(s, {}))
        specs.append(SeriesSpec(e))
    http = HttpClient(default_interval=1.0)
    ad = CensusAdapter()
    mode = "keyed (EITS API)" if ad.key() else "keyless (census.gov econ_export CSV)"
    print(f"# verify_census  run {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ}  mode={mode}")
    if overlay:
        print(f"# params overlay (proposed corrections): {json.dumps(overlay)}")
    rows_by = {}
    print(f"\n{'symbol':<11} {'provider id':<22} {'count':>5} {'oldest':<11} {'newest':<11} "
          f"{'newest value':>13} flag  units(raw)")
    for s in specs:
        t0 = time.time()
        (r,) = ad.fetch([s], mode="history", start=None, end=None, http=http)
        rows = sorted(r.observations, key=lambda o: o.period_start)
        rows_by[s.symbol] = rows
        nn = [o for o in rows if o.value is not None]
        last = nn[-1]
        print(f"{s.symbol:<11} {s.provider_series_id:<22} {len(rows):>5} {rows[0].period_start:<11} "
              f"{last.period_start:<11} {last.value:>13,.0f} {last.flag or '-':<4}  {s.units.get('raw')}"
              f"   (NA rows {len(rows) - len(nn)}; {r.payload_bytes:,} B; {time.time() - t0:.1f}s)")
        print(f"{'':<11} request_key={r.request_key}  published={r.source_published_at}  "
              f"warnings={r.warnings}")
        tail = ", ".join(f"{o.period_start[:7]}={o.value:,.0f}{('(' + o.flag + ')') if o.flag else ''}"
                         for o in nn[-4:])
        print(f"{'':<11} last 4: {tail}")
        if a.save_dir and r.raw_payload:
            p = Path(a.save_dir) / f"{s.symbol}.csv"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(r.raw_payload)
    print("\n# Phase 0 comparison")
    for sym, (period, val, src) in PHASE0.items():
        got = {o.period_start: o.value for o in rows_by.get(sym, [])}.get(period)
        verdict = "MATCH" if got is not None and abs(got - val) < 1e-9 else "MISMATCH"
        print(f"{sym:<11} {period} phase0={val:,.0f} now={got!r}  {verdict}   [{src}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
