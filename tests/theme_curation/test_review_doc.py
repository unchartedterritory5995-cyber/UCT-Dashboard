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
