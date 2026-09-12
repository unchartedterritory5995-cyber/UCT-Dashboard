"""Every build-time `VITE_*` the frontend reads must be DECLARED in the ledger.

⚰️ THE BLIND SPOT THIS CLOSES. `docs/feature_flags.json`'s `flags` section is held to
a gate list derived by AST from `api/**` — Python only. Build-time frontend flags are
read in `app/src/**` as `import.meta.env.VITE_*`, so the ledger could not see them at
all. On 2026-09-12 that was measured: nine `VITE_*` were set on the web service, eight
to the literal `1`, and all nine had been undefined in the shipped bundle for four days
because `Dockerfile.web` declared no build ARGs. The ledger was silent throughout — not
because anyone forgot a row, but because no row could exist.

⭐ A ledger row does not make a flag work. It makes an UNDECIDED flag visible: an unset
build flag and a flag deliberately left off are indistinguishable from outside the repo,
and that is the ambiguity `project_feature_flag_ledger` exists to remove.

⛔ The names are DERIVED (`tools/vite_flag_index.py`) and never typed here.
`tests/test_dockerfile_vite_build_args.py` asks the same module for the same set, so the
Dockerfile's ARG list and this ledger cannot disagree about which flags exist.

⚠️ `baked_value` is deliberately NOT asserted. It is a measurement of a deployed bundle,
this suite has no network, and a rail that checks a recorded number against nothing is
theatre. The served JS is the authority; the field carries `baked_measured_on` so a
reader can tell how old the claim is.

Mutation proof (run BEFORE calling this rail done):
    1. delete one build_flags row                  -> test_every_… RED, naming it
    2. add a build_flags row for a fake flag       -> test_no_stale… RED, naming it
    3. blank one row's note                        -> test_every_row… RED, naming it
    4. point vite_flag_index.frontend_root at an
       empty dir                                   -> test_the_index… RED
"""
from __future__ import annotations

import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER_PATH = os.path.join(REPO, "docs", "feature_flags.json")

sys.path.insert(0, REPO)
from tools import vite_flag_index          # noqa: E402  the ONE reader of the names

REQUIRED_FIELDS = ("status", "where", "owner", "railway_value",
                   "baked_value", "baked_measured_on", "last_changed", "note")
VALID_STATUS = ("armed", "dark", "pending")


def _ledger() -> dict:
    with open(LEDGER_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _build_flags() -> dict:
    return _ledger()["build_flags"]


def test_the_index_actually_reads_the_frontend():
    """Non-vacuity control. An empty derived set satisfies every assertion below by
    having nothing to assert — the shape this repo has been bitten by most."""
    names = vite_flag_index.names_read(REPO)
    assert len(names) >= 5, (
        "the index found %d VITE_* reads; it is not reading app/src" % len(names))
    assert "VITE_FLOW_PARTS" in names, (
        "VITE_FLOW_PARTS is read at app/src/pages/OptionsFlow.jsx and the index "
        "missed it — fix the index, not the expectation")


def test_every_vite_flag_the_frontend_reads_has_a_ledger_row():
    declared = set(_build_flags())
    sites = vite_flag_index.read_sites(REPO)
    missing = sorted(set(sites) - declared)
    assert not missing, (
        "%d build-time flag(s) are read by the frontend with no build_flags row in "
        "docs/feature_flags.json:\n%s\n\n"
        "An unset build flag and a flag off ON PURPOSE are indistinguishable from "
        "outside the repo. Add a row saying which it is, who owns the flip, and what "
        "Railway holds today."
        % (len(missing), "\n".join("    %s  (read at %s)" % (m, ", ".join(sites[m][:2]))
                                   for m in missing)))


def test_no_stale_build_flag_rows():
    declared = set(_build_flags())
    stale = sorted(declared - set(vite_flag_index.names_read(REPO)))
    assert not stale, (
        "docs/feature_flags.json declares build flags the frontend no longer reads: "
        "%s\nDelete the row, or restore the read if the removal was accidental."
        % ", ".join(stale))


def test_every_row_is_complete_and_a_dark_row_says_why():
    bad = []
    for name, row in sorted(_build_flags().items()):
        for f in REQUIRED_FIELDS:
            if f not in row:
                bad.append("%s: missing %r" % (name, f))
        if row.get("status") not in VALID_STATUS:
            bad.append("%s: status %r is not one of %s"
                       % (name, row.get("status"), list(VALID_STATUS)))
        if not str(row.get("note") or "").strip():
            bad.append("%s: empty note — a row with no reason records nothing" % name)
        if not str(row.get("owner") or "").strip():
            bad.append("%s: no owner — nobody is recorded as able to decide" % name)
    assert not bad, "incomplete build_flags rows:\n    " + "\n    ".join(bad)


def test_the_two_ledger_sections_do_not_overlap():
    """`flags` is derived from api/** and `build_flags` from app/src/**. A name in both
    would be two authorities over one value — the defect this repo names most."""
    both = sorted(set(_ledger()["flags"]) & set(_build_flags()))
    assert not both, "declared in BOTH ledger sections: %s" % ", ".join(both)
    leaked = sorted(k for k in _ledger()["flags"] if k.startswith("VITE_"))
    assert not leaked, (
        "VITE_* names in the `flags` section: %s\nThat section is held to an AST scan "
        "of api/**, which cannot see them; they belong in build_flags."
        % ", ".join(leaked))
