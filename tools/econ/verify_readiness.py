"""Gate 3 (launch-catalog readiness): live identity + history verification of the
non-cohort launch candidates, through the SAME adapter code the service runs.

For every requested symbol (default: every non-BLS, non-derived launch candidate
from docs/economic-data/expansion_151.csv) this fetches the FULL history from the
authoritative agency endpoint in history mode (keyless, sequential), runs
``validate.validate_fetch`` against an EMPTY store (the exact gate a first backfill
passes), and prints per series:

    symbol  adapter  provider id  count  NA  oldest  newest  newest value(flag)
    registry units/scale/SA/history_start  |  provider identity metadata

Provider identity metadata printed (what the adapter's own identity check refused
or accepted is the gate; this is the evidence line):
  fed_ddp     SDMX series attributes UNIT / UNIT_MULT / CURRENCY / FREQ + the release
              zip's own Short Description annotation for the mnemonic
  bea         NIPA flat-file SeriesRegister line (series code, table/line, unit mult)
  census      the econ_export CSV header lines the adapter validated
  eia/fiscal  the adapter warnings + request key
Registry corrections (docs/economic-data/registry-corrections/*.json) are OVERLAID
in memory for the symbols verified, so a run verifies the corrected configuration.

Nothing is written anywhere except stdout. BLS is NOT handled here (keyless v1
quota): BLS identity comes from the BLS catalog pages, BLS data from the local
backfill (see docs/economic-data/readiness/CATALOG.md).

    python -m tools.econ.verify_readiness [--adapters fed_ddp,bea] [--symbols A,B]
"""
from __future__ import annotations

import argparse
import copy
import csv
import glob
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ import store as st, validate  # noqa: E402
from api.services.econ.adapters import get_adapter  # noqa: E402
from api.services.econ.adapters.base import SeriesSpec  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

CSV = os.path.join(ROOT, "docs", "economic-data", "expansion_151.csv")
REG = os.path.join(ROOT, "api", "services", "econ", "registry", "series.json")
CORR = os.path.join(ROOT, "docs", "economic-data", "registry-corrections")
SKIP_ADAPTERS = {"bls", "derived", "regional_fed_file", "treasury_tic", "fed_policy"}


def _set(d: dict, path: str, value):
    keys = path.split(".")
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value


def load_entries(symbols: set[str]) -> tuple[dict, list[str]]:
    with open(REG, encoding="utf-8") as f:
        entries = {e["symbol"]: copy.deepcopy(e) for e in json.load(f)}
    applied = []
    for path in sorted(glob.glob(os.path.join(CORR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            for c in json.load(f):
                if c["symbol"] in symbols and c["field_path"] not in ("status",) \
                        and not c["field_path"].startswith("source.verified"):
                    _set(entries[c["symbol"]], c["field_path"], c["new"])
                    applied.append(f"{c['symbol']}.{c['field_path']}")
    return entries, applied


def candidates() -> list[str]:
    with open(CSV, encoding="utf-8") as f:
        return [r["symbol"] for r in csv.DictReader(f)]


_ANN = re.compile(r"<(?:\w+:)?Annotation>.*?<(?:\w+:)?AnnotationType>([^<]*)</(?:\w+:)?AnnotationType>"
                  r".*?<(?:\w+:)?AnnotationText>([^<]*)</(?:\w+:)?AnnotationText>", re.S)


def fed_descriptions(body: bytes, mnemonics: set[str]) -> dict[str, str]:
    """{mnemonic: 'Short Description'} read straight from the release zip's data XML."""
    out: dict[str, str] = {}
    zf = zipfile.ZipFile(io.BytesIO(body))
    name = next(n for n in zf.namelist() if n.lower().endswith("_data.xml"))
    text = zf.read(name).decode("utf-8", "replace")
    for mn in mnemonics:
        i = text.find(f'SERIES_NAME="{mn}"')
        if i < 0:
            continue
        chunk = text[i:i + 6000]
        chunk = chunk[:chunk.find("<frb:Obs") if "<frb:Obs" in chunk else len(chunk)]
        for typ, txt in _ANN.findall(chunk):
            if typ.strip().lower() in ("short description", "long description"):
                out[mn] = txt.strip()
                if typ.strip().lower() == "short description":
                    break
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapters", default="")
    ap.add_argument("--symbols", default="")
    args = ap.parse_args(argv)
    syms = [s.strip() for s in args.symbols.split(",") if s.strip()] or candidates()
    entries, applied = load_entries(set(syms))
    want_ad = {a.strip() for a in args.adapters.split(",") if a.strip()}
    groups: dict[str, list[SeriesSpec]] = {}
    for s in syms:
        e = entries[s]
        ad = e["source"]["adapter"]
        if ad in SKIP_ADAPTERS or (want_ad and ad not in want_ad):
            continue
        groups.setdefault(ad, []).append(SeriesSpec(e))
    http = HttpClient()
    now = datetime.now(timezone.utc)
    print(f"# launch-catalog readiness verification  {now:%Y-%m-%dT%H:%MZ}  (keyless; history mode; "
          f"validate_fetch against an empty store)")
    print(f"# registry-corrections overlay: {', '.join(applied) or 'none'}")
    mem = st.connect(os.path.join(os.environ.get("TEMP", "/tmp"), f"econ_verify_{os.getpid()}.db"))
    rc = 0
    for ad, specs in sorted(groups.items()):
        print(f"\n## {ad}  ({len(specs)} series)")
        adapter = get_adapter(ad)
        results = []
        for s in specs:                                   # one series per call: failures stay isolated
            try:
                results.append((s, adapter.fetch([s], mode="history", start=None, end=None, http=http), None))
            except EconError as e:
                results.append((s, [], f"{type(e).__name__}: {e}"))
        extra = {}
        if ad == "fed_ddp":
            from api.services.econ.adapters import fed_ddp
            for rel in sorted({fed_ddp.release_of(s) for s in specs}):
                try:
                    resp = http.get(adapter.url_for("release_xml", rel))
                    extra.update(fed_descriptions(resp.content, {fed_ddp.mnemonic_of(s) for s in specs
                                                                 if fed_ddp.release_of(s) == rel}))
                except Exception as e:  # noqa: BLE001
                    print(f"   (description read for {rel} failed: {type(e).__name__})")
        for s, res, err in results:
            u = s.units
            reg = (f"units={u.get('raw')!r} scale={u.get('scale')} SA={s.seasonal_adjustment} "
                   f"freq={s.frequency}{('/' + s.week_anchor) if s.week_anchor else ''} "
                   f"history_start={s.history_start}")
            if err:
                rc = 1
                print(f"{s.symbol:13} FETCH FAILED {err}\n{'':13} registry {reg}")
                continue
            obs = [o for r in res for o in r.observations if o.series_id == s.symbol]
            fr = next((r for r in res if any(o.series_id == s.symbol for o in r.observations)), res[0] if res else None)
            acc, reasons = validate.validate_fetch(s, fr, mem, now=now.timestamp(), mode="history",
                                                   requested_ids=[s.symbol]) if fr else ([], ["empty"])
            vals = [o for o in obs if o.value is not None]
            if not vals:
                rc = 1
                print(f"{s.symbol:13} NO VALUES  reasons={reasons}")
                continue
            last = vals[-1]
            verdict = "VALID" if not reasons else "REJECTED " + "; ".join(reasons)
            if reasons:
                rc = 1
            ident = ""
            if ad == "fed_ddp":
                from api.services.econ.adapters import fed_ddp
                ident = f"desc={extra.get(fed_ddp.mnemonic_of(s), '?')!r}"
            warn = ("; ".join(fr.warnings)[:300]) if fr and fr.warnings else ""
            print(f"{s.symbol:13} {str(s.provider_series_id)[:44]:44} n={len(obs):6} NA={len(obs) - len(vals):4} "
                  f"{obs[0].period_start}..{obs[-1].period_start}  newest {last.period_start}..{last.period_end} "
                  f"= {last.value:,.4f}{('(' + last.flag + ')') if last.flag else ''}  -> {verdict}")
            print(f"{'':13} registry {reg}")
            if ident:
                print(f"{'':13} provider {ident}")
            print(f"{'':13} request {fr.request_key if fr else '-'}  pub_at={fr.source_published_at if fr else '-'}"
                  + (f"  warnings: {warn}" if warn else ""))
    print(f"\n# http stats: {json.dumps(http.stats().get('by_host', {}), sort_keys=True)}")
    mem.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
