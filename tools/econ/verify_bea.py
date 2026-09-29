"""LIVE verification of the BEA adapter (keyless NIPA flat files unless BEA_API_KEY is set).

    python tools/econ/verify_bea.py [--save-dir DIR] [--symbols USRGDP,...]

For every BEA cohort series: fetch the FULL history through the adapter, print
symbol, count, oldest/newest period, newest value, registry units and the
source publication time (flat-file Last-Modified). Then cross-check each
series code against BEA's SeriesRegister.txt (table:line membership and
DefaultScale -> unit multiplier), and compare the newest values to the Phase 0
proofs. Read-only, sequential: 2 NIPA files (~35 MB each) + the register.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from api.services.econ import registry  # noqa: E402
from api.services.econ.adapters.base import SeriesSpec  # noqa: E402
from api.services.econ.adapters.bea import REGISTER_URL, BeaAdapter  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402

COHORT = ["USGDP", "USRGDP", "USRGDPQA", "USPCEPI", "USCOREPCE"]
# Phase 0 proofs.md (2026-09-28): newest values seen on the flat files / cross-checked vs FRED.
PHASE0 = {
    "USRGDP": ("2026-04-01", 24269613.0, "proofs.md: A191RX 2026Q2 24,269,613 ($M ch.2017) = GDPC1 24,269.613 ($bn)"),
    "USRGDPQA": ("2026-04-01", 1.5, "proofs.md: A191RL 2026Q2 1.5 = A191RL1Q225SBEA 1.5"),
    "USPCEPI": ("2026-07-01", 131.659, "proofs/bea_nipam_sample.txt: DPCERG 2026M07 131.659"),
    "USCOREPCE": ("2026-07-01", 130.658, "proofs/bea_nipam_sample.txt: DPCCRG 2026M07 130.658"),
}


def iso_ts(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else "-"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-dir")
    ap.add_argument("--symbols", default=",".join(COHORT))
    a = ap.parse_args(argv)
    syms = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]
    specs = [SeriesSpec(registry.get(s)) for s in syms]
    http = HttpClient()
    ad = BeaAdapter()
    mode = "keyed (BEA API)" if ad.key() else "keyless (NIPA flat files)"
    print(f"# verify_bea  run {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ}  mode={mode}")
    t0 = time.time()
    results = ad.fetch(specs, mode="history", start=None, end=None, http=http)
    print(f"# fetched {len(results)} payload(s) in {time.time() - t0:.1f}s")
    for r in results:
        print(f"# payload {r.request_key}  status={r.http_status}  bytes={r.payload_bytes:,}  "
              f"sha256={(r.payload_sha256 or '')[:16]}  source_published_at={iso_ts(r.source_published_at)}"
              f"  warnings={r.warnings}")
        if a.save_dir and r.raw_payload:
            p = Path(a.save_dir) / (r.request_key.split(":")[2])
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(r.raw_payload)
    by_sym = {}
    pub = {}
    for r in results:
        for o in r.observations:
            by_sym.setdefault(o.series_id, []).append(o)
            pub[o.series_id] = r.source_published_at
    print()
    print(f"{'symbol':<10} {'provider id':<26} {'count':>6} {'oldest':<11} {'newest':<11} "
          f"{'newest value':>15}  units(raw) | published")
    for s in specs:
        rows = sorted(by_sym.get(s.symbol, []), key=lambda o: o.period_start)
        if not rows:
            print(f"{s.symbol:<10} NO DATA")
            continue
        nn = [o for o in rows if o.value is not None]
        last = nn[-1]
        print(f"{s.symbol:<10} {s.provider_series_id:<26} {len(rows):>6} {rows[0].period_start:<11} "
              f"{last.period_start:<11} {last.value:>15,.3f}  {s.units.get('raw')} | {iso_ts(pub.get(s.symbol))}"
              f"  (NA rows: {len(rows) - len(nn)})")

    # --- SeriesRegister identity + scale check
    print("\n# SeriesRegister.txt identity/scale check")
    resp = http.get(REGISTER_URL)
    resp.raise_for_status()
    reg = BeaAdapter.parse_register(resp.content)
    if a.save_dir:
        (Path(a.save_dir) / "SeriesRegister.txt").write_bytes(resp.content)
    for s in specs:
        p = s.params
        code, table, line = p.get("series_code"), p.get("table"), str(p.get("line"))
        e = reg.get(code)
        if not e:
            print(f"{s.symbol:<10} {code}: NOT IN REGISTER")
            continue
        on = (table, line) in e["tables"]
        mult = {-6: "millions", -3: "thousands", -9: "billions", 0: "as-is"}.get(e["scale"], e["scale"])
        print(f"{s.symbol:<10} {code} '{e['label']}' / {e['metric']} / {e['calc']}  "
              f"{table}:{line} {'CONFIRMED' if on else 'NOT LISTED'}  DefaultScale={e['scale']} ({mult})  "
              f"registry units.raw='{s.units.get('raw')}'")

    # --- Phase 0 comparison
    print("\n# Phase 0 comparison")
    for sym, (period, val, src) in PHASE0.items():
        rows = {o.period_start: o.value for o in by_sym.get(sym, [])}
        got = rows.get(period)
        verdict = "MATCH" if got is not None and abs(got - val) < 1e-9 else "MISMATCH"
        print(f"{sym:<10} {period} phase0={val:,} now={got!r}  {verdict}   [{src}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
