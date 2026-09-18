"""Assemble the user's personalization ticker sets for the Calendar:
watchlists + flagged + J2 open positions + UCT20.

S6 CP2' -- `get_user_ticker_sets` is now a thin delegate onto
`api.services.member_interest.interest_for`, which owns the four per-source
reads and the WEIGHTED SET registry (SPEC-S6-PERSONALIZATION §3+§5). The
signature and return shape here are UNCHANGED on purpose: `/api/calendar/
my-sets` (`api/routers/calendar.py`) and every other caller of
`get_user_ticker_sets` reads this exact dict shape, so this migration is
provably a no-op at every one of them.

Each source is wrapped in try/except (inside `member_interest.py` now, not
here) so one failing source never blocks the others. Never raises.
"""
from api.services.member_interest import interest_for, SOURCES


def get_user_ticker_sets(user_id: str) -> dict:
    result = interest_for(user_id)
    out = {name: result["by_source"].get(name, set()) for name in SOURCES}
    out["all_mine"] = result["all_mine"]
    return out


def to_payload(sets: dict) -> dict:
    return {k: sorted(v) for k, v in sets.items()}
