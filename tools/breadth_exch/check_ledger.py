"""Exchange Breadth V1 — Phase 1 acceptance report over the built venue ledger.

Usage: python check_ledger.py <OUT> <corpus.json>
Writes <OUT>/ledger_report.json and <OUT>/corpus_ledger_rows.json (the ledger rows of every corpus
identity, small enough to commit as a regression fixture).
"""
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import breadth_venue_ledger as vl  # noqa: E402


def main(out, corpus_path):
    pop = json.load(open(os.path.join(out, "population.json")))
    led = json.load(open(os.path.join(out, "venue_ledger.json")))
    assert vl.ledger_hash(led["rows"]) == led["sha256"], "ledger hash mismatch"
    L = vl.Ledger(led["rows"])
    sessions = pop["sessions"]
    pos = {d: i for i, d in enumerate(sessions)}

    # ── coverage by year: identity-sessions by status and by evidence source ───────────────
    by_year = defaultdict(Counter)
    src_year = defaultdict(Counter)
    ids_year = defaultdict(lambda: defaultdict(set))
    for r in led["rows"]:
        ident, f, t, st, src = r[0], r[2], r[3], r[4], r[6]
        for i in range(pos[f], pos[t] + 1):
            y = sessions[i][:4]
            by_year[y][st] += 1
            src_year[y][f"{st}:{src}"] += 1
            ids_year[y][st].add(ident)
    # member sessions with NO ledger row at all (must be zero: every member is evaluated)
    # every MEMBER session of every identity must fall inside exactly one ledger row
    spans = defaultdict(list)
    for r in led["rows"]:
        spans[r[0]].append((pos[r[2]], pos[r[3]]))
    missing = overlap = 0
    for ident, e in pop["identities"].items():
        sp = sorted(spans.get(ident, []))
        for (a1, b1), (a2, b2) in zip(sp, sp[1:]):
            overlap += a2 <= b1
        for a, b in e["runs"]:
            for i in range(a, b + 1):
                if not any(x <= i <= y for x, y in sp):
                    missing += 1

    # ── venue changes: consecutive ledger rows of one identity with a different status ────
    changes = Counter()
    by_id = defaultdict(list)
    for r in led["rows"]:
        by_id[r[0]].append(r)
    for rows in by_id.values():
        rows.sort(key=lambda r: r[2])
        for a, b in zip(rows, rows[1:]):
            if pos[b[2]] == pos[a[3]] + 1 and a[4] != b[4]:
                changes[(b[2][:4], f"{a[4]}->{b[4]}")] += 1

    # ── corpus ────────────────────────────────────────────────────────────────────────────
    corpus = json.load(open(corpus_path))
    results, corpus_rows = [], []
    for c in corpus:
        cands = [i for i in by_id if i.split("|")[0] == c["ticker"]]
        if c.get("identity"):
            cands = [c["identity"]] if c["identity"] in by_id else []
        eff = c["effective"]
        got = None
        for ident in cands:
            # the identity's previous MEMBER session (a halt is not a session it traded)
            mem = [i for a_, b_ in pop["identities"][ident]["runs"] for i in range(a_, b_ + 1)
                   if eff in pos and i < pos[eff]]
            prev = sessions[mem[-1]] if mem else None
            a = L.status_on(ident, prev)[0] if prev else None
            b = L.status_on(ident, eff)[0]
            if b != vl.UNRESOLVED or a not in (None, vl.UNRESOLVED):
                got = (ident, a, b)
                corpus_rows += [r for r in by_id[ident]]
                break
        ok = bool(got) and got[1] == c["before"] and got[2] == c["after"]
        results.append({**c, "identity_found": got[0] if got else None,
                        "ledger_before": got[1] if got else None,
                        "ledger_after": got[2] if got else None, "pass": ok})
    rep = {"ledger_sha256": led["sha256"], "ledger_rows": len(led["rows"]), "probes": led.get("probes"),
           "identities": len(pop["identities"]), "member_sessions_without_ledger_row": missing,
           "overlapping_rows": overlap,
           "by_year": {y: dict(c) for y, c in sorted(by_year.items())},
           "identities_by_year": {y: {k: len(v) for k, v in d.items()} for y, d in sorted(ids_year.items())},
           "source_by_year": {y: dict(c) for y, c in sorted(src_year.items())},
           "changes": {f"{y} {k}": n for (y, k), n in sorted(changes.items())},
           "corpus": results,
           "corpus_pass": sum(r["pass"] for r in results), "corpus_total": len(results)}
    json.dump(rep, open(os.path.join(out, "ledger_report.json"), "w"), indent=1)
    json.dump(sorted(corpus_rows), open(os.path.join(out, "corpus_ledger_rows.json"), "w"))
    print("corpus", rep["corpus_pass"], "/", rep["corpus_total"], "missing", missing, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
