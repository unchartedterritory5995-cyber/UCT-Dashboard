"""A retired filter must REFUSE with words a member can act on."""
import pytest

from api.services.screener import filters, query


def test_the_retired_sentence_names_the_filter_and_its_replacement():
    """⛔ PINNED VERBATIM, same discipline as `_readiness_refusal`: a correct
    guard beside a useless sentence is still a defect a member reads.
    """
    e = query._retired_refusal(
        "pattern", {"label": "Chart Pattern",
                    "replaced_by_label": "Base Structure"})
    msg = str(e)
    assert msg == (
        "This screen uses Chart Pattern, which was retired. Use Base Structure "
        "instead. Edit the screen to remove it, and the rest of its criteria "
        "will run.")


def test_a_retirement_with_no_replacement_says_so_rather_than_trailing_off():
    e = query._retired_refusal("gone", {"label": "Gone"})
    assert "It has no replacement." in str(e)


def test_the_sentence_never_says_unknown_filter_key():
    """That phrasing blames the member for a change WE made, and gives them
    nothing to do about it.
    """
    e = query._retired_refusal("pattern", {"label": "Chart Pattern"})
    assert "unknown filter key" not in str(e).lower()


def test_a_retired_filter_REFUSES_rather_than_being_silently_dropped(monkeypatch):
    """⛔⛔ THE DEFECT THIS MECHANISM EXISTS TO PREVENT.

    A saved screen that quietly stops applying one of its criteria returns MORE
    rows and reads as a broader market — the `CoverageLine` defect running in
    the opposite direction. The member acts on a result that is wrong and looks
    right. So the refusal is loud, and this test fails if anyone "fixes" it by
    skipping the clause.
    """
    monkeypatch.setattr(filters, "RETIRED", {
        "pattern": {"label": "Chart Pattern",
                    "replaced_by_label": "Base Structure"}})
    with pytest.raises(ValueError) as ei:
        query.build_where([{"key": "pattern", "op": "contains",
                            "value": "vcp"}])
    assert "was retired" in str(ei.value)


def test_every_retired_entry_carries_a_label():
    """An entry with no label would render the raw key at a member."""
    for key, entry in filters.RETIRED.items():
        assert entry.get("label"), f"{key} retired without a member-facing label"


def test_no_retired_key_is_still_a_live_filter():
    """A key in both places is a second authority on whether it exists."""
    both = set(filters.RETIRED) & set(filters.FILTERS)
    assert not both, f"keys both live and retired: {sorted(both)}"
