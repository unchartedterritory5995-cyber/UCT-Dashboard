"""Live verification of the NY Fed adapters (nyfed Markets API + nyfed_esms Empire survey).

For every nyfed / nyfed_esms COHORT series: fetch the FULL history (history
mode; the Markets API in calendar-year windows) and print symbol, count,
oldest, newest, newest value, NA count, units and per-row publication metadata.
Then compare with Phase 0 proofs.md and a secondary reference (H.15 RIFSPFF_N.B
for EFFR; the Sep 2026 Empire report text for ESMS; FOMC 2026-09-17 decision for
the target range), plus two research probes: EFFR from the API's earliest date
(pre-2016 methodology) and ON RRP award rate (USONRRPRATE, non-cohort).

The corrections in docs/economic-data/registry-corrections/{nyfed,nyfed_esms}.json
are OVERLAID in memory (the registry file is untouched); the run prints which.

Requests: ~19 (EFFR family 2008-12-16..today) + 9 (SOFR) + 14 (RRP) + 1 (ESMS)
+ 1 H.15 zip + probes; sequential with the client's politeness interval.

    python -m tools.econ.verify_nyfed [--no-probes]
"""
from __future__ import annotations

import argparse
import copy
import os
import sys
from datetime import date, datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ.adapters import fed_ddp, nyfed, nyfed_esms  # noqa: E402
from api.services.econ.adapters.base import SeriesSpec  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402
from tools.econ.verify_fed_ddp import load_specs  # noqa: E402

COHORT = ["USEFFR", "USFEDFUNDSU", "USFEDFUNDSL", "USSOFR", "USRRP"]
ESMS = ["USEMPIRE"]
# Phase 0 proofs.md / proof_log.txt (2026-09-28)
PHASE0 = {"USEFFR": ("2026-09-25", 3.88), "USFEDFUNDSU": ("2026-09-25", 4.00),
          "USFEDFUNDSL": ("2026-09-25", 3.75), "USSOFR": ("2026-09-25", 3.90),
          "USRRP": ("2026-09-28", 851000000.0)}
# Empire State report, Sep 2026 (newyorkfed.org/survey/empire): "The headline general
# business conditions index fell thirteen points but remained positive at 7.6."
ESMS_REF = ("2026-09-01", 7.6, "2026-08-01", 20.6)


def _summ(sym, obs, units, extra=""):
    vals = [o for o in obs if o.value is not None]
    if not obs:
        print(f"{sym:12} count=0")
        return None
    last = vals[-1] if vals else obs[-1]
    pub = last.source_published_at
    pubs = (datetime.fromtimestamp(pub, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if pub else "-")
    flags = sum(1 for o in obs if o.flag)
    print(f"{sym:12} {len(obs):>6} {len(obs) - len(vals):>4} {flags:>5} {obs[0].period_start:10} "
          f"{last.period_start:10} {last.value:>16,.4f}  {units:28} {pubs} {extra}")
    return last


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-probes", action="store_true")
    args = ap.parse_args(argv)
    http = HttpClient()
    print(f"# NY Fed (nyfed + nyfed_esms) live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}")
    specs, applied = load_specs("nyfed", COHORT)
    especs, eapplied = load_specs("nyfed_esms", ESMS)
    print(f"# registry overlay applied: {', '.join(applied + eapplied) or 'none'}")
    print(f"\n## 1. history (full)\n{'symbol':12} {'count':>6} {'NA':>4} {'flagr':>5} {'oldest':10} "
          f"{'newest':10} {'newest value':>16}  {'units.raw (registry)':28} source_published_at(newest)")
    newest = {}
    ad = nyfed.NyFedAdapter()
    for group in (specs[:3], specs[3:4], specs[4:5]):
        try:
            res = ad.fetch(group, mode="history", start=None, end=None, http=http)
        except EconError as e:
            print(f"{[s.symbol for s in group]} FAILED {e}")
            continue
        for s in group:
            obs = [o for r in res for o in r.observations if o.series_id == s.symbol]
            newest[s.symbol] = _summ(s.symbol, obs, str(s.units.get("raw")), f"floor={nyfed.floor_of(s)}")
    esa = nyfed_esms.NyFedEsmsAdapter()
    try:
        [r] = esa.fetch(especs, mode="history", start=None, end=None, http=http)
        for s in especs:
            obs = [o for o in r.observations if o.series_id == s.symbol]
            newest[s.symbol] = _summ(s.symbol, obs, str(s.units.get("raw")),
                                     f"file={nyfed_esms.file_of(s)} column={nyfed_esms.column_of(s)}")
            prev = [o for o in obs if o.period_start == ESMS_REF[2]]
            newest[s.symbol + ":prev"] = prev[0] if prev else None
    except EconError as e:
        print(f"USEMPIRE FAILED {e}")

    print("\n## 2. latest mode (what the scheduler polls)")
    for group in (specs[:3], specs[3:4], specs[4:5]):
        try:
            res = ad.fetch(group, mode="latest", start=None, end=None, http=http)
        except EconError as e:
            print(f"latest {[s.symbol for s in group]} FAILED {e}")
            continue
        for r in res:
            for s in group:
                obs = [o for o in r.observations if o.series_id == s.symbol]
                o = obs[-1] if obs else None
                print(f"{s.symbol:12} n={len(obs):3} newest {o.period_start if o else '-'} "
                      f"{o.value if o else '-'}   request_key={r.request_key}")

    print("\n## 3. Phase 0 proofs.md comparison")
    for sym, (p, v) in PHASE0.items():
        o = newest.get(sym)
        ok = o is not None and o.period_start == p and abs(o.value - v) < 1e-9
        print(f"{sym:12} phase0 {p} {v:,.2f}  live {o.period_start if o else '-'} "
              f"{(f'{o.value:,.2f}') if o else '-'}  -> {'MATCH' if ok else 'MISMATCH'}")
    o, prev = newest.get("USEMPIRE"), newest.get("USEMPIRE:prev")
    ok = (o is not None and (o.period_start, o.value) == ESMS_REF[:2] and prev is not None
          and prev.value == ESMS_REF[3])
    print(f"USEMPIRE     NY Fed Sep 2026 report 'fell thirteen points ... at 7.6' (Aug 20.6)  live "
          f"{o.period_start if o else '-'} {o.value if o else '-'} (Aug {prev.value if prev else '-'})  -> "
          f"{'MATCH' if ok else 'MISMATCH'}")

    print("\n## 4. secondary reference: H.15 RIFSPFF_N.B (Board release file) vs NY Fed EFFR")
    try:
        e = {"symbol": "USFEDFUNDS_H15", "frequency": "D", "units": {"raw": "Percent"},
             "source": {"adapter": "fed_ddp", "params": {"release": "H15", "dataset": "H15",
                                                         "series": "RIFSPFF_N.B"}}}
        [r] = fed_ddp.FedDdpAdapter().fetch([SeriesSpec(e)], mode="history", start=date(2016, 3, 1),
                                            end=None, http=http)
        h15 = {o.period_start: o.value for o in r.observations if o.value is not None}
        eff = newest.get("USEFFR")
        effr = [o for o in ad.fetch([specs[0]], mode="history", start=date(2016, 3, 1), end=None,
                                    http=http)[0].observations if o.value is not None]
        common = [o for o in effr if o.period_start in h15]
        diff = [o for o in common if abs(o.value - h15[o.period_start]) > 1e-9]
        print(f"EFFR 2016-03-01..: NY Fed {len(effr)} rows, H.15 {len(h15)} rows, common {len(common)}, "
              f"value differences {len(diff)}" + (f" e.g. {[(o.period_start, o.value, h15[o.period_start]) for o in diff[:3]]}" if diff else ""))
        if eff:
            print(f"newest: NY Fed {eff.period_start} {eff.value}  H.15 {max(h15)} {h15[max(h15)]}  -> "
                  f"{'MATCH' if h15.get(eff.period_start) == eff.value else 'MISMATCH'}")
    except EconError as ex:
        print(f"H.15 reference unavailable: {ex}")
    up, lo = newest.get("USFEDFUNDSU"), newest.get("USFEDFUNDSL")
    print("FOMC 2026-09-17 (+25bp -> 3.75-4.00, Fed monetarypolicy/openmarket.htm, Phase 0): live range "
          f"{lo.value if lo else '-'}-{up.value if up else '-'}  -> "
          f"{'MATCH' if up and lo and (lo.value, up.value) == (3.75, 4.00) else 'MISMATCH'}")

    if not args.no_probes:
        print("\n## 5. research probes (not cohort configuration)")
        try:
            e = copy.deepcopy(specs[0].raw)
            e["source"]["params"]["min_date"] = "2000-07-01"
            res = ad.fetch([SeriesSpec(e)], mode="history", start=date(2000, 7, 1), end=date(2016, 3, 31), http=http)
            obs = [o for o in res[0].observations]
            pre = [o for o in obs if o.period_start < "2016-03-01"]
            print(f"EFFR on the API before 2016-03-01: {len(pre)} rows {pre[0].period_start}..{pre[-1].period_start} "
                  f"(first {pre[0].value}); 2016-02-29 {pre[-1].value} -> 2016-03-01 "
                  f"{next(o.value for o in obs if o.period_start == '2016-03-01')}")
        except (EconError, StopIteration, IndexError) as ex:
            print(f"EFFR pre-2016 probe failed: {ex}")
        try:
            base = {"path": "/api/rp/results/search.json", "query": {"term": "overnight"},
                    "filter": {"operationType": "Reverse Repo", "term": "Overnight"}}
            rate = SeriesSpec({"symbol": "USONRRPRATE", "frequency": "D", "history_start": "2013-09-23",
                               "source": {"adapter": "nyfed", "params": {
                                   **base, "field": "details.percentAwardRate", "aggregate": "primary"}}})
            total = SeriesSpec({"symbol": "USRRP_TOTAL", "frequency": "D", "history_start": "2013-09-23",
                                "source": {"adapter": "nyfed", "params": {**base, "field": "totalAmtAccepted"}}})
            res = ad.fetch([rate, total], mode="history", start=None, end=None, http=http)
            obs = [o for r in res for o in r.observations]
            _summ("USONRRPRATE", [o for o in obs if o.series_id == "USONRRPRATE"],
                  "Percent (details.percentAwardRate)")
            tot = {o.period_start: o.value for o in obs if o.series_id == "USRRP_TOTAL"}
            mine = {o.period_start: o.value for o in ad.fetch([specs[4]], mode="history", start=None, end=None,
                                                             http=http)[0].observations}
            diff = sorted(d for d in tot if mine.get(d) != tot[d])
            print(f"USRRP primary op vs SUM of all Overnight RRP ops (small value exercises): {len(diff)} of "
                  f"{len(tot)} dates differ: "
                  + ", ".join(f"{d} {mine.get(d) or 0:,.0f} vs {tot[d]:,.0f}" for d in diff[:10]))
        except EconError as ex:
            print(f"USONRRPRATE / RRP probe: {ex}")
    print(f"\n# http stats: {http.stats()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
