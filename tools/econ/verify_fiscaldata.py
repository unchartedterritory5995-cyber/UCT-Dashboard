"""Live verification of the Treasury Fiscal Data adapter (keyless).

Fetches the FULL history of USDEBT / USTGA / USMTSDEF (history mode, paged)
and the release calendar, prints per series: symbol, count, oldest, newest,
newest value, units, publication metadata; then compares with Phase 0.

    python -m tools.econ.verify_fiscaldata
"""
from __future__ import annotations

import collections
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ import timeutil  # noqa: E402
from api.services.econ.adapters import fiscaldata  # noqa: E402
from api.services.econ.adapters.base import as_specs  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

COHORT = ["USDEBT", "USTGA", "USMTSDEF"]
# Phase 0 proofs.md / proof_log.txt (2026-09-28)
PHASE0 = {"USDEBT": ("2026-09-25", 40097178119750.91),
          "USTGA": ("2026-09-25", 945290.0),
          "USMTSDEF": ("2026-08-01", 166796952277.38)}


def _specs():
    with open(os.path.join(ROOT, "api", "services", "econ", "registry", "series.json"), encoding="utf-8") as f:
        e = {x["symbol"]: x for x in json.load(f)}
    return as_specs([e[s] for s in COHORT])


def main() -> int:
    http = HttpClient()
    ad = fiscaldata.FiscalDataAdapter()
    print(f"# Fiscal Data live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}  (keyless)")
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
        na = sum(1 for o in obs if o.value is None)
        wkend = sum(1 for o in obs if timeutil.is_weekend(o.period_start)) if spec.frequency == "D" else 0
        print(f"\n{spec.symbol}  request_key={res.request_key}")
        print(f"  count={len(obs)}  NA={na}  weekend_rows={wkend}  oldest={obs[0].period_start}  "
              f"newest={new.period_start}..{new.period_end}  newest_value={new.value!r}  "
              f"units={spec.units.get('raw')!r}  bytes={res.payload_bytes}  "
              f"source_published_at={res.source_published_at}  warnings={res.warnings}")
        exp = PHASE0.get(spec.symbol)
        got = {o.period_start: o.value for o in obs}
        if exp:
            v = got.get(exp[0])
            ok = v is not None and abs(v - exp[1]) < 1e-6 * max(1.0, abs(exp[1]))
            print(f"  Phase0 {exp[0]} = {exp[1]!r}  adapter = {v!r}  -> {'MATCH' if ok else 'MISMATCH'}")
            rc |= 0 if ok else 1
        if spec.symbol == "USTGA":
            for d in ("2021-09-30", "2021-10-01", "2022-04-15", "2022-04-18"):
                print(f"  splice {d}: {got.get(d)!r}")
        if spec.symbol == "USMTSDEF":
            for d in ("2026-04-01", "2025-09-01", "2013-10-01"):
                print(f"  {d}: {got.get(d)!r}  (provider sign: deficit +, surplus -)")
    try:
        cal = fiscaldata.release_calendar(http)
        mine = [e for e in cal if e["calendar_key"]]
        print(f"\ncalendar: {len(cal)} rows, {len(mine)} for fiscal:dts/dtp/mts; window "
              f"{cal[0]['sched_date'] if cal else '-'}..{cal[-1]['sched_date'] if cal else '-'}")
        by = collections.defaultdict(collections.Counter)
        for e in mine:
            by[e["calendar_key"]][e["sched_time"] + " ET"] += 1
        for k, c in sorted(by.items()):
            nxt = next((e for e in mine if e["calendar_key"] == k and not e["released"]), None)
            print(f"  {k}: ET times {dict(c)}; next unreleased {nxt['sched_date'] + ' ' + nxt['sched_time'] if nxt else '-'}")
    except EconError as e:
        print(f"calendar FAILED {type(e).__name__}: {e}")
        rc = 1
    print(f"\nhttp stats: {http.stats()}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
