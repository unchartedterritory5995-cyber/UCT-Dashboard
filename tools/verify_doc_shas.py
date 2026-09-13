"""Every SHA written into a program doc must resolve against git.

⚰️ WHY THIS EXISTS. On 2026-09-12 the LEDGER's S7 table carried four per-packet
gate SHAs — `052d21475`, `b4280afaf`, `4b4c3549b`, `3460a279b` — and **not one
was a valid git object**. They came out of a session's working notes rather than
out of the repository. All four packets had in fact been written EMPTY in one
commit and signed in another; there was never a per-packet SHA to cite.

⭐ **A plausible-looking SHA is the most convincing false citation there is.** It
has the right shape, it sits in the right column, and nothing but git can tell
you it is fiction. Prose can be argued with; a hex string reads as a
measurement.

⛔ CODE, NEVER PROSE is the usual rule here and this is its inverse case: the
docs ARE the prose, and what is being checked is the one thing inside them that
claims to be a fact about the repository.

Usage:
    python tools/verify_doc_shas.py            # scan, exit 1 on any unresolvable
    python tools/verify_doc_shas.py --self-check   # prove the scanner can fail
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

# ⛔ The console on this box is cp1252 and this file's report is full of ⛔/⭐.
# Without this the tool dies in its own print() and exits 0 through the shell —
# a scanner that reports nothing and looks like it passed.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOC_ROOTS = ("docs/terminal-research",)

#: A SHA candidate is a backticked hex run of 7-40 chars. The 7 floor keeps CSS
#: colours out (#c9a84c is six) and matches git's own abbreviation floor.
_SHA_RX = re.compile(r"`([0-9a-f]{7,40})`")

#: ⛔ AN ALL-DIGIT TOKEN IS NOT TREATED AS A SHA, AND THAT IS A MEASURED BLIND SPOT.
#: The competitive-research dossiers are full of backticked ticket ids, error codes
#: and row counts (`1413152`, `3221225786`) that match the hex class perfectly. On
#: the first run they were 24 of 35 "failures" — a rail whose output is three-
#: quarters noise gets muted within a week, which is the real failure mode.
#: ⚠️ THE COST, STATED RATHER THAN HIDDEN: a genuine 9-char SHA is all-digits with
#: probability (10/16)^9 ≈ 1.5%, so roughly one cited SHA in 65 is invisible to this
#: rail. That is the price of the signal-to-noise, it is not zero, and it is why
#: this comment names the number instead of saying "rare".
def _is_sha_shaped(tok: str) -> bool:
    return any(c in "abcdef" for c in tok)

#: ⛔ DELIBERATELY-QUOTED DEAD SHAs, each with the reason it must stay unresolvable.
#: A tombstone keeps the retired claim VERBATIM — that is the whole idiom — so the
#: four fabrications below have to survive in the text they indict. Every entry is
#: phantom-checked: if a string here stops appearing in the docs, the allowlist has
#: rotted and the scan fails on THAT.
QUOTED_DEAD = {
    "052d21475": "fabricated gate SHA, quoted verbatim inside its own LEDGER tombstone",
    "b4280afaf": "fabricated gate SHA, quoted verbatim inside its own LEDGER tombstone",
    "4b4c3549b": "fabricated gate SHA, quoted verbatim inside its own LEDGER tombstone",
    "3460a279b": "fabricated gate SHA, quoted verbatim inside its own LEDGER tombstone",
}


#: ⭐ SHAs THAT BELONG TO ANOTHER REPOSITORY. `system-map.md` is a roster of SIX
#: separate repos, each row carrying that repo's tip. Those SHAs are CORRECT and
#: will never resolve here — "unresolvable" and "fabricated" are different facts,
#: and a rail that conflates them teaches people to ignore it.
#: ⛔ Each entry names the repo, so a reader can check it where it lives. Two were
#: confirmed present in their repo on this box (morning-wire, uct-intelligence);
#: the other two are on machines this box cannot reach, and that is recorded as an
#: UNVERIFIED foreign citation rather than a pass.
FOREIGN_REPO = {
    "7a597f4": "morning-wire tip — CONFIRMED present in C:/Users/Patrick/morning-wire",
    "7a99d0e": "uct-intelligence tip — CONFIRMED present in C:/Users/Patrick/uct-intelligence",
    "c3efb4d": "uct-sunday-scan tip — UNVERIFIED, that repo is not checked out on this box",
    "9f05bfc": "uct-clips tip — UNVERIFIED, that repo is not checked out on this box",
}

_EXEMPT = {**QUOTED_DEAD, **FOREIGN_REPO}


def doc_files(root: pathlib.Path) -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for d in DOC_ROOTS:
        out.extend(sorted((root / d).rglob("*.md")))
    return out


def candidates(root: pathlib.Path) -> dict[str, list[tuple[str, int]]]:
    """sha -> [(relative path, 1-indexed line), ...]"""
    found: dict[str, list[tuple[str, int]]] = {}
    for p in doc_files(root):
        rel = p.relative_to(root).as_posix()
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for sha in _SHA_RX.findall(line):
                if not _is_sha_shaped(sha):
                    continue
                found.setdefault(sha, []).append((rel, n))
    return found


def resolves(sha: str, root: pathlib.Path) -> bool:
    r = subprocess.run(["git", "cat-file", "-e", sha + "^{object}"],
                       cwd=root, capture_output=True)
    return r.returncode == 0


def scan(root: pathlib.Path) -> tuple[dict, list, list]:
    found = candidates(root)

    # NON-VACUITY CONTROL — an empty scan is a failed invocation. The docs are
    # dense with SHAs; finding none means the glob or the regex is wrong, not
    # that the docs are clean.
    if len(found) < 20:
        raise SystemExit(
            f"⛔ SCANNER BROKEN, NOT DOCS CLEAN: only {len(found)} SHA candidates over "
            f"{len(doc_files(root))} files. Check DOC_ROOTS and _SHA_RX.")

    # CONTROL 2 — the resolver must actually resolve something. If git is
    # unreachable or the cwd is wrong, EVERY sha 'fails' and the report is noise.
    live = [s for s in found if s not in _EXEMPT and resolves(s, root)]
    if not live:
        raise SystemExit("⛔ RESOLVER BROKEN: not one candidate resolved. Wrong cwd or no git.")

    bad = sorted((s, found[s]) for s in found
                 if s not in _EXEMPT and not resolves(s, root))

    # Neither allowlist may rot: every exempt entry must still appear somewhere.
    phantom = sorted(s for s in _EXEMPT if s not in found)
    return found, bad, phantom


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true",
                    help="prove the scan can fail, against a scratch file")
    args = ap.parse_args()

    if args.self_check:
        scratch = ROOT / DOC_ROOTS[0] / "_sha_rail_self_check.md"
        scratch.write_text("A SHA that cannot exist: `0123456789abcdef0123456789abcdef01234567`\n",
                           encoding="utf-8")
        try:
            _, bad, _ = scan(ROOT)
            hit = [s for s, _ in bad if s.startswith("0123456789abcdef")]
            print("SELF-CHECK:", "PASS — the scan caught the planted SHA" if hit
                  else "⛔ FAIL — the scan did NOT catch a planted unresolvable SHA")
            return 0 if hit else 1
        finally:
            scratch.unlink(missing_ok=True)

    found, bad, phantom = scan(ROOT)
    print(f"[doc-sha] files={len(doc_files(ROOT))} distinct SHA candidates={len(found)} "
          f"quoted-dead={len(QUOTED_DEAD)} foreign-repo={len(FOREIGN_REPO)}")

    if phantom:
        print("\n⛔ ALLOWLIST HAS ROTTED — these are allowlisted but appear nowhere:")
        for s in phantom:
            print(f"    {s}  ({_EXEMPT[s]})")

    if bad:
        print(f"\n⛔ {len(bad)} SHA(s) DO NOT RESOLVE AGAINST GIT:\n")
        for sha, sites in bad:
            print(f"  {sha}")
            for rel, line in sites:
                print(f"      {rel}:{line}")
    else:
        print("\n[doc-sha] OK — every cited SHA resolves")

    return 1 if (bad or phantom) else 0


if __name__ == "__main__":
    sys.exit(main())
