"""Live verification of the EIA adapter.

Keyless unless EIA_API_KEY is set (none is configured locally): the dnav
LeafHandler history page per series + a 1-byte Range probe of the matching
hist_xls file for the release instant. Prints per series: symbol, count,
oldest, newest, newest value, units, publication metadata; compares with
Phase 0.

    python -m tools.econ.verify_eia
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ import timeutil  # noqa: E402
from api.services.econ.adapters import eia  # noqa: E402
from api.services.econ.adapters.base import as_specs  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

COHORT = ["USCRUDEINV", "USGASPRICE"]
# Phase 0 proofs.md: crude wk 9/18 426,398 kbbl (table1.csv 426.398 MMbbl, WCESTUS1w.xls 426,398)
PHASE0 = {"USCRUDEINV": ("2026-09-18", 426398.0)}


def _specs():
    with open(os.path.join(ROOT, "api", "services", "econ", "registry", "series.json"), encoding="utf-8") as f:
        e = {x["symbol"]: x for x in json.load(f)}
    return as_specs([e[s] for s in COHORT])


def main() -> int:
    http = HttpClient()
    ad = eia.EiaAdapter()
    mode = "keyed (API v2)" if ad.key() else "keyless (dnav LeafHandler + hist_xls Range probe)"
    print(f"# EIA live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}  {mode}")
    rc = 0
    for spec in _specs():
        try:
            [res] = ad.fetch([spec], mode="history", start=None, end=None, http=http)
        except EconError as e:
            print(f"{spec.symbol}: FAILED {type(e).__name__}: {e}")
            rc = 1
            continue
        obs = res.observations
        new = obs[-1]
        na = [o.period_end for o in obs if o.value is None]
        pub = res.source_published_at
        pub_s = (f"{pub} = {datetime.fromtimestamp(pub, timezone.utc):%Y-%m-%dT%H:%M:%SZ} = "
                 f"{timeutil.utc_to_et(pub):%a %Y-%m-%d %H:%M} ET") if pub else "None"
        print(f"\n{spec.symbol}  ({spec.params.get('series_id')})  request_key={res.request_key}")
        print(f"  count={len(obs)}  NA={len(na)} {na[:6]}  oldest={obs[0].period_start}..{obs[0].period_end}  "
              f"newest={new.period_start}..{new.period_end} ({timeutil.as_date(new.period_end):%a})  "
              f"newest_value={new.value!r}  units={spec.units.get('raw')!r}  bytes={res.payload_bytes}")
        print(f"  source_published_at={pub_s}  warnings={res.warnings}")
        exp = PHASE0.get(spec.symbol)
        if exp:
            v = {o.period_end: o.value for o in obs}.get(exp[0])
            ok = v == exp[1]
            print(f"  Phase0 wk {exp[0]} = {exp[1]!r}  adapter = {v!r}  -> {'MATCH' if ok else 'MISMATCH'}")
            rc |= 0 if ok else 1
        for o in obs[-3:]:
            print(f"    {o.period_start}..{o.period_end}  {o.value}")
    print(f"\nhttp stats: {http.stats()}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
