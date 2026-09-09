"""⭐⭐⭐ THE CONTAINMENT MECHANISM `_functions_cumulative` ASKED FOR.

That ruling refused a host/screener split for `ta.cum` on CONTAINMENT grounds:
*"there is no per-entry flag that stops a fetch-dependent column flowing into a
saved definition, a nightly sweep, an alert or a shared screen, and at every one
of those consumers the defect is INVISIBLE"*. The flag now exists, it lives on
the DEFINITION rather than on the table entry, and these cases are what make the
amendment true rather than merely written down.

⛔ EVERY NAME HERE COMES FROM THE MANIFEST. The consumer roster, the builtins
that set a tag, and the tags themselves are read from
`closedTable.json::_requirement_tags` — a hard-coded list in this file would make
the test agree with a copy of the rule rather than with the rule.
"""

import pytest

from api.services import ast_table
from api.services.user_definitions import requirement_tags, consumer_refusal


def _spec(tag="window_dependent"):
    return ast_table.TABLE["_requirement_tags"][tag]


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


CLOSE = {"type": "series", "name": "close"}
VOLUME = {"type": "series", "name": "volume"}


# ─── the stamp ───────────────────────────────────────────────────────────────

def test_the_manifest_declares_the_tag_and_this_test_reads_it_there():
    """⛔ THE CONTROL FOR EVERY CASE BELOW. If the manifest stopped declaring the
    tag, every other assertion here would pass vacuously against an empty set."""
    spec = _spec()
    assert spec["calls"], "the tag must name at least one call"
    assert spec["refused_by"], "and at least one consumer that refuses it"
    assert spec["accepted_by"], "and at least one that accepts it"
    assert set(spec["refused_by"]) & set(spec["accepted_by"]) == set(), \
        "a consumer cannot both refuse and accept"


def test_an_ordinary_script_carries_no_requirements():
    d = {"compute": {"ast": _call("sma", CLOSE, {"type": "number", "value": 20})}}
    assert requirement_tags(d) == []


def test_a_script_calling_the_manifests_builtin_is_TAGGED():
    name = sorted(_spec()["calls"])[0]
    d = {"compute": {"ast": _call(name, VOLUME)}}
    assert requirement_tags(d) == ["window_dependent"]


def test_the_tag_is_found_however_DEEPLY_the_call_is_nested():
    """⭐ THE UNCHARTED VOLUME SHAPE. It never plots the running total — it writes
    `ta.cum(nz(v)) > 0`, so the call sits under a comparison. A walk that only
    looked at the top of each tree would miss exactly the real case."""
    name = sorted(_spec()["calls"])[0]
    d = {"compute": {"trees": [
        _call("gt", _call(name, _call("nz", VOLUME)), {"type": "number", "value": 0})]}}
    assert requirement_tags(d) == ["window_dependent"]


def test_an_UNREADABLE_tree_is_tagged_rather_than_cleared():
    """⛔⛔ FAIL CLOSED, AND THIS IS THE DIRECTION THAT MATTERS.

    `repaint`'s safe direction is a badge STRICTER than reality. This is the
    mirror: a requirements list SHORTER than reality admits a script to a
    consumer that should have refused it. So a call whose name cannot be read is
    treated as though it were the tagged one.
    """
    d = {"compute": {"ast": {"type": "call", "name": None}}}
    assert requirement_tags(d) == ["window_dependent"]


# ─── the contract ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("consumer", sorted(_spec()["refused_by"]))
def test_every_comparability_consumer_REFUSES_by_name(consumer):
    """⭐⭐ THE FIVE CONSUMERS `_functions_cumulative` NAMED, each refusing with a
    sentence a member can read rather than dropping the row."""
    why = consumer_refusal(consumer, ["window_dependent"])
    assert why, f"{consumer} must refuse a window-dependent definition"
    assert consumer in why, "the refusal names the consumer"
    for name in _spec()["calls"]:
        assert name in why, "and names the call that caused it"
    assert "loaded" in why or "history" in why or "fetch" in why, \
        "and says WHY, not just that it declined"


@pytest.mark.parametrize("consumer", sorted(_spec()["accepted_by"]))
def test_the_host_consumer_ACCEPTS(consumer):
    assert consumer_refusal(consumer, ["window_dependent"]) is None


def test_an_untagged_definition_is_accepted_EVERYWHERE():
    """⛔ NON-VACUITY. If the contract refused everything, the cases above would
    prove nothing about the tag."""
    for consumer in sorted(set(_spec()["refused_by"]) | set(_spec()["accepted_by"])):
        assert consumer_refusal(consumer, []) is None
        assert consumer_refusal(consumer, None) is None


def test_an_UNKNOWN_consumer_is_refused_rather_than_admitted():
    """⚠️ A consumer nobody has ruled on is not a consumer that may run this.
    Admitting by default is how a closed leak re-opens quietly."""
    assert consumer_refusal("some_new_surface", ["window_dependent"])


def test_an_UNDECLARED_tag_is_refused_everywhere():
    """A tag the manifest does not carry cannot be reasoned about, so nothing
    accepts it — including the pane."""
    for consumer in sorted(set(_spec()["refused_by"]) | set(_spec()["accepted_by"])):
        why = consumer_refusal(consumer, ["some_future_tag"])
        assert why and "does not declare" in why


# ─── the declaration and the tag are two halves of one decision ──────────────

def test_every_SERIES_LOOKBACK_entry_is_TAGGED_so_none_can_ship_uncontained():
    """⛔⛔ THE HALF A `lookback: "series"` DECLARATION CANNOT SHIP WITHOUT.

    `series` says THE WINDOW IS THE DELIVERED SERIES — which is exactly the
    property that makes a column a fact about the REQUEST rather than about the
    market: widen the fetch and every value moves by one constant. That is the
    defect `_functions_cumulative` refused `ta.cum` over, and the only reason the
    refusal could be relaxed is that `_requirement_tags` now contains it.

    ⛔ SO THE TWO ARE ONE DECISION AND THIS ASSERTS IT. A second `series` entry
    added without a tag would be callable, would resolve to 0 in the budget (which
    is TRUE — it costs no warm-up), would pass every existing rail, and would flow
    straight into the screener, the sweep, an alert, a share and a listing. The
    budget cannot catch it because the budget is not the thing being violated.

    ⚠️ THE CONVERSE IS NOT ASSERTED, ON PURPOSE. A tag may name a call that is not
    `series`-declared — a future tag might be about something else entirely (a
    fetch to another symbol, say). One direction is the safety property; the other
    would be a guess about tags nobody has written.
    """
    from api.services import ast_lint

    functions = ast_table.TABLE["functions"]
    series_declared = sorted(
        name for name, spec in functions.items()
        if hasattr(spec, "get") and spec.get("lookback") == ast_lint.SERIES_LOOKBACK)

    # ⛔ NON-VACUITY. With no `series` entry at all the loop below is empty and
    # this test passes while asserting nothing — the shape this repo names most.
    assert series_declared, (
        "no entry declares `lookback: \"series\"` — either the declaration was "
        "removed (delete this rail with it) or the probe stopped finding it")

    tagged = set()
    for tag, spec in (ast_table.TABLE.get("_requirement_tags") or {}).items():
        if tag.startswith("_") or not hasattr(spec, "get"):
            continue
        tagged |= set(spec.get("calls") or ())

    missing = [n for n in series_declared if n not in tagged]
    assert not missing, (
        f"{missing} declare(s) `lookback: \"series\"` and NO requirement tag names "
        "them. The declaration says the value depends on how much history was "
        "loaded; the tag is the only thing that stops that value reaching the "
        "screener, the sweep, an alert, a share or a listing, where the defect is "
        "invisible. Add the name to `_requirement_tags.<tag>.calls`.")


def test_a_series_declared_entry_really_is_REFUSED_by_the_comparability_consumers():
    """⭐ THE RAIL ABOVE CHECKS THE WIRING; THIS CHECKS IT DOES SOMETHING.

    A name could be listed in a tag whose `refused_by` is empty, which would
    satisfy the assertion above and refuse nobody.
    """
    from api.services import ast_lint
    from api.services.user_definitions import consumer_refusal, requirement_tags

    for name, spec in ast_table.TABLE["functions"].items():
        if not hasattr(spec, "get") or spec.get("lookback") != ast_lint.SERIES_LOOKBACK:
            continue
        tags = requirement_tags({"compute": {"ast": _call(name, VOLUME)}})
        assert tags, f"{name} is series-declared and `requirement_tags` returns nothing"
        refused = [c for c in ("screener", "sweep", "alert", "share", "listing")
                   if consumer_refusal(c, tags)]
        assert refused == ["screener", "sweep", "alert", "share", "listing"], (
            f"{name} is series-declared but only {refused} refuse it")
        assert consumer_refusal("pane", tags) is None, (
            f"{name} is refused by the PANE too — then nothing can draw it and the "
            "declaration is unreachable, which is worse than not declaring it")


def test_the_manifest_amendment_records_WHY_the_split_is_now_allowed():
    """⛔ THE RULING IS AMENDED, NOT OVERTURNED, and the file must say so — a
    future reader who finds `cum` drawable needs the containment argument and its
    answer in the same place, or the objection looks like it was ignored."""
    text = ast_table.TABLE["_functions_cumulative"]
    assert "AMENDED 2026-09-08" in text
    assert "_requirement_tags" in text
    assert "not overturned" in text.lower()
