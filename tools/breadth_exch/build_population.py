"""Exchange Breadth V1 — the ledger's POPULATION: every V2 `us` identity and its member sessions.

US V2 membership (breadth_corrected_pass.resolve_universes): a ticker TRADED on D whose reference
record resolved for D (`breadth_pit_frame.resolve`) is type CS/ADRC with a US venue. Same rule
here, over the grouped-daily frame's tickers (provider spelling). Output:

  <OUT>/population.json = {"sessions": [...], "ref_inputs": {...},
                           "identities": {identity: {"ticker": t, "runs": [[i0, i1], ...]}}}

`runs` are inclusive index ranges into `sessions`. Reads only; writes only <OUT>.
Usage: python build_population.py <OUT> <sessions.txt> <grouped_dir> <ref_frozen.json> <ref_live.json> <live_from>
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time

COMMON = {"CS", "ADRC"}
US_VENUES = {"XNAS", "XNGS", "XNMS", "XNCM", "XNYS", "XASE", "ARCX", "BATS", "IEXG"}


def _active_on(rec, d):
    ld = (rec.get("list_date") or "")[:10]
    if ld and d < ld:
        return False
    du = (rec.get("delisted_utc") or "")[:10]
    if du and d > du:
        return False
    return True


def resolve(recs, d):
    """Byte-for-byte the rule of breadth_pit_frame.resolve (latest listing among active records)."""
    if not recs:
        return None
    hits = [r for r in recs if _active_on(r, d)]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


def identity_of(t, rec):
    return f"{t}|{(rec or {}).get('delisted_utc') or 'active'}"


def canon(t):
    t = (t or "").strip()
    return t.replace("-", ".") if "-" in t else t


def _sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def main(out, sessions_path, grouped_dir, ref_frozen, ref_live, live_from):
    sessions = [s.strip() for s in open(sessions_path) if s.strip()]
    refs = {"frozen": json.load(open(ref_frozen)), "live": json.load(open(ref_live))}
    ids: dict = {}
    per_session = []
    t0 = time.time()
    for i, d in enumerate(sessions):
        ref = refs["live"] if d >= live_from else refs["frozen"]
        frame = json.load(open(os.path.join(grouped_dir, f"{d}_0.json")))
        n = 0
        for raw in frame:
            t = canon(raw)
            rec = resolve(ref.get(t), d)
            if rec is None or rec.get("type") not in COMMON:
                continue
            if (rec.get("primary_exchange") or "").upper() not in US_VENUES:
                continue
            ident = identity_of(t, rec)
            e = ids.setdefault(ident, {"ticker": t, "runs": []})
            if e["runs"] and e["runs"][-1][1] == i - 1:
                e["runs"][-1][1] = i
            else:
                e["runs"].append([i, i])
            n += 1
        per_session.append(n)
        if i % 500 == 0:
            print(time.strftime("%H:%M:%S"), d, n, len(ids), f"{time.time() - t0:.0f}s", flush=True)
    doc = {"sessions": sessions, "per_session_members": per_session,
           "ref_inputs": {"frozen": [ref_frozen, _sha(ref_frozen)], "live": [ref_live, _sha(ref_live)],
                          "live_from": live_from},
           "grouped_dir": grouped_dir, "identities": ids}
    tmp = os.path.join(out, "population.json.tmp")
    json.dump(doc, open(tmp, "w"), separators=(",", ":"), sort_keys=True)
    os.replace(tmp, os.path.join(out, "population.json"))
    print(time.strftime("%H:%M:%S"), "DONE identities", len(ids), flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:7])
