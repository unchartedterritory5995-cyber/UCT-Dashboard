"""Every column a member can filter on or see in a view has a display def.

beta/current_ratio/close_position shipped filterable-but-undisplayable — a
member could filter on them and never see the value. This pins the gap class.
"""
import re


def _column_def_keys():
    src = open("app/src/pages/screener/columnDefs.js", encoding="utf-8").read()
    body = src.split("export const COLUMN_DEFS = {", 1)[1]
    return set(re.findall(r"^  (\w+): \{", body, flags=re.M))


def test_the_parser_can_see_a_known_key_and_not_a_phantom():
    keys = _column_def_keys()
    assert "ticker" in keys            # non-vacuity control
    assert "definitely_not_a_column" not in keys


def test_every_filterable_and_viewed_column_has_a_def():
    from api.services.screener import filters
    keys = _column_def_keys()
    want = {f["column"] for f in filters.FILTERS.values()}
    for v in filters.VIEWS.values():
        want |= set(v["columns"])
    missing = sorted(want - keys)
    assert not missing, f"member-visible columns with no display def: {missing}"


# ── the completeness side of the same join ────────────────────────────────
# The test above asks "can every member-visible column be DISPLAYED?".
# This one asks the converse: "is every column we COMPUTE reachable by a
# member at all?" — the gap that let six whole filter families ship invisible
# (2026-08-23; see lesson_a_filter_family_with_no_view_is_half_shipped).
#
# A column is member-reachable if it has a display def (the Columns picker's
# `allColumns` is the UNION of COLUMN_DEFS ∪ view columns ∪ filter columns —
# ScannerShell.jsx — so a def alone makes it pickable), or a filter, or a seat
# in a view. Anything else must be named here WITH ITS REASON: we compute it,
# store it nightly, and deliberately never show it.
_PROVENANCE_ONLY = {
    "snapshot_date": "the row's as-of date — surfaced as the toolbar's date chip "
                     "and /api/screener/snapshot-status, never as a grid column",
    "bars_asof":     "provenance for the bar-fed columns; the Seal popover reads it",
    "built_at":      "build timestamp — freshness plumbing, not a stock fact",
}


def test_every_computed_column_is_MEMBER_REACHABLE_or_named_provenance():
    """⛔ A COLUMN NOBODY CAN REACH IS NIGHTLY COMPUTE NOBODY ASKED FOR.

    Derived both sides, so a Wave that adds columns and forgets to wire them
    to a human fails HERE rather than shipping a silent orphan.
    """
    from api.services.screener import filters, snapshot_db
    reachable = _column_def_keys() | {f["column"] for f in filters.FILTERS.values()}
    for v in filters.VIEWS.values():
        reachable |= set(v["columns"])

    orphans = [c for c in snapshot_db.COLUMNS
               if c not in reachable and c not in _PROVENANCE_ONLY]
    assert not orphans, (
        "computed nightly and reachable by no member — give each a def, a "
        f"filter or a view seat, or name it in _PROVENANCE_ONLY: {orphans}")

    # …and the exemption list may not rot into a dumping ground.
    stale = [c for c in _PROVENANCE_ONLY if c not in snapshot_db.COLUMNS]
    assert not stale, f"_PROVENANCE_ONLY names non-columns: {stale}"
    assert all(len(why) > 20 for why in _PROVENANCE_ONLY.values()), \
        "every provenance exemption states WHY, in a sentence"


def test_the_reachability_probe_can_actually_fail():
    """Non-vacuity: a column absent from every surface must be caught."""
    from api.services.screener import filters
    reachable = _column_def_keys() | {f["column"] for f in filters.FILTERS.values()}
    for v in filters.VIEWS.values():
        reachable |= set(v["columns"])
    assert "rugpull_score" not in reachable
    assert "ticker" in reachable
