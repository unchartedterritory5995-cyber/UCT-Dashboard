"""FT-075 Sizzle, 5-day window (lane/o-options-remainders): COV-03's unusual-volume ranking
(`api/services/research/options_screener.py::unusual_volume`) on a 5-session window.

  sizzle = today's option volume / the mean of the underlying's own prior 5 logged sessions.
  Above 1.0 is more option volume than its recent norm.

⛔ NO RATIO BELOW 5 PRIOR SESSIONS: the row says "n sessions, needs 5". The log began 2026-09-30,
   so the answer states the sessions held and the first session the ratio can exist on.
⛔ Same volume source rule as COV-03 (the log's own volume, else the flow tape's large prints,
   named), same end-of-day basis, cached once per set of sessions on disk.
"""
from __future__ import annotations

WINDOW = 5
MIN_SESSIONS = 5
METHOD = ("Sizzle = the underlying's total option volume this session divided by the mean of its "
          f"own prior {WINDOW} logged sessions. Above 1.0 is more option volume than its recent "
          f"norm. Ranked only with {MIN_SESSIONS} prior sessions; below that the row says how many it has.")


def compute(*, store=None, now=None, limit=None) -> dict:
    from api.services.research import options_screener as svc
    out = svc.unusual_volume(store=store, now=now, limit=limit or svc.MAX_ROWS,
                             window=WINDOW, min_sessions=MIN_SESSIONS, method=METHOD)
    return {**out, "label": "computed", "variant": f"{WINDOW}-session window"}


def get() -> dict:
    from api.services.research import options_screener as svc
    return svc.cached("sizzle_5d", lambda store=None: compute(store=store))
