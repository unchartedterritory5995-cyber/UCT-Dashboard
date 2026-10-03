"""Wave 13 lane 13C-2 -- mutation proof over the single-authority wiring.

Targets the load-bearing claim of this phase: the earnings-prep template calls the SAME
scaffold the one-click door uses, the draft fetch is gated on both `needs.earningsPrepDraft`
and a ticker, and a refusal resolves to null rather than throwing.

Restore discipline (CLAUDE.md "feedback_mutation_check_never_git_checkout"): capture bytes
BEFORE mutating, write back the captured bytes to restore, then verify the restored file's
sha256 against `git cat-file blob HEAD:<path>` -- never `git checkout --`.
"""
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

NPX = shutil.which("npx")
assert NPX, "npx is not on PATH"

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13c2")
HEAD = "f2af4c168e162f41ad2333cdb8fb276c4aeaeebe"

NT = REPO / "app/src/pages/journal-2-0/lib/notebookTemplates.js"
TC = REPO / "app/src/pages/journal-2-0/lib/templateContext.js"

# (label, file, find, replace, test files to run)
MUTATIONS = [
    (
        "M1-build-ignores-draft",
        NT,
        "    build: (ctx = {}) => buildPrepDoc(ctx.earningsPrepDraft || {}),",
        "    build: () => buildPrepDoc({}),",
        ["src/pages/journal-2-0/lib/notebookTemplates.test.js"],
    ),
    (
        "M2-defaultTitle-ignores-draft",
        NT,
        "    defaultTitle: (ctx = {}) => (ctx.earningsPrepDraft\n"
        "      ? prepTitle(ctx.earningsPrepDraft)\n"
        "      : (ctx.ticker ? `Earnings Prep — ${ctx.ticker}` : 'Earnings Prep')),",
        "    defaultTitle: (ctx = {}) => (ctx.ticker ? `Earnings Prep — ${ctx.ticker}` : 'Earnings Prep'),",
        ["src/pages/journal-2-0/lib/notebookTemplates.test.js"],
    ),
    (
        "M3-needs-dropped",
        NT,
        "    needs: { earningsPrepDraft: true },",
        "    needs: {},",
        ["src/pages/journal-2-0/lib/notebookTemplates.test.js"],
    ),
    (
        "M4-probe-context-missing-key",
        NT,
        "  // Wave 13 lane 13C-2: left `null`, matching `emptyTemplateContext()`'s own default -- a draft\n"
        "  // is either the real, fetched shape or absent, never a marked placeholder object (nothing in\n"
        "  // `buildPrepDoc` reads a truthy-but-fake draft as \"has data\"; every cell checks `value`).\n"
        "  earningsPrepDraft: null,\n})",
        "})",
        [
            "src/pages/journal-2-0/lib/notebookTemplates.test.js",
            "src/pages/journal-2-0/components/notebook/TemplatePicker.gallery.test.jsx",
        ],
    ),
    (
        "M5-fetch-not-gated-on-need",
        TC,
        "    needs.earningsPrepDraft ? earningsPrepDraftFor(normalizedTicker) : Promise.resolve(null),",
        "    earningsPrepDraftFor(normalizedTicker),",
        ["src/pages/journal-2-0/lib/templateContext.test.js"],
    ),
    (
        "M6-fetch-not-gated-on-ticker",
        TC,
        "const earningsPrepDraftFor = async (ticker) => {\n  if (!ticker) return null\n  try {",
        "const earningsPrepDraftFor = async (ticker) => {\n  try {",
        ["src/pages/journal-2-0/lib/templateContext.test.js"],
    ),
    (
        "M7-refusal-rethrows",
        TC,
        "const earningsPrepDraftFor = async (ticker) => {\n  if (!ticker) return null\n  try {\n    return await requestPrepDraft(ticker)\n  } catch {\n    return null\n  }\n}",
        "const earningsPrepDraftFor = async (ticker) => {\n  if (!ticker) return null\n  return requestPrepDraft(ticker)\n}",
        ["src/pages/journal-2-0/lib/templateContext.test.js"],
    ),
]


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def git_clean(path: Path) -> bool:
    """True when the working file matches HEAD -- compared the way git itself does (through
    its own checkout/diff normalisation), never by a raw byte compare: this box has
    core.autocrlf=true, so a pure-LF blob checks out CRLF on disk, and a raw byte compare
    against `git cat-file blob` would always disagree with a perfectly clean file."""
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
        # This box checks files out CRLF (core.autocrlf=true) even though every blob here is
        # stored LF (confirmed: CR count == LF count on this file, i.e. uniformly CRLF on
        # disk). The MUTATIONS table's find/replace strings are written plain-LF for
        # readability, so translate them to match what is actually on disk before searching.
        eol = "\r\n" if text.count("\r\n") == text.count("\n") and "\r\n" in text else "\n"
        find_disk = find.replace("\n", eol)
        replace_disk = replace.replace("\n", eol)
        assert find_disk in text, f"{label}: find-string not present in {path.name} (eol={eol!r})"
        mutated = text.replace(find_disk, replace_disk, 1)
        assert mutated != text, f"{label}: replace produced no change"
        path.write_bytes(mutated.encode("utf-8"))
        try:
            assert not git_clean(path), f"{label}: the mutation produced no diff -- find/replace were identical"
            rc, out, err = run_vitest(files)
            killed = rc != 0
            results.append((label, killed, rc))
            print(f"{label}: {'KILLED (red, as expected)' if killed else 'SURVIVED -- NOT CAUGHT'} (exit {rc})")
            if not killed:
                print(out[-3000:])
                print(err[-2000:])
        finally:
            path.write_bytes(original)
            restored = path.read_bytes()
            assert restored == original, f"{label}: restore write mismatch (bytes written back != bytes captured)"
            assert git_clean(path), f"{label}: restored file still shows a diff against HEAD"
    print()
    all_killed = all(k for _, k, _ in results)
    for label, killed, rc in results:
        print(f"  {label}: {'KILLED' if killed else 'SURVIVED'} (exit {rc})")
    print(f"\nTOTAL: {sum(1 for _, k, _ in results if k)}/{len(results)} killed")
    sys.exit(0 if all_killed else 1)


if __name__ == "__main__":
    main()
