import pytest
from tools.theme_curation import review_doc as R
from tools.theme_curation.proposals import Proposal


def test_write_then_parse_roundtrip():
    props = [Proposal("space", "add", "SNDK", 0.9, {"tier": "core", "rationale": "memory"}),
             Proposal("space", "drop", "AUY", 0.8, {"reason": "acquired"})]
    md = R.write_review_md(props)
    # owner approves the first, leaves the second rejected
    md = md.replace("id=space::SNDK::add -->\n- [ ] APPROVE",
                    "id=space::SNDK::add -->\n- [x] APPROVE")
    decisions = R.parse_review_md(md)
    assert decisions == {"space::SNDK::add": True, "space::AUY::drop": False}


def test_parse_hard_fails_on_broken_block():
    bad = "<!-- CURATION id=space::X::add -->\n(no checkbox line here)\n"
    with pytest.raises(ValueError):
        R.parse_review_md(bad)


def test_header_marker_not_treated_as_block():
    md = R.write_review_md([Proposal("t", "add", "AAA", 0.9, {"tier": "core"})])
    # the instructional header contains a bare "<!-- CURATION -->" with no id= — must not become a phantom block
    assert R.parse_review_md(md) == {"t::AAA::add": False}


def test_real_marker_missing_checkbox_raises():
    bad = "<!-- CURATION id=t::X::add -->\n(the checkbox line was deleted)\n<!-- CURATION id=t::Y::drop -->\n- [x] APPROVE\n"
    with pytest.raises(ValueError):
        R.parse_review_md(bad)


def test_is_rename_drop_only_flags_rename_cited_drops():
    assert R.is_rename_drop(Proposal("fin", "drop", "FI", 0.9, {"reason": "duplicate of FISV (rebranded)"}))
    assert R.is_rename_drop(Proposal("fin", "drop", "SQ", 0.9, {"reason": "ticker changed to XYZ"}))
    # a plain off-theme DROP is NOT rename-class — it may batch normally
    assert not R.is_rename_drop(Proposal("fin", "drop", "OLO", 0.9, {"reason": "restaurant SaaS, tangential"}))
    # only DROPs are ever rename-class; an ADD/REMAP with a rename word is unaffected
    assert not R.is_rename_drop(Proposal("fin", "remap", "SQ", 0.9, {"reason": "renamed", "new_sym": "XYZ"}))


def test_route_forces_rename_drops_to_interactive():
    props = [
        Proposal("fin", "drop", "FI", 0.90, {"reason": "duplicate of FISV rebranded"}),  # rename DROP
        Proposal("fin", "drop", "OLO", 0.90, {"reason": "off-theme restaurant SaaS"}),   # plain DROP
        Proposal("fin", "add", "INTU", 0.95, {"tier": "relevant"}),                      # high-conf ADD
        Proposal("fin", "add", "ADP", 0.50, {"tier": "peripheral"}),                     # low-conf
    ]
    batch, interactive = R.route_for_review(props, 0.85)
    bpids = {p.sym for p in batch}
    ipids = {p.sym for p in interactive}
    assert "FI" in ipids and "FI" not in bpids     # rename DROP forced to interactive despite 0.90
    assert {"OLO", "INTU"} <= bpids                 # plain high-conf still batch
    assert "ADP" in ipids                           # low-conf interactive as usual
