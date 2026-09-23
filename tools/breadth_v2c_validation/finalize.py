"""PHASE 18 — the durable, reproducible record of this validation.

Writes (never overwriting) beside the existing evidence:
  /data/_audit/validation/v2c_final/V2C_FINAL_VALIDATION_REPORT_2026-09-23.md
  /data/_audit/validation/v2c_final/V2C_FINAL_VALIDATION_INDEX_2026-09-23.json
The index fingerprints the frozen artifact (re-hashed now), every validator source file
and every result file, and records the validator commit, so any number in the report can
be traced to the exact code and output that produced it.
"""
import glob
import os
import shutil
import sys
import time

from common import FROZEN, FROZEN_BYTES, FROZEN_SHA, OUT, SCRATCH, WORK, sha256

commit = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
rep_src = os.path.join(here, "V2C_FINAL_VALIDATION_REPORT_2026-09-23.md")
rep_dst = os.path.join(WORK, "V2C_FINAL_VALIDATION_REPORT_2026-09-23.md")
idx_dst = os.path.join(WORK, "V2C_FINAL_VALIDATION_INDEX_2026-09-23.json")
assert not os.path.exists(rep_dst) and not os.path.exists(idx_dst), "refusing to overwrite"
frozen_now = sha256(FROZEN)
idx = {
    "written_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "validator_commit": commit,
    "validator_branch": "breadth/v2c-validation (local worktree C:/w/v2cv, based on dbacc727e)",
    "frozen_artifact": {"path": FROZEN, "sha256_expected": FROZEN_SHA, "sha256_now": frozen_now,
                        "bytes_now": os.path.getsize(FROZEN), "unchanged": frozen_now == FROZEN_SHA
                        and os.path.getsize(FROZEN) == FROZEN_BYTES,
                        "mode": oct(os.stat(FROZEN).st_mode & 0o777),
                        "sidecars": [p for p in (FROZEN + "-wal", FROZEN + "-shm") if os.path.exists(p)]},
    "scratch_copy": {"path": SCRATCH, "sha256": sha256(SCRATCH)},
    "validator_sources": {os.path.basename(p): sha256(p) for p in sorted(glob.glob(os.path.join(here, "*.py")))},
    "results": {os.path.basename(p): {"sha256": sha256(p), "bytes": os.path.getsize(p)}
                for p in sorted(glob.glob(os.path.join(OUT, "*.json")))},
    "logs": sorted(os.path.basename(p) for p in glob.glob(os.path.join(WORK, "log_*.txt"))),
}
import json
with open(idx_dst, "x") as f:
    json.dump(idx, f, indent=1)
shutil.copyfile(rep_src, rep_dst + ".partial")
os.rename(rep_dst + ".partial", rep_dst)
for p in (idx_dst, rep_dst):
    os.chmod(p, 0o444)
print(json.dumps({"index": idx_dst, "report": rep_dst, "report_sha256": sha256(rep_dst),
                  "frozen_unchanged": idx["frozen_artifact"]["unchanged"],
                  "results": len(idx["results"])}, indent=1))
