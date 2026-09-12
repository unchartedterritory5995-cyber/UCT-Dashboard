"""A `VITE_*` the frontend reads must be declared as a build ARG, or it ships undefined.

⚰️ THE TRAP THIS CLOSES. `Dockerfile.web` replaced the nixpacks build on
2026-09-08 (`af80e0b91`) and carried **zero** `ARG` declarations. nixpacks ran
`npm run build` inside the service's own environment, so Railway's `VITE_*`
variables were simply present in `process.env` and Vite inlined them. A Docker
stage inherits nothing: Railway offers each service variable as a build arg, and
an undeclared build arg is dropped without a word.

Measured on the deployed bundle 2026-09-12 — nine `VITE_*` set on `web`, eight of
them to the literal `1`, all nine undefined in the shipped JS for four days:

    useRealtimeBars   minified to `useEffect(()=>{{d({connected:!1,healthy:!1,
                      delivering:!1});return}},[!1,e,t])` — the subscribe body
                      eliminated, the dependency array holding the folded `!1`
    ComingSoon        `Y(()=>L(()=>import("./ComingSoon-….js"),…))` with its
                      result bound to NOTHING, while `Landing` kept its binding
    OptionsFlow       `part=bootstrap` · `REQUIRED_PARTS` · `planBundle` ·
                      `fetchPartsBundle` · `TOP_PICKS` — 0 occurrences each,
                      against live controls `/api/flow/data` ×3, `prehydrate` ×5

⭐ **NOTHING FAILED, AND THAT IS THE POINT.** Every one of these flags is read as
`=== '1'`, which is false when undefined — identical, at every layer a test or a
health check can reach, to "deliberately off". The suite was green, `/api/health`
was 200, and the only witness was the built artifact. This rail is the standing
witness.

⛔ THE LIST IS DERIVED, NEVER TYPED. A hand-kept copy in the Dockerfile is a
second authority over one value and would reopen the trap on the tenth flag.

⚠️ Comments are NOT stripped from the JS scan, deliberately. A `VITE_*` named
only inside a comment over-requires an ARG, and a spare ARG is inert — that is the
safe direction. The direction that costs members (a real read with no ARG) cannot
be manufactured by prose, so the "CODE, NEVER PROSE" rule is satisfied by the
asymmetry rather than by a stripper that would have to know a string from a `//`
inside `https://`.

Mutation proof (run BEFORE calling this rail done):
    1. delete one `ARG VITE_…` line from Dockerfile.web      -> test_every_… RED
    2. delete one `NAME=$NAME` from the ENV block            -> test_each_arg… RED
    3. point vite_flag_index.frontend_root at an empty directory       -> test_the_scan… RED
"""
from __future__ import annotations

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCKERFILE = os.path.join(REPO, "Dockerfile.web")

sys.path.insert(0, REPO)
from tools import vite_flag_index          # noqa: E402  the ONE reader of the names

_ARG_RE = re.compile(r"^ARG\s+(VITE_[A-Z0-9_]+)\s*$", re.M)


def vite_names_read() -> set[str]:
    """Delegated on purpose. `tests/test_vite_flag_ledger.py` asks the same module,
    so the Dockerfile's ARG list and the ledger's build_flags section are held to one
    derived set and cannot drift apart."""
    return vite_flag_index.names_read(REPO)


def _dockerfile() -> str:
    with open(DOCKERFILE, encoding="utf-8") as fh:
        return fh.read()


def declared_args() -> set[str]:
    return set(_ARG_RE.findall(_dockerfile()))


def test_the_scan_actually_reads_the_frontend():
    """Non-vacuity control. An empty scan would satisfy every assertion below by
    having nothing to assert, which is the shape this repo has been bitten by
    more than any other."""
    names = vite_names_read()
    assert len(names) >= 5, "scan found %d VITE_* reads — it is not reading app/src" % len(names)
    assert "VITE_FLOW_PARTS" in names, (
        "the Options Flow parts flag is read at app/src/pages/OptionsFlow.jsx and the "
        "scan missed it — fix the scan, not the expectation")


def test_every_vite_flag_the_frontend_reads_is_declared_as_a_build_arg():
    missing = sorted(vite_names_read() - declared_args())
    assert not missing, (
        "Dockerfile.web declares no ARG for %d VITE_* variable(s) the frontend reads: %s\n"
        "Railway hands each service variable to the build as a BUILD ARG, and an "
        "undeclared one is dropped silently — these would ship as `undefined`, which "
        "every `=== '1'` read turns into a disabled feature with a green suite."
        % (len(missing), ", ".join(missing)))


def test_each_declared_arg_is_also_exported_to_the_build():
    """ARG alone reaches `RUN`, but only by a documented Docker behaviour. The
    ENV mirror makes it true under either reading; keep the two halves together
    so a later editor cannot delete the one that is load-bearing on their host."""
    body = _dockerfile()
    unexported = sorted(n for n in declared_args() if "%s=$%s" % (n, n) not in body)
    assert not unexported, (
        "declared as ARG but never exported via ENV: %s" % ", ".join(unexported))


def test_the_env_block_is_physically_well_formed():
    """A substring check cannot see a BROKEN continuation — and did not.

    ⚰️ 2026-09-12: the ENV block was generated with a literal backslash+`n`
    pair instead of a real line continuation, so all seventeen exports sat on ONE
    physical line. `test_each_declared_arg_is_also_exported_to_the_build` passed
    happily — `NAME=$NAME` is present either way — and Railway FAILED the build
    in 14 seconds with no output past "scheduling build". A rail that asserts a
    substring is blind to the syntax around it.

    ⛔ The mangling came from a shell heredoc collapsing `${BS}${BS}` to
    `${BS}`, which is why this file builds every backslash with `chr(92)` rather
    than writing one: the same collapse would corrupt this test's own needle.
    """
    BS = chr(92)
    body = _dockerfile()
    assert (BS + "n") not in body, (
        "Dockerfile.web contains a literal backslash+n pair — a line "
        "continuation was written as two characters instead of a newline, and "
        "the build will fail before it starts")

    lines = body.split(chr(10))
    starts = [i for i, l in enumerate(lines) if l.startswith("ENV VITE_")]
    assert len(starts) == 1, "expected exactly one `ENV VITE_` block, found %d" % len(starts)

    args = declared_args()
    block = lines[starts[0]:starts[0] + len(args)]
    assert len(block) == len(args), (
        "the ENV block is %d physical line(s) for %d ARG(s) — the continuations "
        "are broken" % (len(block), len(args)))
    for n, line in enumerate(block[:-1]):
        assert line.rstrip().endswith(BS), (
            "ENV block line %d does not end with a continuation: %r" % (n + 1, line))
    assert not block[-1].rstrip().endswith(BS), (
        "the ENV block's LAST line ends with a continuation, so it swallows the "
        "instruction after it: %r" % block[-1])
