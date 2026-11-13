"""Near-duplicate questions ACROSS course units (the importer only compares within one skill).

  python -m scripts.study.course_dups [--threshold 0.8]

Compares every checker-passed question of every unit file with every other one, on the question text plus its story,
sentence and choices (the importer's own normalisation, study_import.normalise_question), and prints each pair whose
token overlap (Jaccard) reaches the threshold, most similar first. Two questions about different numbers or different
words are allowed to look alike; the report is for a person (or the track auditor) to judge, not an automatic cut.
Exit 0 always: it reports.
"""
from __future__ import annotations

import argparse
import itertools
import sys

from api.services import study_import
from scripts.study import courses_lib as cl


def _text(q: dict) -> str:
    parts = [q.get("q") or "", q.get("story") or "", q.get("sentence") or ""]
    parts += [str(c) for c in q.get("choices") or []]
    return " ".join(parts)


def pairs(threshold: float = 0.8) -> list[tuple[float, str, str, str, str]]:
    rows = []
    for p in cl.unit_files():
        doc = cl.load_unit(p)
        verify = doc.get("verify") or {}
        for q in doc.get("questions") or []:
            if (verify.get(q.get("key")) or {}).get("status") != "pass":
                continue
            rows.append((f"{doc['unit']}#{q['key']}", q.get("term") or "", study_import.normalise_question(_text(q)),
                         q.get("q") or ""))
    out = []
    for (a, ta, sa, qa), (b, tb, sb, qb) in itertools.combinations(rows, 2):
        if a.split("#")[0] == b.split("#")[0]:
            continue                      # inside one unit the checker and the importer already compare
        if ta and tb and ta.casefold() != tb.casefold():
            continue                      # two vocabulary items about different words are different questions
        j = study_import.jaccard(sa, sb)
        if j >= threshold:
            out.append((j, a, b, qa, qb))
    return sorted(out, reverse=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--threshold", type=float, default=0.8)
    a = ap.parse_args(argv)
    found = pairs(a.threshold)
    for j, x, y, qx, qy in found:
        print(f"{j:.2f}  {x}  ~  {y}\n      {qx}\n      {qy}")
    print(f"{len(found)} pair(s) at or above {a.threshold}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
