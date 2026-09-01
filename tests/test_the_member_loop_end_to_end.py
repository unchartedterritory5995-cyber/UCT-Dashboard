"""One definition, walked through every verb the product promises.

─── 🔴 WHY THIS FILE EXISTS ─────────────────────────────────────────────────

The pitch is a single sentence: **paste a script you already wrote, then CHART
it, SCREEN with it, ALERT on it, and SHARE it.** Each of those lanes is railed
on its own — the translator corpus, the scan gate, the alert catalog, the
sharing store. Not one of them crosses the JOIN.

⛔ AND A LANE-SHAPED TEST IS STRUCTURALLY BLIND TO A SEVERED WIRE. This repo has
paid for that twice in writing: eight features "built, tested, green and
connected to nothing" (2026-08-08), and `Screener.scanmount.test.jsx`, added
because "component tests are structurally blind to a severed wire". Four green
lanes and a broken join is exactly the state those rails were written after.

⭐ SO THIS WALKS ONE DEFINITION, ONCE, THROUGH ALL OF IT — and it walks the
SERVER half, where the four stores actually meet. The client half (paste →
translate → the save gate) is `doorScorecard.test.js`'s "end to end" line, which
stops at *saveable* and says so; this picks the same definition up there and
carries it the rest of the way.

⚠️ THE FORMULA IS A REAL ONE. `rsi(close, 14) < 30` is the shape a member reaches
for first and the shape the corpus scripts reduce to; a synthetic `close > 0`
would pass every gate here while telling us nothing about a formula anybody would
save.
"""
from __future__ import annotations

import json

import pytest

from api.services import user_definitions
from api.services import scan_definition
from api.services import indicator_alert_evaluator


USER = "u_loop_member"
DEF_ID = "u_000000000777"


def _definition(tree: dict) -> dict:
    """The schema-v1 shape the store accepts."""
    return {
        "schemaVersion": 1,
        "id": DEF_ID,
        "version": 1,
        "meta": {"name": "Oversold RSI", "shortName": "RSI30",
                 "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree,
                    "fn": user_definitions.ast_hash(tree), "rev": 1},
        "placement": {"target": "pane"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


#: `rsi(close, 14) < 30` — a condition, so it can be SCREENED as written.
TREE = {
    "type": "op", "name": "<",
    "args": [
        {"type": "call", "name": "rsi",
         "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 14}]},
        {"type": "num", "value": 30},
    ],
}


@pytest.fixture
def saved(tmp_path, monkeypatch):
    """A member saves one formula. Every later verb reads THIS definition."""
    monkeypatch.setattr(user_definitions, "_DB_PATH", str(tmp_path / "defs.db"))
    out = user_definitions.save(USER, DEF_ID, _definition(TREE))
    assert out["appended"] is True, "the store refused the definition"
    return out


def test_the_member_loop_holds_end_to_end(saved):
    """⭐⭐ SAVE → CHART → SCREEN → ALERT → SHARE, on one definition."""
    # ── SAVE ────────────────────────────────────────────────────────────────
    row = user_definitions.get(USER, DEF_ID)
    assert row is not None, "saved and cannot be read back"
    # ⚠️ `get` returns the STORE ROW — version, rev, ast_hash — with the member's
    # definition nested under `definition`. Reading `row["compute"]` is the shape
    # mistake this comment exists to save the next reader.
    stored = row["definition"]
    assert stored["compute"]["ast"] == TREE, "the tree changed in the store"

    # ── CHART ───────────────────────────────────────────────────────────────
    # ⚠️ The binder is JS; what the SERVER owes the chart is a definition whose
    # stored `fn` still matches its tree. A drifted hash is the one failure that
    # makes a chart draw a formula the member did not write.
    assert row["ast_hash"] == user_definitions.ast_hash(stored["compute"]["ast"]), (
        "the stored hash no longer matches the stored tree — the chart and the "
        "scan would file their answers under different names")

    # ── SCREEN ──────────────────────────────────────────────────────────────
    verdict = scan_definition.assert_scannable(stored)
    assert verdict["yields"] == "bool", (
        f"a saved condition is not scannable as written: {verdict}")
    assert verdict["def_hash"], "no handle to file the results under"

    # ── ALERT ───────────────────────────────────────────────────────────────
    # ⛔ SCOPED. Called with the user id the catalog APPENDS that account's own
    # formulas; the popover carries no list of its own, so a definition missing
    # here has no UI producer at all.
    mine = indicator_alert_evaluator.alert_catalog(USER)
    addresses = [e.get("indicator") for e in mine]
    assert any(DEF_ID in str(a) for a in addresses), (
        f"the saved formula is not offered as an alert target. Catalog: {addresses}")

    # ── SHARE ───────────────────────────────────────────────────────────────
    listing = user_definitions.publish(USER, DEF_ID)
    assert listing and listing.get("listed") is True, (
        "publishing a live definition did not list it")
    token = listing["token"]

    library = user_definitions.public_library(limit=24)
    tokens = [e.get("token") for e in (library.get("entries") or [])]
    assert token in tokens, f"published and not in the library. Library: {tokens}"

    # ⭐ THE LIBRARY SERVES THE SHARE TOKEN, NEVER THE OWNER'S `def_id`, and that
    # is worth pinning rather than merely observing: a public listing keyed by an
    # internal id would hand every browser the owner's address space. The token
    # `publish` minted is exactly the one the library serves — asserting the pair
    # is what makes this a JOIN and not two separate "something came back" checks.
    entry = next(e for e in library["entries"] if e.get("token") == token)
    assert entry.get("name") == "Oversold RSI", "the listing lost the member's name"
    assert "def_id" not in entry, (
        "the public library is exposing the owner's internal definition id")


def test_each_verb_is_a_SEPARATE_claim_and_the_test_would_notice(saved):
    """⛔ NON-VACUITY. The walk above passes if every call happens to return
    something truthy; these assert the individual verbs really are answering
    about THIS definition and would notice if one stopped.
    """
    # A definition the member never saved reaches none of the verbs.
    assert user_definitions.get(USER, "u_000000000000") is None
    ghost = [e for e in indicator_alert_evaluator.alert_catalog(USER)
             if "u_000000000000" in str(e.get("indicator"))]
    assert ghost == [], "the alert catalog offers a definition that does not exist"

    # And the scan gate is a real gate: a NUMBER is not a screen.
    numeric = _definition({"type": "call", "name": "rsi",
                           "args": [{"type": "series", "name": "close"},
                                    {"type": "num", "value": 14}]})
    numeric["compute"]["fn"] = user_definitions.ast_hash(numeric["compute"]["ast"])
    with pytest.raises(scan_definition.ScanRefused) as caught:
        scan_definition.assert_scannable(numeric)
    assert caught.value.gate == "yields", (
        "a numeric column was accepted as a screen — the gate that stops a "
        "screen returning the universe is not firing")
