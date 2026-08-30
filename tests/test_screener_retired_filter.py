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


# ── C3: exactly one pattern vocabulary reaches a member ────────────────────

def test_the_retired_vocabulary_is_reachable_from_nowhere():
    """⛔ THE SECOND-AUTHORITY RAIL. The screener carried TWO pattern
    vocabularies with five shared key names on two different confidence scales
    (`pattern_conf_max` 0-1 vs `pattern_engine_conf` 0-100) — a collision
    `pattern_join.py` documented and called unresolved. It is resolved by
    deletion, and this fails if either half comes back.
    """
    from api.services.screener import snapshot_db

    dead = {"patterns", "pattern_conf_max"}

    live_columns = {f["column"] for f in filters.FILTERS.values()}
    assert not (dead & live_columns), "a filter still queries the retired vocabulary"

    assert not (dead & set(filters.FILTERS)), "a retired key is a live filter again"

    seats = {c for v in filters.VIEWS.values() for c in v["columns"]}
    assert not (dead & seats), "a view still seats the retired vocabulary"

    assert not (dead & set(snapshot_db.COLUMNS)), (
        "the snapshot still declares the retired columns — they would be "
        "computed nightly for nobody")


def test_the_cheap_detector_module_is_gone():
    """`patterns.py` computed the retired column. A module that still exists
    invites the next engineer to wire it back in.
    """
    import importlib
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("api.services.screener.patterns")


def test_both_retired_keys_are_recorded_with_a_date():
    for key in ("pattern", "pattern_conf_max"):
        assert key in filters.RETIRED, f"{key} was deleted without being recorded"
        assert filters.RETIRED[key].get("when"), f"{key} retired with no date"
