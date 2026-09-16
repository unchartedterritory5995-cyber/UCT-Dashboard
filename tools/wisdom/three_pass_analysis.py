#!/usr/bin/env python
"""The N-pass analysis: stability, the Q17 floor's verdict, and the R30 rename audit — offline.

⭐ WHY A SECOND KEYING EXISTS, and it is the whole reason this file is not a one-liner.
`reconcile.group_key` keys on `record_type` / `record_key` — the POST-entity identity, which is
what production would actually write. In the gate's isolated environment the entity master resolves
nothing, so every CALL is demoted to MENTION (`writer.py:504`) and that keying reports **CALL over
zero records** while MENTION's bucket carries the demoted CALLs and LEVELs under the same tickers.

Reading only that view would publish two wrong numbers with a straight face: "CALL stability could
not be measured" and "MENTION stability is X". So this reports BOTH:

    product view   record_type / record_key       — what would be written, here and now
    extractor view pre_entity_type / pre_entity_key — what the model actually produced

⛔ The second view is NOT a reimplementation. It rewrites two fields on each row and calls the SAME
`reconcile()` and `histogram()`; every persisted row carries `pre_entity_key` beside `record_key`
for exactly this. A separate scorer would drift from the one it audits and the drift would be
silent.

⛔ NO API CALL, NO KEY, NO SPEND. Everything here is re-derived from the persisted runs.

Usage:
    python tools/wisdom/three_pass_analysis.py
    python tools/wisdom/three_pass_analysis.py --root data/wisdom/gate-runs --json out.json
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

for _s in (sys.stdout, sys.stderr):          # cp1252 consoles: see rescore_offline.py
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PRODUCT_VIEW, EXTRACTOR_VIEW = "product (record_type)", "extractor (pre_entity_type)"


def as_extractor_view(run: dict) -> dict:
    """Rewrite each row's identity fields to the PRE-entity ones. Same rows, same reconciler.

    ⚠️ A row with no `pre_entity_key` is left exactly as it is rather than dropped — dropping it
    would quietly shrink the population and make the two views incomparable.
    """
    rows = []
    for row in run["rows"]:
        pre_type, pre_key = row.get("pre_entity_type"), row.get("pre_entity_key")
        if not pre_type or not pre_key:
            rows.append(row)
            continue
        rows.append(dict(row, record_type=pre_type, record_key=list(pre_key)))
    return dict(run, rows=rows)


def floor_verdict(result: dict) -> dict:
    """PUBLISH / BLOCK for the floored types, and what a BLOCK would enqueue.

    ⛔ `floor.passes` is the ONE authority (item 3, four sites). This counts its answers; it never
    re-states the threshold — a second copy of 0.8 here is how the floor stops being one rule.
    """
    from api.services.wisdom.publish import floor

    out = {"floored_types": list(floor.FLOORED_TYPES), "min_runs": floor.MIN_RUNS,
           "floor_value": floor.floor_value(), "review_tab": floor.REVIEW_TAB,
           "reason": floor.REASON, "by_type": {}}
    for s in result["scores"]:
        rtype = s["record_type"] or "UNKNOWN"
        slot = out["by_type"].setdefault(rtype, {"publish": 0, "block": 0, "floored": False})
        slot["floored"] = rtype in floor.FLOORED_TYPES
        if floor.passes(rtype, s["stability"], s["n"]):
            slot["publish"] += 1
        else:
            slot["block"] += 1
    out["enqueued"] = sum(v["block"] for k, v in out["by_type"].items() if v["floored"])
    return out


def per_run_counts(runs: list, *, field: str) -> dict:
    """Records per type per run — the variance picture the stability score compresses away."""
    out: dict = {}
    for r in runs:
        counts = collections.Counter(row.get(field) for row in r["rows"])
        for rtype, n in counts.items():
            out.setdefault(rtype or "UNKNOWN", {})[r["run_id"]] = n
    return out


def _print_hist(title: str, hist: dict, n: int) -> None:
    print(f"\n  {title}")
    buckets = [f"{i}/{n}" for i in range(n, 0, -1)]
    print(f"    {'type':<16} {'total':>6} " + " ".join(f"{b:>7}" for b in buckets) + "   clears floor")
    for rtype in sorted(hist):
        slot = hist[rtype]
        cells = " ".join(f"{slot['by_stability'].get(b, 0):>7}" for b in buckets)
        print(f"    {rtype:<16} {slot['total']:>6} {cells}   {slot['clears_floor']:>6}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(REPO / "data" / "wisdom" / "gate-runs"))
    ap.add_argument("--phase", default="gate")
    ap.add_argument("--json", help="also write the whole result as JSON")
    args = ap.parse_args()

    from api.services.wisdom.extract import reconcile

    root = pathlib.Path(args.root)
    run_ids = reconcile.discover(root)
    if len(run_ids) < 2:
        print(f"INCONCLUSIVE: {len(run_ids)} persisted run(s) under {root}; reconciliation needs at least 2.")
        return 2
    runs = [reconcile.load_run(root, rid, phase=args.phase) for rid in run_ids]
    print(f"runs ({len(runs)}): " + ", ".join(r["run_id"] for r in runs))
    print(f"extractor_version: {runs[0]['extractor_version']}   rows per run: "
          + ", ".join(str(len(r['rows'])) for r in runs))

    report: dict = {"run_ids": run_ids, "views": {}}
    for label, prepared in ((PRODUCT_VIEW, runs), (EXTRACTOR_VIEW, [as_extractor_view(r) for r in runs])):
        result = reconcile.reconcile(prepared)
        hist = reconcile.histogram(result)
        _print_hist(label, hist, result["n"])
        report["views"][label] = {"histogram": hist, "identities": len(result["scores"]),
                                 "n": result["n"]}
        if label == PRODUCT_VIEW:
            fv = floor_verdict(result)
            report["floor"] = fv
            print(f"\n  publication floor — floored types {fv['floored_types']}, "
                  f"MIN_RUNS {fv['min_runs']}, floor {fv['floor_value']}")
            for rtype in sorted(fv["by_type"]):
                s = fv["by_type"][rtype]
                mark = "  <- floored" if s["floored"] else ""
                print(f"    {rtype:<16} PUBLISH {s['publish']:>5}   BLOCK {s['block']:>5}{mark}")
            print(f"    ENQUEUE to review tab {fv['review_tab']!r} (reason {fv['reason']!r}): {fv['enqueued']}")

    print("\n  records per type per run (product view)")
    counts = per_run_counts(runs, field="record_type")
    for rtype in sorted(counts):
        cells = "  ".join(f"{counts[rtype].get(r['run_id'], 0):>4}" for r in runs)
        vals = [counts[rtype].get(r["run_id"], 0) for r in runs]
        print(f"    {rtype:<16} {cells}   spread {max(vals) - min(vals)}")
    report["per_run_counts"] = counts

    try:
        audit = reconcile.audit_market_signal_renames(runs)
        # ⛔⛔ COUNTS ONLY. A MARKET_SIGNAL key is `normalize_quote_key` of a name the model wrote
        # from the transcript, so the key text is QUOTE-DERIVED. This repo is PUBLIC and §0.4f keeps
        # quote-bearing text out of git — and anything printed here lands in a report. The audit's
        # `examples` are therefore dropped on the floor rather than truncated: a truncated quote is
        # still a quote.
        safe = {k: v for k, v in audit.items() if k != "examples"} if isinstance(audit, dict) else {}
        report["market_signal_rename_audit"] = safe
        print(f"\n  R30 MARKET_SIGNAL rename audit (counts only — keys are quote-derived): "
              + "  ".join(f"{k}={v}" for k, v in sorted(safe.items())))
    except Exception as exc:                      # the audit is advisory; it never blocks a report
        print(f"\n  R30 rename audit unavailable: {type(exc).__name__}: {exc}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(report, indent=1, sort_keys=True, default=str),
                                           encoding="utf-8", newline="\n")
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
