"""The composite columns publish how they are computed — metric 552.

Family 32 (honesty / transparency) is one of the four we finished LAST of
thirteen in, and the scorecard's sharpest line about us is about these columns:
"the composites the benchmark already scored LACKS for having no published
methodology are ALSO the ones we cannot check — a member must simply trust
them, and so must we."
"""
import pytest

from api.services.research import ratings as R
from api.services.screener import methodology as M


# ── the property that makes this publishable at all ──────────────────────────

def test_the_published_weights_ARE_the_live_constant(monkeypatch):
    """⛔ THE ONE TEST THAT MATTERS. A published methodology that can drift from
    the code it describes is worse than none: it is a claim the member CAN
    check, that is wrong. Proven by MOVING the real constant and watching the
    published document follow — a retyped copy would not."""
    monkeypatch.setattr(R, "_COMPOSITE_WEIGHTS",
                        (("eps", 0.5), ("rs", 0.5)), raising=True)
    import importlib
    importlib.reload(M)
    try:
        comp = M.composite_method()
        assert [(c["key"], c["weight"]) for c in comp["components"]] == \
            [("eps", 0.5), ("rs", 0.5)]
        assert [c["share_pct"] for c in comp["components"]] == [50.0, 50.0]
    finally:
        importlib.reload(M)          # restore the real document


def test_the_shares_are_derived_and_sum_to_a_hundred():
    comp = M.composite_method()
    assert sum(c["share_pct"] for c in comp["components"]) == pytest.approx(100.0)
    for c in comp["components"]:
        live = dict(R._COMPOSITE_WEIGHTS)[c["key"]]
        assert c["weight"] == live


def test_the_band_tables_are_the_live_tables():
    comp = M.composite_method()
    assert len(comp["bands"]["rs"]) == len(R._RS_BANDS)
    assert comp["bands"]["eps"][0]["at_least"] == float(R._EPS_BANDS[0][0])
    assert comp["bands"]["growth"][0]["score"] == int(R._GROWTH_BANDS[0][1])


def test_every_weighted_component_has_prose():
    """A component added to the weights without a description must FAIL here
    rather than render a blank beside a number."""
    for key, _w in R._COMPOSITE_WEIGHTS:
        assert key in M._COMPONENT_PROSE, f"{key} carries weight and no words"


# ── what it publishes ────────────────────────────────────────────────────────

def test_it_covers_every_composite_the_benchmark_named():
    published = {m["column"] for m in M.all_methods()["methods"]}
    for named in ("uct_composite", "rs_rank", "accdis", "sponsorship",
                  "rating_eps", "rating_growth", "rating_value", "rating_smr"):
        assert named in published, f"{named} still ships without a method"


def test_every_entry_says_what_it_is_and_what_it_is_not():
    for m in M.all_methods()["methods"]:
        assert m.get("one_line"), m["column"]
        assert m.get("scale"), m["column"]
        assert m.get("how") or m.get("components"), m["column"]
        assert m.get("caveat") or m.get("not_claimed"), (
            f"{m['column']} publishes a method with no stated limit — the "
            "half that makes a methodology honest")


def test_the_composite_publishes_the_renormalisation_caveat():
    """🔴 The single most important thing a member can know about the number,
    and it is a FIELD rather than a footnote: two scores of 72 are not always
    the same measurement."""
    comp = M.composite_method()
    assert "renormalis" in comp["caveat"] or "renormaliz" in comp["caveat"]
    assert "not always the same measurement" in comp["caveat"]
    assert any("not comparable" in n or "not always" in n or "not a price"
               in n for n in comp["not_claimed"])


def test_it_never_claims_to_be_intraday():
    doc = M.all_methods()
    note = doc["as_of_note"]
    assert "03:00" in note and "intraday" in note
    assert "None of them" in note, "the disclaimer must cover EVERY method here"


def test_an_unknown_column_returns_None_not_an_empty_shell():
    assert M.for_column("not_a_column") is None
    assert M.for_column("") is None
    assert M.for_column(None) is None


def test_a_known_column_round_trips():
    assert M.for_column("uct_composite")["column"] == "uct_composite"
    assert M.for_column("rs_rank")["label"] == "RS Rank"
