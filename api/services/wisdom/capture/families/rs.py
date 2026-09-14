"""D12 family: RS rankings — an in-memory cache, wiped by every deploy, never persisted.

``rs_ranking.cached_rank_map()`` only. ⛔ Never ``compute_rs_scores``: that is the
~17 s, 3.7k-fetch rebuild the background warmer owns, the herd class behind a
past outage. An empty map is the cache being cold (the first minutes after a
deploy), recorded as a gap — never as "no rankings".
"""
from __future__ import annotations

from api.services.wisdom.capture.families._base import result, safe_reader, session_of, to_date, unavailable

FAMILY = "rs"
SOURCE = "api.services.rs_ranking.cached_rank_map"


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services import rs_ranking

    session = to_date(as_of) or session_of(now_et)
    ranks = rs_ranking.cached_rank_map()
    if not ranks:
        return unavailable(FAMILY, as_of=session, source=SOURCE, gap="cache_cold",
                           reason="cached_rank_map() is empty: the RS cache is cold (a deploy within the last "
                                  "few minutes, or the warmer has not completed); nothing computed here")
    gaps = {"as_of_basis": "the ranking carries no as-of date; it reflects bars ending when the 50-minute "
                           "warmer last ran, keyed here on the session of the capture"}
    return result(FAMILY, as_of=session, source=SOURCE, rows=len(ranks), payload=dict(sorted(ranks.items())),
                  gaps=gaps)
