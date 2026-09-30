"""Live verification of the FHFA HPI adapter (keyless, hpi_master.csv ~17 MB).

Also lists the (hpi_type, hpi_flavor, frequency, level, place_name, place_id)
identities present for place_id='USA' so the registry filter is evidenced.

    python -m tools.econ.verify_fhfa
"""
from __future__ import annotations

import collections
import csv
import io
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ.adapters import fhfa  # noqa: E402
from api.services.econ.adapters.base import as_specs  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

COHORT = ["USFHFAHPI"]
PHASE0 = {"USFHFAHPI": ("2026-06-01", 442.53)}   # proof_log.txt: 2026-06 NSA 452.26 / SA 442.53


class _Tap:
    """Wrap the client to keep the last body for the identity listing (no 2nd download)."""
    def __init__(self, http):
        self.http, self.last = http, None

    def get(self, *a, **k):
        r = self.http.get(*a, **k)
        self.last = r
        return r


def main() -> int:
    with open(os.path.join(ROOT, "api", "services", "econ", "registry", "series.json"), encoding="utf-8") as f:
        e = {x["symbol"]: x for x in json.load(f)}
    [spec] = as_specs([e[s] for s in COHORT])
    http = HttpClient()
    tap = _Tap(http)
    print(f"# FHFA live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}  (keyless)")
    try:
        [res] = fhfa.FhfaAdapter().fetch([spec], mode="history", start=None, end=None, http=tap)
    except EconError as ex:
        print(f"{spec.symbol}: FAILED {type(ex).__name__}: {ex}")
        return 1
    obs = res.observations
    new = obs[-1]
    h = tap.last.headers
    print(f"\n{spec.symbol}  request_key={res.request_key}")
    print(f"  count={len(obs)}  NA={sum(1 for o in obs if o.value is None)}  oldest={obs[0].period_start}  "
          f"newest={new.period_start}..{new.period_end}  newest_value={new.value!r}  "
          f"units={spec.units.get('raw')!r}  bytes={res.payload_bytes}")
    print(f"  source_published_at={res.source_published_at}  validators: etag={h.get('etag')!r} "
          f"last-modified={h.get('last-modified')!r} cache-control={h.get('cache-control')!r}")
    for o in obs[-3:]:
        print(f"    {o.period_start}  {o.value}")
    exp = PHASE0[spec.symbol]
    v = {o.period_start: o.value for o in obs}.get(exp[0])
    ok = v == exp[1]
    print(f"  Phase0 {exp[0]} = {exp[1]!r}  adapter = {v!r}  -> {'MATCH' if ok else 'MISMATCH'}")
    rows = csv.DictReader(io.StringIO(tap.last.content.decode("utf-8-sig")))
    ids = collections.Counter((r["hpi_type"], r["hpi_flavor"], r["frequency"], r["level"], r["place_name"],
                               r["place_id"]) for r in rows if r["place_id"] == "USA")
    print("\n  identities with place_id='USA' (rows):")
    for k, n in sorted(ids.items()):
        print(f"    {n:4d}  {k}")
    print(f"\nhttp stats: {http.stats()}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
