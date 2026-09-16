#!/usr/bin/env python
"""Re-score a finished gate phase OFFLINE, from the persisted records, and compare it to the
receipt that phase wrote.

⭐ WHY THIS EXISTS (session-9 step 4d). A pass costs real money and the next pass is only worth
buying if the first one's numbers are reproducible. R12 persists every validated record per run
precisely so the answer can be re-derived for $0.00 — this is the tool that does it, and the
brief's gate is exact: *re-score offline from the persisted records and match the pass's own gate
report `by_type` exactly; if it does not match, STOP before pass 2.*

⛔ ONE AUTHORITY, NEVER A SECOND IMPLEMENTATION. The scoring here is
`extract_golden_gate.segment_scores` → `golden.score` — the same two calls the live run made,
reached by import. A re-implementation would drift from the thing it audits and the drift would be
SILENT: the receipt says 47, the re-score says 45, and nothing tells you which one is the product.
What this proves is therefore precise and worth stating plainly: **the persisted records, run back
through the live scoring path, reproduce the reported numbers.** It is a persistence-and-
reproducibility check. It is NOT an independent re-derivation of whether the scorer is correct.

⛔ NO API CALL, NO GOLDEN FILE, NO KEY. The expectations and null spans travel inside
`segments.jsonl` (that is what `_expected_row` / `_null_row` are for), so this runs with the
network off and cannot re-buy anything.

Exit codes — three, because "they disagree" and "I could not look" are different facts and
collapsing them is the defect `CoverageLine` exists to avoid:

    0  MATCH         every compared field agreed, over a non-empty population
    1  MISMATCH      a field disagreed — STOP; do not buy the next pass
    2  INCONCLUSIVE  nothing to compare (no records, no receipt, empty phase)

Usage:
    python tools/wisdom/rescore_offline.py --receipt data/wisdom/extract/gate-run-3/receipts/<id>.json
    python tools/wisdom/rescore_offline.py --run-id <gate_run_id>
    python tools/wisdom/rescore_offline.py --receipt <path> --self-check
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

# ⚰️ This console is cp1252. The docstring's ⛔/⭐ killed `--help` with a UnicodeEncodeError before
# argparse had printed a word — the same crash `scripts/wisdom_dark_check.py` paid for once, where
# it exited 1 and read as a LIT gate rather than as a broken console. Same remedy.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# The five fields the receipt carries per type. Compared as a SET so a receipt that grew a field
# cannot quietly go unchecked — see `_compare`.
RECEIPT_FIELDS = ("tp", "fp", "fn", "fp_null", "null_segments")

MATCH, MISMATCH, INCONCLUSIVE = 0, 1, 2


def _load_gate_module():
    """Import the gate script for `segment_scores`. ⛔ Imported, never copied."""
    path = REPO / "tools" / "wisdom" / "extract_golden_gate.py"
    spec = importlib.util.spec_from_file_location("_gate_for_rescore", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_gate_records():
    path = REPO / "tools" / "wisdom" / "gate_records.py"
    spec = importlib.util.spec_from_file_location("_gate_records_for_rescore", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def find_run_dir(root: pathlib.Path, eval_run_id: str) -> pathlib.Path | None:
    """Map a receipt's EVAL run id to the gate-run directory that persisted its records.

    ⚠️ They are deliberately different ids: the eval run id only exists AFTER scoring, so the
    directory is named by the gate run id and the eval id is folded into the manifest afterwards.
    """
    if not root.is_dir():
        return None
    for d in sorted(root.iterdir()):
        manifest = d / "manifest.json"
        if not manifest.is_file():
            continue
        try:
            if json.loads(manifest.read_text(encoding="utf-8")).get("eval_run_id") == eval_run_id:
                return d
        except (ValueError, OSError):
            continue
    return None


def rescore(root: pathlib.Path, run_id: str, phase: str) -> dict:
    """Load the persisted phase and re-score it through the live path. Returns per_type + counts."""
    gate = _load_gate_module()
    gate_records = _load_gate_records()
    from api.services.wisdom.extract import golden

    items, results = gate_records.load_phase(root, run_id, phase)
    scores = gate.segment_scores(items, results)
    metrics = golden.score(list(scores.values()))
    return {"per_type": metrics["per_type"], "segments": len(items),
            "records": sum(len((r or {}).get("kept") or []) for r in results),
            "items": items, "results": results, "_gate": gate, "_golden": golden}


def _compare(receipt_per_type: dict, rescored_per_type: dict) -> tuple[list, int]:
    """Return (rows, compared) where a row is (type, field, receipt, rescored, ok)."""
    rows, compared = [], 0
    types = sorted(set(receipt_per_type) | set(rescored_per_type))
    for rtype in types:
        want = receipt_per_type.get(rtype)
        got = rescored_per_type.get(rtype)
        if want is None or got is None:
            rows.append((rtype, "<type present>", want is not None, got is not None, False))
            continue
        # ⛔ Unknown receipt fields are reported, never skipped — a field added to the receipt and
        # not to RECEIPT_FIELDS would otherwise pass unchecked forever.
        unknown = sorted(set(want) - set(RECEIPT_FIELDS))
        for field in unknown:
            rows.append((rtype, f"{field} (UNCHECKED FIELD)", want.get(field), "-", False))
        for field in RECEIPT_FIELDS:
            w, g = want.get(field, 0), got.get(field, 0)
            compared += 1
            rows.append((rtype, field, w, g, w == g))
    return rows, compared


def _print(rows, *, only_bad: bool) -> None:
    print(f"  {'type':<16} {'field':<26} {'receipt':>9} {'rescored':>9}  ok")
    for rtype, field, want, got, ok in rows:
        if only_bad and ok:
            continue
        print(f"  {rtype:<16} {field:<26} {str(want):>9} {str(got):>9}  {'ok' if ok else 'MISMATCH'}")


def _self_check(scored: dict, receipt_per_type: dict) -> int:
    """Prove the comparison CAN fail, on the real artifacts, in memory, touching no disk.

    ⭐ A gate nobody has seen fail is not a gate. This drops exactly one kept record from the first
    segment that has one and asserts the comparison then reports MISMATCH. If the perturbed
    re-score still matches, this tool cannot detect a persistence defect and says so.
    """
    gate, golden = scored["_gate"], scored["_golden"]
    items = scored["items"]
    results = copy.deepcopy([{k: v for k, v in (r or {}).items() if k != "kept"} | {"kept": list((r or {}).get("kept") or [])}
                             for r in scored["results"]])
    for res in results:
        if res.get("kept"):
            res["kept"].pop()
            break
    else:
        print("SELF-CHECK INCONCLUSIVE: no persisted record to remove, so nothing could be perturbed.")
        return INCONCLUSIVE
    perturbed = golden.score(list(gate.segment_scores(items, results).values()))
    rows, compared = _compare(receipt_per_type, perturbed["per_type"])
    bad = [r for r in rows if not r[4]]
    if compared == 0:
        print("SELF-CHECK INCONCLUSIVE: the perturbed comparison compared nothing.")
        return INCONCLUSIVE
    if not bad:
        print("SELF-CHECK FAILED: dropping a record changed no compared field — this tool cannot "
              "detect a persistence defect and its MATCH means nothing.")
        return MISMATCH
    print(f"SELF-CHECK PASSED: dropping one persisted record reds {len(bad)} field(s) of {compared}.")
    _print(bad, only_bad=True)
    return MATCH


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gate-runs-root", default=str(REPO / "data" / "wisdom" / "gate-runs"))
    ap.add_argument("--receipt", help="path to the receipt JSON the phase wrote")
    ap.add_argument("--run-id", help="gate run id (the persisted directory name)")
    ap.add_argument("--phase", default="gate")
    ap.add_argument("--self-check", action="store_true",
                    help="after comparing, prove the comparison can fail")
    args = ap.parse_args()

    root = pathlib.Path(args.gate_runs_root)
    receipt_per_type, receipt_run_id = None, None
    if args.receipt:
        rp = pathlib.Path(args.receipt)
        if not rp.is_file():
            print(f"INCONCLUSIVE: no receipt at {rp}")
            return INCONCLUSIVE
        receipt = json.loads(rp.read_text(encoding="utf-8"))
        receipt_per_type = receipt.get("per_type") or {}
        receipt_run_id = receipt.get("run_id")
        print(f"receipt {rp.name}: run_id={receipt_run_id} model={receipt.get('model')} "
              f"effort={receipt.get('effort')} version={receipt.get('extractor_version')} "
              f"golden={receipt.get('golden_version')} cost=${receipt.get('cost_usd', 0):.4f}")

    run_id = args.run_id
    if not run_id and receipt_run_id:
        d = find_run_dir(root, receipt_run_id)
        if d is None:
            print(f"INCONCLUSIVE: no persisted run under {root} carries eval_run_id={receipt_run_id}")
            return INCONCLUSIVE
        run_id = d.name
    if not run_id:
        print("INCONCLUSIVE: give --receipt or --run-id")
        return INCONCLUSIVE

    d = root / run_id
    if not (d / "records.jsonl").is_file():
        print(f"INCONCLUSIVE: no records.jsonl under {d}")
        return INCONCLUSIVE

    scored = rescore(root, run_id, args.phase)
    print(f"re-scored offline from {d}: {scored['segments']} segments, {scored['records']} records, "
          f"phase {args.phase!r}  (no API call, no golden file)")

    if scored["segments"] == 0 or scored["records"] == 0:
        print("INCONCLUSIVE: the persisted phase is empty — a comparison over nothing passes "
              "vacuously and would read as agreement.")
        return INCONCLUSIVE

    if receipt_per_type is None:
        print("no receipt given; re-scored per_type follows (nothing compared):")
        print(json.dumps({k: {f: v.get(f, 0) for f in RECEIPT_FIELDS}
                          for k, v in scored["per_type"].items()}, indent=2, sort_keys=True))
        return INCONCLUSIVE

    rows, compared = _compare(receipt_per_type, scored["per_type"])
    if compared == 0:
        print("INCONCLUSIVE: zero fields compared.")
        return INCONCLUSIVE
    bad = [r for r in rows if not r[4]]
    _print(rows, only_bad=False)
    print(f"\ncompared {compared} field(s) over {len(set(receipt_per_type) | set(scored['per_type']))} type(s): "
          f"{'MATCH' if not bad else f'{len(bad)} MISMATCH(ES)'}")

    rc = MATCH if not bad else MISMATCH
    if args.self_check:
        print()
        sc = _self_check(scored, receipt_per_type)
        if sc != MATCH:
            return sc if rc == MATCH else rc
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
