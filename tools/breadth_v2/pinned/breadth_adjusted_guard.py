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
(p → D) with a factor step s = f_D / f_p (|log s| > log 1.02) whose implied adjusted move
exceeds one RAW price tick (|adj_D/f_p − raw_D| > $0.0101): the provider quantises in raw units
before scaling, so on a name with a large later reverse split one raw cent is dollars adjusted:

    REAL_ACTION          the adjusted series absorbed the step: |log adj_ratio| ≤ ½|log s|
                         (raw moved by ≈ 1/s — a real split, with or without a ledger row)
    PROVIDER_DEFECT      the adjusted series carries the step: |log raw_ratio| ≤ ½|log s|
    INCONSISTENT_VINTAGE a PROVIDER_DEFECT-shaped event where the ledger has a split for the
                         name executing between the two files' fetch times
    UNRESOLVED           anything else, and any step across a gap of > 5 sessions

The split ledger ANNOTATES (ledger_match), it never overrules the raw series: COHR's
2011-06-27 ledger "split" is not in its raw price, so the adjusted doubling is a defect.

⛔⛔ UNAPPLIED_SPLIT (v4) — the defect the step scan CANNOT see. The provider's split ledger
spells share classes CONCATENATED (`HEIA`, `BFA`/`BFB`, `LENB`, `GEFB`, `MOGA`, `STZB`, `CWENA`)
and its ADJUSTED series for the dotted price key (`HEI.A`) never applies them: on 2011-04-26
(5:4) HEI.A reads adjusted = raw = 43.55 → 35.05 while HEI (spelled right) is adjusted. With
adjusted and raw equally unadjusted, f = adj/raw does not step, so the name shows a fake −20 %
move inside every frame across it. For every ledger split (the ledger spelling AND its dotted
share-class reading X[:-1] + "." + X[-1]) with |ln k| > ln 1.02: if at the execution session the
name's RAW price moved by ≈ 1/k (|ln raw_ratio + ln k| ≤ ½|ln k|) while f stayed flat
(|ln f_step| ≤ ½|ln k|), the adjusted series did not absorb a real split → UNAPPLIED_SPLIT, a
withhold boundary like any other non-REAL event. Never repaired: the provider's figure is not
rescaled by us.

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

GUARD_VERSION = "adj-guard-v4"
#: An adjusted close is quoted to the cent: a factor step whose implied adjusted move is
#: within one tick is price QUANTISATION (penny names: 0.10 -> 0.11 reads as a 10% "step"),
#: not a basis break. Measured: the v1 guard classified ~1,200 such steps as events.
TICK = 0.0101
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
            if abs(a / pf - r) <= TICK:          # within one RAW price tick of the prior basis
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
    events += _unapplied_splits(grouped_dir, splits, calendar, canon)
    by_t = defaultdict(list)
    for e in events:
        if e["class"] != "REAL_ACTION":
            by_t[e["t"]].append(e["to"])
    for t in by_t:
        by_t[t] = sorted(set(by_t[t]))
    return {"version": GUARD_VERSION, "events": events, "withhold_boundaries": dict(by_t)}


def _unapplied_splits(grouped_dir: str, splits: list, calendar: list, canon) -> list:
    import bisect as _b
    cache = {}

    def day(iso):
        if iso not in cache:
            if len(cache) > 64:
                cache.pop(next(iter(cache)))
            adj = {canon(k): v for k, v in _read(os.path.join(grouped_dir, "%s_1.json" % iso)).items()}
            raw = {canon(k): v for k, v in _read(os.path.join(grouped_dir, "%s_0.json" % iso)).items()}
            cache[iso] = (adj, raw)
        return cache[iso]

    def ok(v):
        return isinstance(v, (int, float)) and v > 0

    out, seen = [], set()
    for s in sorted(splits, key=lambda x: x.get("execution_date") or ""):
        try:
            k = float(s["split_to"]) / float(s["split_from"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
        E = s.get("execution_date")
        if not E or k <= 0 or abs(math.log(k)) <= STEP_MIN:
            continue
        j = _b.bisect_left(calendar, E)
        if j == 0 or j >= len(calendar):
            continue
        t0 = canon(s["ticker"])
        names = {t0} | ({t0[:-1] + "." + t0[-1]} if "." not in t0 and len(t0) >= 2 else set())
        for t in sorted(names):
            if (t, calendar[j]) in seen:
                continue
            a1, r1 = day(calendar[j])[0].get(t), day(calendar[j])[1].get(t)
            if not (ok(a1) and ok(r1)):
                continue
            prev = None
            for i in range(j - 1, max(-1, j - 1 - MAX_GAP_SESSIONS), -1):
                a0, r0 = day(calendar[i])[0].get(t), day(calendar[i])[1].get(t)
                if ok(a0) and ok(r0):
                    prev = (i, a0, r0)
                    break
            if prev is None:
                continue
            pi, a0, r0 = prev
            lk, lf, lr = math.log(k), math.log((a1 / r1) / (a0 / r0)), math.log(r1 / r0)
            if abs(lf) <= 0.5 * abs(lk) and abs(lr + lk) <= 0.5 * abs(lk):
                seen.add((t, calendar[j]))
                out.append({"t": t, "from": calendar[pi], "to": calendar[j], "gap": j - pi,
                            "f_step": round(math.exp(lf), 6), "raw_ratio": round(math.exp(lr), 6),
                            "adj_ratio": round(a1 / a0, 6), "ledger_match": True,
                            "ledger_splits_in_pair": [k], "ledger_spelling": s["ticker"],
                            "class": "UNAPPLIED_SPLIT"})
    return out


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
    tmp = cache_path + ".partial.%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(t, f)
    os.replace(tmp, cache_path)
    return Guard(t), t
