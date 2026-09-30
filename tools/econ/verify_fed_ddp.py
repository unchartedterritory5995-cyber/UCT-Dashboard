"""Live verification of the Federal Reserve Board adapter (fed_ddp).

For every fed_ddp COHORT series: fetch the FULL history through the default
transport (release_xml = the release-page SDMX zips that survive the DDP
retirement) and print symbol, count, oldest, newest, newest value, NA count,
units + the provider's own identity metadata, and the file's validators.
Then cross-check the newest values against (a) the DDP CSV package transport,
(b) Phase 0 proofs.md, (c) the Treasury par yield curve (secondary reference for
the CMT yields), and read the RSS arrival feeds.

The registry corrections in docs/economic-data/registry-corrections/fed_ddp.json
are OVERLAID in memory (the registry file itself is not touched) -- the run
prints which were applied, so the output verifies the corrected configuration.

Requests (sequential, polite): 4 release zips (1.4-9 MB), 4 DDP packages
(lastobs), 4 RSS feeds, 1 Treasury CSV.

    python -m tools.econ.verify_fed_ddp [--no-crosscheck]
"""
from __future__ import annotations

import argparse
import copy
import csv
import io
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ.adapters import fed_ddp  # noqa: E402
from api.services.econ.adapters.base import SeriesSpec  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

COHORT = ["UST2Y", "UST10Y", "USFEDBAL", "USM2", "USINDPRO"]
# Phase 0 proofs.md (2026-09-28) + proof_log.txt newest values.
PHASE0 = {"UST10Y": ("2026-09-25", 5.17), "USFEDBAL": ("2026-09-17", 6747704.0),
          "USM2": ("2026-08-01", 23342.8), "USINDPRO": ("2026-08-01", 103.0682)}
TSY_URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
           "daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve"
           "&field_tdr_date_value=2026&page&_format=csv")
TSY_COL = {"UST2Y": "2 Yr", "UST10Y": "10 Yr"}


def _set(d: dict, path: str, value):
    keys = path.split(".")
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    if value is None:
        d.pop(keys[-1], None)
    else:
        d[keys[-1]] = value


def load_specs(adapter_name: str, symbols: list[str]) -> tuple[list[SeriesSpec], list[str]]:
    with open(os.path.join(ROOT, "api", "services", "econ", "registry", "series.json"), encoding="utf-8") as f:
        entries = {e["symbol"]: copy.deepcopy(e) for e in json.load(f)}
    applied = []
    cpath = os.path.join(ROOT, "docs", "economic-data", "registry-corrections", f"{adapter_name}.json")
    if os.path.exists(cpath):
        with open(cpath, encoding="utf-8") as f:
            for c in json.load(f):
                if c["symbol"] in symbols and not c["field_path"].endswith("verified_evidence"):
                    _set(entries[c["symbol"]], c["field_path"], c["new"])
                    applied.append(f"{c['symbol']}.{c['field_path']}")
    return [SeriesSpec(entries[s]) for s in symbols], applied


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-crosscheck", action="store_true")
    args = ap.parse_args(argv)
    http = HttpClient()
    specs, applied = load_specs("fed_ddp", COHORT)
    print(f"# Fed Board (fed_ddp) live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}")
    print(f"# registry overlay applied: {', '.join(applied) or 'none'}")
    ad = fed_ddp.FedDdpAdapter()
    newest: dict[str, tuple] = {}
    print("\n## 1. history via transport=release_xml (release-page SDMX zips)")
    print(f"{'symbol':9} {'provider id':34} {'count':>6} {'NA':>4} {'oldest':10} {'newest':10} "
          f"{'newest value':>14}  units(registry) | provider unit/mult/currency")
    for rel_specs in _by_release(specs):
        rel = fed_ddp.release_of(rel_specs[0])
        url = ad.url_for("release_xml", rel)
        try:
            resp = http.get(url)
            resp.raise_for_status()
            parsed = fed_ddp.parse_sdmx_zip(resp.content, {fed_ddp.mnemonic_of(s) for s in rel_specs})
        except EconError as e:
            print(f"{rel}: FAILED {e}")
            continue
        print(f"-- {rel}: {len(resp.content):,} B  ETag={resp.headers.get('etag')}  "
              f"Last-Modified={resp.headers.get('last-modified')}  (file posting time; NOT publication)")
        for s in rel_specs:
            try:
                ser = fed_ddp.select_series(parsed, s)
                obs = fed_ddp.to_obs(s, ser)
            except EconError as e:
                print(f"{s.symbol:9} FAILED {e}")
                continue
            vals = [o for o in obs if o.value is not None]
            last = vals[-1]
            newest[s.symbol] = (last.period_start, last.value, last.period_end)
            m = ser["meta"]
            pid = f"{m['dataset']}/{fed_ddp.mnemonic_of(s)}"
            print(f"{s.symbol:9} {pid:34} {len(obs):>6} {len(obs) - len(vals):>4} {obs[0].period_start:10} "
                  f"{last.period_start:10} {last.value:>14,.4f}  {s.units.get('raw')} | "
                  f"{m['unit']}/{m['multiplier']}/{m['currency']}  (period {last.period_start}..{last.period_end})")
    if args.no_crosscheck:
        return 0

    print("\n## 2. cross-check: transport=ddp_package (preformatted DDP CSV, lastobs)")
    for s in specs:
        pkg = s.params.get("package")
        if not pkg:
            print(f"{s.symbol:9} no package hash")
            continue
        e = copy.deepcopy(s.raw)
        e["source"]["params"]["transport"] = "ddp_package"
        e["source"]["params"]["fallback"] = []
        try:
            [r] = ad.fetch([SeriesSpec(e)], mode="latest", start=None, end=None, http=http)
        except EconError as ex:
            print(f"{s.symbol:9} ddp_package FAILED {ex}")
            continue
        vals = [o for o in r.observations if o.value is not None]
        last = vals[-1]
        ref = newest.get(s.symbol)
        verdict = "AGREE" if ref and (last.period_start, last.value) == ref[:2] else "DISAGREE"
        print(f"{s.symbol:9} pkg {pkg}  newest {last.period_start} {last.value:,.4f}  vs release_xml -> {verdict}"
              + (f"  [{'; '.join(r.warnings)}]" if r.warnings else ""))

    print("\n## 3. Phase 0 proofs.md comparison")
    for sym, (p, v) in PHASE0.items():
        got = newest.get(sym)
        ok = got is not None and got[0] == p and abs(got[1] - v) < 1e-9
        print(f"{sym:9} phase0 {p} {v:,.4f}  live {got[0] if got else '-'} {got[1] if got else '-'}  -> "
              f"{'MATCH' if ok else 'MISMATCH'}")

    print("\n## 4. secondary reference: Treasury daily par yield curve (home.treasury.gov CSV)")
    try:
        resp = http.get(TSY_URL)
        resp.raise_for_status()
        rows = list(csv.DictReader(io.StringIO(resp.text("utf-8-sig"))))
        for sym, col in TSY_COL.items():
            got = newest.get(sym)
            if not got:
                continue
            mdY = datetime.strptime(got[0], "%Y-%m-%d").strftime("%m/%d/%Y")
            row = next((r for r in rows if r.get("Date") == mdY), None)
            tv = float(row[col]) if row and row.get(col) else None
            print(f"{sym:9} H.15 {got[0]} {got[1]}  Treasury {col} {tv}  -> "
                  f"{'MATCH' if tv is not None and abs(tv - got[1]) < 1e-9 else 'MISMATCH'}"
                  f"   (Treasury newest row {rows[0].get('Date')}: {rows[0].get(col)} -- H.15 lags 1 business day)")
    except (EconError, KeyError, ValueError) as e:
        print(f"Treasury reference unavailable: {e}")

    print("\n## 5. RSS arrival feeds (arrivals())")
    for rel in (None, "G17", "H15", "H41"):
        try:
            items = ad.arrivals(http, release=rel)
        except EconError as e:
            print(f"{rel or 'datadownload'}: FAILED {e}")
            continue
        data = [i for i in items if i["kind"] == "data"]
        top = data[0] if data else None
        print(f"{(rel or 'datadownload.xml'):16} items={len(items):4} data-items={len(data):4}  newest data: "
              + (f"{datetime.fromtimestamp(top['published_at'], timezone.utc):%Y-%m-%dT%H:%MZ} "
                 f"[{top['release']}] {top['title']}" if top else "none (notices only)"))
    print(f"\n# http stats: {http.stats()}")
    return 0


def _by_release(specs):
    out: dict[str, list] = {}
    for s in specs:
        out.setdefault(fed_ddp.release_of(s), []).append(s)
    return list(out.values())


if __name__ == "__main__":
    sys.exit(main())
