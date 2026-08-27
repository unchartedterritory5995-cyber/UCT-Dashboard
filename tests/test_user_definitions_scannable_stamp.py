"""`GET /api/user-definitions` stamps whether each row can be run as a SCREEN.

⛔⛔ WHY THIS FILE EXISTS — X88, walked in a browser on 2026-08-27.

`macd(close, 12, 26)` was authored in the chart builder with that plot marked
**Scan**, saved with no warning, listed under `Screens ▾ → MY SCANS` with a
`Use as filter` action, and applied. Its chip read **"first sweep tonight"** while
the screener showed the UNFILTERED universe under a `13 matches` header — and it
would have read that FOREVER, because `run_sweep` refuses the definition every
night:

    [gate:yields] this tree returns a number, not a 0/1 column. A scan is
    `<tree> != 0` on the last confirmed bar, so a real-valued tree matches every
    symbol whose value is not exactly zero.

A refused definition never earns a coverage receipt, so the join stays
`applied: false` and the chip never changes.

⭐ THE CAUSE WAS A SECOND AUTHORITY OVER ONE VALUE. `screener/filters.py::
_my_scans_entry` gates the FILTER RAIL on `scan_definition.assert_scannable` and
says in-file that it does so because an unscannable definition "would read 'first
sweep tonight' forever" — and it works: that category was correctly absent. The
Screens MENU asked a different reader, `scanSession.js::scannableScreens`, which
checked only that `compute` was an object, `compute.ast` was present and
`compute.fn` was a non-empty string — a SHAPE check wearing a SCANNABILITY name —
and said yes.

So the knowing side stamps its answer now (`routers/user_definitions.py::
_stamped`) and the client reads the stamp. A stronger JS predicate would NOT have
been enough: the server gate is canonical + a `max_lookback` RESOLVE pass +
`is_boolean_tree`, and the resolve pass has no client twin, so a `resolve:domain`
refusal would produce the same forever-chip through the same mechanism.

⚠️ EVERY TEST HERE ASSERTS BOTH DIRECTIONS. A fixture in which nothing is
scannable passes a filter that rejects everything, and a fixture in which
everything is scannable passes one that rejects nothing
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
"""
from __future__ import annotations

import pytest

from api.routers import user_definitions as router_mod
from api.services import scan_definition


SERIES = {"type": "series", "name": "close"}


def _num(v):
    return {"type": "num", "value": v}


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


#: A REAL-VALUED tree. Canonical, resolvable, hashable — it passes every shape
#: check there is. It is the X88 definition.
NUMBER_TREE = _call("macd", SERIES, _num(12), _num(26))

#: A 0/1 tree. The discriminating half: without a row that comes back
#: `scannable: True`, a stamp hard-wired to False would pass every assertion.
BOOLEAN_TREE = _op(">", SERIES, _call("sma", SERIES, _num(20)))


def _row(ast, def_id="u_000000000001", name="A formula"):
    return {
        "def_id": def_id,
        "ast_hash": "sha256:" + "0" * 64,
        "definition": {
            "schemaVersion": 1,
            "id": def_id,
            "version": 1,
            "meta": {"name": name, "shortName": "F", "repaint": "non-repainting"},
            "compute": {"kind": "ast", "ast": ast},
            "placement": {"target": "price"},
            "plots": [{"key": "value", "style": "line", "role": "primary"}],
            "inputs": [],
        },
    }


def test_the_gate_this_stamp_reports_actually_refuses_the_number_tree():
    """The premise, measured rather than assumed.

    ⛔ If `assert_scannable` ever stopped refusing `macd(...)`, every other test
    in this file would still pass — they would just be agreeing with a gate that
    had gone quiet. So the gate's own behaviour is asserted first, BOTH ways."""
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(_row(NUMBER_TREE)["definition"])
    assert exc.value.gate == "yields", exc.value.gate

    described = scan_definition.assert_scannable(_row(BOOLEAN_TREE)["definition"])
    assert described["def_hash"].startswith("sha256:")


def test_a_real_valued_tree_is_stamped_UNSCANNABLE_and_carries_its_gate():
    out = router_mod._stamped(_row(NUMBER_TREE, name="Audit MACD"))
    assert out["scannable"] is False
    assert out["scan_refusal"]["gate"] == "yields"
    # ⭐ The SENTENCE ships, not just the verdict. A surface that wants to tell
    # the member why their formula is not offered needs the words, and this
    # engine refuses by name everywhere else
    # (`lesson_an_over_refusal_is_invisible`).
    assert "0/1 column" in out["scan_refusal"]["detail"]
    # …and the row is otherwise untouched — the stamp ADDS, it never edits.
    assert out["def_id"] == "u_000000000001"
    assert out["definition"]["compute"]["ast"] == NUMBER_TREE


def test_a_boolean_tree_is_stamped_SCANNABLE_with_no_refusal():
    """The direction that makes the test above mean something."""
    out = router_mod._stamped(_row(BOOLEAN_TREE, name="Above the 20"))
    assert out["scannable"] is True
    assert out["scan_refusal"] is None


def test_the_stamp_does_not_MUTATE_the_row_it_was_handed():
    """`_stamped` returns a copy. A caller that stamped in place would write
    `scannable` into whatever the store handed back — a cached dict, in a
    process that serves other requests."""
    row = _row(BOOLEAN_TREE)
    router_mod._stamped(row)
    assert "scannable" not in row
    assert "scan_refusal" not in row


def test_an_unclassifiable_row_fails_CLOSED_and_blames_the_classifier(monkeypatch):
    """⛔ BOTH HALVES OF THIS MATTER, and they are different halves.

    FAIL CLOSED: if the check itself explodes, the row must not be offered.
    Offering it is precisely the failure this stamp exists to prevent, so an
    exception must never read as consent.

    AND BLAME HONESTLY: the refusal says the formula "could not be checked",
    not that it returns a number. Telling a member their formula is wrong when
    it was our classifier that broke is a wrong reason in an artifact — the
    defect class this branch has paid for repeatedly
    (`lesson_rail_the_sentence_not_just_the_guard`)."""
    def boom(_definition):
        raise RuntimeError("classifier exploded")

    monkeypatch.setattr(scan_definition, "assert_scannable", boom)
    out = router_mod._stamped(_row(BOOLEAN_TREE))
    assert out["scannable"] is False
    assert "could not be checked" in out["scan_refusal"]["detail"]
    assert "RuntimeError" in out["scan_refusal"]["detail"]
    # ⚠️ It must NOT claim the yields gate fired — that gate did not run.
    assert "0/1 column" not in out["scan_refusal"]["detail"]


def test_the_list_route_stamps_EVERY_row_and_drops_NONE(monkeypatch):
    """The wire shape, end to end.

    ⭐ NOTHING IS FILTERED SERVER-SIDE. The member's own indicator is still
    theirs — it lists, it charts, it alerts. `scannable` decides only whether a
    SCREEN door offers it, and a route that silently dropped rows would break
    the library while fixing the menu."""
    rows = [_row(BOOLEAN_TREE, "u_bool", "Above the 20"),
            _row(NUMBER_TREE, "u_num", "Audit MACD")]
    monkeypatch.setattr(router_mod.svc, "list_for_user", lambda _uid: rows)

    body = router_mod.list_definitions(user={"id": "u1"})
    got = body["definitions"]
    assert [r["def_id"] for r in got] == ["u_bool", "u_num"], "a row was dropped"
    assert [r["scannable"] for r in got] == [True, False], (
        "the two rows must be stamped DIFFERENTLY — a stamp that answered the "
        "same for both would satisfy a per-row assertion and still be broken")
