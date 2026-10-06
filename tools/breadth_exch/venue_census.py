"""Exchange Breadth V1 — dated-evidence census over the ledger population (Phase 1 gate input).

Per year: member-sessions by DATED class (NYSE / NASDAQ / OTHER:<mic> / NONE / CONFLICT), and every
dated venue TRANSITION of an identity that stays a US member across consecutive sessions
(i.e. a venue change while trading, not a listing or a delisting). Writes <OUT>/venue_census.json.
Usage: python venue_census.py <OUT>
"""
import gzip
import json
import os
import sys
import time
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import breadth_venue_ledger as vl  # noqa: E402


def main(out):
    pop = json.load(open(os.path.join(out, "population.json")))
    sessions = pop["sessions"]
    members_by_day = [[] for _ in sessions]
    for ident, e in pop["identities"].items():
        for a, b in e["runs"]:
            for i in range(a, b + 1):
                members_by_day[i].append(ident)
    by_year = defaultdict(Counter)
    last = {}                         # ident -> (session idx, label)
    transitions = []
    for i, d in enumerate(sessions):
        with gzip.open(os.path.join(out, "dated", f"{d}.json.gz"), "rt") as fh:
            dated = json.load(fh)
        venues = defaultdict(set)
        figi = {}
        for mic, rows in dated.items():
            for r in rows:
                venues[r[0]].add(mic)
                figi[r[0]] = (r[2], r[3])
        for ident in members_by_day[i]:
            t = pop["identities"][ident]["ticker"]
            cls, mic = vl.dated_class(venues.get(t, ()))
            label = "NONE" if cls is None else (f"OTHER:{mic}" if cls == vl.OTHER else cls)
            by_year[d[:4]][label] += 1
            p = last.get(ident)
            if p and p[0] == i - 1 and p[1] != label:
                transitions.append([ident, sessions[i - 1], d, p[1], label, figi.get(t)])
            last[ident] = (i, label)
        if i % 500 == 0:
            print(time.strftime("%H:%M:%S"), d, flush=True)
    kinds = defaultdict(Counter)
    for tr in transitions:
        kinds[tr[2][:4]][f"{tr[3]}->{tr[4]}"] += 1
    doc = {"by_year": {y: dict(c) for y, c in sorted(by_year.items())},
           "transition_kinds_by_year": {y: dict(c) for y, c in sorted(kinds.items())},
           "transitions": transitions}
    json.dump(doc, open(os.path.join(out, "venue_census.json"), "w"), separators=(",", ":"))
    print(time.strftime("%H:%M:%S"), "DONE transitions", len(transitions), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
