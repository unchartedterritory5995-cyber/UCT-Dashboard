"""ADJUSTED-SERIES GUARD — refuse levels built across a broken adjustment basis.

⛔⛔ WHAT IT CATCHES. The corrected pass builds 380-session LEVELS from the provider's
grouped ADJUSTED closes and lifts the as-traded minute path by f_D = adjusted_D / raw_D.
That is exact while f is a step function that changes ONLY at real corporate actions. The
final validation found 190 places (2008-2026) where it does not: the raw close is flat and
the adjusted close jumps ×2…×20 (BCPC ×6.98 on 2026-06-25, TPC repeatedly in 2026, COHR on
a ledger "split" its raw price never shows), plus three names whose files straddle a split
that executed while the cache was being fetched (WHLR 2026-09-22 1:9). A name whose frame
straddles such a boundary is compared against levels on a different scale: spurious new
highs/lows, spurious 4 % moves, and SMA/stage distortion for up to a frame.

⭐ THE RAW SERIES IS THE ARBITER. For each name and each consecutive pair of its sessions
(p → D) with a factor step s = f_D / f_p (|log s| > log 1.02):

    REAL_ACTION          the adjusted series absorbed the step: |log adj_ratio| ≤ ½|log s|
                         (raw moved by ≈ 1/s — a real split, with or without a ledger row)
    PROVIDER_DEFECT      the adjusted series carries the step: |log raw_ratio| ≤ ½|log s|
    INCONSISTENT_VINTAGE a PROVIDER_DEFECT-shaped event where the ledger has a split for the
                         name executing between the two files' fetch times
    UNRESOLVED           anything else, and any step across a gap of > 5 sessions

The split ledger ANNOTATES (ledger_match), it never overrules the raw series: COHR's
2011-06-27 ledger "split" is not in its raw price, so the adjusted doubling is a defect.

⛔ FAIL CLOSED, NEVER REPAIRED. A non-REAL boundary E withholds the name from every
level-dependent metric on every session D whose frame straddles it (frame_first < E ≤ D).
The name stays in `universe_count` at its traded price (a count does not read a level),
exactly like a name with no history. No adjusted price is invented or smoothed.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import math
import os
from collections import defaultdict

GUARD_VERSION = "adj-guard-v1"
STEP_MIN = math.log(1.02)
MAX_GAP_SESSIONS = 5


def _read(path):
    with open(path) as f:
        return json.load(f)


def build_events(grouped_dir: str, manifest: dict, splits: list, calendar: list,
                 canon=lambda t: t) -> dict:
    """Scan the whole cache once. Returns {"events": [...], "by_ticker": {t: [(E, cls)]}}."""
    ledger = defaultdict(list)
    for s in splits:
        try:
            k = float(s["split_to"]) / float(s["split_from"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
        ledger[canon(s["ticker"])].append((s["execution_date"], k))
    fetched = {k: v.get("fetched_start") for k, v in (manifest.get("manifest") or {}).items()}
    prev = {}          # t -> (idx, iso, f, raw, adj)
    events = []
    for i, iso in enumerate(calendar):
        adj = _read(os.path.join(grouped_dir, "%s_1.json" % iso))
        raw = _read(os.path.join(grouped_dir, "%s_0.json" % iso))
        for t0, a in adj.items():
            r = raw.get(t0)
            if not isinstance(a, (int, float)) or not isinstance(r, (int, float)) or a <= 0 or r <= 0:
                continue
            t = canon(t0)
            f = a / r
            p = prev.get(t)
            prev[t] = (i, iso, f, r, a)
            if p is None:
                continue
            pi, piso, pf, pr, pa = p
            ls = math.log(f / pf)
            if abs(ls) <= STEP_MIN:
                continue
            lraw, ladj = math.log(r / pr), math.log(a / pa)
            gap = i - pi
            lm = [k for (ex, k) in ledger.get(t, ()) if piso < ex <= iso]
            ledger_match = bool(lm) and abs(math.log(math.prod(lm)) - ls) < math.log(1.02)
            if gap > MAX_GAP_SESSIONS:
                cls = "UNRESOLVED"
            elif abs(ladj) <= 0.5 * abs(ls):
                cls = "REAL_ACTION"
            elif abs(lraw) <= 0.5 * abs(ls):
                cls = "PROVIDER_DEFECT"
                f0, f1 = fetched.get("%s_1" % piso), fetched.get("%s_1" % iso)
                if f0 and f1:
                    lo, hi = sorted((f0[:10], f1[:10]))
                    if any(lo <= ex <= hi for (ex, _k) in ledger.get(t, ())):
                        cls = "INCONSISTENT_VINTAGE"
            else:
                cls = "UNRESOLVED"
            events.append({"t": t, "from": piso, "to": iso, "gap": gap,
                           "f_step": round(math.exp(ls), 6), "raw_ratio": round(math.exp(lraw), 6),
                           "adj_ratio": round(math.exp(ladj), 6), "ledger_match": ledger_match,
                           "ledger_splits_in_pair": lm, "class": cls})
    by_t = defaultdict(list)
    for e in events:
        if e["class"] != "REAL_ACTION":
            by_t[e["t"]].append(e["to"])
    for t in by_t:
        by_t[t].sort()
    return {"version": GUARD_VERSION, "events": events, "withhold_boundaries": dict(by_t)}


class Guard:
    """Answers: may name t's levels be used for session D whose frame starts at F0?"""

    def __init__(self, table: dict):
        self.version = table["version"]
        self.b = table["withhold_boundaries"]

    def withheld(self, t: str, frame_first: str, day: str) -> bool:
        xs = self.b.get(t)
        if not xs:
            return False
        j = bisect.bisect_right(xs, frame_first)          # first boundary > frame_first
        return j < len(xs) and xs[j] <= day

    def withheld_set(self, names, frame_first: str, day: str) -> set:
        return {t for t in names if self.withheld(t, frame_first, day)}


def load_or_build(grouped_dir: str, manifest_path: str, splits_path: str, calendar: list,
                  canon, cache_path: str) -> tuple:
    """Deterministic: the table is keyed by the sha256 of its three inputs + the version."""
    h = hashlib.sha256()
    for p in (manifest_path, splits_path):
        with open(p, "rb") as f:
            h.update(hashlib.sha256(f.read()).digest())
    h.update(("\n".join(calendar) + GUARD_VERSION).encode())
    key = h.hexdigest()
    if os.path.exists(cache_path):
        t = _read(cache_path)
        if t.get("input_key") == key:
            return Guard(t), t
    t = build_events(grouped_dir, _read(manifest_path), _read(splits_path)["splits"], calendar, canon)
    t["input_key"] = key
    tmp = cache_path + ".partial"
    with open(tmp, "w") as f:
        json.dump(t, f)
    os.replace(tmp, cache_path)
    return Guard(t), t
