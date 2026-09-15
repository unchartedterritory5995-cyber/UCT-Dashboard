"""Is every expected fingerprint in the signing manifest still true — and if not, WHY?

⛔⛔ **THE MANIFEST IS DERIVED, NEVER TYPED.** A fingerprint that was true when it was
reported to the owner goes stale the moment the packet is edited, and the owner has no way
to see that from the number alone. ⚰️ 2026-09-14: F-S2-1 was reported as `28da7740d` and
edited hours later to `72cda4cda`. A signature against the reported value would have
approved a document that no longer existed.

⛔ **A STALE ROW IS NOT REFRESHED BLIND.** This prints the AUDIT TRAIL — every commit that
touched the packet since its fingerprint last matched — so the drift can be categorised
before anyone changes a number:

    (a) owner-facing text   -> refreshable
    (b) the APPROVAL BLOCK  -> ⛔ NEVER refresh; the block is the thing being signed
    (c) whitespace/format   -> refreshable
    (d) re-numbering        -> refreshable

⭐ **The "last matched" commit is DERIVED, not assumed.** The doc's history is walked from
newest to oldest and every version is hashed with `sign_gate`'s own function until one
equals the expected value. The number of versions hashed is printed, so a search that found
nothing is visibly a search rather than a silence.

⛔ **A ROW PER PACKET IS NOT COVERAGE OF THE BRANCH.** The manifest says which DOCUMENTS
get signed; it says nothing about which COMMITS actually merge. `tools/merge_all.py`'s
`UNITS` holds that mapping, and a commit missing from it is a commit the two-command
sequence will silently never merge -- the branch would land "complete" with work missing
and nothing would report it. `--check-commits` walks `git log origin/master..<branch>` and
fails on any commit no unit claims.

Exit 0 = every row OK · 1 = at least one STALE, or an unreferenced commit · 2 = UNREADABLE
(no manifest, no rows)
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
OK, STALE_EXIT, UNREADABLE_EXIT = 0, 1, 2


def _sign_gate():
    spec = importlib.util.spec_from_file_location("_sg", str(HERE / "sign_gate.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


SG = _sign_gate()


def fingerprint_text(text: str) -> str:
    """sign_gate's OWN computation — a second implementation would be a second authority."""
    return SG.fingerprint(text)


def rows(manifest: pathlib.Path) -> list:
    out = []
    for n, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 3:
            raise SystemExit("⛔ manifest line %d is not `path | cps | fingerprint`" % n)
        out.append({"line": n, "path": parts[0], "cps": parts[1], "want": parts[2]})
    return out


def git(args, cwd=None) -> str:
    # ⚰️ `cwd=REPO` as a DEFAULT ARGUMENT binds the value at def time, so a test that
    # repoints REPO was still reading the real repository - the trail came back empty and
    # every "no matching commit" answer was a silence, not a search. Caught by the
    # dirty-fixture control, which is exactly what it is for.
    cwd = cwd or REPO
    out = subprocess.run(["git"] + args, cwd=str(cwd), capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    return out.stdout if out.returncode == 0 else ""


def history(path: str) -> list:
    raw = git(["log", "--format=%h|%ad|%an|%s", "--date=short", "--", path])
    return [l for l in raw.splitlines() if l.strip()]


def trail(path: str, want: str) -> tuple:
    """(commits since it last matched, versions hashed, the matching commit or None).

    ⛔ Walks newest→oldest hashing every version. A `git log` alone cannot say WHICH
    commit the expected value came from; only hashing can."""
    commits = [l.split("|")[0] for l in history(path)]
    since, hashed = [], 0
    for c in commits:
        blob = git(["show", "%s:%s" % (c, path)])
        if not blob:
            continue
        hashed += 1
        if fingerprint_text(blob) == want:
            return since, hashed, c
        since.append(c)
    return since, hashed, None


def check(manifest: pathlib.Path, verbose=True) -> tuple:
    table = rows(manifest)
    results = []
    for r in table:
        p = REPO / r["path"]
        if not p.is_file():
            r.update(state="MISSING-FILE", got="-")
        else:
            got = fingerprint_text(p.read_text(encoding="utf-8"))
            r.update(got=got, state="OK" if got == r["want"] else "STALE")
        results.append(r)

    if verbose:
        print("[verify-manifest] rows: %d" % len(results))
        for r in results:
            print("  %-2d %-50s %-12s %-9s %s"
                  % (r["line"], pathlib.Path(r["path"]).name, r["cps"], r["state"],
                     r.get("got", "")))
            if r["state"] == "STALE":
                since, hashed, at = trail(r["path"], r["want"])
                print("       expected %s   found %s" % (r["want"], r["got"]))
                print("       versions hashed while searching for the expected value: %d"
                      % hashed)
                if at is None:
                    print("       ⛔ the expected value matches NO version in this doc's "
                          "history — it was never this file's fingerprint.")
                else:
                    print("       last matched at %s; changed since by %d commit(s):"
                          % (at, len(since)))
                    for line in history(r["path"]):
                        if line.split("|")[0] in since:
                            print("         %s" % line)
        if not results:
            print("[verify-manifest] ZERO rows — the manifest is empty or unparseable.")
    return results, sum(1 for r in results if r["state"] != "OK")


CODE_REPO = REPO.parent / "s7-price-level"


def _units():
    """merge_all.py's OWN declaration -- never a second copy of the mapping here."""
    spec = importlib.util.spec_from_file_location("_ma", str(HERE / "merge_all.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.UNITS


def check_commits(branch="feat/s7-price-level", base="origin/master", verbose=True) -> int:
    """Every commit on the branch must be claimed by exactly one unit.

    ⛔ NON-VACUITY: the branch commit count is PRINTED. A walk that found no commits --
    a bad ref, an unfetched base -- reports "0 unreferenced" and looks identical to full
    coverage, which is the failure this whole file exists to refuse."""
    raw = git(["log", "--format=%h", "%s..%s" % (base, branch)], cwd=CODE_REPO)
    commits = [l.strip() for l in raw.splitlines() if l.strip()]

    claimed = {}
    for stem, shas, _mv in _units():
        for sha in shas:
            claimed[sha] = stem

    if verbose:
        print()
        print("[verify-manifest] commit coverage: %s..%s" % (base, branch))
        print("  commits on the branch : %d" % len(commits))
        print("  commits claimed by a unit: %d" % len(claimed))

    if not commits:
        if verbose:
            print("  ⛔ ZERO commits walked -- the ref is wrong or the base is unfetched. "
                  "That is UNREADABLE, not coverage.")
        return UNREADABLE_EXIT

    # a sha may be abbreviated differently on each side; compare on the shorter prefix
    def _match(sha):
        for c in claimed:
            if sha.startswith(c) or c.startswith(sha):
                return claimed[c]
        return None

    missing = []
    for sha in commits:
        stem = _match(sha)
        if stem is None:
            subject = git(["log", "-1", "--format=%s", sha], cwd=CODE_REPO).strip()
            missing.append((sha, subject))

    if verbose:
        print("  mapped: %d of %d" % (len(commits) - len(missing), len(commits)))
        for sha, subject in missing:
            print("  ⛔ UNREFERENCED: %s  %s" % (sha, subject))
        if missing:
            print("  ⛔ These commits are on the branch and NO unit claims them, so "
                  "merge_all.py would never merge them.")
    return STALE_EXIT if missing else OK


def _self_check() -> int:
    """⛔ clean / dirty / empty, in a throwaway git repo, before the real manifest."""
    import tempfile
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-54s -> %-9s %s" % (label, got, "ok" if good else "WRONG (want %s)" % want))

    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        (d / "tools").mkdir()
        doc = d / "p.md"
        doc.write_text("# packet\n\n```\nAPPROVED BY:\nAPPROVED ON:\n"
                       "APPROVED AT SHA:\nSCOPE APPROVED:\n```\n", encoding="utf-8")
        for cmd in (["init", "-q"], ["add", "-A"]):
            subprocess.run(["git"] + cmd, cwd=str(d), capture_output=True)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                        "commit", "-q", "-m", "v1"], cwd=str(d), capture_output=True)
        fp1 = fingerprint_text(doc.read_text(encoding="utf-8"))

        man = d / "m.txt"
        man.write_text("p.md | CP1 | %s\n" % fp1, encoding="utf-8")

        global REPO
        real = REPO
        REPO = d
        try:
            res, bad = check(man, verbose=False)
            show("CLEAN fixture: the row matches", (res[0]["state"], bad), ("OK", 0))

            doc.write_text(doc.read_text(encoding="utf-8") + "one more byte\n",
                           encoding="utf-8")
            subprocess.run(["git", "add", "-A"], cwd=str(d), capture_output=True)
            subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                            "commit", "-q", "-m", "v2 one byte"], cwd=str(d),
                           capture_output=True)
            res, bad = check(man, verbose=False)
            show("DIRTY fixture: one byte changed -> STALE",
                 (res[0]["state"], bad), ("STALE", 1))
            since, hashed, at = trail("p.md", fp1)
            show("DIRTY fixture: the trail is exactly one commit", len(since), 1)
            show("DIRTY fixture: it found the version that matched", at is not None, True)
            show("...and says how many versions it hashed", hashed >= 2, True)

            empty = d / "empty.txt"
            empty.write_text("# only a comment\n", encoding="utf-8")
            res, bad = check(empty, verbose=False)
            show("EMPTY manifest: ZERO rows, not zero problems", (len(res), bad), (0, 0))

            # ⛔ a fingerprint that never belonged to this doc must be distinguishable
            since, hashed, at = trail("p.md", "0000deadb")
            show("a value that was NEVER this doc's -> no matching commit",
                 at is None and hashed >= 2, True)
        finally:
            REPO = real

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--check-commits", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    man = pathlib.Path(a.manifest)
    if not man.is_file():
        print("⛔ manifest not found: %s" % man)
        return UNREADABLE_EXIT
    results, bad = check(man)
    if not results:
        return UNREADABLE_EXIT
    print()
    print("[verify-manifest] %d OK, %d STALE"
          % (sum(1 for r in results if r["state"] == "OK"), bad))
    rc = STALE_EXIT if bad else OK
    if a.check_commits:
        crc = check_commits()
        if crc != OK:
            rc = crc if rc == OK else rc
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
