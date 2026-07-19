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
