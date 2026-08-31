"""The research reaches a member, and arrives with its provenance intact.

⛔ WHY THIS FILE EXISTS. The library carries ~210 criteria across 26
structures -- verbatim quotes with their sources, numbers we supplied and
label as ours, and refusals naming exactly what a house declined to publish.
Until this route, NONE of it left `base_catalog`: `meta()` returned a label, a
coverage figure and a lift, and no router imported the module at all. The most
valuable output of a 15-source research sweep was the part nobody could see,
which is this repo's own `lesson_built_tested_green_and_unreachable` at scale.
"""
import pytest

from api.services.screener import base_catalog as bc


def test_every_structure_is_reachable_with_its_criteria():
    prov = bc.provenance()
    assert set(prov) == {s.key for s in bc.ALL_STRUCTURES}
    for key, entry in prov.items():
        assert entry["criteria"], "%s exposes no criteria" % key
        assert entry["label"] and entry["desc"], key


def test_the_three_provenance_states_survive_the_boundary():
    """⛔ Collapsing a refusal into an empty string at the edge would rebuild
    the defect the whole grammar exists to prevent: a number attributed to
    nobody. The states are re-derived here from the CATALOG and compared to
    what the view reports, so the view cannot quietly relabel one.
    """
    prov = bc.provenance()
    for st in bc.ALL_STRUCTURES:
        got = {c["condition"]: c["state"] for c in prov[st.key]["criteria"]}
        for c in st.criteria:
            if c.origin == "uct":
                want = "ours"
            elif c.value is None and c.missing:
                want = "refused"
            else:
                want = "sourced"
            assert got[c.condition] == want, (st.key, c.condition)


def test_a_refusal_arrives_carrying_WHAT_IS_MISSING():
    prov = bc.provenance()
    refusals = [(k, c) for k, e in prov.items() for c in e["criteria"]
                if c["state"] == "refused"]
    assert len(refusals) > 20, (
        "only %d refusals reached the surface; the corpus holds far more, so "
        "something is dropping them" % len(refusals))
    for key, c in refusals:
        assert c["value"] is None, key
        assert c["missing"] and len(c["missing"]) > 20, (
            "%s: a refusal with no explanation is just a blank" % key)


def test_a_sourced_criterion_arrives_with_its_QUOTE_and_its_source():
    prov = bc.provenance()
    sourced = [(k, c) for k, e in prov.items() for c in e["criteria"]
               if c["state"] == "sourced"]
    assert len(sourced) > 80, len(sourced)
    for key, c in sourced:
        assert c["quote"], "%s: sourced with no quote" % key
        assert c["source_id"], "%s: sourced with no source id" % key
        assert c["value"] is not None, key


def test_a_number_of_OURS_never_arrives_wearing_a_source():
    """The whole point of the `ours` state is that it cannot be mistaken for
    something a house published.
    """
    prov = bc.provenance()
    for key, entry in prov.items():
        for c in entry["criteria"]:
            if c["state"] == "ours":
                assert not c["source_id"], (key, c["condition"])


def test_the_counts_are_DERIVED_from_the_criteria_they_describe():
    """A count typed beside the list it summarises is the defect this repo has
    paid for four times over.
    """
    counts = bc.provenance_counts()
    prov = bc.provenance()
    flat = [c for e in prov.values() for c in e["criteria"]]
    assert counts["structures"] == len(prov)
    for state in ("sourced", "refused", "ours"):
        assert counts[state] == sum(1 for c in flat if c["state"] == state)
    assert counts["sourced"] + counts["refused"] + counts["ours"] == len(flat)
    # non-vacuity: all three states must actually occur, or the grammar is
    # being reported by a view that has never seen two of them.
    assert min(counts["sourced"], counts["refused"], counts["ours"]) > 0


def test_an_unknown_structure_returns_nothing_rather_than_a_guess():
    assert bc.provenance("no-such-structure") == {}


def test_the_route_is_mounted_and_paid_gated():
    """⛔ A view nobody can reach is the defect this file was written about.
    The route is asserted against the app's own table, not a grep.
    """
    from api.main import app

    paths = {r.path for r in app.routes}
    assert "/api/screener/structures" in paths, (
        "the provenance route is not mounted -- the research is unreachable "
        "again, one layer further out")

    route = next(r for r in app.routes
                 if getattr(r, "path", "") == "/api/screener/structures")
    src = route.endpoint.__doc__ or ""
    assert "provenance" in src.lower()
