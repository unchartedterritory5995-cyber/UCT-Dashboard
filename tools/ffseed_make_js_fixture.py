"""Write edge/bars-edge-router/__fixtures__/ffseed.json: small SYNTHETIC first-frame seed packs built by
the Python encoder (api/services/ffseed_format.py), with the served bars each one must decode to.

seed.test.mjs serves these packs through the real Worker entry point and decodes them with the history
lake's JavaScript column decoder (app/src/data/historyLake/piece.js `decodeBody`), so the Python
encoder, the edge route and the browser-side decode are pinned to one another.

Synthetic prices only: this repository is public and never carries vendor data.

    python tools/ffseed_make_js_fixture.py
"""
from __future__ import annotations

import base64
import json
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from api.services import ffseed_format as fmt  # noqa: E402

ET = ZoneInfo("America/New_York")
OUT = REPO / "edge" / "bars-edge-router" / "__fixtures__" / "ffseed.json"
ASOF = date(2026, 11, 18)
BUILD = "20261119T0131Z"


def _days(n):
    out, d = [], ASOF
    while len(out) < n:
        if d.weekday() < 5 and d != date(2026, 11, 26):
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


def _intraday(step_min, n_days, seed, base):
    rng, px, out = random.Random(seed), base, []
    for d in _days(n_days):
        m = 9 * 60 + 30
        while m < 16 * 60:
            t = int(datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=ET).timestamp())
            o = round(px, 4)
            c = round(max(0.01, px * (1 + rng.uniform(-0.004, 0.004))), 4)
            out.append({"t": t, "o": o, "h": round(max(o, c) + rng.choice([0, 0.01, 0.0475]), 4),
                        "l": round(min(o, c) - rng.choice([0, 0.02]), 4), "c": c,
                        "v": rng.randint(0, 400_000) + (0.5 if rng.random() < 0.1 else 0)})
            px = c
            m += step_min
    return out


def _daily(n, seed, base):
    rng, px, out = random.Random(seed), base, []
    for d in _days(n):
        o = round(px, 4)
        c = round(px * (1 + rng.uniform(-0.03, 0.03)), 4)
        out.append({"t": d.isoformat(), "o": o, "h": round(max(o, c) * 1.012, 4),
                    "l": round(min(o, c) * 0.988, 4), "c": c, "v": rng.randint(10_000, 50_000_000)})
        px = c
    return out


def main() -> int:
    series = {
        "5": {"ZZA": _intraday(5, 4, 1, 101.25), "ZZ.B": _intraday(5, 1, 2, 0.0731)},
        "60": {"ZZA": _intraday(60, 30, 3, 101.25)},
        "D": {"ZZA": _daily(60, 4, 99.5), "ZZC": _daily(3, 5, 1820.0)},
    }
    out = {"asof": ASOF.isoformat(), "build": BUILD, "packs": {}, "expected": {}}
    for tf, syms in series.items():
        pb = fmt.PackBuilder(tf, asof=ASOF.isoformat(), build=BUILD, depth=300, comp="gzip")
        for sym, bars in syms.items():
            pb.add_served(sym, bars)
        data = pb.finish()
        for sym, bars in syms.items():                       # the fixture is only written if it reads back
            assert fmt.read_served(data, sym) == bars, (tf, sym)
        out["packs"][tf] = base64.b64encode(data).decode("ascii")
        out["expected"][tf] = syms
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, sort_keys=True, separators=(",", ":")) + "\n", encoding="ascii")
    print(f"wrote {OUT.relative_to(REPO)} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
