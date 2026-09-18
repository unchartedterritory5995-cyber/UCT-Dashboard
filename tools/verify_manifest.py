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

⛔⛔ **K CP14 — A SIGNED ROW USED TO CRASH THE WHOLE CHECK, TAKING `--check-commits` WITH IT.**
`check()` called `sign_gate.fingerprint(text)` with no span on EVERY row unconditionally.
`fingerprint()` with no span asks `target_span()` for the ONE unsigned block, and
`target_span()` RAISES `SystemExit` when every block already carries a fingerprint -- by
design, so signing can never overwrite a historical value. That `SystemExit` propagated
uncaught out of `check()`, out of `main()`, and killed the process before a single row of
the table printed and before `check_commits()` -- K CP8's commit-coverage proof -- ever ran.

Measured 2026-09-17: unit 1's packet signed at 23:22Z; the very next `pre_sitting` run went
NOT-READY on BOTH `verify_manifest (fingerprints)` and `verify_manifest --check-commits`,
from this one cause, the moment ANYTHING in the manifest was signed.

`sign_all.py` already solved this (`already_signed_as`, `sign_gate.rederive_signed`) -- a
SIGNED block's fingerprint is recomputed by blanking that SPECIFIC filled span and
re-hashing, which is the only way to check a signature after the fact. `check()` now asks
`sign_gate.read_approval()` FIRST and takes the SIGNED-aware path when every block is
filled, so it never calls the span-raising form on a packet with nothing left to sign.
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


def _at_sha_matches(text: str) -> list:
    """Every FILLED `APPROVED AT SHA:` line's (stored value, span), across the WHOLE doc.

    ⭐ Reuses `sign_gate`'s own `_AT_ANY` regex rather than a second copy of it -- a second
    regex hunting the same line is a second authority over what an approval line looks like.
    """
    return [(m.group(2), m.span()) for m in SG._AT_ANY.finditer(text) if m.group(2)]


def _row_state(text: str, want: str) -> tuple:
    """(state, got) for ONE row, SIGNED-aware. K CP14.

    ⛔⛔ **NEVER calls `SG.fingerprint(text)` with no span.** That form asks
    `target_span()` for the UNSIGNED block and RAISES when every block is already filled --
    correct for `sign_all` (which must never overwrite a historical value by guessing), fatal
    here, where a fully-signed packet is an ordinary thing this reader must be able to look
    at. `read_approval()` is asked FIRST, and the SIGNED branch below is `sign_all`'s own
    `already_signed_as` logic, unchanged: rederive each filled block from the CURRENT file
    and compare against what the manifest expects.

    Returns one of: OK, STALE (both the pre-existing UNSIGNED-row behaviour, byte-identical),
    SIGNED-OK, SIGNED-STALE, SIGNED-ELSEWHERE (want matches no stored value, so this row's
    signature covers a different scope than the manifest expects), MALFORMED.
    """
    state, reason = SG.read_approval(text)
    if state == SG.MALFORMED:
        return "MALFORMED", reason
    if state == SG.SIGNED:
        pairs = _at_sha_matches(text)
        stored = [v for v, _sp in pairs]
        if want not in stored:
            return "SIGNED-ELSEWHERE", ", ".join(stored) or "-"
        span = pairs[stored.index(want)][1]
        rederived = SG.rederive_signed(text, span)
        if rederived != want:
            return "SIGNED-STALE", rederived
        return "SIGNED-OK", want
    # UNSIGNED -- exactly the prior behaviour: target_span() finds the one blank block
    # (read_approval already proved there is exactly one, or none at all) and fingerprint()
    # is safe to call with no span.
    got = fingerprint_text(text)
    return ("OK" if got == want else "STALE"), got


#: states that do NOT count against the run -- everything else is "bad".
_GOOD_STATES = ("OK", "SIGNED-OK")


def check(manifest: pathlib.Path, verbose=True) -> tuple:
    table = rows(manifest)
    results = []
    for r in table:
        p = REPO / r["path"]
        if not p.is_file():
            r.update(state="MISSING-FILE", got="-")
        else:
            state, got = _row_state(p.read_text(encoding="utf-8"), r["want"])
            r.update(state=state, got=got)
        results.append(r)

    if verbose:
        print("[verify-manifest] rows: %d" % len(results))
        for r in results:
            print("  %-2d %-50s %-12s %-13s %s"
                  % (r["line"], pathlib.Path(r["path"]).name, r["cps"], r["state"],
                     r.get("got", "")))
            # ⛔ The historical-commit TRAIL only makes sense for the plain UNSIGNED
            # fingerprint (it walks history re-hashing with the UNSIGNED span, which is
            # not the span a SIGNED block was hashed against) -- SIGNED-STALE prints
            # want/got and stops there rather than walking a trail that would be answering
            # a different question than the one it looks like it is answering.
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
            elif r["state"] == "SIGNED-STALE":
                print("       ⛔ this block is SIGNED, and its live content no longer "
                      "rederives its own recorded fingerprint — the packet was edited "
                      "after signing.")
                print("       recorded %s   rederives %s" % (r["want"], r["got"]))
            elif r["state"] == "SIGNED-ELSEWHERE":
                print("       ⛔ the manifest expects %s; this packet's filled block(s) "
                      "carry: %s" % (r["want"], r["got"]))
            elif r["state"] == "MALFORMED":
                print("       ⛔ %s" % r["got"])
        if not results:
            print("[verify-manifest] ZERO rows — the manifest is empty or unparseable.")
    return results, sum(1 for r in results if r["state"] not in _GOOD_STATES)


CODE_REPO = REPO.parent / "s7-price-level"


def _units():
    """merge_all.py's OWN declaration -- never a second copy of the mapping here."""
    spec = importlib.util.spec_from_file_location("_ma", str(HERE / "merge_all.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.UNITS


def check_resolutions(verbose=True, folder=None) -> int:
    """K CP11 — every recorded resolution parses, hashes, and names a real row.

    ⛔ A resolution is applied at MERGE TIME to a production merge. A corrupt one that read as
    "absent" would silently turn an applied resolution into a strand, or worse, apply content
    nobody proved. Validated here so `pre_sitting` sees it before a sitting starts.
    """
    ma = _units_module()
    # ⛔ INJECTABLE, or the control cannot construct the failing state: a fresh module is
    # loaded per call, so redirecting the caller's copy reaches nothing.
    res, corrupt = ma.read_resolutions(folder)
    rows = {u[0] for u in ma.UNITS}
    if verbose:
        print()
        print("[verify-manifest] resolutions: %d parsed, %d corrupt" % (len(res), len(corrupt)))
    bad = list(corrupt)
    for r in res:
        if r["row"] not in rows:
            bad.append((r["_file"].name, "names row %r, which is not in UNITS" % r["row"]))
        if verbose and not bad:
            print("  %-58s row=%s path=%s" % (r["_file"].name, r["row"], r["path"]))
    if bad:
        for name, why in bad:
            print("  ⛔ %s — %s" % (name, why))
        return STALE_EXIT
    return OK


def _units_module():
    spec = importlib.util.spec_from_file_location("_ma2", str(HERE / "merge_all.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def check_commits(branch="feat/s7-price-level", base="origin/master", verbose=True,
                  repo=None, units=None) -> int:
    """Every commit on the branch must be claimed by EXACTLY one unit.

    ⛔ NON-VACUITY: the branch commit count is PRINTED. A walk that found no commits --
    a bad ref, an unfetched base -- reports "0 unreferenced" and looks identical to full
    coverage, which is the failure this whole file exists to refuse.

    ⛔⛔ K CP8 -- "EXACTLY one" WAS NOT CHECKED. `claimed[sha] = stem` is a dict write, so a
    sha claimed by two rows silently kept the LAST one, `len(claimed)` under-reported by
    one, and the run stayed green. A commit merged twice is a cherry-pick that exits 1 the
    second time and strands the session mid-list -- the same shape as the empty-pick trap
    K CP6 refuses. Duplicates are now collected and named as a ROW PAIR.

    ⭐ `repo` and `units` are injectable SO THE CONTROLS CAN DRIVE THIS AGAINST A THROWAWAY.
    A coverage check whose only fixture is the real repository can be proved to pass and can
    never be proved to FAIL -- and this file's own history is a default argument binding the
    real repo at def time and turning a search into a silence.
    """
    repo = repo or CODE_REPO
    raw = git(["log", "--format=%h", "%s..%s" % (base, branch)], cwd=repo)
    commits = [l.strip() for l in raw.splitlines() if l.strip()]

    claimed, dupes = {}, []
    for stem, shas, _mv in (units if units is not None else _units()):
        for sha in shas:
            if sha in claimed and claimed[sha] != stem:
                dupes.append((sha, claimed[sha], stem))
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
            subject = git(["log", "-1", "--format=%s", sha], cwd=repo).strip()
            missing.append((sha, subject))

    if verbose:
        print("  mapped: %d of %d" % (len(commits) - len(missing), len(commits)))
        for sha, subject in missing:
            print("  ⛔ UNREFERENCED: %s  %s" % (sha, subject))
        if missing:
            print("  ⛔ These commits are on the branch and NO unit claims them, so "
                  "merge_all.py would never merge them.")
        for sha, first, second in dupes:
            print("  ⛔ CLAIMED TWICE: %s  by `%s` AND `%s`" % (sha, first, second))
        if dupes:
            print("  ⛔ A commit claimed by two rows is cherry-picked twice; the second "
                  "pick is EMPTY, exits 1, and strands the run mid-list.")
    return STALE_EXIT if (missing or dupes) else OK


def _self_check() -> int:
    """⛔ clean / dirty / empty, in a throwaway git repo, before the real manifest."""
    import tempfile
    import tempfile as _tf2
    import shutil
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        # ⛔ K CP14 — `"WRONG (want %s)" % want` raised when `want` was a 2+ element
        # TUPLE (one `%s` slot, multiple values): the format string ATE its own failure
        # report. `% (want,)` wraps it as ONE substitution regardless of what want is.
        print("  %-54s -> %-9s %s" % (label, got,
                                      "ok" if good else "WRONG (want %s)" % (want,)))

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

            # ── K CP14: a SIGNED row must not crash the check, and check_commits() must
            # still run after it (`check_commits` is called directly here rather than via
            # a real UNITS/branch, because THAT composition — a signed row not blocking the
            # ones after it — is exactly what F-VERIFY-1 broke). ──────────────────────────
            NL = chr(10)
            signed = d / "signed.md"
            good_by, good_on = "Patrick", "2026-09-17"
            # ⛔ `SCOPE APPROVED:` starts BLANK too, like every real packet's approval
            # block. `sign_gate.rederive_signed` blanks FOUR fields (AT SHA, BY, ON, AND
            # SCOPE, per K CP6 there) because `sign()` fills all four at signing time and
            # the fingerprint pins the bytes the owner read BEFORE any of them were
            # written. A fixture that pre-fills SCOPE in the "unsigned" state hashes
            # different bytes than rederive_signed blanks back to, and reads SIGNED-STALE
            # on a packet that was never edited — caught by running this control, not by
            # reading it.
            unsigned_block = NL.join(["# packet", "", "```", "APPROVED BY:",
                                      "APPROVED ON:", "APPROVED AT SHA:",
                                      "SCOPE APPROVED:", "```", ""])
            fp_signed = fingerprint_text(unsigned_block)
            signed_block = unsigned_block.replace(
                NL.join(["APPROVED BY:", "APPROVED ON:", "APPROVED AT SHA:",
                         "SCOPE APPROVED:"]),
                NL.join(["APPROVED BY: %s" % good_by, "APPROVED ON: %s" % good_on,
                         "APPROVED AT SHA: %s" % fp_signed, "SCOPE APPROVED: CP1"]))
            signed.write_text(signed_block, encoding="utf-8")
            subprocess.run(["git", "add", "-A"], cwd=str(d), capture_output=True)
            subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                            "commit", "-q", "-m", "signed v1"], cwd=str(d),
                           capture_output=True)
            man_signed = d / "m_signed.txt"
            man_signed.write_text("signed.md | CP1 | %s%s" % (fp_signed, NL), encoding="utf-8")

            res, bad = check(man_signed, verbose=False)
            show("K CP14 — a SIGNED row matching -> SIGNED-OK, exit 0, no crash",
                 (res[0]["state"], bad), ("SIGNED-OK", 0))

            # ⭐ THE EXACT COMPOSITION main() RELIES ON: check() succeeding on a signed
            # row must not prevent check_commits() from running right after it. Before
            # K CP14 this never printed anything — the process was already dead.
            box2 = pathlib.Path(_tf2.mkdtemp(prefix="k14-compose-"))
            try:
                def _g2(*args):
                    return subprocess.run(["git", "-C", str(box2), *args],
                                          capture_output=True, text=True,
                                          encoding="utf-8", errors="replace")
                _g2("init", "-q", "-b", "master")
                _g2("config", "user.email", "c@example.com")
                _g2("config", "user.name", "control")
                (box2 / "u1.txt").write_text("u1", encoding="utf-8")
                _g2("add", "u1.txt")
                _g2("commit", "-qm", "u1")
                _g2("branch", "-f", "fake-master")
                _g2("checkout", "-q", "-b", "feat")
                (box2 / "u2.txt").write_text("u2", encoding="utf-8")
                _g2("add", "u2.txt")
                _g2("commit", "-qm", "u2")
                a1 = _g2("rev-parse", "--short=9", "HEAD").stdout.strip()
                composed_units = [("unit-one", [a1], False)]
                res_sg, _bad_sg = check(man_signed, verbose=False)  # the SIGNED row, again
                crc = check_commits(branch="feat", base="fake-master", verbose=False,
                                    repo=box2, units=composed_units)
                show("...and check_commits() STILL RUNS right after a SIGNED row",
                     (res_sg[0]["state"], crc), ("SIGNED-OK", OK))
            finally:
                shutil.rmtree(box2, ignore_errors=True)

            # Now edit the packet's OWNER-FACING text (never the approval block) after
            # signing — the packet drifts from what was approved.
            drifted = signed.read_text(encoding="utf-8").replace(
                "# packet", "# packet, edited after signing")
            signed.write_text(drifted, encoding="utf-8")
            subprocess.run(["git", "add", "-A"], cwd=str(d), capture_output=True)
            subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                            "commit", "-q", "-m", "signed v2, edited after signing"],
                           cwd=str(d), capture_output=True)
            res, bad = check(man_signed, verbose=False)
            show("K CP14 — SIGNED then edited -> SIGNED-STALE, exit 1",
                 (res[0]["state"], bad), ("SIGNED-STALE", 1))

            # ⭐ ALL-UNSIGNED behaviour is UNCHANGED — the original CLEAN/DIRTY fixture
            # above already proves OK/STALE byte-for-byte; nothing here alters that path.
        finally:
            REPO = real

    # ── K CP8: the commit universe is git's, and the check can be proved to FAIL ─────────
    # ⛔ Every row below drives a THROWAWAY repo. The real branch can only ever demonstrate
    # the states it happens to be in; a control that cannot construct the failing state has
    # not tested the check, it has photographed the repository.
    import tempfile as _tf
    box = pathlib.Path(_tf.mkdtemp(prefix="k8-"))
    try:
        def _g(*args):
            return subprocess.run(["git", "-C", str(box), *args], capture_output=True,
                                  text=True, encoding="utf-8", errors="replace")

        def _commit(name):
            (box / name).write_text(name, encoding="utf-8")
            _g("add", name)
            _g("commit", "-qm", name)
            return _g("rev-parse", "--short=9", "HEAD").stdout.strip()

        _g("init", "-q", "-b", "master")
        _g("config", "user.email", "c@example.com")
        _g("config", "user.name", "control")
        _commit("base.txt")
        _g("branch", "-f", "fake-master")
        _g("checkout", "-q", "-b", "feat")
        a1, a2 = _commit("u1.txt"), _commit("u2.txt")

        full = [("unit-one", [a1], False), ("unit-two", [a2], False)]
        rc = check_commits(branch="feat", base="fake-master", verbose=False,
                           repo=box, units=full)
        show("every commit claimed            -> exit 0", rc, OK)

        orphan = _commit("u3.txt")
        rc = check_commits(branch="feat", base="fake-master", verbose=False,
                           repo=box, units=full)
        show("ONE extra orphan commit         -> exit 1 (non-vacuity)", rc, STALE_EXIT)

        full3 = full + [("unit-three", [orphan], False)]
        rc = check_commits(branch="feat", base="fake-master", verbose=False,
                           repo=box, units=full3)
        show("...and claiming it              -> exit 0 again", rc, OK)

        twice = full3 + [("unit-four", [a1], False)]
        rc = check_commits(branch="feat", base="fake-master", verbose=False,
                           repo=box, units=twice)
        show("ONE sha claimed by TWO rows     -> exit 1", rc, STALE_EXIT)

        rc = check_commits(branch="feat", base="feat", verbose=False,
                           repo=box, units=full3)
        show("an EMPTY range is UNREADABLE, never coverage", rc, UNREADABLE_EXIT)
    finally:
        import shutil
        shutil.rmtree(box, ignore_errors=True)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--check-commits", action="store_true")
    # ⛔ K CP8 — the base and the tip are ARGUMENTS with the old values as defaults, so the
    # universe can be stated at the call site and driven by a control. They were literals
    # inside the function, which is why the only fixture this check ever had was production.
    ap.add_argument("--base", default="origin/master")
    ap.add_argument("--branch", default="feat/s7-price-level")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    man = pathlib.Path(a.manifest)
    if not man.is_file():
        print("⛔ manifest not found: %s" % man)
        return UNREADABLE_EXIT

    # ⛔⛔ K CP14 — EVERY CHECK RUNS, REGARDLESS OF ANY OTHER CHECK'S RESULT. Before this,
    # an uncaught SystemExit inside check() (any SIGNED row) killed the process before
    # check_resolutions() or check_commits() were ever reached — the moment ANYTHING was
    # signed, K CP8's commit-coverage proof went dark as collateral damage from a fingerprint
    # bug, and pre_sitting could never read READY again. Each check is now isolated: a
    # crash inside ONE is caught, named, and counted as a failure, and the OTHERS still run.
    # The final exit code is the OR of all three — never short-circuited.
    rc = UNREADABLE_EXIT
    try:
        results, bad = check(man)
        if results:
            print()
            print("[verify-manifest] %d OK, %d STALE"
                  % (sum(1 for r in results if r["state"] in _GOOD_STATES), bad))
            rc = STALE_EXIT if bad else OK
        else:
            rc = UNREADABLE_EXIT
    except Exception as e:  # noqa: BLE001 -- isolate this check from the others, always
        print("⛔ verify_manifest.check() FAILED TO RUN: %s: %s" % (type(e).__name__, e))
        rc = UNREADABLE_EXIT

    try:
        rrc = check_resolutions()
    except Exception as e:  # noqa: BLE001
        print("⛔ check_resolutions() FAILED TO RUN: %s: %s" % (type(e).__name__, e))
        rrc = UNREADABLE_EXIT
    if rrc != OK:
        rc = rrc if rc == OK else rc

    if a.check_commits:
        try:
            crc = check_commits(branch=a.branch, base=a.base)
        except Exception as e:  # noqa: BLE001
            print("⛔ check_commits() FAILED TO RUN: %s: %s" % (type(e).__name__, e))
            crc = UNREADABLE_EXIT
        if crc != OK:
            rc = crc if rc == OK else rc
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
