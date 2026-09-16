#!/usr/bin/env python
"""Step 1 — grade the identity merges against the GOLDEN LABELS, for $0.00 and no human time.

⭐ THE IDEA. Session 10 produced 73 merged MARKET_SIGNAL pairs and 60 merged PRINCIPLE pairs and
proposed a hand-check. But golden-v1.1 already labels 57 of the 83 segments, so for any merged
cluster whose members BOTH map to a golden record, the labels answer the question outright:

    same golden record  -> the merge was CORRECT
    different records   -> the merge was an OVER-MERGE

That is merge precision, measured, before anybody reads a pair.

⛔ HOW A KEY IS MAPPED TO A GOLDEN RECORD, and the honest caveat. `golden.match_segment` returns
`outcomes` carrying each expectation's `gid` and whether it matched — but NOT which prediction
matched it. So each key is asked SEPARATELY: run the SHIPPED matcher over the segment with ONLY
that key's records present, and take the gids that come back matched. One authority, no
reimplementation.

⚠️ **The caveat, stated because it bounds every number here:** the real matcher is greedy and
one-to-one over the WHOLE prediction set, so a key evaluated alone can win an expectation it lost
in the full run. This measures *"which golden record would this key represent if it stood alone"*,
which is the right question for identity, and is NOT identical to the full run's assignment.

⛔ UNGRADEABLE IS ITS OWN ANSWER. A cluster with fewer than two labelled members is reported as
ungradeable, never as correct — a precision computed over the clusters that happened to be
labelled, presented as precision over all of them, is the vacuity this programme keeps catching.
"""
from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

CORRECT, OVER_MERGED, UNGRADEABLE = "correct", "over_merged", "ungradeable"


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, REPO / relpath)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def gids_for_key(item: dict, checked: list) -> frozenset:
    """Which golden expectations does THIS key's records satisfy, asked of the shipped matcher."""
    from api.services.wisdom.extract import golden

    if not checked:
        return frozenset()
    result = golden.match_segment(item["expected"], list(checked), item["segment"]["text"],
                                  nulls=item.get("nulls") or ())
    return frozenset(o["gid"] for o in result.get("outcomes", []) if o.get("matched"))


def key_of(row, rtype: str):
    """The identity a row carried BEFORE any clustering — the same field the study clustered on."""
    if rtype == "PRINCIPLE":
        return row.get("principle_key")
    return tuple(row.get("market_signal_key") or row.get("record_key") or ())


def label_map(root: pathlib.Path, run_ids: list, rtype: str) -> dict:
    """(segment_id, key) -> frozenset(gid). Built from ONE run per key: the first that carries it."""
    gate_records = _load("_gr_for_grading", "tools/wisdom/gate_records.py")
    out: dict = {}
    for run_id in run_ids:
        items, results = gate_records.load_phase(root, run_id, "gate")
        for item, res in zip(items, results):
            seg = item["segment"]["segment_id"]
            by_key: dict = {}
            for ch in (res or {}).get("kept") or []:
                if ch.record_type != rtype and ch.pre_entity_type != rtype:
                    continue
                # ⛔ the key must be derived the same way the study derived it. For PRINCIPLE that
                # is principle_key_for(author, statement); for MARKET_SIGNAL it is ch.key().
                from api.services.wisdom.extract import writer

                if rtype == "PRINCIPLE":
                    statement = str(((ch.fields or {}).get("principle") or {}).get("statement") or "")
                    key = writer.principle_key_for(ch.author_id, statement)
                else:
                    key = tuple(ch.key())
                by_key.setdefault(key, []).append(ch)
            for key, checked in by_key.items():
                if (seg, key) in out:
                    continue                       # first run that carries it wins; deterministic
                out[(seg, key)] = gids_for_key(item, checked)
    return out


def grade(clusters_by_segment: dict, labels: dict) -> dict:
    """Score every cluster of two or more keys."""
    tally = collections.Counter()
    detail: list = []
    for seg, assign in clusters_by_segment.items():
        members: dict = {}
        for key, cid in assign.items():
            members.setdefault(cid, []).append(key)
        for cid, keys in members.items():
            if len(keys) < 2:
                continue                           # not a merge; nothing to grade
            gid_sets = {k: labels.get((seg, k), frozenset()) for k in keys}
            labelled = [k for k, g in gid_sets.items() if g]
            if len(labelled) < 2:
                tally[UNGRADEABLE] += 1
                detail.append({"segment_id": seg, "cluster": cid, "verdict": UNGRADEABLE,
                               "members": len(keys), "labelled": len(labelled)})
                continue
            common = frozenset.intersection(*[gid_sets[k] for k in labelled])
            verdict = CORRECT if common else OVER_MERGED
            tally[verdict] += 1
            detail.append({"segment_id": seg, "cluster": cid, "verdict": verdict,
                           "members": len(keys), "labelled": len(labelled)})
    graded = tally[CORRECT] + tally[OVER_MERGED]
    return {"clusters_graded": graded, "correct": tally[CORRECT], "over_merged": tally[OVER_MERGED],
            "ungradeable": tally[UNGRADEABLE],
            "precision": round(tally[CORRECT] / graded, 4) if graded else None,
            "detail": detail}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(REPO / "data" / "wisdom" / "gate-runs"))
    ap.add_argument("--jaccard", type=float, nargs="*", default=[0.4, 0.5, 0.6])
    ap.add_argument("--lens-sweep", type=float, nargs="*", default=[0.6, 0.7, 0.8, 0.9])
    args = ap.parse_args()

    from api.services.wisdom.extract import reconcile

    study = _load("_identity_study_for_grading", "tools/wisdom/identity_study.py")
    root = pathlib.Path(args.root)
    run_ids = reconcile.discover(root)
    runs = [reconcile.load_run(root, r) for r in run_ids]

    ms_labels = label_map(root, run_ids, "MARKET_SIGNAL")
    pr_labels = label_map(root, run_ids, "PRINCIPLE")
    print(f"labelled keys — MARKET_SIGNAL {sum(1 for v in ms_labels.values() if v)}/{len(ms_labels)}"
          f"   PRINCIPLE {sum(1 for v in pr_labels.values() if v)}/{len(pr_labels)}")

    print(f"\n{'identity':<24} {'graded':>7} {'correct':>8} {'over':>6} {'ungrade':>8} {'precision':>10}")
    out: dict = {}
    for j in args.jaccard:
        _, meta = study.identity_merged_ms(runs, threshold=j)
        g = grade(meta["clusters_by_segment"], ms_labels)
        out[f"merged-ms-j{int(j*100)}"] = g
        p = "-" if g["precision"] is None else f"{g['precision']:.3f}"
        print(f"{'MERGED-MS J=' + str(j):<24} {g['clusters_graded']:>7} {g['correct']:>8} "
              f"{g['over_merged']:>6} {g['ungradeable']:>8} {p:>10}")

    name, _ = study.paraphrase_lens()
    from api.services.wisdom.extract import golden

    for th in args.lens_sweep:
        def lens(a, b, _t=th):
            if golden._polarity_conflict(a, b):
                return False
            ta, tb = golden._key_tokens(a), golden._key_tokens(b)
            u = ta | tb
            return bool(u) and (len(ta & tb) / len(u)) >= _t

        _, meta = study.identity_lens_principle(runs, lens=lens)
        g = grade(meta["clusters_by_segment"], pr_labels)
        g["merges"] = meta["merges"]
        out[f"lens-principle-t{int(th*100)}"] = g
        p = "-" if g["precision"] is None else f"{g['precision']:.3f}"
        print(f"{'LENS-PRINCIPLE t=' + str(th):<24} {g['clusters_graded']:>7} {g['correct']:>8} "
              f"{g['over_merged']:>6} {g['ungradeable']:>8} {p:>10}   merges {meta['merges']}")
    print(f"\nlens parts: {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
