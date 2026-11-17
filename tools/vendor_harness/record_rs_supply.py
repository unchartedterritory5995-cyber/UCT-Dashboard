"""Record the RS Rating grade's supply rows: FMP ^GSPC (SPX) and the RSRATING seed replay.

The RS Rating's labels read SPX and the `seed_fred6725_rs_rating:RSRATING` seed, so a capture is
graded only beside a record of what OUR server serves for both on the capture's bars
(`tests/fixtures/vendor-supply/rs-rating-*.json`, read by `ourSide.js::recordedSupplyOf`).

  --spx   FMP ^GSPC through the server's own reader (`api/index_bars.py::_fetch_fmp_daily`), the
          PRIMARY for daily index bars. Needs the server's FMP key, so the OWNER runs it:
              railway run python tools/vendor_harness/record_rs_supply.py --spx
          (the same step as the 2026-11-15 record, "recorded by the owner under `railway run`").
  --seed  the seed store's replay of the public mirror (Fred6725/relative-strength), oldest upload
          first, into a THROWAWAY database (never /data, never C:\\data): no credentials needed.

Writes `%LOCALAPPDATA%/uct-vendor-batch/supply/rs-<what>-<UTC stamp>.json`:
``{"what", "recordedAtUTC", "servedBy", "bars": [...]}``. Nothing is committed by this script; the
owner ruling of 2026-11-15 (docs/pine/RS-RATING-TRANSFER.md) covers committing these rows in the RS
Rating supply records only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))


def _out_dir() -> pathlib.Path:
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = pathlib.Path(base) / "uct-vendor-batch" / "supply"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write(what: str, served_by: str, bars: list) -> pathlib.Path:
    now = dt.datetime.now(dt.timezone.utc)
    path = _out_dir() / f"rs-{what}-{now.strftime('%Y%m%dT%H%M%SZ')}.json"
    doc = {"what": what, "recordedAtUTC": now.isoformat(), "servedBy": served_by, "count": len(bars),
           "first": bars[0] if bars else None, "last": bars[-1] if bars else None, "bars": bars}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, path)
    return path


def record_spx() -> pathlib.Path:
    from api import index_bars
    bars = index_bars._fetch_fmp_daily("^GSPC", 1.0)
    if not bars:
        raise SystemExit("FMP ^GSPC returned no rows (is the FMP key in this environment? run under `railway run`)")
    return _write("spx", "api/index_bars.py::_fetch_fmp_daily('^GSPC', 1.0)", bars)


def record_seed() -> pathlib.Path:
    db = pathlib.Path(tempfile.mkdtemp(prefix="pine-seeds-")) / "pine_seeds.db"
    os.environ["PINE_SEEDS_DB"] = str(db)   # a throwaway store: never the server's or this box's /data
    from api.services import pine_seed_store as ps
    res = ps.refresh(["SEED_FRED6725_RS_RATING:RSRATING"])
    if not res.get("ok"):
        raise SystemExit(f"seed refresh failed: {res.get('errors')}")
    built = ps.build_bars("SEED_FRED6725_RS_RATING:RSRATING", "D", 5000)
    bars = built.get("bars") if isinstance(built, dict) else None
    if not bars:
        raise SystemExit(f"the seed replay built no bars: {str(built)[:300]}")
    return _write("seed", f"api/services/pine_seed_store.py::build_bars (replay into {db.name}, {res.get('ingested')})", bars)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--spx", action="store_true")
    ap.add_argument("--seed", action="store_true")
    a = ap.parse_args(argv)
    if not (a.spx or a.seed):
        ap.error("say --spx and/or --seed")
    if a.seed:
        print(f"seed: {record_seed()}")
    if a.spx:
        print(f"spx: {record_spx()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
