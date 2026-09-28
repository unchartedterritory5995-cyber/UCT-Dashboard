"""F2 mutation harness (lane F2 only). Each mutation: exact-text replacement(s), asserted
unique; the scoped files run with a fresh bytecode prefix; restore from captured bytes;
sha checked against the capture AND against the committed blob (git cat-file)."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w10s1"
DB = "api/services/journal_two/db.py"
DV = "tests/test_journal_two_derivation_versions.py"
FILES = ["tests/test_journal_two_build_record_withdrawal.py", DV,
         "tests/test_journal_two_fts_map_note_rowid.py", "tests/test_journal_two_tag_index.py"]

MUTATIONS = [
    ("R1", "the withdrawal ignores the seam and sleeps through time.sleep", DB,
     [("    sleep = sleep_fn if sleep_fn is not None else _backoff_sleep", "    sleep = time.sleep")], "red"),
    ("R2", "the seam is EARLY-bound as a default argument", DB,
     [("sleep_fn=None) -> int:", "sleep_fn=_backoff_sleep) -> int:"),
      ("    sleep = sleep_fn if sleep_fn is not None else _backoff_sleep", "    sleep = sleep_fn")], "red"),
    ("R3", "in-memory keys as before: no hold, no identity check", DB,
     [("        _MEMORY_HOLDS[key] = conn\n", "        pass\n"),
      ('    return not key.startswith("memory:") or _MEMORY_HOLDS.get(key) is conn', "    return True")], "red"),
    ("R4", "the identity check alone is dropped", DB,
     [('    return not key.startswith("memory:") or _MEMORY_HOLDS.get(key) is conn', "    return True")], "red"),
    ("R5", "the boot never calls the withheld warning", DB,
     [("    _warn_withheld(conn, withheld_reasons)\n", "")], "red"),
    ("R6", "the FTS step's reason is not captured", DB,
     [('        withheld_reasons[_FTS_MAP_FAMILY] = f"{type(e).__name__}: {e}"\n', "")], "red"),
    ("R7", "the warning fires on a healthy boot too", DB,
     [("if _WITHHELD and _is_withheld(conn, f)]", "if True]")], "red"),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def blob(path):
    return subprocess.run(["git", "-C", REPO, "cat-file", "blob", f"HEAD:{path}"],
                          capture_output=True, check=True).stdout


def run_pytest():
    env = dict(os.environ)
    pyc = tempfile.mkdtemp(prefix="f2r1mut_pyc_")
    env["PYTHONPYCACHEPREFIX"] = pyc
    t0 = time.time()
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-p", "no:cacheprovider",
                        *FILES], cwd=REPO, env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    import shutil
    shutil.rmtree(pyc, ignore_errors=True)
    out = p.stdout + p.stderr
    tot = [l for l in out.splitlines() if re.search(r"\d+ (passed|failed)", l) and " in " in l]
    failed = sorted(set(re.findall(r"^FAILED (\S+)", out, re.M)))
    return p.returncode, (tot[-1].strip() if tot else "NO TOTALS LINE"), failed, round(time.time() - t0, 1)


def main():
    only = set(sys.argv[1:])
    results = []
    for mid, what, path, reps, expect in MUTATIONS:
        if only and mid not in only:
            continue
        full = os.path.join(REPO, path)
        orig = open(full, "rb").read()
        assert orig == blob(path), f"{path} differs from HEAD before {mid}"
        orig_sha = sha(orig)
        text = orig.decode("utf-8")
        for old, new in reps:
            n = text.count(old)
            assert n == 1, f"{mid}: anchor found {n} times: {old[:70]!r}"
            text = text.replace(old, new)
        try:
            open(full, "wb").write(text.encode("utf-8"))
            code, totals, failed, secs = run_pytest()
        finally:
            open(full, "wb").write(orig)
        restored = open(full, "rb").read()
        ok_restore = sha(restored) == orig_sha and restored == blob(path)
        verdict = "red" if code != 0 else "green"
        rec = {"id": mid, "what": what, "file": path, "expect": expect, "got": verdict,
               "as_expected": verdict == expect, "totals": totals, "failed": failed,
               "seconds": secs, "restored_sha256": sha(restored)[:16], "restore_verified": ok_restore}
        results.append(rec)
        print(json.dumps(rec), flush=True)
        assert ok_restore, f"{mid}: RESTORE FAILED"
    st = subprocess.run(["git", "-C", REPO, "status", "--porcelain"], capture_output=True, text=True).stdout
    print("GIT STATUS PORCELAIN LINES:", len([l for l in st.splitlines() if l.strip()]))
    print(st)
    return results


if __name__ == "__main__":
    main()
