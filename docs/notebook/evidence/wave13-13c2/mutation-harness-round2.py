"""Wave 13 lane 13C-2, round 2 -- mutation proof over the client-side flag gate added after
walk run 1 found the earnings-prep draft fetch reaching the network while the capability was
dark in the client. Same restore discipline as round 1 (mutation-harness.py): capture bytes,
mutate, run the targeted vitest file, restore by writing back the captured bytes, verify with
`git diff --quiet` (never `git checkout --`, and never a raw byte compare against the stored
blob -- this box checks files out CRLF while the blob is LF).
"""
import shutil
import subprocess
import sys
from pathlib import Path

NPX = shutil.which("npx")
assert NPX, "npx is not on PATH"

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13c2")
TC = REPO / "app/src/pages/journal-2-0/lib/templateContext.js"

MUTATIONS = [
    (
        "M8-client-gate-dropped",
        TC,
        "  if (!ticker || !earningsPrepEnabled()) return null",
        "  if (!ticker) return null",
        ["src/pages/journal-2-0/lib/templateContext.test.js"],
    ),
]


def git_clean(path: Path) -> bool:
    rel = path.relative_to(REPO).as_posix()
    r = subprocess.run(["git", "diff", "--quiet", "--", rel], cwd=REPO)
    return r.returncode == 0


def run_vitest(files):
    cmd = [NPX, "vitest", "run", *files, "--maxWorkers=1"]
    r = subprocess.run(cmd, cwd=REPO / "app", capture_output=True, text=True, timeout=180)
    return r.returncode, r.stdout, r.stderr


def main():
    results = []
    for label, path, find, replace, files in MUTATIONS:
        original = path.read_bytes()
        assert git_clean(path), f"{label}: working tree != HEAD before mutating"
        text = original.decode("utf-8")
        eol = "\r\n" if text.count("\r\n") == text.count("\n") and "\r\n" in text else "\n"
        find_disk, replace_disk = find.replace("\n", eol), replace.replace("\n", eol)
        assert find_disk in text, f"{label}: find-string not present in {path.name} (eol={eol!r})"
        mutated = text.replace(find_disk, replace_disk, 1)
        path.write_bytes(mutated.encode("utf-8"))
        try:
            assert not git_clean(path), f"{label}: the mutation produced no diff"
            rc, out, err = run_vitest(files)
            killed = rc != 0
            results.append((label, killed, rc))
            print(f"{label}: {'KILLED (red, as expected)' if killed else 'SURVIVED -- NOT CAUGHT'} (exit {rc})")
            if not killed:
                print(out[-3000:]); print(err[-2000:])
        finally:
            path.write_bytes(original)
            restored = path.read_bytes()
            assert restored == original, f"{label}: restore write mismatch"
            assert git_clean(path), f"{label}: restored file still shows a diff against HEAD"
    all_killed = all(k for _, k, _ in results)
    print()
    for label, killed, rc in results:
        print(f"  {label}: {'KILLED' if killed else 'SURVIVED'} (exit {rc})")
    print(f"\nTOTAL: {sum(1 for _, k, _ in results if k)}/{len(results)} killed")
    sys.exit(0 if all_killed else 1)


if __name__ == "__main__":
    main()
