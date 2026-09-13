"""D5 CP1 — the rail on the corporate-actions census.

⛔ APPROVED SCOPE (owner, 2026-09-12, GATE-D5 CP1): *"a rail that fails BY NAME
on a new unregistered one. INSTRUMENT ONLY."*

⛔⛔ THE FAILURE MODE THIS FILE EXISTS TO PREVENT IS NOT A WRONG COUNT — IT IS A
CENSUS THAT UNDER-ENUMERATES AND READS AS COVERAGE. A register that says "every
corporate-action site is classified" while three are invisible to the detector
is worse than no register: it converts an unknown into a false reassurance, and
nobody re-measures a question somebody has already answered.

⚰️ AND THAT IS NOT HYPOTHETICAL HERE — IT HAPPENED DURING THIS CHECKPOINT. The
first detector matched only the URL spelling (`?adjusted=true`) and missed the
Python keyword form: `adjusted=(kind == "stock")` in the broker's historical
equity valuation, `adjusted=adjusted` in the breadth point-in-time calibrator,
`adjusted=False` in option marks. Three real adjustment-basis decisions, one of
them carrying a five-line comment explaining exactly why the basis matters. The
register was hand-written from a measurement ten minutes old and was **already
two rows short**. Every test below is shaped by that.
"""
from __future__ import annotations

import ast
import pathlib
import re
import subprocess
import sys

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "corp_actions_census.py"

sys.path.insert(0, str(_REPO))
from tools import corp_actions_census as cac        # noqa: E402


@pytest.fixture(scope="module")
def rows():
    return cac.census(str(_REPO))


# ═════════════════════════════════════════════════════════════════════════
# NON-VACUITY — named members, never a count
# ═════════════════════════════════════════════════════════════════════════

def test_the_census_finds_the_sites_we_KNOW_are_there(rows):
    """⛔ AN EMPTY CENSUS SATISFIES EVERY "no unregistered sites" CHECK PERFECTLY.

    ⭐ NAMED MEMBERS, NEVER A COUNT. `assert len(rows) == 22` would go red the
    day somebody adds a legitimate new site — which is the population changing,
    not a defect. These four are load-bearing and are not going anywhere without
    a deliberate migration:
    """
    found = {(r.path, r.kind) for r in rows}
    for expected in (
        ("api/services/bars_sanitize.py", cac.PROVIDER_READ),
        ("api/services/bars_sanitize.py", cac.ADJUSTMENT_APPLIED),
        ("api/services/bars_split_repair.py", cac.ADJUSTMENT_APPLIED),
        ("api/services/bars_fetch.py", cac.VENDOR_ADJUSTED),
    ):
        assert expected in found, (
            f"the census no longer sees {expected[0]} as {expected[1]}. Either "
            "it was migrated — in which case say so in the REGISTER — or the "
            "detector broke.")
    assert len({r.kind for r in rows}) == len(cac.CLASSES), (
        "one of the three classes found nothing at all; a class that never "
        "fires is a detector that is broken, not a repo that is clean")


def test_the_adjustment_entry_points_are_DERIVED_from_the_repos_own_defs():
    """⛔ NEVER A TYPED LIST. A fifth adjuster must appear in the census the day
    somebody defines it, which is the whole difference between an inventory and
    a comment."""
    eps = cac.adjustment_entry_points(str(_REPO))
    assert "unadjusted_splits" in eps, f"the def scan missed the known adjuster: {sorted(eps)}"
    assert all(":" in loc for locs in eps.values() for loc in locs), \
        "an entry point has no file:line — it cannot be followed"


# ═════════════════════════════════════════════════════════════════════════
# THE RAIL ITSELF
# ═════════════════════════════════════════════════════════════════════════

def test_every_corporate_action_site_is_REGISTERED_with_a_state(rows):
    """⛔ THE RAIL. It fails BY NAME, never with a count."""
    unregistered = sorted((r.path, r.kind) for r in rows if r.state == "UNREGISTERED")
    assert not unregistered, (
        "a corporate-action site nobody has classified:\n" +
        "\n".join("    %s [%s]" % (p, k) for p, k in unregistered) +
        "\n\nAdd it to tools/corp_actions_census.py::REGISTER with one of "
        f"{cac.STATES} and, if `outside`, a written reason.")


def test_every_state_is_one_of_the_three_and_OUTSIDE_carries_a_REAL_reason(rows):
    """⛔ `outside` IS A DECISION, NOT A SUPPRESSION. An exclusion with no reason
    attached is a silent skip wearing a register's clothes."""
    for r in rows:
        assert r.state in cac.STATES, f"{r.path} [{r.kind}] has state {r.state!r}"
        if r.state == cac.OUTSIDE:
            assert len(r.reason) > 40, (
                f"{r.path} [{r.kind}] is excluded with no real reason: {r.reason!r}")
    outside = [r for r in rows if r.state == cac.OUTSIDE]
    assert outside, (
        "nothing is classified `outside`. Either the repo genuinely has no "
        "deliberate exclusion — unlikely, the breadth basis lives in another "
        "repository — or the three-state distinction has quietly become two.")


def test_the_register_names_NO_ROW_THE_CENSUS_CANNOT_PRODUCE(rows):
    """⛔⛔ THE PHANTOM CHECK, AND IT CAUGHT SIX ENTRIES WHILE THIS WAS WRITTEN.

    A register entry for a site the detector cannot find excuses nobody, and the
    next REAL site slips in beside it looking equally considered. Same shape as
    I1 slice 3's exclusion-list control and the `.gitignore` negation that could
    never fire.
    """
    live = {(r.path, r.kind) for r in rows}
    phantom = sorted(k for k in cac.REGISTER if k not in live)
    assert not phantom, (
        "the REGISTER names rows the census does not produce — either the "
        "detector narrowed or the site is gone:\n" +
        "\n".join("    %s [%s]" % (p, k) for p, k in phantom))


def test_OUTSTANDING_is_allowed_to_be_the_long_list(rows):
    """⭐ REPORTED, NOT ASSERTED DOWNWARD. D5 has migrated nothing, so a census
    opening with everything already `migrated` would be describing a programme
    that had not started. What matters is that the state is CHOSEN."""
    by_state = {s: [r for r in rows if r.state == s] for s in cac.STATES}
    print("[corp-actions] %s" % {s: len(v) for s, v in by_state.items()})
    assert not by_state[cac.MIGRATED], (
        "something is marked `migrated` and D5 has shipped no producer. Either "
        "a checkpoint landed without updating this note, or the state is wrong.")


# ═════════════════════════════════════════════════════════════════════════
# ⛔ CODE, NEVER PROSE — with the control
# ═════════════════════════════════════════════════════════════════════════

def test_the_census_reads_CODE_and_not_the_explanations_around_it():
    """The files this census inspects DISCUSS splits at length —
    `bars_sanitize.py`'s own header explains the whole adjustment doctrine. A
    raw scan would book every explanation as a call site."""
    src = (_REPO / "api" / "services" / "bars_sanitize.py")
    raw = src.read_text(encoding="utf-8")
    code = cac._code_only(str(src))
    assert code is not None
    assert len(code) < len(raw), "nothing was stripped — the strip is a no-op"
    # ⛔ TWO-SIDED CONTROL. The real function name must survive the strip…
    assert "unadjusted_splits" in code
    # …and something that exists ONLY in prose must not.
    #
    # ⚰️ THE FIRST VERSION OF THIS CONTROL TYPED ITS OWN NEEDLES —
    # ("doctrine", "reasoning", "explains") — and went RED because none of them
    # is in this file. ⭐ That is the control refusing to pass vacuously, which
    # is exactly what it is for, and the lesson is the one this repo keeps
    # relearning: a search for the shape you EXPECT rather than the shape that
    # EXISTS returns silence. The needle is now DERIVED from the diff.
    words = lambda s: set(re.findall(r"[A-Za-z]{6,}", s))
    prose_only = sorted(words(raw) - words(code))
    assert prose_only, (
        "not one word of six letters or more was removed by the strip, so the "
        "negative half of this control proves nothing about the stripper")
    print("[corp-actions] prose-only tokens removed by the strip: %d, e.g. %s"
          % (len(prose_only), prose_only[:6]))


def test_a_docstring_mentioning_an_endpoint_is_NOT_counted(tmp_path):
    """⛔ THE PLANTED NEGATIVE. A module whose ONLY mention of a splits endpoint
    is in a docstring must not appear in the census."""
    fake = tmp_path / "api" / "services"
    fake.mkdir(parents=True)
    (fake / "innocent.py").write_text(
        '"""We deliberately do NOT call reference/splits here."""\n'
        "def f():\n    return 1\n", encoding="utf-8")
    rows = cac.census(str(tmp_path))
    assert rows == [], f"a docstring mention was counted as a call site: {rows}"


def test_a_REAL_endpoint_and_a_REAL_kwarg_ARE_counted(tmp_path):
    """⛔ THE PLANTED POSITIVE — the control for the test above. Without it, a
    detector that matched nothing at all would pass that one perfectly."""
    fake = tmp_path / "api" / "services"
    fake.mkdir(parents=True)
    (fake / "guilty.py").write_text(
        'URL = "https://api.example.com/v3/reference/splits?x=1"\n'
        "def g(client):\n    return client.bars('AAPL', adjusted=True)\n",
        encoding="utf-8")
    rows = cac.census(str(tmp_path))
    kinds = {r.kind for r in rows}
    assert cac.PROVIDER_READ in kinds, "the URL detector missed a real endpoint"
    assert cac.VENDOR_ADJUSTED in kinds, "the kwarg detector missed a real adjusted="
    assert all(r.state == "UNREGISTERED" for r in rows), (
        "a planted site came back registered — the register is matching by "
        "something other than path")


def test_a_parameter_DECLARATION_named_adjusted_is_not_a_decision(tmp_path):
    """⚠️ THE FALSE POSITIVE THE FIRST DETECTOR WOULD HAVE HAD. `adjusted: bool =
    Query(False, …)` is a signature, not a basis choice — and in `gex_router.py`
    the word does not even mean a corporate action, it means trade-aware dealer
    positioning. A text match would count both."""
    fake = tmp_path / "api" / "services"
    fake.mkdir(parents=True)
    (fake / "sig.py").write_text(
        "def endpoint(ticker, adjusted = False):\n    return ticker\n", encoding="utf-8")
    rows = cac.census(str(tmp_path))
    assert rows == [], f"a parameter declaration was counted as a decision: {rows}"


# ═════════════════════════════════════════════════════════════════════════
# THE TOOL IS ACTUALLY RUNNABLE
# ═════════════════════════════════════════════════════════════════════════

def test_the_census_runs_as_a_command_and_reports_its_verdict():
    """⛔ AN AUDIT NOBODY CAN RUN READS AS COVERAGE. This programme's own
    history: the Desk insights pass was written, documented as scheduled, and
    wired into no scheduler for weeks."""
    r = subprocess.run([sys.executable, str(_TOOL)], cwd=str(_REPO),
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    assert r.returncode == 0, (
        "the census exits non-zero, so something is unregistered:\n"
        + (r.stdout or "") + (r.stderr or ""))
    assert "CORPORATE-ACTIONS CENSUS" in r.stdout
    for kind in cac.CLASSES:
        assert kind in r.stdout, f"the report does not mention {kind}"
    # ⛔ NON-VACUITY ON THE SUBPROCESS: a tool that crashed before doing
    # anything could exit 0 one day too.
    assert "adjustment entry points" in r.stdout


def test_the_tool_is_INSTRUMENT_ONLY_and_writes_nothing():
    """⛔ CP1's SCOPE IN ONE ASSERTION. `INSTRUMENT ONLY. No ledger, no
    producer, no reader migrated, no product module edited, no store touched.`"""
    tree = ast.parse(_TOOL.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree)
    for forbidden in ("sqlite3", "requests", "httpx", "urllib",
                      "shutil", "os.remove", "os.replace", "os.rename"):
        assert forbidden not in code, (
            f"the census reaches for {forbidden!r} — CP1 is an instrument, and "
            "an instrument that writes is a checkpoint nobody approved")
    # writing is `open(..., 'w')`; reading is `open(..., 'r')`
    assert not re.search(r"open\([^)]*['\"][wa]", code), \
        "the census opens a file for writing"
    # ⛔ CONTROL: the stripper still sees the real code it is judging.
    assert "def census" in code


def test_the_tool_lives_where_the_approval_says_it_does():
    """`tools/** + tests/** only` — and that is what makes CP1 strand nothing:
    flow-worker's import closure is entirely under `api/`."""
    sys.path.insert(0, str(_REPO / "tools"))
    import flow_worker_watch_coverage as fw
    reachable = fw.reachable_paths(_REPO)
    assert reachable, "the closure walk found nothing — it is broken, not empty"
    assert all(p.startswith("api/") for p in reachable), (
        "flow-worker's closure now reaches outside api/, so 'tools/ strands "
        "nothing by construction' is no longer true by construction")
    for p in ("tools/corp_actions_census.py", "tests/test_corp_actions_census.py"):
        assert p not in reachable
        assert (_REPO / p).exists()
