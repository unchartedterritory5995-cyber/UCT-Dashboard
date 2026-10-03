"""Exchange Breadth V1 — measure DATED-LIST FLICKER: an identity on venue X, absent from every dated
list for k sessions, then back on X. Usage: python flicker_census.py <OUT>"""
import gzip
import json
import os
import sys
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
    seq = defaultdict(list)
    absent_day = Counter()
    for i, d in enumerate(sessions):
        with gzip.open(os.path.join(out, "dated", f"{d}.json.gz"), "rt") as fh:
            dated = json.load(fh)
        v = defaultdict(set)
        for mic, rows in dated.items():
            for r in rows:
                v[r[0]].add(mic)
        for ident in members_by_day[i]:
            c, m = vl.dated_class(v.get(pop["identities"][ident]["ticker"], ()))
            lab = "NONE" if c is None else (m if c == vl.OTHER else c)
            seq[ident].append((i, lab))
            if lab == "NONE":
                absent_day[d] += 1
    gaps = Counter()
    gap_len = Counter()
    stretch_len = defaultdict(Counter)
    for ident, s in seq.items():
        runs = []
        for i, lab in s:
            if runs and runs[-1][2] == lab and runs[-1][1] == i - 1:
                runs[-1][1] = i
            else:
                runs.append([i, i, lab])
        for r in runs:
            n = r[1] - r[0] + 1
            stretch_len[r[2]]["1" if n == 1 else "2-5" if n <= 5 else "6-20" if n <= 20 else ">20"] += 1
        for a, g, b in zip(runs, runs[1:], runs[2:]):
            if g[2] == "NONE" and a[2] == b[2] != "NONE" and a[1] + 1 == g[0] and g[1] + 1 == b[0]:
                k = g[1] - g[0] + 1
                gaps[(sessions[g[0]][:4], a[2])] += 1
                gap_len["1" if k == 1 else "2-5" if k <= 5 else "6-20" if k <= 20 else ">20"] += 1
    # sessions where the dated lists themselves look incomplete (many members absent at once)
    worst = sorted(absent_day.items(), key=lambda x: -x[1])[:25]
    doc = {"stretch_len_by_state": {k: dict(v) for k, v in stretch_len.items()},
           "flicker_X_NONE_X_by_year_venue": {f"{y} {v}": n for (y, v), n in sorted(gaps.items())},
           "flicker_gap_len": dict(gap_len), "worst_absent_days": worst,
           "absent_per_day_by_year": {y: round(sum(n for d, n in absent_day.items() if d[:4] == y) /
                                              max(1, sum(1 for d in sessions if d[:4] == y)), 1)
                                      for y in sorted({d[:4] for d in sessions})}}
    json.dump(doc, open(os.path.join(out, "flicker_census.json"), "w"), indent=1)
    print(json.dumps(doc, indent=1)[:6000])


if __name__ == "__main__":
    main(sys.argv[1])
