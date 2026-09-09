"""⭐⭐⭐ THE FIVE CONSUMERS, DRIVEN AT THEIR OWN DOORS.

`tests/test_requirement_tags.py` proves the CONTRACT: `requirement_tags` stamps
the manifest's builtins, and `consumer_refusal` answers refuse/accept for each
consumer by name. That is a test of two functions. This is the test that anybody
CALLS them — the half `_functions_cumulative`'s objection actually rested on:

    *"there is no per-entry flag that stops a fetch-dependent column flowing
    into a saved definition, a nightly sweep, an alert or a shared screen, and
    at every one of those consumers the defect is INVISIBLE."*

⛔ EVERY CASE DRIVES THE PRODUCT DOOR, NEVER `consumer_refusal` DIRECTLY. A file
full of `assert consumer_refusal("sweep", tags)` would stay green with all five
call sites deleted, which is precisely the state the manifest refused over.

⛔ AND EVERY REFUSAL CASE HAS A CONTROL — the same door, the same definition,
NO tag — because a door that refuses everything proves nothing about the tag.

⚠️ THE TAG IS WRITTEN STRAIGHT INTO THE COLUMN, and that is not a cheat. The one
tag that exists is set by `ta.cum`, `translatePine` refuses `ta.cum` in BOTH
modes today, and `tests/test_user_definitions_migration.py` ASSERTS that no
tagged builtin is callable from the shipped table — so no definition a member
can author carries a tag yet. What each consumer READS is the stamp stored at
save time, so writing that stamp is exactly the input these doors are built to
refuse. The day `ta.cum` lands on the pane lane these tests keep working
unchanged, which is the point of stamping rather than re-deriving.

⭐ UPDATE 2026-09-09: `cum` IS DECLARED NOW (owner Ruling D), so the chain CAN be
driven end to end, and `test_a_REAL_cum_definition_is_stamped_and_refused_END_TO_
END` at the foot of this file does exactly that. The override cases above are
KEPT and still earn their place: they are parameterised over whatever the
manifest declares, so they go on working for the NEXT tag during the window
before its call is reachable — which is the state the end-to-end case cannot
reach. Two rails, two populations.
"""

import ast as _ast
import json
import pathlib
import sqlite3
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import ast_table                                  # noqa: E402
from api.services import alert_user_series as aus                   # noqa: E402
from api.services import user_definitions as ud                     # noqa: E402
from api.services.screener import scan_evaluator                    # noqa: E402
from api.routers import user_definitions as router                  # noqa: E402


USER = "consumer-user"
DEF_ID = "u_0000000000c0"


#: ⭐ A 0/1 TREE, BECAUSE THE SCREENER CONTROL IS THE REASON THIS FILE HAS ONE
#: DEFINITION AND NOT TWO. `assert_scannable` refuses a real-valued tree at
#: `[gate:yields]` — *"a scan is `<tree> != 0` on the last confirmed bar, so a
#: real-valued tree matches every symbol whose value is not exactly zero"* — so a
#: plain `sma(close, 20)` control would have read as "the screener refused it"
#: and passed the tagged case for a reason that has nothing to do with the tag.
_SCANNABLE_TREE = {
    "type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"},
        {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"},
            {"type": "num", "value": 20}]}]}


def _defn(def_id: str = DEF_ID) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Above Its Average", "shortName": "ABV"},
        "compute": {"kind": "ast", "ast": _SCANNABLE_TREE},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


@pytest.fixture
def tag() -> str:
    """The first tag the MANIFEST declares — never a literal.

    ⛔ `_all_declared_tags`, not `sorted(TABLE["_requirement_tags"])`: that map
    carries prose keys (`_`, `_why_it_exists`) beside the tags, and `"_"` sorts
    first. A refusal driven with `"_"` fires for a DIFFERENT reason ("the
    manifest does not declare it") and every assertion below would still pass.
    """
    tags = ud._all_declared_tags()
    assert tags, "the manifest declares no requirement tag — nothing to drive"
    return tags[0]


def _store(user: str = USER, tags: list | None = None) -> dict:
    row = ud.save(user, DEF_ID, _defn())
    if tags is not None:
        with sqlite3.connect(str(ud._DB_PATH)) as c:
            c.execute("UPDATE user_definitions SET requirements=? "
                      "WHERE user_id=? AND def_id=? AND version=?",
                      (json.dumps(tags), str(user), DEF_ID, row["version"]))
    return row


def _row(user: str = USER) -> dict:
    return ud.get(user, DEF_ID)


# ═══ the stamp ═══════════════════════════════════════════════════════════════

def test_an_ordinary_save_stamps_an_EMPTY_list_and_it_reads_back(defs_db):
    """⭐ THE DEFAULT IS WRITTEN, NOT INHERITED FROM THE COLUMN DEFAULT — so the
    day a save fails to stamp, a row reads `[]` for the wrong reason and this
    test cannot tell. It asserts the RETURN as well, which only `save` produces.
    """
    out = ud.save(USER, DEF_ID, _defn())
    assert out["requirements"] == []
    assert _row()["requirements"] == []


def test_the_stamp_survives_the_read_path_and_the_TOMBSTONE(defs_db, tag):
    """⛔ A DELETE MAY NOT MOVE THE STAMP. `soft_delete` appends a new version of
    the SAME document; re-deriving there would make a delete the one place the
    contract could change silently, and `history()` would show two versions of
    one script disagreeing about what it needs.
    """
    _store(tags=[tag])
    assert _row()["requirements"] == [tag]
    assert ud.soft_delete(USER, DEF_ID) is True
    versions = ud.history(USER, DEF_ID)
    assert versions[-1]["deleted_at"] is not None
    assert versions[-1]["requirements"] == [tag], (
        "the tombstone dropped the predecessor's requirements")


def test_a_byte_identical_RESAVE_reports_the_stored_stamp_not_the_derived_one(
        defs_db, tag):
    """⚠️ THE SAME TRADE `repaint` MAKES, ASSERTED RATHER THAN ASSUMED. A
    byte-identical re-save appends NOTHING, so the row every consumer will read
    is the old one — and the return value has to say so, or a member is told
    their script was re-classified when the stored row was never touched.
    """
    _store(tags=[tag])
    out = ud.save(USER, DEF_ID, _defn())
    assert out["appended"] is False
    assert out["requirements"] == [tag]


@pytest.mark.parametrize("stored", ['{"not": "a list"}', "[1, 2]", "not json"])
def test_an_UNREADABLE_stamp_is_read_as_EVERY_tag_not_as_none(defs_db, stored):
    """⛔⛔ FAIL CLOSED, AND THIS IS THE DIRECTION THAT MATTERS.

    A stored `requirements` SHORTER than reality admits a script to a consumer
    that should have refused it. So a value this lane cannot parse is read as
    carrying every tag the manifest declares — refused everywhere — rather than
    as an empty list, which is what a bare `json.loads` failing open produces.
    """
    _store()
    with sqlite3.connect(str(ud._DB_PATH)) as c:
        c.execute("UPDATE user_definitions SET requirements=? WHERE def_id=?",
                  (stored, DEF_ID))
    assert _row()["requirements"] == ud._all_declared_tags()


# ═══ consumer 1 — the screener ═══════════════════════════════════════════════

def test_the_screener_does_not_OFFER_a_tagged_definition_as_a_filter(defs_db, tag):
    """⭐ THE DOOR IS `_stamped`, WHICH IS WHAT DECIDES `Use as filter`.

    Refusing later — at the sweep — is the forever-chip defect `_stamped`'s own
    docstring was written about: a definition offered as a filter and refused
    every night reads as `first sweep tonight` FOREVER, over the UNFILTERED
    universe.
    """
    _store(tags=[tag])
    out = router._stamped(_row())
    assert out["scannable"] is False
    assert out["scan_refusal"]["gate"] == "requirements"
    assert "screener" in out["scan_refusal"]["detail"]
    assert tag not in out["scan_refusal"]["detail"], (
        "the member is shown the internal TAG NAME instead of what it means")


def test_the_screener_still_offers_an_UNTAGGED_definition(defs_db):
    """⛔ THE CONTROL. Without it, a `_stamped` that refused everything — or one
    whose `assert_scannable` had simply broken — would pass the case above.
    """
    _store()
    out = router._stamped(_row())
    assert out["scannable"] is True, out.get("scan_refusal")
    assert out["scan_refusal"] is None


def test_the_screener_gate_name_is_one_the_CLOSED_SET_declares(defs_db, tag):
    """⛔ `_stamped`'s contract says *branch on the gate, never on the prose* and
    names `scan_definition.GATES` as the closed set. A gate a surface cannot
    enumerate is prose wearing a gate's name."""
    from api.services import scan_definition
    _store(tags=[tag])
    assert router._stamped(_row())["scan_refusal"]["gate"] in scan_definition.GATES


# ═══ consumer 2 — the nightly sweep ══════════════════════════════════════════

def test_the_sweep_does_not_evaluate_a_tagged_definition(defs_db, tag):
    """⛔ THE CONSEQUENCE IF THIS DOOR IS OPEN IS THE WORST OF THE FIVE. The
    sweep files results in `scan_hits` keyed on `ast_hash` — a promise that the
    number means the same thing tomorrow, and for every member who typed the
    same formula. A window-dependent column breaks that silently, permanently.
    """
    _store(tags=[tag])
    assert scan_evaluator.definitions_to_sweep() == []


def test_the_sweep_DOES_evaluate_an_untagged_definition(defs_db):
    _store()
    swept = scan_evaluator.definitions_to_sweep()
    assert [d.get("id") for d in swept] == [DEF_ID]


# ═══ consumer 3 — the alert lane ═════════════════════════════════════════════

def test_arming_an_alert_on_a_tagged_definition_is_refused_BY_NAME(defs_db, tag):
    """The gate is driven end-to-end beside the other seven in
    `tests/test_alert_user_admission.py`; what this adds is that a caller can
    ATTRIBUTE it — `.gate` is `requirements` and not `repaint` or `budget`,
    which is how a surface tells a member something they can act on."""
    _store(tags=[tag])
    with pytest.raises(aus.AdmissionRefused) as caught:
        aus.user_value_function(USER, f"{DEF_ID}.value")
    assert caught.value.gate == "requirements"


def test_an_untagged_definition_still_resolves_a_value_function(defs_db):
    _store()
    assert aus.user_value_function(USER, f"{DEF_ID}.value") is not None


# ═══ consumers 4 & 5 — the share link and the public listing ═════════════════

def test_sharing_a_tagged_definition_is_REFUSED_at_the_minting_door(defs_db, tag):
    """⛔ THE REFUSAL IS AT MINT TIME, NOT AT RESOLVE TIME. A token minted and
    then declined for its recipient is a link the owner believes they sent."""
    _store(tags=[tag])
    with pytest.raises(ud.ShareRefused) as caught:
        ud.share(USER, DEF_ID)
    assert caught.value.reason == "requirements"
    assert "share" in caught.value.detail


def test_listing_a_tagged_definition_is_refused_AS_A_LISTING(defs_db, tag):
    """⭐⭐ THE WRONG-DOOR KILLER, AND IT IS THE WHOLE REASON `publish` ASKS ITS
    OWN QUESTION. `publish` mints the share as a side effect, so inheriting
    `share`'s refusal would tell a member who pressed **List** that their script
    cannot be SHARED — a different claim, about a button they did not press.
    """
    _store(tags=[tag])
    with pytest.raises(ud.ShareRefused) as caught:
        ud.publish(USER, DEF_ID)
    assert caught.value.reason == "requirements"
    assert "listing" in caught.value.detail, (
        "publish inherited share's refusal instead of asking its own")


def test_an_untagged_definition_shares_AND_lists(defs_db):
    """⛔ THE CONTROL FOR BOTH, and it also proves `publish` still mints."""
    _store()
    assert ud.share(USER, DEF_ID)["token"]
    out = ud.publish(USER, DEF_ID)
    assert out["listed"] is True and out["token"]


def test_a_tagged_definition_never_reaches_the_PUBLIC_LIBRARY(defs_db, tag):
    """⭐ THE ARTIFACT, NOT THE CALL. `publish` raising is one fact; the library
    being empty afterwards is the fact a reader of the library depends on."""
    _store(tags=[tag])
    with pytest.raises(ud.ShareRefused):
        ud.publish(USER, DEF_ID)
    assert ud.public_library()["entries"] == []


# ═══ the whole chain, on a definition a MEMBER could actually author ═════════

def test_a_REAL_cum_definition_is_stamped_and_refused_END_TO_END(defs_db):
    """⭐⭐⭐ THE CASE THE HEADER SAID COULD NOT BE DRIVEN YET — IT CAN NOW.

    Every case above writes the tag straight into the column, because when this
    file was written `translatePine` refused `ta.cum` in BOTH modes and no
    definition a member could author carried a tag. Owner Ruling D changed that on
    2026-09-09: `cum` is declared, host mode serves it, and the containment moved
    to the definition. So the chain can be driven for real, and this is it —

        a formula that calls `cum`
          -> `save()` stamps `requirements` by STATIC ANALYSIS (nobody typed it)
          -> the five comparability consumers refuse it BY NAME
          -> the pane accepts it

    ⛔ IT DOES NOT REPLACE THE OVERRIDE CASES AND MUST NOT. Those are parameterised
    over whatever the MANIFEST declares, so they keep working for the next tag
    before its call is reachable — which is the state this one cannot test. Two
    rails, two populations.
    """
    tags = ud._all_declared_tags()
    assert tags, "the manifest declares no requirement tag"

    doc = _defn("u_0000000000ee")
    doc["meta"] = {"name": "Cumulative volume", "shortName": "CUMV"}
    doc["compute"] = {"kind": "ast", "ast": {
        "type": "call", "name": "cum",
        "args": [{"type": "series", "name": "volume"}]}}
    doc["placement"] = {"target": "separate"}

    row = ud.save(USER, "u_0000000000ee", doc)
    # ⛔ NOBODY WROTE THIS. It is derived from the tree at save time, which is the
    # entire claim of the containment design.
    assert row["requirements"] == ["window_dependent"], row["requirements"]

    stored = ud.get(USER, "u_0000000000ee")
    assert stored["requirements"] == ["window_dependent"]

    for consumer in ("screener", "sweep", "alert", "share", "listing"):
        assert ud.consumer_refusal(consumer, stored["requirements"]), (
            f"{consumer} admitted a definition that calls `cum`")
    assert ud.consumer_refusal("pane", stored["requirements"]) is None

    # ⭐ AND THROUGH THE PRODUCT DOORS, not just the contract function.
    out = router._stamped(stored)
    assert out["scannable"] is False
    assert out["scan_refusal"]["gate"] == "requirements"
    with pytest.raises(ud.ShareRefused):
        ud.share(USER, "u_0000000000ee")
    assert ud.public_library()["entries"] == []


# ═══ the roster itself ═══════════════════════════════════════════════════════

def test_EVERY_consumer_the_manifest_refuses_BY_has_a_call_site_in_the_product():
    """⛔⛔ THE DRIFT GUARD, AND IT IS THE ONE THE MANIFEST ACTUALLY ASKED FOR.

    `refused_by` is DATA. Adding a sixth consumer there is a one-line edit that
    would otherwise ship a name nothing asks — the leak re-opening quietly, with
    every test above still green because they only drive the five that exist.

    ⛔ AN AST WALK OVER `api/**`, NEVER A GREP. `lesson_probe_names_must_be_derived
    _not_typed`: a grep for `consumer_refusal("sweep"` on this branch matches this
    file's own prose. This reads the first string ARGUMENT of every call to a
    function named `consumer_refusal`, so a mention in a docstring cannot satisfy
    it and neither can a call from a test.
    """
    root = pathlib.Path(__file__).resolve().parents[1] / "api"
    called: set = set()
    for path in root.rglob("*.py"):
        try:
            tree = _ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):             # pragma: no cover
            continue
        for node in _ast.walk(tree):
            if not isinstance(node, _ast.Call):
                continue
            fn = node.func
            name = (fn.attr if isinstance(fn, _ast.Attribute)
                    else fn.id if isinstance(fn, _ast.Name) else None)
            if name != "consumer_refusal" or not node.args:
                continue
            first = node.args[0]
            if isinstance(first, _ast.Constant) and isinstance(first.value, str):
                called.add(first.value)

    # ⛔ NON-VACUITY. If the walk found nothing at all — a rename, a moved file,
    # a broken parse — every assertion below would pass on an empty set.
    assert called, "the AST walk found no consumer_refusal call sites at all"

    spec = ast_table.TABLE["_requirement_tags"]
    for name, entry in spec.items():
        if not hasattr(entry, "get") or not entry.get("calls"):
            continue
        missing = set(entry["refused_by"]) - called
        assert not missing, (
            f"tag {name!r} names consumer(s) {sorted(missing)} in `refused_by` "
            "and nothing in api/** asks consumer_refusal about them — the tag is "
            "declared and unenforced, which is the leak it exists to close")
        stray = called - set(entry["refused_by"]) - set(entry["accepted_by"])
        assert not stray, (
            f"api/** asks consumer_refusal about {sorted(stray)}, which the "
            "manifest declares nowhere — an unknown consumer is refused for the "
            "wrong reason ('the manifest does not declare it') and the member "
            "reads a sentence about our engine instead of about their script")
