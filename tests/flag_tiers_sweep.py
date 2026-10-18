"""Seeded synthetic bars for the bull_flag "flagging" tier's byte-for-byte rail (no api import here).

`scans()` yields (key, bars) for SERIES random-walk series with momentum bursts, each cut at CUTS
as-of points, so the round-9 display rules see confirmed flags, flags each relaxed verdict stops,
and flags every other verdict stops. Synthetic only (public repo). The golden it is compared with
is written by tools/flag_tiers_golden.py from the code BEFORE the tier existed; regenerate it only
from that code, never from the code under test.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import random

SERIES = 80
CUTS = tuple(range(250, 321, 5))
BAR_COUNT = 320
#: Per-run fields (a fresh uuid, the wall clock): not part of what is drawn.
VOLATILE = ("id", "detected_at", "last_seen_at")


def series(seed: int) -> list:
    r = random.Random(seed)
    c = 20.0
    out = []
    d = datetime.date(2023, 1, 2)
    pulse = 0
    while len(out) < BAR_COUNT:
        if d.weekday() < 5:
            if pulse == 0 and r.random() < 0.03:
                pulse = r.randint(4, 9)
            if pulse > 0:
                drift = r.uniform(0.02, 0.07)
                pulse -= 1
            else:
                drift = r.gauss(-0.001, 0.012)
            o = c * (1 + r.gauss(0, 0.004))
            c = max(1.0, c * (1 + drift))
            h = max(o, c) * (1 + abs(r.gauss(0, 0.007)))
            lo = min(o, c) * (1 - abs(r.gauss(0, 0.007)))
            out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(h, 4),
                        "l": round(lo, 4), "c": round(c, 4), "v": float(r.randint(5, 20) * 100000)})
        d += datetime.timedelta(days=1)
    return out


def scans():
    for s in range(SERIES):
        bars = series(s)
        for k in CUTS:
            yield f"{s}:{k}", bars[:k]


def canonical(dets: list, drop_flagging: bool = True) -> str:
    """The detections as canonical JSON, with the tier's own stamp removed when asked."""
    rows = []
    for d in dets:
        d = json.loads(json.dumps(d, default=str))
        for k in VOLATILE:
            d.pop(k, None)
        ex = (d.get("geometry") or {}).get("extras")
        if drop_flagging and isinstance(ex, dict):
            ex.pop("flagging", None)
        rows.append(d)
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def run(detect_all, build_context, drop_flagging: bool = True):
    """{key: digest} plus counts, for one implementation of the pattern engine."""
    out, counts = {}, {"scans": 0, "detections": 0, "confirmed": 0, "stale": 0, "flagging": 0}
    for key, bars in scans():
        dets = detect_all(bars, build_context(bars[-200:], sym="SYN"), pattern_ids=["bull_flag"],
                          base_depth=200, sym="SYN")
        counts["scans"] += 1
        for d in dets:
            ex = (d.get("geometry") or {}).get("extras") or {}
            counts["detections"] += 1
            counts["confirmed"] += bool(ex.get("draw_round"))
            counts["stale"] += bool(ex.get("stale"))
            counts["flagging"] += isinstance(ex.get("flagging"), dict)
        out[key] = digest(canonical(dets, drop_flagging))
    return out, counts
