"""⛔⛔ NOTEBOOK_DOOR_GUARD — the mode flag that makes Q1 fix 6 provable.

⚰️ WHY A FLAG AT ALL, because "add a flag" is usually the wrong answer. Q1 fix 6
fixes the WRITER on the append route; the door guard (`noteHasUnsentWork`) is the
mitigation that has stood in front of it since D1. Proving fix 6 on production
requires the rig to REACH that route — and in `full` the guard defers every
append cell, so *"prove it on production, then release the guard"* can never
start. The mode is therefore a runtime value on the already-latched auth payload,
flippable with no deploy, and it is fix 6's FIRST rollback lever.

⛔ THE DEFAULT IS THE SAFE MODE ON BOTH SIDES, and an unrecognised value takes the
default rather than its opposite. A typo'd `unkown-only` must degrade to MORE
guarding, never to less — the same polarity discipline as the kill switch, one
type up.

⛔⛔ AND THIS FILE EXISTS BECAUSE THE FLAG WAS INVISIBLE TO EVERY EXISTING RAIL.
`tests/test_notebook_flags.py` iterates `NOTEBOOK_FLAGS`, which this key is not
in; `feature_flag_index.is_gate()` is a NAME test and `NOTEBOOK_DOOR_GUARD`
carries no ENABLED/DISABLE marker. So on first write the whole Python flag suite
— 253 tests — passed while knowing nothing about it. That is exactly the *"four
gates shipped past the index and every flag rail stayed green"* failure the table
form was taught to the index for, a third time.
"""
from __future__ import annotations

import os
import pathlib
import re

import pytest

from api.routers import auth as auth_router
from api.services import feature_flag_index as ffi

REPO = pathlib.Path(__file__).resolve().parents[1]
JS_FLAGS = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "offline" / "notebookFlags.js"
JS_GUARD = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "offline" / "noteHasUnsentWork.js"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("NOTEBOOK_DOOR_GUARD", raising=False)


def test_the_payload_carries_the_mode_and_it_defaults_to_full():
    got = auth_router._notebook_flags()
    assert "notebook_door_guard" in got, (
        "the mode must ride the same payload the other capabilities do — a "
        "second transport would be a second authority")
    assert got["notebook_door_guard"] == auth_router.DOOR_GUARD_FULL


@pytest.mark.parametrize("raw,expected", [
    ("full", "full"),
    ("unknown-only", "unknown-only"),
    ("  UNKNOWN-ONLY  ", "unknown-only"),     # trimmed + lowercased
    ("FULL", "full"),
])
def test_a_recognised_value_round_trips(monkeypatch, raw, expected):
    monkeypatch.setenv("NOTEBOOK_DOOR_GUARD", raw)
    assert auth_router._notebook_flags()["notebook_door_guard"] == expected


@pytest.mark.parametrize("raw", [
    "unkown-only",      # ⛔ the typo that must not open a live member path
    "unknown_only",     # underscore, not hyphen
    "off",
    "1",
    "true",
    "",
    "   ",
])
def test_an_UNRECOGNISED_value_takes_the_SAFE_default_never_the_permissive_one(monkeypatch, raw):
    monkeypatch.setenv("NOTEBOOK_DOOR_GUARD", raw)
    assert auth_router._notebook_flags()["notebook_door_guard"] == auth_router.DOOR_GUARD_FULL, (
        f"{raw!r} must degrade to MORE guarding, not less")


def test_the_mode_is_read_PER_REQUEST_not_captured_at_import(monkeypatch):
    """⛔ THE WHOLE ROLLBACK STORY DEPENDS ON THIS. A module-level capture makes
    "flip it back within minutes" a fiction — it would need a redeploy, and the
    bounded-exposure argument for P3 rests on the flip being immediate."""
    monkeypatch.setenv("NOTEBOOK_DOOR_GUARD", "unknown-only")
    assert auth_router._notebook_flags()["notebook_door_guard"] == "unknown-only"
    monkeypatch.setenv("NOTEBOOK_DOOR_GUARD", "full")
    assert auth_router._notebook_flags()["notebook_door_guard"] == "full", (
        "the second read returned the first read's answer — the value is captured")


def test_the_source_contains_no_module_level_capture_of_the_mode():
    """The behavioural test above can pass over a capture that happens to be
    re-read; this asks the SOURCE, the same way the Wave K rail does."""
    src = (REPO / "api" / "routers" / "auth.py").read_text(encoding="utf-8")
    body = src.split("def _notebook_flags", 1)[0]
    assert "os.environ.get(\"NOTEBOOK_DOOR_GUARD\")" not in body, (
        "the mode is read at import — the no-redeploy flip is a fiction")


def test_the_env_name_and_the_payload_key_are_DERIVED_from_the_one_function():
    for env_name in auth_router.NOTEBOOK_MODE_FLAGS:
        key = auth_router._notebook_flag_key(env_name)
        assert key in auth_router._notebook_flags(), (
            f"{env_name} does not reach the payload under its derived key {key}")


def test_the_default_is_a_MEMBER_of_its_own_vocabulary():
    """⭐ A default outside `allowed` would make EVERY read fall back to a value
    the parse then rejects — a flag that can never be set, failing silently."""
    for env_name, (default, allowed) in auth_router.NOTEBOOK_MODE_FLAGS.items():
        assert default in allowed, f"{env_name}'s default {default!r} is not in {allowed}"


# ── the cross-language half, which is where this can actually drift ──────────

def _js_modes() -> set[str]:
    """The mode vocabulary the CLIENT will accept, read from its source."""
    src = JS_FLAGS.read_text(encoding="utf-8")
    out = set()
    for m in re.finditer(r"export const DOOR_GUARD_[A-Z_]+\s*=\s*'([^']+)'", src):
        out.add(m.group(1))
    return out


def test_the_client_and_the_server_agree_on_the_VOCABULARY():
    """⛔⛔ TWO ENDS, ONE WORD, AND NOTHING COMPILES ACROSS THEM.

    The server serves a string and the client compares it to its own literals.
    A rename on one side alone is silent in the worst direction: the client's
    `includes()` fails, it falls back to `full`, and a flip to `unknown-only`
    does NOTHING while the operator reads the variable back as set. That is the
    `railway --kv` trap in a different costume — configured is not applied.
    """
    server = set(auth_router.NOTEBOOK_MODE_FLAGS["NOTEBOOK_DOOR_GUARD"][1])
    client = _js_modes()
    assert client, "no DOOR_GUARD_* constants found in notebookFlags.js — the reader is broken"
    assert server == client, (
        f"server accepts {sorted(server)}, client accepts {sorted(client)}")


def test_the_client_default_is_also_the_SAFE_one():
    src = JS_FLAGS.read_text(encoding="utf-8")
    m = re.search(r"notebook_door_guard:\s*'([^']+)'", src)
    assert m, "FLAG_FALLBACKS carries no notebook_door_guard entry"
    assert m.group(1) == auth_router.DOOR_GUARD_FULL, (
        "the client falls back to a different mode than the server does")


def test_UNKNOWN_ONLY_DOES_NOT_TOUCH_THE_UNREADABLE_BRANCHES():
    """⛔⛔ THE LOAD-BEARING PROPERTY, asserted against the SOURCE because it is
    a claim about what the mode does NOT reach.

    `unknown-only` releases the half Q1 fix 6 covers — a dirty record, a queued
    entry — and not one inch more. An unreadable store means the answer is
    genuinely NOT KNOWN, and no fix to a writer changes what a wrong pass costs
    there. If the mode ever gates an `unreadable` return, it has become a kill
    switch and its name is a lie.
    """
    src = JS_GUARD.read_text(encoding="utf-8")
    # every line that returns `unreadable` must not also consult the mode
    for line in src.splitlines():
        if "why: 'unreadable'" in line:
            assert "doorGuardMode" not in line, (
                f"the mode reaches an unreadable branch: {line.strip()}")
    # ⭐ NON-VACUITY: the file must actually HAVE unreadable branches, or the
    # loop above proves nothing.
    assert src.count("why: 'unreadable'") >= 3, (
        "expected several unreadable branches; the check above may be scanning nothing")
    assert "doorGuardMode()" in src, "the guard does not consult the mode at all"


def test_the_flag_INDEX_can_see_it():
    """⚰️ It could not, on first write. `is_gate()` is a name test, this key
    carries no gate marker, and its table is a new form — so the entire Python
    flag suite passed while knowing nothing about a flag that opens a live
    member path. `mode_flags()` is the third axis that closes it."""
    found = ffi.mode_flags([REPO / "api"], REPO)
    assert "NOTEBOOK_DOOR_GUARD" in found, "the mode flag is invisible to the index again"
    e = found["NOTEBOOK_DOOR_GUARD"]
    assert e["default"] == "full"
    assert set(e["allowed"]) == {"full", "unknown-only"}
    assert any("auth.py" in s for s in e["sites"])


def test_the_index_reader_resolves_NAMED_constants_not_just_literals(tmp_path):
    """⭐ CONTROL — a real table spells its vocabulary with constants, so a
    Constant-only reader returns None for every well-written one and reads as
    'nothing to see'. This is the case that made the first version useless."""
    (tmp_path / "m.py").write_text(
        "A = 'alpha'\n"
        "B = 'beta'\n"
        "THING_MODE_FLAGS = {'THING_MODE': (A, (A, B))}\n",
        encoding="utf-8",
    )
    found = ffi.mode_flags([tmp_path], tmp_path)
    assert found["THING_MODE"]["default"] == "alpha"
    assert set(found["THING_MODE"]["allowed"]) == {"alpha", "beta"}


def test_a_table_the_index_cannot_read_is_RECORDED_not_skipped(tmp_path):
    """⛔ Skipping an unreadable table reproduces the silence this exists to end.
    `default: None` is loud; absence is not."""
    (tmp_path / "m.py").write_text(
        "import os\n"
        "THING_MODE_FLAGS = {'OPAQUE_MODE': (os.environ.get('X'), ('a', 'b'))}\n",
        encoding="utf-8",
    )
    found = ffi.mode_flags([tmp_path], tmp_path)
    assert "OPAQUE_MODE" in found, "an unreadable table vanished instead of being recorded"
    assert found["OPAQUE_MODE"]["default"] is None
