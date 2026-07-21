"""FIX-C coverage guard.

The analytics exclusion (`analytics_excluded`) must stay applied at EVERY
stat-aggregate site, and must NEVER leak into the trade LIST / export path.

This is a cheap static source guard on purpose: the behavioural test lives in
test_analytics.py, but this one fails loudly the moment someone removes a filter
from an aggregate — or "helpfully" moves it into the shared `trades_where()` /
the trade list, which would HIDE flagged trades instead of badging them.

Spec being protected: FLAG, NEVER HIDE. A phantom short (a Short fabricated from
a broker history window that starts after the real opening BUY) is excluded from
win-rate / expectancy / R / edge, but stays visible and editable so the user can
correct or un-flag it.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

# The exclusion is legitimately expressed three ways: the shared constant, the
# helper, or an inline predicate (optionally table-aliased, e.g. `t.`).
EXCLUSION = re.compile(
    r"ANALYTICS_INCLUDED_SQL|analytics_included_sql\(|[\w.]*analytics_excluded\s+IS\s+NULL"
)

# Every Tier-1a stat-aggregate file. Adding a new aggregate over j2_trades?
# Apply the predicate and add the file here.
AGGREGATE_SITES = [
    "api/services/journal_two/analytics.py",          # THE central fetch (10 sections)
    "api/services/journal_two/accounts.py",           # account metrics + goal progress
    "api/services/journal_two/calendar.py",           # day-cell aggregate
    "api/services/journal_two/coach_data_assembler.py",  # every coaching number
    "api/services/journal_two/community.py",          # public leaderboard
    "api/services/community_badges.py",               # green_week / hot_hand
]

# Paths that must KEEP showing excluded trades.
LIST_SITES = [
    "api/services/journal_two/trades.py",  # list_trades_for_user + export
]


@pytest.mark.parametrize("rel", AGGREGATE_SITES)
def test_aggregate_site_still_excludes_flagged_trades(rel):
    src = (ROOT / rel).read_text(encoding="utf-8")
    assert EXCLUSION.search(src), (
        f"{rel} lost the FIX-C analytics exclusion — flagged phantom-short trades "
        "would silently poison win-rate / expectancy / R / edge again."
    )


@pytest.mark.parametrize("rel", LIST_SITES)
def test_exclusion_never_leaks_into_the_trade_list(rel):
    src = (ROOT / rel).read_text(encoding="utf-8")
    assert not EXCLUSION.search(src), (
        f"{rel} is a LIST/export path and must NOT filter on analytics_excluded — "
        "the spec is FLAG, NEVER HIDE. Excluded trades stay visible and editable."
    )


def test_shared_trades_where_does_not_embed_the_exclusion():
    """`trades_where()` is shared by the trade list, the export and the calendar
    day-detail. Embedding the exclusion there would hide flagged trades from all
    three at once — the single most likely way to break the spec."""
    src = (ROOT / "api/services/journal_two/filters.py").read_text(encoding="utf-8")
    body = src.split("def trades_where", 1)[1].split("\ndef ", 1)[0]
    assert not EXCLUSION.search(body), (
        "The analytics exclusion leaked into trades_where() — that hides flagged "
        "trades from the list/export/calendar-detail, violating 'flag, never hide'."
    )
