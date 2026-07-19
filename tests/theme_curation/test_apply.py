from tools.theme_curation import apply as A
from tools.theme_curation.proposals import Proposal


def _tax():
    return {"version": "4.2.0", "sectors": [{"id": "s", "name": "S"}],
            "themes": [{"id": "space", "name": "Space", "sector_id": "s",
                        "sub_themes": [{"id": "launch", "name": "Launch"}],
                        "holdings": [{"sym": "RKLB", "tier": "core", "sub_theme_id": "launch",
                                      "rationale": "orig"}, {"sym": "OLD", "tier": "relevant"}]}]}


def test_validate_gate():
    theme = _tax()["themes"][0]
    cap = {"RKLB", "OLD", "SNDK", "NEW"}
    assert A.validate_proposal(Proposal("space", "drop", "NOPE", 1), theme, cap)   # not a member
    assert A.validate_proposal(Proposal("space", "add", "RKLB", 1), theme, cap)    # already present
    assert A.validate_proposal(Proposal("space", "add", "SNDK", 1,
        {"tier": "core", "sub_theme_id": "bad"}), theme, cap)                       # bad sub_theme
    assert A.validate_proposal(Proposal("space", "add", "SNDK", 1,
        {"tier": "core", "sub_theme_id": "launch"}), theme, cap) is None            # valid


def test_apply_add_drop_remap_preserves_fields():
    tax = _tax()
    cap = {"RKLB", "OLD", "SNDK", "NEW"}
    approved = [
        Proposal("space", "add", "SNDK", 1, {"tier": "core", "sub_theme_id": "launch", "rationale": "mem"}),
        Proposal("space", "remap", "OLD", 1, {"new_sym": "NEW", "tier": "relevant", "sub_theme_id": None, "rationale": ""}),
    ]
    out, rej = A.apply_proposals(tax, approved, cap)
    syms = [h["sym"] for h in out["themes"][0]["holdings"]]
    assert "SNDK" in syms and "NEW" in syms and "OLD" not in syms and rej == []
    rklb = next(h for h in out["themes"][0]["holdings"] if h["sym"] == "RKLB")
    assert rklb["rationale"] == "orig"    # untouched preserved verbatim


def test_self_validate_catches_missing_sym():
    bad = {"sectors": [{"id": "s", "name": "S"}],
           "themes": [{"id": "t", "name": "T", "sector_id": "s", "holdings": [{"tier": "core"}]}]}
    errs = A.self_validate(bad)
    assert errs and any("sym" in e for e in errs)


def test_bump_version_changes_on_content_and_is_stable():
    tax = _tax()
    v1 = A.bump_version(tax)
    v2 = A.bump_version(A._tax_copy(tax))   # same content -> same hash suffix
    assert v1.split("+")[1] == v2.split("+")[1]
    tax["themes"][0]["holdings"].append({"sym": "ZZ"})
    v3 = A.bump_version(tax)
    assert v3.split("+")[1] != v1.split("+")[1]
