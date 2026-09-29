"""Prune the local raw-payload archive to EVIDENCE only (dry run by default).

    python tools/econ/prune_archive.py --db C:\\w\\econ1-data\\econ.db --archive C:\\w\\econ1-data\\archive
    python tools/econ/prune_archive.py ... --apply          # actually delete the candidates
    python tools/econ/prune_archive.py ... --verify         # also re-hash every kept file

LOCAL ONLY (ECON_ARCHIVE=local). A payload is KEPT when an acquisition that references
it (acquisition.archive_ref)
  * wrote observation rows (observation.acq_id), or is a sibling result of the same
    adapter call as one that did (rows written before 2026-09-29 cite the call's FIRST
    result, not the one that carried the series), or
  * failed validation (acquisition.outcome = 'rejected' or cited by validation_event).
Everything else -- identical live polls of a release burst, calls that wrote nothing,
files no acquisition references -- is a prune candidate. Files are content-addressed
(<adapter>/<sha256>.bin, written once), so a kept payload is never duplicated. The DB
is opened read-only; the tool never touches econ.db.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path


def keep_refs(db: str) -> tuple[set, dict]:
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        acq = {r[0]: r for r in c.execute(
            "SELECT acq_id, adapter, started_at, outcome, archive_ref FROM acquisition")}
        wrote = {r[0] for r in c.execute("SELECT DISTINCT acq_id FROM observation WHERE acq_id IS NOT NULL")}
        failed = {r[0] for r in c.execute("SELECT DISTINCT acq_id FROM validation_event WHERE acq_id IS NOT NULL")}
    finally:
        c.close()
    calls = {(acq[a][1], acq[a][2]) for a in wrote if a in acq}
    keep, why = set(), defaultdict(int)
    for a, (_, adapter, started, outcome, ref) in acq.items():
        if not ref:
            continue
        if a in wrote:
            reason = "wrote rows"
        elif (adapter, started) in calls and outcome == "ok":
            reason = "sibling of a call that wrote rows"
        elif outcome == "rejected" or a in failed:
            reason = "failed validation"
        else:
            continue
        keep.add(ref)
        why[reason] += 1
    return keep, dict(why)


def ref_path(archive: Path, ref: str) -> Path:
    return archive / ref.split(":", 1)[1]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="prune the econ raw archive to evidence only (dry run by default)")
    ap.add_argument("--db", required=True)
    ap.add_argument("--archive", required=True)
    ap.add_argument("--apply", action="store_true", help="delete the prune candidates")
    ap.add_argument("--verify", action="store_true", help="re-hash every kept file against its name")
    a = ap.parse_args(argv)
    archive = Path(a.archive)
    keep, why = keep_refs(a.db)
    keep_paths = {ref_path(archive, r).resolve() for r in keep}
    files = [p for p in archive.rglob("*.bin")]
    kept = [p for p in files if p.resolve() in keep_paths]
    cand = [p for p in files if p.resolve() not in keep_paths]
    by = defaultdict(lambda: [0, 0, 0, 0])
    for p in kept:
        by[p.parent.name][0] += 1
        by[p.parent.name][1] += p.stat().st_size
    for p in cand:
        by[p.parent.name][2] += 1
        by[p.parent.name][3] += p.stat().st_size
    print(f"archive {archive}: {len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB")
    print(f"keep reasons (acquisitions): {why}")
    print(f"{'adapter':12s} {'kept':>6s} {'kept MB':>9s} {'prune':>6s} {'prune MB':>9s}")
    for ad in sorted(by):
        k, kb, pn, pb = by[ad]
        print(f"{ad:12s} {k:6d} {kb / 1e6:9.1f} {pn:6d} {pb / 1e6:9.1f}")
    missing = [r for r in keep if not ref_path(archive, r).exists()]
    if missing:
        print(f"WARNING: {len(missing)} referenced payload(s) missing from the archive (not an error of this tool)")
    if a.verify:
        bad = [p for p in kept if hashlib.sha256(p.read_bytes()).hexdigest() != p.stem]
        print(f"verify: {len(kept) - len(bad)} ok, {len(bad)} mismatched")
    if a.apply:
        for p in cand:
            os.remove(p)
        print(f"deleted {len(cand)} file(s), {sum(by[d][3] for d in by) / 1e6:.1f} MB")
    else:
        print("dry run: nothing deleted (pass --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
