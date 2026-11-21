"""Write app/src/data/deviceStore/__fixtures__/ffseed_delta.json: SYNTHETIC base packs, new packs and the
daily DELTA between them, all built by the server's own code (api/services/ffseed_format.py `PackBuilder`,
api/services/ffseed_delta.py `build_delta`, which proves every delta it returns by applying it with the
reference applier). delta.test.js applies each delta on the device side and must read back exactly the
new pack's bars, so the device's applier is pinned to the bytes the server writes.

Every operation is covered (docs/charts/first-frame-seed-format.md section 10):
    APP     merge    the window slides by one session
    REV     merge    plus one bar the server revised inside the overlap
    SAME    keep     the window did not change (a halted name): the base blob is reused as is
    TRIM    keep     the new window is a strict subset of the base (re-encoded, a different first bar)
    SPLIT   replace  a REAL 2-for-1 split (every older bar halved), named in the base manifest's `splits`
    HOLE    replace  the server dropped a bar inside the overlap (no merge can reproduce it)
    UP      merge    the new window needs MORE decimals than the base: the kept rows are scaled up
    DOWN    merge    the new window needs FEWER decimals: the kept rows are scaled down
    GONE    remove   in the base only
    NEWSYM  replace  in the new build only
plus a D case (one new daily bar per symbol) in `raw` blobs, so both compressions are exercised.

Synthetic prices only: this repository is public and never carries vendor data.

    python tools/ffseed_make_delta_js_fixture.py
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH -> a sandbox)
from api.services import ffseed_delta as dl  # noqa: E402
from api.services import ffseed_format as fmt  # noqa: E402

ET = ZoneInfo("America/New_York")
OUT = REPO / "app" / "src" / "data" / "deviceStore" / "__fixtures__" / "ffseed_delta.json"
BASE_BUILD, NEW_BUILD = "20261120T0131Z", "20261121T0131Z"
BASE_ASOF, NEW_ASOF = "2026-11-19", "2026-11-20"


def _days(end: date, n: int):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5 and d != date(2026, 11, 26):
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


def _session(d: date, px: float, seed: int, dp: int = 4):
    out = []
    for i in range(78):
        m = 9 * 60 + 30 + 5 * i
        t = int(datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=ET).timestamp())
        o = round(px, dp)
        c = round(px * (1 + ((i * 7 + seed) % 11 - 5) / 2000), dp)
        out.append({"t": t, "o": o, "h": round(max(o, c) + 0.01, dp), "l": round(min(o, c) - 0.01, dp), "c": c,
                    "v": 1000 + i * 10 + seed})
        px = c
    return out


def _bars(days, px, seed):
    out = []
    for i, d in enumerate(days):
        out += _session(d, px + i, seed)
    return out


def _round2(b):
    return dict(b, o=round(b["o"], 2), h=round(b["h"], 2), l=round(b["l"], 2), c=round(b["c"], 2))


def _intraday_series():
    """{sym: (base bars or None, new bars or None)}; the base ends on BASE_ASOF, the new on NEW_ASOF."""
    six = _days(date(2026, 11, 20), 6)
    s = {}
    for k, sym in enumerate(["APP", "REV", "SAME", "TRIM", "SPLIT", "HOLE", "UP", "DOWN"]):
        full = _bars(six, 50.0 + 7 * k, seed=k)
        s[sym] = (full[:-78][-300:], full[-300:])            # the new window = the base shifted by a session
    s["SAME"] = (s["SAME"][0], list(s["SAME"][0]))
    s["TRIM"] = (s["TRIM"][0], list(s["TRIM"][0][78:]))      # the newest 222 bars of the base, nothing new
    rev = [dict(b) for b in s["REV"][1]]
    rev[10]["h"] = round(rev[10]["h"] + 0.5, 4)              # a bar the server revised since the base
    s["REV"] = (s["REV"][0], rev)
    s["HOLE"] = (s["HOLE"][0], [b for i, b in enumerate(s["HOLE"][1]) if i != 20])
    # SPLIT: 2-for-1 executing on NEW_ASOF. The new build's whole window is on the new basis.
    sb, sn = s["SPLIT"]
    s["SPLIT"] = (sb, [dict(b, o=round(b["o"] / 2, 4), h=round(b["h"] / 2, 4), l=round(b["l"] / 2, 4),
                            c=round(b["c"] / 2, 4), v=b["v"] * 2) for b in sn])
    up_base = [_round2(b) for b in s["UP"][0]]
    up_new = [b for b in up_base if b["t"] >= s["UP"][1][0]["t"]] + s["UP"][1][-78:]
    s["UP"] = (up_base, up_new[-300:])
    down_new = [_round2(b) for b in s["DOWN"][1]]
    down_base = list(s["DOWN"][0][:78]) + [b for b in down_new if b["t"] <= s["DOWN"][0][-1]["t"]][-222:]
    s["DOWN"] = (down_base, down_new)
    s["GONE"] = (_bars(_days(date(2026, 11, 19), 3), 20.0, seed=9), None)
    s["NEWSYM"] = (None, _bars(_days(date(2026, 11, 20), 2), 30.0, seed=11))
    return s


def _daily_series():
    def daily(days, px, step):
        return [{"t": d.isoformat(), "o": px + i * step, "h": px + i * step + 1, "l": px + i * step - 1,
                 "c": px + i * step + 0.5, "v": 100 + i} for i, d in enumerate(days)]
    new_days = _days(date(2026, 11, 20), 351)
    a, b = daily(new_days, 10.0, 0.25), daily(new_days, 400.0, 0.125)
    return {"AAA": (a[:-1][-350:], a[-350:]), "BRK-B": (b[:-1][-350:], b[-350:])}


def _case(tf, series, depth, comp, splits):
    pb = fmt.PackBuilder(tf, asof=BASE_ASOF, build=BASE_BUILD, depth=depth, comp=comp)
    pn = fmt.PackBuilder(tf, asof=NEW_ASOF, build=NEW_BUILD, depth=depth, comp=comp)
    for sym, (b, n) in sorted(series.items()):
        if b:
            pb.add_served(sym, b)
        if n:
            pn.add_served(sym, n)
    base, new = pb.finish(), pn.finish()
    delta, st = dl.build_delta(base, new, splits_symbols=list(splits))     # raises unless PROVEN
    tr = dl.read_delta_trailer(delta)
    ntr = fmt.read_trailer(new)
    return {
        "tf": tf, "comp": comp, "splits": {"session": NEW_ASOF, "symbols": {s: 2.0 for s in splits}},
        "ops": {s: dl.OP_NAMES[e[0]] for s, e in sorted(tr["symbols"].items())},
        "base": base64.b64encode(base).decode("ascii"),
        "new": base64.b64encode(new).decode("ascii"),
        "delta": base64.b64encode(delta).decode("ascii"),
        # the manifest entry the builder would publish (api/services/ffseed.py manifest_entry / attach_delta)
        "entry": {"bytes": len(new), "sha256": hashlib.sha256(new).hexdigest(), "symbols": len(ntr["symbols"]),
                  "bars": sum(e[2] for e in ntr["symbols"].values()), "depth": depth,
                  "url": f"/api/seed/v1/{NEW_BUILD}/{tf}.ffs",
                  "delta": {"base": BASE_BUILD, "base_asof": BASE_ASOF, "bytes": len(delta),
                            "sha256": hashlib.sha256(delta).hexdigest(), "symbols": st["symbols"],
                            "ops": {k: st[k] for k in dl.OPS}, "url": f"/api/seed/v1/{NEW_BUILD}/{tf}.delta.ffs"}},
        "base_entry": {"bytes": len(base), "sha256": hashlib.sha256(base).hexdigest(),
                       "url": f"/api/seed/v1/{BASE_BUILD}/{tf}.ffs"},
    }


WANT_OPS = {"APP": "merge", "REV": "merge", "SAME": "keep", "TRIM": "keep", "SPLIT": "replace", "HOLE": "replace",
            "UP": "merge", "DOWN": "merge", "GONE": "remove", "NEWSYM": "replace"}


def fixture() -> dict:
    """The fixture, as a dict (tests/test_ffseed_delta_js_fixture.py rebuilds it to pin the committed copy)."""
    five = _case("5", _intraday_series(), 300, "gzip", ["SPLIT"])
    assert five["ops"] == WANT_OPS, five["ops"]
    daily = _case("D", _daily_series(), 350, "raw", [])
    assert daily["ops"] == {"AAA": "merge", "BRK-B": "merge"}, daily["ops"]
    return {"base_build": BASE_BUILD, "build": NEW_BUILD, "base_asof": BASE_ASOF, "asof": NEW_ASOF,
            "cases": {"5": five, "D": daily}}


def main() -> int:
    out = fixture()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, sort_keys=True, separators=(",", ":")) + "\n", encoding="ascii")
    tmp.replace(OUT)
    print(f"wrote {OUT.relative_to(REPO)} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
