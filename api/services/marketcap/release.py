"""THE release-candidate pointer for Market Cap V1 -- the only way a build becomes a production candidate.

A build is a release candidate ONLY when C:/mcapdata/RELEASE_CANDIDATE.json names it AND the named DB's SHA256 matches the
pointer. Directory names ("FINAL", "FINAL_ADJUDICATED", ...) mean nothing. Every report set carries a RELEASE_STATUS.json
saying what it is; failed candidates are marked CUTOVER_REVIEW_FAILED and are never releasable again.

    python -m api.services.marketcap.release --data C:/mcapdata            # show / verify the pointer
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os

POINTER = "RELEASE_CANDIDATE.json"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def current(data: str) -> dict:
    p = os.path.join(data, POINTER)
    if not os.path.exists(p):
        return {"approved_release_candidate": None, "error": "no pointer"}
    return json.load(open(p))


def approved_build(data: str) -> str | None:
    """The approved build's DB path, or None. Refuses a pointer whose hash does not match or whose build failed review."""
    ptr = current(data)
    rc = ptr.get("approved_release_candidate")
    if not rc:
        return None
    if rc["build_id"] in {f["build_id"] for f in ptr.get("failed", [])}:
        raise RuntimeError(f"{rc['build_id']} failed cutover review and can never be released")
    if sha256(rc["db_path"]) != rc["db_sha256"]:
        raise RuntimeError(f"{rc['db_path']} does not match the pointer's SHA256")
    return rc["db_path"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    a = ap.parse_args(argv)
    print(json.dumps(current(a.data), indent=1))
    print("approved build:", approved_build(a.data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
