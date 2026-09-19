"""R40 — the dev ingest tool refuses the three ways it could go wrong, and counts ROWS.

⛔⛔ WHY THE REFUSALS MATTER MORE THAN THE HAPPY PATH. `C:\\data` is REAL on this box, the shared
root holds the owner's live databases, and this tool's whole job is to write records into a store.
A mistyped `--db` is the difference between a sandbox and production. The tool therefore refuses
rather than defaults, and each refusal names itself and exits 2 — `INCONCLUSIVE`-style, so
"I would not run" can never be read as "I ran and found nothing".

⭐ AND IT COUNTS ROWS WRITTEN, NEVER ATTEMPTS MADE. On its first real run the tool reported 63
sources inserted and the table held ZERO: `wisdom_sources` had grown two NOT NULL columns
(`ingest_version`, `ingested_at`) in a migration later than the base contract DDL, every
`INSERT OR IGNORE` failed the constraint, and OR IGNORE swallowed it. The column list is now read
from the live connection and the counters read `cursor.rowcount`.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, REPO / relpath)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ingest = _load("_ingest_under_test", "tools/wisdom/ingest_persisted_run.py")


# ── the three refusals ───────────────────────────────────────────────────────

@pytest.mark.parametrize("switch", ingest.SWITCHES)
def test_it_refuses_when_any_wisdom_switch_is_set(switch):
    with pytest.raises(ingest.Refused, match="switches are SET"):
        ingest.check_switches({switch: "1"})


def test_an_off_switch_is_not_a_set_switch():
    """⭐ The control. A refusal that fires on '0' would make the tool unusable and get disabled."""
    for value in ("", "0", "false", "no", "off", "  "):
        ingest.check_switches({s: value for s in ingest.SWITCHES})


def test_it_refuses_a_db_outside_the_sandbox_roots(tmp_path):
    """⛔ THE LOAD-BEARING REFUSAL."""
    with pytest.raises(ingest.Refused, match="must resolve under"):
        ingest.check_db_path(pathlib.Path("C:/data/wisdom.db"))
    with pytest.raises(ingest.Refused, match="must resolve under"):
        ingest.check_db_path(REPO / "api" / "wisdom.db")


def test_it_accepts_the_two_sandbox_roots(tmp_path):
    """The control for the refusal above: it must still permit what it is for."""
    assert ingest.check_db_path(REPO / "data" / "wisdom" / "local-store" / "x.db")
    assert ingest.check_db_path(tmp_path / "x.db")


def test_it_refuses_a_production_looking_data_dir():
    for value in ("/data", "/data/wisdom", "postgres://x.railway.app/db"):
        with pytest.raises(ingest.Refused, match="looks like production"):
            ingest.check_environment({"DATA_DIR": value})


def test_a_sandbox_data_dir_is_accepted(tmp_path):
    ingest.check_environment({"DATA_DIR": str(tmp_path), "DATABASE_URL": ""})


# ── the counting contract ────────────────────────────────────────────────────

def test_the_source_column_list_is_read_from_the_connection_not_typed():
    """⛔ The bug this file exists for: a typed column list goes stale on the next migration and
    INSERT OR IGNORE turns the resulting NOT NULL violation into silence."""
    src = (REPO / "tools" / "wisdom" / "ingest_persisted_run.py").read_text(encoding="utf-8")
    assert "PRAGMA table_info(wisdom_sources)" in src
    body = src.split("def _source_values", 1)[1].split("def ", 1)[0]
    assert "cols" in body and "table_info" in body


def test_it_counts_rows_written_not_attempts():
    src = (REPO / "tools" / "wisdom" / "ingest_persisted_run.py").read_text(encoding="utf-8")
    block = src.split("def ingest", 1)[1]
    assert "cur.rowcount" in block, "counters must read rowcount, not increment beside the call"
    assert "source_attempts" in block and "segment_attempts" in block, (
        "attempts are reported BESIDE rows so the two can be compared")


def test_a_first_ingest_that_writes_no_sources_refuses_to_report_success():
    """The guard that would have caught 63-attempts-zero-rows on run one."""
    src = (REPO / "tools" / "wisdom" / "ingest_persisted_run.py").read_text(encoding="utf-8")
    assert "refusing to report success" in src
    assert "swallowed" in src


# ── it is a tool, not a chain step ───────────────────────────────────────────

def test_nothing_under_api_imports_this_tool():
    """⛔ It writes through the production writer; it must never become part of the product."""
    import subprocess

    # ⛔ --untracked, or this searches only COMMITTED files and answers "clean" for a tool that is
    # not committed yet. The non-vacuity control below caught exactly that on first run: an empty
    # result from a search that could not have matched anything
    # (lesson: an empty result is a failed invocation until proven otherwise).
    def grep(*paths):
        return subprocess.run(["git", "-C", str(REPO), "grep", "-rln", "--untracked",
                               "ingest_persisted_run", "--", *paths],
                              capture_output=True, text=True).stdout

    assert grep("api/").strip() == "", grep("api/")
    # ⚠️ The control asserts the search finds a KNOWN REFERENCE — this test file. It deliberately
    # does NOT expect the tool itself: a module does not name itself in its own body, and asserting
    # that it does made this check red for a reason that had nothing to do with what it guards.
    here = grep("tools/", "tests/")
    assert "tests/test_wisdom_ingest_persisted_run.py" in here, here
    assert (REPO / "tools" / "wisdom" / "ingest_persisted_run.py").is_file()


def test_it_is_absent_from_the_daily_chain():
    chain = (REPO / "api" / "services" / "wisdom" / "publish" / "chain.py").read_text(encoding="utf-8")
    assert "ingest_persisted_run" not in chain
    # non-vacuity: the chain really does list steps this check could have matched
    assert "reconcile_stability" in chain and "publication_floor" in chain


# ── the environment this all rests on ────────────────────────────────────────

def test_the_gate_registry_still_holds_25_gates_and_the_five_are_among_them():
    """Re-asserted per the brief: the switch surface has not moved under the tool."""
    from api.services.wisdom.core import flags

    # Was 25; WISDOM_TWITTER_LISTENER_ENABLED added by session 28 (2026-09-19).
    assert len(flags.GATES) == 26, len(flags.GATES)
    names = {row[0] for row in flags.GATES}
    for switch in ingest.SWITCHES:
        assert switch in names, switch
    member_visible = [row[0] for row in flags.GATES if row[2]]
    assert len(member_visible) == 10, member_visible
    assert "ASKAI_WISDOM_RETRIEVAL_ENABLED" in member_visible
