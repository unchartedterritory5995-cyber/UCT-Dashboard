"""R67 — export ONE golden-gate evaluation as an aggregates-only manifest.

Production's `wisdom_eval_runs` is EMPTY, so `golden.gate_status` returns
`accepted: False` and the chain's extract step answers `blocked_by_gate`. The gate runs
happened on this box; their receipts never crossed. This exports the aggregates a gate
decision is made of — and nothing else — so the row can be inserted in production.

⛔⛔ WHAT MUST NEVER CROSS. `data/wisdom/` is the programme's quote-bearing tree: paid
transcript text, golden labels, statement spans. A manifest is committed to git in a PUBLIC
repo, so the export REFUSES rather than trusting that the blob happened to be clean today.
The classifier below is the gate, and it runs on every field at every depth.

⭐ WHY A WHITELIST AND NOT A BLACKLIST. "Reject anything that looks like a quote" is a
judgement about text; "accept only these shapes" is a judgement about structure, and only the
second one fails safe when the source format changes. A key nobody has seen before is refused,
not sampled and waved through.

Usage
  python -m tools.wisdom.export_eval_manifest --db data/wisdom/extract/gate.db \
      --out docs/wisdom/eval-manifests/<run>.json          # newest accepted run
  python -m tools.wisdom.export_eval_manifest --db ... --run-id <id> --out ...
  python -m tools.wisdom.export_eval_manifest --self-check  # proves the classifier can refuse
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys

EVAL_KIND = "extractor_golden"

#: Scalar metric keys that may cross, with the type each must be.
#: ⛔ `str` is allowed ONLY for these five, and each is an identifier, a version or a hash —
#: never prose. Anything else string-valued is refused by name.
ALLOWED_STRINGS = {"model", "effort", "split", "golden_version", "golden_sha256",
                   "transport", "vocabulary_source", "decision", "compared_to"}

#: Numeric/boolean/empty-container keys are aggregates by construction and always allowed.
MAX_STRING_LEN = 72          # a sha256 is 64; nothing legitimate here is longer


class NotAggregatesOnly(ValueError):
    """A field that is not an aggregate tried to cross. The export refuses."""


def classify(value, path: str = "") -> list:
    """Every leaf, with the path that reaches it. Raises on anything not aggregate-shaped."""
    problems: list = []
    if isinstance(value, dict):
        for k, v in value.items():
            problems += classify(v, f"{path}.{k}" if path else str(k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            problems += classify(v, f"{path}[{i}]")
    elif isinstance(value, bool) or isinstance(value, (int, float)) or value is None:
        pass
    elif isinstance(value, str):
        leaf = path.rsplit(".", 1)[-1].split("[")[0]
        if leaf not in ALLOWED_STRINGS:
            problems.append(f"{path}: a string under a key that is not on the allow-list ({leaf!r})")
        elif len(value) > MAX_STRING_LEN:
            problems.append(f"{path}: string is {len(value)} chars, over the {MAX_STRING_LEN} limit")
    else:
        problems.append(f"{path}: {type(value).__name__} is not an aggregate")
    return problems


def assert_aggregates_only(metrics: dict) -> None:
    problems = classify(metrics)
    if problems:
        raise NotAggregatesOnly(
            "this evaluation carries fields that are not aggregates, so it will not be written to "
            "a file that goes into git:\n  " + "\n  ".join(problems))


def newest_accepted(conn, *, extractor_version: str | None = None) -> dict:
    rows = conn.execute(
        "SELECT run_id, kind, extractor_version, method_version, n, metrics_json, created_at "
        "FROM wisdom_eval_runs WHERE kind = ? ORDER BY created_at DESC, rowid DESC",
        (EVAL_KIND,)).fetchall()
    for r in rows:
        run_id, kind, version, method, n, metrics_json, created_at = r
        if extractor_version and version != extractor_version:
            continue
        try:
            metrics = json.loads(metrics_json)
        except ValueError:
            continue
        if (metrics.get("gate") or {}).get("decision") != "accepted":
            continue
        return {"run_id": run_id, "kind": kind, "extractor_version": version,
                "method_version": method, "n": n, "metrics": metrics, "created_at": created_at}
    raise SystemExit("no ACCEPTED golden-gate evaluation found in that database")


def by_run_id(conn, run_id: str) -> dict:
    r = conn.execute(
        "SELECT run_id, kind, extractor_version, method_version, n, metrics_json, created_at "
        "FROM wisdom_eval_runs WHERE run_id = ?", (run_id,)).fetchone()
    if r is None:
        raise SystemExit(f"no evaluation with run_id {run_id}")
    return {"run_id": r[0], "kind": r[1], "extractor_version": r[2], "method_version": r[3],
            "n": r[4], "metrics": json.loads(r[5]), "created_at": r[6]}


def build(row: dict) -> dict:
    assert_aggregates_only(row["metrics"])
    if row["kind"] != EVAL_KIND:
        raise SystemExit(f"kind is {row['kind']!r}, not {EVAL_KIND!r}")
    return {
        "manifest_version": 1,
        "run_id": row["run_id"],
        "kind": row["kind"],
        "extractor_version": row["extractor_version"],
        "method_version": row["method_version"],
        "n": row["n"],
        "created_at": row["created_at"],
        "metrics": row["metrics"],
    }


def self_check() -> int:
    """⭐ A classifier nobody has seen refuse is not a classifier."""
    ok = True
    clean = {"model": "claude-opus-5", "effort": "high", "split": "dev",
             "gate": {"decision": "accepted", "regressions": []},
             "per_type": {"CALL": {"tp": 17, "precision": 0.65}}, "segments": 83}
    if classify(clean):
        print("FAIL: a clean aggregates blob was refused:", classify(clean)); ok = False

    cases = {
        "a quote under an unknown key": {"example_text": "he said the base was tight"},
        "a quote nested deep": {"per_type": {"CALL": {"sample": "NVDA over 120"}}},
        "a quote in a list": {"regressions": [{"note": "recall fell on CALL"}]},
        "an over-long allowed string": {"golden_sha256": "x" * 200},
        "a segment id under an unknown key": {"segment_id": "seg_0001"},
    }
    for name, blob in cases.items():
        if not classify(blob):
            print(f"FAIL: the classifier did not refuse {name}: {blob}"); ok = False
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", help="the gate database to read")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--extractor-version", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.db or not args.out:
        ap.error("--db and --out are required unless --self-check")

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        row = by_run_id(conn, args.run_id) if args.run_id else newest_accepted(
            conn, extractor_version=args.extractor_version)
    finally:
        conn.close()

    manifest = build(row)
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # ⛔ LF, no trailing surprises: every blob in this repo is stored LF.
    text = json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    out.write_bytes(text.encode("utf-8"))
    print(f"wrote {out}")
    print(f"  run_id           {manifest['run_id']}")
    print(f"  extractor_version {manifest['extractor_version']}")
    print(f"  n                {manifest['n']}  created {manifest['created_at']}")
    print(f"  gate             {(manifest['metrics'].get('gate') or {}).get('decision')}")
    print(f"  aggregates-only  OK ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
