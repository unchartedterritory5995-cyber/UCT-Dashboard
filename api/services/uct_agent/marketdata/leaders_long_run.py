"""MD-1 kind `leaders.longRun` (owner: terminal-data, data wave 1) — UCT's long-run leader lists.

A thin adapter over the six preset scans the Scanner widget and the LEAD terminal panel read
(`services/scan_gainers`, `scan_volume`, `scan_ipo`; the reads behind `GET /api/scans/top-gainers-30d|60d|90d`,
`/highest-volume-1y`, `/highest-volume-ever`, `/ipo-1y`). ONE list per read, named by `list`.

`list` uses the LEAD panel's own lens keys (app/src/pages/terminal/panels/longRunModel.js `LONG_RUN_LENSES`), so the
browser capability hands the answer to that panel's pure helper unchanged. One fact in two files: the rail
`test_the_lists_are_the_lead_panels_lens_keys` PARSES the JS and fails when either side gains or loses a key.

WHAT THE SERVICE SAYS, kept apart (never merged into "no leaders")
  * `status: "computing"` — the list's reference is still being built → `unavailable`, with that reason.
  * `status: "ok"` with no rows — nothing qualifies OR the live market snapshot was missing (before the open, a feed
    miss). The service cannot tell which, so the read is `ok` with a note that says both.

TIME (MD-1 §3)
  * The service's `as_of` is when UCT worked the list out (a computation time, like `fetched_at`), from a whole-market
    snapshot up to 30 seconds older; the vendor's observation time is not carried. So the envelope's `as_of` is null,
    `data.computed_at` gives UCT's time, labelled as such, and it is never worded as live. freshness `periodic`.

PROVIDER CALLS: at most one whole-market snapshot per read (shared, cached ~30 s by the service; it cannot say
whether it was a hit, so an answered read counts 1). A reference build runs on the service's own background thread
and is not this turn's.

MODEL-ISOLATED (ADR-005): which names make a list is UCT's own selection (the top 5% of UCT's liquid universe against
a reference close UCT verifies; UCT's volume records and listing set). A UCT-derived ranking, not a vendor fact, so it
is shown to the member only until the owner clears it.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "leaders.longRun"
SOURCE = "uct-scans"
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
_ET = ZoneInfo("America/New_York")
_COMMON = ("sym", "price", "prev_close", "change_pct")
#: row fields per family (the services' own names), everything else in a row is dropped
FIELDS = {"gain": _COMMON + ("change_nd", "ref_close"), "volume": _COMMON + ("volume", "ref_max", "ratio"),
          "ipo": _COMMON + ("ipo_date",)}
#: list key → (family, service module, getter, what the list is)
LISTS: dict[str, tuple[str, str, str, str]] = {
    "30D": ("gain", "scan_gainers", "get_top_gainers_30d", "the top 5% of liquid US common stocks by 30-session change"),
    "60D": ("gain", "scan_gainers", "get_top_gainers_60d", "the top 5% of liquid US common stocks by 60-session change"),
    "90D": ("gain", "scan_gainers", "get_top_gainers_90d", "the top 5% of liquid US common stocks by 90-session change"),
    "VOL1Y": ("volume", "scan_volume", "get_highest_volume_1y", "stocks trading more shares today than on any day in the last year"),
    "VOLMAX": ("volume", "scan_volume", "get_highest_volume_ever", "stocks trading more shares today than on any day on record"),
    "IPO": ("ipo", "scan_ipo", "get_ipo_last_1y", "stocks that first traded within the last year"),
}

NOTE_COMPUTING = "the reference for this list is still being built on the server; ask again in a few minutes"
NOTE_FAILED = "the list could not be read"
NOTE_TIME = ("worked out by UCT at {at} from a whole-market snapshot up to 30 seconds older (UCT's time; the vendor's "
             "observation time is not carried), so as_of is not given — not a live feed")
NOTE_NO_TIME = "the list carries no time, so as_of is not given"
NOTE_EMPTY = ("the list is empty: either nothing qualifies, or the market snapshot it is measured against was missing "
              "(before the open, or a feed miss) — the service cannot tell which")
NOTE_CUT = "showing the first {n} of {total} names, in the list's own order"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if params.get("list") not in LISTS:
        return "`list` must be one of " + ", ".join(LISTS)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def _getter(key: str) -> Callable[[], dict]:
    import importlib
    _family, module, fn, _what = LISTS[key]
    return getattr(importlib.import_module(f"api.services.{module}"), fn)


def _computed_at(raw: Any) -> Optional[str]:
    try:
        d = datetime.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(d if d.tzinfo else d.replace(tzinfo=_ET))


def read_leaders_long_run(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    key = params["list"]
    limit = params.get("limit", DEFAULT_LIMIT)
    family, _module, _fn, what = LISTS[key]
    try:
        payload = _getter(key)()
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(payload, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    status = str(payload.get("status") or "").lower()
    if status == "computing":
        return env.unavailable(KIND, params, SOURCE, NOTE_COMPUTING)
    if status != "ok":
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED, provider_calls=1)

    rows = [{k: r.get(k) for k in FIELDS[family]} for r in (payload.get("results") or [])
            if isinstance(r, dict) and r.get("sym")]
    computed_at = _computed_at(payload.get("as_of"))
    notes = [NOTE_TIME.format(at=computed_at) if computed_at else NOTE_NO_TIME]
    if not rows:
        notes.append(NOTE_EMPTY)
    elif len(rows) > limit:
        notes.append(NOTE_CUT.format(n=limit, total=len(rows)))
    receipt = payload.get("coverage") if isinstance(payload.get("coverage"), dict) else None
    coverage = ({k: int(receipt.get(k) or 0) for k in ("evaluated", "answered", "dropped", "not_computable")}
                if receipt else None)
    # `status` / `results` / `as_of` keep the route's own names: the LEAD panel's pure helper reads them
    data = {"list": key, "family": family, "what": what, "status": "ok", "results": rows[:limit], "count": len(rows),
            "as_of": payload.get("as_of") if computed_at else None, "computed_at": computed_at}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=False, coverage=coverage, notes=notes, provider_calls=1)
