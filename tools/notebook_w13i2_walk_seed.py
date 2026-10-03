"""Wave 13 lane 13I-2 walk -- seed a SANDBOX data dir's market stores before it boots.

    python tools/notebook_w13i2_walk_seed.py --data-dir '<scratchpad>\\w13i2-data' --through 2026-10-02

A fresh sandbox holds no bars and no pattern verdicts, so a chart inserted during the walk would
freeze a fingerprint of nothing but "missing" labels and no suggestion could ever appear. This
writes, into the SANDBOX ONLY:

  * synthetic daily bars for NVDA and SPY (an advance, then a tightening flat base on drying
    volume) through `--through`, through the store's own writer (`bars_sqlite.put_bars`);
  * ONE confirmed pattern verdict (NVDA `vcp`, 82%) on the last bar, through the store's own
    writer (`pattern_vision.store.put_verdict`) -- the row the fingerprint's confirmed-only read
    serves, so the walk can see a SUGGESTED tag.

The values are synthetic and the evidence says so. ⛔ The sandbox env is applied FIRST through
`scripts/hub_sandbox_boot.apply_sandbox_env` (the census-derived pins + the shared-root tripwire),
before any `api.*` import: the stores' paths are captured at module import, so a pin set after
the import reaches nothing (CLAUDE.md, "C:\\data IS REAL ON THIS BOX"). It refuses a shared root.
No vendor and no model is reachable from here.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))


def weekdays_through(last: dt.date, n: int) -> list[dt.date]:
    out, d = [], last
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= dt.timedelta(days=1)
    return out[::-1]


def synthetic_bars(days: list[dt.date], *, start: float, peak: float, base_len: int, base_depth: float,
                   vol: float) -> list[dict]:
    """An advance to `peak`, then a flat base of `base_len` sessions whose range tightens and
    whose volume dries up. Every bar is a possible session (h >= max(o, c), l <= min(o, c))."""
    n = len(days)
    run = n - base_len
    bars = []
    for i, d in enumerate(days):
        if i < run:
            c = start + (peak - start) * (i / max(1, run - 1)) ** 1.15
            rng = c * 0.025
            v = vol * (1.2 if i % 7 == 0 else 1.0)
        else:
            k = i - run
            swing = base_depth * peak * (1 - k / base_len) * (0.5 if k % 2 else -0.5)
            c = peak * (1 - base_depth / 2) + swing
            rng = c * (0.03 * (1 - k / base_len) + 0.006)
            v = vol * (0.9 - 0.6 * k / base_len)
        o = c - rng * 0.2
        bars.append({"t": d.isoformat(), "o": round(o, 2), "h": round(max(o, c) + rng / 2, 2),
                     "l": round(min(o, c) - rng / 2, 2), "c": round(c, 2), "v": int(v)})
    return bars


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--through", required=True, help="the last session to seed, YYYY-MM-DD")
    args = ap.parse_args(argv)

    import hub_sandbox_boot                      # noqa: E402 -- the env BEFORE any api import
    hub_sandbox_boot.apply_sandbox_env(args.data_dir)

    from api.services import bars_sqlite         # noqa: E402
    from api.services.pattern_vision import store as pv  # noqa: E402

    last = dt.date.fromisoformat(args.through)
    days = weekdays_through(last, 320)
    seeded = {}
    bars_sqlite.init_db()                        # a fresh sandbox has no ohlcv table yet
    nvda = synthetic_bars(days, start=40.0, peak=120.0, base_len=30, base_depth=0.10, vol=4_000_000)
    spy = synthetic_bars(days, start=400.0, peak=560.0, base_len=30, base_depth=0.04, vol=60_000_000)
    seeded["NVDA"] = bars_sqlite.put_bars("NVDA", "D", nvda, date_tf=True)
    seeded["SPY"] = bars_sqlite.put_bars("SPY", "D", spy, date_tf=True)

    pv.init_db()
    asof = days[-1].isoformat()
    pv.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": asof, "confirmed": 1,
                    "vision_confidence": 82.0, "rationale": "synthetic walk seed", "key_level": 120.0,
                    "raw_confidence": 82.0, "model": "walk-seed", "signals_hash": "walk",
                    "judged_at": int(dt.datetime.now().timestamp()), "checks": "[]"})
    confirmed = pv.get_confirmed("NVDA", "D")
    out = {"bars_written": seeded, "first_day": days[0].isoformat(), "last_day": asof,
           "confirmed_verdicts": [{k: c.get(k) for k in ("setup", "asof_date", "vision_confidence")} for c in confirmed],
           "bars_db": bars_sqlite._DB_PATH, "pattern_db": pv.get_db_path()}
    print("SEED " + json.dumps(out))
    ok = seeded["NVDA"] > 0 and seeded["SPY"] > 0 and confirmed and str(Path(args.data_dir)) in str(Path(bars_sqlite._DB_PATH))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
