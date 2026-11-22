"""MD-1 kind `sectors.performance` (owner: terminal-data, data wave 1) — the 11 sector funds ranked by return.

A thin adapter over `services/sector_strength.get_sector_strength(period)` (the read behind
`GET /api/sector-strength`): each SPDR Select Sector fund's percent change over Today / 1W / 1M / 3M, from daily
closes, cached 15 minutes by the service.

PROVIDER CALLS, reported honestly (MD-1 §6.3)
  * A warm service cache is 0 calls. A cold one makes the service fetch one daily-bars series per fund: counted as
    `len(SECTOR_ETFS)` (11), the most it can make. That is over half a turn's provider budget, and it is said in the
    kind's description.
  * ⚠️ COUPLING, stated: "was it warm" is read from the service's own cache key (`sector_strength_<bars>`), the only
    way to tell a hit from a build. If the service renames the key, `test_the_cache_key_is_the_services_own` fails.

TIME (MD-1 §3)
  * The payload carries no time at all: the returns are the latest daily close against the close N sessions back, and
    during a session the latest bar is today's developing bar. So `as_of` is null and a note says why; it is never
    worded as live. freshness `periodic`.
  * A fund whose bars could not be fetched is dropped by the service: the read is then `partial`, with the missing
    funds named.

NOT model-isolated: a fund's percent change between two daily closes is plain vendor price arithmetic, the same class
as `bars.daily` and `themes` (both served to the model). No UCT score, rating or selection rule is involved.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "sectors.performance"
SOURCE = "uct-sector-strength"
ROW_FIELDS = ("sector", "ticker", "change_pct")

NOTE_NO_TIME = ("the sector ranking carries no data time: each return is the fund's latest daily close against its "
                "close {n} session(s) back, cached for up to 15 minutes, and during a session the latest bar is "
                "still forming, so as_of is not given")
NOTE_UNAVAILABLE = "the sector ranking is unavailable: no sector fund's daily bars could be read"
NOTE_MISSING = "not ranked (its daily bars could not be read): {names}"
NOTE_FAILED = "the sector ranking could not be read"


def _svc():
    from api.services import sector_strength
    return sector_strength


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): the period is one of the service's own."""
    svc = _svc()
    if params.get("period", svc.DEFAULT_PERIOD) not in svc.PERIOD_TO_BARS:
        return "`period` must be one of " + ", ".join(svc.PERIOD_TO_BARS)
    return None


def cache_key(period: str) -> str:
    """The service's own cache key for a period (see the module docstring: coupling, railed)."""
    return f"sector_strength_{_svc().PERIOD_TO_BARS[period]}"


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def read_sectors_performance(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    svc = _svc()
    period = params.get("period", svc.DEFAULT_PERIOD)
    from api.services.cache import cache
    warm = cache.get(cache_key(period)) is not None
    calls = 0 if warm else len(svc.SECTOR_ETFS)
    try:
        got = svc.get_sector_strength(period)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED, provider_calls=calls)
    rows = []
    for r in got if isinstance(got, list) else []:
        if not isinstance(r, dict) or _num(r.get("change_pct")) is None or not r.get("ticker"):
            continue
        rows.append({"sector": str(r.get("sector") or r["ticker"]), "ticker": str(r["ticker"]).upper(),
                     "change_pct": _num(r["change_pct"])})
    if not rows:
        return env.unavailable(KIND, params, SOURCE, NOTE_UNAVAILABLE, provider_calls=calls)
    rows.sort(key=lambda r: r["change_pct"], reverse=True)
    n_bars = svc.PERIOD_TO_BARS[period]
    have = {r["ticker"] for r in rows}
    missing = [name for name, t in svc.SECTOR_ETFS.items() if t not in have]
    notes = [NOTE_NO_TIME.format(n=n_bars)]
    if missing:
        notes.append(NOTE_MISSING.format(names=", ".join(missing)))
    data = {"period": period, "sessions": n_bars, "sectors": rows, "missing": missing}
    coverage = {"evaluated": len(svc.SECTOR_ETFS), "answered": len(rows), "dropped": len(missing),
                "not_computable": 0}
    return env.make_envelope(KIND, params, status="partial" if missing else "ok", freshness="periodic", as_of=None,
                             source=SOURCE, data=data, stale=False, coverage=coverage, notes=notes,
                             provider_calls=calls)
