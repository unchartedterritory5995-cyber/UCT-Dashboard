"""R67 — insert an aggregates-only gate manifest into a wisdom store's `wisdom_eval_runs`.

The counterpart to `export_eval_manifest`. Runs where the store is: in production, inside the
container, against `WISDOM_DB_PATH`.

⛔⛔ THIS IS THE ONLY THING STANDING BETWEEN A DARK EXTRACTOR AND A RUNNING ONE, so it refuses
more than it accepts:

  * the manifest is re-classified on the way IN — the export's guarantee is not inherited,
    because the file has been through git and a human since;
  * the `extractor_version` must equal the one THIS CODE derives, or the row would accept a
    gate that measured a different prompt. A gate result belongs to the extractor it graded;
  * `kind` must be `extractor_golden` and the gate decision must be `accepted` — importing a
    REJECTED run would be worse than importing nothing, because the chain would then run;
  * it is idempotent on `run_id` (the primary key), so a job that fires twice inserts once.

⭐ WHAT IT DELIBERATELY DOES NOT DO: it never invents a run, never edits an existing row, and
never touches any other table. If the row is already there it says so and exits 0.

Usage (inside the container)
  python -m tools.wisdom.import_eval_manifest docs/wisdom/eval-manifests/<file>.json
  python -m tools.wisdom.import_eval_manifest <file> --dry-run
  python -m tools.wisdom.import_eval_manifest --self-check
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from tools.wisdom.export_eval_manifest import EVAL_KIND, NotAggregatesOnly, assert_aggregates_only  # noqa: E402


class ManifestRefused(ValueError):
    """The manifest will not be imported, and the message says exactly why."""


def _current_extractor_version() -> str:
    from api.services.wisdom.extract import prompt

    return prompt.extractor_version()


def validate(manifest: dict, *, expected_version: str) -> None:
    for field in ("run_id", "kind", "extractor_version", "method_version", "n", "created_at", "metrics"):
        if field not in manifest:
            raise ManifestRefused(f"the manifest has no {field!r}")
    if manifest["kind"] != EVAL_KIND:
        raise ManifestRefused(f"kind is {manifest['kind']!r}, not {EVAL_KIND!r}")
    try:
        assert_aggregates_only(manifest["metrics"])
    except NotAggregatesOnly as exc:
        raise ManifestRefused(f"refusing a manifest that is not aggregates-only: {exc}") from exc
    decision = (manifest["metrics"].get("gate") or {}).get("decision")
    if decision != "accepted":
        raise ManifestRefused(
            f"the gate decision is {decision!r}, not 'accepted' — importing this would open the "
            "extractor on an evaluation that did not pass")
    if manifest["extractor_version"] != expected_version:
        raise ManifestRefused(
            f"the manifest graded extractor_version {manifest['extractor_version']!r} but this code "
            f"derives {expected_version!r}. A gate result belongs to the extractor it graded; "
            "re-run the gate for the current prompt rather than importing an older verdict.")


def insert(manifest: dict, *, dry_run: bool = False) -> dict:
    from api.services.wisdom.core import store

    with store.read() as conn:
        existing = conn.execute("SELECT run_id FROM wisdom_eval_runs WHERE run_id = ?",
                                (manifest["run_id"],)).fetchone()
    if existing:
        return {"status": "already_present", "run_id": manifest["run_id"], "inserted": 0}
    if dry_run:
        return {"status": "would_insert", "run_id": manifest["run_id"], "inserted": 0}
    with store.write() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO wisdom_eval_runs (run_id, kind, extractor_version, method_version, "
            "n, metrics_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (manifest["run_id"], manifest["kind"], manifest["extractor_version"],
             manifest["method_version"], int(manifest["n"]),
             json.dumps(manifest["metrics"], sort_keys=True), manifest["created_at"]))
    with store.read() as conn:
        n = conn.execute("SELECT COUNT(*) FROM wisdom_eval_runs WHERE run_id = ?",
                         (manifest["run_id"],)).fetchone()[0]
    return {"status": "inserted" if n else "insert_failed", "run_id": manifest["run_id"], "inserted": int(n)}


def self_check() -> int:
    ok = True
    base = {"run_id": "r1", "kind": EVAL_KIND, "extractor_version": "wx-v0-test",
            "method_version": "golden-match-v0", "n": 10, "created_at": "2026-09-15T08:00:00-04:00",
            "metrics": {"model": "m", "effort": "high", "split": "dev",
                        "gate": {"decision": "accepted"}}}
    try:
        validate(base, expected_version="wx-v0-test")
    except ManifestRefused as exc:
        print("FAIL: a clean manifest was refused:", exc); ok = False

    def refuses(name, m, version="wx-v0-test"):
        nonlocal ok
        try:
            validate(m, expected_version=version)
        except ManifestRefused:
            return
        print(f"FAIL: did not refuse {name}"); ok = False

    import copy
    rejected = copy.deepcopy(base); rejected["metrics"]["gate"]["decision"] = "rejected"
    refuses("a REJECTED gate", rejected)
    quoted = copy.deepcopy(base); quoted["metrics"]["example"] = "he said the base was tight"
    refuses("a quote-bearing field", quoted)
    refuses("a version mismatch", copy.deepcopy(base), version="wx-v0-SOMETHING-ELSE")
    missing = copy.deepcopy(base); missing.pop("created_at")
    refuses("a missing field", missing)
    wrongkind = copy.deepcopy(base); wrongkind["kind"] = "extractor_calibration"
    refuses("the wrong kind", wrongkind)
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest", nargs="?")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.manifest:
        ap.error("a manifest path is required unless --self-check")

    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    version = _current_extractor_version()
    try:
        validate(manifest, expected_version=version)
    except ManifestRefused as exc:
        print(f"REFUSED: {exc}")
        return 2
    out = insert(manifest, dry_run=args.dry_run)
    print(json.dumps(out))
    print(f"  extractor_version {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
