"""Seeded synthetic bars for the "flat top" drawing's byte-for-byte rail (no api import here).

`scans()` yields (key, bars) over SERIES seeded series, each cut at CUTS as-of points: random walks
with momentum bursts (the bull_flag sweep's generator) and up-trends that end in a base under a flat
ceiling with three or four touches (so uct_flat_top_breakout fires, and some of those fires meet the
v2 draw conditions). Every registered detector runs on every scan. Synthetic only (public repo).

The golden it is compared with is written by tools/flat_top_golden.py from the code BEFORE the
drawing existed; regenerate it only from that code, never from the code under test.
"""
from __future__ import annotations

import datetime
import hashlib
import importlib
import json
import pkgutil
import random

SERIES = 24
CUTS = tuple(range(262, 301, 6))
BAR_COUNT = 300
BASE_DEPTH = 260
#: Per-run fields (a fresh uuid, the wall clock): not part of what is drawn.
VOLATILE = ("id", "detected_at", "last_seen_at")
#: The only keys the flat-top drawing adds, and only to a uct_flat_top_breakout row.
FLAT_TOP_STAMP = ("draw_flat_top", "draw_round")
FLAT_TOP_ID = "uct_flat_top_breakout"
DETECTOR_PACKAGES = ("classical", "candlestick", "structure", "uct")


def _bar(d, o, h, lo, c, v):
    return {"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(h, 4), "l": round(lo, 4),
            "c": round(c, 4), "v": float(v)}


def _walk(r):
    c, out, d, pulse = 20.0, [], datetime.date(2023, 1, 2), 0
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
            out.append(_bar(d, o, h, lo, c, r.randint(5, 20) * 100000))
        d += datetime.timedelta(days=1)
    return out


def _flat_top(r):
    """An up-trend, then a base under a flat ceiling touched 3-4 times, then a test of the line."""
    out, d, c = [], datetime.date(2023, 1, 2), 20.0
    trend = BAR_COUNT - 60
    while len(out) < BAR_COUNT:
        if d.weekday() >= 5:
            d += datetime.timedelta(days=1)
            continue
        k = len(out)
        if k < trend:
            o = c * (1 + r.gauss(0, 0.004))
            c = c * (1 + r.gauss(0.004, 0.01))
            h = max(o, c) * (1 + abs(r.gauss(0, 0.006)))
            lo = min(o, c) * (1 - abs(r.gauss(0, 0.006)))
            if k == trend - 1:
                ceiling = h
                touches = sorted(r.sample(range(4, 50, 3), r.choice((3, 4))))
                low_band = ceiling * (1 - r.uniform(0.05, 0.12))
        else:
            j = k - trend
            mid = (ceiling + low_band) / 2
            o = mid * (1 + r.gauss(0, 0.012))
            c = mid * (1 + r.gauss(0, 0.012))
            h = min(max(o, c) * (1 + abs(r.gauss(0, 0.004))), ceiling * 0.985)
            lo = max(min(o, c) * (1 - abs(r.gauss(0, 0.006))), low_band)
            if j in touches:
                h = ceiling * (1 - abs(r.gauss(0, 0.002)))
            if j >= 54:                       # the last sessions climb into / through the line
                c = ceiling * (1 + r.uniform(-0.01, 0.02))
                o = ceiling * (1 - r.uniform(0.0, 0.02))
                h = max(o, c) * 1.003
                lo = min(o, c) * 0.99
        out.append(_bar(d, o, h, lo, c, r.randint(8, 30) * 100000))
        d += datetime.timedelta(days=1)
    return out


def series(seed: int) -> list:
    r = random.Random(seed)
    return _flat_top(r) if seed % 2 == 0 else _walk(r)


def scans():
    for s in range(SERIES):
        bars = series(s)
        for k in CUTS:
            yield f"{s}:{k}", bars[:k]


def load_detectors(root_pkg: str = "api.services.pattern_engine.detectors") -> int:
    """Import every detector module (each registers itself); returns how many were imported."""
    n = 0
    for sub in DETECTOR_PACKAGES:
        pkg = importlib.import_module(f"{root_pkg}.{sub}")
        for m in pkgutil.iter_modules(pkg.__path__):
            importlib.import_module(f"{root_pkg}.{sub}.{m.name}")
            n += 1
    return n


def canonical(dets: list, drop_flat_top: bool = True) -> str:
    """The detections as canonical JSON, with the flat-top drawing's own stamp removed when asked
    (and only from a uct_flat_top_breakout row: the same keys on another row are not removed)."""
    rows = []
    for d in dets:
        d = json.loads(json.dumps(d, default=str))
        for k in VOLATILE:
            d.pop(k, None)
        ex = (d.get("geometry") or {}).get("extras")
        if drop_flat_top and d.get("pattern_id") == FLAT_TOP_ID and isinstance(ex, dict):
            for k in FLAT_TOP_STAMP:
                ex.pop(k, None)
        rows.append(json.dumps(d, sort_keys=True, separators=(",", ":")))
    # detect_all orders by (detected_at, confidence), and detected_at is the wall clock, so two
    # detections with one confidence come back in either order: order is not part of what is drawn.
    return "[" + ",".join(sorted(rows)) + "]"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def run(detect_all, build_context, drop_flat_top: bool = True, drop_ids=()):
    """({key: digest}, counts) for one implementation of the pattern engine.

    `drop_ids`: pattern ids registered AFTER the golden was written. Their rows are
    removed before counting and digesting (and counted in `dropped_new_ids`), so the
    golden still proves no EXISTING detector moved. The generator never passes it."""
    out = {}
    counts = {"scans": 0, "detections": 0, "flat_top": 0, "flat_top_stamped": 0, "pattern_ids": 0}
    seen_ids = set()
    for key, bars in scans():
        dets = detect_all(bars, build_context(bars[-200:], sym="SYN"), base_depth=BASE_DEPTH, sym="SYN")
        kept = [d for d in dets if d.get("pattern_id") not in drop_ids]
        counts["dropped_new_ids"] = counts.get("dropped_new_ids", 0) + len(dets) - len(kept)
        dets = kept
        counts["scans"] += 1
        for d in dets:
            counts["detections"] += 1
            seen_ids.add(d.get("pattern_id"))
            if d.get("pattern_id") == FLAT_TOP_ID:
                counts["flat_top"] += 1
                ex = (d.get("geometry") or {}).get("extras") or {}
                counts["flat_top_stamped"] += isinstance(ex.get("draw_flat_top"), dict)
        out[key] = digest(canonical(dets, drop_flat_top))
    counts["pattern_ids"] = len(seen_ids)
    return out, counts
