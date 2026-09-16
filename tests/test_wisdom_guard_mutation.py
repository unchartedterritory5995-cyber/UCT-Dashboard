"""Every Wisdom guard is proved able to FAIL, in the suite, on every run.

Owner ruling 2026-09-13 (drift #5): "Extend the mutation-proof requirement to all four
import-ban checks and the R2 test-isolation guard: each check must have a test that fails
when the guard is removed."

⛔ Why this file exists rather than a line in a commit message. A mutation proof run by hand
is a claim about a moment. The guard it proved can be weakened the next day and the proof
still reads true in the log — which is `lesson_a_guard_repeated_is_a_guard_unproved` and
`lesson_gate_that_cannot_fail` combined. Here each guard is neutered IN PROCESS, the check is
re-run against a planted violation, and the test fails if the check still passes. Nothing is
written to disk, so there is no restore step that can be forgotten.

THE SHAPE, for anything added later: plant a violation the guard is supposed to catch, prove
the guard catches it (the CONTROL — without this the test can pass because the plant is
wrong), then neuter the guard and prove the catch stops. A mutation test with no control
proves only that something is broken, not that the guard is what was doing the work.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import bans, r2

# (rail, a file the rail scans, source that MUST be a violation of it)
PLANTED = {
    "substack": ("api/services/wisdom/sources/planted.py",
                 "import substack\nsubstack.publish()\n"),
    "journal": ("api/services/wisdom/sources/planted.py",
                "from api.services.journal_two import db\ndb.read()\n"),
    "private_store": ("api/services/ticker_mentions.py",
                      "from api.services.wisdom.core import private\nprivate.get_private('x')\n"),
}

# The guard each rail leans on, and a no-op replacement for it.
NEUTERED = {
    "substack": ("substack_import_violation", lambda module: None),
    "journal": ("journal_import_violation", lambda module: None),
    "private_store": ("PRIVATE_STRING_PATTERN", None),  # handled specially below
}


@pytest.mark.parametrize("rail", sorted(PLANTED))
def test_the_planted_violation_is_caught(rail):
    """CONTROL. If this fails, the plant is wrong and the mutation test below would pass for
    the wrong reason — it would be measuring a broken fixture, not a working guard."""
    path, source = PLANTED[rail]
    assert bans.scan_source(path, source, (rail,)), f"{rail}: the planted violation was not caught"


@pytest.mark.parametrize("rail", ["substack", "journal"])
def test_removing_the_import_guard_stops_the_catch(rail, monkeypatch):
    """Neuter the rail's import predicate; the planted reach must go UNDETECTED, proving the
    predicate is what was catching it."""
    path, source = PLANTED[rail]
    name, noop = NEUTERED[rail]
    monkeypatch.setattr(bans, name, noop)
    assert not bans.scan_source(path, source, (rail,)), (
        f"{rail}: the rail still reported a violation with {name} neutered, so something OTHER "
        f"than that guard is doing the work — the guard is not what the rail depends on")


def test_removing_the_private_store_guard_stops_the_catch(monkeypatch):
    """The private-store rail has two legs — the import check and the string check. Neuter
    both and the planted reach must go undetected."""
    path, source = PLANTED["private_store"]
    import re as _re
    monkeypatch.setattr(bans, "PRIVATE_ALLOWED_IMPORTERS", frozenset({path}))
    monkeypatch.setattr(bans, "PRIVATE_STRING_PATTERN", _re.compile(r"(?!x)x"))  # matches nothing
    assert not bans.scan_source(path, source, ("private_store",))


def test_the_private_store_string_leg_alone_is_load_bearing(monkeypatch):
    """The string leg is the one finding F3 widened (the store was reachable by its FILE or its
    TABLE name, neither of which is an import). Prove that leg carries its own weight."""
    reach = "PATH = '/data/wisdom_private.db'\nSQL = 'SELECT value_enc FROM wisdom_private_positions'\n"
    assert bans.scan_source("api/services/ticker_mentions.py", reach, ("private_store",))
    import re as _re
    monkeypatch.setattr(bans, "PRIVATE_STRING_PATTERN", _re.compile(r"(?!x)x"))
    assert not bans.scan_source("api/services/ticker_mentions.py", reach, ("private_store",))


# ── rail 4: off limits ───────────────────────────────────────────────────────

OFFLIMITS_PLANT = "app/src/pages/journal-2-0/NotebookTab.jsx"
FLOW_WORKER_PLANT = "api/flow_worker_main.py"


def test_the_offlimits_plants_are_caught():
    """CONTROL for both mutations below."""
    assert bans.offlimits_reason(OFFLIMITS_PLANT)
    assert bans.offlimits_reason(FLOW_WORKER_PLANT)


def test_emptying_the_offlimits_lists_stops_the_catch(monkeypatch):
    monkeypatch.setattr(bans, "OFFLIMITS_PREFIXES", ())
    monkeypatch.setattr(bans, "OFFLIMITS_FILES", ())
    monkeypatch.setattr(bans, "OFFLIMITS_GLOBS", ())
    monkeypatch.setattr(bans, "OFFLIMITS_BASENAMES", ())
    monkeypatch.setattr(bans, "OFFLIMITS_ANYWHERE_DIR", "\x00never")
    monkeypatch.setattr(bans, "flow_worker_watched", lambda: frozenset())
    assert bans.offlimits_reason(OFFLIMITS_PLANT) is None


def test_emptying_the_flow_worker_list_stops_that_catch_and_is_reported(monkeypatch):
    """⛔ The flow-worker leg is the expensive one: a green rail over a watched file buys a
    PERMANENT OPRA tape gap. Neutering it must both stop the catch AND be self-reported —
    an underivable list must never read as 'nothing is watched, all clear'."""
    monkeypatch.setattr(bans, "flow_worker_watched", lambda: frozenset())
    assert bans.offlimits_reason(FLOW_WORKER_PLANT) is None
    assert bans.offlimits_rail_limitations(), "a lost watch list must be reported, not silent"


# ── the R2 test-isolation guard ──────────────────────────────────────────────

def test_the_r2_guard_catches_a_real_client_attempt():
    """CONTROL: the guard fires in this very run."""
    with pytest.raises(r2.R2TestIsolation):
        r2._client_and_bucket()


def test_removing_the_r2_guard_stops_the_catch(monkeypatch):
    """Neuter the pytest predicate; the refusal must stop, proving the predicate is the guard.

    ⚠️ It then falls through to the ordinary path, which raises R2Unavailable because no
    DATA_SYNC_* is configured here — a DIFFERENT exception. That distinction IS the proof:
    R2TestIsolation means the guard refused, R2Unavailable means the guard was not what
    stopped it."""
    monkeypatch.setattr(r2, "_under_pytest", lambda: False)
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY",
                "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(r2.R2Unavailable):
        r2._client_and_bucket()


# ── the attribution guard (drift #4) ─────────────────────────────────────────

def test_removing_the_single_token_guard_restores_the_first_name_defect(monkeypatch):
    """The owner's drift #4 in one assertion: with the capability guard neutered, a bare given
    name put back into an alias list resolves to a CALL author again. This is what the guard
    is for, and it is why the guard lives in the resolver rather than only in the data."""
    import json
    from api.services.wisdom.core import authors

    doc = json.loads(json.dumps(authors.load_authors()))
    doc["ambiguous_speaker_labels"] = [e for e in doc["ambiguous_speaker_labels"]
                                       if e["label"] != "Patrick"]
    doc["authors"][0]["aliases"].append("Patrick")
    monkeypatch.setattr(authors, "load_authors", lambda: doc)

    assert authors.author_for_alias("Patrick") is None            # guard holds
    monkeypatch.setattr(authors, "declared_single_token_aliases",
                        lambda: frozenset({"patrick"}))           # guard neutered
    assert authors.author_for_alias("Patrick") == "tsdr"          # the defect returns


# ── the §8c.3 provenance marker ──────────────────────────────────────────────

def test_the_provenance_check_catches_a_planted_unmarked_consumer_write(tmp_path):
    """CONTROL for the two mutations below. The plant is written under tmp_path rather than
    into the tree: the checker reads FILES, so this one guard cannot be neutered in memory —
    and a tmp_path plant needs no restore step, which is the property that matters here."""
    from api.services.wisdom.publish import provenance_check

    assert provenance_check.self_check(tmp_path)["found"] == 1


def test_reading_every_table_as_wisdom_owned_stops_the_catch(tmp_path, monkeypatch):
    """The derivation IS the guard: a consumer table is one Wisdom's own MIGRATIONS do not
    create. Make the owned set swallow it and the check must go blind — which is exactly what
    a hand-typed roster would do the day it went stale."""
    from api.services.wisdom.publish import provenance_check

    monkeypatch.setattr(provenance_check, "wisdom_owned_tables", lambda: {"knowledge_base"})
    assert provenance_check.self_check(tmp_path)["found"] == 0


def test_the_marker_recognizer_is_what_refuses_an_unmarked_write(monkeypatch):
    """The runtime half. Neuter the recognizer and the refusal stops, proving the refusal is
    a real read of the value and not a call that always succeeds."""
    import re as _re

    from api.services.wisdom.publish.adapters import provenance

    with pytest.raises(provenance.UnmarkedWrite):       # CONTROL
        provenance.assert_marked({"notes": "no marker here"})
    monkeypatch.setattr(provenance, "MARKER_RE", _re.compile(""))   # matches everything
    assert provenance.assert_marked({"notes": "no marker here"})
