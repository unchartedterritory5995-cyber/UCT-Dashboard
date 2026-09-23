"""PHASE 0 — protect the evidence, then make the disposable scratch copy."""
import os
import shutil
import stat

from common import FROZEN, FROZEN_BYTES, FROZEN_SHA, SCRATCH, WORK, sha256, write

st = os.stat(FROZEN)
before = sha256(FROZEN)
res = {
    "frozen_path": FROZEN,
    "mode": oct(stat.S_IMODE(st.st_mode)),
    "bytes": st.st_size,
    "sha256": before,
    "mode_ok": stat.S_IMODE(st.st_mode) == 0o444,
    "bytes_ok": st.st_size == FROZEN_BYTES,
    "sha_ok": before == FROZEN_SHA,
    "sidecars_beside_frozen": [p for p in (FROZEN + "-wal", FROZEN + "-shm") if os.path.exists(p)],
}
assert res["mode_ok"] and res["bytes_ok"] and res["sha_ok"], res
os.makedirs(WORK, exist_ok=True)
if not os.path.exists(SCRATCH):
    shutil.copyfile(FROZEN, SCRATCH + ".partial")
    os.rename(SCRATCH + ".partial", SCRATCH)
    os.chmod(SCRATCH, 0o444)
res["scratch"] = SCRATCH
res["scratch_sha256"] = sha256(SCRATCH)
res["scratch_equal"] = res["scratch_sha256"] == FROZEN_SHA
res["frozen_sha_after"] = sha256(FROZEN)
assert res["scratch_equal"] and res["frozen_sha_after"] == FROZEN_SHA, res
print(write("p0_protect.json", res))
print(res)
